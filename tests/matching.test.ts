import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { matchingApp } from '../src/services/matching-service/src/app.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('Matching Service HTTP API (TV3)', () => {
  it('trả về 404 khi không tìm thấy match attempt', async () => {
    const mockPool = {
      query: async () => ({ rowCount: 0, rows: [] })
    } as unknown as Pool;

    const app = await matchingApp(mockPool);
    apps.push(app);

    const tripId = randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: `/internal/matching/${tripId}/1`
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('ATTEMPT_NOT_FOUND');
  });

  it('trả về thông tin match attempt khi tìm thấy', async () => {
    const tripId = randomUUID();
    const driverId = randomUUID();
    const reservationId = randomUUID();

    const mockPool = {
      query: async () => ({
        rowCount: 1,
        rows: [{
          id: 1,
          tripId,
          attempt: 1,
          status: 'RESERVED',
          candidateDriverId: driverId,
          reservationId,
          claimToken: randomUUID(),
          claimedUntil: new Date(Date.now() + 10000).toISOString(),
          claimedBy: 'matching-service-1',
          correlationId: tripId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }]
      })
    } as unknown as Pool;

    const app = await matchingApp(mockPool);
    apps.push(app);

    const res = await app.inject({
      method: 'GET',
      url: `/internal/matching/${tripId}/1`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tripId).toBe(tripId);
    expect(body.attempt).toBe(1);
    expect(body.status).toBe('RESERVED');
    expect(body.candidateDriverId).toBe(driverId);
    expect(body.reservationId).toBe(reservationId);
  });

  it('chặn truy cập internal matching khi INTERNAL_TOKEN sai', async () => {
    process.env.INTERNAL_TOKEN = 'secret-internal-key-12345';
    const mockPool = {
      query: async () => ({ rowCount: 0, rows: [] })
    } as unknown as Pool;

    const app = await matchingApp(mockPool);
    apps.push(app);

    const tripId = randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: `/internal/matching/${tripId}/1`,
      headers: { 'x-internal-token': 'wrong-token' }
    });

    expect(res.statusCode).toBe(403);
    delete process.env.INTERNAL_TOKEN;
  });
});

