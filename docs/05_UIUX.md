# UI/UX Design
## Inventory Management System (IMS)

**Version:** 1.0
**Companion to:** `01_PRD.md`, `04_API.md`
**Platform:** Responsive web (desktop-first, tablet-friendly for the shop floor)

> **As-built note (2026-06-14).** This document is the design *intent*. The built
> SPA implements the dashboard, inventory grid, item detail + ledger history,
> type-switching movement modal, reports, suppliers, and admin areas described
> here. Added screens not in the original design: a **Login/Register** page
> (username login + self-service registration), a **Change-password** modal, a
> **Movement-labels** admin tab, and a standalone **`/platform`** super-admin
> console, plus a **Purchasing** page (PO list, create-with-lines, and a
> per-line receive flow). Deferred: attachments dropzone and camera barcode
> scanning (barcode *lookup* exists).

---

## 1. Design principles

- **Spreadsheet familiarity, database power.** The main inventory view is a fast, filterable, editable data grid that feels like Excel — easing migration for current users — but backed by a real ledger.
- **Speed on the floor.** Recording a movement (issue/receive) takes < 30 seconds, with barcode scanning and large touch targets for tablets.
- **Show derived truth.** Stock balance is always shown as a computed value with a clear "view history" affordance, never an editable cell.
- **Progressive disclosure.** Power features (custom fields, approvals, FX rates) live in admin areas; everyday users see a clean, focused interface.
- **Safe by default.** Destructive actions confirm; corrections are reversals; everything is audited.
- **Accessible.** WCAG 2.1 AA: keyboard navigation, focus states, sufficient contrast, ARIA labels.

---

## 2. Design system

### 2.1 Color palette
| Token | Hex | Use |
|---|---|---|
| Primary | `#1E5EFF` | Actions, links, active nav |
| Primary-dark | `#1546C0` | Hover/pressed |
| Surface | `#FFFFFF` | Cards, panels |
| Background | `#F5F7FA` | App background |
| Border | `#E2E8F0` | Dividers, inputs |
| Text-primary | `#1A2332` | Body text |
| Text-muted | `#64748B` | Secondary text |
| Success | `#16A34A` | In-stock, confirmations |
| Warning | `#F59E0B` | Low stock |
| Danger | `#DC2626` | Out of stock, write-offs, destructive |
| Info | `#0EA5E9` | Neutral notices |

Stock-status semantics: **green** = healthy, **amber** = at/below reorder, **red** = zero/negative.

### 2.2 Typography
- Font: **Inter** (system fallback `-apple-system, Segoe UI, Roboto`).
- Scale: H1 28/600, H2 22/600, H3 18/600, Body 14/400, Caption 12/400.
- Tabular numerals for all quantity/price columns.

### 2.3 Spacing & layout
- 8px spacing grid; 12px control radius; subtle shadows on cards/menus.
- Max content width 1440px; fluid grid below.
- Density toggle (comfortable / compact) for the data grid.

### 2.4 Core components
Buttons (primary/secondary/ghost/danger), inputs, select, multiselect (chips), date picker, data grid (sortable, resizable, frozen first column, inline edit), modal/drawer, toast, tabs, badge/pill (status), breadcrumb, pagination, empty states, skeleton loaders, confirm dialog, file dropzone, barcode-scan button.

---

## 3. Global navigation & layout

```
┌──────────────────────────────────────────────────────────────┐
│  IMS   [Project: Maintenance-CNW ▾]      🔍 search   🔔  Sam ▾ │  Top bar
├──────────┬───────────────────────────────────────────────────┤
│ Dashboard│                                                     │
│ Inventory│              Main content area                      │
│ Movements│                                                     │
│ Reports  │                                                     │
│ Suppliers│                                                     │
│ Purchasing                                                     │
│ ──────── │                                                     │
│ Admin ▾  │                                                     │
│  Sites   │                                                     │
│  Projects│                                                     │
│  Fields  │                                                     │
│  Users   │                                                     │
│  Currency│                                                     │
└──────────┴───────────────────────────────────────────────────┘
```

- **Project switcher** (top-left) sets `X-Project-Id` for all data; permissions adapt to the user's role on that project.
- **Global search** (⌘/Ctrl-K) jumps to items by Item No, Description, Model, or scanned barcode.
- **Notifications bell**: low-stock alerts, pending write-off approvals.
- Left nav collapses to icons on tablet; Admin section visible only to managers/admins.

---

## 4. Key screens

