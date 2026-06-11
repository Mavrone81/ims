# REST API Specification
## Inventory Management System (IMS)

**Version:** 1.0
**Base URL:** `/api/v1`
**Format:** JSON over HTTPS
**Auth:** Bearer JWT (access token) in `Authorization` header
**Companion to:** `01_PRD.md`, `02_DATABASE.md`

---

## 1. Conventions

### 1.1 Authentication
All endpoints except `/auth/*` and `/health` require:
```
Authorization: Bearer <access_token>
```
Access tokens are short-lived (15 min); use `/auth/refresh` to obtain new ones.

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

### POST `/auth/login`
```json
// request
{ "email": "sam@example.com", "password": "••••••" }
// 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "...", "full_name": "Samuel", "is_org_admin": false,
            "projects": [ { "project_id": "...", "role": "manager" } ] }
}
```

### POST `/auth/refresh`
```json
{ "refresh_token": "eyJ..." }  // -> { "access_token": "...", "refresh_token": "..." }
```

### POST `/auth/logout` → 204  (revokes refresh token)
### GET `/auth/me` → current user + project memberships

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
`GET /users` · `POST /users` (invite) · `PATCH /users/{id}` · `DELETE /users/{id}` (deactivate)
```json
// POST /users
{ "email":"tech@example.com", "full_name":"A. Technician",
  "memberships": [ { "project_id":"...", "role":"technician" } ] }
```

---

## 10. Purchase orders (lightweight)
`GET /purchase-orders` · `POST /purchase-orders` · `GET /purchase-orders/{id}` · `PATCH /purchase-orders/{id}`
`POST /purchase-orders/{id}/receive` → records receipts, generating `receipt` transactions for received lines.

---

## 11. Reports
`GET /reports/valuation?base_currency=USD&as_of=2026-06-11` → stock value by category/project, converted to base currency.
`GET /reports/movements?date_from=...&date_to=...&type=issue` → movement summary.
`GET /reports/reorder` → low-stock list.
`GET /reports/abc` → ABC classification breakdown.
`GET /reports/write-offs?date_from=...&date_to=...`
All reports accept `?format=json|xlsx|csv`.

---

## 12. Attachments
`POST /items/{id}/attachments` (multipart) → upload datasheet/photo, 201
`GET /items/{id}/attachments` → list
`GET /attachments/{id}/download` → presigned URL / stream
`DELETE /attachments/{id}` (manager+) → 204

---

## 13. Audit
`GET /audit-logs?entity_type=item&entity_id=...&user_id=...&date_from=...` (manager+) → immutable change history.

---

## 14. System
`GET /health` → `{ "status": "ok", "db": "ok", "redis": "ok", "version": "1.0.0" }`
`GET /me/notifications` → in-app alerts (low stock, pending approvals)

---

## 15. OpenAPI
The implementation ships a machine-readable `openapi.yaml` (OpenAPI 3.1) served at `GET /api/v1/openapi.json` and a Swagger UI at `/api/v1/docs`. All schemas above are generated from, and kept in sync with, that spec.

---

## 16. Rate limiting & versioning
- Default limit: `120 req/min/IP` (configurable; see `03_ENV.md`).
- The API is versioned in the path (`/api/v1`). Breaking changes bump the major version; additive changes are backward-compatible.
