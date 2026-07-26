"""Test that model_catalog migration actually executes and produces correct data.

This test verifies the migration chain doesn't abort and seeds data correctly.
It requires a reachable Postgres database; skips if unreachable (e.g., in CI without DB).
"""
import os
import subprocess

import pytest
import sqlalchemy as sa
from sqlalchemy import text, create_engine

from app.core.config import settings


def _can_connect_to_database(db_url: str) -> bool:
    """Test if we can actually connect to the database."""
    try:
        # Use sync engine (non-async) for connection test
        sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        engine = create_engine(
            sync_url,
            echo=False,
            connect_args={"connect_timeout": 5}  # psycopg2 parameter
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def test_model_catalog_migration_upgrade_and_downgrade():
    """Test that the migration chain (including model_catalog) applies without errors.

    This test executes the actual Alembic migration against a scratch database,
    verifies the data is seeded correctly with proper JSON structure, and tests
    the downgrade chain. It is a regression guard for migration syntax errors
    (like the original SQLAlchemy text() bind parameter collision with `:true`).

    Skips only if Postgres is genuinely unreachable; skipping is reported
    explicitly so it cannot be mistaken for a passing test.
    """
    # Get database URL from Settings (same way the app loads it from .env)
    db_url = settings.DATABASE_URL

    # Test if Postgres is actually reachable
    if not _can_connect_to_database(db_url):
        pytest.skip(
            "Postgres database is unreachable or connection failed; "
            "migration execution was not verified"
        )

    # Extract credentials and host from URL for createdb/dropdb commands
    # URL format: postgresql+asyncpg://user:pass@host:port/dbname
    # For createdb we need sync URL: postgresql://user:pass@host:port/dbname
    sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    # Parse connection details
    from urllib.parse import urlparse
    parsed = urlparse(sync_url)
    db_host = parsed.hostname or "localhost"
    db_port = parsed.port or 5432
    db_user = parsed.username or "postgres"
    # Note: password is not reliably extractable from URL (may not be needed if .pgpass is configured)

    scratch_db_name = f"test_model_catalog_migration_{os.getpid()}"

    try:
        # Create scratch database
        result = subprocess.run(
            ["createdb", "-h", db_host, "-p", str(db_port), "-U", db_user, scratch_db_name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            if "already exists" not in result.stderr:
                pytest.skip(f"Could not create test database: {result.stderr}")

        # Replace database name in connection URL
        parts = sync_url.rsplit("/", 1)
        scratch_db_url = parts[0] + "/" + scratch_db_name

        # Run migrations up to head
        env = os.environ.copy()
        env["DATABASE_URL"] = scratch_db_url.replace("postgresql://", "postgresql+asyncpg://")
        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            cwd=".",
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        if result.returncode != 0:
            pytest.fail(
                f"Migration upgrade failed: {result.stderr}\n{result.stdout}"
            )

        # Connect and verify data
        engine = create_engine(scratch_db_url)
        with engine.connect() as conn:
            # Verify model_catalog has exactly 5 rows
            result = conn.execute(
                text("SELECT COUNT(*) FROM model_catalog")
            )
            count = result.scalar()
            assert count == 5, f"Expected 5 model_catalog rows, got {count}"

            # Verify each row has correct supports JSON with boolean values
            result = conn.execute(
                text(
                    "SELECT band, provider, model, priority, supports "
                    "FROM model_catalog ORDER BY band, priority"
                )
            )
            rows = result.fetchall()

            expected = [
                ("cheap", "anthropic", "claude-haiku-4-5-20251001", 2),
                ("cheap", "openai", "gpt-4o-mini", 1),
                ("premium", "anthropic", "claude-opus-5", 1),
                ("standard", "anthropic", "claude-sonnet-5", 2),
                ("standard", "openai", "gpt-4o", 1),
            ]

            for i, (band, provider, model, priority, supports) in enumerate(rows):
                exp_band, exp_provider, exp_model, exp_priority = expected[i]
                assert band == exp_band, f"Band mismatch at row {i}"
                assert provider == exp_provider, f"Provider mismatch at row {i}"
                assert model == exp_model, f"Model mismatch at row {i}"
                assert priority == exp_priority, f"Priority mismatch at row {i}"

                # Verify supports is a dict with boolean values
                assert isinstance(supports, dict), f"supports must be dict, got {type(supports)}"
                assert supports.get("json_output") is True, f"json_output flag wrong for {model}"
                assert supports.get("tools") is True, f"tools flag wrong for {model}"
                assert supports.get("vision") is True, f"vision flag wrong for {model}"

            # Verify cost_rates have Anthropic entries for claude-sonnet-5 and claude-opus-5
            result = conn.execute(
                text(
                    "SELECT provider, unit, model FROM cost_rates "
                    "WHERE provider = 'anthropic' "
                    "  AND model IN ('claude-sonnet-5', 'claude-opus-5') "
                    "ORDER BY model, unit"
                )
            )
            cost_rows = result.fetchall()
            assert len(cost_rows) == 6, f"Expected 6 cost_rates rows for Anthropic, got {len(cost_rows)}"

            # Verify organizations.premium_models_enabled exists
            result = conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'organizations' "
                    "  AND column_name = 'premium_models_enabled'"
                )
            )
            col = result.scalar()
            assert col is not None, "organizations.premium_models_enabled column missing"

        # Now test downgrade
        result = subprocess.run(
            ["alembic", "downgrade", "h3w4x5y6z7a8"],
            cwd=".",
            capture_output=True,
            text=True,
            timeout=30,
            env=env,
        )
        if result.returncode != 0:
            pytest.fail(
                f"Migration downgrade failed: {result.stderr}\n{result.stdout}"
            )

        # Verify model_catalog was dropped
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
            assert not exists, "model_catalog table still exists after downgrade"

            # Verify cost_rates Anthropic entries were deleted
            result = conn.execute(
                text(
                    "SELECT COUNT(*) FROM cost_rates "
                    "WHERE provider = 'anthropic' "
                    "  AND model IN ('claude-sonnet-5', 'claude-opus-5')"
                )
            )
            count = result.scalar()
            assert count == 0, f"Cost_rates entries not deleted after downgrade, got {count}"

    finally:
        # Clean up scratch database
        subprocess.run(
            ["dropdb", "-h", db_host, "-p", str(db_port), "-U", db_user, scratch_db_name],
            capture_output=True,
            timeout=10,
        )
