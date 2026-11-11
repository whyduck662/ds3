import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { gatewayApp } from '../src/services/api-gateway/src/app.js';
import { identityApp } from '../src/services/identity-service/src/app.js';
import { notificationApp, saveNotification } from '../src/services/notification-service/src/app.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
describe('Gateway security', () => {
  it('chặn token sai, sai role và internal trước proxy', async () => {
    const app = await gatewayApp(); apps.push(app);
    const token = app.jwt.sign({ userId: randomUUID(), role: 'PASSENGER' });
    expect((await app.inject('/users/me')).statusCode).toBe(401);
    expect((await app.inject({ url: '/users/me', headers: { authorization: 'Bearer invalid' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/drivers/me', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
    expect((await app.inject('/internal/drivers/available')).statusCode).toBe(403);
  });
  it('không cho public register tự cấp ADMIN', async () => {
    const app = await identityApp({} as Pool); apps.push(app);
    const result = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'a@example.com', name: 'A', password: 'Password123', role: 'ADMIN' } });
    expect(result.statusCode).toBe(400);
  });
  it('S01: chặn JWT hết hạn và JWT ký bởi secret khác', async () => {
    const app = await gatewayApp(); apps.push(app);
    const expired = app.jwt.sign({ userId: randomUUID(), role: 'PASSENGER' }, { expiresIn: -1 });
    expect((await app.inject({ url: '/users/me', headers: { authorization: `Bearer ${expired}` } })).statusCode).toBe(401);
    const valid = app.jwt.sign({ userId: randomUUID(), role: 'PASSENGER' });
    const invalid = `${valid.slice(0, -12)}aaaaaaaaaaaa`;
    expect((await app.inject({ url: '/users/me', headers: { authorization: `Bearer ${invalid}` } })).statusCode).toBe(401);
  });
  it('S03/S04: giới hạn body và mật khẩu UTF-8, không nhận field thừa', async () => {
    const app = await identityApp({} as Pool); apps.push(app);
    for (const payload of [
      { email: 'bad-email', password: 'Password123', name: 'A', role: 'PASSENGER' },
      { email: 'a@test.local', password: 'ấ'.repeat(25), name: 'A', role: 'PASSENGER' },
      { email: 'a@test.local', password: 'Password123', name: 'A', role: 'PASSENGER', userId: randomUUID() }
    ]) expect((await app.inject({ method: 'POST', url: '/auth/register', payload })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'x'.repeat(11000) } })).statusCode).toBe(413);
  });
  it('S05: chặn internal và payment command qua Gateway', async () => {
    const app = await gatewayApp(); apps.push(app);
    const headers = { authorization: `Bearer ${app.jwt.sign({ userId: randomUUID(), role: 'ADMIN' })}` };
    for (const url of ['/internal/drivers/available', '/internal/payments/123/status', '/payments/authorize', '/trips/../../internal/test']) {
      expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(403);
    }
  });
  it('Gateway chuyển correlation/idempotency nhưng bỏ header giả danh, giới hạn auth', async () => {
    const upstream = Fastify(); apps.push(upstream);
    upstream.post('/auth/login', async request => request.headers);
    const previous = process.env.IDENTITY_URL;
    process.env.IDENTITY_URL = await upstream.listen({ host: '127.0.0.1', port: 0 });
    try {
      const app = await gatewayApp(); apps.push(app);
      expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { password: 'x'.repeat(11000) } })).statusCode).toBe(413);
      const correlationId = randomUUID(), idempotencyKey = randomUUID();
      const response = await app.inject({ method: 'POST', url: '/auth/login', payload: {}, headers: {
        'x-correlation-id': correlationId, 'idempotency-key': idempotencyKey,
        'x-user-id': randomUUID(), 'x-user-role': 'ADMIN', 'x-internal-token': 'forged'
      } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(correlationId);
      expect(response.json()['x-correlation-id']).toBe(correlationId);
      expect(response.json()['idempotency-key']).toBe(idempotencyKey);
      for (const header of ['x-user-id', 'x-user-role', 'x-internal-token']) expect(response.json()).not.toHaveProperty(header);
      let status = 200;
      for (let i = 0; i < 10; i++) status = (await app.inject({ method: 'POST', url: '/auth/login', payload: {} })).statusCode;
      expect(status).toBe(429);
    } finally { if (previous) process.env.IDENTITY_URL = previous; else delete process.env.IDENTITY_URL; }
  });
  it('Gateway trả lỗi 503 thống nhất khi upstream không chạy', async () => {
    const previous = process.env.IDENTITY_URL; process.env.IDENTITY_URL = 'http://127.0.0.1:1';
    try {
      const app = await gatewayApp(); apps.push(app);
      const response = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('SERVICE_UNAVAILABLE');
      expect(response.json().correlationId).toBe(response.headers['x-correlation-id']);
    } finally { if (previous) process.env.IDENTITY_URL = previous; else delete process.env.IDENTITY_URL; }
  });
});
describe('Notification', () => {
  it('lấy user từ JWT và từ chối query giả danh', async () => {
    const queries: unknown[][] = [];
    const pool = { query: async (_sql: string, values: unknown[]) => { queries.push(values); return { rows: [] }; } } as unknown as Pool;
    const app = await notificationApp(pool); apps.push(app);
    const userId = randomUUID();
    const headers = { authorization: `Bearer ${app.jwt.sign({ userId, role: 'PASSENGER' })}` };
    expect((await app.inject({ url: '/notifications/me', headers })).statusCode).toBe(200);
    expect(queries[0][0]).toBe(userId);
    expect((await app.inject({ url: `/notifications/me?userId=${randomUUID()}`, headers })).statusCode).toBe(400);
    expect((await app.inject({ url: '/notifications/me?since=invalid', headers })).statusCode).toBe(400);
  });
  it('rollback nếu ghi thông báo lỗi và bỏ qua nghiệp vụ khi inbox trùng', async () => {
    const tripId = randomUUID();
    const event = { eventId: randomUUID(), type: 'trip.paid', schemaVersion: 1, occurredAt: new Date().toISOString(), correlationId: randomUUID(), causationId: null, producer: { service: 'trip-service', instanceId: 'trip-1' }, aggregateId: tripId, aggregateVersion: 1, matchAttempt: 1, payload: { tripId, passengerId: randomUUID() } };
    const calls: string[] = [];
    let duplicate = false;
    const client = { query: async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO notifications')) throw new Error('DB failure');
      return { rowCount: duplicate ? 0 : 1 };
    }, release: () => calls.push('RELEASE') };
    const pool = { connect: async () => client } as unknown as Pool;
    await expect(saveNotification(pool, event)).rejects.toThrow('DB failure');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    calls.length = 0; duplicate = true;
    expect((await saveNotification(pool, event)).duplicate).toBe(true);
    expect(calls).toContain('COMMIT');
    expect(calls.some(sql => sql.startsWith('INSERT INTO notifications'))).toBe(false);
  });
});
