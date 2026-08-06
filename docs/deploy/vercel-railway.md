# Deploy: Frontend on Vercel, Backend on Railway

The fastest path to production. Railway runs the stateful and long-running parts; Vercel serves
the Next.js app on its edge network.

**Time:** about 2 hours for a first deploy.
**Best for:** launching, and staying there until traffic justifies moving.

---

## What you are deploying

| component | where | why |
| --- | --- | --- |
| `web` (Next.js) | Vercel | built for it; free-tier friendly |
| `api` (FastAPI) | Railway service | long-lived HTTP |
| `worker` (arq) | Railway service | background jobs, no HTTP |
| `crawler` | Railway service | separate scaling profile |
| Postgres **+ pgvector** | Railway Postgres | pgvector required |
| Redis | Railway Redis | arq queue |
| Object storage | Cloudflare R2 or AWS S3 | Railway has no S3 equivalent |

`admin` is optional — deploy it as a second Vercel project or skip it initially.

> **pgvector is not optional.** Knowledge-base search stores embeddings as vectors. Verify the
> extension is available before going further.

---

## Step 1 — Prerequisites

1. GitHub repo pushed
2. Accounts: [Railway](https://railway.app), [Vercel](https://vercel.com), Stripe
3. Supplier keys: OpenAI, Anthropic, Replicate, DataForSEO (+ Google/LinkedIn/SendGrid if used)
4. An S3-compatible bucket. **Cloudflare R2 is recommended** — zero egress fees, which matters
   because this product serves a lot of images.

---

## Step 2 — Provision data stores on Railway

1. **New Project** → **Provision PostgreSQL**
2. **Add** → **Database** → **Redis**
3. Open the Postgres service → **Data** tab → run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

If that fails, stop — you need a Postgres with pgvector (Neon and Supabase both offer it).

Railway injects `DATABASE_URL` and `REDIS_URL` into services in the same project.

> The app uses **asyncpg**. `DATABASE_URL` must use the `postgresql+asyncpg://` scheme. If
> Railway's variable is `postgresql://`, set your own:
> `DATABASE_URL=postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}`

---

## Step 3 — Object storage (Cloudflare R2)

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `fennex-media`)
2. **Manage R2 API Tokens** → create a token with Object Read & Write
3. Note the **Account ID**, Access Key ID, Secret Access Key

```
S3_BUCKET=fennex-media
S3_REGION=auto
S3_ACCESS_KEY=<access key id>
S3_SECRET_KEY=<secret>
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
```

Enable public read (or a custom domain) on the bucket — generated images are served to browsers.

---

## Step 4 — Deploy the API

1. Railway → **New** → **GitHub Repo** → select the repo
2. **Settings** → **Root Directory**: `apps/api`
3. Railway detects the Dockerfile. Set the start command:

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Running migrations in the start command is fine for a single API instance. **If you scale past
one replica, move migrations to a separate release step** — concurrent `alembic upgrade` on boot
will race.

4. **Networking** → **Generate Domain** → note it (e.g. `fennex-api.up.railway.app`)

### Environment variables

```bash
ENVIRONMENT=production
DEBUG=false
SECRET_KEY=<openssl rand -hex 32>
ENCRYPTION_KEY=<Fernet key, see below>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

DATABASE_URL=<postgresql+asyncpg://...>
REDIS_URL=${{Redis.REDIS_URL}}

FRONTEND_URL=https://app.yourdomain.com
CORS_ORIGINS=https://app.yourdomain.com
CRAWLER_SERVICE_URL=http://crawler.railway.internal:8001

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
REPLICATE_API_KEY=
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=

S3_BUCKET=
S3_REGION=auto
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_ENDPOINT_URL=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER_MONTHLY=
STRIPE_PRICE_STARTER_ANNUAL=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_PRICE_PRO_ANNUAL=
STRIPE_PRICE_AGENCY_MONTHLY=
STRIPE_PRICE_AGENCY_ANNUAL=
STRIPE_PRICE_SCALE_MONTHLY=
STRIPE_PRICE_SCALE_ANNUAL=

SENDGRID_API_KEY=
FROM_EMAIL=noreply@yourdomain.com
PLATFORM_ADMIN_EMAILS=you@yourdomain.com
ADMIN_BOOTSTRAP_EMAIL=you@yourdomain.com
ADMIN_BOOTSTRAP_PASSWORD=<strong password>
```

Generate the encryption key (it encrypts tenant API keys at rest):

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

> **Losing `ENCRYPTION_KEY` makes every stored tenant credential unrecoverable.** Back it up
> somewhere other than Railway.

---

## Step 5 — Deploy the worker

1. **New** → **GitHub Repo**, same repo, root directory `apps/api`
2. Start command:

```bash
python -m arq app.workers.worker.WorkerSettings
```

