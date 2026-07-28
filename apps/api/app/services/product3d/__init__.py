"""Product-to-3D generation (Trellis on Replicate) and format conversion.

Public surface: `generate_glb` here; `convert`/`supported_formats` are
imported directly from the `convert` submodule by callers (see
`app/workers/tasks/product3d_tasks.py`) -- deliberately NOT re-exported
here, since `from .convert import convert` would rebind the `convert`
*submodule* name on this package to the `convert` *function*, breaking
`import app.services.product3d.convert` for anyone who needs the module
itself (e.g. to patch `supported_formats` in tests).
"""

from .generate import TRELLIS_MODEL, generate_glb

__all__ = ["generate_glb", "TRELLIS_MODEL"]
