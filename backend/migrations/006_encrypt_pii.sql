-- Column-level PII encryption support.
--
-- users.email and supplier contact fields are now encrypted by the application
-- (AES-256-GCM). Encrypted values are opaque base64 strings, so the previous
-- CITEXT + UNIQUE semantics on users.email no longer apply (email is optional
-- contact info; the login identifier is username). Relax the column to TEXT and
-- drop uniqueness. Supplier fields are already plain TEXT — no change needed.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
