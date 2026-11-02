CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','teacher','student')),
  student_id text,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email),
  UNIQUE (organization_id, student_id)
);

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_number text NOT NULL,
  full_name text NOT NULL,
  major text,
  term text,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, student_number)
);

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  teacher_name text NOT NULL,
  room text,
  weekday text,
  start_time time,
  end_time time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, title),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

CREATE TABLE IF NOT EXISTS course_students (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, student_id)
);

CREATE TABLE IF NOT EXISTS class_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  session_date date NOT NULL,
  teacher_name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 180),
  open_before_minutes integer NOT NULL DEFAULT 15 CHECK (open_before_minutes BETWEEN 0 AND 180),
  close_after_minutes integer NOT NULL DEFAULT 30 CHECK (close_after_minutes BETWEEN 0 AND 180),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','started','finalized','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, session_date),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS session_students (
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('unmarked','present','late','absent','excused','left_early')),
  checked_at timestamptz,
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual','face','voice','class_camera','system')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  method text NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS biometric_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('face_image','voice_sample')),
  object_key text NOT NULL,
  mime_type text NOT NULL,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_settings (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  system_name text NOT NULL DEFAULT 'حضوربان',
  late_after_minutes integer NOT NULL DEFAULT 10 CHECK (late_after_minutes BETWEEN 0 AND 120),
  notifications_enabled boolean NOT NULL DEFAULT true,
  face_recognition_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_session_idx ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS sessions_org_date_idx ON class_sessions(organization_id, session_date);
CREATE INDEX IF NOT EXISTS audit_org_created_idx ON audit_logs(organization_id, created_at DESC);
