# Environment & Configuration
## Inventory Management System (IMS)

**Version:** 1.0
**Companion to:** `01_PRD.md`, `02_DATABASE.md`

This document describes all environment variables and configuration for the backend (Node.js/Express) and frontend (React) of the IMS, across local, staging, and production environments.

---

## 1. Stack summary

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Node.js 20 LTS + Express (or NestJS) + TypeScript |
| Database | PostgreSQL 15+ |
| Cache / queue | Redis 7 (sessions, rate-limit, background jobs) |
| Object storage | S3-compatible (AWS S3 / MinIO) for attachments |
| Auth | JWT (access + refresh tokens) |
| Email | SMTP / transactional provider (alerts, invites) |

---

## 2. Backend `.env`

Create `backend/.env` from `backend/.env.example`. **Never commit real secrets.**

```dotenv
# ── App ───────────────────────────────────────────────
NODE_ENV=development            # development | staging | production
APP_NAME=IMS
PORT=4000
API_BASE_PATH=/api/v1
APP_BASE_URL=http://localhost:4000
FRONTEND_URL=http://localhost:5173      # for CORS + email links

# ── Database (PostgreSQL) ─────────────────────────────
DATABASE_URL=postgresql://ims_user:change_me@localhost:5432/ims
DB_POOL_MIN=2
DB_POOL_MAX=10
DB_SSL=false                    # true in production (managed PG)

# ── Redis ─────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Auth / JWT ────────────────────────────────────────
JWT_ACCESS_SECRET=replace_with_long_random_string
JWT_REFRESH_SECRET=replace_with_another_long_random_string
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
PASSWORD_SALT_ROUNDS=12         # bcrypt cost (use argon2id in prod if available)

# ── Object storage (attachments) ──────────────────────
STORAGE_PROVIDER=s3             # s3 | minio | local
S3_ENDPOINT=http://localhost:9000   # MinIO endpoint; omit for AWS
S3_REGION=ap-southeast-1
S3_BUCKET=ims-attachments
S3_ACCESS_KEY_ID=change_me
S3_SECRET_ACCESS_KEY=change_me
S3_FORCE_PATH_STYLE=true        # true for MinIO
MAX_UPLOAD_MB=25

# ── Email / SMTP ──────────────────────────────────────
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASSWORD=change_me
EMAIL_FROM="IMS <no-reply@example.com>"

# ── Security ──────────────────────────────────────────
CORS_ORIGINS=http://localhost:5173
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120              # requests per window per IP
COOKIE_SECRET=replace_with_random_string
ENABLE_HTTPS_REDIRECT=false     # true in production

# ── Business defaults ─────────────────────────────────
DEFAULT_BASE_CURRENCY=USD
WRITE_OFF_APPROVAL_THRESHOLD=500   # value above which manager approval required
ALLOW_NEGATIVE_STOCK=false
EXCHANGE_RATE_PROVIDER=manual      # manual | openexchangerates | ecb
EXCHANGE_RATE_API_KEY=             # if using an external provider

# ── Observability ─────────────────────────────────────
LOG_LEVEL=info                  # debug | info | warn | error
SENTRY_DSN=
```

---

## 3. Frontend `.env`

Create `frontend/.env` from `frontend/.env.example`. Vite only exposes vars prefixed with `VITE_`.

```dotenv
VITE_API_URL=http://localhost:4000/api/v1
VITE_APP_NAME=IMS
VITE_ENABLE_BARCODE_SCAN=true
VITE_DEFAULT_PAGE_SIZE=50
VITE_SENTRY_DSN=
```

---

## 4. Variable reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | yes | development | Runtime mode; toggles strictness, SSL, redirects. |
| `PORT` | yes | 4000 | Backend HTTP port. |
| `DATABASE_URL` | yes | — | Postgres connection string. |
| `DB_SSL` | no | false | Require TLS to DB (true for managed/prod). |
| `REDIS_URL` | yes | — | Redis for sessions, rate-limit, job queue. |
| `JWT_ACCESS_SECRET` | yes | — | Signs short-lived access tokens. |
| `JWT_REFRESH_SECRET` | yes | — | Signs refresh tokens. Must differ from access. |
| `JWT_ACCESS_TTL` | no | 15m | Access-token lifetime. |
| `JWT_REFRESH_TTL` | no | 7d | Refresh-token lifetime. |
| `PASSWORD_SALT_ROUNDS` | no | 12 | bcrypt cost factor. |
| `STORAGE_PROVIDER` | yes | local | Where attachments are stored. |
| `S3_*` | if s3/minio | — | Object-storage credentials & bucket. |
| `MAX_UPLOAD_MB` | no | 25 | Per-file upload cap. |
| `SMTP_*` | for email | — | Outbound mail for alerts/invites. |
| `CORS_ORIGINS` | yes | — | Comma-separated allowed origins. |
| `RATE_LIMIT_MAX` | no | 120 | Max requests/window/IP. |
| `DEFAULT_BASE_CURRENCY` | no | USD | Org base currency for valuation. |
| `WRITE_OFF_APPROVAL_THRESHOLD` | no | 500 | Value needing manager approval. |
| `ALLOW_NEGATIVE_STOCK` | no | false | Block vs. warn on over-issue. |
| `EXCHANGE_RATE_PROVIDER` | no | manual | Source of FX rates. |
| `LOG_LEVEL` | no | info | Logging verbosity. |
| `SENTRY_DSN` | no | — | Error tracking. |

---

## 5. Environments

| | Local | Staging | Production |
|---|---|---|---|
| `NODE_ENV` | development | staging | production |
| DB | local Docker PG | managed PG (small) | managed PG (HA + backups) |
| `DB_SSL` | false | true | true |
| Storage | MinIO (Docker) | S3 bucket | S3 bucket (versioned) |
| `ENABLE_HTTPS_REDIRECT` | false | true | true |
| Secrets | `.env` file | secret manager | secret manager (rotated) |
| `LOG_LEVEL` | debug | info | warn |

**Production:** never store secrets in `.env` files on disk — use a secrets manager (AWS Secrets Manager, GCP Secret Manager, Vault, or platform env vars). Rotate `JWT_*` and DB credentials periodically.

---

## 6. Local setup (Docker Compose excerpt)

```yaml
# docker-compose.yml (dev)
services:
  db:
    image: postgres:15
    environment:
      POSTGRES_USER: ims_user
      POSTGRES_PASSWORD: change_me
      POSTGRES_DB: ims
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7
    ports: ["6379:6379"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: change_me
      MINIO_ROOT_PASSWORD: change_me
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]

volumes:
  pgdata:
  miniodata:
```

### First-run commands
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
docker compose up -d            # db, redis, minio
cd backend
npm install
npm run db:migrate              # apply schema (02_DATABASE.md)
npm run db:seed                 # currencies, demo org/admin
npm run dev                     # starts API on :4000
cd ../frontend
npm install
npm run dev                     # starts UI on :5173
```

---

## 7. Configuration best practices
- Keep `.env.example` in version control with placeholder values; keep real `.env` in `.gitignore`.
- Validate env at boot (e.g., with `zod` / `envalid`) and fail fast on missing required vars.
- Use distinct secrets per environment; never reuse production secrets locally.
- Make business rules (thresholds, base currency, negative-stock policy) overridable per project via `projects.settings` JSONB, falling back to these env defaults.
