# Deploy: Frontend on Vercel, Backend on AWS

Vercel keeps the frontend simple; AWS gives the backend real scaling, managed Postgres with
proper backups, and S3 next to the compute that writes it.

**Time:** most of a day for a first deploy.
**Best for:** past ~100 customers, or when you need multi-AZ and point-in-time recovery.

---

## Target architecture

```
Vercel (web)  ──►  ALB  ──►  ECS Fargate: api  ──►  RDS Postgres (pgvector)
                              ECS Fargate: worker ──►  ElastiCache Redis
                              ECS Fargate: crawler     S3 (media)
```

| component | AWS service |
| --- | --- |
| `api` | ECS Fargate behind an Application Load Balancer |
| `worker` | ECS Fargate, no load balancer |
| `crawler` | ECS Fargate, internal only |
| Postgres | RDS PostgreSQL 16 with **pgvector** |
| Redis | ElastiCache for Redis 7 |
| Media | S3 + CloudFront |
| Images | ECR |
| Secrets | Secrets Manager |

---

## Step 1 — Network

Use the VPC wizard: **2 AZs**, public + private subnets, **1 NAT gateway**.

- ECS tasks and RDS go in **private** subnets
- The ALB goes in **public** subnets
- One NAT gateway (~$32/mo) is the cost/redundancy compromise; two costs double

Security groups:

| group | inbound |
| --- | --- |
| `fennex-alb-sg` | 443 from `0.0.0.0/0` |
| `fennex-api-sg` | 8000 from `fennex-alb-sg` |
| `fennex-worker-sg` | none |
| `fennex-rds-sg` | 5432 from api-sg + worker-sg |
| `fennex-redis-sg` | 6379 from api-sg + worker-sg |

---

## Step 2 — RDS with pgvector

1. RDS → **Create database** → PostgreSQL **16**
2. Start with `db.t4g.micro` (dev) or `db.t4g.small` (production)
3. 20 GB gp3, storage autoscaling on
4. **Multi-AZ**: off to start, on when downtime matters
5. Private subnets, `fennex-rds-sg`, **not** publicly accessible
6. Enable automated backups (7 days) and Performance Insights

Then enable the extension:

```bash
psql "postgresql://<user>:<pass>@<endpoint>:5432/postgres"
```
```sql
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

pgvector ships with RDS PostgreSQL 15.5+ and 16.x. If `CREATE EXTENSION` fails, your minor
version is too old — upgrade before continuing.

---

## Step 3 — ElastiCache Redis

1. ElastiCache → **Create** → Redis → **cluster mode disabled**
2. `cache.t4g.micro`, 1 node to start
3. Private subnets, `fennex-redis-sg`
4. Note the primary endpoint → `REDIS_URL=redis://<endpoint>:6379`

Encryption in transit requires `rediss://`; leave it off initially unless compliance demands it.

---

## Step 4 — S3 + CloudFront

```bash
aws s3api create-bucket --bucket fennex-media --region us-east-1
aws s3api put-bucket-cors --bucket fennex-media --cors-configuration '{
  "CORSRules":[{"AllowedOrigins":["https://app.yourdomain.com"],
  "AllowedMethods":["GET","PUT","POST"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]}'
```

Put **CloudFront** in front of it. This is not optional at any real volume: S3 egress is
$0.09/GB, CloudFront is cheaper per GB and caches repeat views, and this product serves the same
generated images many times.

Create an IAM user (or better, a task role) limited to `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject` on `arn:aws:s3:::fennex-media/*`.

---

## Step 5 — Push images to ECR

```bash
aws ecr create-repository --repository-name fennex-api
aws ecr create-repository --repository-name fennex-crawler

aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com

docker build -t fennex-api ./apps/api
docker tag fennex-api:latest <acct>.dkr.ecr.us-east-1.amazonaws.com/fennex-api:latest
docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/fennex-api:latest
```

The API and worker share one image; only the command differs.

---

## Step 6 — Secrets Manager

```bash
aws secretsmanager create-secret --name fennex/production --secret-string '{
  "SECRET_KEY":"...","ENCRYPTION_KEY":"...","DATABASE_URL":"postgresql+asyncpg://...",
  "REDIS_URL":"redis://...","OPENAI_API_KEY":"...","ANTHROPIC_API_KEY":"...",
  "REPLICATE_API_KEY":"...","DATAFORSEO_LOGIN":"...","DATAFORSEO_PASSWORD":"...",
  "STRIPE_SECRET_KEY":"...","STRIPE_WEBHOOK_SECRET":"...","SENDGRID_API_KEY":"...",
  "S3_ACCESS_KEY":"...","S3_SECRET_KEY":"..."
}'
```

Reference each key individually in the task definition via `secrets[].valueFrom` with a
`:key::` suffix. Back up `ENCRYPTION_KEY` outside AWS — losing it makes every stored tenant
credential unrecoverable.

---

