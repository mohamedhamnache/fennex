"""Every label SQLAlchemy emits for a native Postgres enum must exist in the type.

`Organization.plan_tier` is `SAEnum(PlanTier, name="plan_tier_enum")` with no
`values_callable`, so SQLAlchemy persists each member's **name** -- FREE,
STARTER, PRO -- not its lower-case value. A migration that adds the value
instead of the name creates a type Postgres accepts and SQLAlchemy cannot use:

    InvalidTextRepresentationError: invalid input value for enum
    plan_tier_enum: "SCALE"

That shipped once and took every admin endpoint reading plan tiers to a 500,
including GET /admin/overview/kpis. The failure is invisible until a row with
the new member is queried, which is why it is pinned here rather than left to
integration testing.
"""
import pathlib
import re

from app.models.organization import Organization, PlanTier

VERSIONS = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _added_labels(type_name: str) -> set[str]:
    """Labels any migration adds to a Postgres enum type."""
    pattern = re.compile(
        rf"ALTER\s+TYPE\s+{type_name}\s+ADD\s+VALUE"
        rf"(?:\s+IF\s+NOT\s+EXISTS)?\s+'([^']+)'",
        re.IGNORECASE,
    )
    found: set[str] = set()
    for path in VERSIONS.glob("*.py"):
        found.update(pattern.findall(path.read_text()))
    return found


def _created_labels(type_name: str) -> set[str]:
    """Labels present when the enum type is first created."""
    found: set[str] = set()
    for path in VERSIONS.glob("*.py"):
        text = path.read_text()
        for block in re.findall(
            rf"CREATE\s+TYPE\s+{type_name}\s+AS\s+ENUM\s*\(([^)]*)\)", text, re.IGNORECASE
        ):
            found.update(re.findall(r"'([^']+)'", block))
        # sa.Enum(...) in a create_table / add_column also creates the type
        for block in re.findall(
            rf"sa\.Enum\(([^)]*name=[\"']{type_name}[\"'][^)]*)\)", text
        ):
            found.update(re.findall(r"[\"']([A-Za-z_][A-Za-z0-9_]*)[\"']", block))
    return found


def test_sqlalchemy_persists_plan_tier_by_name_not_value():
    """The premise of this whole file. If someone adds values_callable the
    migrations must switch to lower-case values, and this test should be the
    thing that tells them."""
    col_type = Organization.__table__.c.plan_tier.type
    assert getattr(col_type, "values_callable", None) is None
    assert set(col_type.enums) == {m.name for m in PlanTier}
    assert set(col_type.enums) != {m.value for m in PlanTier}, (
        "names and values now coincide; this guard no longer discriminates"
    )


def test_every_plan_tier_label_exists_in_a_migration():
    """A member SQLAlchemy will emit but no migration defines means any query
    touching it raises InvalidTextRepresentationError at runtime."""
    emitted = set(Organization.__table__.c.plan_tier.type.enums)
    defined = _created_labels("plan_tier_enum") | _added_labels("plan_tier_enum")
    missing = emitted - defined
    assert not missing, (
        f"plan_tier_enum labels emitted by SQLAlchemy but never added in a "
        f"migration: {sorted(missing)}"
    )


def test_no_migration_adds_a_plan_tier_label_in_the_wrong_case():
    """Catches the original defect directly: adding 'scale' when SQLAlchemy
    emits 'SCALE'."""
    emitted = set(Organization.__table__.c.plan_tier.type.enums)
    emitted_upper = {e.upper() for e in emitted}
    for label in _added_labels("plan_tier_enum"):
        if label in emitted:
            continue
        assert label.upper() not in emitted_upper, (
            f"migration adds plan_tier_enum label {label!r}, but SQLAlchemy "
            f"emits it as {label.upper()!r} -- the wrong case is unreachable "
            f"and the right one will fail at runtime"
        )
