"""cost_rates: seed per-second rates for LaMa and lang-segment-anything

Revision ID: s4lamasam9
Revises: r7removebg3

Two Replicate models are wired up (or about to be, on the concurrent
mirage-auto-masking / image-op-quality branches) with no cost_rates row of
their own:

  1. allenhooo/lama -- reconstructive object-removal / smart-erase inpainting
     (docs/superpowers/plans/2026-07-30-image-op-quality.md Task 2, wired
     through app/services/editing_service.py::_replicate_run with a pinned
     version). Small, fast, non-generative.
  2. tmappdev/lang-segment-anything -- prompted-tier mask segmentation
     (app/services/mask_service.py::_SEGMENTER_MODEL).

WHY A PER-SECOND ROW, NOT A PER-RUN ROW:
  Every caller of these two models goes through
  editing_service.py::_replicate_run, which always passes
  `predict_seconds=status_data["metrics"]["predict_time"]` into
  meter.record_replicate (see the "Best-effort metering" block there).
  record_replicate's own priority order (read before writing this):

      per_second = rate('replicate','second',model) or rate('replicate','second','')
      if per_second: cost = predict_seconds * per_second
      else: cost = rate('replicate','run',model) or rate('replicate','run','') or 0

  A generic `replicate/second/''` row already exists (z7persecond4, 1400
  micro-$/sec, Nvidia A100 80GB) and is truthy, so the per-second branch is
  taken on essentially every real call these models make -- a per-run row
  for either model would almost never be consulted, exactly like
  h4trellisrate6's per-run row for firtoz/trellis became moot the moment
  z7persecond4 landed. Seeding a per-run row here would be dead weight, not
  a safety net; the per-second rate is the one that actually needs fixing.
  No per-run row is seeded for either model.

  Today, absent this migration, BOTH models silently resolve to the generic
  A100 rate (1400 micro-$/sec) via that fallback -- correct for
  lang-segment-anything by coincidence (see below), materially wrong for
  LaMa, which runs on much cheaper hardware.

RESEARCH (retrieved 2026-07-30), two independent sources per model:
  (a) Replicate model page (https://replicate.com/<owner>/<name>), fetched
      directly, which states the model's hardware tier and a published
      list price.
  (b) GET https://api.replicate.com/v1/models/<owner>/<name> (Replicate API,
      REPLICATE_API_KEY), whose `default_example.metrics.predict_time` gives
      a real observed run duration to sanity-check (a) against the hardware
      per-second rates already researched and used in this codebase
      (w3repricing7: T4 $0.000225/s, A100 80GB $0.001400/s).

  allenhooo/lama:
    Page: "This model runs on Nvidia T4 GPU hardware" / "costs approximately
    $0.00061 to run ... predictions typically complete within 3 seconds."
    API: default_example.metrics.predict_time = 4.275178s.
    T4 rate (w3repricing7) is 225 micro-$/sec: 4.275s x 225 = ~$0.00096,
    3s x 225 = $0.000675 -- both in the right neighbourhood of the
    published $0.00061 given run-to-run variance. Hardware (T4) agrees
    across both sources.

  tmappdev/lang-segment-anything:
    Page: "The model runs on Nvidia A100 (80GB) GPU hardware" / "$0.0014 per
    execution ... typically finish in about 1 second."
    API: default_example.metrics.predict_time = 2.236687529s.
    A100 80GB rate is 1400 micro-$/sec: 1s x 1400 = $0.0014, matching the
    page exactly; 2.24s would be ~$0.0031, still consistent with "roughly
    $0.0014-ish per execution" framing on the page and the observed spread
    in example runs. Hardware (A100 80GB) agrees across both sources.

CONFIDENCE:
  HIGH for both. Each rate traces to Replicate's own published per-model
  hardware/price (not a generic default) and is cross-checked against a
  real predict_time from Replicate's API against the same hardware
  per-second table already vetted and in production use via w3repricing7 /
  z7persecond4. Neither figure is padded: cost_micros drives both margin
  reporting and what the customer is billed (AI credits derive from cost),
  so over-estimating an unknown rate is not "safe," it overcharges.

  lang-segment-anything's seeded rate (1400) happens to equal the current
  generic replicate/second/'' fallback -- seeding it explicitly is still
  correct: it makes the choice deliberate and pins it against the generic
  default ever being repriced for a different reference GPU later, rather
  than leaving a real cost keyed off a rate nobody actually chose for this
  model.

TO CORRECT: reconcile against Replicate's billing dashboard once there is
real production volume, then insert ANOTHER versioned row at a later
effective_from -- never UPDATE either of these rows, that destroys the
audit trail of what was charged when (see h4trellisrate6 / r7removebg3 /
w3repricing7 for the same rule).
"""
from alembic import op

revision = "s4lamasam9"
down_revision = "r7removebg3"
branch_labels = None
depends_on = None

# Fixed, deterministic effective_from -- strictly later than r7removebg3 --
# so this migration is reproducible and testable rather than depending on
# wall-clock apply time.
_EFFECTIVE_FROM = "2026-07-30 12:00:00+00"

_RATES = {
    "allenhooo/lama": 225,
    "tmappdev/lang-segment-anything": 1_400,
}


def upgrade() -> None:
    for model, micros in _RATES.items():
        op.execute(
            "INSERT INTO cost_rates (provider, unit, model, effective_from, micro_dollars_per_unit) "
            "VALUES ('replicate', 'second', '%s', '%s', %d) ON CONFLICT DO NOTHING"
            % (model, _EFFECTIVE_FROM, micros)
        )


def downgrade() -> None:
    for model in _RATES:
        op.execute(
            "DELETE FROM cost_rates WHERE provider = 'replicate' AND unit = 'second' "
            "AND model = '%s' AND effective_from = '%s'" % (model, _EFFECTIVE_FROM)
        )
