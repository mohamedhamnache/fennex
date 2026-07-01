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
    brand_voice,
    brand_kit,
    social,
    images,
    editing,
    seo,
    publishing,
    backlinks,
    analytics,
    webhooks,
    billing,
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
api_router.include_router(brand_voice.router, prefix="/brand-voice", tags=["brand-voice"])
api_router.include_router(brand_kit.router, prefix="/brand-kit", tags=["brand-kit"])
api_router.include_router(social.router, prefix="/social", tags=["social"])
api_router.include_router(images.router, prefix="/images", tags=["images"])
api_router.include_router(editing.router, prefix="/images", tags=["editing"])
api_router.include_router(seo.router, prefix="/images", tags=["seo"])
api_router.include_router(publishing.router, prefix="/publishing", tags=["publishing"])
api_router.include_router(backlinks.router, prefix="/backlinks", tags=["backlinks"])
api_router.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(billing.router, prefix="/billing", tags=["billing"])
