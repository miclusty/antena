import { describe, expect, test } from 'vitest';
import app from '../src/routes/llm/cite';
import { env } from 'cloudflare:test';

describe('GET /api/llm/cite', () => {
  test('returns 400 when id is missing', async () => {
    const res = await app.request('/api/llm/cite', { method: 'GET' }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Missing id/);
  });

  test('returns 400 when id is empty string', async () => {
    const res = await app.request('/api/llm/cite?id=', { method: 'GET' }, env);
    expect(res.status).toBe(400);
  });
});
