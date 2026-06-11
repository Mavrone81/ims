# Inventory Management System (IMS) — Documentation

Full documentation set for a robust, multi-site / multi-project Inventory Management System with admin-defined custom fields, derived stock balances from an immutable transaction ledger, and multi-currency reporting. Built from the field set in the existing *Maintenance spare part inventory* Excel workbook and validated against standard MRO/IMS practices.

**Stack:** React (Vite + TS) · Node.js/Express (TS) · PostgreSQL 15+ · Redis · S3-compatible storage.

## Documents
1. [PRD](01_PRD.md) — product requirements, personas, functional/non-functional requirements, migration, release plan.
2. [Database Design & ER Diagram](02_DATABASE.md) — Mermaid ERD, PostgreSQL DDL, views, Excel→schema mapping.
3. [Environment & Configuration](03_ENV.md) — backend/frontend `.env`, variable reference, Docker setup.
4. [REST API Specification](04_API.md) — endpoints, auth, RBAC, request/response examples.
5. [UI/UX Design](05_UIUX.md) — design system, screens, flows, responsive & accessibility.

## Core design decisions
- **Stock balance is derived** from `stock_transactions` (append-only ledger), cached in `stock_levels`. The Excel "Purpose & Date / Qty Change" columns become individual transaction rows.
- **Extensible:** admins create projects, items, categories, and **custom fields** (text/number/date/boolean/select) without code changes.
- **Multi-site / multi-project** with per-project role-based access (manager / technician / viewer + org admin).
- **Multi-currency** via an effective-dated `exchange_rates` table, replacing per-row currency cells.

> Note: DDL in doc 2 is grouped by domain for readability; apply migrations in dependency order (organizations → sites → projects → locations/categories/suppliers/currencies → items → stock/transactions → custom fields → purchasing/audit).
