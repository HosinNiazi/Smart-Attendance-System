-- 021 token versioning
-- Bumping this counter invalidates every previously issued token for the user.
-- It is incremented on password change and on every admin-driven password reset.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
