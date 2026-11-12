import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { calculateFare, haversineDistance } from '../src/services/trip-service/src/pricing.js';
import { tripApp } from '../src/services/trip-service/src/app.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

describe('Trip Service Pricing', () => {
  it('tính cước chính xác theo cự ly và làm tròn', () => {
    const c1 = { lat: 10.7769, lng: 106.7009 };
    const c2 = { lat: 10.782, lng: 106.71 };
    const dist = haversineDistance(c1, c2);
    expect(dist).toBeGreaterThan(0.5);
    expect(dist).toBeLessThan(3.0);

    const fare = calculateFare(c1, c2);
    expect(fare % 1000).toBe(0);
    expect(fare).toBeGreaterThanOrEqual(12000);
  });
});

describe('Trip Service HTTP API', () => {
  it('từ chối POST /trips nếu thiếu Idempotency-Key', async () => {
    const mockPool = {} as unknown as Pool;
    const app = await tripApp(mockPool);
    apps.push(app);

    const passengerId = randomUUID();
    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });

    const res = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        pickup: { lat: 10.77, lng: 106.70 },
        dropoff: { lat: 10.78, lng: 106.71 }
      }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('từ chối nếu Driver gọi POST /trips', async () => {
    const mockPool = {} as unknown as Pool;
    const app = await tripApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const token = app.jwt.sign({ userId: driverId, role: 'DRIVER' });

    const res = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID()
      },
      payload: {
        pickup: { lat: 10.77, lng: 106.70 },
        dropoff: { lat: 10.78, lng: 106.71 }
      }
    });
    expect(res.statusCode).toBe(403);
  });

  it('từ chối nếu điểm đón và điểm đến trùng nhau', async () => {
    const mockPool = {} as unknown as Pool;
    const app = await tripApp(mockPool);
    apps.push(app);

    const passengerId = randomUUID();
    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });

    const res = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID()
      },
      payload: {
        pickup: { lat: 10.77, lng: 106.70 },
        dropoff: { lat: 10.77, lng: 106.70 }
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it('C03: xử lý Idempotency-Key - trả kết quả cũ nếu cùng hash, 422 nếu khác hash', async () => {
    const tripId = randomUUID();
    const passengerId = randomUUID();
    const key = randomUUID();

    // Giả lập key đã tồn tại với hash của body A
    const mockClient = {
      query: async (sql: string, params: any[]) => {
        if (sql.includes('SELECT trip_id, request_hash FROM idempotency_keys')) {
          return { rows: [{ trip_id: tripId, request_hash: 'hash-of-body-a' }] };
        }
        if (sql.includes('SELECT * FROM trips WHERE id = $1')) {
          return {
            rows: [{
              id: tripId,
              status: 'REQUESTED',
              correlation_id: randomUUID(),
              quoted_fare: 25000,
              payment_status: 'PENDING'
            }]
          };
        }
        return { rows: [] };
      },
      release: () => {}
    };

    const mockPool = {
      connect: async () => mockClient
    } as unknown as Pool;

    const app = await tripApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });

    // Gửi body B với key của body A -> 422
    const resDifferent = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': key
      },
      payload: {
        pickup: { lat: 10.77, lng: 106.70 },
        dropoff: { lat: 10.78, lng: 106.71 }
      }
    });
    expect(resDifferent.statusCode).toBe(422);
    expect(resDifferent.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('I03: không cho tạo trip mới nếu Passenger đang có chuyến active', async () => {
    const passengerId = randomUUID();
    const mockClient = {
      query: async (sql: string) => {
        if (sql.includes('FROM idempotency_keys')) return { rows: [] };
        if (sql.includes('SELECT id FROM trips WHERE passenger_id')) {
          return { rows: [{ id: randomUUID() }] }; // Đã có active trip
        }
        return { rows: [] };
      },
      release: () => {}
    };

    const mockPool = { connect: async () => mockClient } as unknown as Pool;
    const app = await tripApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });
    const res = await app.inject({
      method: 'POST',
      url: '/trips',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': randomUUID()
      },
      payload: {
        pickup: { lat: 10.77, lng: 106.70 },
        dropoff: { lat: 10.78, lng: 106.71 }
      }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ACTIVE_TRIP_EXISTS');
  });

  it('POST /trips/:id/cancel: từ chối hủy nếu chuyến đã IN_PROGRESS (sau pivot)', async () => {
    const passengerId = randomUUID();
    const tripId = randomUUID();

    const mockClient = {
      query: async (sql: string) => {
        if (sql.includes('SELECT * FROM trips WHERE id = $1 FOR UPDATE')) {
          return {
            rows: [{
              id: tripId,
              passenger_id: passengerId,
              status: 'IN_PROGRESS'
            }]
          };
        }
        return { rows: [] };
      },
      release: () => {}
    };

    const mockPool = { connect: async () => mockClient } as unknown as Pool;
    const app = await tripApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: passengerId, role: 'PASSENGER' });
    const res = await app.inject({
      method: 'POST',
      url: `/trips/${tripId}/cancel`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('TOO_LATE_TO_CANCEL');
  });

  it('S05: Passenger không xem được chuyến của người khác', async () => {
    const passengerA = randomUUID();
    const passengerB = randomUUID();
    const tripId = randomUUID();

    const mockPool = {
      query: async () => ({
        rows: [{
          id: tripId,
          passenger_id: passengerB,
          driver_id: randomUUID(),
          status: 'REQUESTED'
        }]
      })
    } as unknown as Pool;

    const app = await tripApp(mockPool);
    apps.push(app);

    const token = app.jwt.sign({ userId: passengerA, role: 'PASSENGER' });
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${tripId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(404);
  });
});

