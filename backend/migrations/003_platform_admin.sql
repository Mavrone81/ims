-- Platform layer: super-admins above organizations who provision company
-- accounts. Platform admins are separate from org users and are bootstrapped
-- from env vars at API startup (never stored in the repo).

CREATE TABLE platform_admins (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      CITEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL DEFAULT 'Platform Admin',
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Companies can be switched off without deleting their data.
ALTER TABLE organizations ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
