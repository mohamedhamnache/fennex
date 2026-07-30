"""Settle the unverified assumptions in the image pipeline with real predictions.

Every automated test mocks the supplier calls, so they prove wiring and cannot
tell you an edit looks right. This makes a handful of REAL Replicate calls and
answers the questions that mocks structurally cannot:

  1. LaMa's mask POLARITY. Our masks use white = the region to be replaced,
     verified against flux-fill's schema. LaMa's schema says only "Mask image".
     If its convention is inverted, removal erases everything EXCEPT the object
     you selected -- on the exact path this work exists to fix.
  2. Whether LaMa, bria/product-shadow and flux-fill-pro preserve input
     resolution. All three carry a PRESERVE policy on an assumption, and under
     PRESERVE a mismatch fails the operation outright.

Cost: roughly one cent total. Run from apps/api:

    export REPLICATE_API_KEY=$(grep -E '^REPLICATE_API_KEY=' ../../.env | cut -d= -f2- | tr -d '"'"'"' ')
    python scripts/verify_image_models.py

It prints a verdict per question and exits non-zero if any assumption is wrong.
"""
import asyncio
import base64
import io
import os
import sys

import httpx
from PIL import Image as PILImage

API = "https://api.replicate.com/v1"
KEY = os.environ.get("REPLICATE_API_KEY", "")

_LAMA = "allenhooo/lama"
_LAMA_VERSION = "cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72"

# A 512x384 image: left half red, right half blue, with a WHITE 80x80 square
# painted on the red side. Under our convention (white = replace), LaMa should
# reconstruct that square from the surrounding RED. If it comes back red, the
# polarity matches. If instead the whole red half is rebuilt and only the square
# survives, the polarity is INVERTED.
_W, _H = 512, 384
_BOX = (200, 150, 280, 230)  # inside the red half


