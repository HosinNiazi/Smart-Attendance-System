-- 017 platform administration (Super Admin / پنل سامانه)
--
-- Adds a platform layer above faculties.  Faculties remain the tenant
-- (organizations with kind = 'faculty'); the platform itself is one hidden
-- organization row (kind = 'platform') that owns the super-admin accounts so
-- the existing login / lockout / audit machinery can be reused.
--
-- Impersonation ("enter a faculty") is represented as a row in
-- admin_impersonations plus a short lived JWT that carries the session id.
-- Nothing is ever copied between faculties.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'faculty',
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_kind_check'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_kind_check
      CHECK (kind IN ('faculty', 'platform'));
  END IF;
END $$;

-- platform_level: NULL for everybody except platform administrators.
-- admin_level: level inside a faculty (existing admins become the owner).
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_level text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_level text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_platform_level_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_platform_level_check
      CHECK (platform_level IS NULL OR platform_level IN ('owner', 'operator', 'auditor'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_admin_level_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_admin_level_check
      CHECK (admin_level IS NULL OR admin_level IN ('owner', 'manager', 'operator', 'viewer'));
  END IF;
END $$;

UPDATE users
   SET admin_level = 'owner'
 WHERE role = 'admin' AND admin_level IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_key
  ON organizations (lower(slug))
  WHERE slug IS NOT NULL;

-- The hidden platform tenant.  Every query that lists faculties filters
-- kind = 'faculty', so this row never appears in the UI.
INSERT INTO organizations (name, code, kind)
VALUES ('پنل سامانه', 'PLATFORM', 'platform')
ON CONFLICT (name) DO UPDATE
  SET kind = 'platform',
      code = COALESCE(organizations.code, 'PLATFORM'),
      is_active = true;

-- One row per "platform admin entered a faculty" session.
CREATE TABLE IF NOT EXISTS admin_impersonations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ended_reason text
);

CREATE INDEX IF NOT EXISTS admin_impersonations_active_idx
  ON admin_impersonations (platform_user_id, organization_id, expires_at)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS admin_impersonations_org_idx
  ON admin_impersonations (organization_id, started_at DESC);

-- Cross-faculty activity feed.
CREATE INDEX IF NOT EXISTS audit_created_at_idx
  ON audit_logs (created_at DESC);