3. Copy **the same environment variables** as the API. The worker runs LLM and Replicate jobs, so
   it needs every supplier key and the S3 config.
4. No public domain — it serves no HTTP.

> The worker must **not** run migrations. One migrator only.

---

## Step 6 — Deploy the crawler

1. **New** → **GitHub Repo**, root directory `services/crawler`
2. Start command per that service's Dockerfile (binds `$PORT`)
3. Keep it private; the API reaches it on the internal hostname

---

## Step 7 — Deploy the frontend on Vercel

1. Vercel → **Add New** → **Project** → import the repo
2. **Root Directory**: `apps/web`
3. Framework preset: Next.js
4. Environment variable:

```
NEXT_PUBLIC_API_URL=https://fennex-api.up.railway.app
```

5. Deploy, then add your custom domain (`app.yourdomain.com`)
6. Return to Railway and set `CORS_ORIGINS` / `FRONTEND_URL` to the final domain

This is a **monorepo**. If the build fails resolving workspace packages, set the install command
to `npm install --workspaces` (or the pnpm equivalent) at the repo root and keep the root
directory at `apps/web`.

---

## Step 8 — Stripe webhook

1. Stripe → **Developers** → **Webhooks** → **Add endpoint**
2. URL: `https://<api-domain>/api/v1/webhooks/stripe`
3. Events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_failed`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy

---

## Step 9 — Verify

```bash
curl -s https://<api-domain>/health
curl -s -o /dev/null -w "%{http_code}\n" https://app.yourdomain.com
```

Then check, in order:

1. **API logs mention no unmetered supplier calls.** The metering audit logs at startup; an
   `UNMETERED SUPPLIER CALLS` line means real money is being spent without billing.
2. Sign up, create a project — proves DB + migrations.
3. Generate an image — proves supplier keys, S3, and metering.
4. Check usage: credits should have moved.
5. Run a keyword search — proves DataForSEO and the SEO bucket.
6. Complete a test subscription — proves Stripe and the webhook.

---

## Cost estimate

**Assumptions:** ~100 active customers, moderate usage, us-east. **Verify current pricing** —
these are planning figures, not quotes.

### Fixed infrastructure

| item | spec | est. $/mo |
| --- | --- | --- |
| Railway API | 1 GB RAM / 1 vCPU | $10 – 20 |
| Railway worker | 1 GB RAM / 1 vCPU | $10 – 20 |
| Railway crawler | 0.5 GB RAM | $5 – 10 |
| Railway Postgres | 1 GB RAM, 20 GB disk | $15 – 25 |
| Railway Redis | 0.5 GB | $5 – 10 |
| Vercel | Pro (needed for teams/analytics) | $20 |
| Cloudflare R2 | 100 GB, zero egress | ~$1.50 |
| **Total fixed** | | **$67 – 107** |

Railway bills by actual usage, so idle services cost less than the ceiling.

Small start (10–20 customers): **$25 – 40/mo** on Railway's Hobby plan with Vercel free.

### Variable supplier cost

This dominates at scale and is **passed through as credits**.

| plan | credits | supplier cost at $0.00105/credit | price | gross margin |
| --- | --- | --- | --- | --- |
| starter | 5,000 | $5.25 | $29 | ~82% |
| pro | 18,000 | $18.90 | $99 | ~81% |
| agency | 55,000 | $57.75 | $299 | ~81% |
| scale | 150,000 | $157.50 | $799 | ~80% |

Those are worst-case: they assume every customer burns their full allowance, and ignore that
floors bill many operations **above** cost.

### Realistic monthly total

| customers | mix | infra | supplier (if fully consumed) | total |
| --- | --- | --- | --- | --- |
| 20 | mostly starter | ~$35 | ~$105 | **~$140** |
| 100 | 60 starter / 35 pro / 5 agency | ~$90 | ~$1,270 | **~$1,360** |
| 500 | mixed | ~$250 | ~$6,500 | **~$6,750** |

Revenue at 100 customers on that mix is roughly **$6,700/mo**, against ~$1,360 of cost.

### Where it hurts

- **Egress.** Images are large and served repeatedly. R2's zero egress is the single biggest
  lever; the same traffic on S3 could add hundreds per month.
- **Replicate.** A handful of heavy operations (nano-banana at 39,000 micro-$, flux-fill at
  50,000) dominate image spend. The floors protect you on cheap ops, not these.
- **Idle worker.** It bills whether or not jobs run.

---

## Limits of this setup

- **Single-region.** Railway does not span regions; latency outside it will show.
- **Migrations in the start command** break if you scale the API past one replica.
- **No autoscaling** comparable to ECS/Fargate.
- **Backups** are Railway's own; verify retention meets your needs before you have customers.

When you outgrow it, the natural next step is
[frontend on Vercel, backend on AWS](./vercel-aws.md).
