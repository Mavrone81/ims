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

### Demo accounts (seeded)

| Email | Password | Role |
|---|---|---|
| `admin@ims.local` | `admin123` | Organization admin |
| `manager@ims.local` | `manager123` | Manager on Maintenance-CNW |
| `tech@ims.local` | `tech123` | Technician on Maintenance-CNW |

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
- **Audit** — every mutation logged to `audit_logs` (who/what/before/after/IP).
- **UI** — dashboard (KPIs, low stock, recent movements), Excel-style inventory
  grid with filters, item detail with ledger history, type-switching movement
  modal with live balance preview, admin area (custom-field builder, users,
  sites/projects/locations, currencies & FX).

## Deferred (per docs phasing)

- Attachments (S3/MinIO), purchase orders + receive flow, email notifications,
  barcode *scanning* via camera (lookup endpoint exists), Redis-backed rate
  limiting/sessions (in-memory + Postgres substitutes in place), OpenAPI doc
  generation, xlsx parsing server-side (import accepts JSON rows; the UI can
  parse CSV client-side).

## API

Base URL `http://localhost:4000/api/v1` — see [`docs/04_API.md`](docs/04_API.md).
All endpoints except `/auth/*` and `/health` need `Authorization: Bearer <token>`;
project-scoped endpoints also need `X-Project-Id: <uuid>`.

```bash
# smoke test
curl -s localhost:4000/api/v1/health
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ims.local","password":"admin123"}' | jq -r .access_token)
```

## Configuration

Copy `backend/.env.example` → `backend/.env` and set `DATABASE_URL` to match
`docker-compose.yml` (`postgresql://ims_user:ims_dev_password@localhost:5432/ims`
for local dev) plus random JWT secrets. The frontend needs no `.env` in dev
(Vite proxies `/api` to `:4000`). Variable reference: [`docs/03_ENV.md`](docs/03_ENV.md).
