# REST API Specification
## Inventory Management System (IMS)

**Version:** 1.0
**Base URL:** `/api/v1`
**Format:** JSON over HTTPS
**Auth:** Bearer JWT (access token) in `Authorization` header
**Companion to:** `01_PRD.md`, `02_DATABASE.md`

> **As-built note (reconciled 2026-06-14).** This spec is kept in sync with the
> running implementation. Sign-in is by **username**, not email (see §2). Two
> token families exist — org-user tokens and platform-admin tokens — and they
> are **not** interchangeable. Sections marked **`[deferred]`** describe designed
> endpoints that are not yet implemented (purchase orders, attachments,
> OpenAPI/Swagger, `xlsx` export); the rest is live.

---

## 1. Conventions

### 1.1 Authentication
All endpoints except `/auth/*`, `/platform/auth/login`, and `/health` require:
```
Authorization: Bearer <access_token>
```
Access tokens are short-lived (15 min); use `/auth/refresh` to obtain new ones.
Org-user tokens are rejected on `/platform/*` and platform tokens are rejected
on org APIs (401 both ways).

### 1.2 Project scoping
Most resources are project-scoped. Pass the active project via header:
```
X-Project-Id: <project_uuid>
```
The server enforces the caller's role on that project (manager / technician / viewer).

### 1.3 Pagination, sorting, filtering
List endpoints accept query params:
```
?page=1&page_size=50&sort=item_no&order=asc&q=valve&category_id=...&supplier_id=...&stock_status=low
```
Responses wrap collections:
```json
{
  "data": [ ... ],
  "pagination": { "page": 1, "page_size": 50, "total": 5083, "total_pages": 102 }
}
```

### 1.4 Standard error shape
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "item_no is required",
    "details": [ { "field": "item_no", "issue": "required" } ]
  }
}
```

### 1.5 Status codes
| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No content (delete/archive) |
| 400 | Validation error |
| 401 | Not authenticated |
| 403 | Authenticated but not authorized for this project/action |
| 404 | Not found |
| 409 | Conflict (duplicate item_no, insufficient stock) |
| 422 | Business-rule violation (e.g., over-issue when negative stock disallowed) |
| 429 | Rate limited |
| 500 | Server error |

### 1.6 Role matrix (per project)
| Action | viewer | technician | manager | org admin |
|---|:--:|:--:|:--:|:--:|
| Read items/stock/reports | ✓ | ✓ | ✓ | ✓ |
| Create receipt/issue/transfer | | ✓ | ✓ | ✓ |
| Create/edit items | | ✓ | ✓ | ✓ |
| Write-off (above threshold) | | | ✓ | ✓ |
| Manage custom fields/categories | | | ✓ | ✓ |
| Manage sites/projects/users/currencies | | | | ✓ |

---

## 2. Auth

Sign-in uses a **username** (email is optional contact PII, encrypted at rest).
The same "Invalid username or password" message is returned for both an unknown
user and a wrong password (no account enumeration). Repeated failures for one
username are rate-limited/locked out.

### POST `/auth/login`
```json
// request
{ "username": "manager", "password": "••••••" }
// 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "...", "username": "manager", "email": null, "full_name": "Samuel",
            "is_org_admin": false,
            "projects": [ { "project_id": "...", "role": "manager",
                            "project_name": "Maintenance-CNW", "project_code": "Maintenance-CNW" } ] }
}
// 403 if the account is awaiting approval or was rejected (self-registration)
```
Login also fails (401) if the user's organization is deactivated.

### POST `/auth/refresh`
```json
{ "refresh_token": "eyJ..." }  // -> { "access_token": "...", "refresh_token": "..." }
```
Refresh tokens **rotate**: the presented token is revoked and a new pair issued.
Revoked/expired tokens return 401.

### POST `/auth/logout` → 204  (revokes the supplied refresh token)
### GET `/auth/me` → current user (id, username, email, full_name, is_org_admin) + project memberships

### POST `/auth/change-password`  (any authenticated user)
```json
{ "current_password": "••••••", "new_password": "••••••" }  // 204
```
On success, all of the user's **other** refresh tokens are revoked (sign-out
elsewhere). 400 if new == current; 401 if the current password is wrong.

### Self-service registration

### GET `/auth/companies` → public list of active companies to register against
```json
{ "data": [ { "id": "...", "name": "CNW" } ] }
```

### POST `/auth/register`  (public)
```json
// request
{ "org_id": "...", "username": "jdoe", "full_name": "J. Doe",
  "email": "j@example.com", "password": "••••••••" }
