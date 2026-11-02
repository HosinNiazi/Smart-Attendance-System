import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL?.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  max: 12,
  idleTimeoutMillis: 30_000,
});

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function audit(client, organizationId, actorId, action, entityType, entityId, metadata = {}) {
  await client.query(
    `INSERT INTO audit_logs (organization_id, actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [organizationId, actorId || null, action, entityType, entityId || null, metadata],
  );
}
