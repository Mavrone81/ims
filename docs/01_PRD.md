# Product Requirements Document (PRD)
## Inventory Management System (IMS)

**Document version:** 1.0
**Date:** 11 June 2026
**Owner:** Samuel
**Status:** Draft for review

> **Implementation status (2026-06-14).** This PRD is the product *intent*. The
> MVP plus much of Phase 2/3 is built — see the repo `README.md`, `UAT.md`, and
> the **As-built** notes in `02_DATABASE.md`/`03_ENV.md`/`04_API.md`. Notable
> differences from this document: sign-in is by **username** (not email);
> self-service registration + approval, a platform/super-admin layer,
> customizable movement labels, and PII encryption at rest were added. Still
> **deferred**: attachments, email/Redis, camera barcode scanning, and `xlsx`
> export.

---

## 1. Overview

### 1.1 Purpose
The Inventory Management System (IMS) is a web-based application for tracking maintenance spare parts and general inventory across multiple sites and projects. It replaces the current spreadsheet-based process (a single wide Excel workbook with repeating "Purpose & Date / Qty Change" columns) with a structured, multi-user, auditable system.

The system is designed to be **robust and extensible**: administrators can create new projects, add new items, and define new custom fields without code changes.

### 1.2 Background
Today, inventory is tracked in an Excel file (`Maintenance spare part inventory list`). Each item is a row with fixed columns (Item No, Description, Specification, Model, Supplier, Department, Stock Location, Stock Balance, Value, Currency, Unit Price, Amount, Unit Price EUR, Amount in EUR, Comments) followed by ~50 repeating pairs of `Purpose & Date` / `Qty Change` columns that act as a manual transaction log.

This approach has clear limits:

- The transaction log is capped by the number of pre-made columns and is hard to query or report on.
- No concurrent multi-user editing, no access control, and no audit trail of who changed what.
- Currency conversion rates are embedded per row and updated manually.
- No reorder alerts, no barcode support, no project segregation.
- Stock balance is a manually maintained number rather than a derived value, so it drifts from reality.

### 1.3 Goals
- Provide a single source of truth for inventory across multiple sites and projects.
- Make stock balance a **derived value** computed from an immutable transaction ledger.
- Support role-based access for admins, managers, technicians, and viewers.
- Allow admin-defined custom fields per item category so the schema can evolve.
- Provide reorder-point alerts, ABC classification, and standard inventory reports.
- Preserve and import all existing Excel data.

### 1.4 Non-goals (v1)
- Full procurement / purchase-order automation with supplier EDI (basic PO tracking only).
- Accounting/GL integration (export only).
- Predictive-maintenance ML forecasting (designed for, not built in v1).
- Native mobile apps (responsive web + barcode scanning via browser instead).

---

## 2. Users & personas

| Persona | Role | Primary needs |
|---|---|---|
| **System Administrator** | `admin` | Manage users, sites, projects, custom fields, currencies, system settings. |
| **Inventory Manager** | `manager` | Approve write-offs, set reorder points, run reports, manage suppliers, oversee multiple projects. |
| **Technician / Storekeeper** | `technician` | Issue and receive stock, record movements, look up parts, scan barcodes. |
| **Viewer / Auditor** | `viewer` | Read-only access to inventory and reports; export data. |

Roles are assigned **per project** (a user can be a manager on Project A and a viewer on Project B), with an org-level admin role above all projects.

---

## 3. Key concepts & domain model (plain language)

- **Organization** – the top-level tenant. Owns everything below.
- **Site** – a physical facility/location (e.g., "CNW Plant"). An organization has many sites.
- **Project** – a logical grouping of inventory (e.g., "Maintenance-CNW"). Access control and reporting are scoped to projects. A project belongs to a site.
- **Location** – a fine-grained storage position within a site (e.g., "CNW L/L R1D" = rack/level/bin). Maps to the Excel "Stock Location".
- **Category** – item classification (e.g., Solenoid Valves, Sensors, Breakers). Custom fields attach to categories.
- **Item** – the master record for a part (Item No, Description, Specification, Model, Supplier, etc.). Maps to one Excel row's fixed fields.
- **Stock** – the on-hand quantity of an item at a location (derived from transactions).
- **Transaction** – an immutable ledger entry recording a stock movement (receipt, issue, adjustment, transfer, write-off). Each maps to one historical "Purpose & Date / Qty Change" pair.
- **Supplier** – vendor that provides items.
- **Custom field** – an admin-defined attribute (text, number, date, dropdown, boolean) attached to a category.

