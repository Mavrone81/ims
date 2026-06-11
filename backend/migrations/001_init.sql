-- IMS schema v1 — derived from docs/02_DATABASE.md, applied in dependency order.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy text search
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive emails

-- ── Tenancy & identity ────────────────────────────────────────────────
CREATE TABLE organizations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    base_currency CHAR(3) NOT NULL DEFAULT 'USD',
    settings      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id),
    email          CITEXT NOT NULL UNIQUE,
    full_name      TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    is_org_admin   BOOLEAN NOT NULL DEFAULT FALSE,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ
);

-- Refresh-token store (revocable sessions; Redis-free substitute)
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- ── Sites, projects, locations ────────────────────────────────────────
CREATE TABLE sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id),
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    address     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (org_id, code)
);

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     UUID NOT NULL REFERENCES sites(id),
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    settings    JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (site_id, code)
);

CREATE TYPE project_role AS ENUM ('manager', 'technician', 'viewer');

CREATE TABLE project_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id),
    user_id     UUID NOT NULL REFERENCES users(id),
    role        project_role NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id)
);

CREATE TABLE locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     UUID NOT NULL REFERENCES sites(id),
    code        TEXT NOT NULL,
    name        TEXT,
    parent_id   UUID REFERENCES locations(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (site_id, code)
);

-- ── Catalog ───────────────────────────────────────────────────────────
CREATE TABLE categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id),
    name        TEXT NOT NULL,
    parent_id   UUID REFERENCES categories(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ,
    UNIQUE (org_id, name)
);

CREATE TABLE suppliers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id),
    name           TEXT NOT NULL,
    contact_name   TEXT,
    email          TEXT,
    phone          TEXT,
    lead_time_days INT,
    currency       CHAR(3),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    UNIQUE (org_id, name)
);

CREATE TABLE currencies (
    code   CHAR(3) PRIMARY KEY,
    name   TEXT NOT NULL,
    symbol TEXT
);

CREATE TABLE exchange_rates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL REFERENCES organizations(id),
    from_currency  CHAR(3) NOT NULL REFERENCES currencies(code),
    to_currency    CHAR(3) NOT NULL REFERENCES currencies(code),
    rate           NUMERIC(18,8) NOT NULL,
    effective_date DATE NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, from_currency, to_currency, effective_date)
);

-- ── Items ─────────────────────────────────────────────────────────────
CREATE TYPE abc_class AS ENUM ('A','B','C');

CREATE TABLE items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id),
    category_id         UUID REFERENCES categories(id),
    item_no             TEXT NOT NULL,
    description         TEXT NOT NULL,
    specification       TEXT,
    model               TEXT,
    supplier_id         UUID REFERENCES suppliers(id),
    department          TEXT,
    default_location_id UUID REFERENCES locations(id),
    unit_price          NUMERIC(18,4),
    currency            CHAR(3) REFERENCES currencies(code),
    reorder_level       NUMERIC(18,3) DEFAULT 0,
    max_level           NUMERIC(18,3),
    abc_class           abc_class,
    barcode             TEXT,
    comments            TEXT,
    custom              JSONB NOT NULL DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    UNIQUE (project_id, item_no)
);

CREATE INDEX idx_items_project    ON items(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_desc_trgm  ON items USING gin (description gin_trgm_ops);
CREATE INDEX idx_items_model_trgm ON items USING gin (model gin_trgm_ops);
CREATE INDEX idx_items_custom_gin ON items USING gin (custom);
CREATE INDEX idx_items_barcode    ON items(barcode);

CREATE TABLE item_suppliers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id          UUID NOT NULL REFERENCES items(id),
    supplier_id      UUID NOT NULL REFERENCES suppliers(id),
    supplier_part_no TEXT,
    price            NUMERIC(18,4),
    currency         CHAR(3) REFERENCES currencies(code),
    is_preferred     BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (item_id, supplier_id)
);

CREATE TABLE attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID NOT NULL REFERENCES items(id),
    file_name   TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type   TEXT,
    size_bytes  BIGINT,
    uploaded_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Stock cache & immutable ledger ────────────────────────────────────
CREATE TABLE stock_levels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     UUID NOT NULL REFERENCES items(id),
    location_id UUID NOT NULL REFERENCES locations(id),
    quantity    NUMERIC(18,3) NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id, location_id)
);

CREATE TYPE txn_type AS ENUM ('receipt','issue','adjustment','transfer','write_off','opening');

CREATE TABLE stock_transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id),
    item_id          UUID NOT NULL REFERENCES items(id),
    type             txn_type NOT NULL,
    quantity_delta   NUMERIC(18,3) NOT NULL,
    from_location_id UUID REFERENCES locations(id),
    to_location_id   UUID REFERENCES locations(id),
    unit_price       NUMERIC(18,4),
    currency         CHAR(3) REFERENCES currencies(code),
    purpose          TEXT,
    reference        TEXT,
    reverses_txn_id  UUID REFERENCES stock_transactions(id),
    performed_by     UUID REFERENCES users(id),
    performed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    -- no updated_at / deleted_at: append-only ledger
);

