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


def test_only_replace_background_is_told_it_may_omit_its_target():
    """Emitting target='the background' would route the commonest, cheapest case
    through the paid segmenter instead of the free product tier. Removal used to
    be in this list, which is what let "supprime la menthe" erase the bottle."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    line = next(ln for ln in ref.splitlines() if ln.strip().startswith("- replace_background:"))
    assert "OMIT" in line


def test_insert_and_fill_require_a_target():
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("insert_object", "generative_fill"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "REQUIRED" in line, f"{op} does not mark target required"


def test_removal_operations_require_a_target():
    """"supprime la menthe" produced a disaster: the planner omitted target, the
    product tier masked THE MAIN SUBJECT (the bottle) and erased it, and the mint
    was never touched. Removal always names a thing -- there is no default."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    for op in ("remove_object", "smart_erase"):
        line = next(ln for ln in ref.splitlines() if ln.strip().startswith(f"- {op}:"))
        assert "REQUIRED" in line, f"{op} must require a target, got: {line}"
        assert "OMIT" not in line, f"{op} must not invite omitting the target: {line}"


def test_only_replace_background_may_omit_its_target():
    ref = ai_command_service._OPERATIONS_REFERENCE
    line = next(ln for ln in ref.splitlines() if ln.strip().startswith("- replace_background:"))
    assert "OMIT" in line


def test_the_instructions_tell_the_planner_to_use_the_users_own_words():
    """The old framing said to name a target ONLY when the user singled an object
    out, which read as an invitation to omit it."""
    ref = ai_command_service._OPERATIONS_REFERENCE
    assert "user's own words" in ref
    assert "ONLY\nwhen the user singled out" not in ref
