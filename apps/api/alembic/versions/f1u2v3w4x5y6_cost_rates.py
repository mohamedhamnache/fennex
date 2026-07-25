"""cost_rates table + seed

Revision ID: f1u2v3w4x5y6
Revises: e0t1u2v3w4x5
"""
from alembic import op

revision = "f1u2v3w4x5y6"
down_revision = "e0t1u2v3w4x5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS cost_rates (
            provider VARCHAR(50) NOT NULL,
            unit VARCHAR(30) NOT NULL,
            model VARCHAR(80) NOT NULL DEFAULT '',
            effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
            micro_dollars_per_unit DOUBLE PRECISION NOT NULL,
            PRIMARY KEY (provider, unit, model, effective_from)
        )
    """)
    # Representative rates (micro-dollars per unit). VERIFY vs live pricing.
    # gpt-4o-mini $0.15/$0.60 per 1M -> 0.15 / 0.60 micro-$ per token.
    # gpt-4o      $2.50/$10.0 per 1M -> 2.5  / 10.0 micro-$ per token.
    # dataforseo  serp ~$0.0015/call -> 1500 micro-$; keyword_ideas ~$0.02 -> 20000.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('openai','input_token','gpt-4o-mini',0.15),
          ('openai','output_token','gpt-4o-mini',0.60),
          ('openai','cache_read_token','gpt-4o-mini',0.075),
          ('openai','input_token','gpt-4o',2.5),
          ('openai','output_token','gpt-4o',10.0),
          ('openai','cache_read_token','gpt-4o',1.25),
          ('dataforseo','serp','',1500),
          ('dataforseo','keyword_ideas','',20000)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS cost_rates")
