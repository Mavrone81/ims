import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login, type Baseline } from './helpers.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;
let admin: string;

async function makeItem(itemNo = 'IT-1') {
  const res = await request(app).post(`${API}/items`)
    .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId)
    .send({ item_no: itemNo, description: 'thing', unit_price: 100, currency: 'USD', reorder_level: 1 });
  return res.body.id;
}
function post(token: string, body: any) {
  return request(app).post(`${API}/transactions`)
    .set('Authorization', `Bearer ${token}`).set('X-Project-Id', base.projectId).send(body);
}

beforeEach(async () => {
  base = await resetDb();
  admin = await login(app, 'admin');
});

describe('stock ledger & business rules', () => {
  it('derives on-hand from receipts and issues', async () => {
    const item = await makeItem();
    await post(admin, { type: 'receipt', item_id: item, to_location_id: base.loc1, quantity: 10 });
    const issue = await post(admin, { type: 'issue', item_id: item, from_location_id: base.loc1, quantity: 3 });
    expect(issue.status).toBe(201);
    expect(issue.body.stock_on_hand).toBe(7);
  });

  it('blocks over-issue when negative stock is disallowed (422)', async () => {
    const item = await makeItem();
    await post(admin, { type: 'receipt', item_id: item, to_location_id: base.loc1, quantity: 2 });
    const res = await post(admin, { type: 'issue', item_id: item, from_location_id: base.loc1, quantity: 5 });
    expect(res.status).toBe(422);
  });

  it('transfers between locations without changing total on-hand', async () => {
    const item = await makeItem();
    await post(admin, { type: 'receipt', item_id: item, to_location_id: base.loc1, quantity: 5 });
    const tr = await post(admin, { type: 'transfer', item_id: item, from_location_id: base.loc1, to_location_id: base.loc2, quantity: 2 });
    expect(tr.status).toBe(201);
    expect(tr.body.stock_on_hand).toBe(5);
  });

  it('reverses a transaction and restores the balance; double-reverse is blocked', async () => {
    const item = await makeItem();
    await post(admin, { type: 'receipt', item_id: item, to_location_id: base.loc1, quantity: 5 });
    const issue = await post(admin, { type: 'issue', item_id: item, from_location_id: base.loc1, quantity: 2 });
    const rev = await request(app).post(`${API}/transactions/${issue.body.id}/reverse`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId).send({ reason: 'test' });
    expect(rev.status).toBe(201);
    const dbl = await request(app).post(`${API}/transactions/${issue.body.id}/reverse`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId).send({ reason: 'again' });
    expect(dbl.status).toBe(422);
    const detail = await request(app).get(`${API}/items/${item}`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId);
    expect(detail.body.stock_on_hand).toBe(5); // 5 - 2 + 2
  });

  it('records a movement via a custom label, storing base type + label text', async () => {
    const item = await makeItem();
    const labels = await request(app).get(`${API}/txn-labels`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId);
    const issueLabel = labels.body.data.find((l: any) => l.base_type === 'issue');
    // rename it to Dispatch
    await request(app).patch(`${API}/txn-labels/${issueLabel.id}`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId).send({ label: 'Dispatch' });
    await post(admin, { type: 'receipt', item_id: item, to_location_id: base.loc1, quantity: 5 });
    const mv = await post(admin, { label_id: issueLabel.id, item_id: item, from_location_id: base.loc1, quantity: 1 });
    expect(mv.status).toBe(201);
    expect(mv.body.type).toBe('issue');
    expect(mv.body.label).toBe('Dispatch');
  });
});
