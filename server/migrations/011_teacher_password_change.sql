-- 011 forced password change for admin-created teachers
--
-- When a faculty admin creates a teacher, the system generates a temporary
-- password. The teacher may sign in with it only to set a new password; the UI
-- and every non-password API enforce the change first.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
