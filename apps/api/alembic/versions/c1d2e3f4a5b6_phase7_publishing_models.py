"""phase7_publishing_models

Revision ID: c1d2e3f4a5b6
Revises: b7c8d9e0f1a2
Create Date: 2026-06-26 15:00:00.000000

Creates tables: publishing_connections, publish_jobs
and enums: publishing_platform_enum, publish_job_status_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, None] = 'fad4be7d80f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ensure enums exist ────────────────────────────────────────────────────
    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE publishing_platform_enum AS ENUM "
        "    ('wordpress','ghost','notion','custom'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE publish_job_status_enum AS ENUM "
        "    ('pending','running','done','failed'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # ── publishing_connections ────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS publishing_connections ("
        "  id UUID PRIMARY KEY, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  name VARCHAR(200) NOT NULL, "
        "  platform publishing_platform_enum NOT NULL, "
        "  site_url VARCHAR(500) NOT NULL, "
        "  credentials_encrypted TEXT, "
        "  is_active BOOLEAN NOT NULL DEFAULT TRUE, "
        "  last_tested_at VARCHAR(50), "
        "  last_test_ok BOOLEAN, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_publishing_connections_org_id ON publishing_connections (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_publishing_connections_project_id ON publishing_connections (project_id);"
    ))

    # ── publish_jobs ──────────────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS publish_jobs ("
        "  id UUID PRIMARY KEY, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  connection_id UUID NOT NULL REFERENCES publishing_connections(id) ON DELETE CASCADE, "
        "  article_id UUID REFERENCES articles(id) ON DELETE SET NULL, "
        "  status publish_job_status_enum NOT NULL DEFAULT 'pending', "
        "  platform_post_id VARCHAR(200), "
        "  published_url VARCHAR(500), "
        "  error TEXT, "
        "  meta JSON, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_publish_jobs_org_id ON publish_jobs (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_publish_jobs_project_id ON publish_jobs (project_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_publish_jobs_connection_id ON publish_jobs (connection_id);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS publish_jobs;"))
    op.execute(sa.text("DROP TABLE IF EXISTS publishing_connections;"))
    op.execute(sa.text("DROP TYPE IF EXISTS publish_job_status_enum;"))
    op.execute(sa.text("DROP TYPE IF EXISTS publishing_platform_enum;"))
