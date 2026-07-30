"""Task 5: the planner's mask-avoidance instructions previously made every
mask operation unreachable from plain natural-language text -- the LLM was
told to prefer maskless operations and to only touch a mask op for an
explicit painted selection. Auto mask derivation (mask_service.resolve_mask)
makes that steering obsolete and actively harmful, so these instructions are
inverted here.
"""
from app.services import ai_command_service


def test_planner_no_longer_steers_away_from_mask_operations():
    """The old instruction made every mask op unreachable from plain text."""
    assert "Prefer operations that do NOT require a mask" not in ai_command_service._STEPS_SYSTEM
    assert "user must paint mask on canvas first" not in ai_command_service._OPERATIONS_REFERENCE


def test_operations_reference_documents_the_target_param():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("replace_background", "remove_object", "smart_erase",
               "insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "target" in line, f"{op} does not document target"


def test_default_region_operations_are_told_to_omit_target():
    """Emitting target='the background' would route the commonest, cheapest
    case through the paid segmenter instead of the free product tier."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("replace_background", "remove_object", "smart_erase"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "OMIT" in line, f"{op} does not tell the planner to omit target"


def test_insert_and_fill_require_a_target():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "REQUIRED" in line, f"{op} does not mark target required"
