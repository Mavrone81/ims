# IMS — Inventory Management System

Multi-site / multi-project inventory management with an immutable stock ledger,
derived balances, admin-defined custom fields, RBAC, and multi-currency reporting.
Built from the design package in [`docs/`](docs/README.md).

**Stack:** React 18 (Vite + TS) · Node.js/Express (TS) · PostgreSQL 15.

```
IMS/
├── docs/        # PRD, database design, env, API spec, UI/UX design
├── backend/     # Express API (TypeScript, ESM)
│   ├── migrations/   # SQL schema (applied in order by db:migrate)
│   └── src/          # config, db, middleware, routes, seed
├── frontend/    # React SPA (Vite)
└── docker-compose.yml  # local Postgres
```

## Quick start

Requires Node 20+ and Docker.

```bash
# 1. Infrastructure
docker compose up -d                 # Postgres on :5432

# 2. Backend
cd backend
npm install
npm run db:migrate                   # apply schema
npm run db:seed                      # demo org, users, items, ledger
npm run dev                          # API on http://localhost:4000/api/v1

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                          # UI on http://localhost:5173 (proxies /api)
```

### Demo accounts (seeded — login by username)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Organization admin |
| `manager` | `manager123` | Manager on Maintenance-CNW |
| `tech` | `tech123` | Technician on Maintenance-CNW |
| `audit` | `audit123` | Viewer/auditor on Maintenance-CNW |

See [`docs/06_LOGIN.md`](docs/06_LOGIN.md) for the user-facing login guide.

## What's implemented

- **Auth & RBAC** — JWT access/refresh with rotation + revocation; per-project
  roles (viewer / technician / manager) plus org admin; enforced server-side.
- **Immutable ledger** — stock balance is *derived*: every movement (receipt,
  issue, transfer, adjustment, write-off, opening) is an append-only
  `stock_transactions` row; a trigger maintains the `stock_levels` cache.
  Corrections are reversing entries, never edits.
- **Business rules** — over-issue blocked (configurable per project via
  `projects.settings.allow_negative_stock`), write-offs above a value threshold
  require a manager, transfers between locations.
- **Items** — CRUD with soft-delete/archive, duplicate warning, barcode lookup,
  CSV export, bulk JSON import with dry-run validation + opening balances.
- **Custom fields** — admin-defined per category (text/number/date/boolean/
  select/multiselect), typed EAV storage + JSONB mirror, rendered dynamically
  on item forms.
- **Multi-site / multi-project** — sites, projects, locations, per-project
  membership; `X-Project-Id` header scopes all inventory operations.
- **Multi-currency** — currency table + effective-dated exchange rates;
  valuation/ABC reports convert to a selectable base currency.
- **Reports** — valuation, reorder/low-stock, movements summary, ABC analysis
  (80/15/5 value share), write-offs; all exportable to CSV.
- **Purchasing** — lightweight purchase orders (draft → ordered → partial →
  received); receiving a line posts a `receipt` ledger entry so on-hand stays
  derived, advances PO status, and blocks over-receipt.
- **Audit** — every mutation logged to `audit_logs` (who/what/before/after/IP).
- **UI** — dashboard (KPIs, low stock, recent movements), Excel-style inventory
  grid with filters, item detail with ledger history, type-switching movement
  modal with live balance preview, admin area (custom-field builder, users,
  sites/projects/locations, currencies & FX).

## Deferred (per docs phasing)

- Attachments (S3/MinIO), email notifications, barcode *scanning* via camera
  (lookup endpoint exists), Redis-backed rate limiting/sessions (in-memory +
  Postgres substitutes in place), OpenAPI doc generation, xlsx parsing
  server-side (import accepts JSON rows; the UI can parse CSV client-side).

> The design docs in [`docs/`](docs/README.md) are kept reconciled with this
> build — see the **As-built** callouts in `docs/02_DATABASE.md`,
> `docs/03_ENV.md`, and `docs/04_API.md`.

## API

Base URL `http://localhost:4000/api/v1` — see [`docs/04_API.md`](docs/04_API.md).
All endpoints except `/auth/*` and `/health` need `Authorization: Bearer <token>`;
project-scoped endpoints also need `X-Project-Id: <uuid>`.

```bash
# smoke test
curl -s localhost:4000/api/v1/health
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .access_token)
```

## Production deployment (CI/CD)

Production runs at **https://ims.urbanwerkzsg.com** via `docker-compose.prod.yml`
(services `db` / `api` / `web`; the DB persists in the named volume `ims_pgdata`).
Deploys use a **server-side pull model** — no GitHub Actions or secrets:

1. A cron job on the server runs [`deploy/auto-deploy-ims.sh`](deploy/auto-deploy-ims.sh)
   every minute under `flock` (installed at `/root/auto-deploy-ims.sh`).
2. On a new commit on `main`, it `git reset --hard origin/main` (code only —
   the server-managed `.env` and DB volume are git-ignored/untouched) and runs
   `docker compose -f docker-compose.prod.yml up -d --build api web`.
3. Migrations run automatically on api boot (idempotent, additive-only).
4. Logs: `/var/log/ims-deploy.log` on the server.

So **pushing to `main` deploys to production within ~1 minute.** Secrets live
only in `/root/ims/.env` on the server (template: `.env.prod.example`).

## Configuration

Copy `backend/.env.example` → `backend/.env` and set `DATABASE_URL` to match
`docker-compose.yml` (`postgresql://ims_user:ims_dev_password@localhost:5432/ims`
for local dev) plus random JWT secrets. The frontend needs no `.env` in dev
(Vite proxies `/api` to `:4000`). Variable reference: [`docs/03_ENV.md`](docs/03_ENV.md).
