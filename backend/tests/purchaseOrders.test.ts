import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login, auth, type Baseline } from './helpers.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;
let admin: string;
let tech: string;
let viewer: string;

async function makeItem(itemNo: string, withLocation = true) {
  const res = await auth(admin, base.projectId)(request(app).post(`${API}/items`)).send({
    item_no: itemNo,
    description: 'thing',
    unit_price: 100,
    currency: 'USD',
    default_location_id: withLocation ? base.loc1 : undefined,
  });
  return res.body.id;
}

function onHand(token: string, itemId: string) {
  return auth(token, base.projectId)(request(app).get(`${API}/items/${itemId}`)).then(
    (r) => r.body.stock_on_hand as number
  );
}

beforeEach(async () => {
  base = await resetDb();
  admin = await login(app, 'admin');
  tech = await login(app, 'tech');
  viewer = await login(app, 'viewer');
});

describe('purchase orders', () => {
  it('creates a PO with lines (technician)', async () => {
    const item = await makeItem('PO-IT-1');
    const res = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders`)).send({
      supplier_id: base.supplierId,
      po_number: 'PO-1',
      currency: 'USD',
      lines: [{ item_id: item, qty_ordered: 10, unit_price: 100 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].qty_ordered).toBe(10);
    expect(res.body.lines[0].qty_received).toBe(0);
  });

  it('rejects a duplicate po_number in the same project (409)', async () => {
    const item = await makeItem('PO-IT-2');
    const body = {
      supplier_id: base.supplierId,
      po_number: 'PO-DUP',
      lines: [{ item_id: item, qty_ordered: 1 }],
    };
    await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders`)).send(body);
    const dup = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders`)).send(body);
    expect(dup.status).toBe(409);
  });

  it('receives partially then fully, advancing status and posting receipts', async () => {
    const item = await makeItem('PO-IT-3');
    const create = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders`)).send({
      supplier_id: base.supplierId,
      po_number: 'PO-3',
      currency: 'USD',
      lines: [{ item_id: item, qty_ordered: 10, unit_price: 100 }],
    });
    const lineId = create.body.lines[0].id;

    // Partial receipt of 4 → status 'partial', on-hand 4.
    const partial = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders/${create.body.id}/receive`))
      .send({ lines: [{ line_id: lineId, qty: 4 }] });
    expect(partial.status).toBe(200);
    expect(partial.body.status).toBe('partial');
    expect(partial.body.lines[0].qty_received).toBe(4);
    expect(await onHand(tech, item)).toBe(4);

    // Receive the remaining 6 → status 'received', on-hand 10.
    const full = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders/${create.body.id}/receive`))
      .send({ lines: [{ line_id: lineId, qty: 6 }] });
    expect(full.body.status).toBe('received');
    expect(await onHand(tech, item)).toBe(10);
  });

  it('blocks over-receipt beyond what is outstanding (422)', async () => {
    const item = await makeItem('PO-IT-4');
    const create = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders`)).send({
      supplier_id: base.supplierId,
      po_number: 'PO-4',
      lines: [{ item_id: item, qty_ordered: 5 }],
    });
    const res = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders/${create.body.id}/receive`))
      .send({ lines: [{ line_id: create.body.lines[0].id, qty: 9 }] });
    expect(res.status).toBe(422);
    expect(await onHand(tech, item)).toBe(0); // nothing posted
  });

  it('requires a location when the line item has no default (400)', async () => {
    const item = await makeItem('PO-IT-5', false);
    const create = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders`)).send({
      supplier_id: base.supplierId,
      po_number: 'PO-5',
      lines: [{ item_id: item, qty_ordered: 3 }],
    });
    const noLoc = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders/${create.body.id}/receive`))
      .send({ lines: [{ line_id: create.body.lines[0].id, qty: 1 }] });
    expect(noLoc.status).toBe(400);
    const ok = await auth(tech, base.projectId)(request(app).post(`${API}/purchase-orders/${create.body.id}/receive`))
      .send({ lines: [{ line_id: create.body.lines[0].id, qty: 1, to_location_id: base.loc2 }] });
    expect(ok.status).toBe(200);
    expect(await onHand(tech, item)).toBe(1);
  });

  it('forbids a viewer from creating a PO (403)', async () => {
    const item = await makeItem('PO-IT-6');
    const res = await auth(viewer, base.projectId)(request(app).post(`${API}/purchase-orders`)).send({
      supplier_id: base.supplierId,
      po_number: 'PO-6',
      lines: [{ item_id: item, qty_ordered: 1 }],
    });
    expect(res.status).toBe(403);
  });
});
