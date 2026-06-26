"""phase10_analytics_models

Revision ID: f1a2b3c4d5e6
Revises: e3f4a5b6c7d8
Create Date: 2026-06-26 12:00:00.000000

Creates tables: analytics_snapshots, keyword_rankings, gsc_connections
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS analytics_snapshots ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  date DATE NOT NULL, "
        "  clicks INTEGER NOT NULL DEFAULT 0, "
        "  impressions INTEGER NOT NULL DEFAULT 0, "
        "  ctr FLOAT NOT NULL DEFAULT 0.0, "
        "  avg_position FLOAT NOT NULL DEFAULT 0.0, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_analytics_snapshot_project_date UNIQUE (project_id, date) "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_analytics_snapshots_project_date "
        "ON analytics_snapshots (project_id, date DESC);"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS keyword_rankings ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  keyword_id UUID NOT NULL REFERENCES keywords(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  date DATE NOT NULL, "
        "  position FLOAT NOT NULL, "
        "  url VARCHAR(2048), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  CONSTRAINT uq_keyword_ranking_keyword_date UNIQUE (keyword_id, date) "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_keyword_rankings_project_date "
        "ON keyword_rankings (project_id, date DESC);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_keyword_rankings_keyword_date "
        "ON keyword_rankings (keyword_id, date DESC);"
    ))

    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS gsc_connections ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  google_email VARCHAR(255), "
        "  access_token TEXT, "
        "  refresh_token TEXT, "
        "  token_expiry VARCHAR(50), "
        "  site_url VARCHAR(2048), "
        "  is_active BOOLEAN NOT NULL DEFAULT FALSE, "
        "  last_synced_at VARCHAR(50), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS gsc_connections;"))
    op.execute(sa.text("DROP TABLE IF EXISTS keyword_rankings;"))
    op.execute(sa.text("DROP TABLE IF EXISTS analytics_snapshots;"))
