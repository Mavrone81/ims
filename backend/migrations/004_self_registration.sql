-- Self-service user registration with an approval workflow.
--
--  * Users can register themselves against a company (organization) created by
--    the platform admin.
--  * Whether a self-registered account needs admin approval before it can log
--    in is controlled per-company by the platform admin (require_user_approval).
--  * Existing and admin-created users default to 'approved' so nothing breaks.

ALTER TABLE organizations
    ADD COLUMN require_user_approval BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE users
    ADD COLUMN self_registered BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (approval_status IN ('pending', 'approved', 'rejected'));

-- Pending self-registrations are surfaced to org admins; index for that lookup.
CREATE INDEX idx_users_pending ON users(org_id) WHERE approval_status = 'pending';
