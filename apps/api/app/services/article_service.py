"""
Article generation service — mock heuristic generator.
Produces realistic-looking SEO article content without requiring an LLM.
"""
import re
from datetime import datetime


def _markdown_to_html(markdown: str) -> str:
    """Convert basic markdown to HTML."""
    lines = markdown.split("\n")
    html_parts = []
    in_paragraph = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if in_paragraph:
                html_parts.append("</p>")
                in_paragraph = False
            continue

        # H2 headings
        if stripped.startswith("## "):
            if in_paragraph:
                html_parts.append("</p>")
                in_paragraph = False
            heading_text = stripped[3:]
            html_parts.append(f"<h2>{heading_text}</h2>")
        # H1 headings
        elif stripped.startswith("# "):
            if in_paragraph:
                html_parts.append("</p>")
                in_paragraph = False
            heading_text = stripped[2:]
            html_parts.append(f"<h1>{heading_text}</h1>")
        else:
            # Apply inline formatting
            text = stripped
            text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
            text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)

            if not in_paragraph:
                html_parts.append("<p>")
                in_paragraph = True
            html_parts.append(text + " ")

    if in_paragraph:
        html_parts.append("</p>")

    return "\n".join(html_parts)


def _count_words(text: str) -> int:
    return len(text.split())


def _deterministic_seo_score(title: str) -> float:
    """Return a deterministic SEO score between 62 and 88 based on hash of title."""
    h = hash(title) % 10000
    return round(62.0 + (h % 2600) / 100.0, 1)


