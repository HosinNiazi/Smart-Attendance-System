-- 015 exams
--
-- Teachers create a timed multiple-choice exam for one of their own courses.
-- Students may start one attempt inside the availability window; the server is
-- the single source of truth for timing and grading. Results are stored on the
-- attempt row so they stay immutable after submission.

CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  available_from TIMESTAMPTZ NOT NULL,
  available_until TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 1 AND 240),
  pass_percent NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK (pass_percent BETWEEN 0 AND 100),
  shuffle_questions BOOLEAN NOT NULL DEFAULT TRUE,
  shuffle_options BOOLEAN NOT NULL DEFAULT TRUE,
  results_visibility TEXT NOT NULL DEFAULT 'after_close'
    CHECK (results_visibility IN ('immediate','after_close','hidden')),
  max_attempts INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','closed','cancelled')),
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (available_until > available_from),
  CHECK (duration_minutes * 60 <= EXTRACT(EPOCH FROM (available_until - available_from))),
  CHECK (length(btrim(title)) BETWEEN 2 AND 160)
);

CREATE INDEX IF NOT EXISTS exams_org_course_from_idx
  ON exams (organization_id, course_id, available_from DESC);
CREATE INDEX IF NOT EXISTS exams_created_by_idx
  ON exams (created_by);
CREATE INDEX IF NOT EXISTS exams_org_status_idx
  ON exams (organization_id, status, available_from DESC);

CREATE TABLE IF NOT EXISTS exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 20),
  prompt TEXT NOT NULL,
  points NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (points > 0 AND points <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, position)
);

CREATE INDEX IF NOT EXISTS exam_questions_exam_idx
  ON exam_questions (exam_id, position);

CREATE TABLE IF NOT EXISTS exam_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (question_id, position)
);

-- Exactly one correct option per question (the 3..5 option count is enforced by
-- the API inside the same transaction).
CREATE UNIQUE INDEX IF NOT EXISTS exam_options_one_correct_idx
  ON exam_options (question_id) WHERE is_correct;

-- Snapshot of the students who may sit the exam. It is filled at publish time so
-- later changes to course membership never rewrite historical eligibility.
CREATE TABLE IF NOT EXISTS exam_students (
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS exam_students_student_idx
  ON exam_students (student_id);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL DEFAULT 1 CHECK (attempt_no BETWEEN 1 AND 10),
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','submitted','expired','voided')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  correct_count INTEGER NOT NULL DEFAULT 0,
  earned_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  percent NUMERIC(5,2),
  score_out_of_20 NUMERIC(5,2),
  passed BOOLEAN,
  ip_address INET,
  user_agent TEXT,
  tab_switch_count INTEGER NOT NULL DEFAULT 0,
  integrity_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  graded_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id, attempt_no)
);

-- A student can never have two open attempts at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_one_open_idx
  ON exam_attempts (exam_id, student_id) WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS exam_attempts_exam_idx
  ON exam_attempts (exam_id, status);
CREATE INDEX IF NOT EXISTS exam_attempts_student_idx
  ON exam_attempts (student_id, status);

CREATE TABLE IF NOT EXISTS exam_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  selected_option_id UUID REFERENCES exam_options(id) ON DELETE SET NULL,
  is_correct BOOLEAN,
  earned_points NUMERIC(8,2) NOT NULL DEFAULT 0,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS exam_answers_attempt_idx
  ON exam_answers (attempt_id);