// 201 — message + status
{ "status": "pending", "message": "Registration submitted. An administrator must approve…" }
```
Creates a non-admin user in the chosen company. If the company has
`require_user_approval` on, the account is `pending` and cannot sign in until an
org admin approves it (see §9); otherwise it is usable immediately. 409 if the
username is taken; `username` allows letters, digits, `. _ -`.

---

## 3. Items

### GET `/items`
List items in the active project. Query: `q, category_id, supplier_id, location_id, stock_status(in|low|out), abc_class, page, page_size, sort, order`.
```json
// 200
{
  "data": [
    {
      "id": "9b1...",
      "item_no": "C4100050001",
      "description": "SOLENOID VALVE",
      "specification": "v=24 HZ=8W Rated ED 100% Norgren",
      "model": "00125660",
      "supplier": { "id": "...", "name": "Burkert" },
      "department": "Maintenance",
      "default_location": { "id": "...", "code": "CNW L/L R1D" },
      "stock_on_hand": 2,
      "unit_price": 240,
      "currency": "SGD",
      "value_native": 480,
      "reorder_level": 1,
      "abc_class": "B",
      "custom": { "voltage": "24V", "wattage": "8W" }
    }
  ],
  "pagination": { "page": 1, "page_size": 50, "total": 5083, "total_pages": 102 }
}
```

### POST `/items`  (technician+)
```json
// request
{
  "item_no": "C4100050099",
  "description": "Pressure Transmitter",
  "specification": "0-10Bar",
  "model": "BR52.XXGSWGZKMAS",
  "supplier_id": "...",
  "category_id": "...",
  "department": "Maintenance",
  "default_location_id": "...",
  "unit_price": 1673,
  "currency": "SGD",
  "reorder_level": 1,
  "max_level": 5,
  "comments": "Spare for line 3",
  "custom": { "range": "0-10Bar" }
}
// 201 -> created item object
// 409 if item_no already exists in project
```

### GET `/items/{id}` → full item incl. custom fields, suppliers, attachments, current stock per location
### PATCH `/items/{id}` (technician+) → partial update
### DELETE `/items/{id}` (manager+) → soft-delete (archive), 204
### GET `/items/{id}/transactions` → paginated ledger for the item
### GET `/items/lookup?barcode=XXXX` → resolve a scanned barcode to an item

### POST `/items/import`  (manager+)
Bulk import from Excel/CSV. `multipart/form-data` with `file` + `mapping`.
```json
// 200 (dry_run=true)
{
  "dry_run": true,
  "summary": { "rows": 5083, "valid": 5070, "errors": 13 },
  "errors": [ { "row": 42, "field": "currency", "issue": "unknown currency 'SG'" } ]
}
```
Query `?dry_run=false` commits the import (creates items + opening transactions).

### GET `/items/export?format=xlsx|csv` → file download of current filtered list

---

## 4. Stock transactions (ledger)

> Stock balance is **derived**; you never PUT a balance. You post movements.

### POST `/transactions`  (technician+)
```json
// Receipt (IN)
{ "type": "receipt", "item_id": "...", "to_location_id": "...",
  "quantity": 5, "unit_price": 240, "currency": "SGD",
  "purpose": "PO-2026-014 received", "reference": "PO-2026-014" }

// Issue (OUT)
{ "type": "issue", "item_id": "...", "from_location_id": "...",
  "quantity": 1, "purpose": "Replaced on CM8G blower", "reference": "WO-8842" }

// Transfer (between locations)
{ "type": "transfer", "item_id": "...",
  "from_location_id": "...", "to_location_id": "...",
  "quantity": 2, "purpose": "Rebalance R1C -> R1D" }

// Adjustment (cycle count correction)
{ "type": "adjustment", "item_id": "...", "to_location_id": "...",
  "quantity": -1, "purpose": "Cycle count 11/06/26" }

// Write-off (may require approval)
{ "type": "write_off", "item_id": "...", "from_location_id": "...",
  "quantity": 1, "purpose": "Damaged" }
