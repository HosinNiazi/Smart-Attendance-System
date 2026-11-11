-- 008 phase 2: group leave requests, live sessions, analytics indexes
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS group_title text;
CREATE INDEX IF NOT EXISTS leave_requests_group_idx
  ON leave_requests (group_id) WHERE group_id IS NOT NULL;

ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS live_status text NOT NULL DEFAULT 'scheduled';
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS ended_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'class_sessions_live_status_check'
  ) THEN
    ALTER TABLE class_sessions
      ADD CONSTRAINT class_sessions_live_status_check
      CHECK (live_status IN ('scheduled','live','ended'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS class_sessions_org_date_idx
  ON class_sessions (organization_id, session_date);
CREATE INDEX IF NOT EXISTS class_sessions_org_live_idx
  ON class_sessions (organization_id, live_status, session_date);
CREATE INDEX IF NOT EXISTS attendance_records_session_idx
  ON attendance_records (session_id);
CREATE INDEX IF NOT EXISTS attendance_records_student_idx
  ON attendance_records (student_id);