---

## 4. Functional requirements

### 4.1 Item management
- **FR-1.1** Create, read, update, and soft-delete (archive) items.
- **FR-1.2** Each item carries the core fields migrated from Excel: Item No (unique within project), Description, Specification, Model, Supplier, Department, default Stock Location, Unit Price, Currency, plus computed Value/Amount.
- **FR-1.3** Items belong to a category; custom fields defined on that category appear on the item form.
- **FR-1.4** Items support attachments (datasheets, photos) and a free-text Comments field.
- **FR-1.5** Each item has a unique barcode/QR (auto-generated from Item No or scanned external code).
- **FR-1.6** Bulk import items from Excel/CSV with column mapping and a dry-run validation preview.
- **FR-1.7** Duplicate detection on create (warn if Model + Supplier already exists).

### 4.2 Stock & transactions
- **FR-2.1** Record stock movements of types: **Receipt (IN)**, **Issue (OUT)**, **Adjustment (±)**, **Transfer (between locations)**, **Write-off**.
- **FR-2.2** Every movement captures: item, location(s), quantity, type, reason/purpose, reference (work order/PO), user, and timestamp — replacing the Excel "Purpose & Date / Qty Change" pairs.
- **FR-2.3** **Stock balance is always derived** by summing transactions; it is never edited directly.
- **FR-2.4** Transactions are **immutable**; corrections are made via reversing/adjustment entries, never edits or deletes.
- **FR-2.5** Issuing more than available stock is blocked (configurable to "warn only" per project).
- **FR-2.6** Write-offs above a configurable value threshold require manager approval.
- **FR-2.7** Full audit log: who, what, before/after, when.

### 4.3 Multi-site & multi-project
- **FR-3.1** Admins create sites, projects, and locations.
- **FR-3.2** Inventory, transactions, and reports are scoped to the active project; users switch projects via a selector.
- **FR-3.3** Stock transfers can move items between locations within a project and (with manager approval) between projects/sites.

### 4.4 Custom fields (extensibility)
- **FR-4.1** Admins define custom fields with: name, key, data type (text, number, date, boolean, single-select, multi-select), required flag, default value, and help text.
- **FR-4.2** Custom fields attach to a category and render automatically on item create/edit forms.
- **FR-4.3** Select-type fields have admin-managed option lists.
- **FR-4.4** Custom fields are filterable and searchable, and appear as optional columns/exports.
- **FR-4.5** Deleting a custom field soft-deletes it and retains historical values.

### 4.5 Suppliers & purchasing (lightweight)
- **FR-5.1** Manage supplier records (name, contact, lead time, currency).
- **FR-5.2** Link items to one or more suppliers with supplier part number and price.
- **FR-5.3** Track simple purchase orders (draft → ordered → received) that generate Receipt transactions on receiving.

### 4.6 Reorder & alerts
- **FR-6.1** Per item (or item-location) min/reorder level and max level.
- **FR-6.2** System flags items at/below reorder point and surfaces them on a dashboard and via email/in-app notification.
- **FR-6.3** ABC classification (A/B/C) computed from annual value, used to drive count frequency and alerting.

### 4.7 Search, reporting & export
- **FR-7.1** Fast search across Item No, Description, Model, Supplier, custom fields.
- **FR-7.2** Filter by project, site, location, category, supplier, stock status (in stock / low / out).
- **FR-7.3** Standard reports: Stock-on-hand valuation, Stock movements (date range), Low-stock/reorder, Write-off report, Transaction history per item, ABC analysis.
- **FR-7.4** Export any list/report to Excel and CSV; valuation reports support base-currency conversion.
- **FR-7.5** Multi-currency: per-transaction currency captured; reports convert to a configurable base currency (USD/EUR/SGD) using a managed exchange-rate table.

### 4.8 Currency
- **FR-8.1** Admin-managed currency list and exchange-rate table (effective-dated), replacing the per-row "1 USD / 1 EUR" cells in Excel.
- **FR-8.2** Item prices stored in their native currency; valuation reports convert to base currency at the report's effective rate.

