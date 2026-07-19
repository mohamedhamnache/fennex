from fastapi import APIRouter

from app.api.v1.routers import (
    auth,
    organizations,
    users,
    api_keys,
    projects,
    jobs,
    crawl,
    audit,
    keywords,
    content_plans,
    content_items,
    articles,
    articles_images,
    articles_studio,
    brand_voice,
    brand_kit,
    calendar,
    social,
    images,
    editing,
    seo,
    product,
    banners,
    image_folders,
    collections,
    image_publish,
    ai_command,
    templates,
    scoring,
    ab_test,
    competitor,
    trends,
    publishing,
    backlinks,
    analytics,
    recommendations,
    webhooks,
    billing,
    campaigns,
    monitoring,
    seo_hub,
    shopify,
    woocommerce,
    store,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(organizations.router, prefix="/organizations", tags=["organizations"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(api_keys.router, prefix="/api-keys", tags=["api-keys"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
api_router.include_router(crawl.router, prefix="/crawl", tags=["crawl"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
api_router.include_router(keywords.router, prefix="/keywords", tags=["keywords"])
api_router.include_router(content_plans.router, prefix="/content-plans", tags=["content-plans"])
api_router.include_router(content_items.router, prefix="/content-items", tags=["content-items"])
api_router.include_router(articles.router, prefix="/articles", tags=["articles"])
api_router.include_router(articles_images.router, prefix="/articles", tags=["articles-images"])
api_router.include_router(articles_studio.router, prefix="/articles", tags=["articles-studio"])
api_router.include_router(brand_voice.router, prefix="/brand-voice", tags=["brand-voice"])
api_router.include_router(brand_kit.router, prefix="/brand-kit", tags=["brand-kit"])
api_router.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
api_router.include_router(social.router, prefix="/social", tags=["social"])
api_router.include_router(images.router, prefix="/images", tags=["images"])
api_router.include_router(editing.router, prefix="/images", tags=["editing"])
api_router.include_router(seo.router, prefix="/images", tags=["seo"])
api_router.include_router(product.router, prefix="/images", tags=["product"])
api_router.include_router(banners.router, prefix="/images", tags=["banners"])
api_router.include_router(image_folders.router, prefix="/image-folders", tags=["dam"])
api_router.include_router(collections.router, prefix="/collections", tags=["collections"])
api_router.include_router(image_publish.router, prefix="/images", tags=["publishing"])
api_router.include_router(ai_command.router, prefix="/images", tags=["ai-assistant"])
api_router.include_router(templates.router, prefix="/templates", tags=["templates"])
api_router.include_router(templates.image_router, prefix="/images", tags=["templates"])
api_router.include_router(scoring.router, prefix="/images", tags=["analytics"])
api_router.include_router(ab_test.router, prefix="/images", tags=["premium"])
api_router.include_router(competitor.router, prefix="/images", tags=["premium"])
api_router.include_router(trends.router, prefix="/trends", tags=["premium"])
api_router.include_router(trends.image_router, prefix="/images", tags=["premium"])
api_router.include_router(publishing.router, prefix="/publishing", tags=["publishing"])
api_router.include_router(backlinks.router, prefix="/backlinks", tags=["backlinks"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
api_router.include_router(campaigns.router, prefix="/campaigns", tags=["campaigns"])
api_router.include_router(monitoring.router, prefix="/monitoring", tags=["monitoring"])
api_router.include_router(seo_hub.router, prefix="/seo", tags=["seo"])
api_router.include_router(shopify.router, prefix="/shopify", tags=["shopify"])
api_router.include_router(woocommerce.router, prefix="/woocommerce", tags=["woocommerce"])
api_router.include_router(store.router, prefix="/store", tags=["store"])
