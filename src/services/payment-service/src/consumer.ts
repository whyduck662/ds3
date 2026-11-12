import amqp from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import { createEnvelope, envelopeSchema, insertOutbox } from '../../../common/src/messaging.js';
import { startOutboxPoller } from '../../../common/src/outbox.js';

export function consumePayments(pool: Pool, logger: FastifyBaseLogger) {
  if (!process.env.RABBITMQ_URL) throw new Error('Thiếu RABBITMQ_URL');

  const connection = amqp.connect([process.env.RABBITMQ_URL], { reconnectTimeInSeconds: 2 });
  connection.on('connectFailed', () => logger.warn('BROKER_DISCONNECTED'));

  const wrapper = connection.createChannel({
    setup: async (channel: ConfirmChannel) => {
      const queue = 'payment.commands';
      await channel.assertExchange('ride.commands', 'direct', { durable: true });
      await channel.assertExchange('ride.events', 'topic', { durable: true });
      await channel.assertQueue(queue, { durable: true });

      await channel.bindQueue(queue, 'ride.commands', 'payment.authorize');
      await channel.bindQueue(queue, 'ride.commands', 'payment.void');
      await channel.bindQueue(queue, 'ride.commands', 'payment.capture');

      await channel.assertQueue(`${queue}.dlq`, { durable: true });
      for (const seconds of [1, 5, 15]) {
        await channel.assertQueue(`${queue}.retry.${seconds}s`, {
          durable: true,
          arguments: {
            'x-message-ttl': seconds * 1000,
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': queue
          }
        });
      }

      await channel.prefetch(5);

      const republish = (target: string, message: ConsumeMessage, headers: Record<string, unknown>) =>
        new Promise<void>((resolve, reject) => {
          channel.sendToQueue(target, message.content, { persistent: true, contentType: 'application/json', headers }, error =>
            error ? reject(error) : resolve()
          );
        });

      await channel.consume(
        queue,
        async (message) => {
          if (!message) return;
          try {
            if (message.content.length > 65536) throw new SyntaxError('Message quá lớn');
            const raw = JSON.parse(message.content.toString());
            const parsed = envelopeSchema.parse(raw);

            // Chaos injection (cho test X03)
            const headers = message.properties.headers ?? {};
            if (process.env.CHAOS_PAYMENT === 'technical' || headers['x-chaos-mode'] === 'technical') {
              throw new Error('CHAOS_PAYMENT_TECHNICAL_ERROR');
            }

            const client = await pool.connect();
            try {
              await client.query('BEGIN');

              // Inbox dedup
              const dedupRes = await client.query(
                'INSERT INTO processed_messages (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING 1',
                [parsed.eventId]
              );
              const isFirstTime = (dedupRes.rowCount ?? 0) > 0;

              if (parsed.type === 'payment.authorize') {
                const { tripId, passengerId, amount } = parsed.payload as { tripId: string; passengerId: string; amount: number };
                const cur = await client.query('SELECT status, amount, version FROM payments WHERE trip_id = $1 FOR UPDATE', [tripId]);

                if (cur.rows.length === 0) {
                  const status = process.env.CHAOS_PAYMENT === 'decline' ? 'DECLINED' : 'AUTHORIZED';
                  await client.query(
                    'INSERT INTO payments (trip_id, passenger_id, amount, status) VALUES ($1, $2, $3, $4)',
                    [tripId, passengerId, amount, status]
                  );
                  const replyType = status === 'DECLINED' ? 'payment.declined' : 'payment.authorized';
                  const replyEnvelope = createEnvelope({
                    type: replyType,
                    correlationId: parsed.correlationId,
                    causationId: parsed.eventId,
                    service: 'payment-service',
                    aggregateId: tripId,
                    payload: { tripId, passengerId, amount, status }
                  });
                  await insertOutbox(client, { exchange: 'ride.commands', routingKey: 'trip.replies', envelope: replyEnvelope });
                } else {
                  const existing = cur.rows[0];
                  if (existing.status === 'VOIDED' || existing.status === 'TOMBSTONED') {
                    const replyEnvelope = createEnvelope({
                      type: 'payment.authorize_rejected_cancelled',
                      correlationId: parsed.correlationId,
                      causationId: parsed.eventId,
                      service: 'payment-service',
                      aggregateId: tripId,
                      aggregateVersion: existing.version,
                      payload: { tripId, status: existing.status, reason: 'ALREADY_VOIDED' }
                    });
                    await insertOutbox(client, { exchange: 'ride.commands', routingKey: 'trip.replies', envelope: replyEnvelope });
                  } else if (existing.status === 'AUTHORIZED') {
                    const replyEnvelope = createEnvelope({
                      type: 'payment.authorized',
                      correlationId: parsed.correlationId,
                      causationId: parsed.eventId,
                      service: 'payment-service',
                      aggregateId: tripId,
                      aggregateVersion: existing.version,
                      payload: { tripId, amount: existing.amount, status: 'AUTHORIZED' }
                    });
                    await insertOutbox(client, { exchange: 'ride.commands', routingKey: 'trip.replies', envelope: replyEnvelope });
                  }
                }
              } else if (parsed.type === 'payment.void') {
                const { tripId } = parsed.payload as { tripId: string };
                const cur = await client.query('SELECT status, version FROM payments WHERE trip_id = $1 FOR UPDATE', [tripId]);

                if (cur.rows.length === 0) {
                  // Tombstone: void trước authorize
                  await client.query(
                    'INSERT INTO payments (trip_id, amount, status) VALUES ($1, 0, $2)',
                    [tripId, 'VOIDED']
                  );
                } else if (cur.rows[0].status === 'AUTHORIZED') {
                  await client.query(
                    'UPDATE payments SET status = $1, version = version + 1, updated_at = now() WHERE trip_id = $2',
                    ['VOIDED', tripId]
                  );
                }
                const replyEnvelope = createEnvelope({
                  type: 'payment.voided',
                  correlationId: parsed.correlationId,
                  causationId: parsed.eventId,
                  service: 'payment-service',
                  aggregateId: tripId,
                  payload: { tripId, status: 'VOIDED' }
                });
                await insertOutbox(client, { exchange: 'ride.commands', routingKey: 'trip.replies', envelope: replyEnvelope });
              } else if (parsed.type === 'payment.capture') {
                const { tripId, amount } = parsed.payload as { tripId: string; amount?: number };
                const cur = await client.query('SELECT status, amount, version FROM payments WHERE trip_id = $1 FOR UPDATE', [tripId]);

                if (cur.rows.length > 0 && cur.rows[0].status === 'AUTHORIZED') {
                  await client.query(
                    'UPDATE payments SET status = $1, version = version + 1, updated_at = now() WHERE trip_id = $2',
                    ['CAPTURED', tripId]
                  );
                }

                const finalStatus = cur.rows.length > 0 && cur.rows[0].status === 'CAPTURED' ? 'CAPTURED' : (cur.rows.length > 0 && cur.rows[0].status === 'AUTHORIZED' ? 'CAPTURED' : cur.rows[0]?.status ?? 'NOT_FOUND');
                const replyEnvelope = createEnvelope({
                  type: 'payment.captured',
                  correlationId: parsed.correlationId,
                  causationId: parsed.eventId,
                  service: 'payment-service',
                  aggregateId: tripId,
                  payload: { tripId, amount: cur.rows[0]?.amount ?? amount ?? 0, status: finalStatus }
                });
                await insertOutbox(client, { exchange: 'ride.commands', routingKey: 'trip.replies', envelope: replyEnvelope });
              }

              await client.query('COMMIT');
              poller.trigger();
              channel.ack(message);
              logger.info({
                operation: isFirstTime ? 'PAYMENT_PROCESSED' : 'PAYMENT_MESSAGE_DEDUPED',
                type: parsed.type,
                tripId: (parsed.payload as any)?.tripId,
                eventId: parsed.eventId
              });
            } catch (txError) {
              await client.query('ROLLBACK');
              throw txError;
            } finally {
              client.release();
            }
          } catch (error) {
            const headers = message.properties.headers ?? {};
            const count = Number.isInteger(headers.retryCount) && headers.retryCount >= 0 ? headers.retryCount : 0;
            const permanent = error instanceof ZodError || error instanceof SyntaxError;
            const target = permanent || count >= 3 ? `${queue}.dlq` : `${queue}.retry.${[1, 5, 15][count]}s`;
            try {
              await republish(target, message, {
                ...headers,
                retryCount: count + 1,
                lastError: permanent ? 'INVALID_MESSAGE' : String(error),
                failureTime: new Date().toISOString()
              });
              channel.ack(message);
              logger.warn({
                operation: target.endsWith('.dlq') ? 'DLQ' : 'RETRY_SCHEDULED',
                retryCount: count + 1,
                err: error
              });
            } catch {
              await channel.close().catch(() => undefined);
            }
          }
        },
        { noAck: false }
      );
    }
  });

  const poller = startOutboxPoller(pool, wrapper, logger);

  return {
    connected: () => connection.isConnected(),
    close: async () => {
      poller.stop();
      await wrapper.close();
      await connection.close();
    }
  };
}

