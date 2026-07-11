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

    async def get_backlink_profile(self, domain: str) -> dict:
        h = abs(hash(domain)) & 0x7FFFFFFF
        return {
            "domain_authority": round(20.0 + (h % 60), 1),
            "trust_score": round(15.0 + (h % 50), 1),
            "spam_score": round((h % 20), 1),
            "total_backlinks": 100 + (h % 5000),
            "referring_domains": 10 + (h % 500),
        }

    async def get_backlinks(self, domain: str) -> list[dict]:
        tlds = [".com", ".org", ".net", ".io", ".co"]
        link_types = ["dofollow", "nofollow"]
        results = []
        for i in range(20):
            h = abs(hash(f"{domain}-bl-{i}")) & 0x7FFFFFFF
            src_domain = f"site{h % 9999}{tlds[h % len(tlds)]}"
            results.append({
                "source_url": f"https://{src_domain}/page-{i}",
                "source_domain": src_domain,
                "target_url": f"https://{domain}/",
                "anchor_text": f"anchor text {i}",
                "domain_authority": round(10.0 + (h % 70), 1),
                "trust_score": round(5.0 + (h % 60), 1),
                "spam_score": round(h % 15, 1),
                "link_type": link_types[h % 2],
            })
        return results

    async def get_backlink_opportunities(self, domain: str) -> list[dict]:
        competitors = ["competitor1.com", "competitor2.com", "competitor3.com"]
        results = []
        for i in range(10):
            h = abs(hash(f"{domain}-opp-{i}")) & 0x7FFFFFFF
            src_domain = f"referring{h % 9999}.com"
            results.append({
                "source_url": f"https://{src_domain}/article-{i}",
                "source_domain": src_domain,
                "domain_authority": round(20.0 + (h % 60), 1),
                "trust_score": round(15.0 + (h % 50), 1),
                "spam_score": round(h % 10, 1),
                "linking_to_competitor": competitors[h % len(competitors)],
            })
        return results

    async def serp(self, keyword: str, language_code: str = "en", location_code: int = 2840) -> list[dict]:
        """Deterministic synthetic SERP — 10 organic items."""
        return [
            {
                "type": "organic",
                "rank_absolute": i,
                "domain": f"site{i}.com",
                "url": f"https://site{i}.com/page",
                "title": f"Result {i} for {keyword}",
            }
            for i in range(1, 11)
        ]
