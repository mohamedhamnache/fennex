"""Employees propose their work and wait for validation before acting."""

import pytest

from app.employees import registry
from app.services import employee_chat as chat


# --- what gets proposed -------------------------------------------------------


@pytest.mark.parametrize("employee_id,action_id", [
    ("sirocco", "generate_visual"),        # spends credits, produces an image
    ("sirocco", "multi_network_social"),   # writes social drafts
    ("dune", "write_article"),             # produces an article
    ("mirage", "product_shot"),            # spends credits
    ("oasis", "market_report"),            # heavy research run
])
def test_work_that_produces_something_is_proposed_first(employee_id, action_id):
    employee = registry.get(employee_id)
    assert chat._should_propose(employee, action_id), (
        f"{employee_id}.{action_id} should ask before running")


@pytest.mark.parametrize("employee_id,action_id", [
    ("zerda", "pick_angle"),
    ("zerda", "keyword_targets"),
    ("oasis", "define_icp"),
])
def test_advisory_answers_are_not_gated(employee_id, action_id):
    """Asking to validate 'pick an angle' would be noise, not safety."""
    employee = registry.get(employee_id)
    assert not chat._should_propose(employee, action_id)


def test_the_creative_director_always_asks_before_acting():
    """Both of Sirocco's actions produce assets, so neither runs unvalidated."""
    sirocco = registry.get("sirocco")
    assert sirocco.role == "Creative Director"
    assert sirocco.actions
    for action in sirocco.actions:
        assert chat._should_propose(sirocco, action.id), (
            f"Creative Director would run {action.id} without asking")


# --- hard gates ---------------------------------------------------------------


def test_actions_reaching_outside_fennex_are_hard_gated():
    from app.employees.spec import Action, Employee, P_PUBLISH_EXTERNAL

    employee = Employee(
        id="tmp-publisher", name="Tmp", codename="t", role="r", department="d",
        description="x", permissions=[P_PUBLISH_EXTERNAL],
        actions=[Action(id="publish", label="Publish", description="d",
                        capabilities=["content.article"], skill_key="dune.write_article",
                        requires_permissions=[P_PUBLISH_EXTERNAL])])
    assert chat._needs_approval(employee, "publish")
    assert chat._should_propose(employee, "publish")


def test_an_unknown_action_is_never_proposed():
    assert not chat._should_propose(registry.get("dune"), "does_not_exist")
    assert not chat._needs_approval(registry.get("dune"), None)


# --- approval lifecycle -------------------------------------------------------


@pytest.mark.asyncio
async def test_a_decided_approval_cannot_be_decided_twice(monkeypatch):
    import uuid
    from app.models.conversation import PendingApproval

    approval = PendingApproval(
        id=uuid.uuid4(), org_id=uuid.uuid4(), employee_id="dune",
        action_id="write_article", status="approved")

    class _DB:
        async def get(self, _model, _id):
            return approval
        async def commit(self):
            pass
        async def refresh(self, _row):
            pass

    with pytest.raises(ValueError, match="already decided"):
        await chat.decide_approval(approval.id, approval.org_id, "approved", None, _DB())


@pytest.mark.asyncio
async def test_only_approve_or_reject_are_accepted():
    import uuid
    from app.models.conversation import PendingApproval

    approval = PendingApproval(
        id=uuid.uuid4(), org_id=uuid.uuid4(), employee_id="dune",
        action_id="write_article", status="pending")

    class _DB:
        async def get(self, _model, _id):
            return approval
        async def commit(self):
            pass
        async def refresh(self, _row):
            pass

    with pytest.raises(ValueError, match="approved or rejected"):
        await chat.decide_approval(approval.id, approval.org_id, "maybe", None, _DB())
