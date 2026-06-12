import { beforeAll } from 'vitest';

// Ensure env is set before any app module loads (globalSetup runs in a separate
// process, so re-assert the test connection + secrets here too).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://ims_user:ims_dev_password@localhost:5432/ims_test';
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? '100000';
process.env.PASSWORD_SALT_ROUNDS = '4';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test_access_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test_refresh_secret';

beforeAll(() => {
  // marker hook so Vitest loads this file
});
