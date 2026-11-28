import { pool } from "./db.js";

// PostgreSQL-backed store for express-rate-limit. Keeping counters in the
// database means they survive restarts and are shared by every API instance.
// A database failure rejects the request instead of silently disabling the
// limit, so the sensitive endpoints stay fail-closed.
export function createPgRateLimitStore(prefix, windowMs) {
  const address = (key) => `${prefix}:${key}`;

  return {
    async increment(key) {
      const { rows } = await pool.query(
        `INSERT INTO rate_limit_hits (key, hits, reset_at)
         VALUES ($1, 1, now() + ($2::bigint || ' milliseconds')::interval)
         ON CONFLICT (key) DO UPDATE
           SET hits = CASE
                        WHEN rate_limit_hits.reset_at <= now() THEN 1
                        ELSE rate_limit_hits.hits + 1
                      END,
               reset_at = CASE
                            WHEN rate_limit_hits.reset_at <= now()
                            THEN now() + ($2::bigint || ' milliseconds')::interval
                            ELSE rate_limit_hits.reset_at
                          END
         RETURNING hits, reset_at`,
        [address(key), windowMs],
      );
      const row = rows[0];
      // Rare opportunistic cleanup keeps the table from growing forever with
      // one row per client IP without running a scheduler.
      if (Math.random() < 0.01) {
        pool
          .query(
            "DELETE FROM rate_limit_hits WHERE reset_at < now() - interval '1 day'",
          )
          .catch(() => {});
      }
      return { totalHits: Number(row.hits), resetTime: row.reset_at };
    },

    async decrement(key) {
      await pool.query(
        `UPDATE rate_limit_hits
            SET hits = GREATEST(hits - 1, 0)
          WHERE key = $1`,
        [address(key)],
      );
    },

    async resetKey(key) {
      await pool.query("DELETE FROM rate_limit_hits WHERE key = $1", [
        address(key),
      ]);
    },
  };
}
