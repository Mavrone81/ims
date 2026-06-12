import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login, type Baseline } from './helpers.js';
import { pool } from '../src/db.js';
import { encryptField, decryptField } from '../src/utils/crypto.js';

const app = createApp();
const API = '/api/v1';
let base: Baseline;
let admin: string;

beforeEach(async () => {
  base = await resetDb();
  admin = await login(app, 'admin');
});

describe('column-level PII encryption', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const ct = encryptField('secret@example.com');
    expect(ct).toMatch(/^enc:v1:/);
    expect(ct).not.toContain('secret@example.com');
    expect(decryptField(ct)).toBe('secret@example.com');
  });

  it('stores supplier contact PII as ciphertext but returns plaintext via the API', async () => {
    const created = await request(app).post(`${API}/suppliers`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId)
      .send({ name: 'Contacted Co', contact_name: 'Jane Doe', email: 'jane@vendor.com', phone: '+65 1234 5678' });
    expect(created.status).toBe(201);
    // API response is decrypted
    expect(created.body.email).toBe('jane@vendor.com');
    expect(created.body.contact_name).toBe('Jane Doe');

    // raw DB row is ciphertext
    const raw = await pool.query(`SELECT contact_name, email, phone FROM suppliers WHERE id = $1`, [created.body.id]);
    expect(raw.rows[0].email).toMatch(/^enc:v1:/);
    expect(raw.rows[0].email).not.toContain('jane@vendor.com');
    expect(raw.rows[0].contact_name).toMatch(/^enc:v1:/);
    expect(raw.rows[0].phone).toMatch(/^enc:v1:/);

    // list endpoint also returns plaintext
    const list = await request(app).get(`${API}/suppliers`)
      .set('Authorization', `Bearer ${admin}`).set('X-Project-Id', base.projectId);
    const found = list.body.data.find((s: any) => s.id === created.body.id);
    expect(found.email).toBe('jane@vendor.com');
  });

  it('stores a user email as ciphertext but returns plaintext', async () => {
    const created = await request(app).post(`${API}/users`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ username: 'withemail', full_name: 'With Email', email: 'user@corp.com', password: 'password1' });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('user@corp.com');

    const raw = await pool.query(`SELECT email FROM users WHERE id = $1`, [created.body.id]);
    expect(raw.rows[0].email).toMatch(/^enc:v1:/);

    const list = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${admin}`);
    expect(list.body.data.find((u: any) => u.username === 'withemail').email).toBe('user@corp.com');
  });

  it('passes through legacy plaintext on read (back-compat)', () => {
    expect(decryptField('plain-old-value')).toBe('plain-old-value');
    expect(decryptField(null)).toBe(null);
  });
});
