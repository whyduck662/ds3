import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { createEnvelope, insertOutbox } from '../../../common/src/messaging.js';

export function startDriverTtlJobs(pool: Pool, logger?: FastifyBaseLogger) {
  let stopped = false;
  let reservationTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  // 1. Reservation expiry job (every 2s)
  const checkReservationExpiry = async () => {
    if (stopped) return;
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `UPDATE drivers
           SET status = 'AVAILABLE',
               current_trip_id = NULL,
               reservation_id = NULL,
               reserved_until = NULL,
               version = version + 1,
               updated_at = now()
           WHERE status = 'RESERVED' AND reserved_until < now()
           RETURNING id, current_trip_id AS "currentTripId",
                     reservation_id AS "reservationId",
                     reservation_version AS "reservationVersion"`
        );

        for (const row of result.rows) {
          logger?.info({
            operation: 'RESERVATION_EXPIRED',
            driverId: row.id,
            tripId: row.currentTripId,
            reservationId: row.reservationId,
            reservationVersion: row.reservationVersion
          });

          if (row.currentTripId) {
            const envelope = createEnvelope({
              type: 'driver.reservation_expired',
              correlationId: row.currentTripId,
              service: 'driver-service',
              aggregateId: row.currentTripId,
              payload: {
                driverId: row.id,
                tripId: row.currentTripId,
                reservationId: row.reservationId,
                reservationVersion: row.reservationVersion
              }
            });

            // Send to trip replies so trip orchestrator wakes up and rematches
            await insertOutbox(client, {
              exchange: 'ride.commands',
              routingKey: 'trip.replies',
              envelope
            });

            // Also broadcast on ride.events
            await insertOutbox(client, {
              exchange: 'ride.events',
              routingKey: 'driver.reservation_expired',
              envelope
            });
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger?.warn({ operation: 'RESERVATION_EXPIRY_JOB_ERR', err });
      } finally {
        client.release();
      }
    } catch (err) {
      logger?.warn({ operation: 'RESERVATION_EXPIRY_CONN_ERR', err });
    }
  };

  // 2. Heartbeat offline job (every 10s)
  const checkHeartbeatOffline = async () => {
    if (stopped) return;
    try {
      const result = await pool.query(
        `UPDATE drivers
         SET status = 'OFFLINE',
             version = version + 1,
             updated_at = now()
         WHERE status = 'AVAILABLE'
           AND last_seen_at < now() - interval '30 seconds'
         RETURNING id`
      );

      for (const row of result.rows) {
        logger?.info({
          operation: 'HEARTBEAT_OFFLINE',
          driverId: row.id
        });
      }
    } catch (err) {
      logger?.warn({ operation: 'HEARTBEAT_OFFLINE_JOB_ERR', err });
    }
  };

  reservationTimer = setInterval(() => void checkReservationExpiry(), 2000);
  heartbeatTimer = setInterval(() => void checkHeartbeatOffline(), 10000);

  return {
    stop: () => {
      stopped = true;
      if (reservationTimer) clearInterval(reservationTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  };
}

