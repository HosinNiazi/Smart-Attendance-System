-- 013 password recovery and security
--
-- Adds failed login tracking, account lockout fields, and login history tables.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failed_login timestamptz,
  ADD COLUMN IF NOT EXISTS account_locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_last_changed timestamptz;

-- Track login history for audit and monitoring
CREATE TABLE IF NOT EXISTS login_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  ip_address inet,
  user_agent text,
  login_time timestamptz NOT NULL DEFAULT now(),
  successful boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS login_history_user_idx ON login_history(user_id);
CREATE INDEX IF NOT EXISTS login_history_org_time_idx ON login_history(organization_id, login_time);

-- Password history to prevent reuse (kept manually via admin reset; no auto-trigger)
CREATE TABLE IF NOT EXISTS password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS password_history_user_idx ON password_history(user_id);