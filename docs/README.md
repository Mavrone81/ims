# Inventory Management System (IMS) — Documentation

Full documentation set for a robust, multi-site / multi-project Inventory Management System with admin-defined custom fields, derived stock balances from an immutable transaction ledger, and multi-currency reporting. Built from the field set in the existing *Maintenance spare part inventory* Excel workbook and validated against standard MRO/IMS practices.

**Stack:** React (Vite + TS) · Node.js/Express (TS) · PostgreSQL 15+ · Redis · S3-compatible storage.

## Documents
1. [PRD](01_PRD.md) — product requirements, personas, functional/non-functional requirements, migration, release plan.
2. [Database Design & ER Diagram](02_DATABASE.md) — Mermaid ERD, PostgreSQL DDL, views, Excel→schema mapping.
3. [Environment & Configuration](03_ENV.md) — backend/frontend `.env`, variable reference, Docker setup.
4. [REST API Specification](04_API.md) — endpoints, auth, RBAC, request/response examples.
5. [UI/UX Design](05_UIUX.md) — design system, screens, flows, responsive & accessibility.
6. [Login Guide](06_LOGIN.md) — end-user sign-in guide (username login).

> **Docs ↔ build status (reconciled 2026-06-14).** Docs 2–4 are kept in sync with
> the running implementation; an **As-built** callout flags where the build differs
> from the original v1 design. The repo root [`README.md`](../README.md) "What's
> implemented" / "Deferred" sections and `UAT.md` are the canonical status. The
> PRD (doc 1) and UI/UX (doc 5) remain the product/design intent.

## Core design decisions
- **Stock balance is derived** from `stock_transactions` (append-only ledger), cached in `stock_levels`. The Excel "Purpose & Date / Qty Change" columns become individual transaction rows.
- **Extensible:** admins create projects, items, categories, and **custom fields** (text/number/date/boolean/select) without code changes; movement types are **customizable labels** mapped to built-in behaviours.
- **Multi-site / multi-project** with per-project role-based access (manager / technician / viewer + org admin).
- **Multi-currency** via an effective-dated `exchange_rates` table, replacing per-row currency cells.

## Built beyond the original design (post-v1, see migrations 002–006)
- **Username login** (email is optional, encrypted PII) with refresh-token rotation/revocation.
- **Platform layer** (`/platform`) — super-admins provision company accounts above organizations.
- **Self-service registration** with a per-company approval workflow.
- **Customizable movement labels** captured on each ledger row.
- **Column-level PII encryption** at rest (AES-256-GCM) for user/supplier contact fields.

## Deferred (designed, not yet built)
Redis, S3 attachments, SMTP email, purchase-order flow, `xlsx` export, OpenAPI/Swagger, camera barcode scanning.

> Note: DDL in doc 2 is grouped by domain for readability; apply migrations in dependency order (organizations → sites → projects → locations/categories/suppliers/currencies → items → stock/transactions → custom fields → purchasing/audit).
