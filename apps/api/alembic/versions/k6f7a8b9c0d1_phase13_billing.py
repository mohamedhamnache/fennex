"""Phase 13: billing tables and columns

Revision ID: k6f7a8b9c0d1
Revises: j5e6f7a8b9c0d1e2
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "k6f7a8b9c0d1"
down_revision = "j5e6f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # org_usage — monthly counters per resource
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS org_usage (
            org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            period_start    DATE NOT NULL,
            articles_used   INT NOT NULL DEFAULT 0,
            images_used     INT NOT NULL DEFAULT 0,
            social_used     INT NOT NULL DEFAULT 0,
            keywords_used   INT NOT NULL DEFAULT 0,
            audits_used     INT NOT NULL DEFAULT 0,
            backlinks_used  INT NOT NULL DEFAULT 0,
            PRIMARY KEY (org_id, period_start)
        );
    """))

    # subscription_events — Stripe webhook audit log
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS subscription_events (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id          UUID REFERENCES organizations(id) ON DELETE SET NULL,
            stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
            event_type      VARCHAR(100) NOT NULL,
            payload         JSONB NOT NULL,
            processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_sub_events_org_id ON subscription_events (org_id);"
    ))

    # organizations — billing columns
    op.execute(sa.text(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;"
    ))
    op.execute(sa.text(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan_locked_at TIMESTAMPTZ;"
    ))

    # projects — lock columns
    op.execute(sa.text(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;"
    ))
    op.execute(sa.text(
        "ALTER TABLE projects ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50);"
    ))

    # brand_voices — lock columns
    op.execute(sa.text(
        "ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;"
    ))
    op.execute(sa.text(
        "ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50);"
    ))

    # users — lock columns
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;"
    ))
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_reason VARCHAR(50);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS subscription_events CASCADE;"))
    op.execute(sa.text("DROP TABLE IF EXISTS org_usage CASCADE;"))
    op.execute(sa.text("ALTER TABLE organizations DROP COLUMN IF EXISTS trial_ends_at;"))
    op.execute(sa.text("ALTER TABLE organizations DROP COLUMN IF EXISTS plan_locked_at;"))
    op.execute(sa.text("ALTER TABLE projects DROP COLUMN IF EXISTS locked;"))
    op.execute(sa.text("ALTER TABLE projects DROP COLUMN IF EXISTS locked_reason;"))
    op.execute(sa.text("ALTER TABLE brand_voices DROP COLUMN IF EXISTS locked;"))
    op.execute(sa.text("ALTER TABLE brand_voices DROP COLUMN IF EXISTS locked_reason;"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS locked;"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS locked_reason;"))
