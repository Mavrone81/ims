import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  apiBasePath: process.env.API_BASE_PATH ?? '/api/v1',
  databaseUrl: required('DATABASE_URL'),
  dbPoolMax: Number(process.env.DB_POOL_MAX ?? 10),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  saltRounds: Number(process.env.PASSWORD_SALT_ROUNDS ?? 12),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(','),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  defaultBaseCurrency: process.env.DEFAULT_BASE_CURRENCY ?? 'USD',
  writeOffApprovalThreshold: Number(process.env.WRITE_OFF_APPROVAL_THRESHOLD ?? 500),
  allowNegativeStock: (process.env.ALLOW_NEGATIVE_STOCK ?? 'false') === 'true',
};
