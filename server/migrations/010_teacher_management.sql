-- 010 teacher management
--
-- A teacher is one global identity (users.role = 'teacher'). Faculties share the
-- same account through user_faculties instead of creating duplicate users, so a
-- teacher can be added by several faculty admins while keeping one password.

-- Trace which admin added a teacher to a faculty (NULL for the backfilled home
-- membership of existing teachers).
ALTER TABLE user_faculties
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- One global teacher account per email. Existing teacher rows are unique today;
-- the index makes concurrent admin actions safe and prevents duplicate identity.
CREATE UNIQUE INDEX IF NOT EXISTS users_teacher_email_key
ON users (lower(email))
WHERE role = 'teacher';
