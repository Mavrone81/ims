import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, type Baseline } from './helpers.js';
import { pool } from '../src/db.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;

async function platformToken() {
  const hash = await bcrypt.hash('platpass1', 4);
  await pool.query(
    `INSERT INTO platform_admins (username, password_hash) VALUES ('padmin', $1)
     ON CONFLICT (username) DO UPDATE SET password_hash = $1`,
    [hash]
  );
  const res = await request(app).post(`${API}/platform/auth/login`).send({ username: 'padmin', password: 'platpass1' });
  return res.body.access_token as string;
}

beforeEach(async () => {
  base = await resetDb();
});

describe('platform admin', () => {
  it('provisions a company with its own admin + default labels', async () => {
    const pt = await platformToken();
    const res = await request(app).post(`${API}/platform/orgs`).set('Authorization', `Bearer ${pt}`)
      .send({ name: 'NewCo', admin_username: 'newco_admin', admin_password: 'password1', admin_full_name: 'NC Admin' });
    expect(res.status).toBe(201);
    const login = await request(app).post(`${API}/auth/login`).send({ username: 'newco_admin', password: 'password1' });
    expect(login.status).toBe(200);
    const proj = (await request(app).get(`${API}/projects`)
      .set('Authorization', `Bearer ${login.body.access_token}`)).body.data[0].id;
    const labels = await request(app).get(`${API}/txn-labels`)
      .set('Authorization', `Bearer ${login.body.access_token}`).set('X-Project-Id', proj);
    expect(labels.body.data.length).toBe(5);
  });

  it('deactivating a company blocks its users from signing in', async () => {
    const pt = await platformToken();
    const created = await request(app).post(`${API}/platform/orgs`).set('Authorization', `Bearer ${pt}`)
      .send({ name: 'TempCo', admin_username: 'temp_admin', admin_password: 'password1', admin_full_name: 'T' });
    expect((await request(app).post(`${API}/auth/login`).send({ username: 'temp_admin', password: 'password1' })).status).toBe(200);
    await request(app).patch(`${API}/platform/orgs/${created.body.org_id}`).set('Authorization', `Bearer ${pt}`).send({ is_active: false });
    expect((await request(app).post(`${API}/auth/login`).send({ username: 'temp_admin', password: 'password1' })).status).toBe(401);
  });

  it('rejects org tokens on platform routes and vice versa', async () => {
    const pt = await platformToken();
    const orgLogin = await request(app).post(`${API}/auth/login`).send({ username: 'admin', password: 'password1' });
    expect((await request(app).get(`${API}/platform/orgs`).set('Authorization', `Bearer ${orgLogin.body.access_token}`)).status).toBe(401);
    expect((await request(app).get(`${API}/users`).set('Authorization', `Bearer ${pt}`)).status).toBe(401);
  });

  it('toggles self-registration approval for a company', async () => {
    const pt = await platformToken();
    const res = await request(app).patch(`${API}/platform/orgs/${base.orgId}`)
      .set('Authorization', `Bearer ${pt}`).send({ require_user_approval: false });
    expect(res.status).toBe(200);
    expect(res.body.require_user_approval).toBe(false);
  });

  it('lists known currencies for the base-currency picker', async () => {
    const pt = await platformToken();
    const res = await request(app).get(`${API}/platform/currencies`).set('Authorization', `Bearer ${pt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(10);
    expect(res.body.data.some((c: any) => c.code === 'USD')).toBe(true);
  });

  it('edits a company profile (name + base currency) and ensures the currency exists', async () => {
    const pt = await platformToken();
    const res = await request(app).patch(`${API}/platform/orgs/${base.orgId}`)
      .set('Authorization', `Bearer ${pt}`).send({ name: 'Renamed Co', base_currency: 'gbp' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed Co');
    expect(res.body.base_currency.trim()).toBe('GBP');
    // the chosen currency was inserted so the org can use it
    const cur = await pool.query(`SELECT 1 FROM currencies WHERE code = 'GBP'`);
    expect(cur.rowCount).toBe(1);
  });
});
