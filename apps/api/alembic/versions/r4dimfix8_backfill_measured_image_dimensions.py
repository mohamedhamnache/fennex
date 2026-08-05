"""Backfill generated_images width/height from the stored bytes

21.4% of measurable rows (36 of 168 at the time of writing) recorded the
REQUESTED size rather than the one the model returned, or a hardcoded literal
where the result carried no size at all. See the chokepoint in
app/models/image.py, which stops new rows being written that way.

Done in Python rather than SQL because the truth is inside a base64 PNG header,
which Postgres cannot read. Only data-URI rows can be corrected; rows pointing
at a remote URL are left alone rather than fetched, since a migration must not
depend on the network.

Revision ID: r4dimfix8
Revises: q9embedrate2
"""
import base64
import io

from alembic import op
import sqlalchemy as sa

revision = "r4dimfix8"
down_revision = "q9embedrate2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from PIL import Image

    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT id, width, height, image_url FROM generated_images "
        "WHERE image_url LIKE 'data:%'"
    )).fetchall()

    fixed = 0
    for row_id, width, height, url in rows:
        try:
            raw = base64.b64decode(url.split(",", 1)[1])
            # Header parse only -- never decodes pixel data.
            actual_w, actual_h = Image.open(io.BytesIO(raw)).size
        except Exception:
            continue
        if (actual_w, actual_h) == (width, height) or actual_w <= 0 or actual_h <= 0:
            continue
        conn.execute(
            sa.text("UPDATE generated_images SET width = :w, height = :h WHERE id = :i"),
            {"w": actual_w, "h": actual_h, "i": row_id},
        )
        fixed += 1
    print(f"backfilled measured dimensions on {fixed} of {len(rows)} data-URI images")


def downgrade() -> None:
    # Irreversible by design: the previous values were wrong, and they were not
    # recorded anywhere before being overwritten. Restoring them would mean
    # deliberately reinstating incorrect data.
    pass
