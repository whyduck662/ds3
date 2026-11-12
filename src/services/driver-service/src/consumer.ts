import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import {
  startConsumer,
  createEnvelope,
  insertOutbox,
  type Envelope
} from '../../../common/src/messaging.js';

export function setupDriverConsumers(
  channelWrapper: ChannelWrapper,
  pool: Pool,
  logger: FastifyBaseLogger
) {
  // 1. Consume driver.commands
  void startConsumer({
    channelWrapper,
    pool,
    queue: 'driver.commands',
    logger,
    handler: async (envelope: Envelope, client: PoolClient) => {
      logger.info({
        operation: 'DRIVER_COMMAND_RECEIVED',
        type: envelope.type,
        eventId: envelope.eventId,
        correlationId: envelope.correlationId
      });

      if (envelope.type === 'driver.release') {
        const payload = envelope.payload as {
          tripId: string;
          reservationId: string;
          driverId: string;
          reservationVersion?: number;
        };

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
           RETURNING version`,
          [payload.driverId, payload.tripId, payload.reservationId]
        );

        let status = 'RELEASED';
        if (updateResult.rowCount === 0) {
          const check = await client.query(
            `SELECT id, status, current_trip_id AS "currentTripId",
                    reservation_id AS "reservationId"
             FROM drivers WHERE id = $1`,
            [payload.driverId]
          );

          if (check.rowCount && check.rows[0].reservationId && check.rows[0].reservationId !== payload.reservationId) {
            status = 'STALE_RELEASE';
          }
        }

        const reply = createEnvelope({
          type: 'driver.released',
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
          service: 'driver-service',
          aggregateId: payload.tripId,
          payload: {
            driverId: payload.driverId,
            tripId: payload.tripId,
            reservationId: payload.reservationId,
            status
          }
        });

        await insertOutbox(client, {
          exchange: 'ride.commands',
          routingKey: 'trip.replies',
          envelope: reply
        });
      }
    }
  });

  // 2. Consume driver.trip-events
  void startConsumer({
    channelWrapper,
    pool,
    queue: 'driver.trip-events',
    logger,
    handler: async (envelope: Envelope, client: PoolClient) => {
      logger.info({
        operation: 'DRIVER_TRIP_EVENT_RECEIVED',
        type: envelope.type,
        eventId: envelope.eventId,
        correlationId: envelope.correlationId
      });

      const payload = envelope.payload as {
        tripId: string;
        driverId?: string | null;
      };

      if (!payload.driverId) return;

      if (envelope.type === 'trip.completed') {
        await client.query(
          `UPDATE drivers
           SET status = 'AVAILABLE',
               current_trip_id = NULL,
               reservation_id = NULL,
               reserved_until = NULL,
               version = version + 1,
               updated_at = now()
           WHERE id = $1 AND current_trip_id = $2`,
          [payload.driverId, payload.tripId]
        );
      } else if (envelope.type === 'trip.cancelled') {
        await client.query(
          `UPDATE drivers
           SET status = 'AVAILABLE',
               current_trip_id = NULL,
               reservation_id = NULL,
               reserved_until = NULL,
               version = version + 1,
               updated_at = now()
           WHERE id = $1
             AND current_trip_id = $2
             AND status IN ('RESERVED', 'AVAILABLE')`,
          [payload.driverId, payload.tripId]
        );
      }
    }
  });
}

