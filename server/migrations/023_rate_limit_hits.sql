-- 023 shared rate-limit counters
--
-- express-rate-limit uses these rows instead of process memory, so limits
-- survive restarts and are shared by every API instance behind the proxy.

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key text PRIMARY KEY,
  hits integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_hits_reset_idx
  ON rate_limit_hits(reset_at);
