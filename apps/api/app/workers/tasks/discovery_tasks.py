"""ARQ task: run an onboarding discovery pipeline."""
import uuid

from app.services.discovery_service import run_discovery_pipeline


async def run_discovery(ctx, run_id: str):
    await run_discovery_pipeline(uuid.UUID(run_id))
