import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { resetDb, login } from './helpers.js';

const app = createApp();
const API = '/api/v1';

let projectId: string;

beforeAll(async () => {
  const base = await resetDb();
  projectId = base.projectId;
});

describe('AI assistant', () => {
  it('requires authentication', async () => {
    const res = await request(app).post(`${API}/assistant`).send({ question: 'hello' });
    expect(res.status).toBe(401);
  });

  it('requires the X-Project-Id header', async () => {
    const token = await login(app, 'admin');
    const res = await request(app)
      .post(`${API}/assistant`)
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'hello' });
    expect(res.status).toBe(400); // projectScope rejects missing header
  });

  it('validates the question', async () => {
    const token = await login(app, 'admin');
    const res = await request(app)
      .post(`${API}/assistant`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Project-Id', projectId)
      .send({ question: '' });
    expect(res.status).toBe(400);
  });

  it('returns 503 when no AI key is configured (default in test/CI)', async () => {
    const token = await login(app, 'admin');
    const res = await request(app)
      .post(`${API}/assistant`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Project-Id', projectId)
      .send({ question: 'What is low on stock?' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AI_UNAVAILABLE');
  });
});
