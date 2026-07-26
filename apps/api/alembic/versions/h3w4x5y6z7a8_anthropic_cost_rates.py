"""anthropic cost_rates seed

Revision ID: h3w4x5y6z7a8
Revises: g2v3w4x5y6z7
"""
from alembic import op

revision = "h3w4x5y6z7a8"
down_revision = "g2v3w4x5y6z7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Anthropic rates (micro-dollars per unit). VERIFY vs live pricing.
    # claude-haiku-4-5-20251001 $1/$5 per 1M   -> 1.0 / 5.0 micro-$ per token.
    # claude-opus-4-8           $5/$25 per 1M  -> 5.0 / 25.0 micro-$ per token.
    # Anthropic cache-read is priced at 0.1x the input rate for both models.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('anthropic','input_token','claude-haiku-4-5-20251001',1.0),
          ('anthropic','output_token','claude-haiku-4-5-20251001',5.0),
          ('anthropic','cache_read_token','claude-haiku-4-5-20251001',0.1),
          ('anthropic','input_token','claude-opus-4-8',5.0),
          ('anthropic','output_token','claude-opus-4-8',25.0),
          ('anthropic','cache_read_token','claude-opus-4-8',0.5)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM cost_rates
        WHERE provider = 'anthropic'
          AND model IN ('claude-haiku-4-5-20251001', 'claude-opus-4-8')
    """)
