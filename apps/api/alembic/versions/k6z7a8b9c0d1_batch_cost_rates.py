"""batch_* cost_rates units at 0.5x for every catalogued model

Revision ID: k6z7a8b9c0d1
Revises: j5y6z7a8b9c0
"""
from alembic import op

revision = "k6z7a8b9c0d1"
down_revision = "j5y6z7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Batch is 50% off. Modelling it as its own unit (rather than a multiplier in
    # the meter) keeps the versioned-rate design: a discount change is a data change.
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('openai','batch_input_token','gpt-4o-mini',0.075),
          ('openai','batch_output_token','gpt-4o-mini',0.30),
          ('openai','batch_cache_read_token','gpt-4o-mini',0.0375),
          ('openai','batch_input_token','gpt-4o',1.25),
          ('openai','batch_output_token','gpt-4o',5.0),
          ('openai','batch_cache_read_token','gpt-4o',0.625),
          ('anthropic','batch_input_token','claude-haiku-4-5-20251001',0.5),
          ('anthropic','batch_output_token','claude-haiku-4-5-20251001',2.5),
          ('anthropic','batch_cache_read_token','claude-haiku-4-5-20251001',0.05),
          ('anthropic','batch_input_token','claude-sonnet-5',1.5),
          ('anthropic','batch_output_token','claude-sonnet-5',7.5),
          ('anthropic','batch_cache_read_token','claude-sonnet-5',0.15),
          ('anthropic','batch_input_token','claude-opus-5',2.5),
          ('anthropic','batch_output_token','claude-opus-5',12.5),
          ('anthropic','batch_cache_read_token','claude-opus-5',0.25)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM cost_rates WHERE unit LIKE 'batch\\_%'")
