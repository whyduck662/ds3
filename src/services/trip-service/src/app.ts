import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { authenticate, createApp, fail } from '../../../common/src/platform.js';
import { createEnvelope, insertOutbox } from '../../../common/src/messaging.js';
import { calculateFare } from './pricing.js';

const coordinatesSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

const createTripSchema = z.object({
  pickup: coordinatesSchema,
  dropoff: coordinatesSchema
}).refine(data => data.pickup.lat !== data.dropoff.lat || data.pickup.lng !== data.dropoff.lng, {
  message: 'Điểm đón và điểm đến không được trùng nhau'
});

export async function tripApp(pool: Pool, onOutboxTrigger?: () => void) {
  const app = await createApp('trip-service', pool);

  // POST /trips - Đặt chuyến (chỉ Passenger)
  app.post('/trips', async (req, reply) => {
    await authenticate(req);
    if (req.user.role !== 'PASSENGER') fail(403, 'FORBIDDEN', 'Chỉ hành khách mới được tạo chuyến đi');

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      fail(400, 'MISSING_IDEMPOTENCY_KEY', 'Thiếu header Idempotency-Key');
    }

    const body = createTripSchema.parse(req.body);
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Kiểm tra Idempotency Key theo user_id
      const existingKey = await client.query(
        'SELECT trip_id, request_hash FROM idempotency_keys WHERE user_id = $1 AND key = $2 FOR UPDATE',
        [req.user.userId, idempotencyKey]
      );

      if (existingKey.rows.length > 0) {
        const row = existingKey.rows[0];
        if (row.request_hash !== bodyHash) {
          fail(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được sử dụng với nội dung khác');
        }
        const tripRes = await client.query('SELECT * FROM trips WHERE id = $1', [row.trip_id]);
        await client.query('COMMIT');
        if (tripRes.rows.length > 0) {
          const t = tripRes.rows[0];
          return reply.code(200).send({
            id: t.id,
            status: t.status,
            correlationId: t.correlation_id,
            quotedFare: t.quoted_fare,
            paymentStatus: t.payment_status
          });
        }
      }

      // Invariant I03: Kiểm tra hành khách đã có chuyến active chưa
      const activeTrip = await client.query(
        "SELECT id FROM trips WHERE passenger_id = $1 AND status NOT IN ('PAID', 'CANCELLED') LIMIT 1",
        [req.user.userId]
      );
      if (activeTrip.rows.length > 0) {
        fail(409, 'ACTIVE_TRIP_EXISTS', 'Hành khách đang có chuyến đi chưa hoàn thành');
      }

      const tripId = randomUUID();
      const quotedFare = calculateFare(body.pickup, body.dropoff);

      await client.query(
        'INSERT INTO idempotency_keys (user_id, key, request_hash, trip_id) VALUES ($1, $2, $3, $4)',
        [req.user.userId, idempotencyKey, bodyHash, tripId]
      );

      await client.query(
        `INSERT INTO trips (
          id, passenger_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
          quoted_fare, status, payment_status, saga_status, correlation_id,
          saga_deadline, version
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, 'REQUESTED', 'PENDING', 'RUNNING', $8,
          now() + interval '90 seconds', 1
        )`,
        [
          tripId,
          req.user.userId,
          body.pickup.lat,
          body.pickup.lng,
          body.dropoff.lat,
          body.dropoff.lng,
          quotedFare,
          req.id
        ]
      );

      // Ghi outbox lệnh payment.authorize
      const authEnvelope = createEnvelope({
        type: 'payment.authorize',
        correlationId: req.id,
        service: 'trip-service',
        aggregateId: tripId,
        aggregateVersion: 1,
        payload: {
          tripId,
          passengerId: req.user.userId,
          amount: quotedFare
        }
      });
      await insertOutbox(client, {
        exchange: 'ride.commands',
        routingKey: 'payment.authorize',
        envelope: authEnvelope
      });

      // Phát event trip.requested
      const reqEnvelope = createEnvelope({
        type: 'trip.requested',
        correlationId: req.id,
        service: 'trip-service',
        aggregateId: tripId,
        aggregateVersion: 1,
        payload: {
          tripId,
          passengerId: req.user.userId,
          pickup: body.pickup,
          dropoff: body.dropoff,
          quotedFare
        }
      });
      await insertOutbox(client, {
        exchange: 'ride.events',
        routingKey: 'trip.requested',
        envelope: reqEnvelope
      });

      await client.query('COMMIT');
      onOutboxTrigger?.();

      return reply.code(201).send({
        id: tripId,
        status: 'REQUESTED',
        correlationId: req.id,
        quotedFare,
        paymentStatus: 'PENDING'
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /trips/me/active - Lấy chuyến hiện tại của Passenger
  app.get('/trips/me/active', async (req) => {
    await authenticate(req);
    const { rows } = await pool.query(
      "SELECT * FROM trips WHERE passenger_id = $1 AND status NOT IN ('PAID', 'CANCELLED') ORDER BY created_at DESC LIMIT 1",
      [req.user.userId]
    );

    if (rows.length === 0) return { trip: null };
    const t = rows[0];
    return {
      trip: {
        id: t.id,
        status: t.status,
        correlationId: t.correlation_id,
        quotedFare: t.quoted_fare,
        paymentStatus: t.payment_status,
        driverId: t.driver_id,
        pickup: { lat: t.pickup_lat, lng: t.pickup_lng },
        dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng }
      }
    };
  });

  // GET /trips/offers - Lấy lời mời chuyến cho Driver
  app.get('/trips/offers', async (req) => {
    await authenticate(req);
    if (req.user.role !== 'DRIVER') fail(403, 'FORBIDDEN', 'Chỉ tài xế mới được nhận lời mời');

    const { rows } = await pool.query(
      "SELECT * FROM trips WHERE driver_id = $1 AND status = 'DRIVER_ASSIGNED' AND offer_deadline > now() ORDER BY created_at DESC",
      [req.user.userId]
    );

    return {
      items: rows.map(r => ({
        id: r.id,
        tripId: r.id,
        pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
        dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng },
        quotedFare: r.quoted_fare,
        offerDeadline: r.offer_deadline
      }))
    };
  });

  // GET /trips/:id - Chi tiết chuyến
  app.get<{ Params: { id: string } }>('/trips/:id', async (req) => {
    await authenticate(req);
    const { id } = req.params;

    const { rows } = await pool.query('SELECT * FROM trips WHERE id = $1', [id]);
    if (rows.length === 0) fail(404, 'NOT_FOUND', 'Không tìm thấy chuyến đi');

    const t = rows[0];
    if (req.user.role !== 'ADMIN' && t.passenger_id !== req.user.userId && t.driver_id !== req.user.userId) {
      fail(404, 'NOT_FOUND', 'Không tìm thấy chuyến đi');
    }

    return {
      id: t.id,
      status: t.status,
      correlationId: t.correlation_id,
      quotedFare: t.quoted_fare,
      paymentStatus: t.payment_status,
      passengerId: t.passenger_id,
      driverId: t.driver_id,
      pickup: { lat: t.pickup_lat, lng: t.pickup_lng },
      dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng }
    };
  });

  // POST /trips/:id/accept - Driver nhận chuyến
  app.post<{ Params: { id: string } }>('/trips/:id/accept', async (req) => {
    await authenticate(req);
    if (req.user.role !== 'DRIVER') fail(403, 'FORBIDDEN', 'Chỉ tài xế mới được nhận chuyến');

    const { id } = req.params;
    const client = await pool.connect();
    let trip: any;
    try {
      await client.query('BEGIN');
      // CAS DRIVER_ASSIGNED -> ACCEPTING
      const res = await client.query(
        `UPDATE trips
         SET status = 'ACCEPTING', accepting_since = now(), version = version + 1
         WHERE id = $1 AND driver_id = $2 AND status = 'DRIVER_ASSIGNED'
         RETURNING *`,
        [id, req.user.userId]
      );

      if (res.rows.length === 0) {
        fail(409, 'CONFLICT', 'Chuyến không ở trạng thái chờ bạn nhận hoặc đã hết hạn');
      }
      trip = res.rows[0];
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Gọi confirm sang driver-service ngoài DB transaction
    let confirmOk = false;
    const driverUrl = process.env.DRIVER_URL ?? 'http://driver-service:8082';
    try {
      const resp = await fetch(`${driverUrl}/internal/drivers/${req.user.userId}/confirm`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': req.id,
          'x-internal-token': process.env.INTERNAL_TOKEN ?? 'internal-token-for-ds03'
        },
        body: JSON.stringify({
          tripId: trip.id,
          reservationId: trip.reservation_id,
          reservationVersion: trip.reservation_version
        }),
        signal: AbortSignal.timeout(2000)
      });
      confirmOk = resp.ok;
    } catch {
      // Driver service có thể chưa bật hoặc timeout
      if (process.env.STUB_DRIVER === 'true') confirmOk = true;
    }

    const finishClient = await pool.connect();
    try {
      await finishClient.query('BEGIN');
      if (confirmOk) {
        // CAS ACCEPTING -> ACCEPTED
        const upd = await finishClient.query(
          `UPDATE trips
           SET status = 'ACCEPTED', version = version + 1, updated_at = now()
           WHERE id = $1 AND status = 'ACCEPTING'
           RETURNING *`,
          [id]
        );
        if (upd.rows.length > 0) {
          const acceptedTrip = upd.rows[0];
          const accEnvelope = createEnvelope({
            type: 'trip.accepted',
            correlationId: acceptedTrip.correlation_id,
            service: 'trip-service',
            aggregateId: acceptedTrip.id,
            aggregateVersion: acceptedTrip.version,
            payload: {
              tripId: acceptedTrip.id,
              passengerId: acceptedTrip.passenger_id,
              driverId: acceptedTrip.driver_id
            }
          });
          await insertOutbox(finishClient, {
            exchange: 'ride.events',
            routingKey: 'trip.accepted',
            envelope: accEnvelope
          });
          await finishClient.query('COMMIT');
          onOutboxTrigger?.();
          return { id: acceptedTrip.id, status: 'ACCEPTED' };
        }
      } else {
        // Confirm thất bại: giải phóng và chuyển về SEARCHING hoặc COMPENSATING
        await finishClient.query(
          `UPDATE trips
           SET status = 'SEARCHING', driver_id = null, reservation_id = null, version = version + 1
           WHERE id = $1 AND status = 'ACCEPTING'`,
          [id]
        );
        await finishClient.query('COMMIT');
        fail(409, 'CONFIRM_FAILED', 'Không thể xác nhận giữ tài xế');
      }
    } catch (e) {
      await finishClient.query('ROLLBACK');
      throw e;
    } finally {
      finishClient.release();
    }
  });

  // POST /trips/:id/reject - Driver từ chối chuyến
  app.post<{ Params: { id: string } }>('/trips/:id/reject', async (req) => {
    await authenticate(req);
    if (req.user.role !== 'DRIVER') fail(403, 'FORBIDDEN', 'Chỉ tài xế mới được từ chối chuyến');

    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE trips
         SET status = 'SEARCHING',
             rejected_driver_ids = array_append(rejected_driver_ids, driver_id),
             driver_id = null,
             reservation_id = null,
             match_attempt = match_attempt + 1,
             version = version + 1
         WHERE id = $1 AND driver_id = $2 AND status = 'DRIVER_ASSIGNED'
         RETURNING *`,
        [id, req.user.userId]
      );

      if (rows.length === 0) fail(409, 'CONFLICT', 'Chuyến không thể từ chối');
      const trip = rows[0];

      if (trip.match_attempt <= 3) {
        // Tìm tài xế khác
        const matchEnvelope = createEnvelope({
          type: 'matching.find_driver',
          correlationId: trip.correlation_id,
          service: 'trip-service',
          aggregateId: trip.id,
          matchAttempt: trip.match_attempt,
          payload: {
            tripId: trip.id,
            pickup: { lat: trip.pickup_lat, lng: trip.pickup_lng },
            dropoff: { lat: trip.dropoff_lat, lng: trip.dropoff_lng },
            matchAttempt: trip.match_attempt,
            excludedDriverIds: trip.rejected_driver_ids
          }
        });
        await insertOutbox(client, {
          exchange: 'ride.commands',
          routingKey: 'matching.find_driver',
          envelope: matchEnvelope
        });
      }

      await client.query('COMMIT');
      onOutboxTrigger?.();
      return { id: trip.id, status: 'SEARCHING' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /trips/:id/start - Bắt đầu chuyến (PIVOT)
  app.post<{ Params: { id: string } }>('/trips/:id/start', async (req) => {
    await authenticate(req);
    if (req.user.role !== 'DRIVER') fail(403, 'FORBIDDEN', 'Chỉ tài xế mới được bắt đầu chuyến');

    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE trips
         SET status = 'IN_PROGRESS', version = version + 1, updated_at = now()
         WHERE id = $1 AND driver_id = $2 AND status = 'ACCEPTED'
         RETURNING *`,
        [id, req.user.userId]
      );

      if (rows.length === 0) {
        fail(409, 'CONFLICT', 'Chuyến không ở trạng thái ACCEPTED hoặc bạn không phải tài xế chuyến này');
      }
      const trip = rows[0];

      const startEnvelope = createEnvelope({
        type: 'trip.started',
        correlationId: trip.correlation_id,
        service: 'trip-service',
        aggregateId: trip.id,
        aggregateVersion: trip.version,
        payload: {
          tripId: trip.id,
          passengerId: trip.passenger_id,
          driverId: trip.driver_id
        }
      });
      await insertOutbox(client, {
        exchange: 'ride.events',
        routingKey: 'trip.started',
        envelope: startEnvelope
      });

      await client.query('COMMIT');
      onOutboxTrigger?.();
      return { id: trip.id, status: 'IN_PROGRESS' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /trips/:id/complete - Hoàn thành chuyến
  app.post<{ Params: { id: string } }>('/trips/:id/complete', async (req) => {
    await authenticate(req);
    if (req.user.role !== 'DRIVER') fail(403, 'FORBIDDEN', 'Chỉ tài xế mới được hoàn thành chuyến');

    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE trips
         SET status = 'COMPLETED', payment_status = 'CAPTURE_PENDING', version = version + 1, updated_at = now()
         WHERE id = $1 AND driver_id = $2 AND status = 'IN_PROGRESS'
         RETURNING *`,
        [id, req.user.userId]
      );

      if (rows.length === 0) {
        fail(409, 'CONFLICT', 'Chuyến không ở trạng thái IN_PROGRESS hoặc bạn không phải tài xế chuyến này');
      }
      const trip = rows[0];

      // Gửi lệnh capture tới Payment Service
      const capEnvelope = createEnvelope({
        type: 'payment.capture',
        correlationId: trip.correlation_id,
        service: 'trip-service',
        aggregateId: trip.id,
        aggregateVersion: trip.version,
        payload: {
          tripId: trip.id,
          amount: trip.quoted_fare
        }
      });
      await insertOutbox(client, {
        exchange: 'ride.commands',
        routingKey: 'payment.capture',
        envelope: capEnvelope
      });

      // Phát event trip.completed
      const compEnvelope = createEnvelope({
        type: 'trip.completed',
        correlationId: trip.correlation_id,
        service: 'trip-service',
        aggregateId: trip.id,
        aggregateVersion: trip.version,
        payload: {
          tripId: trip.id,
          passengerId: trip.passenger_id,
          driverId: trip.driver_id,
          quotedFare: trip.quoted_fare
        }
      });
      await insertOutbox(client, {
        exchange: 'ride.events',
        routingKey: 'trip.completed',
        envelope: compEnvelope
      });

      await client.query('COMMIT');
      onOutboxTrigger?.();
      return { id: trip.id, status: 'COMPLETED', paymentStatus: 'CAPTURE_PENDING' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // POST /trips/:id/cancel - Hành khách hủy chuyến (trước Pivot)
  app.post<{ Params: { id: string } }>('/trips/:id/cancel', async (req) => {
    await authenticate(req);
    if (req.user.role !== 'PASSENGER') fail(403, 'FORBIDDEN', 'Chỉ hành khách mới được hủy chuyến');

    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [id]);
      if (cur.rows.length === 0) fail(404, 'NOT_FOUND', 'Không tìm thấy chuyến đi');

      const trip = cur.rows[0];
      if (trip.passenger_id !== req.user.userId) fail(404, 'NOT_FOUND', 'Không tìm thấy chuyến đi');

      if (['IN_PROGRESS', 'COMPLETED', 'PAID'].includes(trip.status)) {
        fail(409, 'TOO_LATE_TO_CANCEL', 'Chuyến đi đã bắt đầu, không thể hủy');
      }

      const { rows } = await client.query(
        `UPDATE trips
         SET status = 'COMPENSATING', saga_status = 'COMPENSATING', cancel_reason = 'PASSENGER_CANCELLED',
             version = version + 1, updated_at = now()
         WHERE id = $1 AND status IN ('REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'ACCEPTING', 'ACCEPTED')
         RETURNING *`,
        [id]
      );

      if (rows.length === 0) {
        fail(409, 'CONFLICT', 'Chuyến đi đang được xử lý hoặc không thể hủy');
      }
      const updatedTrip = rows[0];

      // Gửi matching.cancel_attempt
      const cancelMatchEnvelope = createEnvelope({
        type: 'matching.cancel_attempt',
        correlationId: updatedTrip.correlation_id,
        service: 'trip-service',
        aggregateId: updatedTrip.id,
        matchAttempt: updatedTrip.match_attempt,
        payload: {
          tripId: updatedTrip.id,
          matchAttempt: updatedTrip.match_attempt
        }
      });
      await insertOutbox(client, {
        exchange: 'ride.commands',
        routingKey: 'matching.cancel_attempt',
        envelope: cancelMatchEnvelope
      });

      // Nếu đã có driver_id và reservation_id: gửi driver.release
      if (updatedTrip.driver_id && updatedTrip.reservation_id) {
        const releaseEnvelope = createEnvelope({
          type: 'driver.release',
          correlationId: updatedTrip.correlation_id,
          service: 'trip-service',
          aggregateId: updatedTrip.id,
          payload: {
            tripId: updatedTrip.id,
            driverId: updatedTrip.driver_id,
            reservationId: updatedTrip.reservation_id,
            reservationVersion: updatedTrip.reservation_version
          }
        });
        await insertOutbox(client, {
          exchange: 'ride.commands',
          routingKey: 'driver.release',
          envelope: releaseEnvelope
        });
      }

      // Gửi payment.void
      const voidEnvelope = createEnvelope({
        type: 'payment.void',
        correlationId: updatedTrip.correlation_id,
        service: 'trip-service',
        aggregateId: updatedTrip.id,
        payload: { tripId: updatedTrip.id }
      });
      await insertOutbox(client, {
        exchange: 'ride.commands',
        routingKey: 'payment.void',
        envelope: voidEnvelope
      });

      await client.query('COMMIT');
      onOutboxTrigger?.();
      return { id: updatedTrip.id, status: 'COMPENSATING' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  return app;
}