def _source_png() -> bytes:
    img = PILImage.new("RGB", (_W, _H), (200, 30, 30))
    for x in range(_W // 2, _W):
        for y in range(_H):
            img.putpixel((x, y), (30, 30, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _mask_png() -> bytes:
    """Black everywhere, white only inside _BOX -- our white-is-replaced convention."""
    img = PILImage.new("L", (_W, _H), 0)
    for x in range(_BOX[0], _BOX[2]):
        for y in range(_BOX[1], _BOX[3]):
            img.putpixel((x, y), 255)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _data_uri(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode()


async def _run(client: httpx.AsyncClient, model: str, payload: dict, version: str | None):
    headers = {"Authorization": f"Token {KEY}", "Content-Type": "application/json"}
    if version:
        url, body = f"{API}/predictions", {"version": version, "input": payload}
    else:
        owner, name = model.split("/", 1)
        url, body = f"{API}/models/{owner}/{name}/predictions", {"input": payload}

    for attempt in range(6):
        resp = await client.post(url, json=body, headers=headers)
        if resp.status_code != 429:
            break
        wait = float(resp.json().get("retry_after", 10))
        print(f"    throttled, waiting {wait:.0f}s")
        await asyncio.sleep(wait)
    if not resp.is_success:
        raise RuntimeError(f"create failed {resp.status_code}: {resp.text[:200]}")

    pred = resp.json()
    get_url = pred.get("urls", {}).get("get") or f"{API}/predictions/{pred['id']}"
    for _ in range(120):
        await asyncio.sleep(3)
        poll = await client.get(get_url, headers=headers)
        poll.raise_for_status()
        data = poll.json()
        if data["status"] == "succeeded":
            return data["output"]
        if data["status"] in ("failed", "canceled"):
            raise RuntimeError(f"prediction {data['status']}: {data.get('error')}")
    raise TimeoutError("prediction timed out")


async def _fetch_image(client: httpx.AsyncClient, out) -> PILImage.Image:
    url = out[0] if isinstance(out, list) else (out["model_file"] if isinstance(out, dict) else out)
    r = await client.get(url)
    r.raise_for_status()
    return PILImage.open(io.BytesIO(r.content)).convert("RGB")


async def main() -> int:
    if not KEY:
        print("REPLICATE_API_KEY is not set. See the docstring.")
        return 2

    failures = []
    async with httpx.AsyncClient(timeout=120) as client:
        print("1. LaMa mask polarity + resolution")
        src, mask = _source_png(), _mask_png()
        out = await _run(client, _LAMA,
                         {"image": _data_uri(src), "mask": _data_uri(mask)},
                         _LAMA_VERSION)
        img = await _fetch_image(client, out)

        got_size = img.size
        print(f"   input 512x384 -> output {got_size[0]}x{got_size[1]}")
        if got_size != (_W, _H):
            failures.append(
                f"LaMa changed resolution ({got_size[0]}x{got_size[1]} from 512x384). "
                "Its PRESERVE policy in editing_service will fail every removal."
            )

        # The masked box sat inside the red half, so a correct reconstruction is
        # reddish. Sample its centre.
        cx = (_BOX[0] + _BOX[2]) // 2
        cy = (_BOX[1] + _BOX[3]) // 2
        r, g, b = img.getpixel((min(cx, got_size[0] - 1), min(cy, got_size[1] - 1)))
        # And sample the far blue side, which the mask never touched.
        br, bg, bb = img.getpixel((int(got_size[0] * 0.9), got_size[1] // 2))
        print(f"   masked box centre RGB=({r},{g},{b})   untouched blue side RGB=({br},{bg},{bb})")

        box_is_reddish = r > b + 30
        blue_survived = bb > br + 30
        if box_is_reddish and blue_survived:
            print("   VERDICT: polarity MATCHES ours (white = replaced). Removal is correct.")
        elif not blue_survived:
            failures.append(
                "LaMa POLARITY IS INVERTED: the untouched region changed instead. "
                "Removal will erase everything EXCEPT the selected object. "
                "mask_service must invert its masks for LaMa."
            )
        else:
            failures.append(
                f"LaMa polarity is UNCLEAR: masked box came back ({r},{g},{b}), "
                "expected reddish. Inspect the output by hand before trusting removal."
            )

        print("\n2. flux-fill-pro resolution")
        out = await _run(client, "black-forest-labs/flux-fill-pro", {
            "image": _data_uri(src), "mask": _data_uri(mask),
            "prompt": "plain flat red surface", "output_format": "png",
        }, None)
        img = await _fetch_image(client, out)
        print(f"   input 512x384 -> output {img.size[0]}x{img.size[1]}")
        if img.size != (_W, _H):
            failures.append(
                f"flux-fill changed resolution ({img.size[0]}x{img.size[1]}). "
                "replace_background / insert_object / generative_fill will fail under PRESERVE."
            )

        print("\n3. bria/product-shadow resolution")
        try:
            out = await _run(client, "bria/product-shadow", {
                "image": _data_uri(src), "shadow_type": "regular",
                "shadow_offset_x": 0, "shadow_offset_y": 15, "preserve_alpha": True,
            }, "ffed8143e81736c5fb32ed63ba7362935d8228687fa3b5173eab2fbf86f54ee6")
            img = await _fetch_image(client, out)
            print(f"   input 512x384 -> output {img.size[0]}x{img.size[1]}")
            if img.size != (_W, _H):
                failures.append(
                    f"product-shadow changed resolution ({img.size[0]}x{img.size[1]}). "
                    "generate_shadow will fail under PRESERVE -- switch it to ALLOW_CHANGE."
                )
        except Exception as e:  # noqa: BLE001
            failures.append(f"product-shadow call failed: {e}")

    print("\n" + "=" * 60)
    if failures:
        print("PROBLEMS FOUND:\n")
        for f in failures:
            print(f"  - {f}\n")
        return 1
    print("All assumptions hold. LaMa polarity matches and all three preserve resolution.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
