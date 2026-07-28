"""cost_rates: missing dataforseo units + replicate default/model rates

Revision ID: s8seorates01
Revises: k4splitcred7

Adds the cost_rates rows that were missing for units the app already meters
but that had no priced rate (so they were silently pricing to $0):
dataforseo rank_check/backlinks/audit, and replicate run (default + the
image-editing model slugs from app/services/editing_service.py).

UNCONFIRMED PLACEHOLDERS -- these values are defensible estimates, not
supplier-confirmed prices. They must be corrected once real DataForSEO /
Replicate pricing is confirmed by the product owner:
  * dataforseo/rank_check: 1500 micro-$ (mirrors 'serp' -- rank_check is
    implemented as a SERP task, see app/services/rank_tracking_service.py).
  * dataforseo/backlinks:  3000 micro-$ -- placeholder.
  * dataforseo/audit:      5000 micro-$ -- placeholder.
  * replicate/run (all rows): 5000 micro-$ ($0.005/run) -- placeholder,
    applied uniformly to the default and to every known model slug pending
    real per-model Replicate pricing.
"""
from alembic import op

revision = "s8seorates01"
down_revision = "k4splitcred7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO cost_rates (provider, unit, model, micro_dollars_per_unit) VALUES
          ('dataforseo','rank_check','',1500),
          ('dataforseo','backlinks','',3000),
          ('dataforseo','audit','',5000),
          ('replicate','run','',5000),
          ('replicate','run','black-forest-labs/flux-fill-pro',5000),
          ('replicate','run','stability-ai/stable-diffusion-inpainting',5000),
          ('replicate','run','fal-ai/shadow-generation',5000),
          ('replicate','run','zsxkib/ic-light',5000),
          ('replicate','run','sczhou/codeformer',5000),
          ('replicate','run','nightmareai/real-esrgan',5000)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM cost_rates
        WHERE (provider, unit, model) IN (
          ('dataforseo','rank_check',''),
          ('dataforseo','backlinks',''),
          ('dataforseo','audit',''),
          ('replicate','run',''),
          ('replicate','run','black-forest-labs/flux-fill-pro'),
          ('replicate','run','stability-ai/stable-diffusion-inpainting'),
          ('replicate','run','fal-ai/shadow-generation'),
          ('replicate','run','zsxkib/ic-light'),
          ('replicate','run','sczhou/codeformer'),
          ('replicate','run','nightmareai/real-esrgan')
        )
    """)
