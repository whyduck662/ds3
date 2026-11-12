import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { authenticate, createApp, fail } from '../../../common/src/platform.js';
import { createEnvelope, insertOutbox } from '../../../common/src/messaging.js';

const statusSchema = z.object({
  status: z.enum(['AVAILABLE', 'OFFLINE'])
}).strict();

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
}).strict();

const reserveSchema = z.object({
  tripId: z.string().uuid(),
  reservationId: z.string().uuid(),
  matchAttempt: z.number().int().nonnegative().optional().default(1)
}).strict();

const confirmSchema = z.object({
  tripId: z.string().uuid(),
  reservationId: z.string().uuid(),
  reservationVersion: z.number().int().nonnegative()
}).strict();

const releaseSchema = z.object({
  tripId: z.string().uuid(),
  reservationId: z.string().uuid(),
  reservationVersion: z.number().int().nonnegative().optional()
}).strict();

function verifyInternal(req: FastifyRequest) {
  const token = req.headers['x-internal-token'];
  const expected = process.env.INTERNAL_TOKEN;
  if (expected && token !== expected) {
    fail(403, 'FORBIDDEN', 'Token nội bộ không hợp lệ');
  }
}

export async function driverApp(pool: Pool) {
  const app = await createApp('driver-service', pool);

  /* ------------------------------------------------------------------ */
  /*  External APIs (JWT with role 'DRIVER')                            */
  /* ------------------------------------------------------------------ */

  // GET /drivers/me — Get or auto-create driver profile
  app.get('/drivers/me', { preHandler: authenticate }, async (req) => {
    if (req.user.role !== 'DRIVER') {
      fail(403, 'FORBIDDEN', 'Chỉ tài xế mới có quyền truy cập');
    }
    const userId = req.user.userId;

    const existing = await pool.query(
      `SELECT id, status, current_trip_id AS "currentTripId",
              latitude, longitude, last_seen_at AS "lastSeenAt"
       FROM drivers WHERE id = $1`,
      [userId]
    );

    if (existing.rowCount && existing.rows[0]) {
      return existing.rows[0];
    }

    // Auto-create driver profile idempotent
    const inserted = await pool.query(
      `INSERT INTO drivers (id, status, last_seen_at)
       VALUES ($1, 'OFFLINE', now())
       ON CONFLICT (id) DO UPDATE SET updated_at = now()
       RETURNING id, status, current_trip_id AS "currentTripId",
                 latitude, longitude, last_seen_at AS "lastSeenAt"`,
      [userId]
    );
    return inserted.rows[0];
  });

  // PUT /drivers/me/status — Toggle AVAILABLE / OFFLINE
  app.put('/drivers/me/status', { preHandler: authenticate }, async (req) => {
    if (req.user.role !== 'DRIVER') {
      fail(403, 'FORBIDDEN', 'Chỉ tài xế mới có quyền truy cập');
    }
    const input = statusSchema.parse(req.body);
    const userId = req.user.userId;

    // Check current state
    const current = await pool.query(
      `SELECT id, status, current_trip_id, reservation_id FROM drivers WHERE id = $1`,
      [userId]
    );

    const currentStatus = current.rowCount ? current.rows[0].status : null;

    if (currentStatus === 'RESERVED' || currentStatus === 'ON_TRIP') {
      fail(409, 'INVALID_STATE_TRANSITION', 'Không thể đổi trạng thái khi đang có chuyến hoặc đang giữ chỗ');
    }

    const updated = await pool.query(
      `INSERT INTO drivers (id, status, last_seen_at)
       VALUES ($1, $2, now())
       ON CONFLICT (id) DO UPDATE
       SET status = $2, last_seen_at = now(), version = drivers.version + 1, updated_at = now()
       RETURNING id, status, current_trip_id AS "currentTripId",
                 latitude, longitude, last_seen_at AS "lastSeenAt"`,
      [userId, input.status]
    );

    req.log.info({
      operation: 'DRIVER_STATUS_CHANGED',
      driverId: userId,
      stateBefore: currentStatus,
      stateAfter: input.status,
      correlationId: req.id
    });

    return updated.rows[0];
  });

  // PUT /drivers/me/location — Heartbeat and GPS update
  app.put('/drivers/me/location', { preHandler: authenticate }, async (req) => {
    if (req.user.role !== 'DRIVER') {
      fail(403, 'FORBIDDEN', 'Chỉ tài xế mới có quyền truy cập');
    }
    const input = locationSchema.parse(req.body);
    const userId = req.user.userId;

    const result = await pool.query(
      `INSERT INTO drivers (id, status, latitude, longitude, last_seen_at)
       VALUES ($1, 'OFFLINE', $2, $3, now())
       ON CONFLICT (id) DO UPDATE
       SET latitude = $2, longitude = $3, last_seen_at = now(), updated_at = now()
       RETURNING id, status, current_trip_id AS "currentTripId",
                 latitude, longitude, last_seen_at AS "lastSeenAt"`,
      [userId, input.lat, input.lng]
    );

    return result.rows[0];
  });

  /* ------------------------------------------------------------------ */
  /*  Internal APIs (authenticated via internal token)                  */
  /* ------------------------------------------------------------------ */

  // GET /internal/drivers/available — Query nearby available drivers
  app.get('/internal/drivers/available', async (req) => {
    verifyInternal(req);
    const query = z.object({
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      limit: z.coerce.number().int().positive().max(50).default(20)
    }).parse(req.query);

    let sql: string;
    let params: unknown[];

    if (query.lat !== undefined && query.lng !== undefined) {
      // Euclidean distance in simulated plane, tie-break by id
      sql = `
        SELECT id, latitude, longitude, status,
               SQRT(POWER(latitude - $1, 2) + POWER(longitude - $2, 2)) * 111.0 AS distance
        FROM drivers
        WHERE status = 'AVAILABLE'
          AND last_seen_at >= now() - interval '60 seconds'
        ORDER BY distance ASC, id ASC
        LIMIT $3
      `;
      params = [query.lat, query.lng, query.limit];
    } else {
      sql = `
        SELECT id, latitude, longitude, status, 0.0 AS distance
        FROM drivers
        WHERE status = 'AVAILABLE'
          AND last_seen_at >= now() - interval '60 seconds'
        ORDER BY id ASC
        LIMIT $1
      `;
      params = [query.limit];
    }

    const result = await pool.query(sql, params);
    return { drivers: result.rows };
  });

  // POST /internal/drivers/:id/reserve — Atomic conditional reservation
  app.post('/internal/drivers/:id/reserve', async (req, reply) => {
    verifyInternal(req);
    const driverId = z.string().uuid().parse((req.params as { id: string }).id);
    const body = reserveSchema.parse(req.body);

    // Atomic conditional update on status = 'AVAILABLE'
    const updateResult = await pool.query(
      `UPDATE drivers
       SET status = 'RESERVED',
           current_trip_id = $1,
           reservation_id = $2,
           reservation_version = reservation_version + 1,
           reserved_until = now() + interval '30 seconds',
           version = version + 1,
           updated_at = now()
       WHERE id = $3 AND status = 'AVAILABLE'
       RETURNING reservation_version AS "reservationVersion", reserved_until AS "reservedUntil"`,
      [body.tripId, body.reservationId, driverId]
    );

    if (updateResult.rowCount === 1) {
      const row = updateResult.rows[0];
      req.log.info({
        operation: 'RESERVE_WON',
        driverId,
        tripId: body.tripId,
        reservationId: body.reservationId,
        reservationVersion: row.reservationVersion,
        correlationId: req.id
      });
      return reply.code(200).send({
        ok: true,
        driverId,
        tripId: body.tripId,
        reservationId: body.reservationId,
        reservationVersion: row.reservationVersion,
        reservedUntil: row.reservedUntil
      });
    }

    // Update failed — check reason (idempotency or conflict)
    const check = await pool.query(
      `SELECT id, status, current_trip_id AS "currentTripId",
              reservation_id AS "reservationId",
              reservation_version AS "reservationVersion",
              reserved_until AS "reservedUntil"
       FROM drivers WHERE id = $1`,
      [driverId]
    );

    if (!check.rowCount) {
      fail(404, 'DRIVER_NOT_FOUND', 'Tài xế không tồn tại');
    }

    const driver = check.rows[0];

    // Idempotent retry check: same driverId, tripId, reservationId and still active
    if (
      driver.currentTripId === body.tripId &&
      driver.reservationId === body.reservationId &&
      driver.reservedUntil &&
      new Date(driver.reservedUntil) > new Date()
    ) {
      req.log.info({
        operation: 'RESERVE_IDEMPOTENT',
        driverId,
        tripId: body.tripId,
        reservationId: body.reservationId,
        correlationId: req.id
      });
      return reply.code(200).send({
        ok: true,
        driverId,
        tripId: body.tripId,
        reservationId: body.reservationId,
        reservationVersion: driver.reservationVersion,
        reservedUntil: driver.reservedUntil
      });
    }

    req.log.info({
      operation: 'RESERVE_LOST',
      driverId,
      tripId: body.tripId,
      currentStatus: driver.status,
      correlationId: req.id
    });

    fail(409, 'DRIVER_NOT_AVAILABLE', 'Tài xế không sẵn sàng hoặc đã được gán');
  });

  // POST /internal/drivers/:id/confirm — Fenced transition to ON_TRIP
  app.post('/internal/drivers/:id/confirm', async (req) => {
    verifyInternal(req);
    const driverId = z.string().uuid().parse((req.params as { id: string }).id);
    const body = confirmSchema.parse(req.body);

    const check = await pool.query(
      `SELECT id, status, current_trip_id AS "currentTripId",
              reservation_id AS "reservationId",
              reservation_version AS "reservationVersion",
              reserved_until AS "reservedUntil"
       FROM drivers WHERE id = $1`,
      [driverId]
    );

    if (!check.rowCount) {
      fail(404, 'DRIVER_NOT_FOUND', 'Tài xế không tồn tại');
    }

    const driver = check.rows[0];

    // Idempotency: already ON_TRIP with same reservation
    if (
      driver.status === 'ON_TRIP' &&
      driver.currentTripId === body.tripId &&
      driver.reservationId === body.reservationId
    ) {
      return {
        ok: true,
        status: 'ON_TRIP',
        driverId,
        tripId: body.tripId,
        reservationId: body.reservationId,
        reservationVersion: driver.reservationVersion
      };
    }

    // Expired check
    if (driver.status === 'RESERVED' && driver.reservedUntil && new Date(driver.reservedUntil) <= new Date()) {
      req.log.warn({
        operation: 'CONFIRM_EXPIRED',
        driverId,
        tripId: body.tripId,
        reservationId: body.reservationId,
        correlationId: req.id
      });
      fail(409, 'OFFER_EXPIRED', 'Thời hạn giữ chỗ đã hết hạn');
    }

    // Fencing check
    if (
      driver.status !== 'RESERVED' ||
      driver.currentTripId !== body.tripId ||
      driver.reservationId !== body.reservationId ||
      driver.reservationVersion !== body.reservationVersion
    ) {
      fail(409, 'INVALID_RESERVATION', 'Reservation không khớp hoặc đã bị thay thế');
    }

    const result = await pool.query(
      `UPDATE drivers
       SET status = 'ON_TRIP',
           reserved_until = NULL,
           version = version + 1,
           updated_at = now()
       WHERE id = $1
         AND status = 'RESERVED'
         AND current_trip_id = $2
         AND reservation_id = $3
         AND reservation_version = $4
         AND reserved_until > now()
       RETURNING version`,
      [driverId, body.tripId, body.reservationId, body.reservationVersion]
    );

    if (result.rowCount !== 1) {
      fail(409, 'CONFIRM_FAILED', 'Không thể xác nhận chuyến đi');
    }

    req.log.info({
      operation: 'CONFIRM_OK',
      driverId,
      tripId: body.tripId,
      reservationId: body.reservationId,
      correlationId: req.id
    });

    return {
      ok: true,
      status: 'ON_TRIP',
      driverId,
      tripId: body.tripId,
      reservationId: body.reservationId,
      reservationVersion: body.reservationVersion
    };
  });

  // POST /internal/drivers/:id/release — Fenced release of reservation
  app.post('/internal/drivers/:id/release', async (req) => {
    verifyInternal(req);
    const driverId = z.string().uuid().parse((req.params as { id: string }).id);
    const body = releaseSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updateResult = await client.query(
        `UPDATE drivers
         SET status = 'AVAILABLE',
             current_trip_id = NULL,
             reservation_id = NULL,
             reserved_until = NULL,
             version = version + 1,
             updated_at = now()
         WHERE id = $1
           AND current_trip_id = $2
           AND reservation_id = $3
         RETURNING version, reservation_version`,
        [driverId, body.tripId, body.reservationId]
      );

      if (updateResult.rowCount === 1) {
        // Emit driver.released to outbox
        const envelope = createEnvelope({
          type: 'driver.released',
          correlationId: req.id,
          service: 'driver-service',
          aggregateId: body.tripId,
          payload: {
            driverId,
            tripId: body.tripId,
            reservationId: body.reservationId,
            status: 'RELEASED'
          }
        });
        await insertOutbox(client, {
          exchange: 'ride.commands',
          routingKey: 'trip.replies',
          envelope
        });

        await client.query('COMMIT');

        req.log.info({
          operation: 'RELEASE_OK',
          driverId,
          tripId: body.tripId,
          reservationId: body.reservationId,
          correlationId: req.id
        });

        return {
          ok: true,
          status: 'RELEASED',
          driverId,
          tripId: body.tripId,
          reservationId: body.reservationId
        };
      }

      // Check current driver state
      const check = await client.query(
        `SELECT id, status, current_trip_id AS "currentTripId",
                reservation_id AS "reservationId",
                reservation_version AS "reservationVersion"
         FROM drivers WHERE id = $1`,
        [driverId]
      );

      await client.query('COMMIT');

      if (!check.rowCount) {
        fail(404, 'DRIVER_NOT_FOUND', 'Tài xế không tồn tại');
      }

      const driver = check.rows[0];

      // If driver currently holds a different reservation, release is stale
      if (driver.reservationId && driver.reservationId !== body.reservationId) {
        req.log.info({
          operation: 'STALE_RELEASE',
          driverId,
          tripId: body.tripId,
          staleReservationId: body.reservationId,
          currentReservationId: driver.reservationId,
          correlationId: req.id
        });
        return {
          ok: true,
          status: 'STALE_RELEASE',
          message: 'Tài xế hiện có reservation mới hơn'
        };
      }

      return {
        ok: true,
        status: 'RELEASED',
        message: 'Đã giải phóng trước đó'
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /internal/drivers/:id/reservation/:reservationId — Reconciliation helper
  app.get('/internal/drivers/:id/reservation/:reservationId', async (req) => {
    verifyInternal(req);
    const driverId = z.string().uuid().parse((req.params as { id: string }).id);
    const reservationId = z.string().uuid().parse((req.params as { reservationId: string }).reservationId);

    const check = await pool.query(
      `SELECT id, status, current_trip_id AS "currentTripId",
              reservation_id AS "reservationId",
              reservation_version AS "reservationVersion",
              reserved_until AS "reservedUntil"
       FROM drivers WHERE id = $1`,
      [driverId]
    );

    if (!check.rowCount) {
      fail(404, 'DRIVER_NOT_FOUND', 'Tài xế không tồn tại');
    }

    const driver = check.rows[0];
    const isMatching = driver.reservationId === reservationId;
    return {
      id: driver.id,
      status: driver.status,
      currentTripId: driver.currentTripId,
      reservationId: driver.reservationId,
      reservationVersion: driver.reservationVersion,
      reservedUntil: driver.reservedUntil,
      isMatching
    };
  });

  return app;
}