### 4.9 Administration & audit
- **FR-9.1** User management with per-project role assignment.
- **FR-9.2** Immutable audit trail for all create/update/delete and stock movements.
- **FR-9.3** Configurable settings: base currency, approval thresholds, negative-stock policy, ID formats.

---

## 5. Non-functional requirements

- **NFR-1 Performance:** List/search responses < 500 ms for 100k items; reports < 5 s.
- **NFR-2 Scalability:** Support 50+ concurrent users and 1M+ transaction rows without redesign.
- **NFR-3 Security:** JWT auth, bcrypt/argon2 password hashing, RBAC enforced server-side, TLS in transit, encryption at rest, rate limiting, audit logging. OWASP Top 10 mitigations.
- **NFR-4 Availability:** 99.5% target; daily automated backups with point-in-time recovery.
- **NFR-5 Usability:** Responsive (desktop-first, tablet-friendly for shop floor); barcode scanning via device camera; WCAG 2.1 AA.
- **NFR-6 Auditability:** No hard deletes of items or transactions; soft-delete + ledger corrections only.
- **NFR-7 Maintainability:** Documented REST API, automated tests, infrastructure as code.
- **NFR-8 Localization:** Multi-currency now; i18n-ready strings for future language support.

---

## 6. Data migration (from Excel)

1. Parse the `Maintenance-CNW` sheet; map fixed columns to **Item** fields.
2. For each item row, walk every populated `Purpose & Date` / `Qty Change` pair and create a **Transaction** (parsing free-text dates/initials where possible; flagging unparseable ones for review).
3. Derive opening stock from the "Initial Stock" entry; validate that the sum of transactions equals the recorded Stock Balance, reporting mismatches.
4. Seed currencies and exchange rates from the per-row currency cells.
5. Map "Stock Location" strings (e.g., "CNW L/L R1D") to structured Location records.
6. Provide a reconciliation report before go-live.

---

## 7. Success metrics

- 100% of Excel items and parseable transactions migrated, with a reconciliation variance report.
- Stock-record accuracy ≥ 98% (verified by cycle counts) within 3 months.
- Reduction in stock-outs of critical (Class A) spares.
- Time to record a stock movement < 30 seconds.
- Zero unaudited stock changes.

---

## 8. Release plan (phased)

| Phase | Scope |
|---|---|
| **MVP (Phase 1)** | Auth/RBAC, sites/projects/locations, items + categories, transactions with derived stock, basic search, Excel import, stock valuation report. |
| **Phase 2** | Custom fields, reorder alerts + dashboard, suppliers, multi-currency reporting, barcode scanning, exports. |
| **Phase 3** | Lightweight purchase orders, approvals/write-off workflow, ABC analysis, advanced reports, notifications. |
| **Phase 4 (future)** | Work-order/CMMS integration, accounting export, demand forecasting. |

---

## 9. Risks & assumptions

- **Risk:** Free-text historical "Purpose & Date" entries are inconsistent → mitigated by a review/flag step during migration.
- **Risk:** Users accustomed to Excel resist change → mitigated by Excel import/export and a familiar grid view.
- **Assumption:** Internet/intranet access available at storage locations for the web app.
- **Assumption:** A single organization (multi-site) tenant for v1; full multi-tenant SaaS is out of scope.

---

## 10. Companion documents
- `02_DATABASE.md` – ER diagram and schema
- `03_ENV.md` – environment configuration
- `04_API.md` – REST API specification
- `05_UIUX.md` – UI/UX design

---

### Sources / references
- [MCE Automation – Guide to Efficient Spare Parts Inventory Management](https://mceautomation.com/resources/inventory-management/a-guide-to-efficient-spare-parts-inventory-management/)
- [Verdantis – MRO Inventory Management: Process, Strategy & Best Practices](https://www.verdantis.com/mro-inventory-management/)
- [Limble – Maintenance Inventory Management Checklist](https://limble.com/learn/inventory-management)
- [CPCON – Spare Parts Inventory Management Guide (2026)](https://cpcongroup.com/insights/article/spare-parts-inventory-management-guide/)
- [System Design Handbook – Design Inventory Management System](https://www.systemdesignhandbook.com/guides/design-inventory-management-system/)
