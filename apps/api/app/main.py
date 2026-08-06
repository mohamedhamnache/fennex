import logging
from contextlib import asynccontextmanager

import stripe
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import engine, Base

stripe.api_key = settings.STRIPE_SECRET_KEY

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables if they don't exist (dev only; prod uses Alembic)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    from app.core.database import async_session_factory
    from app.services.providers import catalog
    async with async_session_factory() as db:
        await catalog.refresh_snapshot(db)
    # Billing invariant: nothing may spend a supplier's money without recording
    # it. Logged, never fatal -- see the docstring for why an outage is the
    # wrong response to a margin finding.
    from app.core.metering_audit import assert_supplier_calls_are_metered
    assert_supplier_calls_are_metered()
    # The same discipline for tenancy: metering asks "is this paid call
    # accounted for", this asks "is this row the caller's to touch". Logged,
    # never fatal -- CI blocks the merge (tests/test_tenant_audit.py).
    from app.core.tenant_audit import assert_routes_are_tenant_scoped
    assert_routes_are_tenant_scoped()
    if not (settings.OPENAI_API_KEY or settings.ANTHROPIC_API_KEY or settings.GOOGLE_API_KEY):
        logger.warning(
            "No platform LLM key configured (OPENAI_API_KEY/ANTHROPIC_API_KEY/GOOGLE_API_KEY). "
            "AI features will be unavailable unless an active LLM provider_account exists."
        )
    yield
    # Shutdown
    await engine.dispose()


app = FastAPI(
    title="Fennex API",
    description="Autonomous AI SEO & Content Growth Platform",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return JSONResponse({"status": "ok", "version": "0.1.0"})
