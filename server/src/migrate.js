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

// Optional platform (super admin) bootstrap.  Set PLATFORM_ADMIN_EMAIL and
// PLATFORM_ADMIN_PASSWORD once; re-running migrations keeps the account in
// sync without touching faculty data.
const platformEmail = process.env.PLATFORM_ADMIN_EMAIL;
const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD;
if (platformEmail && platformPassword) {
  const platformOrg = await pool.query(
    "SELECT id FROM organizations WHERE kind = 'platform' LIMIT 1",
  );
  const platformOrgId = platformOrg.rows[0]?.id;
  if (!platformOrgId) {
    throw new Error('Platform organization is missing; migration 017 did not run.');
  }
  const platformHash = await bcrypt.hash(platformPassword, 12);
  const platformUser = await pool.query(
    `INSERT INTO users
       (organization_id, email, password_hash, display_name, role,
        is_active, platform_level, admin_level)
     VALUES ($1, lower($2), $3, 'مدیر سامانه', 'admin', true, 'owner', 'owner')
     ON CONFLICT (organization_id, email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           display_name = EXCLUDED.display_name,
           role = 'admin',
           is_active = true,
           platform_level = 'owner',
           must_change_password = false,
           failed_login_attempts = 0,
           account_locked_until = NULL
     RETURNING id`,
    [platformOrgId, platformEmail, platformHash],
  );
  await pool.query(
    `INSERT INTO password_history (user_id, password_hash, created_at)
     VALUES ($1, $2, now())`,
    [platformUser.rows[0].id, platformHash],
  );
  console.log(`Platform administrator ready: ${platformEmail}`);
}
console.log('Database migration completed.');
await pool.end();
