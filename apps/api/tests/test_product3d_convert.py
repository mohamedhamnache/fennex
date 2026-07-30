"""Tests for app.services.product3d.convert -- GLB passthrough, OBJ export
via trimesh, the supported_formats() capability probe, and the unsupported
-target error path. No network calls; trimesh's own mesh creation is used
to build the source GLB, exactly as the task brief specifies."""
import builtins
import io
import sys
import zipfile
from unittest.mock import patch

import pytest

from app.models.product3d import ModelFormat
from app.services.product3d import convert as convert_module


def _make_box_glb() -> bytes:
    import trimesh

    mesh = trimesh.creation.box()
    return mesh.export(file_type="glb")


async def test_glb_passes_through_byte_identical():
    source = b"not-actually-a-real-glb-but-that-is-the-point-of-this-test"
    result = await convert_module.convert(source, ModelFormat.glb)
    assert result == source
    assert result is source or bytes(result) == source


async def test_glb_passthrough_never_touches_trimesh():
    source = _make_box_glb()
    with patch("trimesh.load", side_effect=AssertionError("trimesh.load must not be called for GLB")):
        result = await convert_module.convert(source, ModelFormat.glb)
    assert result == source


async def test_obj_conversion_roundtrips_to_a_mesh_with_faces():
    import trimesh

    source_glb = _make_box_glb()

    result = await convert_module.convert(source_glb, ModelFormat.obj)

    assert isinstance(result, bytes)
    assert zipfile.is_zipfile(io.BytesIO(result))

    with zipfile.ZipFile(io.BytesIO(result)) as zf:
        names = zf.namelist()
        obj_members = [n for n in names if n.endswith(".obj")]
        assert obj_members, f"zip has no .obj member: {names}"
        obj_bytes = zf.read(obj_members[0])

    reloaded = trimesh.load(io.BytesIO(obj_bytes), file_type="obj")
    # A box mesh may load back as a Trimesh directly or (rarely, depending on
    # trimesh version) a single-geometry Scene -- normalize either way.
    if hasattr(reloaded, "geometry"):
        meshes = list(reloaded.geometry.values())
        assert meshes, "reloaded OBJ scene has no geometry"
        reloaded = meshes[0]

    assert hasattr(reloaded, "faces")
    assert len(reloaded.faces) > 0


async def test_unsupported_format_raises():
    with patch.object(convert_module, "supported_formats", return_value={ModelFormat.glb}):
        with pytest.raises(ValueError):
            await convert_module.convert(b"irrelevant", ModelFormat.obj)


def test_supported_formats_reports_obj_when_trimesh_is_importable():
    # This repo's dev environment has trimesh installed for this task, so
    # the honest, unmocked probe result must include both formats.
    assert convert_module.supported_formats() == {ModelFormat.glb, ModelFormat.obj}


def test_supported_formats_degrades_to_glb_only_when_trimesh_is_missing():
    # sys.modules[name] = None makes `import trimesh` raise
    # ModuleNotFoundError, simulating the dependency being absent from this
    # runtime without needing to actually uninstall it.
    with patch.dict(sys.modules, {"trimesh": None}):
        assert convert_module.supported_formats() == {ModelFormat.glb}


def test_supported_formats_degrades_to_glb_only_on_any_import_error_not_just_importerror():
    # A broken native-dependency stack (e.g. numpy/scipy ABI mismatch,
    # observed directly against this repo's own environment while writing
    # this module) can surface as something other than ImportError. The
    # probe must catch broadly, not just ImportError, and never raise.
    real_import = builtins.__import__

    def _raise_on_trimesh_import(name, *args, **kwargs):
        if name == "trimesh":
            raise ValueError("numpy.dtype size changed, may indicate binary incompatibility")
        return real_import(name, *args, **kwargs)

    with patch("builtins.__import__", side_effect=_raise_on_trimesh_import):
        assert convert_module.supported_formats() == {ModelFormat.glb}
