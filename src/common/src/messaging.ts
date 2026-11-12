import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

export const envelopeSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string(),
  schemaVersion: z.literal(1),
  occurredAt: z.string().datetime(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().nullable(),
  producer: z.object({
    service: z.string(),
    instanceId: z.string()
  }),
  aggregateId: z.string().uuid(),
  aggregateVersion: z.number().int(),
  matchAttempt: z.number().int(),
  payload: z.record(z.string(), z.unknown())
});

export type Envelope<T = Record<string, unknown>> = Omit<z.infer<typeof envelopeSchema>, 'payload'> & {
  payload: T;
};

export function createEnvelope<T extends Record<string, unknown>>(params: {
  type: string;
  correlationId: string;
  causationId?: string | null;
  service: string;
  instanceId?: string;
  aggregateId: string;
  aggregateVersion?: number;
  matchAttempt?: number;
  payload: T;
}): Envelope<T> {
  return {
    eventId: randomUUID(),
    type: params.type,
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    correlationId: params.correlationId,
    causationId: params.causationId ?? null,
    producer: {
      service: params.service,
      instanceId: params.instanceId ?? process.env.INSTANCE_ID ?? params.service
    },
    aggregateId: params.aggregateId,
    aggregateVersion: params.aggregateVersion ?? 1,
    matchAttempt: params.matchAttempt ?? 0,
    payload: params.payload
  };
}

export async function insertOutbox(
  client: PoolClient | Pool,
  params: {
    exchange: string;
    routingKey: string;
    envelope: Envelope;
  }
) {
  await client.query(
    `INSERT INTO outbox (event_id, exchange, routing_key, envelope)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id) DO NOTHING`,
    [params.envelope.eventId, params.exchange, params.routingKey, JSON.stringify(params.envelope)]
  );
}

export async function isProcessed(client: PoolClient | Pool, eventId: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM processed_messages WHERE event_id = $1', [eventId]);
  return (result.rowCount ?? 0) > 0;
}

export async function markProcessed(client: PoolClient | Pool, eventId: string): Promise<boolean> {
  const res = await client.query(
    'INSERT INTO processed_messages (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING 1',
    [eventId]
  );
  return (res.rowCount ?? 0) > 0;
}

