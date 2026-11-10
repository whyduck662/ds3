import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
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
