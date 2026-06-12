-- Customizable movement (transaction) labels.
--
-- Admins/managers can rename the built-in movement types (e.g. "Issue" ->
-- "Dispatch") and add new labels, each mapped to one built-in behaviour so the
-- stock ledger maths stay correct. The chosen label text is captured on each
-- transaction so historical movements keep their label even if it's later
-- renamed or removed.

CREATE TABLE txn_labels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL REFERENCES organizations(id),
    base_type  txn_type NOT NULL,        -- receipt | issue | transfer | adjustment | write_off
    label      TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, label)
);

-- Display label captured at movement time (NULL for legacy/opening rows).
ALTER TABLE stock_transactions ADD COLUMN label TEXT;

-- Seed the built-in set for every existing organization.
INSERT INTO txn_labels (org_id, base_type, label, sort_order)
SELECT o.id, t.base_type::txn_type, t.label, t.ord
FROM organizations o
CROSS JOIN (VALUES
    ('receipt',    'Receipt',    1),
    ('issue',      'Issue',      2),
    ('transfer',   'Transfer',   3),
    ('adjustment', 'Adjustment', 4),
    ('write_off',  'Write-off',  5)
) AS t(base_type, label, ord);
