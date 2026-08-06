# Deploy: Full Stack on AWS

Everything in one account and one VPC — frontend included. One bill, one IAM model, one network
boundary, and no third-party platform in the path.

**Time:** one to two days for a first deploy.
**Best for:** compliance requirements, enterprise procurement, or consolidating vendors.

---

## Target architecture

```
Route 53
   │
   ├── app.yourdomain.com   ──► CloudFront ──► ALB ──► ECS Fargate: web (Next.js SSR)
   ├── admin.yourdomain.com ──► CloudFront ──► ALB ──► ECS Fargate: admin
   ├── api.yourdomain.com   ──►              ALB ──► ECS Fargate: api
   └── cdn.yourdomain.com   ──► CloudFront ──► S3 (media)
                                               ECS Fargate: worker
                                               ECS Fargate: crawler
                                               RDS Postgres 16 (pgvector)
                                               ElastiCache Redis 7
```

The difference from [Vercel + AWS](./vercel-aws.md) is that `web` and `admin` become ECS services
instead of Vercel projects. Everything else is identical.

---

## Choosing how to run Next.js

| option | verdict |
| --- | --- |
| **ECS Fargate (recommended)** | Runs `next start` exactly like local. Predictable, no adapters. |
| Amplify Hosting | Simpler, but a managed platform — you gave up the reason to consolidate. |
| Lambda@Edge / OpenNext | Cheapest at low traffic; adds a build adapter and real debugging pain. |

This guide uses **Fargate**. It is the only option where the container you test is the container
you ship.

---

## Steps 1–6: identical to the Vercel + AWS guide

Follow [vercel-aws.md](./vercel-aws.md) for:

1. VPC, subnets, security groups
2. RDS PostgreSQL 16 + `CREATE EXTENSION vector`
3. ElastiCache Redis
4. S3 + CloudFront for media
5. ECR repositories
6. Secrets Manager

Add two more security groups and two more ECR repositories:

```bash
aws ecr create-repository --repository-name fennex-web
aws ecr create-repository --repository-name fennex-admin
```

| group | inbound |
| --- | --- |
| `fennex-web-sg` | 3000 from `fennex-alb-sg` |
| `fennex-admin-sg` | 3000 from `fennex-alb-sg` |

---

## Step 7 — Build the frontend images

`NEXT_PUBLIC_*` variables are **baked in at build time**, not read at runtime. The API URL must be
passed as a build argument, and changing it requires a rebuild.

Ensure `apps/web/next.config.js` sets `output: "standalone"` so the runtime image stays small.

```dockerfile
# apps/web/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build --workspace @fennex/web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com \
  -t fennex-web -f apps/web/Dockerfile .
docker tag fennex-web:latest <acct>.dkr.ecr.us-east-1.amazonaws.com/fennex-web:latest
docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/fennex-web:latest
```

> This is the sharpest difference from Vercel. There, changing the API URL is an env-var edit.
> Here it is a rebuild and redeploy.

---

## Step 8 — ECS services

Backend services (`api`, `worker`, `crawler`) and the one-off `fennex-migrate` task: exactly as in
[vercel-aws.md](./vercel-aws.md).

### Web service

- Task: 0.5 vCPU / 1 GB
- Port 3000, private subnets, `fennex-web-sg`
- Desired count 2, autoscale on CPU 70%, min 2 max 6
- Health check path `/`

### Admin service

- Task: 0.25 vCPU / 0.5 GB, desired count 1
- Internal use, but still behind the ALB with its own hostname

### ALB routing

One ALB, host-based rules:

| host | target group |
| --- | --- |
| `api.yourdomain.com` | api (8000) |
| `app.yourdomain.com` | web (3000) |
| `admin.yourdomain.com` | admin (3000) |

Request one ACM certificate covering all three (or a wildcard). Add each hostname as a listener
rule on the HTTPS listener; redirect 80 → 443.

**Restrict admin.** Add an ALB rule that returns 403 unless the source IP is in your office/VPN
range, or put it behind Cognito. It is a staff console with org-wide administrative reach.

---

## Step 9 — CloudFront in front of the app

Static assets served straight from Fargate through the ALB waste money and add latency.

1. Create a CloudFront distribution with the ALB as origin
2. Two cache behaviours:
   - `/_next/static/*` and `/static/*` → cache aggressively (immutable, content-hashed)
   - default `/*` → forward all cookies and headers, **no caching** (SSR must stay dynamic)
