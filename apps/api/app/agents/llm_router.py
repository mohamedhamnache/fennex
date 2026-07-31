from enum import Enum
from typing import Optional


class TaskType(str, Enum):
    LONG_FORM_ARTICLE = "long_form_article"
    KEYWORD_RESEARCH = "keyword_research"
    SOCIAL_SHORT_FORM = "social_short_form"
    SEO_AUDIT_REASONING = "seo_audit_reasoning"
    BRAND_VOICE_CLONE = "brand_voice_clone"
    COMPETITOR_ANALYSIS = "competitor_analysis"
    SERP_EXTRACTION = "serp_extraction"
    IMAGE_PROMPT_GEN = "image_prompt_gen"


class LLMProvider(str, Enum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GOOGLE = "google"


# Google models: gemini-1.5-flash and -pro were RETIRED -- Google no longer
# lists them, so they had no published price and nothing could be metered
# against them. Replaced with the cheapest CURRENT models that still suit each
# slot (prices per 1M tokens, from Google's pricing page):
#   gemini-2.5-flash-lite  $0.10 in / $0.40 out  -- the cheapest Gemini there is
#   gemini-2.5-flash       $0.30 in / $2.50 out  -- for the quality slot
# The 1.5-pro this replaces in the quality slot was roughly $1.25/$5.00, so this
# is a large saving there too, not a quality-for-cost trade.

# Default routing: task → (provider, model)
TASK_ROUTING: dict[TaskType, tuple[LLMProvider, str]] = {
    TaskType.LONG_FORM_ARTICLE: (LLMProvider.ANTHROPIC, "claude-sonnet-4-6"),
    TaskType.KEYWORD_RESEARCH: (LLMProvider.OPENAI, "gpt-4o"),
    TaskType.SOCIAL_SHORT_FORM: (LLMProvider.OPENAI, "gpt-4o-mini"),
    TaskType.SEO_AUDIT_REASONING: (LLMProvider.ANTHROPIC, "claude-sonnet-4-6"),
    TaskType.BRAND_VOICE_CLONE: (LLMProvider.ANTHROPIC, "claude-sonnet-4-6"),
    TaskType.COMPETITOR_ANALYSIS: (LLMProvider.GOOGLE, "gemini-2.5-flash"),
    TaskType.SERP_EXTRACTION: (LLMProvider.OPENAI, "gpt-4o"),
    TaskType.IMAGE_PROMPT_GEN: (LLMProvider.OPENAI, "gpt-4o-mini"),
}


class LLMRouter:
    """Routes LLM tasks to optimal provider based on task type and available org API keys."""

    def __init__(self, available_providers: set[LLMProvider]):
        self.available_providers = available_providers

    def resolve(self, task_type: TaskType) -> tuple[LLMProvider, str]:
        preferred_provider, model = TASK_ROUTING[task_type]

        if preferred_provider in self.available_providers:
            return preferred_provider, model

        # Fallback chain. Quality-sensitive tasks (long-form, reasoning) must fall
        # back to a CAPABLE model per provider, never a cheap "mini" model — a
        # weak fallback is a common cause of poor article quality.
        fallback_order = [LLMProvider.ANTHROPIC, LLMProvider.OPENAI, LLMProvider.GOOGLE]
        heavy = {
            TaskType.LONG_FORM_ARTICLE,
            TaskType.SEO_AUDIT_REASONING,
            TaskType.BRAND_VOICE_CLONE,
            TaskType.COMPETITOR_ANALYSIS,
        }
        quality_fallback = {
            LLMProvider.ANTHROPIC: "claude-sonnet-4-6",
            LLMProvider.OPENAI: "gpt-4o",
            LLMProvider.GOOGLE: "gemini-2.5-flash",
        }
        cheap_fallback = {
            LLMProvider.ANTHROPIC: "claude-haiku-4-5-20251001",
            LLMProvider.OPENAI: "gpt-4o-mini",
            LLMProvider.GOOGLE: "gemini-2.5-flash-lite",
        }
        models = quality_fallback if task_type in heavy else cheap_fallback
        for provider in fallback_order:
            if provider in self.available_providers:
                return provider, models[provider]

        raise ValueError("No LLM providers available. Please add API keys in Settings.")
