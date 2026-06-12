import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login, type Baseline } from './helpers.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;

beforeAll(async () => {
  base = await resetDb();
});

async function tok(u: string) {
  return login(app, u);
}

describe('RBAC & tenant isolation', () => {
  it('technician cannot delete an item (manager+)', async () => {
    const token = await tok('tech');
    // create an item first as admin
    const admin = await tok('admin');
    const created = await request(app).post(`${API}/items`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId)
      .send({ item_no: 'IT-1', description: 'thing' });
    expect(created.status).toBe(201);
    const res = await request(app).delete(`${API}/items/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`).set('X-Project-Id', base.projectId);
    expect(res.status).toBe(403);
  });

  it('technician cannot create a user (org admin only)', async () => {
    const token = await tok('tech');
    const res = await request(app).post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'x', full_name: 'x', password: 'password1' });
    expect(res.status).toBe(403);
  });

  it('viewer cannot record a movement (technician+)', async () => {
    const token = await tok('viewer');
    const res = await request(app).post(`${API}/transactions`)
      .set('Authorization', `Bearer ${token}`).set('X-Project-Id', base.projectId)
      .send({ type: 'receipt', item_id: base.users.admin, to_location_id: base.loc1, quantity: 1 });
    expect(res.status).toBe(403);
  });

  it('blocks access to a project in another organization', async () => {
    // second tenant
    const org2 = await resetSecondOrg();
    const token = await tok2(org2.username);
    const res = await request(app).get(`${API}/items`)
      .set('Authorization', `Bearer ${token}`).set('X-Project-Id', base.projectId);
    expect(res.status).toBe(403);
    // restore baseline for subsequent files
    base = await resetDb();
  });
});

// Helpers that create a separate org sharing the same app/db.
async function resetSecondOrg() {
  const { pool } = await import('../src/db.js');
  const bcrypt = (await import('bcryptjs')).default;
  const org = (await pool.query(`INSERT INTO organizations (name, base_currency) VALUES ('Other', 'USD') RETURNING id`)).rows[0];
  const site = (await pool.query(`INSERT INTO sites (org_id, code, name) VALUES ($1,'OS','Other site') RETURNING id`, [org.id])).rows[0];
  await pool.query(`INSERT INTO projects (site_id, code, name) VALUES ($1,'OP','Other project')`, [site.id]);
  const hash = await bcrypt.hash('password1', 4);
  await pool.query(`INSERT INTO users (org_id, username, full_name, password_hash, is_org_admin) VALUES ($1,'other_admin','o',$2,true)`, [org.id, hash]);
  return { orgId: org.id, username: 'other_admin' };
}
async function tok2(username: string) {
  return login(app, username);
}
