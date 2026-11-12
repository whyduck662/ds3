import { randomUUID } from 'node:crypto';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import {
  startConsumer,
  createEnvelope,
  insertOutbox,
  type Envelope
} from '../../../common/src/messaging.js';

const findDriverSchema = z.object({
  tripId: z.string().uuid(),
  matchAttempt: z.number().int().nonnegative().optional().default(1),
  pickup: z.object({
    lat: z.number(),
    lng: z.number()
  }),
  dropoff: z.object({
    lat: z.number(),
    lng: z.number()
  }).optional(),
  excludedDrivers: z.array(z.string().uuid()).optional().default([])
});

const cancelAttemptSchema = z.object({
  tripId: z.string().uuid(),
  matchAttempt: z.number().int().nonnegative().optional().default(1)
});

interface CandidateDriver {
  id: string;
  latitude: number;
  longitude: number;
  distance: number;
  status: string;
}

export function setupMatchingConsumer(
  channelWrapper: ChannelWrapper,
  pool: Pool,
  logger: FastifyBaseLogger
) {
  const driverUrl = process.env.DRIVER_SERVICE_URL ?? 'http://driver-service:8082';
  const instanceId = process.env.INSTANCE_ID ?? process.env.SERVICE_NAME ?? 'matching-service';
  const internalToken = process.env.INTERNAL_TOKEN ?? '';

  void startConsumer({
    channelWrapper,
    pool,
    queue: 'matching.commands',
    logger,
    handler: async (envelope: Envelope, client: PoolClient) => {
      logger.info({
        operation: 'MATCHING_COMMAND_RECEIVED',
        type: envelope.type,
        eventId: envelope.eventId,
        correlationId: envelope.correlationId
      });

      /* -------------------------------------------------------------- */
      /*  1. Handle matching.cancel_attempt                             */
      /* -------------------------------------------------------------- */
      if (envelope.type === 'matching.cancel_attempt') {
        const payload = cancelAttemptSchema.parse(envelope.payload);

        // Check if attempt exists
        const existing = await client.query(
          `SELECT * FROM match_attempts WHERE trip_id = $1 AND attempt = $2 FOR UPDATE`,
          [payload.tripId, payload.matchAttempt]
        );

        if (!existing.rowCount) {
          // Insert tombstone so find_driver arriving later will abort immediately
          await client.query(
            `INSERT INTO match_attempts (trip_id, attempt, status, correlation_id)
             VALUES ($1, $2, 'CANCEL_REQUESTED', $3)
             ON CONFLICT (trip_id, attempt) DO UPDATE SET status = 'CANCEL_REQUESTED', updated_at = now()`,
            [payload.tripId, payload.matchAttempt, envelope.correlationId]
          );

          logger.info({
            operation: 'CANCEL_TOMBSTONE_CREATED',
            tripId: payload.tripId,
            matchAttempt: payload.matchAttempt,
            correlationId: envelope.correlationId
          });
        } else {
          const attempt = existing.rows[0];
          await client.query(
            `UPDATE match_attempts
             SET status = 'CANCEL_REQUESTED', updated_at = now()
             WHERE trip_id = $1 AND attempt = $2`,
            [payload.tripId, payload.matchAttempt]
          );

          // If there was a candidate reservation, release it
          if (attempt.candidate_driver_id && attempt.reservation_id) {
            try {
              const res = await fetch(
                `${driverUrl}/internal/drivers/${attempt.candidate_driver_id}/release`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Token': internalToken,
                    'X-Correlation-ID': envelope.correlationId
                  },
                  body: JSON.stringify({
                    tripId: payload.tripId,
                    reservationId: attempt.reservation_id
                  }),
                  signal: AbortSignal.timeout(2000)
                }
              );
              logger.info({
                operation: 'CANCEL_RELEASE_SENT',
                driverId: attempt.candidate_driver_id,
                tripId: payload.tripId,
                status: res.status
              });
            } catch (err) {
              logger.warn({
                operation: 'CANCEL_RELEASE_FAILED',
                driverId: attempt.candidate_driver_id,
                tripId: payload.tripId,
                err
              });
            }
          }

          await client.query(
            `UPDATE match_attempts
             SET status = 'CANCELLED', updated_at = now()
             WHERE trip_id = $1 AND attempt = $2`,
            [payload.tripId, payload.matchAttempt]
          );
        }

        // Reply matching.attempt_cancelled via outbox
        const reply = createEnvelope({
          type: 'matching.attempt_cancelled',
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
          service: 'matching-service',
          instanceId,
          aggregateId: payload.tripId,
          matchAttempt: payload.matchAttempt,
          payload: {
            tripId: payload.tripId,
            matchAttempt: payload.matchAttempt,
            cancelled: true
          }
        });

        await insertOutbox(client, {
          exchange: 'ride.commands',
          routingKey: 'trip.replies',
          envelope: reply
        });
        return;
      }

      /* -------------------------------------------------------------- */
      /*  2. Handle matching.find_driver                                */
      /* -------------------------------------------------------------- */
      if (envelope.type === 'matching.find_driver') {
        const payload = findDriverSchema.parse(envelope.payload);

        // Check if tombstone exists
        const tombstone = await client.query(
          `SELECT status FROM match_attempts WHERE trip_id = $1 AND attempt = $2`,
          [payload.tripId, payload.matchAttempt]
        );

        if (
          tombstone.rowCount &&
          (tombstone.rows[0].status === 'CANCEL_REQUESTED' || tombstone.rows[0].status === 'CANCELLED')
        ) {
          logger.info({
            operation: 'FIND_DRIVER_ABORTED_BY_TOMBSTONE',
            tripId: payload.tripId,
            matchAttempt: payload.matchAttempt
          });

          const reply = createEnvelope({
            type: 'matching.attempt_cancelled',
            correlationId: envelope.correlationId,
            causationId: envelope.eventId,
            service: 'matching-service',
            instanceId,
            aggregateId: payload.tripId,
            matchAttempt: payload.matchAttempt,
            payload: {
              tripId: payload.tripId,
              matchAttempt: payload.matchAttempt,
              cancelled: true
            }
          });

          await insertOutbox(client, {
            exchange: 'ride.commands',
            routingKey: 'trip.replies',
            envelope: reply
          });
          return;
        }

        // Insert attempt row if not exists
        await client.query(
          `INSERT INTO match_attempts (trip_id, attempt, status, correlation_id, pickup_lat, pickup_lng, excluded_drivers)
           VALUES ($1, $2, 'PENDING', $3, $4, $5, $6)
           ON CONFLICT (trip_id, attempt) DO NOTHING`,
          [
            payload.tripId,
            payload.matchAttempt,
            envelope.correlationId,
            payload.pickup.lat,
            payload.pickup.lng,
            payload.excludedDrivers
          ]
        );

        // CAS claim with lease
        const claimToken = randomUUID();
        const claimRes = await client.query(
          `UPDATE match_attempts
           SET status = 'RUNNING',
               claim_token = $1,
               claimed_until = now() + interval '15 seconds',
               claimed_by = $2,
               updated_at = now()
           WHERE trip_id = $3 AND attempt = $4
             AND (status = 'PENDING' OR (status = 'RUNNING' AND claimed_until < now()))
           RETURNING *`,
          [claimToken, instanceId, payload.tripId, payload.matchAttempt]
        );

        if (!claimRes.rowCount) {
          logger.info({
            operation: 'MATCH_CLAIM_LOST',
            tripId: payload.tripId,
            matchAttempt: payload.matchAttempt
          });
          return;
        }

        logger.info({
          operation: 'MATCH_CLAIMED',
          tripId: payload.tripId,
          matchAttempt: payload.matchAttempt,
          claimedBy: instanceId
        });

        // Query available drivers from driver-service
        let availableDrivers: CandidateDriver[] = [];
        try {
          const res = await fetch(
            `${driverUrl}/internal/drivers/available?lat=${payload.pickup.lat}&lng=${payload.pickup.lng}&limit=10`,
            {
              headers: {
                'X-Internal-Token': internalToken,
                'X-Correlation-ID': envelope.correlationId
              },
              signal: AbortSignal.timeout(2000)
            }
          );
          if (res.ok) {
            const data = (await res.json()) as { drivers: CandidateDriver[] };
            availableDrivers = data.drivers ?? [];
          }
        } catch (err) {
          logger.warn({
            operation: 'FETCH_DRIVERS_FAILED',
            tripId: payload.tripId,
            err
          });
        }

        // Filter out excluded drivers
        const excludedSet = new Set(payload.excludedDrivers);
        const candidates = availableDrivers.filter(d => !excludedSet.has(d.id));

        if (candidates.length === 0) {
          // No drivers available
          await client.query(
            `UPDATE match_attempts
             SET status = 'FAILED', updated_at = now()
             WHERE trip_id = $1 AND attempt = $2 AND claim_token = $3`,
            [payload.tripId, payload.matchAttempt, claimToken]
          );

          const reply = createEnvelope({
            type: 'matching.no_driver',
            correlationId: envelope.correlationId,
            causationId: envelope.eventId,
            service: 'matching-service',
            instanceId,
            aggregateId: payload.tripId,
            matchAttempt: payload.matchAttempt,
            payload: {
              tripId: payload.tripId,
              matchAttempt: payload.matchAttempt,
              reason: 'NO_AVAILABLE_DRIVERS'
            }
          });

          await insertOutbox(client, {
            exchange: 'ride.commands',
            routingKey: 'trip.replies',
            envelope: reply
          });

          logger.info({
            operation: 'NO_DRIVER_FOUND',
            tripId: payload.tripId,
            matchAttempt: payload.matchAttempt
          });
          return;
        }

        // Try candidates sequentially
        let matched = false;
        for (const candidate of candidates) {
          const reservationId = randomUUID();

          // PERSIST BEFORE REST CALL
          const persistRes = await client.query(
            `UPDATE match_attempts
             SET candidate_driver_id = $1,
                 reservation_id = $2,
                 status = 'RESERVING',
                 updated_at = now()
             WHERE trip_id = $3 AND attempt = $4 AND claim_token = $5 AND status = 'RUNNING'
             RETURNING status`,
            [candidate.id, reservationId, payload.tripId, payload.matchAttempt, claimToken]
          );

          if (!persistRes.rowCount) {
            logger.warn({
              operation: 'RESERVE_PERSIST_ABORTED',
              tripId: payload.tripId,
              matchAttempt: payload.matchAttempt
            });
            break;
          }

          // Call driver-service atomic reserve REST
          let reserveOk = false;
          let reservationVersion = 1;

          try {
            const reserveRes = await fetch(
              `${driverUrl}/internal/drivers/${candidate.id}/reserve`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Internal-Token': internalToken,
                  'X-Correlation-ID': envelope.correlationId
                },
                body: JSON.stringify({
                  tripId: payload.tripId,
                  reservationId,
                  matchAttempt: payload.matchAttempt
                }),
                signal: AbortSignal.timeout(2000)
              }
            );

            if (reserveRes.ok) {
              const resJson = (await reserveRes.json()) as { reservationVersion?: number };
              reservationVersion = resJson.reservationVersion ?? 1;
              reserveOk = true;
            } else if (reserveRes.status === 409) {
              logger.info({
                operation: 'RESERVE_CONFLICT',
                driverId: candidate.id,
                tripId: payload.tripId
              });
            }
          } catch (err) {
            logger.warn({
              operation: 'RESERVE_REST_FAILED',
              driverId: candidate.id,
              tripId: payload.tripId,
              err
            });
          }

          if (reserveOk) {
            // Confirm reservation in match_attempts
            const finalizeRes = await client.query(
              `UPDATE match_attempts
               SET status = 'RESERVED', updated_at = now()
               WHERE trip_id = $1 AND attempt = $2 AND claim_token = $3 AND status = 'RESERVING'
               RETURNING *`,
              [payload.tripId, payload.matchAttempt, claimToken]
            );

            if (finalizeRes.rowCount === 1) {
              matched = true;

              logger.info({
                operation: 'DRIVER_RESERVED_SUCCESS',
                driverId: candidate.id,
                tripId: payload.tripId,
                reservationId,
                reservationVersion,
                matchAttempt: payload.matchAttempt
              });

              // Publish matching.driver_reserved to trip.replies
              const reply = createEnvelope({
                type: 'matching.driver_reserved',
                correlationId: envelope.correlationId,
                causationId: envelope.eventId,
                service: 'matching-service',
                instanceId,
                aggregateId: payload.tripId,
                matchAttempt: payload.matchAttempt,
                payload: {
                  tripId: payload.tripId,
                  driverId: candidate.id,
                  reservationId,
                  reservationVersion,
                  matchAttempt: payload.matchAttempt
                }
              });

              await insertOutbox(client, {
                exchange: 'ride.commands',
                routingKey: 'trip.replies',
                envelope: reply
              });
              break;
            } else {
              // Attempt was cancelled while REST call was in flight! Release driver immediately.
              logger.warn({
                operation: 'RESERVE_CANCELLED_IN_FLIGHT_RELEASING',
                driverId: candidate.id,
                tripId: payload.tripId
              });

              try {
                await fetch(`${driverUrl}/internal/drivers/${candidate.id}/release`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-Token': internalToken,
                    'X-Correlation-ID': envelope.correlationId
                  },
                  body: JSON.stringify({
                    tripId: payload.tripId,
                    reservationId
                  }),
                  signal: AbortSignal.timeout(2000)
                });
              } catch {}
              break;
            }
          } else {
            // Try next candidate: reset status back to RUNNING
            await client.query(
              `UPDATE match_attempts
               SET status = 'RUNNING', candidate_driver_id = NULL, reservation_id = NULL, updated_at = now()
               WHERE trip_id = $1 AND attempt = $2 AND claim_token = $3 AND status = 'RESERVING'`,
              [payload.tripId, payload.matchAttempt, claimToken]
            );
          }
        }

        if (!matched) {
          await client.query(
            `UPDATE match_attempts
             SET status = 'FAILED', updated_at = now()
             WHERE trip_id = $1 AND attempt = $2 AND claim_token = $3`,
            [payload.tripId, payload.matchAttempt, claimToken]
          );

          const reply = createEnvelope({
            type: 'matching.no_driver',
            correlationId: envelope.correlationId,
            causationId: envelope.eventId,
            service: 'matching-service',
            instanceId,
            aggregateId: payload.tripId,
            matchAttempt: payload.matchAttempt,
            payload: {
              tripId: payload.tripId,
              matchAttempt: payload.matchAttempt,
              reason: 'ALL_CANDIDATES_CONFLICT'
            }
          });

          await insertOutbox(client, {
            exchange: 'ride.commands',
            routingKey: 'trip.replies',
            envelope: reply
          });

          logger.info({
            operation: 'ALL_CANDIDATES_FAILED',
            tripId: payload.tripId,
            matchAttempt: payload.matchAttempt
          });
        }
      }
    }
  });
}

