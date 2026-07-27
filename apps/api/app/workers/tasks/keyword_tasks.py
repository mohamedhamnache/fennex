import logging
import uuid
from app.core.database import async_session_factory
from app.models.keyword import KeywordResearchJob, Keyword, KeywordCluster, ResearchStatus, KeywordIntent
from app.integrations.seo_apis import get_seo_provider
from app.services.keyword_service import cluster_keywords, _get_cluster_key_for
from app.services.metering import meter as _meter

logger = logging.getLogger(__name__)


async def run_keyword_research(ctx, job_id: str, batched: bool = False):
    """ARQ task: fetch keyword ideas, classify intent, cluster them.

    Reachable directly from the keywords router (a user clicking "run keyword
    research"), so batching is opt-in per call via `batched` rather than
    unconditional -- nobody who clicked run should wait up to 24h for a
    provider batch to settle. Only a cron registration would ever pass
    batched=True; none exists today for this task.
    """
    from contextlib import nullcontext

    from app.services.batch.scope import batch_scope

    with (batch_scope() if batched else nullcontext()):
        async with async_session_factory() as session:
            job = await session.get(KeywordResearchJob, uuid.UUID(job_id))
            if job is None:
                return
            seed = job.seed_keyword
            project_id = job.project_id
            org_id = job.org_id
            job.status = ResearchStatus.running
            await session.commit()

        try:
            provider = get_seo_provider()
            keyword_data_list = await provider.get_keyword_ideas(seed)

            # Best-effort metering: get_keyword_ideas issues ONE DataForSEO task
            # per call (a single seed keyword request) regardless of how many
            # ideas come back, so count=1. org_id is passed explicitly (already
            # loaded from job.org_id above) rather than relying on the
            # request-scoped contextvar -- this is a worker with no request
            # context. Isolated session + swallow so a metering hiccup never
            # fails keyword research, and only the success path bills (a raise
            # from get_keyword_ideas above skips this block entirely).
            try:
                async with async_session_factory() as _mdb:
                    await _meter.record_seo(_mdb, org_id=org_id, project_id=project_id,
                                            unit="keyword_ideas", count=1,
                                            feature="keyword_research")
            except Exception:
                logger.warning("keyword research seo metering failed", exc_info=True)

            # Cluster keywords
            kw_strings = [kd.keyword for kd in keyword_data_list]
            clusters_map = cluster_keywords(kw_strings)   # {cluster_name: [kw, ...]}

            async with async_session_factory() as session:
                # Create cluster rows
                cluster_id_map: dict[str, uuid.UUID] = {}
                for cluster_name, kw_list in clusters_map.items():
                    cluster = KeywordCluster(
                        job_id=uuid.UUID(job_id),
                        org_id=org_id,
                        name=cluster_name.title(),
                        topic=cluster_name,
                        keyword_count=len(kw_list),
                        total_volume=0,  # updated below
                    )
                    session.add(cluster)
                    await session.flush()
                    cluster_id_map[cluster_name] = cluster.id

                # Create keyword rows
                for kd in keyword_data_list:
                    c_name = _get_cluster_key_for(kd.keyword)
                    intent_val = KeywordIntent(kd.intent) if kd.intent else None
                    kw_row = Keyword(
                        job_id=uuid.UUID(job_id),
                        org_id=org_id,
                        project_id=project_id,
                        keyword=kd.keyword,
                        search_volume=kd.search_volume,
                        difficulty=kd.difficulty,
                        cpc=kd.cpc,
                        intent=intent_val,
                        cluster_id=cluster_id_map.get(c_name),
                        is_seed=(kd.keyword == seed),
                        serp_features=kd.serp_features,
                    )
                    session.add(kw_row)

                # Sum volumes per cluster
                for cluster_name, cluster_id in cluster_id_map.items():
                    cluster_kws = [kd for kd in keyword_data_list if _get_cluster_key_for(kd.keyword) == cluster_name]
                    total_vol = sum(kd.search_volume or 0 for kd in cluster_kws)
                    cluster_row = await session.get(KeywordCluster, cluster_id)
                    if cluster_row:
                        cluster_row.total_volume = total_vol

                # Update job status
                job_row = await session.get(KeywordResearchJob, uuid.UUID(job_id))
                job_row.keywords_found = len(keyword_data_list)
                job_row.status = ResearchStatus.completed
                await session.commit()

        except Exception as e:
            async with async_session_factory() as session:
                job_row = await session.get(KeywordResearchJob, uuid.UUID(job_id))
                if job_row:
                    job_row.status = ResearchStatus.failed
                    job_row.error = str(e)
                    await session.commit()
            raise
