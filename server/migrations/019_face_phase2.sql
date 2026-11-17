-- Phase 2 of the face-recognition work:
--   * per-faculty matching policy (distance, margin, frames, liveness),
--   * camera health telemetry for the admin dashboard.

ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS face_match_distance numeric NOT NULL DEFAULT 0.54,
  ADD COLUMN IF NOT EXISTS face_match_margin numeric NOT NULL DEFAULT 0.035,
  ADD COLUMN IF NOT EXISTS face_min_frames integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS face_liveness_required boolean NOT NULL DEFAULT true;

ALTER TABLE organization_settings
  DROP CONSTRAINT IF EXISTS organization_settings_face_match_distance_check,
  DROP CONSTRAINT IF EXISTS organization_settings_face_match_margin_check,
  DROP CONSTRAINT IF EXISTS organization_settings_face_min_frames_check;

ALTER TABLE organization_settings
  ADD CONSTRAINT organization_settings_face_match_distance_check
    CHECK (face_match_distance BETWEEN 0.3 AND 0.7),
  ADD CONSTRAINT organization_settings_face_match_margin_check
    CHECK (face_match_margin BETWEEN 0 AND 0.2),
  ADD CONSTRAINT organization_settings_face_min_frames_check
    CHECK (face_min_frames BETWEEN 1 AND 10);

-- One row per telemetry report from a camera page. Rows are pruned to the last
-- 30 days by the API on write, so the table stays small.
CREATE TABLE IF NOT EXISTS camera_health_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES class_sessions(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  device_id text NOT NULL,
  camera_state text,
  model_status text,
  frames_scanned integer,
  faces_detected integer,
  unknown_faces integer,
  recognized_faces integer,
  detection_rate numeric,
  fps numeric,
  latency_ms numeric,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS camera_health_org_time_idx
  ON camera_health_samples(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS camera_health_device_time_idx
  ON camera_health_samples(organization_id, device_id, created_at DESC);
