-- 005 fingerprint (WebAuthn platform authenticator) credentials
--
-- A fingerprint in this system is stored as a WebAuthn platform credential
-- bound to a student of the organization. The credential public key is kept for
-- signature verification; the credential id links a biometric sample back to
-- a single student without exposing biometric raw data to the frontend.

CREATE TABLE IF NOT EXISTS fingerprint_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  credential_id text NOT NULL,
  public_key bytea NOT NULL,
  counter integer NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}'::text[],
  device_type text,
  backed_up boolean NOT NULL DEFAULT false,
  aaguid text,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT fingerprint_credentials_org_student_credential_uniq UNIQUE (organization_id, student_id, credential_id)
);

CREATE INDEX IF NOT EXISTS fingerprint_credentials_org_student_idx
  ON fingerprint_credentials (organization_id, student_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  challenge text NOT NULL,
  session_id uuid REFERENCES class_sessions(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_lookup_idx
  ON webauthn_challenges (user_id, kind, created_at DESC);

-- Fingerprint attendance is recorded through the same attendance pipeline as
-- face recognition; it just uses a distinct detection method.
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_method_check;
ALTER TABLE attendance_records ADD CONSTRAINT attendance_records_method_check
  CHECK (method IN ('manual', 'face', 'voice', 'class_camera', 'system', 'fingerprint'));
