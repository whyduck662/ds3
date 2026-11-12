import amqp from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import { createEnvelope, envelopeSchema, insertOutbox } from '../../../common/src/messaging.js';
import { startOutboxPoller } from '../../../common/src/outbox.js';

export function consumeTripReplies(pool: Pool, logger: FastifyBaseLogger) {
  if (!process.env.RABBITMQ_URL) throw new Error('Thiếu RABBITMQ_URL');

  const connection = amqp.connect([process.env.RABBITMQ_URL], { reconnectTimeInSeconds: 2 });
  connection.on('connectFailed', () => logger.warn('BROKER_DISCONNECTED'));

  const wrapper = connection.createChannel({
    setup: async (channel: ConfirmChannel) => {
      const queue = 'trip.replies';
      await channel.assertExchange('ride.commands', 'direct', { durable: true });
      await channel.assertExchange('ride.events', 'topic', { durable: true });

      await channel.assertQueue(queue, { durable: true });
      await channel.bindQueue(queue, 'ride.commands', 'trip.replies');

      // Bind driver events (ví dụ driver.reservation_expired)
      const driverEventsQueue = 'trip.driver-events';
      await channel.assertQueue(driverEventsQueue, { durable: true });
      await channel.bindQueue(driverEventsQueue, 'ride.events', 'driver.*');

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

      const handleMessage = async (message: ConsumeMessage | null) => {
        if (!message) return;
        try {
          if (message.content.length > 65536) throw new SyntaxError('Message quá lớn');
          const raw = JSON.parse(message.content.toString());
          const parsed = envelopeSchema.parse(raw);

          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // Inbox dedup
            const dedupRes = await client.query(
              'INSERT INTO processed_messages (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING 1',
              [parsed.eventId]
            );
            const isFirst = (dedupRes.rowCount ?? 0) > 0;

            if (isFirst) {
              const tripId = parsed.aggregateId;
              const cur = await client.query('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId]);

              if (cur.rows.length > 0) {
                const trip = cur.rows[0];

                if (parsed.type === 'payment.authorized') {
                  if (trip.status === 'REQUESTED') {
                    await client.query(
                      `UPDATE trips
                       SET status = 'SEARCHING', payment_status = 'AUTHORIZED', match_attempt = 1, version = version + 1
                       WHERE id = $1`,
                      [tripId]
                    );

                    const findEnvelope = createEnvelope({
                      type: 'matching.find_driver',
                      correlationId: trip.correlation_id,
                      service: 'trip-service',
                      aggregateId: tripId,
                      matchAttempt: 1,
                      payload: {
                        tripId,
                        pickup: { lat: trip.pickup_lat, lng: trip.pickup_lng },
                        dropoff: { lat: trip.dropoff_lat, lng: trip.dropoff_lng },
                        matchAttempt: 1
                      }
                    });
                    await insertOutbox(client, {
                      exchange: 'ride.commands',
                      routingKey: 'matching.find_driver',
                      envelope: findEnvelope
                    });
                  } else if (trip.status === 'COMPENSATING' || trip.status === 'CANCELLED') {
                    // Late reply: đã hủy trước khi authorize tới -> lập tức gửi void
                    const voidEnvelope = createEnvelope({
                      type: 'payment.void',
                      correlationId: trip.correlation_id,
                      service: 'trip-service',
                      aggregateId: tripId,
                      payload: { tripId }
                    });
                    await insertOutbox(client, {
                      exchange: 'ride.commands',
                      routingKey: 'payment.void',
                      envelope: voidEnvelope
                    });
                  }
                } else if (parsed.type === 'payment.declined') {
                  await client.query(
                    `UPDATE trips
                     SET status = 'COMPENSATING', saga_status = 'COMPENSATING', payment_status = 'DECLINED',
                         comp_payment_ack = true, cancel_reason = 'PAYMENT_DECLINED', version = version + 1
                     WHERE id = $1`,
                    [tripId]
                  );
                } else if (parsed.type === 'matching.driver_reserved') {
                  const { driverId, reservationId, reservationVersion, matchAttempt } = parsed.payload as any;
                  if (trip.status === 'SEARCHING' && (!trip.match_attempt || trip.match_attempt === matchAttempt)) {
                    await client.query(
                      `UPDATE trips
                       SET status = 'DRIVER_ASSIGNED', driver_id = $1, reservation_id = $2,
                           reservation_version = $3, offer_deadline = now() + interval '30 seconds',
                           version = version + 1
                       WHERE id = $4`,
                      [driverId, reservationId, reservationVersion, tripId]
                    );
                  } else if (trip.status === 'COMPENSATING' || trip.status === 'CANCELLED') {
                    // Late reservation: lập tức giải phóng driver
                    const releaseEnvelope = createEnvelope({
                      type: 'driver.release',
                      correlationId: trip.correlation_id,
                      service: 'trip-service',
                      aggregateId: tripId,
                      payload: {
                        tripId,
                        driverId,
                        reservationId,
                        reservationVersion
                      }
                    });
                    await insertOutbox(client, {
                      exchange: 'ride.commands',
                      routingKey: 'driver.release',
                      envelope: releaseEnvelope
                    });
                  }
                } else if (parsed.type === 'matching.no_driver') {
                  await client.query(
                    `UPDATE trips
                     SET status = 'COMPENSATING', saga_status = 'COMPENSATING', comp_match_ack = true,
                         cancel_reason = 'NO_DRIVER', version = version + 1
                     WHERE id = $1`,
                    [tripId]
                  );
                  // Bù trừ void payment
                  const voidEnvelope = createEnvelope({
                    type: 'payment.void',
                    correlationId: trip.correlation_id,
                    service: 'trip-service',
                    aggregateId: tripId,
                    payload: { tripId }
                  });
                  await insertOutbox(client, {
                    exchange: 'ride.commands',
                    routingKey: 'payment.void',
                    envelope: voidEnvelope
                  });
                } else if (parsed.type === 'matching.attempt_cancelled') {
                  await client.query(
                    'UPDATE trips SET comp_match_ack = true, version = version + 1 WHERE id = $1',
                    [tripId]
                  );
                } else if (parsed.type === 'driver.released') {
                  await client.query(
                    'UPDATE trips SET comp_driver_ack = true, version = version + 1 WHERE id = $1',
                    [tripId]
                  );
                } else if (parsed.type === 'payment.voided' || parsed.type === 'payment.authorize_rejected_cancelled') {
                  await client.query(
                    "UPDATE trips SET comp_payment_ack = true, payment_status = 'VOIDED', version = version + 1 WHERE id = $1",
                    [tripId]
                  );
                } else if (parsed.type === 'payment.captured') {
                  if (trip.status === 'COMPLETED') {
                    await client.query(
                      `UPDATE trips
                       SET status = 'PAID', payment_status = 'CAPTURED', saga_status = 'COMPLETED',
                           version = version + 1, updated_at = now()
                       WHERE id = $1`,
                      [tripId]
                    );

                    const paidEnvelope = createEnvelope({
                      type: 'trip.paid',
                      correlationId: trip.correlation_id,
                      service: 'trip-service',
                      aggregateId: tripId,
                      aggregateVersion: trip.version + 1,
                      payload: {
                        tripId,
                        passengerId: trip.passenger_id,
                        driverId: trip.driver_id,
                        quotedFare: trip.quoted_fare
                      }
                    });
                    await insertOutbox(client, {
                      exchange: 'ride.events',
                      routingKey: 'trip.paid',
                      envelope: paidEnvelope
                    });
                  }
                } else if (parsed.type === 'driver.reservation_expired') {
                  const { reservationId } = parsed.payload as any;
                  if (trip.status === 'DRIVER_ASSIGNED' && trip.reservation_id === reservationId) {
                    if (trip.match_attempt < 3) {
                      await client.query(
                        `UPDATE trips
                         SET status = 'SEARCHING', driver_id = null, reservation_id = null,
                             match_attempt = match_attempt + 1, version = version + 1
                         WHERE id = $1`,
                        [tripId]
                      );
                      const findEnvelope = createEnvelope({
                        type: 'matching.find_driver',
                        correlationId: trip.correlation_id,
                        service: 'trip-service',
                        aggregateId: tripId,
                        matchAttempt: trip.match_attempt + 1,
                        payload: {
                          tripId,
                          pickup: { lat: trip.pickup_lat, lng: trip.pickup_lng },
                          dropoff: { lat: trip.dropoff_lat, lng: trip.dropoff_lng },
                          matchAttempt: trip.match_attempt + 1,
                          excludedDriverIds: trip.rejected_driver_ids
                        }
                      });
                      await insertOutbox(client, {
                        exchange: 'ride.commands',
                        routingKey: 'matching.find_driver',
                        envelope: findEnvelope
                      });
                    } else {
                      // Hết lượt rematch -> hủy
                      await client.query(
                        `UPDATE trips
                         SET status = 'COMPENSATING', saga_status = 'COMPENSATING',
                             cancel_reason = 'OFFER_EXPIRED', version = version + 1
                         WHERE id = $1`,
                        [tripId]
                      );
                      const voidEnvelope = createEnvelope({
                        type: 'payment.void',
                        correlationId: trip.correlation_id,
                        service: 'trip-service',
                        aggregateId: tripId,
                        payload: { tripId }
                      });
                      await insertOutbox(client, {
                        exchange: 'ride.commands',
                        routingKey: 'payment.void',
                        envelope: voidEnvelope
                      });
                    }
                  }
                }

                // Kiểm tra hoàn tất bù trừ (Saga Compensation completion check)
                const checkRes = await client.query('SELECT * FROM trips WHERE id = $1', [tripId]);
                if (checkRes.rows.length > 0) {
                  const t = checkRes.rows[0];
                  if (t.status === 'COMPENSATING') {
                    const matchDone = t.comp_match_ack || !t.match_attempt;
                    const driverDone = t.comp_driver_ack || !t.driver_id;
                    const paymentDone = t.comp_payment_ack || t.payment_status === 'VOIDED' || t.payment_status === 'DECLINED';

                    if (matchDone && driverDone && paymentDone) {
                      await client.query(
                        `UPDATE trips
                         SET status = 'CANCELLED', saga_status = 'CANCELLED', version = version + 1, updated_at = now()
                         WHERE id = $1`,
                        [tripId]
                      );

                      const cancelEvent = createEnvelope({
                        type: 'trip.cancelled',
                        correlationId: t.correlation_id,
                        service: 'trip-service',
                        aggregateId: tripId,
                        aggregateVersion: t.version + 1,
                        payload: {
                          tripId,
                          passengerId: t.passenger_id,
                          driverId: t.driver_id,
                          cancelReason: t.cancel_reason ?? 'CANCELLED'
                        }
                      });
                      await insertOutbox(client, {
                        exchange: 'ride.events',
                        routingKey: 'trip.cancelled',
                        envelope: cancelEvent
                      });
                    }
                  }
                }
              }
            }

            await client.query('COMMIT');
            poller.trigger();
            channel.ack(message);
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
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
      };

      await channel.consume(queue, handleMessage, { noAck: false });
      await channel.consume(driverEventsQueue, handleMessage, { noAck: false });
    }
  });

  const poller = startOutboxPoller(pool, wrapper, logger);

  // Background Reconciler quét mỗi 2 giây
  const reconcilerInterval = setInterval(async () => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Quét hoàn tất COMPENSATING
        const compensating = await client.query(
          `SELECT * FROM trips
           WHERE status = 'COMPENSATING'
           FOR UPDATE SKIP LOCKED`
        );

        for (const t of compensating.rows) {
          const matchDone = t.comp_match_ack || !t.match_attempt;
          const driverDone = t.comp_driver_ack || !t.driver_id;
          const paymentDone = t.comp_payment_ack || t.payment_status === 'VOIDED' || t.payment_status === 'DECLINED';

          if (matchDone && driverDone && paymentDone) {
            await client.query(
              `UPDATE trips
               SET status = 'CANCELLED', saga_status = 'CANCELLED', version = version + 1, updated_at = now()
               WHERE id = $1`,
              [t.id]
            );
            const cancelEvent = createEnvelope({
              type: 'trip.cancelled',
              correlationId: t.correlation_id,
              service: 'trip-service',
              aggregateId: t.id,
              aggregateVersion: t.version + 1,
              payload: {
                tripId: t.id,
                passengerId: t.passenger_id,
                driverId: t.driver_id,
                cancelReason: t.cancel_reason ?? 'CANCELLED'
              }
            });
            await insertOutbox(client, {
              exchange: 'ride.events',
              routingKey: 'trip.cancelled',
              envelope: cancelEvent
            });
            poller.trigger();
          }
        }

        // 2. Quét Saga Timeout (90s pre-pivot)
        await client.query(
          `UPDATE trips
           SET status = 'COMPENSATING', saga_status = 'COMPENSATING', cancel_reason = 'SAGA_TIMEOUT', version = version + 1
           WHERE status IN ('REQUESTED', 'SEARCHING', 'DRIVER_ASSIGNED', 'ACCEPTING')
             AND saga_deadline < now()`
        );

        // 3. Quét Offer deadline quá hạn
        const expiredOffers = await client.query(
          `SELECT * FROM trips
           WHERE status = 'DRIVER_ASSIGNED' AND offer_deadline < now()
           FOR UPDATE SKIP LOCKED`
        );
        for (const t of expiredOffers.rows) {
          if (t.match_attempt < 3) {
            await client.query(
              `UPDATE trips
               SET status = 'SEARCHING', driver_id = null, reservation_id = null,
                   match_attempt = match_attempt + 1, version = version + 1
               WHERE id = $1`,
              [t.id]
            );
            const findEnvelope = createEnvelope({
              type: 'matching.find_driver',
              correlationId: t.correlation_id,
              service: 'trip-service',
              aggregateId: t.id,
              matchAttempt: t.match_attempt + 1,
              payload: {
                tripId: t.id,
                pickup: { lat: t.pickup_lat, lng: t.pickup_lng },
                dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng },
                matchAttempt: t.match_attempt + 1,
                excludedDriverIds: t.rejected_driver_ids
              }
            });
            await insertOutbox(client, {
              exchange: 'ride.commands',
              routingKey: 'matching.find_driver',
              envelope: findEnvelope
            });
            poller.trigger();
          } else {
            await client.query(
              `UPDATE trips
               SET status = 'COMPENSATING', saga_status = 'COMPENSATING', cancel_reason = 'OFFER_EXPIRED', version = version + 1
               WHERE id = $1`,
              [t.id]
            );
          }
        }

        await client.query('COMMIT');
      } catch (recErr) {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    } catch {}
  }, 2000);

  return {
    triggerPoller: () => poller.trigger(),
    close: async () => {
      clearInterval(reconcilerInterval);
      poller.stop();
      await wrapper.close();
      await connection.close();
    }
  };
}

