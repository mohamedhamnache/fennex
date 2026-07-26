"""usage_events + org_usage raw columns

Revision ID: g2v3w4x5y6z7
Revises: f1u2v3w4x5y6
"""
from alembic import op

revision = "g2v3w4x5y6z7"
down_revision = "f1u2v3w4x5y6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS usage_events (
            id BIGSERIAL PRIMARY KEY,
            org_id UUID NOT NULL,
            project_id UUID,
            ts TIMESTAMPTZ NOT NULL DEFAULT now(),
            kind VARCHAR(10) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            model VARCHAR(80),
            feature VARCHAR(60),
            input_tokens BIGINT NOT NULL DEFAULT 0,
            output_tokens BIGINT NOT NULL DEFAULT 0,
            cache_read_tokens BIGINT NOT NULL DEFAULT 0,
            seo_unit VARCHAR(30),
            seo_count INTEGER NOT NULL DEFAULT 0,
            cost_micros BIGINT NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_usage_events_org_ts ON usage_events (org_id, ts)")
    for col in ("ai_input_tokens", "ai_output_tokens", "ai_requests",
                "seo_serp", "seo_keyword_analyses", "cost_micros"):
        op.execute(f"ALTER TABLE org_usage ADD COLUMN IF NOT EXISTS {col} BIGINT NOT NULL DEFAULT 0")


def downgrade() -> None:
    for col in ("ai_input_tokens", "ai_output_tokens", "ai_requests",
                "seo_serp", "seo_keyword_analyses", "cost_micros"):
        op.execute(f"ALTER TABLE org_usage DROP COLUMN IF EXISTS {col}")
    op.execute("DROP TABLE IF EXISTS usage_events")
