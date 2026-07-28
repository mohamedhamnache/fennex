"""add SCALE to plan_tier_enum using the enum NAME, not its value

Revision ID: t9scaleenum1
Revises: s8seorates01

`Organization.plan_tier` is declared as `SAEnum(PlanTier, name="plan_tier_enum")`
without `values_callable`, so SQLAlchemy persists each member's **name**, not its
value. The type therefore holds FREE / STARTER / PRO / AGENCY / ENTERPRISE in
upper case.

An earlier revision added the Scale tier as lowercase 'scale' -- copying the
pattern from social_platform_enum, whose members happen to be lower case. The
result was that SQLAlchemy emitted 'SCALE' while Postgres only knew 'scale', so
any query touching PlanTier.SCALE failed with:

    InvalidTextRepresentationError: invalid input value for enum
    plan_tier_enum: "SCALE"

That took down every admin endpoint reading plan tiers, GET /admin/overview/kpis
included, with a 500.

This adds the correctly-cased label. The stray lowercase 'scale' is left in
place: Postgres cannot drop an enum value, and removing it would mean recreating
the type and rewriting every dependent column. It is unreachable -- nothing
emits it -- so it is inert rather than harmful.
"""
from alembic import op

revision = "t9scaleenum1"
down_revision = "s8seorates01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PG 12+ allows ADD VALUE inside a transaction; IF NOT EXISTS keeps it idempotent.
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'SCALE'")


def downgrade() -> None:
    # Postgres cannot drop an enum value; no-op.
    pass
