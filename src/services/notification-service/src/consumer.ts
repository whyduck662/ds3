import amqp from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import { saveNotification } from './app.js';

// Adapter riêng TV1; TV3 có thể thay bằng common/messaging cùng contract.
export function consumeNotifications(pool: Pool, logger: FastifyBaseLogger) {
  if (!process.env.RABBITMQ_URL) throw new Error('Thiếu RABBITMQ_URL');
  const connection = amqp.connect([process.env.RABBITMQ_URL], { reconnectTimeInSeconds: 2 });
  connection.on('connectFailed', () => logger.warn('BROKER_DISCONNECTED'));
  const wrapper = connection.createChannel({ setup: async (channel: ConfirmChannel) => {
    const queue = 'notification.events';
    await channel.assertExchange('ride.events', 'topic', { durable: true });
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, 'ride.events', 'trip.*');
    await channel.assertQueue(`${queue}.dlq`, { durable: true });
    for (const seconds of [1,5,15]) {
      await channel.assertQueue(`${queue}.retry.${seconds}s`, { durable: true, arguments: { 'x-message-ttl': seconds * 1000, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue } });
    }
    await channel.prefetch(5);
    const republish = (target: string, message: ConsumeMessage, headers: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
      channel.sendToQueue(target, message.content, { persistent: true, contentType: 'application/json', headers }, error => error ? reject(error) : resolve());
    });
    await channel.consume(queue, async message => {
      if (!message) return;
      try {
        if (message.content.length > 65536) throw new SyntaxError('Message quá lớn');
        const result = await saveNotification(pool, JSON.parse(message.content.toString()));
        logger.info({ eventId: result.event.eventId, tripId: result.event.payload.tripId, correlationId: result.event.correlationId, operation: result.duplicate ? 'MESSAGE_DEDUPED' : 'NOTIFICATION_SAVED' });
        channel.ack(message); // Chỉ ACK sau khi inbox + notification đã COMMIT.
      } catch (error) {
        const headers = message.properties.headers ?? {};
        const count = Number.isInteger(headers.retryCount) && headers.retryCount >= 0 ? headers.retryCount : 0;
        const permanent = error instanceof ZodError || error instanceof SyntaxError;
        const target = permanent || count >= 3 ? `${queue}.dlq` : `${queue}.retry.${[1,5,15][count]}s`;
        try {
          await republish(target, message, { ...headers, retryCount: count + 1, lastError: permanent ? 'INVALID_MESSAGE' : 'PROCESSING_FAILED', failureTime: new Date().toISOString() });
          channel.ack(message);
          logger.warn({ operation: target.endsWith('.dlq') ? 'DLQ' : 'RETRY_SCHEDULED', retryCount: count + 1 });
        } catch {
          // Đóng channel để broker redeliver; connection manager tự kết nối lại.
          await channel.close().catch(() => undefined);
        }
      }
    }, { noAck: false });
  } });
  return { connected: () => connection.isConnected(), close: async () => { await wrapper.close(); await connection.close(); } };
}
