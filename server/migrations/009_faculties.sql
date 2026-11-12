-- 009 faculties (colleges as organizations) + teacher multi-faculty membership
--
-- A "faculty" is the existing organization tenant. Every table that is scoped by
-- organization_id (students, courses, sessions, attendance, leave requests,
-- tickets, notifications, settings, registration requests) automatically becomes
-- faculty-scoped, so no data movement is required.
--
-- Rules:
--   * admin / student -> exactly one faculty = users.organization_id
--   * teacher         -> home faculty = users.organization_id
--                        plus any rows in user_faculties (other member faculties)

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- The original default organization becomes the first faculty. Its id stays the
-- same, so every existing row keeps pointing at the same faculty (no data moves).
UPDATE organizations
   SET name = 'دانشکده شهید شمسی‌پور', code = 'SHAMSIPOUR'
 WHERE name = 'سازمان پیش‌فرض'
   AND NOT EXISTS (
     SELECT 1 FROM organizations WHERE name = 'دانشکده شهید شمسی‌پور'
   );

INSERT INTO organizations (name, code)
VALUES
  ('دانشکده شهید شمسی‌پور', 'SHAMSIPOUR'),
  ('دانشکده انقلاب', 'ENGHELAB'),
  ('دانشکده شریعتی', 'SHARIATI'),
  ('دانشکده شهید منتظری', 'MONTAZERI')
ON CONFLICT (name) DO NOTHING;

-- Home faculty of the first faculty is "دانشکده شهید شمسی‌پور".
UPDATE organizations
   SET code = 'SHAMSIPOUR'
 WHERE name = 'دانشکده شهید شمسی‌پور' AND (code IS NULL OR code = '');

CREATE UNIQUE INDEX IF NOT EXISTS organizations_code_key
ON organizations (lower(code))
WHERE code IS NOT NULL AND code <> '';

-- Multi-faculty membership (used by teachers; admins/students never have rows).
CREATE TABLE IF NOT EXISTS user_faculties (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS user_faculties_org_idx
ON user_faculties (organization_id);

-- Backfill: existing teachers keep their home faculty as an explicit membership.
-- Idempotent, and harmless if a teacher later gains more faculties.
INSERT INTO user_faculties (user_id, organization_id)
SELECT id, organization_id FROM users WHERE role = 'teacher'
ON CONFLICT DO NOTHING;
