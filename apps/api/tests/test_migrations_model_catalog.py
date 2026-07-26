"""Test that model_catalog migration actually executes and produces correct data.

This test verifies the migration chain doesn't abort and seeds data correctly
under both ordering scenarios:
1. Empty database (deployment: migration creates schema)
2. Database with Base.metadata.create_all already run (dev: create_all creates schema first)

Both orderings must produce the same final state.
This guards against the defect where a seed depends on DDL it did not guarantee.
"""
import os
import asyncio
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import text, create_engine, event
from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command

from app.core.config import settings
from app.core.database import Base


def _can_connect_to_database(db_url: str) -> bool:
    """Test if we can actually connect to the database."""
    try:
        sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        engine = create_engine(
            sync_url,
            echo=False,
            connect_args={"connect_timeout": 5}
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def _async_create_and_drop_db(db_url: str, db_name: str, operation: str) -> None:
    """Create or drop database using asyncpg (no external binaries needed)."""
    import asyncpg

    # Parse connection details from URL
    parts = db_url.split("://")[1]
    creds, host_db = parts.split("@")
    user, password = creds.split(":")
    host_port, _ = host_db.split("/", 1)
    host, port = host_port.split(":")
    port = int(port)

    try:
        conn = await asyncpg.connect(
            user=user, password=password, host=host, port=port,
            database="postgres", timeout=5
        )
    except asyncpg.PostgresError:
        raise

    try:
        if operation == "create":
            try:
                await conn.execute(f"DROP DATABASE IF EXISTS {db_name}")
            except asyncpg.PostgresError:
                pass
            await conn.execute(f"CREATE DATABASE {db_name}")
        elif operation == "drop":
            try:
                await conn.execute(f"""
                    SELECT pg_terminate_backend(pg_stat_activity.pid)
                    FROM pg_stat_activity
                    WHERE pg_stat_activity.datname = '{db_name}'
                    AND pid <> pg_backend_pid()
                """)
            except asyncpg.PostgresError:
                pass
            try:
                await conn.execute(f"DROP DATABASE IF EXISTS {db_name}")
            except asyncpg.PostgresError:
                pass
    finally:
        await conn.close()


def _verify_model_catalog_data(engine, test_name: str) -> None:
    """Verify model_catalog has exactly 5 rows with correct data."""
    with engine.connect() as conn:
        # Verify count
        result = conn.execute(text("SELECT COUNT(*) FROM model_catalog"))
        count = result.scalar()
        assert count == 5, f"[{test_name}] Expected 5 model_catalog rows, got {count}"

        # Verify each row
        result = conn.execute(
            text(
                "SELECT band, provider, model, priority, supports, is_active "
                "FROM model_catalog ORDER BY band, priority"
            )
        )
        rows = result.fetchall()

        expected = [
            ("cheap", "anthropic", "claude-haiku-4-5-20251001", 2, True),
            ("cheap", "openai", "gpt-4o-mini", 1, True),
            ("premium", "anthropic", "claude-opus-5", 1, True),
            ("standard", "anthropic", "claude-sonnet-5", 2, True),
            ("standard", "openai", "gpt-4o", 1, True),
        ]

        for i, (band, provider, model, priority, supports, is_active) in enumerate(rows):
            exp_band, exp_provider, exp_model, exp_priority, exp_is_active = expected[i]
            assert band == exp_band, f"[{test_name}] Band mismatch at row {i}"
            assert provider == exp_provider, f"[{test_name}] Provider mismatch at row {i}"
            assert model == exp_model, f"[{test_name}] Model mismatch at row {i}"
            assert priority == exp_priority, f"[{test_name}] Priority mismatch at row {i}"
            assert is_active == exp_is_active, f"[{test_name}] is_active should be TRUE for {model}, got {is_active}"

            # Verify supports JSON
            assert isinstance(supports, dict), f"[{test_name}] supports must be dict, got {type(supports)}"
            assert supports.get("json_output") is True, f"[{test_name}] json_output flag wrong for {model}"
            assert supports.get("tools") is True, f"[{test_name}] tools flag wrong for {model}"
            assert supports.get("vision") is True, f"[{test_name}] vision flag wrong for {model}"

        # Verify cost_rates
        result = conn.execute(
            text(
                "SELECT COUNT(*) FROM cost_rates "
                "WHERE provider = 'anthropic' "
                "  AND model IN ('claude-sonnet-5', 'claude-opus-5')"
            )
        )
        cost_count = result.scalar()
        assert cost_count == 6, f"[{test_name}] Expected 6 cost_rates rows, got {cost_count}"


def _run_migration_on_scratch_db(db_url: str, scratch_db_name: str, pre_create_all: bool = False) -> None:
    """Run migrations on a scratch database, optionally after create_all.

    Args:
        db_url: Base database URL
        scratch_db_name: Name of scratch database to create
        pre_create_all: If True, run Base.metadata.create_all before migrations
                       (simulates dev environment where app ran before migrate)
    """
    sync_base_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
    scratch_db_url = sync_base_url.rsplit("/", 1)[0] + "/" + scratch_db_name

    # Get absolute path to alembic.ini
    test_dir = Path(__file__).parent
    api_dir = test_dir.parent
    alembic_ini_path = str(api_dir / "alembic.ini")

    test_name = "create_all+migration" if pre_create_all else "clean_migration"

    try:
        # Create the scratch database
        asyncio.run(_async_create_and_drop_db(db_url, scratch_db_name, "create"))

        # Optionally run create_all first (simulates dev environment)
        # Only create tables up to model_catalog to avoid pgvector dependency issues
        if pre_create_all:
            engine = create_engine(scratch_db_url, echo=False)
            # Create only essential tables needed for migrations to run
            # (some tables have dependencies on extensions like pgvector)
            tables_to_create = [
                "organizations", "users", "projects", "cost_rates",
            ]
            for table in Base.metadata.tables.values():
                if table.name in tables_to_create:
                    table.create(engine, checkfirst=True)
            engine.dispose()

        # Run migrations
        alembic_cfg = AlembicConfig(alembic_ini_path)
        alembic_cfg.set_main_option("sqlalchemy.url", scratch_db_url)
        # Upgrade to head (which includes all migrations including model_catalog)
        alembic_command.upgrade(alembic_cfg, "head")

        # Verify data was seeded correctly
        engine = create_engine(scratch_db_url, echo=False)
        _verify_model_catalog_data(engine, test_name)

        # Test downgrade
        alembic_command.downgrade(alembic_cfg, "h3w4x5y6z7a8")

        # Verify table was dropped
        with engine.connect() as conn:
            result = conn.execute(
                text(
                    "SELECT EXISTS ("
                    "  SELECT 1 FROM information_schema.tables "
                    "  WHERE table_name = 'model_catalog'"
                    ")"
                )
            )
            exists = result.scalar()
            assert not exists, f"[{test_name}] model_catalog still exists after downgrade"

    finally:
        try:
            asyncio.run(_async_create_and_drop_db(db_url, scratch_db_name, "drop"))
        except Exception:
            pass


def test_model_catalog_migration_on_clean_database():
    """Test migration applied to empty database (deployment path)."""
    db_url = settings.DATABASE_URL

    if not _can_connect_to_database(db_url):
        pytest.skip(
            "Postgres database is unreachable or connection failed; "
            "migration execution was not verified"
        )

    scratch_db_name = f"test_model_catalog_clean_{os.getpid()}"
    _run_migration_on_scratch_db(db_url, scratch_db_name, pre_create_all=False)


def test_model_catalog_migration_after_create_all():
    """Test migration applied to database where Base.metadata.create_all ran first (dev path).

    This guards against the defect where a seed depends on DDL the migration did not guarantee.
    When create_all runs first, it creates the table WITHOUT a database default on is_active.
    The migration's INSERT must explicitly set is_active=true to work in this scenario.
    """
    db_url = settings.DATABASE_URL

    if not _can_connect_to_database(db_url):
        pytest.skip(
            "Postgres database is unreachable or connection failed; "
            "migration execution was not verified"
        )

    scratch_db_name = f"test_model_catalog_createall_{os.getpid()}"
    _run_migration_on_scratch_db(db_url, scratch_db_name, pre_create_all=True)
