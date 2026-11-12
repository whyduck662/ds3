import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { driverApp } from '../src/services/driver-service/src/app.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-characters';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

// In-memory mock pool for driver testing
function createMockDriverPool() {
  const drivers = new Map<string, any>();
  const outbox: any[] = [];

  const mockClient = {
    query: async (sql: string, params?: any[]) => {
      return mockPool.query(sql, params);
    },
    release: () => {}
  } as unknown as PoolClient;

  const mockPool = {
    connect: async () => mockClient,
    query: async (sql: string, params?: any[]) => {
      const normalized = sql.trim();

      // BEGIN / COMMIT / ROLLBACK
      if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(normalized)) {
        return { rowCount: 1, rows: [] };
      }

      // SELECT from drivers WHERE id = $1
      if (/SELECT.*FROM drivers WHERE id\s*=\s*\$1/is.test(normalized)) {
        const id = params?.[0];
        const driver = drivers.get(id);
        if (!driver) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [{
            id: driver.id,
            status: driver.status,
            currentTripId: driver.current_trip_id,
            reservationId: driver.reservation_id,
            reservationVersion: driver.reservation_version,
            reservedUntil: driver.reserved_until,
            latitude: driver.latitude,
            longitude: driver.longitude,
            lastSeenAt: driver.last_seen_at,
            current_trip_id: driver.current_trip_id,
            reservation_id: driver.reservation_id,
            reservation_version: driver.reservation_version,
            reserved_until: driver.reserved_until
          }]
        };
      }

      // INSERT INTO drivers ... ON CONFLICT (id) DO UPDATE ... RETURNING
      if (/INSERT INTO drivers/is.test(normalized) && /ON CONFLICT/is.test(normalized)) {
        const id = params?.[0];
        let driver = drivers.get(id);
        if (!driver) {
          driver = {
            id,
            status: params?.[1] && typeof params[1] === 'string' && ['AVAILABLE', 'OFFLINE'].includes(params[1]) ? params[1] : 'OFFLINE',
            latitude: typeof params?.[1] === 'number' ? params[1] : (typeof params?.[2] === 'number' ? params[2] : null),
            longitude: typeof params?.[2] === 'number' && typeof params?.[1] === 'number' ? params[2] : (typeof params?.[3] === 'number' ? params[3] : null),
            current_trip_id: null,
            reservation_id: null,
            reservation_version: 0,
            reserved_until: null,
            last_seen_at: new Date().toISOString(),
            version: 1
          };
          drivers.set(id, driver);
        } else {
          if (params?.[1] && typeof params[1] === 'string' && ['AVAILABLE', 'OFFLINE'].includes(params[1])) {
            driver.status = params[1];
          }
          if (typeof params?.[1] === 'number') {
            driver.latitude = params[1];
            driver.longitude = params[2];
          }
          driver.last_seen_at = new Date().toISOString();
          driver.version += 1;
        }

        return {
          rowCount: 1,
          rows: [{
            id: driver.id,
            status: driver.status,
            currentTripId: driver.current_trip_id,
            latitude: driver.latitude,
            longitude: driver.longitude,
            lastSeenAt: driver.last_seen_at
          }]
        };
      }

      // UPDATE drivers SET status = 'RESERVED' ... WHERE id = $3 AND status = 'AVAILABLE'
      if (/UPDATE drivers\s+SET status = 'RESERVED'/is.test(normalized)) {
        const tripId = params?.[0];
        const reservationId = params?.[1];
        const driverId = params?.[2];
        const driver = drivers.get(driverId);

        if (driver && driver.status === 'AVAILABLE') {
          driver.status = 'RESERVED';
          driver.current_trip_id = tripId;
          driver.reservation_id = reservationId;
          driver.reservation_version = (driver.reservation_version || 0) + 1;
          driver.reserved_until = new Date(Date.now() + 30000).toISOString();
          driver.version += 1;
          return {
            rowCount: 1,
            rows: [{
              reservationVersion: driver.reservation_version,
              reservedUntil: driver.reserved_until
            }]
          };
        }
        return { rowCount: 0, rows: [] };
      }

      // UPDATE drivers SET status = 'ON_TRIP' ...
      if (/UPDATE drivers\s+SET status = 'ON_TRIP'/is.test(normalized)) {
        const driverId = params?.[0];
        const tripId = params?.[1];
        const reservationId = params?.[2];
        const reservationVersion = params?.[3];
        const driver = drivers.get(driverId);

        if (
          driver &&
          driver.status === 'RESERVED' &&
          driver.current_trip_id === tripId &&
          driver.reservation_id === reservationId &&
          driver.reservation_version === reservationVersion
        ) {
          driver.status = 'ON_TRIP';
          driver.reserved_until = null;
          driver.version += 1;
          return { rowCount: 1, rows: [{ version: driver.version }] };
        }
        return { rowCount: 0, rows: [] };
      }

      // UPDATE drivers SET status = 'AVAILABLE' ... WHERE current_trip_id = $2 AND reservation_id = $3
      if (/UPDATE drivers\s+SET status = 'AVAILABLE'/is.test(normalized)) {
        const driverId = params?.[0];
        const tripId = params?.[1];
        const reservationId = params?.[2];
        const driver = drivers.get(driverId);

        if (
          driver &&
          driver.current_trip_id === tripId &&
          driver.reservation_id === reservationId
        ) {
          driver.status = 'AVAILABLE';
          driver.current_trip_id = null;
          driver.reservation_id = null;
          driver.reserved_until = null;
          driver.version += 1;
          return { rowCount: 1, rows: [{ version: driver.version, reservation_version: driver.reservation_version }] };
        }
        return { rowCount: 0, rows: [] };
      }

      // INSERT INTO outbox
      if (/INSERT INTO outbox/i.test(normalized)) {
        outbox.push({
          eventId: params?.[0],
          exchange: params?.[1],
          routingKey: params?.[2],
          envelope: params?.[3]
        });
        return { rowCount: 1, rows: [] };
      }

      // Available drivers query
      if (/SELECT.*FROM drivers\s+WHERE status = 'AVAILABLE'/i.test(normalized)) {
        const available = Array.from(drivers.values())
          .filter(d => d.status === 'AVAILABLE')
          .map(d => ({
            id: d.id,
            latitude: d.latitude ?? 10.762622,
            longitude: d.longitude ?? 106.660172,
            status: d.status,
            distance: 1.5
          }));
        return { rowCount: available.length, rows: available };
      }

      return { rowCount: 0, rows: [] };
    }
  } as unknown as Pool;

  return { mockPool, drivers, outbox };
}

