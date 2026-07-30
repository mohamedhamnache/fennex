# Mirage auto-masking — Task 0 findings

**Date:** 2026-07-30
**Status:** Both assumptions verified against live Replicate API responses. No polarity inversion; the spec's polarity table stands.

Every value below comes from an API response or a downloaded artefact fetched during this
verification session. Nothing is recalled or inferred.

---

## Step 1 — flux-fill mask polarity

**Verdict: `FLUX_FILL_WHITE_IS_FILL = True`. White = the region that gets inpainted. The spec's
polarity table is correct and needs no re-approval.**

Verified twice, independently.

### 1a. Schema description (authoritative source)

`GET https://api.replicate.com/v1/models/black-forest-labs/flux-fill-pro` →
`latest_version.openapi_schema.components.schemas.Input.properties.mask`:

```json
{
  "type": "string",
  "title": "Mask",
  "format": "uri",
  "x-order": 2,
  "description": "A black-and-white image that describes the part of the image to inpaint. Black areas will be preserved while white areas will be inpainted. Must have the same size as image. Optional if you provide an alpha mask in the original image. Must be jpeg, png, gif, or webp."
}
```

Unambiguous: *"Black areas will be preserved while white areas will be inpainted."*
No follow-up prediction was needed to disambiguate.

### 1b. Empirical confirmation from the model's own `default_example`

The model record ships a `default_example` with input image, input mask, and the produced output.
All three were downloaded and inspected:

- input image: Kill Bill Vol. 1 poster (670x999)
- input mask: strictly binary (`np.unique` → `[0, 255]`), 9.5% white; the white region covers
  exactly the "KILL BILL" title text block and nothing else
- prompt: `movie poster says "FLUX FILL"`
- output: identical poster except the title now reads "FLUX PILL". `VOLUME 1`, the figure, the
  sword and the MIRAMAX footer — all under **black** mask — are pixel-preserved.

The changed region is exactly the white region. Confirms 1a.

### 1c. Codebase convention already agrees

`_pillow_content_fill` in `apps/api/app/services/editing_service.py:493` does
`inv_mask = ImageOps.invert(mask.convert("L"))  # white = keep, black = fill` — i.e. the mask it
*receives* is white = fill. Same polarity as flux-fill. Repo convention, flux-fill convention and
the spec's table are all consistent.

Also recorded: flux-fill's `Output` schema is `{"type": "string", "format": "uri"}` — a bare URL
string, which `_replicate_run` passes through via its `str(output)` branch. Unchanged behaviour.

---

## Step 2 — text-prompted segmenter

Replicate's `GET /v1/models?query=...` parameter is **ignored** (it returns the same featured list
for every query). Real search is the HTTP `QUERY` method against `/v1/models` with a plain-text
body. Two serious candidates surfaced; both were run for real.

### Chosen: `tmappdev/lang-segment-anything`

| Property | Value | How verified |
|---|---|---|
| `owner/name` | `tmappdev/lang-segment-anything` | `GET /v1/models/tmappdev/lang-segment-anything` |
| Hot deployment | **No** — `POST /v1/models/tmappdev/lang-segment-anything/predictions` returns `404 {"detail":"The requested resource could not be found."}`. Must pass `version=`. | live POST |
| Version SHA | `891411c38a6ed2d44c004b7b9e44217df7a5b07848f29ddefd2e28bc7cbf93bc` | `latest_version.id`; a prediction against it succeeded |
| Image field | `image` (string, uri, "Path to the input image") | Input schema |
| Prompt field | `text_prompt` (string, "Text prompt for segmentation") | Input schema |
| Output shape | **bare URL string** (`Output` schema `{"type":"string","format":"uri"}`); live run returned `"https://replicate.delivery/.../mask_output.png"`, Python type `str` | live prediction |
| `_replicate_run` fit | Clean. Not a list, not a Mapping → falls to `return str(output)`, which is a no-op on a URL string. **No change to `_replicate_run` required.** | contract at `editing_service.py:341-345` |
| Mask polarity | White/light on black, matched object is light. **Matches this codebase's convention — no inversion needed.** | mask downloaded and visually inspected |
| Output size | Equals input size (2250x1500 in → 2250x1500 out), satisfying flux-fill's "must have the same size as image" | PIL |

Live run: `image=<cars.jpg>`, `text_prompt="car"` → succeeded, returned `mask_output.png` in
mode `L`, both cars rendered light on a black background.

### Rejected: `schananas/grounded_sam`

Rejected for one decisive reason: **its output list is ordered such that `output[0]` is not a mask.**

A live run (`mask_prompt="car"`) returned a 4-element list:

