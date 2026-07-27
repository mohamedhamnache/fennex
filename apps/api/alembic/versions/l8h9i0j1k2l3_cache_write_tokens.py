"""cache_write_tokens column + cache_write_token / batch_cache_write_token
cost_rate seeds for every model in the routing catalog

Anthropic bills a cache write (writing a new prompt-cache entry) at roughly
1.25x the model's input-token rate, in addition to input/output/cache-read.
Prior to this migration that token count was captured nowhere -- prompt
caching billed real provider cost at $0.

Revision ID: l8h9i0j1k2l3
Revises: k6z7a8b9c0d1
"""
from alembic import op

revision = "l8h9i0j1k2l3"
down_revision = "k6z7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS "
        "cache_write_tokens BIGINT NOT NULL DEFAULT 0"
    )

    # cache_write_token = 1.25x the model's input rate (Anthropic's cache-write
    # premium); batch_cache_write_token = half of that (the batch API's usual
    # 50% discount, same as every other batch_* unit). Every model currently in
    # app/services/providers/catalog.py's SEED is priced so no model silently
    # prices cache writes to $0 -- OpenAI rows are seeded too even though
    # LLMUsage.cache_write_tokens is only ever populated for Anthropic today,
    # for the same "every catalogued model is priced" reason batch_cost_rates
    # priced every model rather than only the ones with a batch path.
    #
    # Arithmetic (input rate -> cache_write_token -> batch_cache_write_token):
    #   openai/gpt-4o-mini            0.15 -> 0.1875  -> 0.09375
    #   openai/gpt-4o                 2.5  -> 3.125   -> 1.5625
    #   anthropic/claude-haiku-4-5... 1.0  -> 1.25    -> 0.625
    #   anthropic/claude-sonnet-5     3.0  -> 3.75    -> 1.875
    #   anthropic/claude-opus-5       5.0  -> 6.25    -> 3.125
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('openai','cache_write_token','gpt-4o-mini',0.1875),
          ('openai','batch_cache_write_token','gpt-4o-mini',0.09375),
          ('openai','cache_write_token','gpt-4o',3.125),
          ('openai','batch_cache_write_token','gpt-4o',1.5625),
          ('anthropic','cache_write_token','claude-haiku-4-5-20251001',1.25),
          ('anthropic','batch_cache_write_token','claude-haiku-4-5-20251001',0.625),
          ('anthropic','cache_write_token','claude-sonnet-5',3.75),
          ('anthropic','batch_cache_write_token','claude-sonnet-5',1.875),
          ('anthropic','cache_write_token','claude-opus-5',6.25),
          ('anthropic','batch_cache_write_token','claude-opus-5',3.125)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM cost_rates
        WHERE unit IN ('cache_write_token', 'batch_cache_write_token')
    """)
    op.execute("ALTER TABLE usage_events DROP COLUMN IF EXISTS cache_write_tokens")
