"""Product-to-3D generation (Trellis on Replicate).

Public surface: `generate_glb`. Everything else is an implementation detail
of the arq worker (`app/workers/tasks/product3d_tasks.py`).
"""

from .generate import TRELLIS_MODEL, generate_glb

__all__ = ["generate_glb", "TRELLIS_MODEL"]
