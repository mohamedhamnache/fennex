"""add_article_word_count_target

Revision ID: fad4be7d80f8
Revises: b7c8d9e0f1a2
Create Date: 2026-06-26 13:33:00.066242

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fad4be7d80f8'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('articles', sa.Column('word_count_target', sa.Integer(), nullable=False, server_default='1500'))


def downgrade() -> None:
    op.drop_column('articles', 'word_count_target')
