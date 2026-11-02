-- Completing biometric storage for voice profiles and general metadata.
-- Face references already store an uploaded file in object_key; voice references
-- store their extracted feature vector here so a profile can move between
-- browsers/devices through the database instead of staying in IndexedDB.
ALTER TABLE biometric_references
  ADD COLUMN IF NOT EXISTS features jsonb,
  ADD COLUMN IF NOT EXISTS feature_version integer;

CREATE INDEX IF NOT EXISTS biometric_student_kind_idx
  ON biometric_references(student_id, kind, created_at DESC);