describe('Driver Service HTTP API (TV3)', () => {
  it('từ chối request không có JWT (401)', async () => {
    const { mockPool } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const res = await app.inject({ method: 'GET', url: '/drivers/me' });
    expect(res.statusCode).toBe(401);
  });

  it('chặn role PASSENGER gọi Driver API (403)', async () => {
    const { mockPool } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const passengerToken = app.jwt.sign({ userId: randomUUID(), role: 'PASSENGER' });
    const res = await app.inject({
      method: 'GET',
      url: '/drivers/me',
      headers: { authorization: `Bearer ${passengerToken}` }
    });
    expect(res.statusCode).toBe(403);
  });

  it('tự động tạo profile tài xế khi gọi GET /drivers/me lần đầu', async () => {
    const { mockPool } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const driverToken = app.jwt.sign({ userId: driverId, role: 'DRIVER' });

    const res = await app.inject({
      method: 'GET',
      url: '/drivers/me',
      headers: { authorization: `Bearer ${driverToken}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(driverId);
    expect(body.status).toBe('OFFLINE');
    expect(body.currentTripId).toBeNull();
  });

  it('cho phép tài xế chuyển đổi trạng thái OFFLINE <-> AVAILABLE', async () => {
    const { mockPool } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const driverToken = app.jwt.sign({ userId: driverId, role: 'DRIVER' });

    // 1. Chuyển sang AVAILABLE
    const res1 = await app.inject({
      method: 'PUT',
      url: '/drivers/me/status',
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { status: 'AVAILABLE' }
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().status).toBe('AVAILABLE');

    // 2. Chuyển lại về OFFLINE
    const res2 = await app.inject({
      method: 'PUT',
      url: '/drivers/me/status',
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { status: 'OFFLINE' }
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe('OFFLINE');
  });

  it('cập nhật vị trí GPS qua PUT /drivers/me/location (heartbeat)', async () => {
    const { mockPool } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const driverToken = app.jwt.sign({ userId: driverId, role: 'DRIVER' });

    const res = await app.inject({
      method: 'PUT',
      url: '/drivers/me/location',
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { lat: 10.762622, lng: 106.660172 }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.latitude).toBe(10.762622);
    expect(body.longitude).toBe(106.660172);
  });

  it('atomic reserve tài xế thành công khi tài xế AVAILABLE', async () => {
    const { mockPool, drivers } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    drivers.set(driverId, {
      id: driverId,
      status: 'AVAILABLE',
      reservation_version: 0,
      version: 1
    });

    const tripId = randomUUID();
    const reservationId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/internal/drivers/${driverId}/reserve`,
      payload: { tripId, reservationId, matchAttempt: 1 }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.driverId).toBe(driverId);
    expect(body.tripId).toBe(tripId);
    expect(body.reservationId).toBe(reservationId);
    expect(body.reservationVersion).toBe(1);

    // Kiểm tra state của driver sau reserve
    const driver = drivers.get(driverId);
    expect(driver.status).toBe('RESERVED');
    expect(driver.current_trip_id).toBe(tripId);
  });

  it('reserve idempotent khi gọi lại cùng tripId và reservationId', async () => {
    const { mockPool, drivers } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const tripId = randomUUID();
    const reservationId = randomUUID();

    drivers.set(driverId, {
      id: driverId,
      status: 'RESERVED',
      current_trip_id: tripId,
      reservation_id: reservationId,
      reservation_version: 1,
      reserved_until: new Date(Date.now() + 20000).toISOString(),
      version: 2
    });

    const res = await app.inject({
      method: 'POST',
      url: `/internal/drivers/${driverId}/reserve`,
      payload: { tripId, reservationId, matchAttempt: 1 }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().reservationVersion).toBe(1);
  });

  it('từ chối reserve 409 nếu tài xế đã bị chuyến khác chiếm', async () => {
    const { mockPool, drivers } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    drivers.set(driverId, {
      id: driverId,
      status: 'RESERVED',
      current_trip_id: randomUUID(),
      reservation_id: randomUUID(),
      reservation_version: 1,
      reserved_until: new Date(Date.now() + 20000).toISOString(),
      version: 2
    });

    const res = await app.inject({
      method: 'POST',
      url: `/internal/drivers/${driverId}/reserve`,
      payload: { tripId: randomUUID(), reservationId: randomUUID(), matchAttempt: 1 }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('DRIVER_NOT_AVAILABLE');
  });

  it('xác nhận confirm chuyển trạng thái sang ON_TRIP với đúng fencing token', async () => {
    const { mockPool, drivers } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const tripId = randomUUID();
    const reservationId = randomUUID();

    drivers.set(driverId, {
      id: driverId,
      status: 'RESERVED',
      current_trip_id: tripId,
      reservation_id: reservationId,
      reservation_version: 1,
      reserved_until: new Date(Date.now() + 20000).toISOString(),
      version: 2
    });

    const res = await app.inject({
      method: 'POST',
      url: `/internal/drivers/${driverId}/confirm`,
      payload: { tripId, reservationId, reservationVersion: 1 }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ON_TRIP');
    expect(drivers.get(driverId).status).toBe('ON_TRIP');
  });

  it('từ chối confirm 409 nếu reservationVersion bị lệch (fencing check)', async () => {
    const { mockPool, drivers } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const tripId = randomUUID();
    const reservationId = randomUUID();

    drivers.set(driverId, {
      id: driverId,
      status: 'RESERVED',
      current_trip_id: tripId,
      reservation_id: reservationId,
      reservation_version: 2, // version hiện tại là 2
      reserved_until: new Date(Date.now() + 20000).toISOString(),
      version: 3
    });

    // Request mang version cũ = 1
    const res = await app.inject({
      method: 'POST',
      url: `/internal/drivers/${driverId}/confirm`,
      payload: { tripId, reservationId, reservationVersion: 1 }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVALID_RESERVATION');
  });

  it('giải phóng release tài xế về AVAILABLE và ghi outbox driver.released', async () => {
    const { mockPool, drivers, outbox } = createMockDriverPool();
    const app = await driverApp(mockPool);
    apps.push(app);

    const driverId = randomUUID();
    const tripId = randomUUID();
    const reservationId = randomUUID();

    drivers.set(driverId, {
      id: driverId,
      status: 'RESERVED',
      current_trip_id: tripId,
      reservation_id: reservationId,
      reservation_version: 1,
      version: 2
    });

    const res = await app.inject({
      method: 'POST',
      url: `/internal/drivers/${driverId}/release`,
      payload: { tripId, reservationId }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('RELEASED');
    expect(drivers.get(driverId).status).toBe('AVAILABLE');
    expect(drivers.get(driverId).current_trip_id).toBeNull();

    // Outbox check
    expect(outbox.length).toBe(1);
    expect(outbox[0].routingKey).toBe('trip.replies');
  });
});