```json
[
  "https://replicate.delivery/.../annotated_picture_mask.jpg",
  "https://replicate.delivery/.../neg_annotated_picture_mask.jpg",
  "https://replicate.delivery/.../mask.jpg",
  "https://replicate.delivery/.../inverted_mask.jpg"
]
```

`_replicate_run` returns `output[0]` for a list — which here is `annotated_picture_mask.jpg`, a
**pink-overlay preview with drawn bounding boxes and `car 0.81` / `car 0.67` confidence labels
burnt in** (visually confirmed). Feeding that to flux-fill as a mask would be silently wrong: it
is a full-colour photo, not a binary mask. The real binary mask is at **index 2**, and index 3 is
its inverse. Using this model would require either changing `_replicate_run`'s contract or adding
an index-aware wrapper. Not worth it when a single-URL model exists.

(For the record: `mask.jpg` at index 2 *is* a correct white-on-black mask of the matched objects,
and `inverted_mask.jpg` at index 3 is black-on-white. So grounded_sam's polarity also matches. Its
input fields are `image` / `mask_prompt`, plus `negative_mask_prompt` and `adjustment_factor`
(erosion/dilation). It has no hot deployment either — `404` — version
`ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c`. Keep it as a fallback only if
the negative-prompt or dilation controls turn out to be needed.)

---

## Step 3 — resulting constants

```python
_SEGMENTER_MODEL = "tmappdev/lang-segment-anything"
_SEGMENTER_VERSION = "891411c38a6ed2d44c004b7b9e44217df7a5b07848f29ddefd2e28bc7cbf93bc"
_SEGMENTER_IMAGE_FIELD = "image"
_SEGMENTER_PROMPT_FIELD = "text_prompt"
_SEGMENTER_INVERTS = False
FLUX_FILL_WHITE_IS_FILL = True
```

Call shape for later tasks:

```python
mask_url = await _replicate_run(
    _SEGMENTER_MODEL,
    {_SEGMENTER_IMAGE_FIELD: image_url, _SEGMENTER_PROMPT_FIELD: object_phrase},
    version=_SEGMENTER_VERSION,
)
```

---

## Two caveats later tasks must handle

These were not in the brief but were discovered while verifying, and both would produce wrong
output if ignored.

### Caveat 1 — the mask is an instance-label map, not a binary mask. It must be binarised.

The mask returned for `text_prompt="car"` on a two-car image has **three** grey levels, not two:

```
mode=L  uniques: 0 -> 63.12%,  211 -> 24.27%,  255 -> 12.61%
```

`255` is one car, `211` is the other, `0` is background. The model assigns a distinct grey level
per matched instance. Since flux-fill reads the mask as a continuous alpha, a `211` region would
be inpainted only partially — the second car would come back as a half-blended ghost.

**Required:** binarise before handing the mask to flux-fill — every pixel `> 0` becomes `255`.
`_SEGMENTER_INVERTS = False` describes polarity only; it does not mean "pass through unmodified".

### Caveat 2 — there is no "nothing matched" signal. A nonsense prompt returns a confident wrong mask.

Same image, `text_prompt="elephant"`:

```
status = succeeded
output = "https://replicate.delivery/.../mask_output.png"
mask uniques: 0 -> 87.39%, 255 -> 12.61%
```

12.61% white — byte-for-byte the same area as the left car in the `"car"` run. The model
(GroundingDINO + SAM) has no confidence threshold exposed on its input schema, so it always
returns its top-scoring box. A user typing an object that is not in the image gets a plausible
mask over an unrelated object and their edit silently lands in the wrong place.

**Implication:** auto-derived masks cannot be trusted blindly. The design needs at minimum a
user-visible mask preview/confirm step, or a heuristic guard (e.g. reject masks whose white
fraction is implausible — near-0% or near-100%). Worth flagging to whoever owns the UX task, as
the spec assumes the derived mask is correct.

---

## Verification environment

- `REPLICATE_API_KEY` read from repo-root `.env`; all calls authenticated (HTTP 200/201).
- The account is under \$5 credit, so Replicate throttles prediction creation to 6/min with a
  burst of 1 (HTTP 429 + `retry_after`). Predictions themselves succeed normally. This affects
  test throughput only, not correctness — but Task 3's tests should mock Replicate rather than
  hit it live.
- Test image: `https://replicate.delivery/pbxt/LMbGi83qiV3QXR9fqDIzTl0P23ZWU560z1nVDtgl0paCcyYs/cars.jpg`
  (2250x1500, two classic cars). The URL in an earlier draft of this check
  (`st.mngbcn.com/...`, the `grounded_sam` schema default) is dead — it 404s and both models fail
  on it. Do not reuse it in fixtures.