### 4.1 Dashboard
Landing view with at-a-glance health of the active project.
- KPI cards: Total items, Total stock value (base currency), Low-stock count, Out-of-stock count, Pending approvals.
- **Low-stock table** (top 10, link to full reorder report).
- **Recent movements** feed (last 10 transactions with user + purpose).
- ABC value breakdown (donut: A/B/C share of value).

```
┌ Dashboard ─────────────────────────────────────────────────┐
│ [ 5,083 Items ] [ $1.92M Value ] [ 47 Low ] [ 12 Out ] [ 3⏳]│
│                                                             │
│ ▼ Low stock (reorder)            │ ▼ Recent movements       │
│ C4100050009 Pressure Tx  0/1 🔴  │ −1 Solenoid valve  WO-88 │
│ C4100050021 Breaker D20  1/2 🟠  │ +5 Pressure Tx     PO-14 │
│ ...                              │ ...                      │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Inventory list (primary workspace)
The Excel replacement — a dense, fast data grid.
- Columns: Item No, Description, Specification, Model, Supplier, Department, Location, **On-hand** (color badge), Unit Price, Currency, Value, ABC. Custom fields available as optional columns via a column picker.
- **Filters bar:** category, supplier, location, stock status (In / Low / Out), ABC class, free-text search.
- **Row actions:** view, edit, quick-issue, quick-receive.
- **Bulk actions:** export selection, bulk edit category/location, print labels.
- Inline edit on non-derived fields; On-hand is read-only with a "history" icon.
- Toolbar: `+ New item`, `Import`, `Export`, density toggle, saved views.

```
┌ Inventory ──────────────────────────────────────────── + New  Import  Export ┐
│ [Search…] Category▾ Supplier▾ Location▾ Status:[All▾]      [columns ▾] [⚙ compact] │
├────────────┬──────────────────┬──────────┬─────────┬───────┬──────┬───────┬─────┤
│ Item No    │ Description       │ Model    │ Supplier│ Loc   │ Qty  │ Price │ ABC │
├────────────┼──────────────────┼──────────┼─────────┼───────┼──────┼───────┼─────┤
│ C4100050001│ SOLENOID VALVE    │ 00125660 │ Burkert │ R1D   │ 🟢 2 │ 240   │  B  │
│ C4100050008│ Pressure Tx       │ BR52.XX  │ VEGA    │ R1C   │ 🟢 2 │ 1,673 │  A  │
│ C4100050009│ Pressure Tx 0.1Bar│ BR52.XX  │ VEGA    │ R1C   │ 🔴 0 │ 1,673 │  A  │
└────────────┴──────────────────┴──────────┴─────────┴───────┴──────┴───────┴─────┘
                                                          ◀ 1 2 3 … 102 ▶  50/page
