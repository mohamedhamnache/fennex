from typing import Protocol
from dataclasses import dataclass


@dataclass
class KeywordData:
    keyword: str
    search_volume: int | None
    difficulty: float | None
    cpc: float | None
    intent: str | None         # "informational"|"navigational"|"commercial"|"transactional"
    serp_features: list[str]


class SEODataProvider(Protocol):
    async def get_keyword_ideas(self, seed: str, location_code: int = 2840) -> list[KeywordData]: ...


def _classify_intent(keyword: str) -> str:
    kw = keyword.lower()
    if any(w in kw for w in ["buy", "price", "pricing", "cheap", "order", "purchase", "discount", "deal", "coupon", "shop"]):
        return "transactional"
    if any(w in kw for w in ["best", "top", "review", "vs", "versus", "compare", "comparison", "alternative"]):
        return "commercial"
    if any(w in kw for w in ["how to", "what is", "why", "guide", "tutorial", "learn", "tips", "examples", "for beginners"]):
        return "informational"
    return "navigational"
