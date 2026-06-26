"""phase5_brand_voice_models

Revision ID: f50be7cb9230
Revises: 910c442063d6
Create Date: 2026-06-26 12:56:06.747360

Creates tables: brand_voices, brand_voice_sources
and enum: voice_tone_enum
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f50be7cb9230'
down_revision: Union[str, None] = '910c442063d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Use String for the tone column to avoid double-create of the enum
# (the enum was already created by a prior stub); we cast it in the model.
VOICE_TONE_VALUES = ("professional", "conversational", "authoritative", "friendly", "technical", "inspirational")


def upgrade() -> None:
    bind = op.get_bind()

    # ── ensure enum exists ─────────────────────────────────────────────────────
    # Create enum only if it doesn't exist yet
    bind.execute(sa.text(
        "DO $$ BEGIN "
        "  CREATE TYPE voice_tone_enum AS ENUM "
        "    ('professional','conversational','authoritative','friendly','technical','inspirational'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # ── brand_voices ──────────────────────────────────────────────────────────
    bind.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS brand_voices ("
        "  id UUID PRIMARY KEY, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  name VARCHAR(255) NOT NULL, "
        "  tone voice_tone_enum DEFAULT 'professional', "
        "  description TEXT, "
        "  voice_prompt TEXT, "
        "  vocabulary JSON, "
        "  avoid_words JSON, "
        "  is_default BOOLEAN NOT NULL DEFAULT FALSE, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    bind.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_brand_voices_org_id ON brand_voices (org_id);"
    ))

    # ── brand_voice_sources ───────────────────────────────────────────────────
    bind.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS brand_voice_sources ("
        "  id UUID PRIMARY KEY, "
        "  brand_voice_id UUID NOT NULL REFERENCES brand_voices(id) ON DELETE CASCADE, "
        "  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, "
        "  source_type VARCHAR(20) NOT NULL, "
        "  content TEXT NOT NULL, "
        "  extracted_text TEXT, "
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
        "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now() "
        ");"
    ))
    bind.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_brand_voice_sources_brand_voice_id ON brand_voice_sources (brand_voice_id);"
    ))
    bind.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_brand_voice_sources_org_id ON brand_voice_sources (org_id);"
    ))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DROP TABLE IF EXISTS brand_voice_sources;"))
    bind.execute(sa.text("DROP TABLE IF EXISTS brand_voices;"))
    bind.execute(sa.text("DROP TYPE IF EXISTS voice_tone_enum;"))
