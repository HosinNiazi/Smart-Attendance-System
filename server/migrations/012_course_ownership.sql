-- 012 course ownership
--
-- Until now a teacher's access was faculty-wide: any teacher added to a faculty
-- could read and modify every course, session and attendance record of that
-- faculty. This migration introduces explicit ownership of a course by a teacher
-- account. teacher_name is kept for backward compatibility and display, while
-- teacher_user_id is the security boundary.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS teacher_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS courses_teacher_user_idx
  ON courses (organization_id, teacher_user_id);

-- Backfill existing courses where the free-text teacher name matches exactly one
-- teacher of the same faculty (trimmed, case-insensitive).
UPDATE courses c
   SET teacher_user_id = u.id
  FROM users u
 WHERE c.teacher_user_id IS NULL
   AND u.role = 'teacher'
   AND u.organization_id = c.organization_id
   AND lower(btrim(u.display_name)) = lower(btrim(c.teacher_name))
   AND (
     SELECT count(*)
       FROM users u2
      WHERE u2.role = 'teacher'
        AND u2.organization_id = c.organization_id
        AND lower(btrim(u2.display_name)) = lower(btrim(c.teacher_name))
   ) = 1;