def generate_article_mock(
    title: str,
    keyword: str | None,
    tone: str,
    word_count_target: int = 1500,
) -> dict:
    """
    Heuristic mock article generator. Returns a dict with:
    - outline: {sections: [{heading, content}]}
    - body_markdown: full article markdown
    - body_html: rendered HTML
    - word_count: int
    - seo_score: float (0-100)
    - meta_title: str
    - meta_description: str
    """
    kw = keyword or title
    year = datetime.now().year

    # Section headings
    sections = [
        f"What is {kw}?",
        f"Why {kw} Matters",
        f"Best Practices for {kw}",
        f"Common {kw} Mistakes to Avoid",
        f"How to Get Started with {kw}",
    ]

    # Section body paragraphs (~100 words each, 2 per section)
    section_paragraphs = {
        sections[0]: [
            (
                f"{kw.title()} is a fundamental concept in modern digital strategy. "
                f"Understanding {kw} allows businesses to make data-driven decisions that drive growth. "
                f"At its core, {kw} encompasses a set of principles and methodologies designed to maximize "
                f"online visibility and engagement. Organizations that invest in {kw} consistently outperform "
                f"competitors who neglect this critical area. Whether you are new to the field or an experienced "
                f"practitioner, a solid grasp of {kw} fundamentals is essential for long-term success."
            ),
            (
                f"The evolution of {kw} over the past decade has been remarkable. "
                f"What began as a niche discipline has grown into a cornerstone of digital marketing strategy. "
                f"Today, {kw} integrates seamlessly with content creation, technical optimization, and user "
                f"experience design. Leading brands leverage {kw} to build authority, attract qualified traffic, "
                f"and convert visitors into loyal customers. As search algorithms become more sophisticated, "
                f"the importance of genuine {kw} expertise only continues to grow."
            ),
        ],
        sections[1]: [
            (
                f"The significance of {kw} in today's competitive landscape cannot be overstated. "
                f"Businesses that prioritize {kw} gain a measurable advantage in organic search results, "
                f"leading to sustained traffic growth without ongoing advertising expenditure. "
                f"Furthermore, {kw} builds brand credibility — users inherently trust organic results "
                f"over paid advertisements. Investing in {kw} is therefore not merely a marketing tactic "
                f"but a long-term business strategy that compounds returns over time."
            ),
            (
                f"Research consistently shows that {kw} delivers one of the highest ROIs in digital marketing. "
                f"Unlike paid channels that stop producing results when budgets dry up, {kw} creates lasting "
                f"assets in the form of high-ranking content and authoritative backlinks. "
                f"Companies with mature {kw} programs typically see 3-5x more organic traffic than those "
                f"without a systematic approach. This translates directly into pipeline growth, reduced "
                f"customer acquisition costs, and stronger brand recognition across target markets."
            ),
        ],
        sections[2]: [
            (
                f"Implementing effective {kw} requires a structured, systematic approach. "
                f"Begin by conducting thorough keyword research to identify the terms your target audience "
                f"actually uses. Next, audit your existing content to find gaps and opportunities for improvement. "
                f"Prioritize technical excellence — fast load times, mobile responsiveness, and clean site "
                f"architecture are non-negotiable foundations for {kw} success. "
                f"Consistently publishing high-quality, comprehensive content remains the single most "
                f"impactful {kw} practice."
            ),
            (
                f"Beyond content creation, link building is a critical component of any successful {kw} strategy. "
                f"Earning backlinks from authoritative, relevant websites signals trust and expertise to search "
                f"engines. Focus on creating linkable assets — original research, comprehensive guides, and "
                f"unique data that others will naturally want to reference. "
                f"Pair this with strategic outreach to amplify your {kw} efforts. "
                f"Regular performance tracking and iterative optimization ensure your {kw} program "
                f"continuously improves over time."
            ),
        ],
        sections[3]: [
            (
                f"Even experienced practitioners make {kw} mistakes that limit their results. "
                f"One of the most common errors is targeting keywords that are too broad or too competitive, "
                f"resulting in content that never ranks despite significant investment. "
                f"Another frequent mistake is neglecting technical {kw} fundamentals — issues like duplicate "
                f"content, broken links, and slow page speed can silently sabotage an otherwise strong strategy. "
                f"Always conduct a thorough technical audit before scaling your {kw} content efforts."
            ),
            (
                f"Ignoring user intent is another costly {kw} mistake. "
                f"Content that ranks for the right keywords but fails to satisfy what users are actually "
                f"looking for will suffer from high bounce rates and poor engagement signals. "
                f"Search engines interpret these signals as indicators of low quality, causing rankings to drop. "
                f"Additionally, many teams underestimate the importance of content freshness — "
                f"outdated {kw} content quickly loses its ranking power as competitors publish more current "
                f"and comprehensive alternatives."
            ),
        ],
        sections[4]: [
            (
                f"Getting started with {kw} does not have to be overwhelming. "
                f"Begin with a clear goal — whether that is increasing organic traffic, improving local "
                f"visibility, or ranking for specific commercial keywords. "
                f"Conduct an initial {kw} audit to understand your current baseline and identify "
                f"quick wins. Focus your early efforts on a handful of high-potential keywords rather "
                f"than spreading resources too thin. Consistency is key: commit to a regular publishing "
                f"cadence and treat {kw} as an ongoing program, not a one-time project."
            ),
            (
                f"As you build momentum with {kw}, invest in the right tools to measure and scale your efforts. "
                f"Analytics platforms, rank tracking software, and keyword research tools provide the "
                f"data-driven insights necessary to make informed decisions. "
                f"Consider building a small, dedicated {kw} team or partnering with specialists who can "
                f"bring expertise and accelerate results. "
                f"Most importantly, remain patient — {kw} is a long-term strategy that typically takes "
                f"three to six months to show significant results, but the compounding benefits are well worth "
                f"the investment."
            ),
        ],
    }

    # Build intro
    intro = (
        f"In today's competitive landscape, **{kw}** has become essential for businesses "
        f"seeking to establish a strong online presence. Whether you're a seasoned professional "
        f"or just beginning your journey, understanding the nuances of {kw} can make the difference "
        f"between achieving your goals and falling behind. This comprehensive guide covers everything "
        f"you need to know about {kw}, from foundational concepts to advanced strategies that drive results."
    )

    # Build conclusion
    conclusion = (
        f"By implementing these **{kw}** strategies, you position your business for sustainable growth "
        f"and long-term success. The principles outlined in this guide provide a proven framework for "
        f"maximizing your {kw} results. Remember that consistency, quality, and a data-driven approach "
        f"are the cornerstones of any successful {kw} program. Start applying these insights today and "
        f"watch your organic visibility transform over the coming months."
    )

    # Assemble markdown
    md_parts = [f"# {title}", "", intro, ""]
    outline_sections = []

    for heading in sections:
        md_parts.append(f"## {heading}")
        md_parts.append("")
        section_content = "\n\n".join(section_paragraphs[heading])
        md_parts.append(section_content)
        md_parts.append("")
        outline_sections.append({"heading": heading, "content": section_paragraphs[heading][0][:100] + "..."})

    md_parts.append("## Conclusion")
    md_parts.append("")
    md_parts.append(conclusion)

    body_markdown = "\n".join(md_parts)
    body_html = _markdown_to_html(body_markdown)
    word_count = _count_words(body_markdown)

    # SEO metadata
    meta_title = f"{title} — Complete Guide {year}"
    intro_plain = re.sub(r"\*\*?(.+?)\*\*?", r"\1", intro)
    meta_description = f"Learn everything about {kw}. {intro_plain[:150]}..."

    seo_score = _deterministic_seo_score(title)

    outline = {"sections": outline_sections}

    return {
        "outline": outline,
        "body_markdown": body_markdown,
        "body_html": body_html,
        "word_count": word_count,
        "seo_score": seo_score,
        "meta_title": meta_title,
        "meta_description": meta_description,
    }
