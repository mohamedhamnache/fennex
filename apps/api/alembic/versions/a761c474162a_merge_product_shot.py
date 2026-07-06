"""merge product_shot

Revision ID: a761c474162a
Revises: 70d4ac38863b, n2b3c4d5e6f7
Create Date: 2026-07-01 22:58:31.213694

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a761c474162a'
down_revision: Union[str, None] = ('70d4ac38863b', 'n2b3c4d5e6f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
