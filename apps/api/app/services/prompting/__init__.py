"""Composable prompt building for Fennex's AI generation pipelines.

Public surface: `PromptBuilder` and its spec/result dataclasses. Everything
else (`modules`, `vocab`) is importable directly for isolated testing but is
not re-exported here to keep the intended entry point unambiguous.
"""

from .builder import ImageSpec, Product3DSpec, PromptBuilder, PromptResult, ShowcaseSpec

__all__ = [
    "PromptBuilder",
    "PromptResult",
    "ShowcaseSpec",
    "Product3DSpec",
    "ImageSpec",
]
