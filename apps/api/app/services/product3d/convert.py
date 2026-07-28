"""GLB/OBJ conversion for Product-to-3D output (design spec section 3,
"Format conversion").

Trellis (`app/services/product3d/generate.py`) emits GLB only. GLB is
already the format the job needs to store, so it is passed through
byte-identical here -- there is no reason to round-trip Trellis's own
output through trimesh; that would only risk re-encoding it differently
(or dropping something trimesh doesn't understand) for zero benefit.

OBJ is produced locally with `trimesh`, a pure-Python mesh library. OBJ is a
multi-file format (`.obj` geometry + `.mtl` material + texture images), so
the converted OBJ output is a **zip** containing all of them, not a bare
`.obj` file -- callers must name the stored object accordingly (e.g.
`product3d/{job_id}.obj.zip`), not `.obj`.

`supported_formats()` is a capability probe, not a static constant: it
reports what this runtime can actually produce right now. If `trimesh` (or
an optional dependency it needs for textured export) is missing or broken,
OBJ is simply omitted from the result -- never raised, never a 500. The
import is wrapped in a broad `except Exception`, not just `ImportError`,
because a mismatched native dependency stack (e.g. a numpy/scipy ABI
mismatch) can surface on import as `ValueError`/`RuntimeError` rather than
`ImportError` -- this was observed directly while developing this module
against this repo's own dev environment, not a hypothetical.

`FBX`/`USDZ` are out of scope for this iteration (see `ModelFormat`'s
docstring and the design spec) -- `ModelFormat` only has `glb`/`obj`, and
this module raises for anything `supported_formats()` does not report.
"""
import asyncio
import io
import logging
import zipfile

from app.models.product3d import ModelFormat

logger = logging.getLogger(__name__)

_OBJ_FILENAME = "model.obj"
_MTL_FILENAME = "model.mtl"


def supported_formats() -> set[ModelFormat]:
    """Report the `ModelFormat`s this runtime can actually convert to.

    GLB is always supported -- it is a pure passthrough of Trellis's own
    output and never touches trimesh. OBJ requires a working `trimesh`
    import; if that fails for any reason, OBJ is left out rather than
    advertised and then failing at conversion time.
    """
    formats = {ModelFormat.glb}
    try:
        import trimesh  # noqa: F401
    except Exception:
        logger.warning("trimesh unavailable in this runtime -- OBJ export not offered", exc_info=True)
    else:
        formats.add(ModelFormat.obj)
    return formats


async def convert(glb_bytes: bytes, target: ModelFormat) -> bytes:
    """Convert Trellis's GLB output to `target`. Raises if `target` is not
    in `supported_formats()` for this runtime -- never returns a broken or
    partial asset for a format it cannot actually produce."""
    if target not in supported_formats():
        raise ValueError(f"unsupported model format in this runtime: {target.value!r}")

    if target == ModelFormat.glb:
        return glb_bytes

    if target == ModelFormat.obj:
        return await asyncio.to_thread(_glb_to_obj_zip, glb_bytes)

    raise ValueError(f"unsupported model format: {target.value!r}")


def _glb_to_obj_zip(glb_bytes: bytes) -> bytes:
    """Synchronous worker for the OBJ path -- run off the event loop via
    `asyncio.to_thread` since trimesh's load/export is CPU-bound, not I/O."""
    import trimesh

    scene = trimesh.load(io.BytesIO(glb_bytes), file_type="glb")
    obj_text, texture_files = trimesh.exchange.obj.export_obj(
        scene, mtl_name=_MTL_FILENAME, return_texture=True
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(_OBJ_FILENAME, obj_text)
        for filename, data in texture_files.items():
            zf.writestr(filename, data)
    return buf.getvalue()
