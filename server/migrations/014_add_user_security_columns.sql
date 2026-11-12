-- 014 add security columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_login timestamptz,
  ADD COLUMN IF NOT EXISTS account_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_last_changed timestamptz;