import type { Pool } from 'pg';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { FastifyBaseLogger } from 'fastify';

export function startOutboxPoller(
  pool: Pool,
  channelWrapper: ChannelWrapper,
  logger?: FastifyBaseLogger,
  intervalMs = 500
) {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let stopped = false;

  const poll = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `SELECT id, event_id, exchange, routing_key, envelope, attempt_count
           FROM outbox
           WHERE status = 'PENDING' AND next_attempt_at <= now()
           ORDER BY created_at ASC
           LIMIT 10
           FOR UPDATE SKIP LOCKED`
        );

        for (const row of rows) {
          try {
            const envelope = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
            await channelWrapper.publish(
              row.exchange,
              row.routing_key,
              Buffer.from(JSON.stringify(envelope)),
              { persistent: true, contentType: 'application/json' }
            );
            await client.query(
              `UPDATE outbox SET status = 'SENT', sent_at = now() WHERE id = $1`,
              [row.id]
            );
            logger?.info({
              operation: 'OUTBOX_PUBLISHED',
              eventId: row.event_id,
              exchange: row.exchange,
              routingKey: row.routing_key
            });
          } catch (pubErr) {
            logger?.warn({
              operation: 'OUTBOX_PUBLISH_FAILED',
              eventId: row.event_id,
              err: pubErr
            });
            await client.query(
              `UPDATE outbox
               SET attempt_count = attempt_count + 1,
                   next_attempt_at = now() + interval '2 seconds'
               WHERE id = $1`,
              [row.id]
            );
          }
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        logger?.warn({ operation: 'OUTBOX_TX_FAILED', err: txErr });
      } finally {
        client.release();
      }
    } catch (connErr) {
      logger?.warn({ operation: 'OUTBOX_CONNECT_FAILED', err: connErr });
    } finally {
      running = false;
    }
  };

  timer = setInterval(poll, intervalMs);

  return {
    trigger: () => void poll(),
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
}

