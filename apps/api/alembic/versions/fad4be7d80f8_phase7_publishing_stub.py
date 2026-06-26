"""phase7_publishing_stub

Revision ID: fad4be7d80f8
Revises: b7c8d9e0f1a2
Create Date: 2026-06-26 14:30:00.000000

Stub migration — the publishing tables were created manually or by a prior run.
This file exists so Alembic can resolve the revision chain.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'fad4be7d80f8'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Tables were already created by a prior run — this stub resolves the chain.
    # Chain verified clean: b7c8d9e0f1a2 → fad4be7d80f8 → c1d2e3f4a5b6 (single head).
    # Alembic reports exactly 1 head (c1d2e3f4a5b6); stub is intentionally kept in place.
    pass


def downgrade() -> None:
    pass
