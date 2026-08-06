"""Canonical capability taxonomy for the Fennex AI company.

The Orchestrator assembles teams by CAPABILITY, never by employee name. That is
what lets the roster grow to hundreds of employees without touching the
orchestration code: a new employee simply declares the capabilities it covers
and immediately becomes selectable for every task that needs them.

A capability slug is `domain.verb_noun`. Domains map to departments but are not
owned by them -- two employees may legitimately claim the same capability, in
which case the registry ranks them (see `registry.find_by_capability`).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Capability:
    slug: str
    label: str
    domain: str
    description: str


def _c(slug: str, label: str, description: str) -> Capability:
    return Capability(slug=slug, label=label, domain=slug.split(".", 1)[0], description=description)


# --- Strategy / SEO -----------------------------------------------------------
SEO = [
    _c("seo.keyword_research", "Keyword research", "Discover and qualify keywords from real demand."),
    _c("seo.search_intent", "Search intent", "Classify the intent behind a query."),
    _c("seo.serp_analysis", "SERP analysis", "Read a SERP and extract what it rewards."),
    _c("seo.clustering", "Keyword clustering", "Group keywords into topical clusters."),
    _c("seo.editorial_plan", "Editorial planning", "Turn clusters into a sequenced editorial plan."),
    _c("seo.internal_linking", "Internal linking", "Propose internal links that build topical authority."),
    _c("seo.scoring", "SEO scoring", "Score a page or draft against SEO criteria."),
    _c("seo.opportunity_discovery", "Opportunity discovery", "Surface the highest-leverage next move."),
    _c("seo.topical_authority", "Topical authority", "Map coverage gaps in a topic territory."),
    _c("seo.publishing_priority", "Publishing priorities", "Rank what to publish first and why."),
]

# --- Content ------------------------------------------------------------------
CONTENT = [
    _c("content.article", "SEO article", "Long-form article aligned to a brief."),
    _c("content.landing_page", "Landing page", "Conversion-oriented landing page copy."),
    _c("content.product_description", "Product description", "Product copy from real product data."),
    _c("content.category_page", "Category page", "Category and collection page copy."),
    _c("content.collection", "Collection copy", "Merchandised collection narrative."),
    _c("content.meta_description", "Meta description", "Titles and meta descriptions."),
    _c("content.faq", "FAQ", "Question-and-answer blocks from real queries."),
    _c("content.newsletter", "Newsletter", "Email newsletter issues."),
    _c("content.regeneration", "Regeneration", "Rewrite or repair existing content in place."),
    _c("content.brand_consistency", "Brand consistency", "Enforce Brand DNA across written output."),
]

# --- Marketing / social -------------------------------------------------------
MARKETING = [
    _c("social.instagram", "Instagram", "Native Instagram posts, reels and stories."),
    _c("social.facebook", "Facebook", "Native Facebook posts."),
    _c("social.linkedin", "LinkedIn", "Native LinkedIn posts."),
    _c("social.pinterest", "Pinterest", "Pin copy and board strategy."),
    _c("social.threads", "Threads", "Native Threads posts."),
    _c("social.x", "X", "Native X posts and threads."),
    _c("social.carousel", "Carousel planning", "Slide-by-slide carousel structure."),
    _c("social.adaptation", "Social adaptation", "Adapt one message natively per network."),
    _c("campaign.strategy", "Campaign strategy", "Design a multi-channel campaign."),
    _c("copy.hooks", "Hooks", "Opening hooks that earn the scroll."),
    _c("copy.cta", "CTA optimization", "Calls to action tuned to the funnel stage."),
]

# --- Creative studio ----------------------------------------------------------
CREATIVE = [
    _c("image.product_photography", "Product photography", "Studio-grade product renders."),
    _c("image.lifestyle", "Lifestyle scenes", "Products in believable human context."),
    _c("image.editorial", "Editorial imagery", "Article covers and inline editorial visuals."),
    _c("image.pinterest", "Pinterest visuals", "Vertical pin-native creatives."),
    _c("image.instagram", "Instagram assets", "Square and vertical social assets."),
    _c("image.mockup", "Mockups", "Device, packaging and print mockups."),
    _c("image.background_replace", "Background replacement", "Swap or extend the scene behind a subject."),
    _c("image.ai_edit", "AI editing", "Plain-language edits on an existing image."),
    _c("image.variations", "Variations", "Alternative takes on an approved visual."),
    _c("image.upscale", "Upscaling", "Increase resolution without artefacts."),
]

# --- Intelligence -------------------------------------------------------------
INTELLIGENCE = [
    _c("intel.competitor_analysis", "Competitor analysis", "Assess a named competitor."),
    _c("intel.content_gap", "Content gap analysis", "Find topics rivals cover and we do not."),
    _c("intel.keyword_overlap", "Keyword overlap", "Shared and contested keyword territory."),
    _c("intel.swot", "SWOT", "Structured strengths/weaknesses assessment."),
    _c("intel.pricing_comparison", "Pricing comparison", "Compare positioning by price."),
    _c("intel.serp_monitoring", "SERP monitoring", "Watch ranking movement over time."),
    _c("intel.positioning", "Product positioning", "How a product should be positioned."),
    _c("intel.opportunity_report", "Opportunity report", "Ranked competitive openings."),
]

# --- Research -----------------------------------------------------------------
RESEARCH = [
    _c("research.gsc_analysis", "Search Console analysis", "Interpret real GSC performance."),
    _c("research.audience_segmentation", "Audience segmentation", "Split the audience into actionable segments."),
    _c("research.icp", "ICP definition", "Define the ideal client profile."),
    _c("research.persona", "Persona generation", "Build buyer personas from data."),
    _c("research.trends", "Trend detection", "Detect rising and decaying demand."),
    _c("research.market_report", "Market report", "Client-ready market analysis."),
    _c("research.forecasting", "Opportunity forecasting", "Project the upside of an opportunity."),
]

# --- Growth -------------------------------------------------------------------
GROWTH = [
    _c("outreach.linkedin", "LinkedIn outreach", "Outbound LinkedIn content and DMs."),
    _c("outreach.cold_email", "Cold email", "Cold email sequences."),
    _c("outreach.follow_up", "Follow-up sequences", "Multi-touch follow-up cadences."),
    _c("outreach.partnerships", "Partnerships", "Partner and collaboration outreach."),
    _c("outreach.influencer", "Influencer outreach", "Creator and influencer approaches."),
    _c("outreach.testimonial_collection", "Testimonial collection", "Ask for and collect proof."),
    _c("outreach.testimonial_to_content", "Testimonial to content", "Turn proof into social content."),
    _c("outreach.lead_nurturing", "Lead nurturing", "Warm a lead toward a decision."),
]

# --- Operations (publishing, measurement) -------------------------------------
OPERATIONS = [
    _c("publish.wordpress", "Publish to WordPress", "Push content to a WordPress site."),
    _c("publish.shopify", "Publish to Shopify", "Push products and pages to Shopify."),
    _c("publish.social", "Publish to social", "Schedule or post to a connected network."),
    _c("analytics.measure", "Measure performance", "Report on what the work achieved."),
]

# --- Ecommerce (trading, conversion, retention, merchandising) ----------------
# Its own domain rather than a subset of GROWTH: these read a store's orders and
# catalogue, and an employee that cannot see those should never be selected for
# them however good its growth capabilities are.
ECOMMERCE = [
    _c("ecommerce.growth_audit", "Growth audit",
       "Find the constraint limiting store revenue and rank fixes by impact."),
    _c("ecommerce.cro_review", "Conversion review",
       "Locate friction across the buying journey and specify the change at each step."),
    _c("ecommerce.retention_plan", "Retention plan",
       "Lifecycle flows and segments that raise repeat purchase rate."),
    _c("ecommerce.merchandising", "Merchandising",
       "Decide what to push, bundle, reprice or retire from what actually sells."),
    _c("ecommerce.offer_design", "Offer design",
       "Bundles, upsells and promotions built around real basket behaviour."),
    _c("ecommerce.channel_economics", "Channel economics",
       "Judge which acquisition channels are profitable, not merely busy."),
    _c("ecommerce.inventory_risk", "Inventory risk",
       "Flag stock that will run out or tie up capital before it does."),
    _c("ecommerce.customer_segmentation", "Customer segmentation",
       "Split customers by value and behaviour into segments worth acting on."),
]

ALL: list[Capability] = (SEO + CONTENT + MARKETING + CREATIVE + INTELLIGENCE
                         + RESEARCH + GROWTH + OPERATIONS + ECOMMERCE)
BY_SLUG: dict[str, Capability] = {c.slug: c for c in ALL}


def is_known(slug: str) -> bool:
    return slug in BY_SLUG


def unknown(slugs) -> list[str]:
    """Slugs that are not part of the taxonomy -- used by health checks."""
    return [s for s in slugs or [] if s not in BY_SLUG]


def catalog_text(slugs=None) -> str:
    """Human-readable capability catalog for orchestrator prompts."""
    caps = [BY_SLUG[s] for s in slugs if s in BY_SLUG] if slugs is not None else ALL
    return "\n".join(f"- {c.slug}: {c.description}" for c in caps)
