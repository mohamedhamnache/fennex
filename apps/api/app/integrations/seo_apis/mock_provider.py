from app.integrations.seo_apis.base import KeywordData, _classify_intent


class MockSEOProvider:
    """Dev mock provider — no API key needed. Generates deterministic synthetic data."""

    async def get_keyword_ideas(self, seed: str, location_code: int = 2840) -> list[KeywordData]:
        variants = [
            f"{seed} guide",
            f"best {seed}",
            f"how to {seed}",
            f"what is {seed}",
            f"{seed} tutorial",
            f"{seed} examples",
            f"{seed} vs",
            f"{seed} tools",
            f"{seed} software",
            f"{seed} tips",
            f"free {seed}",
            f"{seed} for beginners",
            f"{seed} pricing",
            f"buy {seed}",
            f"{seed} review",
            f"{seed} 2024",
            f"{seed} course",
            f"{seed} certification",
            f"{seed} api",
            f"{seed} alternatives",
        ]

        results = []
        for kw in variants:
            h = abs(hash(kw)) & 0x7FFFFFFF
            search_volume = h % 50000 + 100
            difficulty = float(h % 80 + 10)
            cpc = round((h % 500 + 10) / 100, 2)
            intent = _classify_intent(kw)
            results.append(KeywordData(
                keyword=kw,
                search_volume=search_volume,
                difficulty=difficulty,
                cpc=cpc,
                intent=intent,
                serp_features=[],
            ))
        return results
