"""Feature -> routing policy. One table drives band choice, the output-token
ceiling, and cascade opt-in, so the three cost levers cannot disagree.

Feature keys are the same strings passed to the usage meter, so a per-feature
cost report maps 1:1 onto a policy row. Promoting or demoting a feature's model
is a change here, not a redeploy of any caller (spec 3.4.2).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class FeaturePolicy:
    band: str = "cheap"
    max_output_tokens: int = 1024
    needs_premium: bool = False   # may escalate to premium when the org is entitled
    cascade: bool = False         # cheap-first with a programmatic validator


DEFAULT_POLICY = FeaturePolicy()

_CHEAP = "cheap"
_STANDARD = "standard"

FEATURE_POLICY: dict[str, FeaturePolicy] = {
    # Short, structured, or mechanical -- the cheap model nails these.
    "meta_description": FeaturePolicy(_CHEAP, 256),
    "alt_text": FeaturePolicy(_CHEAP, 128),
    "title": FeaturePolicy(_CHEAP, 128),
    "slug": FeaturePolicy(_CHEAP, 64),
    "tags": FeaturePolicy(_CHEAP, 256, cascade=True),
    "social_caption": FeaturePolicy(_CHEAP, 512),
    "keyword_clustering": FeaturePolicy(_CHEAP, 2048, cascade=True),
    "extraction": FeaturePolicy(_CHEAP, 2048, cascade=True),
    "classification": FeaturePolicy(_CHEAP, 512, cascade=True),
    "image_prompt": FeaturePolicy(_CHEAP, 512),
    "suggest": FeaturePolicy(_CHEAP, 1024, cascade=True),

    # The workhorse band: reasoning and long-form prose.
    "article_draft": FeaturePolicy(_STANDARD, 8192),
    "article_outline": FeaturePolicy(_STANDARD, 2048, cascade=True),
    "brand_voice": FeaturePolicy(_STANDARD, 4096),
    "discovery": FeaturePolicy(_STANDARD, 4096, cascade=True),
    "competitor_gap": FeaturePolicy(_STANDARD, 4096),
    "agent_reasoning": FeaturePolicy(_STANDARD, 4096),
    "employee_chat": FeaturePolicy(_STANDARD, 4096),
    "campaign_plan": FeaturePolicy(_STANDARD, 4096, cascade=True),
    "digest": FeaturePolicy(_STANDARD, 2048),
    "monitoring": FeaturePolicy(_STANDARD, 2048),

    # The one feature allowed to reach premium, and only for an entitled org.
    "editorial_polish": FeaturePolicy(_STANDARD, 8192, needs_premium=True),
}


def policy_for(feature: str | None) -> FeaturePolicy:
    if feature is None:
        return DEFAULT_POLICY
    return FEATURE_POLICY.get(feature, DEFAULT_POLICY)
