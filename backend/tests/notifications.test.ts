import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, login, type Baseline } from './helpers.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;
let admin: string;
let manager: string;

function get(token: string, projectId = base.projectId) {
  return request(app).get(`${API}/me/notifications`)
    .set('Authorization', `Bearer ${token}`).set('X-Project-Id', projectId);
}

async function makeItem(itemNo: string, reorderLevel: number) {
  const res = await request(app).post(`${API}/items`)
    .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId)
    .send({ item_no: itemNo, description: 'thing', unit_price: 1, currency: 'USD', reorder_level: reorderLevel });
  return res.body.id;
}

beforeEach(async () => {
  base = await resetDb();
  admin = await login(app, 'admin');
  manager = await login(app, 'manager');
});

describe('GET /me/notifications', () => {
  it('returns no alerts when everything is healthy', async () => {
    const res = await get(admin);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('flags items at or below their reorder level', async () => {
    // reorder_level 1 with zero stock on hand -> below reorder.
    await makeItem('LOW-1', 1);
    const res = await get(manager);
    expect(res.status).toBe(200);
    const low = res.body.data.find((n: any) => n.type === 'low_stock');
    expect(low).toMatchObject({ type: 'low_stock', severity: 'warning', count: 1 });
    expect(res.body.total).toBe(1);
  });

  it('shows pending-approval alerts to org admins only', async () => {
    await pool.query(
      `INSERT INTO users (org_id, username, full_name, password_hash, self_registered, approval_status)
       VALUES ($1, 'newbie', 'New Bie', 'x', TRUE, 'pending')`,
      [base.orgId]
    );

    const adminRes = await get(admin);
    expect(adminRes.body.data.some((n: any) => n.type === 'pending_approval')).toBe(true);

    const managerRes = await get(manager);
    expect(managerRes.body.data.some((n: any) => n.type === 'pending_approval')).toBe(false);
  });
});