```
Responses: `201` with the created transaction and updated `stock_on_hand`.
`422` if issue exceeds stock and negative stock is disallowed.
`202` if a write-off exceeds the approval threshold (queued pending manager approval).

### GET `/transactions`
Filter: `item_id, type, location_id, date_from, date_to, user_id, reference`. Paginated, newest first.

### POST `/transactions/{id}/reverse`  (manager+)
Creates a reversing entry (ledger stays immutable). Body: `{ "reason": "wrong item issued" }`.

### GET `/transactions/{id}` → single ledger entry

---

## 5. Stock & levels

### GET `/stock?item_id=...` → per-location quantities for an item
### GET `/stock/low` → items at/below reorder level (the reorder report feed)
```json
{ "data": [ { "item_id":"...", "item_no":"C4100050009", "description":"Pressure Transmitter",
              "stock_on_hand": 0, "reorder_level": 1, "supplier": "VEGA" } ] }
```

---

## 6. Custom fields (admin/manager)

Project-scoped routes (require `X-Project-Id`), but field defs are org-wide.
`key` must be lowercase `snake_case`. A def with `category_id: null` applies to
all categories; `GET ?category_id=` returns that category's fields **plus** the
global ones.

### GET `/custom-fields?category_id=...` → field definitions for a category
### POST `/custom-fields`  (manager+)
```json
{ "category_id": "...", "key": "voltage", "label": "Voltage",
  "type": "select", "is_required": false,
  "options": [ {"value":"24V","label":"24V"}, {"value":"230V","label":"230V"} ],
  "help_text": "Operating voltage", "sort_order": 1 }
// 201 -> field def
```
### PATCH `/custom-fields/{id}`  → edit label/options/required/order
### DELETE `/custom-fields/{id}` → soft-delete (values retained), 204

---

## 7. Catalog

### Categories
`GET /categories` · `POST /categories` (manager+) · `PATCH /categories/{id}` · `DELETE /categories/{id}`

### Suppliers
`GET /suppliers` · `POST /suppliers` (manager+) · `GET /suppliers/{id}` · `PATCH /suppliers/{id}` · `DELETE /suppliers/{id}`

### Currencies & exchange rates  (org admin)
`GET /currencies`
`GET /exchange-rates?from=SGD&to=USD&on=2026-06-11`
`POST /exchange-rates` → `{ "from_currency":"SGD","to_currency":"USD","rate":0.74,"effective_date":"2026-06-01" }`

---

## 8. Sites, projects, locations  (org admin, except reads)

### Sites
`GET /sites` · `POST /sites` · `PATCH /sites/{id}` · `DELETE /sites/{id}`

### Projects
`GET /projects` (returns projects the user can access) · `POST /projects` · `PATCH /projects/{id}` · `DELETE /projects/{id}`
`GET /projects/{id}/members` · `POST /projects/{id}/members` `{ "user_id":"...","role":"technician" }` · `DELETE /projects/{id}/members/{userId}`

### Locations
`GET /locations?site_id=...` · `POST /locations` · `PATCH /locations/{id}` · `DELETE /locations/{id}`

---

## 9. Users  (org admin)
`GET /users` · `POST /users` · `PATCH /users/{id}` · `DELETE /users/{id}` (deactivate)
`POST /users/{id}/approve` · `POST /users/{id}/reject` — resolve a pending self-registration.
```json
// POST /users  (admin-created users are auto-approved; password is set directly)
{ "username":"atech", "password":"••••••••", "full_name":"A. Technician",
  "email":"tech@example.com", "is_org_admin": false,
  "memberships": [ { "project_id":"...", "role":"technician" } ] }
