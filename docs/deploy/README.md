# Deployment Guides

Three ways to run Fennex in production, with step-by-step instructions and cost estimates.

| guide | frontend | backend | fixed infra | setup |
| --- | --- | --- | --- | --- |
| [Vercel + Railway](./vercel-railway.md) | Vercel | Railway | **~$67 – 107/mo** | ~2 hours |
| [Vercel + AWS](./vercel-aws.md) | Vercel | AWS ECS | ~$205 – 230/mo | ~1 day |
| [Full AWS](./aws-full-stack.md) | AWS ECS | AWS ECS | ~$245 – 270/mo | ~1–2 days |

"Fixed infra" excludes AI supplier spend, which is the same on all three and usually the larger
number — see [AI Credits and Models](../ai-credits-and-models.md).

---

## Choosing

**Start with Vercel + Railway.** It is a fifth of the fixed cost of the AWS options and deploys
in an afternoon. Nothing about it is a dead end: the app is containerised, so moving later is a
redeploy, not a rewrite.

**Move to Vercel + AWS** when you need multi-AZ, point-in-time recovery, real autoscaling, or VPC
isolation — typically past ~100 paying customers, or the first time a customer asks about your
DR story.

**Go full AWS** only for a reason that is not cost: one vendor, compliance boundaries, enterprise
procurement, or an existing AWS estate. It is the most expensive option at every volume modelled.

---

## What every option needs

| requirement | why |
| --- | --- |
| **Postgres with `pgvector`** | knowledge-base search stores embeddings as vectors |
| **Redis** | arq job queue |
| **S3-compatible storage** | generated images and edits |
| **A worker process** | article generation, crawls, audits — not just the API |
| **A separate migration step** | more than one API replica means concurrent `alembic upgrade` races |
| **`ENCRYPTION_KEY` backed up off-platform** | it encrypts tenant API keys; losing it loses them |

### Sizing at a glance

| service | minimum | notes |
| --- | --- | --- |
| api | 0.5 vCPU / 1 GB | 2 replicas for availability |
| worker | 0.5 vCPU / 1 GB | image jobs are memory-hungry |
| crawler | 0.25 vCPU / 0.5 GB | can co-locate initially |
| web | 0.5 vCPU / 1 GB | Vercel handles this in two of three options |
| postgres | 1 GB RAM, 20 GB | pgvector indexes grow with the knowledge base |
| redis | 0.5 GB | queue only, not a cache of record |

---

## Cost, honestly

Infrastructure is **not** the dominant cost at any real scale. Supplier spend is.

At 100 customers on a mixed plan distribution, if every customer consumed their full allowance:

| | Vercel + Railway | Vercel + AWS | Full AWS |
| --- | --- | --- | --- |
| infra | ~$90 | ~$215 | ~$260 |
| AI suppliers | ~$1,270 | ~$1,270 | ~$1,270 |
| **total** | **~$1,360** | **~$1,485** | **~$1,530** |

The gap between the cheapest and dearest option is about **12%** of the total bill. Choose on
reliability and operational fit, not on the infra line.

Two levers matter more than the host:

1. **Image egress.** Cloudflare R2 charges nothing for egress; S3 charges $0.09/GB. This product
   serves the same generated images repeatedly. Always put a CDN in front of media.
2. **Which models you route to.** A single `nano-banana` edit costs about 34 credits;
   a BiRefNet cutout costs 10. Model choice moves the bill far more than instance size.

All estimates are planning figures at the time of writing. **Verify current provider pricing
before committing** — cloud and model prices change frequently.
