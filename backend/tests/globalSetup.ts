import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Global test setup: ensures the test database exists and the full migration
 * set is applied once before the suite runs. Uses TEST_DATABASE_URL (falls back
 * to a local `ims_test` database). NEVER point this at the dev/prod database.
 */
export default async function () {
  const testUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://ims_user:ims_dev_password@localhost:5432/ims_test';
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  // Keep limiters out of the way except where a test exercises them explicitly.
  process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '100000';
  process.env.PASSWORD_SALT_ROUNDS = '4'; // fast hashing in tests
  process.env.JWT_ACCESS_SECRET = 'test_access_secret';
  process.env.JWT_REFRESH_SECRET = 'test_refresh_secret';

  // Create the test database if missing (connect to the maintenance db first).
  const adminUrl = new URL(testUrl);
  const dbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  // Apply migrations in order (idempotent — tracked in schema_migrations).
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const dir = join(process.cwd(), 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    await client.query(readFileSync(join(dir, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
  }
  await client.end();
}
