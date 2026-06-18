import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login } from './helpers.js';

const app = createApp();
const API = '/api/v1';

describe('self-service profile update (PATCH /auth/me)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('requires authentication', async () => {
    const res = await request(app).patch(`${API}/auth/me`).send({ full_name: 'X' });
    expect(res.status).toBe(401);
  });

  it('lets any user update their own full name and email', async () => {
    const token = await login(app, 'tech'); // non-admin user
    const res = await request(app)
      .patch(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Tech Person', email: 'tech@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe('Tech Person');
    expect(res.body.email).toBe('tech@example.com');

    // Persisted + decrypted on read
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.body.full_name).toBe('Tech Person');
    expect(me.body.email).toBe('tech@example.com');
  });

  it('can clear the email with null and leave name unchanged', async () => {
    const token = await login(app, 'admin');
    await request(app).patch(`${API}/auth/me`).set('Authorization', `Bearer ${token}`).send({ email: 'a@b.com' });
    const cleared = await request(app).patch(`${API}/auth/me`).set('Authorization', `Bearer ${token}`).send({ email: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.email).toBeNull();
    expect(cleared.body.full_name).toBe('admin'); // unchanged
  });

  it('rejects an empty update and an invalid email', async () => {
    const token = await login(app, 'admin');
    expect((await request(app).patch(`${API}/auth/me`).set('Authorization', `Bearer ${token}`).send({})).status).toBe(400);
    expect((await request(app).patch(`${API}/auth/me`).set('Authorization', `Bearer ${token}`).send({ email: 'not-an-email' })).status).toBe(400);
  });
});
