-- 016 exam resilience & oversight
--
-- Adds the pieces needed for real-world, university-scale use:
-- 1. retake grants and per-student extra time (accommodations) on exam_students
-- 2. per-attempt snapshot of the extra minutes that were granted
-- 3. "results ready" notification bookkeeping on exams (idempotent, no cron)
-- 4. per-question error reports filed by students during an attempt

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS results_notified_at TIMESTAMPTZ;

ALTER TABLE exam_students
  ADD COLUMN IF NOT EXISTS extra_minutes SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_attempts SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE exam_attempts
  ADD COLUMN IF NOT EXISTS extra_minutes SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_students_extra_minutes_check'
  ) THEN
    ALTER TABLE exam_students
      ADD CONSTRAINT exam_students_extra_minutes_check
      CHECK (extra_minutes BETWEEN 0 AND 180);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_students_extra_attempts_check'
  ) THEN
    ALTER TABLE exam_students
      ADD CONSTRAINT exam_students_extra_attempts_check
      CHECK (extra_attempts BETWEEN 0 AND 3);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_attempts_extra_minutes_check'
  ) THEN
    ALTER TABLE exam_attempts
      ADD CONSTRAINT exam_attempts_extra_minutes_check
      CHECK (extra_minutes BETWEEN 0 AND 180);
  END IF;
END $$;

-- Questions students flagged from inside the runner. One report per student
-- per question; teachers triage them from the results modal.
CREATE TABLE IF NOT EXISTS exam_question_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES exam_attempts(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, student_id)
);

CREATE INDEX IF NOT EXISTS exam_question_reports_exam_idx
  ON exam_question_reports (exam_id, created_at DESC);
