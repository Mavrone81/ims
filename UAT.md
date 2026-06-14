# IMS — User Acceptance Testing (UAT)

This document is the **living end-to-end test script** for IMS. Keep it updated:
**every change must add or revise the relevant UAT case(s) here**, and the
automated suite (`backend/tests/`) should cover the same behaviour where
possible. CI (`.github/workflows/ci.yml`) runs the automated tests on every
push; the server only deploys a commit once CI is green.

- **Environment:** https://ims.urbanwerkzsg.com (prod) · http://localhost:5173 (local)
- **Automated tests:** `cd backend && npm test` (Vitest + Supertest, real Postgres)
- **Last revised:** 2026-06-14

## Test accounts (local/seed)

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Organization admin |
| `manager` | `manager123` | Manager |
| `tech` | `tech123` | Technician |
| `audit` | `audit123` | Viewer |
| `padmin` | *(server `.env`)* | Platform admin (`/platform`) |

> Production passwords should differ — rotate seed passwords before go-live (VAPT C1).

---

## How to use this document

Each case has: **ID · Title · Steps · Expected result · Automated?** Run the
relevant section after any change touching that area. Mark PASS/FAIL with date
in your test log. `Automated? ✓` means a Vitest case asserts the same behaviour.

---

## 1. Authentication & sessions

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| AUTH-1 | Valid login | Sign in with `admin`/correct password | Lands on Dashboard; session persists on refresh | ✓ |
| AUTH-2 | Invalid login | Sign in with wrong password | "Invalid username or password"; same message for unknown user (no enumeration) | ✓ |
| AUTH-3 | Login lockout | Enter a wrong password 5× for one username | 6th attempt shows "Too many failed login attempts"; a different username still works | ✓ |
| AUTH-4 | Protected route | Open an API/page while signed out | Redirected to login / 401 | ✓ |
| AUTH-5 | Change own password | Top bar → Change password → current + new | Success toast; old password fails, new works; other sessions signed out | ✓ |
| AUTH-6 | Sign out | Click Sign out | Returns to login; back button does not restore session | — |

## 2. Self-service registration & approval

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| REG-1 | Company list | Login page → "Register a new user" | Company dropdown lists active companies | ✓ |
| REG-2 | Register (approval ON) | Register against a company that requires approval | "awaiting approval" message; login is blocked with "awaiting administrator approval" | ✓ |
| REG-3 | Approve | As org admin → Admin → Users → pending user → Approve | User can now sign in | ✓ |
| REG-4 | Reject | As org admin → Reject a pending user | User cannot sign in | — |
| REG-5 | Register (approval OFF) | Platform admin turns approval OFF for the company, then register | "Registration complete"; user can sign in immediately | ✓ |
| REG-6 | Duplicate username | Register with an existing username | 409 "username is already taken" | ✓ |

## 3. Platform administration (`/platform`)

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| PLAT-1 | Platform login | Go to `/platform`, sign in as `padmin` | Companies console loads | ✓ |
| PLAT-2 | Create company | "+ New company" → fill name + admin login | Company created; its admin can sign in at the normal login; default movement labels seeded | ✓ |
| PLAT-3 | Deactivate company | Toggle a company to inactive | Its users can no longer sign in; data retained | ✓ |
| PLAT-4 | Reactivate | Toggle back to active | Users can sign in again | — |
| PLAT-5 | Approval toggle | Flip "Self-reg approval" for a company | New registrations are pending (ON) or auto-approved (OFF) | ✓ |
| PLAT-6 | Token separation | Use a platform token on an org API (and vice versa) | 401 both directions | ✓ |

## 4. Items

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| ITEM-1 | Create item | Inventory → + New item → fill required fields | Item appears in the grid | ✓ |
| ITEM-2 | Duplicate item_no | Create an item with an existing Item No (same project) | 409 conflict | — |
| ITEM-3 | Custom fields | Add a custom field to a category, then create an item in it | Field renders on the form; value saved & shown | — |
| ITEM-4 | Search & filter | Search by item no/description; filter by category/supplier/status | Grid filters correctly; no SQL errors on special chars | partial |
| ITEM-5 | Archive | Manager archives an item | Hidden from inventory; ledger retained | ✓ (RBAC) |
| ITEM-6 | Export CSV | Inventory → Export CSV | File downloads with current filtered rows | — |

