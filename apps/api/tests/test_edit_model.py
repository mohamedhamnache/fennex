import pytest
from sqlalchemy import text
from app.core.database import engine


async def test_generated_image_has_source_image_id_column():
    async with engine.connect() as conn:
        result = await conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'generated_images' "
            "AND column_name IN ('source_image_id', 'edit_operation')"
        ))
        cols = {row[0] for row in result}
    assert "source_image_id" in cols
    assert "edit_operation" in cols
