import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { pool } from '../src/db.js';
import { seedTxnLabels } from '../src/routes/txnLabels.js';
import { _resetLoginRateLimit } from '../src/middleware/loginRateLimit.js';

const ALL_TABLES = [
  'audit_logs', 'refresh_tokens', 'custom_field_values', 'custom_field_options',
  'custom_field_defs', 'purchase_order_lines', 'purchase_orders', 'stock_transactions',
  'stock_levels', 'item_suppliers', 'attachments', 'items', 'txn_labels',
  'project_members', 'projects', 'locations', 'sites', 'suppliers', 'categories',
  'exchange_rates', 'users', 'platform_admins', 'organizations', 'currencies',
];

export interface Baseline {
  orgId: string;
  siteId: string;
  projectId: string;
  loc1: string;
  loc2: string;
  categoryId: string;
  supplierId: string;
  users: Record<'admin' | 'manager' | 'tech' | 'viewer', string>;
}

/** Wipe all data and insert a known fixture. Returns the seeded IDs. */
export async function resetDb(): Promise<Baseline> {
  _resetLoginRateLimit();
  await pool.query(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  const org = (await pool.query(
    `INSERT INTO organizations (name, base_currency) VALUES ('TestCo', 'USD') RETURNING id`
  )).rows[0];

  await pool.query(`INSERT INTO currencies (code, name) VALUES ('USD','USD'),('SGD','SGD'),('EUR','EUR')`);
  await pool.query(
    `INSERT INTO exchange_rates (org_id, from_currency, to_currency, rate, effective_date)
     VALUES ($1,'SGD','USD',0.74,'2026-01-01'), ($1,'EUR','USD',1.08,'2026-01-01')`,
    [org.id]
  );

  const site = (await pool.query(
    `INSERT INTO sites (org_id, code, name) VALUES ($1,'S1','Site 1') RETURNING id`, [org.id]
  )).rows[0];
  const project = (await pool.query(
    `INSERT INTO projects (site_id, code, name) VALUES ($1,'P1','Project 1') RETURNING id`, [site.id]
  )).rows[0];
  const loc1 = (await pool.query(
    `INSERT INTO locations (site_id, code, name) VALUES ($1,'L1','Loc 1') RETURNING id`, [site.id]
  )).rows[0];
  const loc2 = (await pool.query(
    `INSERT INTO locations (site_id, code, name) VALUES ($1,'L2','Loc 2') RETURNING id`, [site.id]
  )).rows[0];
  const category = (await pool.query(
    `INSERT INTO categories (org_id, name) VALUES ($1,'Valves') RETURNING id`, [org.id]
  )).rows[0];
  const supplier = (await pool.query(
    `INSERT INTO suppliers (org_id, name) VALUES ($1,'Acme Supply') RETURNING id`, [org.id]
  )).rows[0];

  const client = await pool.connect();
  try {
    await seedTxnLabels(client, org.id);
  } finally {
    client.release();
  }

  const hash = await bcrypt.hash('password1', 4);
  const mkUser = async (username: string, isAdmin = false) =>
    (await pool.query(
      `INSERT INTO users (org_id, username, full_name, password_hash, is_org_admin)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [org.id, username, username, hash, isAdmin]
    )).rows[0].id;

  const users = {
    admin: await mkUser('admin', true),
    manager: await mkUser('manager'),
    tech: await mkUser('tech'),
    viewer: await mkUser('viewer'),
  };
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES
     ($1,$2,'manager'), ($1,$3,'technician'), ($1,$4,'viewer')`,
    [project.id, users.manager, users.tech, users.viewer]
  );

  return {
    orgId: org.id, siteId: site.id, projectId: project.id,
    loc1: loc1.id, loc2: loc2.id, categoryId: category.id, supplierId: supplier.id, users,
  };
}

/** Log in and return the access token. */
export async function login(app: Express, username: string, password = 'password1'): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

/** Helper to attach auth + project headers to a supertest request. */
export function auth(token: string, projectId?: string) {
  return (req: request.Test) => {
    req.set('Authorization', `Bearer ${token}`);
    if (projectId) req.set('X-Project-Id', projectId);
    return req;
  };
}