```

### 4.3 Item detail
Tabbed drawer/page for a single item.
- **Overview:** all core fields, supplier(s), on-hand per location, value (native + base currency), reorder/max levels, ABC, barcode (printable).
- **Custom fields:** rendered from the category's field definitions.
- **History (ledger):** chronological transactions — date, type (colored), qty change, location(s), purpose, reference, user. This is the structured replacement for the Excel "Purpose & Date / Qty Change" columns.
- **Attachments:** datasheets/photos (dropzone).
- **Actions:** Issue, Receive, Transfer, Adjust, Edit, Archive.

```
┌ C4100050008 · Pressure Transmitter ──────────── [Issue][Receive][Transfer][⋯] ┐
│ Overview │ Custom fields │ History │ Attachments                              │
├───────────────────────────────────────────────────────────────────────────── │
│ Supplier: VEGA   Dept: Maintenance   Location: CNW L/L R1C                     │
│ On-hand: 2   Unit price: SGD 1,673   Value: SGD 3,346 (≈ USD 2,478)           │
│ Reorder at: 1   Max: 4   ABC: A    Barcode: ▌▌█▌ C4100050008  [Print label]    │
│ ── History ──                                                                  │
│  25 Aug 2023  Receipt   +1  R1C  "Sara IN"            Sara                     │
│  12 May 2021  Issue     −1  R1C  "Sara update"        Sara                     │
│  08 Apr 2018  Receipt   +1  R1C  "Mahesh"             Mahesh                   │
└───────────────────────────────────────────────────────────────────────────── ┘
```

### 4.4 Record a movement (modal)
Single, type-switching form used everywhere (from item, grid row, or global `+`).
- Type selector: Receipt · Issue · Transfer · Adjust · Write-off.
- Fields adapt: Issue shows From-location; Receipt shows To-location; Transfer shows both.
- **Barcode scan** button auto-fills the item; quantity stepper; purpose + reference; live "new balance" preview.
- Validation: blocks over-issue (or warns, per project policy); write-offs over threshold show "will require approval".

```
┌ Record movement ───────────────────────────┐
│ ( ) Receipt  (•) Issue  ( ) Transfer  ( ) Adjust │
│ Item:  [📷 scan] C4100050008 Pressure Tx       │
│ From:  [ CNW L/L R1C ▾ ]                        │
│ Qty:   [ − ] 1 [ + ]      On-hand 2 → 1         │
│ Purpose: [ Replaced on CM8G blower        ]     │
│ Ref (WO/PO): [ WO-8842 ]                         │
│                         [ Cancel ]  [ Confirm ] │
└─────────────────────────────────────────────────┘
```

### 4.5 Movements / transaction log
Project-wide ledger with filters (type, date range, item, user, reference). Read-only; managers can "Reverse" an entry (creates a correction). Exportable.

### 4.6 Reports
Card launcher → Valuation, Movements, Reorder, ABC, Write-offs. Each report: filter panel, results table/chart, and `Export to Excel/CSV`. Valuation lets the user pick a base currency and as-of date (uses the FX-rate table).

### 4.7 Suppliers & Purchasing
- Suppliers: list + detail (contact, lead time, linked items, price list).
- Purchasing: PO list with status pills (draft/ordered/partial/received); PO detail with a **Receive** action that generates receipt transactions per line.

### 4.8 Admin
- **Sites / Projects / Locations:** CRUD with hierarchy; assign members and roles per project.
- **Custom fields:** per-category field builder — add field (name, type, required, options, help text), drag to reorder; live preview of the item form.
- **Users:** invite, deactivate, assign per-project roles.
- **Currencies & FX:** manage currency list and effective-dated exchange rates.
- **Settings:** base currency, approval thresholds, negative-stock policy, ID formats.

```
┌ Admin · Custom fields — Category: Solenoid Valves ───────── + Add field ┐
│  ⠿ Voltage        Select   required   [24V, 230V] ▾        ✎  🗑          │
│  ⠿ Wattage        Number              "W"                   ✎  🗑          │
│  ⠿ Connection     Text                                      ✎  🗑          │
│  ── Live preview of item form ──                                          │
│  Voltage* [ 24V ▾ ]   Wattage [ 8 ] W   Connection [ G1/4 ]              │
└──────────────────────────────────────────────────────────────────────── ┘
```

### 4.9 Excel import wizard
Three steps: **Upload** (drop .xlsx/.csv) → **Map columns** (auto-matched to item fields + custom fields, with currency/location resolution) → **Review** (dry-run summary: valid/error counts, downloadable error list) → **Commit**. Mirrors `POST /items/import`.

---

## 5. Key user flows

**Issue a part (technician, tablet):** Scan barcode → movement modal pre-filled as Issue → set qty + purpose → Confirm → toast "Issued, on-hand 2 → 1". ~20 seconds.

**Add a new item with a new attribute:** Admin adds custom field "Voltage" to the category → technician creates item; the Voltage field now appears on the form → save.

**Spot a stockout and reorder:** Dashboard low-stock card → reorder report → select item → create PO to preferred supplier → on delivery, PO "Receive" posts the receipt and stock updates.

**Correct a mistake:** Open item history → "Reverse" the wrong transaction (manager) → ledger keeps both entries; balance corrected; audit log records who/why.

---

## 6. States & feedback
- **Empty states** with a clear primary action (e.g., "No items yet — Import from Excel or add your first item").
- **Loading**: skeleton rows in the grid; optimistic UI on movement confirm with rollback on error.
- **Errors**: inline field errors from the API's `details`; toast for system errors.
- **Confirmations**: destructive/irreversible-feeling actions (archive, write-off, reverse) require explicit confirm with context.

---

## 7. Responsive behavior
- **Desktop (≥1024px):** full grid, left nav expanded, multi-column detail.
- **Tablet (640–1023px):** nav collapses to icons; grid reduces to key columns (Item No, Desc, Qty, actions); movement modal optimized for touch + camera scan.
- **Mobile (<640px):** card list instead of grid; primary flows are lookup + issue/receive; admin discouraged.

---

## 8. Accessibility & i18n
- Full keyboard support (grid navigation, modal focus trap, ⌘K search).
- Color is never the only signal — stock status pairs color with text/icon.
- All strings externalized for future translation; number/currency/date formatting is locale-aware.

---

## 9. Suggested handoff
Build the design system and screens in **Figma** (component library mirroring §2). Implement with React + a headless component layer (e.g., Radix) + Tailwind for the tokens above, and TanStack Table for the data grid. Keep the API contract in `04_API.md` as the source of truth for all data binding.
