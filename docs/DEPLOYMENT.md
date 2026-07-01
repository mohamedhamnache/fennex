# Fennex — Deployment Guide

## Architecture overview

Fennex is a monorepo with four runtime components. Each deploys separately:

| Component | What it is | Where to deploy |
|-----------|-----------|-----------------|
| `apps/web` | Next.js 14 frontend | **Vercel** |
| `apps/api` | FastAPI backend | **Railway** (or Render / Fly.io) |
| `apps/api` (worker) | ARQ background worker | **Railway** (second service, same image) |
| `services/crawler` | Crawler microservice | **Railway** (third service) |

Supporting infrastructure:

| Service | Recommended provider | Free tier |
|---------|---------------------|-----------|
| PostgreSQL (+ pgvector) | [Supabase](https://supabase.com) | ✅ 500 MB |
| Redis | [Upstash](https://upstash.com) | ✅ 10 000 cmd/day |
| Object storage (images) | Supabase Storage | ✅ 1 GB |

---

## Step 1 — Provision the database (Supabase)

Supabase provides Postgres with pgvector pre-installed and an S3-compatible storage bucket — no separate storage service needed.

1. Create a free project at [supabase.com](https://supabase.com). Choose the region closest to your Railway deployment.

2. Enable the **pgvector** extension (required for semantic search):
   - Go to **Database → Extensions → vector** and toggle it on.
   - Or run in the SQL editor:
     ```sql
     CREATE EXTENSION IF NOT EXISTS vector;
     ```

3. Get your connection strings from **Project Settings → Database → Connection string**:

   | Use | String type | Port |
   |-----|------------|------|
   | App (SQLAlchemy) | **Session mode / pooler** | 6543 |
   | Migrations (Alembic) | **Direct connection** | 5432 |

   Both strings look like:
   ```
   # Pooled (app — use this for DATABASE_URL on Railway)
   postgresql://postgres.PROJECT_REF:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres

   # Direct (migrations only)
   postgresql://postgres:password@db.PROJECT_REF.supabase.co:5432/postgres
   ```

   For SQLAlchemy async, replace `postgresql://` → `postgresql+asyncpg://` in both.

   > **Important:** Use the **pooled** URL for `DATABASE_URL` (the app). Use the **direct** URL only when running `alembic upgrade head`.

4. Get the **Storage credentials** from **Project Settings → API**:
   - `Project URL` → `https://PROJECT_REF.supabase.co`
   - `service_role` key → used as `S3_SECRET_KEY`
   - Also go to **Storage → Policies** and create a bucket named `fennex-assets`.
   - For S3-compatible access go to **Storage → S3 connection** and copy the Access Key ID and Secret.

---

## Step 2 — Provision Redis (Upstash)

1. Create a free database at [console.upstash.com](https://console.upstash.com).
2. Copy the **Redis URL** (format: `rediss://default:password@host:6379`).

---

## Step 3 — Deploy the backend on Railway

### 3a. Create a Railway project

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
2. Select this repository.

### 3b. API service

1. In Railway, add a service → point it to `apps/api/`.
2. Set the **Start Command**:
   ```
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
3. Set all environment variables listed in the **Backend env vars** section below.
4. After the first deploy, run Alembic migrations using the **direct** Supabase URL:
   ```bash
   # Via Railway CLI:
   DATABASE_URL=postgresql+asyncpg://postgres:password@db.PROJECT_REF.supabase.co:5432/postgres \
     railway run alembic upgrade head
   ```

### 3c. Worker service

1. Add a second Railway service from the same repo / same Dockerfile (`apps/api/`).
2. Set the **Start Command**:
   ```
   python -m arq app.workers.worker.WorkerSettings
   ```
3. Use the **same environment variables** as the API service.

### 3d. Crawler service (optional)

1. Add a third Railway service pointing to `services/crawler/`.
2. Note the internal Railway URL (e.g. `crawler.railway.internal:8001`) and set it as `CRAWLER_SERVICE_URL` on the API service.

---

## Step 4 — Deploy the frontend on Vercel

### 4a. Create a Vercel project

1. Go to [vercel.com](https://vercel.com) → Add New Project → Import from GitHub.
2. Select this repository.
3. In **Build & Development Settings**, set:
   - **Root Directory**: `apps/web`
   - **Framework Preset**: Next.js (auto-detected)
   - Build Command: `npm run build`
   - Output Directory: `.next`

### 4b. Set environment variables

In Vercel → Project → Settings → Environment Variables, add every variable from `.env.vercel` (located at the repo root).

The only **required** variables for the frontend:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | Your Railway API URL, e.g. `https://fennex-api.up.railway.app` |
| `NEXT_PUBLIC_STRIPE_PRICE_*` | Price IDs from your Stripe dashboard |

To set them via CLI:
```bash
vercel env add NEXT_PUBLIC_API_URL production
# paste the value when prompted
```

### 4c. Deploy

```bash
# First deploy (prompts for project link):
vercel --prod

# Subsequent deploys happen automatically on push to main.
```

---

## Backend environment variables

Set all of these on the Railway API + Worker services.

```bash
# Environment
ENVIRONMENT=production
DEBUG=false

# Database — Supabase pooled URL (asyncpg driver)
DATABASE_URL=postgresql+asyncpg://postgres.PROJECT_REF:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Redis — Upstash rediss:// URL
REDIS_URL=rediss://default:password@host:6379

# Auth — generate with: openssl rand -hex 32
SECRET_KEY=<64-char-hex>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30

# Encryption for stored API keys — generate with: openssl rand -base64 32
ENCRYPTION_KEY=<base64-32-bytes>

# CORS — your Vercel domain (and preview URLs if needed)
CORS_ORIGINS=["https://yourdomain.com","https://www.yourdomain.com"]

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_ANNUAL=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
STRIPE_PRICE_AGENCY_MONTHLY=price_...
STRIPE_PRICE_AGENCY_ANNUAL=price_...

# Internal services
CRAWLER_SERVICE_URL=https://your-crawler.up.railway.app

# Frontend URL (for OAuth redirects)
FRONTEND_URL=https://yourdomain.com

# Google OAuth (optional — needed for Search Console integration)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://api.yourdomain.com/api/v1/analytics/gsc/callback

# Object storage — Supabase Storage (S3-compatible)
# Get from: Supabase Dashboard → Storage → S3 connection
S3_BUCKET=fennex-assets
S3_REGION=us-east-1
S3_ACCESS_KEY=<supabase-s3-access-key-id>
S3_SECRET_KEY=<supabase-s3-secret-access-key>
S3_ENDPOINT_URL=https://PROJECT_REF.supabase.co/storage/v1/s3

# Email — SendGrid (optional)
SENDGRID_API_KEY=
FROM_EMAIL=noreply@yourdomain.com
```

---

## Custom domain

1. In Vercel → Domains, add `yourdomain.com` and `www.yourdomain.com`.
2. Update DNS records as Vercel instructs (A/CNAME).
3. Update `NEXT_PUBLIC_API_URL` in Vercel to point to your Railway API URL.
4. Update `CORS_ORIGINS` on Railway to include your Vercel domain.
5. Update `FRONTEND_URL` on Railway to `https://yourdomain.com`.

---

## Stripe webhook

After going live, register a Stripe webhook:

- Endpoint URL: `https://api.yourdomain.com/api/v1/billing/webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET` on Railway.

---

## Database migrations

Use the **direct** Supabase connection string for migrations (pgbouncer/pooler doesn't support Alembic's DDL transactions):

```bash
# Via Railway CLI with direct URL override:
DATABASE_URL=postgresql+asyncpg://postgres:password@db.PROJECT_REF.supabase.co:5432/postgres \
  railway run alembic upgrade head

# Or open a Railway shell:
railway shell
DATABASE_URL=postgresql+asyncpg://postgres:password@db.PROJECT_REF.supabase.co:5432/postgres \
  alembic upgrade head
```

---

## Checklist before going live

- [ ] `SECRET_KEY` and `ENCRYPTION_KEY` are random and not the defaults
- [ ] `DEBUG=false` and `ENVIRONMENT=production` on Railway
- [ ] Supabase: pgvector extension enabled
- [ ] Supabase: `fennex-assets` storage bucket created
- [ ] Alembic migrations applied via **direct** Supabase URL
- [ ] CORS includes your Vercel domain
- [ ] Stripe webhook registered and `STRIPE_WEBHOOK_SECRET` set
- [ ] Google OAuth redirect URI updated to production API URL
- [ ] Custom domain configured on Vercel
