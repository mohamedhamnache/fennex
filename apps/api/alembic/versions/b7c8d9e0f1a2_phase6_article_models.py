"""phase6_article_models

Revision ID: b7c8d9e0f1a2
Revises: f50be7cb9230
Create Date: 2026-06-26 14:00:00.000000

Creates tables: articles, article_revisions
and enum: article_status_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'f50be7cb9230'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── ensure enum exists ─────────────────────────────────────────────────────
    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE article_status_enum AS ENUM "
        "    ('draft','generating','ready','published'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # ── articles ──────────────────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS articles ("
        "  id UUID PRIMARY KEY, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  title VARCHAR(500) NOT NULL, "
        "  target_keyword VARCHAR(500), "
        "  tone VARCHAR(100) NOT NULL DEFAULT 'professional', "
        "  status article_status_enum NOT NULL DEFAULT 'draft', "
        "  body_markdown TEXT, "
        "  body_html TEXT, "
        "  word_count INTEGER NOT NULL DEFAULT 0, "
        "  word_count_target INTEGER NOT NULL DEFAULT 1500, "
        "  seo_score FLOAT, "
        "  meta_title VARCHAR(500), "
        "  meta_description TEXT, "
        "  outline JSON, "
        "  brand_voice_id UUID REFERENCES brand_voices(id), "
        "  content_item_id UUID REFERENCES content_items(id), "
        "  error TEXT, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_articles_org_id ON articles (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_articles_project_id ON articles (project_id);"
    ))

    # ── article_revisions ─────────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS article_revisions ("
        "  id UUID PRIMARY KEY, "
        "  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE, "
        "  body_markdown TEXT NOT NULL, "
        "  word_count INTEGER NOT NULL DEFAULT 0, "
        "  note VARCHAR(500), "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_article_revisions_article_id ON article_revisions (article_id);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS article_revisions;"))
    op.execute(sa.text("DROP TABLE IF EXISTS articles;"))
    op.execute(sa.text("DROP TYPE IF EXISTS article_status_enum;"))
