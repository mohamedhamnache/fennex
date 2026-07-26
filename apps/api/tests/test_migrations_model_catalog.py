"""Test that model_catalog migration actually executes and produces correct data.

This test verifies the migration chain doesn't abort and seeds data correctly.
It requires Postgres to be available; skips cleanly if not.
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

import pytest


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="Requires DATABASE_URL to test migrations; set to test against Postgres"
)
def test_model_catalog_migration_upgrade_and_downgrade():
    """Test that the migration chain (including model_catalog) applies without errors."""
    # Get the test database URL from environment, or skip
    db_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        pytest.skip("DATABASE_URL or TEST_DATABASE_URL not set; skipping migration test")

    # Create a fresh disposable database for this test
    with tempfile.TemporaryDirectory() as tmpdir:
        scratch_db_name = f"test_model_catalog_migration_{os.getpid()}"

        # For local Postgres testing, create/drop a test DB
        # This test assumes a local Postgres with appropriate permissions
        # Production CI should set TEST_DATABASE_URL to a disposable instance

        try:
            # Create scratch database
            result = subprocess.run(
                ["createdb", scratch_db_name],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0 and "already exists" not in result.stderr:
                pytest.skip(f"Could not create test database: {result.stderr}")

            # Replace database name in connection URL
            parts = db_url.split("/")
            scratch_db_url = "/".join(parts[:-1]) + "/" + scratch_db_name

            # Run migrations up to head
            env = os.environ.copy()
            env["DATABASE_URL"] = scratch_db_url
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
            import sqlalchemy as sa
            from sqlalchemy import text

            engine = sa.create_engine(scratch_db_url)
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
                        "FROM model_catalog ORDER BY priority, model"
                    )
                )
                rows = result.fetchall()

                expected = [
                    ("cheap", "openai", "gpt-4o-mini", 1),
                    ("cheap", "anthropic", "claude-haiku-4-5-20251001", 2),
                    ("standard", "openai", "gpt-4o", 1),
                    ("standard", "anthropic", "claude-sonnet-5", 2),
                    ("premium", "anthropic", "claude-opus-5", 1),
                ]

                for i, (band, provider, model, priority, supports) in enumerate(rows):
                    exp_band, exp_provider, exp_model, exp_priority = expected[i]
                    assert band == exp_band
                    assert provider == exp_provider
                    assert model == exp_model
                    assert priority == exp_priority

                    # Verify supports is a dict with boolean values
                    assert isinstance(supports, dict), f"supports must be dict, got {type(supports)}"
                    assert supports.get("json_output") is True
                    assert supports.get("tools") is True
                    assert supports.get("vision") is True

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
                ["dropdb", scratch_db_name],
                capture_output=True,
                timeout=10,
            )
