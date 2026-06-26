"""Heuristic mock social post generator."""
import hashlib

PLATFORM_LIMITS = {
    "linkedin": 3000,
    "twitter": 280,
    "instagram": 2200,
    "facebook": 63206,
}

HASHTAG_SETS = {
    "linkedin": ["#SEO", "#ContentMarketing", "#DigitalMarketing", "#GrowthHacking", "#MarketingStrategy"],
    "twitter": ["#SEO", "#Marketing", "#ContentStrategy", "#GrowthHacking"],
    "instagram": ["#SEO", "#DigitalMarketing", "#ContentCreator", "#GrowthHacking", "#MarketingTips"],
    "facebook": ["#SEO", "#ContentMarketing", "#DigitalMarketing"],
}


def _seed(platform: str, title: str) -> int:
    """Return a deterministic integer seed from platform + title."""
    h = hashlib.md5(f"{platform}:{title}".encode()).hexdigest()
    return int(h, 16)


def generate_social_post(
    platform: str,
    post_type: str,
    title: str,
    keyword: str | None = None,
    article_url: str | None = None,
    tone: str = "professional",
) -> dict:
    """
    Generate platform-appropriate social post content.

    Returns: {content: str, hashtags: list[str], char_count: int}
    """
    subject = keyword if keyword else title
    seed = _seed(platform, title)

    if platform == "linkedin":
        hashtags = HASHTAG_SETS["linkedin"][:5]
        bullet_topics = [
            f"How {subject} drives sustainable organic traffic",
            f"The most overlooked aspect of {subject} in 2024",
            f"Practical steps to implement {subject} today",
        ]
        # Rotate bullets based on seed for mild variation
        offset = seed % 3
        bullets = bullet_topics[offset:] + bullet_topics[:offset]

        cta = f"Read the full guide: {article_url}" if article_url else "Link in comments"
        lines = [
            f"I just published a deep-dive on {subject}.",
            "",
            "Here are the key takeaways:",
            "",
            f"→ {bullets[0]}",
            f"→ {bullets[1]}",
            f"→ {bullets[2]}",
            "",
            cta,
            "",
            " ".join(hashtags),
        ]
        content = "\n".join(lines)

    elif platform == "twitter":
        hashtags = HASHTAG_SETS["twitter"][:2]
        tag_str = " ".join(hashtags)
        if article_url:
            hook = f"Everything you need to know about {subject}. {article_url} {tag_str}"
        else:
            hook = f"Everything you need to know about {subject}. {tag_str}"
        # Truncate to 280 chars
        content = hook[:280]

    elif platform == "instagram":
        hashtags = HASHTAG_SETS["instagram"][:5]
        tag_str = " ".join(hashtags)
        lines = [
            f"Want to master {subject}?",
            "",
            f"Here is what every marketer should know about {subject}.",
            "",
            "Key insight one: focus on quality content that answers real questions.",
            "Key insight two: consistency matters more than volume.",
            "Key insight three: track your metrics and iterate.",
            "",
            tag_str,
        ]
        content = "\n".join(lines)

    elif platform == "facebook":
        hashtags = HASHTAG_SETS["facebook"][:3]
        tag_str = " ".join(hashtags)
        url_part = f" {article_url}" if article_url else ""
        content = (
            f"Have you ever wondered how to get the most out of {subject}? "
            f"We just published a comprehensive guide covering everything you need to know.{url_part} "
            f"What is your biggest challenge with {subject}? Let us know in the comments. "
            f"{tag_str}"
        )

    else:
        # Fallback generic
        hashtags = ["#SEO", "#Marketing"]
        content = f"Check out our latest content on {subject}."

    return {
        "content": content,
        "hashtags": hashtags,
        "char_count": len(content),
    }
