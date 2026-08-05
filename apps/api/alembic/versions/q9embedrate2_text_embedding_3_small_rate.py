"""cost_rate for text-embedding-3-small

Knowledge ingest and knowledge search both call OpenAI embeddings, and the
model had no rate row -- so even once the call is metered it would price to
zero. Seeded in the same change that starts metering it, per the standing rule
that a model is never added or swapped without its rate.

$0.02 per 1M tokens -> 0.02 micro-$ per token. Embeddings bill input only;
there is no output_token or cache rate to seed.

Revision ID: q9embedrate2
Revises: b3e48d6197c7
"""
from alembic import op

revision = "q9embedrate2"
down_revision = "b3e48d6197c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('openai','input_token','text-embedding-3-small',0.02)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute(
        "DELETE FROM cost_rates WHERE provider='openai' "
        "AND model='text-embedding-3-small' AND unit='input_token'"
    )
