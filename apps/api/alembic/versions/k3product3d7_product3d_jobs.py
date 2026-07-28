"""product3d_jobs: Product-to-3D job model

Revision ID: k3product3d7
Revises: y5kontextrate9
Create Date: 2026-07-28 00:00:00.000000

Creates table product3d_jobs and enums product3d_status_enum,
model_format_enum.

Both `Product3DJob.status` and the app-level `ModelFormat` enum are declared
with `values_callable=lambda x: [e.value for e in x]` on the model side (see
app/models/product3d.py), so SQLAlchemy persists each member's VALUE, not its
NAME -- both happen to be identical lowercase strings here (pending/running/
completed/failed, glb/obj), but the type is created with those exact VALUES
below regardless, per the x2planlabels3 lesson: a migration that creates the
wrong casing/spelling silently produces a type SQLAlchemy can never write to.

model_format_enum is created for documentation/consistency with the other
enum on this job, but `requested_formats` and the keys of `output_urls` are
stored as JSON (a list / dict of strings), not as a Postgres array of this
enum -- multi-select values don't map onto a single-valued native enum
column, matching how ModelFormat is used everywhere else in the app.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "k3product3d7"
down_revision: Union[str, None] = "y5kontextrate9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── enums ─────────────────────────────────────────────────────────────────
    product3d_status_enum = sa.Enum(
        "pending", "running", "completed", "failed",
        name="product3d_status_enum",
    )
    product3d_status_enum.create(op.get_bind(), checkfirst=True)

    # model_format_enum is not used as a column type below (see module
    # docstring) but is created here so the Postgres type exists alongside
    # the model's Python enum should a future migration want a native column.
    model_format_enum = sa.Enum(
        "glb", "obj",
        name="model_format_enum",
    )
    model_format_enum.create(op.get_bind(), checkfirst=True)

    # Reference the already-created type without re-creating it in
    # create_table below (op.create_table would otherwise re-emit CREATE TYPE
    # and break a from-zero run -- see the duplicate-CREATE-TYPE lesson).
    status_col_enum = postgresql.ENUM(
        "pending", "running", "completed", "failed",
        name="product3d_status_enum",
        create_type=False,
    )

    # ── product3d_jobs ───────────────────────────────────────────────────────
    op.create_table(
        "product3d_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_image_url", sa.Text(), nullable=False),
        sa.Column("status", status_col_enum, nullable=False, server_default="pending"),
        sa.Column("quality", sa.String(20), nullable=False, server_default="high"),
        sa.Column("texture_resolution", sa.String(10), nullable=False, server_default="2K"),
        sa.Column("requested_formats", postgresql.JSON(), nullable=False, server_default="[]"),
        sa.Column("output_urls", postgresql.JSON(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_product3d_jobs_org_id", "product3d_jobs", ["org_id"])
    op.create_index("ix_product3d_jobs_project_id", "product3d_jobs", ["project_id"])


def downgrade() -> None:
    op.drop_table("product3d_jobs")
    sa.Enum(name="model_format_enum").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="product3d_status_enum").drop(op.get_bind(), checkfirst=True)
