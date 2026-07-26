"""model_catalog table, band seed, and cost_rates for the new Anthropic models

Revision ID: i4x5y6z7a8b9
Revises: h3w4x5y6z7a8
"""
from alembic import op

revision = "i4x5y6z7a8b9"
down_revision = "h3w4x5y6z7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS model_catalog (
            band VARCHAR(20) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            model VARCHAR(80) NOT NULL,
            priority INTEGER NOT NULL DEFAULT 100,
            supports JSONB NOT NULL DEFAULT '{}'::jsonb,
            is_active BOOLEAN NOT NULL DEFAULT true,
            PRIMARY KEY (band, provider, model)
        )
    """)
    # Bands are capability tiers, not fixed models. OpenAI is the launch primary;
    # Anthropic rows are the fallbacks. Premium is Anthropic-only until an
    # OpenAI flagship reasoning model id and price are confirmed -- seeding an
    # unpriced model would silently bill it at $0.
    # Use jsonb_build_object() to avoid SQLAlchemy text() bind parameter collision on `:true`.
    # Explicitly set is_active=true to work with both migrated and create_all-created schemas.
    op.execute("""
        INSERT INTO model_catalog (band, provider, model, priority, supports, is_active) VALUES
          ('cheap','openai','gpt-4o-mini',1,jsonb_build_object('json_output', true, 'tools', true, 'vision', true),true),
          ('cheap','anthropic','claude-haiku-4-5-20251001',2,jsonb_build_object('json_output', true, 'tools', true, 'vision', true),true),
          ('standard','openai','gpt-4o',1,jsonb_build_object('json_output', true, 'tools', true, 'vision', true),true),
          ('standard','anthropic','claude-sonnet-5',2,jsonb_build_object('json_output', true, 'tools', true, 'vision', true),true),
          ('premium','anthropic','claude-opus-5',1,jsonb_build_object('json_output', true, 'tools', true, 'vision', true),true)
        ON CONFLICT (band, provider, model) DO NOTHING
    """)
    # Every catalogued model must be priced. claude-sonnet-5 $3/$15 per 1M,
    # claude-opus-5 $5/$25 per 1M, cache reads ~0.1x of input.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('anthropic','input_token','claude-sonnet-5',3.0),
          ('anthropic','output_token','claude-sonnet-5',15.0),
          ('anthropic','cache_read_token','claude-sonnet-5',0.3),
          ('anthropic','input_token','claude-opus-5',5.0),
          ('anthropic','output_token','claude-opus-5',25.0),
          ('anthropic','cache_read_token','claude-opus-5',0.5)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM cost_rates
        WHERE provider = 'anthropic' AND model IN ('claude-sonnet-5', 'claude-opus-5')
    """)
    op.execute("DROP TABLE IF EXISTS model_catalog")
