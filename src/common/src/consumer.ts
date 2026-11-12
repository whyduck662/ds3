import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

import { envelopeSchema, type Envelope } from './messaging.js';
import { isProcessed, markProcessed } from './messaging.js';
import { RETRY_TIERS } from './rabbit.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ConsumerParams {
  channelWrapper: ChannelWrapper;
  pool: Pool;
  queue: string;
  prefetch?: number;
  handler: (envelope: Envelope, client: PoolClient) => Promise<void>;
  logger: FastifyBaseLogger;
}

/* ------------------------------------------------------------------ */
/*  Error classification                                              */
/* ------------------------------------------------------------------ */

class PermanentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermanentError';
  }
}

function isPermanent(err: unknown): boolean {
  if (err instanceof PermanentError) return true;
  if (err instanceof SyntaxError) return true;       // JSON parse
  if (err instanceof Error && err.name === 'ZodError') return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Retry helpers                                                     */
/* ------------------------------------------------------------------ */

function retryCountFromHeaders(msg: ConsumeMessage): number {
  const headers = msg.properties?.headers as Record<string, unknown> | undefined;
  const val = headers?.['x-retry-count'];
  return typeof val === 'number' ? val : 0;
}

function retryQueueName(queue: string, retryCount: number): string {
  const tier = RETRY_TIERS[Math.min(retryCount, RETRY_TIERS.length - 1)];
  return `${queue}.${tier.suffix}`;
}

/* ------------------------------------------------------------------ */
/*  Consumer                                                          */
/* ------------------------------------------------------------------ */

export async function startConsumer(params: ConsumerParams): Promise<void> {
  const {
    channelWrapper,
    pool,
    queue,
    prefetch = 5,
    handler,
    logger,
  } = params;

  const MAX_RETRIES = 3;

  await channelWrapper.addSetup(async (ch: Channel) => {
    await ch.prefetch(prefetch);
  });

  await channelWrapper.consume(queue, async (msg) => {
    if (!msg) return; // consumer cancelled by broker

    /* ---- 1. Parse envelope ---- */
    let envelope: Envelope;
    try {
      const raw: unknown = JSON.parse(msg.content.toString());
      envelope = envelopeSchema.parse(raw) as Envelope;
    } catch (err) {
      logger.warn({ operation: 'DLQ', queue, err }, 'Schema / parse error — sending to DLQ');
      try {
        await channelWrapper.publish(
          'ride.dlq',
          `${queue}.dlq`,
          msg.content,
          {
            persistent: true,
            contentType: 'application/json',
            headers: { ...(msg.properties.headers ?? {}), 'x-dlq-reason': 'schema_error' },
          },
        );
        channelWrapper.ack(msg);
      } catch {
        // publish to DLQ failed — do NOT ack; broker will redeliver
        logger.error({ operation: 'DLQ', queue }, 'DLQ publish failed — message will be redelivered');
      }
      return;
    }

    logger.info({ operation: 'MESSAGE_RECEIVED', queue, eventId: envelope.eventId, type: envelope.type });

    /* ---- 2. Inbox dedup + handler inside a transaction ---- */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const alreadySeen = await isProcessed(client, envelope.eventId);
      if (alreadySeen) {
        await client.query('ROLLBACK');
        client.release();
        channelWrapper.ack(msg);
        logger.info({ operation: 'MESSAGE_DEDUPED', queue, eventId: envelope.eventId });
        return;
      }

      // Mark processed *before* handler so the row is visible to the handler's
      // queries within the same transaction.
      await markProcessed(client, envelope.eventId);
      await handler(envelope, client);
      await client.query('COMMIT');
      channelWrapper.ack(msg);
      logger.info({ operation: 'MESSAGE_PROCESSED', queue, eventId: envelope.eventId });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();

      if (isPermanent(err)) {
        // --- permanent error → DLQ directly ---
        logger.warn({ operation: 'DLQ', queue, eventId: envelope.eventId, err }, 'Permanent error');
        try {
          await channelWrapper.publish(
            'ride.dlq',
            `${queue}.dlq`,
            msg.content,
            {
              persistent: true,
              contentType: 'application/json',
              headers: { ...(msg.properties.headers ?? {}), 'x-dlq-reason': 'permanent_error' },
            },
          );
          channelWrapper.ack(msg);
        } catch {
          logger.error({ operation: 'DLQ', queue, eventId: envelope.eventId }, 'DLQ publish failed — redelivery');
        }
        return;
      }

      // --- transient error → retry or DLQ ---
      const retryCount = retryCountFromHeaders(msg);
      if (retryCount < MAX_RETRIES) {
        const targetRetryQueue = retryQueueName(queue, retryCount);
        logger.warn({
          operation: 'RETRY_SCHEDULED',
          queue,
          eventId: envelope.eventId,
          retryCount: retryCount + 1,
          targetRetryQueue,
          err,
        });
        try {
          await channelWrapper.publish(
            'ride.retry',
            targetRetryQueue,
            msg.content,
            {
              persistent: true,
              contentType: 'application/json',
              headers: {
                ...(msg.properties.headers ?? {}),
                'x-retry-count': retryCount + 1,
              },
            },
          );
          channelWrapper.ack(msg);
        } catch {
          // retry publish failed — do NOT ack; broker redelivers
          logger.error({ operation: 'RETRY_SCHEDULED', queue, eventId: envelope.eventId }, 'Retry publish failed — redelivery');
        }
      } else {
        logger.warn({ operation: 'DLQ', queue, eventId: envelope.eventId, retryCount }, 'Max retries exceeded');
        try {
          await channelWrapper.publish(
            'ride.dlq',
            `${queue}.dlq`,
            msg.content,
            {
              persistent: true,
              contentType: 'application/json',
              headers: {
                ...(msg.properties.headers ?? {}),
                'x-dlq-reason': 'max_retries_exceeded',
                'x-retry-count': retryCount,
              },
            },
          );
          channelWrapper.ack(msg);
        } catch {
          logger.error({ operation: 'DLQ', queue, eventId: envelope.eventId }, 'DLQ publish failed — redelivery');
        }
      }
    }
  }, { noAck: false });
}

export { PermanentError };
