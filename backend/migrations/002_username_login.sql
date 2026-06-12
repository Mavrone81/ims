-- Login by username instead of email. Existing users get the local part of
-- their email (de-duplicated with a numeric suffix); email becomes optional
-- contact info.

ALTER TABLE users ADD COLUMN username CITEXT;

WITH ranked AS (
    SELECT id,
           split_part(email, '@', 1) AS base,
           row_number() OVER (PARTITION BY split_part(email, '@', 1) ORDER BY created_at) AS rn
    FROM users
)
UPDATE users u
SET username = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || r.rn::text END
FROM ranked r
WHERE u.id = r.id AND u.username IS NULL;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