```
`GET /users` returns each user's `approval_status`, `self_registered`, `is_active`
and memberships. `PATCH` can set `full_name`, `password` (resets sessions),
`is_org_admin`, `is_active`. `email` is stored encrypted; the API returns it
decrypted. `DELETE` deactivates (no hard delete) and revokes the user's sessions.

---

## 10. Purchase orders (lightweight)  **`[deferred]`**
Designed but **not yet implemented**. The `purchase_orders` / `purchase_order_lines`
tables exist (see `02_DATABASE.md`); no routes are mounted. Planned surface:
`GET/POST /purchase-orders`, `GET/PATCH /purchase-orders/{id}`,
`POST /purchase-orders/{id}/receive` (generates `receipt` transactions).

---

## 11. Reports
`GET /reports/valuation?base_currency=USD&as_of=2026-06-11` → stock value by category/project, converted to base currency.
`GET /reports/movements?date_from=...&date_to=...&type=issue` → movement summary.
`GET /reports/reorder` → low-stock list.
`GET /reports/abc` → ABC classification breakdown.
`GET /reports/write-offs?date_from=...&date_to=...`
All reports accept `?format=json|csv` (`xlsx` is **`[deferred]`**). Valuation and
ABC convert to a base currency using the latest `exchange_rates` row effective
on/before `as_of`; items whose currency has no rate to base show `value_base: null`.
Reports are project-scoped (require `X-Project-Id`).

---

## 12. Attachments  **`[deferred]`**
Designed but **not yet implemented** (no object storage wired). The `attachments`
table exists. Planned surface: `POST/GET /items/{id}/attachments`,
`GET /attachments/{id}/download`, `DELETE /attachments/{id}`.

---

## 13. Audit
`GET /audit-logs?entity_type=item&entity_id=...&user_id=...&date_from=...&date_to=...`
(manager+, requires `X-Project-Id`) → immutable change history for the caller's org,
paginated newest-first.

---

## 14. System
`GET /health` → `{ "status": "ok", "db": "ok", "version": "1.0.2" }` (503 +
`"status":"degraded"` if the DB is unreachable; no `redis` field — Redis is not used).
`GET /me/notifications` (requires `X-Project-Id`) → in-app alerts for the active project: low-stock items, plus users awaiting approval (org admins only). Only non-zero alerts are returned.

```json
{
  "data": [
    { "type": "low_stock", "severity": "warning", "count": 3, "message": "3 items at or below reorder level", "link": "/reports/reorder" },
    { "type": "pending_approval", "severity": "info", "count": 1, "message": "1 user awaiting approval", "link": "/admin/users" }
  ],
  "total": 4
}
```

---

## 15. Movement labels  (read: any member · manage: manager+)
Admins/managers can rename the built-in movement types and add new labels, each
mapped to one built-in behaviour so the ledger maths stay correct. Labels are
org-scoped but the routes require an active `X-Project-Id`.

`GET /txn-labels` → active labels for the org (the movement form reads these).
`POST /txn-labels` → `{ "base_type":"issue", "label":"Dispatch", "sort_order":2 }` (manager+).
`PATCH /txn-labels/{id}` → rename / re-map `base_type` / reorder (manager+).
`DELETE /txn-labels/{id}` → deactivate (manager+); blocked if it is the **last**
label for a behaviour ("rename it instead"). Historical transactions keep their
captured label text. Post a movement with a label via `label_id` on `POST /transactions`
(§4) instead of `type`.

---

## 16. Platform admin  (super-admin above organizations)
A separate console for provisioning company accounts. Platform tokens carry
`{ platform: true }` and a 12 h TTL; they are not valid on org APIs. The first
platform admin is bootstrapped from `PLATFORM_ADMIN_USERNAME` / `_PASSWORD` at API
startup (never stored in the repo).

`POST /platform/auth/login` → `{ access_token, admin }` (username + password).
`GET /platform/currencies` → known currencies for the base-currency picker.
`GET /platform/orgs` → all companies with user/site/item counts and flags.
`POST /platform/orgs` → provision a company: org + default site/project + its
org-admin login + seeded movement labels. Body includes `name`, `base_currency`,
`admin_username`, `admin_password`, `admin_full_name`, and optional site/project codes.
`PATCH /platform/orgs/{id}` → set `name`, `base_currency`, `is_active`
(deactivate ⇒ users can't sign in, data retained), `require_user_approval`.
`POST /platform/orgs/{id}/admins` → add another org-admin login to a company.

---

## 17. OpenAPI  **`[deferred]`**
A machine-readable `openapi.yaml` (OpenAPI 3.1) at `GET /api/v1/openapi.json` and
a Swagger UI at `/api/v1/docs` are planned but **not yet implemented**. Until then
this document is the source of truth for the API contract.

---

## 18. Rate limiting & versioning
- Default limit: `120 req/min/IP` (configurable; see `03_ENV.md`). Enforced
  in-memory (no Redis); login has a stricter per-username lockout.
- The API is versioned in the path (`/api/v1`). Breaking changes bump the major version; additive changes are backward-compatible.
