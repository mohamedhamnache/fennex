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
    # /images/improve-prompt, both modes. Its system prompt caps the answer at
    # 200 words (~270 tokens) in generate mode and one or two sentences in
    # edit_instruction mode, so 512 is a real ceiling rather than the 4096
    # default the endpoint used to inherit -- output costs ~5x input, and this
    # is a button a user can press repeatedly.
    "improve_prompt": FeaturePolicy(_CHEAP, 512),
    # /images/interpret-attachment. One vision call returning a small JSON
    # verdict plus a two-or-three sentence description. The INPUT is the
    # expensive half here (an image is worth well over a thousand tokens), so
    # the output ceiling is kept tight -- nothing downstream reads more than a
    # short paragraph.
    "attachment_intent": FeaturePolicy(_CHEAP, 512),
    "suggest": FeaturePolicy(_CHEAP, 1024, cascade=True),
    "document_digest": FeaturePolicy(_CHEAP, 2048, cascade=True),

    # The workhorse band: reasoning and long-form prose.
    "article_draft": FeaturePolicy(_STANDARD, 8192),
    "article_outline": FeaturePolicy(_STANDARD, 2048, cascade=True),
    "brand_voice": FeaturePolicy(_STANDARD, 4096),
    "discovery": FeaturePolicy(_STANDARD, 4096, cascade=True),
    "competitor_gap": FeaturePolicy(_STANDARD, 4096),
    "agent_reasoning": FeaturePolicy(_STANDARD, 4096),
    "employee_chat": FeaturePolicy(_STANDARD, 4096),
    "campaign_plan": FeaturePolicy(_STANDARD, 4096, cascade=True),
    # The campaign OS. All four start CHEAP and escalate only on a failed
    # validation, which is what the cascade is for.
    #
    # Strategy sat at `standard` and was measured buying gpt-4o at ~9.8 credits
    # per call against gpt-4o-mini's 0.17 -- 58x, on a feature whose output is
    # a structured plan the validator can check. The escalation still happens
    # when the cheap model returns something thin or malformed, so the expensive
    # model is bought when it is needed rather than by default.
    "campaign_strategy": FeaturePolicy(_CHEAP, 4096, cascade=True),
    "campaign_analysis": FeaturePolicy(_CHEAP, 2048, cascade=True),
    "campaign_content": FeaturePolicy(_CHEAP, 2048, cascade=True),
    "campaign_audience": FeaturePolicy(_CHEAP, 1024, cascade=True),
    "digest": FeaturePolicy(_STANDARD, 2048),
    "monitoring": FeaturePolicy(_STANDARD, 2048),

    # The one feature allowed to reach premium, and only for an entitled org.
    "editorial_polish": FeaturePolicy(_STANDARD, 8192, needs_premium=True),
}


def policy_for(feature: str | None) -> FeaturePolicy:
    if feature is None:
        return DEFAULT_POLICY
    return FEATURE_POLICY.get(feature, DEFAULT_POLICY)