## 5. Stock movements (ledger)

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| TXN-1 | Receipt | Record a Receipt of N to a location | On-hand increases by N | ✓ |
| TXN-2 | Issue | Record an Issue of M | On-hand decreases by M | ✓ |
| TXN-3 | Over-issue blocked | Issue more than on-hand (negative stock off) | 422 "Insufficient stock" | ✓ |
| TXN-4 | Transfer | Transfer between two locations | Per-location stock moves; total unchanged | ✓ |
| TXN-5 | Adjustment | Cycle-count adjust (+/-) | On-hand reflects signed delta | — |
| TXN-6 | Write-off threshold | Technician writes off value above threshold | 403 "a manager must record it" | — |
| TXN-7 | Reverse | Manager reverses a transaction | Reversing entry created; balance restored; double-reverse blocked | ✓ |

## 6. Movement labels (admin/manager)

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| LBL-1 | Rename | Admin → Movement labels → rename "Issue" → "Dispatch" | Movement modal & history show "Dispatch"; behaviour unchanged | ✓ |
| LBL-2 | Add | Add a new label (e.g. "Loan out") mapped to a behaviour | Appears in the movement modal | ✓ |
| LBL-3 | Use custom label | Record a movement with a custom label | Transaction stores base type + label; history shows the label | ✓ |
| LBL-4 | Last-label guard | Remove the only label for a behaviour | Blocked: "rename it instead" | — |
| LBL-5 | Permission | Technician/viewer cannot manage labels | No Movement-labels management access | — |

## 7. RBAC & multi-tenant isolation

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| SEC-1 | Technician limits | Technician tries to delete item / create user | 403 | ✓ |
| SEC-2 | Viewer limits | Viewer tries to record a movement | 403 | ✓ |
| SEC-3 | Cross-tenant | User of company A sends company B's project id | 403 / 404; no data leak | ✓ |
| SEC-4 | Org-admin only | Non-admin opens Users/Sites/Currencies admin | Hidden / 403 | — |

## 8. Reports & multi-currency

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| RPT-1 | Valuation | Reports → Valuation, pick base currency | Totals convert via exchange rates | — |
| RPT-2 | Reorder | Reports → Reorder | Lists items at/below reorder level | — |
| RPT-3 | ABC | Reports → ABC | A/B/C split by value share | — |
| RPT-4 | Export | Export any report to CSV | File downloads | — |

## 9. Data protection (PII encryption at rest)

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| ENC-1 | Supplier contact encrypted | Create a supplier with contact name/email/phone; inspect the DB row directly | API shows plaintext; the stored `email`/`contact_name`/`phone` columns are `enc:v1:…` ciphertext | ✓ |
| ENC-2 | User email encrypted | Create a user with an email; inspect the DB row | API shows plaintext; stored `email` is `enc:v1:…` | ✓ |
| ENC-3 | Legacy plaintext readable | A pre-encryption row | Still displays correctly (passthrough on read) | ✓ |
| ENC-4 | Backups carry ciphertext | Decrypt a DB backup and grep a known email | The email appears only as `enc:v1:` ciphertext in the dump | — |

## 10. Responsive UI

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| UI-1 | Mobile nav | Open at 375px width | Hamburger drawer; no horizontal scroll | — |
| UI-2 | Tablet | Open at 768px | Icon-rail sidebar; grids usable | — |
| UI-3 | Desktop | Open at 1280px | Full layout unchanged | — |

## 11. Purchase orders (lightweight)

| ID | Title | Steps | Expected | Automated? |
|---|---|---|---|---|
| PO-1 | Create PO | Purchasing → + New PO → supplier, PO number, add line(s) | PO created with status `draft`; lines show ordered/received | ✓ |
| PO-2 | Duplicate PO number | Create a PO with an existing number (same project) | 409 conflict | ✓ |
| PO-3 | Partial receive | Receive fewer than ordered on a line | Status → `partial`; on-hand increases by the received qty; `qty_received` updated | ✓ |
| PO-4 | Full receive | Receive the remaining outstanding qty | Status → `received`; on-hand equals total ordered | ✓ |
| PO-5 | Over-receipt blocked | Receive more than a line's outstanding qty | 422; no stock posted | ✓ |
| PO-6 | Default location | Receive a line whose item has a default location, no location chosen | Receipt posts to the item's default location; missing both ⇒ 400 | ✓ |
| PO-7 | Permission | Viewer tries to create/receive a PO | 403 | ✓ |

---

## Regression checklist before a release

1. `cd backend && npm test` → all green.
2. `cd backend && npm run build` and `cd frontend && npm run build` → no errors.
3. CI green on the commit (GitHub Actions).
4. Spot-run the UAT sections touched by the change on staging/local.
5. Confirm production health after deploy: `GET /api/v1/health` → `{"status":"ok"}`.
