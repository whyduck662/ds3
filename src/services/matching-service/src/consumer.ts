import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { startConsumer, createEnvelope, insertOutbox, type Envelope } from '../../../common/src/messaging.js';

const command = z.object({ tripId: z.string().uuid(), matchAttempt: z.number().int().nonnegative().default(1) });
const find = command.extend({ pickup: z.object({ lat: z.number(), lng: z.number() }),
  excludedDriverIds: z.array(z.string().uuid()).default([]) });

export async function matchingCommand(envelope: Envelope, client: PoolClient) {
  if (envelope.type === 'matching.find_driver') {
    const body = find.parse(envelope.payload);
    // Commit the durable work item with the inbox BEFORE any network request.
    await client.query(`INSERT INTO match_attempts
      (trip_id, attempt, status, correlation_id, pickup_lat, pickup_lng, excluded_drivers)
      VALUES ($1,$2,'PENDING',$3,$4,$5,$6) ON CONFLICT (trip_id,attempt) DO NOTHING`,
    [body.tripId, body.matchAttempt, envelope.correlationId, body.pickup.lat, body.pickup.lng, body.excludedDriverIds]);
  } else if (envelope.type === 'matching.cancel_attempt') {
    const body = command.parse(envelope.payload);
    // A cancellation tombstone survives restart and blocks late find commands.
    const { rows } = await client.query(`INSERT INTO match_attempts (trip_id,attempt,status,correlation_id)
      VALUES ($1,$2,'CANCEL_REQUESTED',$3) ON CONFLICT (trip_id,attempt) DO UPDATE
      SET status=CASE WHEN match_attempts.status='CANCELLED' THEN 'CANCELLED' ELSE 'CANCEL_REQUESTED' END,
          updated_at=now() RETURNING status`, [body.tripId, body.matchAttempt, envelope.correlationId]);
    // Already cancelled means the worker previously verified release; resend ACK idempotently.
    if (rows[0].status === 'CANCELLED') await insertOutbox(client, {
      exchange: 'ride.commands', routingKey: 'trip.replies', envelope: createEnvelope({
        type: 'matching.attempt_cancelled', service: 'matching-service', aggregateId: body.tripId,
        correlationId: envelope.correlationId, matchAttempt: body.matchAttempt, payload: { ...body, cancelled: true }
      })
    });
  }
}

export function setupMatchingConsumer(channelWrapper: ChannelWrapper, pool: Pool, logger: FastifyBaseLogger) {
  return startConsumer({ channelWrapper, pool, queue: 'matching.commands', logger, handler: matchingCommand });
}
