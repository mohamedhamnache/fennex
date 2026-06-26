"""phase8_social_models

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-06-26 16:00:00.000000

Creates tables: social_posts
and enums: social_platform_enum, social_post_status_enum, social_post_type_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd2e3f4a5b6c7'
down_revision: Union[str, None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ensure enums exist ────────────────────────────────────────────────────
    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE social_platform_enum AS ENUM "
        "    ('linkedin','twitter','instagram','facebook'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE social_post_status_enum AS ENUM "
        "    ('draft','scheduled','published','failed'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE social_post_type_enum AS ENUM "
        "    ('article_share','tip','question','announcement'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # ── social_posts ──────────────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS social_posts ("
        "  id UUID PRIMARY KEY, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  platform social_platform_enum NOT NULL, "
        "  post_type social_post_type_enum NOT NULL DEFAULT 'article_share', "
        "  status social_post_status_enum NOT NULL DEFAULT 'draft', "
        "  content TEXT NOT NULL, "
        "  hashtags JSON, "
        "  media_urls JSON, "
        "  scheduled_at VARCHAR(50), "
        "  published_at VARCHAR(50), "
        "  article_id UUID REFERENCES articles(id) ON DELETE SET NULL, "
        "  engagement_stats JSON, "
        "  error TEXT, "
        "  char_count INTEGER NOT NULL DEFAULT 0, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_social_posts_org_id ON social_posts (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_social_posts_project_id ON social_posts (project_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_social_posts_platform ON social_posts (platform);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_social_posts_status ON social_posts (status);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS social_posts;"))
    op.execute(sa.text("DROP TYPE IF EXISTS social_post_type_enum;"))
    op.execute(sa.text("DROP TYPE IF EXISTS social_post_status_enum;"))
    op.execute(sa.text("DROP TYPE IF EXISTS social_platform_enum;"))