CREATE INDEX idx_txn_item    ON stock_transactions(item_id, performed_at DESC);
CREATE INDEX idx_txn_project ON stock_transactions(project_id, performed_at DESC);
CREATE INDEX idx_txn_type    ON stock_transactions(type);

-- Sign conventions enforced by the API layer:
--   receipt/opening: delta > 0, to_location set
--   issue/write_off: delta < 0, from_location set
--   adjustment:      delta +/- , to_location is the adjusted location
--   transfer:        delta > 0 (magnitude), both locations set
CREATE OR REPLACE FUNCTION apply_stock_transaction() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.type = 'transfer' THEN
        INSERT INTO stock_levels(item_id, location_id, quantity)
        VALUES (NEW.item_id, NEW.from_location_id, -NEW.quantity_delta)
        ON CONFLICT (item_id, location_id)
        DO UPDATE SET quantity = stock_levels.quantity - NEW.quantity_delta, updated_at = now();

        INSERT INTO stock_levels(item_id, location_id, quantity)
        VALUES (NEW.item_id, NEW.to_location_id, NEW.quantity_delta)
        ON CONFLICT (item_id, location_id)
        DO UPDATE SET quantity = stock_levels.quantity + NEW.quantity_delta, updated_at = now();
    ELSIF NEW.from_location_id IS NOT NULL THEN
        INSERT INTO stock_levels(item_id, location_id, quantity)
        VALUES (NEW.item_id, NEW.from_location_id, NEW.quantity_delta)
        ON CONFLICT (item_id, location_id)
        DO UPDATE SET quantity = stock_levels.quantity + NEW.quantity_delta, updated_at = now();
    ELSIF NEW.to_location_id IS NOT NULL THEN
        INSERT INTO stock_levels(item_id, location_id, quantity)
        VALUES (NEW.item_id, NEW.to_location_id, NEW.quantity_delta)
        ON CONFLICT (item_id, location_id)
        DO UPDATE SET quantity = stock_levels.quantity + NEW.quantity_delta, updated_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_apply_stock
AFTER INSERT ON stock_transactions
FOR EACH ROW EXECUTE FUNCTION apply_stock_transaction();

-- ── Custom fields ─────────────────────────────────────────────────────
CREATE TYPE field_type AS ENUM ('text','number','date','boolean','select','multiselect');

CREATE TABLE custom_field_defs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id),
    category_id   UUID REFERENCES categories(id),     -- NULL = all categories
    key           TEXT NOT NULL,
    label         TEXT NOT NULL,
    type          field_type NOT NULL,
    is_required   BOOLEAN NOT NULL DEFAULT FALSE,
    default_value TEXT,
    help_text     TEXT,
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    UNIQUE (org_id, category_id, key)
);

CREATE TABLE custom_field_options (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_id   UUID NOT NULL REFERENCES custom_field_defs(id),
    value      TEXT NOT NULL,
    label      TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE custom_field_values (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id    UUID NOT NULL REFERENCES items(id),
    field_id   UUID NOT NULL REFERENCES custom_field_defs(id),
    value_text TEXT,
    value_num  NUMERIC(18,4),
    value_date DATE,
    value_bool BOOLEAN,
    UNIQUE (item_id, field_id)
);

-- ── Purchasing (lightweight) & audit ──────────────────────────────────
CREATE TYPE po_status AS ENUM ('draft','ordered','partial','received','cancelled');

CREATE TABLE purchase_orders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    po_number   TEXT NOT NULL,
    status      po_status NOT NULL DEFAULT 'draft',
    currency    CHAR(3) REFERENCES currencies(code),
    ordered_at  DATE,
    expected_at DATE,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, po_number)
);

CREATE TABLE purchase_order_lines (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id        UUID NOT NULL REFERENCES purchase_orders(id),
    item_id      UUID NOT NULL REFERENCES items(id),
    qty_ordered  NUMERIC(18,3) NOT NULL,
    qty_received NUMERIC(18,3) NOT NULL DEFAULT 0,
    unit_price   NUMERIC(18,4)
);

CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id),
    user_id     UUID REFERENCES users(id),
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   UUID,
    before      JSONB,
    after       JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_user   ON audit_logs(user_id, created_at DESC);

-- ── Derived views ─────────────────────────────────────────────────────
CREATE VIEW v_item_stock AS
SELECT i.id AS item_id, i.project_id,
       COALESCE(SUM(sl.quantity), 0) AS stock_on_hand
FROM items i
LEFT JOIN stock_levels sl ON sl.item_id = i.id
WHERE i.deleted_at IS NULL
GROUP BY i.id;

CREATE VIEW v_item_valuation AS
SELECT i.id AS item_id, i.item_no, i.description, i.project_id, i.category_id,
       s.stock_on_hand,
       i.unit_price, i.currency,
       (s.stock_on_hand * COALESCE(i.unit_price, 0)) AS value_native
FROM items i
JOIN v_item_stock s ON s.item_id = i.id;

CREATE VIEW v_reorder AS
SELECT i.id AS item_id, i.item_no, i.description, i.project_id,
       s.stock_on_hand, i.reorder_level
FROM items i
JOIN v_item_stock s ON s.item_id = i.id
WHERE s.stock_on_hand <= i.reorder_level
  AND i.is_active AND i.deleted_at IS NULL;
