import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { paymentApp } from '../src/services/payment-service/src/app.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('Payment Service HTTP API', () => {
  it('từ chối request không có JWT', async () => {
    const mockPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const app = await paymentApp(mockPool);
    apps.push(app);

    const res = await app.inject({ method: 'GET', url: `/payments/${randomUUID()}` });
    expect(res.statusCode).toBe(401);
  });

  it('trả về 404 nếu không tìm thấy payment', async () => {
    const mockPool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const app = await paymentApp(mockPool);
    apps.push(app);

    const passengerId = randomUUID();
    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });
    const res = await app.inject({
      method: 'GET',
      url: `/payments/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(404);
  });

  it('chặn Passenger A xem payment của Passenger B (S05)', async () => {
    const passengerA = randomUUID();
    const passengerB = randomUUID();
    const tripId = randomUUID();

    const mockPool = {
      query: async () => ({
        rows: [{ trip_id: tripId, passenger_id: passengerB, amount: 25000, status: 'AUTHORIZED' }]
      })
    } as unknown as Pool;

    const app = await paymentApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: passengerA, role: 'PASSENGER' });
    const res = await app.inject({
      method: 'GET',
      url: `/payments/${tripId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(403);
  });

  it('cho phép Passenger xem payment của chính mình', async () => {
    const passengerId = randomUUID();
    const tripId = randomUUID();

    const mockPool = {
      query: async () => ({
        rows: [{ trip_id: tripId, passenger_id: passengerId, amount: 25000, status: 'AUTHORIZED' }]
      })
    } as unknown as Pool;

    const app = await paymentApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });
    const res = await app.inject({
      method: 'GET',
      url: `/payments/${tripId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tripId,
      status: 'AUTHORIZED',
      amount: 25000
    });
  });

  it('cho phép ADMIN xem payment của bất kỳ ai', async () => {
    const adminId = randomUUID();
    const passengerId = randomUUID();
    const tripId = randomUUID();

    const mockPool = {
      query: async () => ({
        rows: [{ trip_id: tripId, passenger_id: passengerId, amount: 30000, status: 'CAPTURED' }]
      })
    } as unknown as Pool;

    const app = await paymentApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: adminId, role: 'ADMIN' });
    const res = await app.inject({
      method: 'GET',
      url: `/payments/${tripId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tripId,
      status: 'CAPTURED',
      amount: 30000
    });
  });

  it('hỗ trợ internal route đối soát payment status', async () => {
    const tripId = randomUUID();
    const mockPool = {
      query: async () => ({
        rows: [{ trip_id: tripId, passenger_id: randomUUID(), amount: 35000, status: 'AUTHORIZED', version: 1 }]
      })
    } as unknown as Pool;

    const app = await paymentApp(mockPool);
    apps.push(app);

    const res = await app.inject({
      method: 'GET',
      url: `/internal/payments/${tripId}/status`
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      tripId,
      status: 'AUTHORIZED',
      amount: 35000,
      version: 1
    });
  });
});