## Step 7 — ECS cluster and services

Create cluster `fennex` (Fargate).

### Migrations run once, on their own

Register a task definition `fennex-migrate` with command:

```
alembic upgrade head
```

Run it as a **one-off task** before each deploy that includes a migration. Do **not** put
`alembic upgrade` in the API start command here — with more than one API task, concurrent
migrations race.

### API service

- Task: 0.5 vCPU / 1 GB (raise to 1 vCPU / 2 GB under load)
- Command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Port 8000, private subnets, `fennex-api-sg`
- Desired count 2 for availability
- Target group health check: **`/health`**
- Autoscaling: target 70% CPU, min 2, max 6

### Worker service

- Task: 0.5 vCPU / 1 GB
- Command: `python -m arq app.workers.worker.WorkerSettings`
- No load balancer, no public IP
- Desired count 1; scale on queue depth if jobs back up

### Crawler service

- Task: 0.25 vCPU / 0.5 GB, internal only

### ALB

1. Application Load Balancer in public subnets, `fennex-alb-sg`
2. ACM certificate for `api.yourdomain.com`
3. HTTPS:443 → target group → API tasks on 8000; redirect 80 → 443
4. Route 53 alias `api.yourdomain.com` → ALB

---

## Step 8 — Frontend on Vercel

Identical to the Railway guide:

1. Import the repo, **Root Directory** `apps/web`
2. `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`
3. Add `app.yourdomain.com`
4. Set `CORS_ORIGINS` and `FRONTEND_URL` in Secrets Manager to that domain and redeploy the API

---

## Step 9 — Stripe webhook

Endpoint `https://api.yourdomain.com/api/v1/webhooks/stripe`, same events as the Railway guide,
signing secret into Secrets Manager.

---

## Step 10 — Verify

```bash
curl -s https://api.yourdomain.com/health
aws logs tail /ecs/fennex-api --follow
```

Check CloudWatch for `UNMETERED SUPPLIER CALLS` at API startup — that line means money is being
spent without billing. Then run the same functional checks as the Railway guide: signup, image
generation, credit movement, keyword search, test subscription.

---

## Cost estimate

**Assumptions:** us-east-1, 2 AZs, ~100 active customers. On-demand pricing. **Verify current
rates** — these are planning figures.

### Fixed infrastructure

| item | spec | est. $/mo |
| --- | --- | --- |
| ECS Fargate — api | 2 tasks x 0.5 vCPU / 1 GB | ~$36 |
| ECS Fargate — worker | 1 task x 0.5 vCPU / 1 GB | ~$18 |
| ECS Fargate — crawler | 1 task x 0.25 vCPU / 0.5 GB | ~$9 |
| RDS `db.t4g.small`, single-AZ | 20 GB gp3 | ~$25 |
| ElastiCache `cache.t4g.micro` | 1 node | ~$12 |
| Application Load Balancer | + LCU | ~$18 – 25 |
| **NAT Gateway** | 1, + data processing | **~$35 – 45** |
| S3 | 100 GB | ~$2.30 |
| CloudFront | 200 GB out | ~$17 |
| Secrets Manager | ~15 secrets | ~$6 |
| CloudWatch Logs | modest retention | ~$5 |
| Vercel Pro | | $20 |
| **Total fixed** | | **~$205 – 230** |

Multi-AZ RDS roughly **doubles the database line**. A second NAT gateway adds ~$35.

### Cheaper variants

| change | saves |
| --- | --- |
| Fargate **Spot** for the worker | ~50% of that task |
| Compute Savings Plan, 1-year | ~20–30% of Fargate |
| RDS Reserved Instance, 1-year | ~30–40% of RDS |
| VPC endpoints for S3/ECR instead of NAT traffic | meaningful NAT reduction |
| Drop the crawler onto the API task | ~$9 |

### Variable supplier cost

Identical to any other host — see [AI Credits and Models](../ai-credits-and-models.md). At 100
customers on a mixed plan distribution, roughly **$1,270/mo** if every allowance is fully
consumed.

### Realistic monthly total

| customers | infra | supplier | total |
| --- | --- | --- | --- |
| 20 | ~$180 | ~$105 | **~$285** |
| 100 | ~$215 | ~$1,270 | **~$1,485** |
| 500 | ~$400 | ~$6,500 | **~$6,900** |

At low volume this is **more expensive than Railway** — the ALB and NAT gateway cost the same
whether you have 5 customers or 500. It wins on reliability and on scale, not on price.

---

## Trade-offs

**Gained:** multi-AZ, point-in-time recovery, real autoscaling, IAM, VPC isolation, CloudFront,
and one bill for compute and storage.

**Paid:** roughly $100/mo of baseline (ALB + NAT) before serving a request, plus materially more
operational work — task definitions, IAM policies, and a migration step you must remember to run.

If you don't need multi-AZ yet, [Railway](./vercel-railway.md) does the same job for a third of
the fixed cost.