3. Point Route 53 `app.yourdomain.com` at CloudFront instead of the ALB

Getting the default behaviour wrong is the classic failure here: caching an authenticated SSR
response serves one customer's page to another. When in doubt, cache nothing outside `_next/static`.

---

## Step 10 — Deploy pipeline

Minimum viable, per release:

```bash
# 1. build + push all four images (api, crawler, web, admin)
# 2. run migrations ONCE
aws ecs run-task --cluster fennex --task-definition fennex-migrate \
  --launch-type FARGATE --network-configuration "..."
# 3. roll the services
for svc in api worker crawler web admin; do
  aws ecs update-service --cluster fennex --service fennex-$svc --force-new-deployment
done
```

Wire this into GitHub Actions with an OIDC role rather than long-lived keys.

---

## Step 11 — Verify

```bash
curl -s https://api.yourdomain.com/health
curl -s -o /dev/null -w "%{http_code}\n" https://app.yourdomain.com
aws logs tail /ecs/fennex-api --follow
```

Confirm no `UNMETERED SUPPLIER CALLS` line at API startup, then run the functional pass: signup,
image generation, credit movement, keyword search, test subscription. Also confirm
`admin.yourdomain.com` is **not** reachable from outside your allowlist.

---

## Cost estimate

**Assumptions:** us-east-1, 2 AZs, ~100 active customers, on-demand. **Verify current rates.**

### Fixed infrastructure

| item | spec | est. $/mo |
| --- | --- | --- |
| Fargate — api | 2 x 0.5 vCPU / 1 GB | ~$36 |
| Fargate — **web** | 2 x 0.5 vCPU / 1 GB | ~$36 |
| Fargate — **admin** | 1 x 0.25 vCPU / 0.5 GB | ~$9 |
| Fargate — worker | 1 x 0.5 vCPU / 1 GB | ~$18 |
| Fargate — crawler | 1 x 0.25 vCPU / 0.5 GB | ~$9 |
| RDS `db.t4g.small`, single-AZ | 20 GB gp3 | ~$25 |
| ElastiCache `cache.t4g.micro` | | ~$12 |
| ALB | + LCU | ~$20 – 28 |
| NAT Gateway | 1 | ~$35 – 45 |
| CloudFront — app | 100 GB | ~$9 |
| CloudFront — media | 200 GB | ~$17 |
| S3 | 100 GB | ~$2.30 |
| Route 53 | 1 zone + queries | ~$1 |
| Secrets Manager | ~15 secrets | ~$6 |
| CloudWatch Logs | | ~$8 |
| **Total fixed** | | **~$245 – 270** |

No Vercel bill, but two extra Fargate services more than replace it. **Full AWS is not cheaper
than Vercel + AWS at this size** — it is roughly $40–50/mo more for the same workload.

### Production-hardened variant

| addition | est. $/mo |
| --- | --- |
| RDS Multi-AZ | +$25 |
| Second NAT gateway | +$35 |
| RDS read replica | +$25 |
| AWS WAF on the ALB | +$10 – 20 |
| GuardDuty + Security Hub | +$15 – 30 |
| **Hardened total** | **~$355 – 420** |

### Savings levers

| change | saves |
| --- | --- |
| Compute Savings Plan, 1-year | ~20–30% of all Fargate |
| RDS Reserved Instance, 1-year | ~30–40% of RDS |
| Fargate Spot for worker + crawler | ~50% of those tasks |
| VPC endpoints for S3/ECR | cuts NAT data processing |
| Single-AZ + one NAT (dev/staging) | ~$70 |

### Realistic monthly total

| customers | infra | supplier | total |
| --- | --- | --- | --- |
| 20 | ~$230 | ~$105 | **~$335** |
| 100 | ~$260 | ~$1,270 | **~$1,530** |
| 500 | ~$500 | ~$6,500 | **~$7,000** |

---

## When this is the right choice

**Choose it for:** a single vendor and bill, compliance boundaries (VPC, IAM, private
networking, audit trails), enterprise procurement that rejects third-party hosting, or
consolidating an existing AWS estate.

**Do not choose it for cost.** At every volume modelled here it is the most expensive of the
three, and it carries the most operational work: five task definitions, an ALB rule set, a
CloudFront cache policy that will serve the wrong customer's page if you get it wrong, and a
frontend that needs a full rebuild to change its API URL.

If none of those requirements apply, [Vercel + Railway](./vercel-railway.md) delivers the same
product for roughly a fifth of the fixed cost.
