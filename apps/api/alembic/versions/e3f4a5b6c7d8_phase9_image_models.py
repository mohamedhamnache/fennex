"""phase9_image_models

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-06-26 18:00:00.000000

Creates tables: api_keys, generated_images
and enums: image_style_enum, image_status_enum, image_usage_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e3f4a5b6c7d8'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── api_keys ──────────────────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS api_keys ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  provider VARCHAR(100) NOT NULL, "
        "  encrypted_value TEXT NOT NULL, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_api_keys_org_id ON api_keys (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_api_keys_provider ON api_keys (provider);"
    ))

    # ── image enums ───────────────────────────────────────────────────────────
    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE image_style_enum AS ENUM "
        "    ('photorealistic','illustration','minimalist','abstract','professional'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE image_status_enum AS ENUM "
        "    ('pending','generating','ready','failed'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    op.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE image_usage_enum AS ENUM "
        "    ('article_cover','social_post','brand_asset','custom'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # ── generated_images ─────────────────────────────────────────────────────
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS generated_images ("
        "  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
        "  prompt TEXT NOT NULL, "
        "  revised_prompt TEXT, "
        "  style image_style_enum NOT NULL DEFAULT 'professional', "
        "  usage image_usage_enum NOT NULL DEFAULT 'article_cover', "
        "  status image_status_enum NOT NULL DEFAULT 'pending', "
        "  image_url TEXT, "
        "  thumbnail_url TEXT, "
        "  width INTEGER NOT NULL DEFAULT 1792, "
        "  height INTEGER NOT NULL DEFAULT 1024, "
        "  article_id UUID REFERENCES articles(id) ON DELETE SET NULL, "
        "  social_post_id UUID REFERENCES social_posts(id) ON DELETE SET NULL, "
        "  generation_meta JSON, "
        "  error TEXT, "
        "  cost_usd FLOAT, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_generated_images_org_id ON generated_images (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_generated_images_project_id ON generated_images (project_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_generated_images_status ON generated_images (status);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_generated_images_usage ON generated_images (usage);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS generated_images;"))
    op.execute(sa.text("DROP TABLE IF EXISTS api_keys;"))
    op.execute(sa.text("DROP TYPE IF EXISTS image_usage_enum;"))
    op.execute(sa.text("DROP TYPE IF EXISTS image_status_enum;"))
    op.execute(sa.text("DROP TYPE IF EXISTS image_style_enum;"))
