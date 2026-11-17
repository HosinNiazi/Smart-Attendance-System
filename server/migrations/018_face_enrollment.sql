-- Phase 1 of the face-recognition hardening.
--
-- Face references already had a `features` (jsonb) column from migration 002,
-- but the browser kept recomputing descriptors from the JPEG on every load.
-- From now on the descriptor is stored next to the photo, versions are
-- tracked, and every face-attendance decision is recorded for auditing.

ALTER TABLE biometric_references
  ADD COLUMN IF NOT EXISTS quality jsonb,
  ADD COLUMN IF NOT EXISTS descriptor_model text;

-- Fast lookup of the reference gallery for one student.
CREATE INDEX IF NOT EXISTS biometric_face_reference_idx
  ON biometric_references(student_id, created_at DESC)
  WHERE kind = 'face_image';

-- One row per accepted or rejected face-attendance decision. The server no
-- longer has to trust the client's word that "method = face".
CREATE TABLE IF NOT EXISTS face_recognition_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES class_sessions(id) ON DELETE SET NULL,
  student_id uuid REFERENCES students(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  method text NOT NULL,
  decision text NOT NULL,
  reason text,
  distance numeric,
  margin numeric,
  threshold numeric,
  liveness text,
  frame_count integer,
  device_id text,
  reference_id uuid REFERENCES biometric_references(id) ON DELETE SET NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS face_recognition_events_org_time_idx
  ON face_recognition_events(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS face_recognition_events_session_student_idx
  ON face_recognition_events(session_id, student_id);
