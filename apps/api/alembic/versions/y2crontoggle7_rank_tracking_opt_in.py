"""Project.rank_tracking_enabled — scheduled tracking becomes opt-in

Every tracked keyword on an enabled project is a paid SERP task every week.
Until now a project acquired that cost silently by having keywords on it, and
the platform absorbed the bill. Both change: it is opt-in per project, and it
draws on the org's SEO credits like any other paid work.

Defaults to FALSE, including for existing rows. That is deliberate: switching
it on for everyone would start charging SEO credits against allowances nobody
agreed to, and would bill for tracking on projects that may be long abandoned.
Customers turn it on where they want it.

Revision ID: y2crontoggle7
Revises: x1stdqueue6
"""
from alembic import op
import sqlalchemy as sa

revision = "y2crontoggle7"
down_revision = "x1stdqueue6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column(
        "rank_tracking_enabled", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    op.drop_column("projects", "rank_tracking_enabled")
