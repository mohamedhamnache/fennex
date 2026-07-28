"""plan_tier_enum: add the uppercase labels SQLAlchemy actually emits

Revision ID: x2planlabels3
Revises: g4creditctr9

`Organization.plan_tier` is `SAEnum(PlanTier, name="plan_tier_enum")` with no
`values_callable`, so SQLAlchemy persists each member's **name** -- FREE,
STARTER, PRO, AGENCY, ENTERPRISE -- not its value.

But the type was first created in 08cba287fccb as
`sa.Enum("free", "starter", "pro", "agency", "enterprise", name="plan_tier_enum")`,
i.e. with the lowercase VALUES. No migration has ever added the uppercase
labels. A database built purely from migrations therefore holds only lowercase
labels, and the very first write or filter on any plan tier fails with:

    InvalidTextRepresentationError: invalid input value for enum
    plan_tier_enum: "STARTER"

This never surfaced in development because the dev database's enum was created
from the models (via metadata.create_all), which uses the uppercase names -- so
dev has the correct labels and migrate-only environments do not. t9scaleenum1
fixed exactly this defect for the SCALE tier; the same defect applies to all
five original tiers and is fixed here.

The stray lowercase labels are left in place: Postgres cannot drop an enum
value, and removing them would mean recreating the type and rewriting every
dependent column. Nothing emits them, so they are inert rather than harmful.

`ADD VALUE IF NOT EXISTS` makes this a no-op on any database that already has
the uppercase labels, including the current dev and production databases.
"""
from alembic import op

revision = "x2planlabels3"
down_revision = "g4creditctr9"
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Written out literally rather than looped over a list: the guard test
    # tests/test_enum_labels_match_migrations.py parses migration SOURCE to
    # check that every label the app emits is added somewhere, and an
    # f-string leaves only '{label}' in the file for it to find. Literal
    # statements are also greppable, which is the point of the guard.
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'FREE'")
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'STARTER'")
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'PRO'")
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'AGENCY'")
    op.execute("ALTER TYPE plan_tier_enum ADD VALUE IF NOT EXISTS 'ENTERPRISE'")


def downgrade() -> None:
    # Postgres cannot remove a value from an enum type without recreating the
    # type and rewriting every dependent column. These labels are the ones the
    # application actually emits, so dropping them would break it outright.
    pass
