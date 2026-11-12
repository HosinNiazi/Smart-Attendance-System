import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

// Run every migration in filename order.  This keeps a fresh local setup and an
// existing database on the same schema.
const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith('.sql'))
  .sort();

for (const file of files) {
  const sql = await readFile(join(migrationsDir, file), 'utf8');
  await pool.query(sql);
  console.log(`Applied ${file}`);
}

// Reuse the default faculty instead of inserting a new one on every run.
const DEFAULT_FACULTY = 'دانشکده شهید شمسی‌پور';
const organization = await pool.query(
  `INSERT INTO organizations (name, code) VALUES ($1, 'SHAMSIPOUR')
   ON CONFLICT (name) DO NOTHING RETURNING id`,
  [DEFAULT_FACULTY],
);
const orgId =
  organization.rows[0]?.id ||
  (await pool.query("SELECT id FROM organizations WHERE name = $1", [
    DEFAULT_FACULTY,
  ])).rows[0].id;

const password = process.env.SEED_ADMIN_PASSWORD;
const email = process.env.SEED_ADMIN_EMAIL;
if (email && password) {
  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (organization_id, email, password_hash, display_name, role)
     VALUES ($1, lower($2), $3, 'مدیر سامانه', 'admin')
     ON CONFLICT (organization_id, email) DO UPDATE
       SET password_hash=EXCLUDED.password_hash,
           display_name=EXCLUDED.display_name,
           role=EXCLUDED.role,
           is_active=true`,
    [orgId, email, passwordHash],
  );
}
await pool.query(
  `INSERT INTO organization_settings (organization_id) VALUES ($1)
   ON CONFLICT (organization_id) DO NOTHING`,
  [orgId],
);
console.log('Database migration completed.');
await pool.end();
