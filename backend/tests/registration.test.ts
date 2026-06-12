import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login, type Baseline } from './helpers.js';
import { pool } from '../src/db.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;

beforeEach(async () => {
  base = await resetDb();
});

describe('self-service registration & approval', () => {
  it('lists active companies publicly', async () => {
    const res = await request(app).get(`${API}/auth/companies`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: any) => c.name === 'TestCo')).toBe(true);
  });

  it('with approval required: registers pending and blocks login until approved', async () => {
    const reg = await request(app).post(`${API}/auth/register`)
      .send({ org_id: base.orgId, username: 'newbie', full_name: 'New Bie', password: 'password1' });
    expect(reg.status).toBe(201);
    expect(reg.body.status).toBe('pending');

    const blocked = await request(app).post(`${API}/auth/login`).send({ username: 'newbie', password: 'password1' });
    expect(blocked.status).toBe(403);

    // admin approves
    const admin = await login(app, 'admin');
    const list = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${admin}`);
    const pending = list.body.data.find((u: any) => u.username === 'newbie');
    expect(pending.approval_status).toBe('pending');
    const ap = await request(app).post(`${API}/users/${pending.id}/approve`).set('Authorization', `Bearer ${admin}`);
    expect(ap.status).toBe(200);

    const ok = await request(app).post(`${API}/auth/login`).send({ username: 'newbie', password: 'password1' });
    expect(ok.status).toBe(200);
  });

  it('with approval disabled: registration is immediately usable', async () => {
    await pool.query(`UPDATE organizations SET require_user_approval = FALSE WHERE id = $1`, [base.orgId]);
    const reg = await request(app).post(`${API}/auth/register`)
      .send({ org_id: base.orgId, username: 'instant', full_name: 'In Stant', password: 'password1' });
    expect(reg.body.status).toBe('approved');
    const ok = await request(app).post(`${API}/auth/login`).send({ username: 'instant', password: 'password1' });
    expect(ok.status).toBe(200);
  });

  it('rejects duplicate usernames', async () => {
    const res = await request(app).post(`${API}/auth/register`)
      .send({ org_id: base.orgId, username: 'admin', full_name: 'dupe', password: 'password1' });
    expect(res.status).toBe(409);
  });
});
