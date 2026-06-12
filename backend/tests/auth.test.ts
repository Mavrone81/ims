import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login } from './helpers.js';

const app = createApp();
const API = '/api/v1';

beforeAll(async () => {
  await resetDb();
});

describe('authentication', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('logs in with valid credentials', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ username: 'admin', password: 'password1' });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.user.username).toBe('admin');
  });

  it('rejects a wrong password with a generic message (no enumeration)', async () => {
    const bad = await request(app).post(`${API}/auth/login`).send({ username: 'admin', password: 'nope' });
    const missing = await request(app).post(`${API}/auth/login`).send({ username: 'ghost', password: 'nope' });
    expect(bad.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(bad.body.error.message).toBe(missing.body.error.message);
  });

  it('requires a bearer token on protected routes', async () => {
    const res = await request(app).get(`${API}/users`);
    expect(res.status).toBe(401);
  });

  it('locks out after 5 failed attempts for the same (ip, username)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post(`${API}/auth/login`).send({ username: 'manager', password: 'wrong' });
    }
    const locked = await request(app).post(`${API}/auth/login`).send({ username: 'manager', password: 'password1' });
    expect(locked.status).toBe(429);
    // a different username from the same client is unaffected
    const other = await request(app).post(`${API}/auth/login`).send({ username: 'admin', password: 'password1' });
    expect(other.status).toBe(200);
  });

  it('lets a user change their own password and revokes old sessions', async () => {
    const token = await login(app, 'tech');
    const wrong = await request(app).post(`${API}/auth/change-password`)
      .set('Authorization', `Bearer ${token}`).send({ current_password: 'bad', new_password: 'newpass12' });
    expect(wrong.status).toBe(401);

    const ok = await request(app).post(`${API}/auth/change-password`)
      .set('Authorization', `Bearer ${token}`).send({ current_password: 'password1', new_password: 'newpass12' });
    expect(ok.status).toBe(204);

    expect((await request(app).post(`${API}/auth/login`).send({ username: 'tech', password: 'password1' })).status).toBe(401);
    expect((await request(app).post(`${API}/auth/login`).send({ username: 'tech', password: 'newpass12' })).status).toBe(200);
  });
});
