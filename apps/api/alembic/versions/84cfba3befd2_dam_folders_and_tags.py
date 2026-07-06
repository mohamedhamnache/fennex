"""dam_folders_and_tags

Revision ID: 84cfba3befd2
Revises: o3c4d5e6f7g8
Create Date: 2026-07-02 07:39:52.419119

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '84cfba3befd2'
down_revision: Union[str, None] = 'o3c4d5e6f7g8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # image_folders may already exist if the table was pre-created outside Alembic
    result = conn.execute(sa.text("SELECT to_regclass('public.image_folders')"))
    if result.scalar() is None:
        op.create_table(
            'image_folders',
            sa.Column('id', sa.UUID(), nullable=False),
            sa.Column('org_id', sa.UUID(), nullable=False),
            sa.Column('name', sa.String(200), nullable=False),
            sa.Column('parent_id', sa.UUID(), nullable=True),
            sa.Column('color', sa.String(7), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
            sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['parent_id'], ['image_folders.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )

    # Add columns only if they don't exist yet
    cols = {row[0] for row in conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns WHERE table_name='generated_images'"
    ))}
    if 'folder_id' not in cols:
        op.add_column('generated_images', sa.Column('folder_id', sa.UUID(), nullable=True))
        op.create_foreign_key(None, 'generated_images', 'image_folders', ['folder_id'], ['id'], ondelete='SET NULL')
    if 'tags' not in cols:
        op.add_column('generated_images', sa.Column('tags', sa.JSON(), server_default='[]', nullable=False))
    if 'is_deleted' not in cols:
        op.add_column('generated_images', sa.Column('is_deleted', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_constraint(None, 'generated_images', type_='foreignkey')
    op.drop_column('generated_images', 'is_deleted')
    op.drop_column('generated_images', 'tags')
    op.drop_column('generated_images', 'folder_id')
    op.drop_table('image_folders')
