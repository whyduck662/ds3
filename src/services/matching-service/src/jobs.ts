import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

export function startMatchingLeaseRecoveryJob(pool: Pool, logger?: FastifyBaseLogger) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const driverUrl = process.env.DRIVER_SERVICE_URL ?? 'http://driver-service:8082';
  const internalToken = process.env.INTERNAL_TOKEN ?? '';

  const recoverLeases = async () => {
    if (stopped) return;
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Recover stale RUNNING attempts -> reset to PENDING
        const runningRes = await client.query(
          `UPDATE match_attempts
           SET status = 'PENDING',
               claim_token = NULL,
               claimed_until = NULL,
               claimed_by = NULL,
               updated_at = now()
           WHERE status = 'RUNNING' AND claimed_until < now()
           RETURNING trip_id AS "tripId", attempt`
        );

        for (const row of runningRes.rows) {
          logger?.info({
            operation: 'LEASE_RECOVERED_RUNNING',
            tripId: row.tripId,
            attempt: row.attempt
          });
        }

        // 2. Inspect stale RESERVING attempts
        const reservingRes = await client.query(
          `SELECT trip_id AS "tripId", attempt, candidate_driver_id AS "driverId",
                  reservation_id AS "reservationId", correlation_id AS "correlationId"
           FROM match_attempts
           WHERE status = 'RESERVING' AND claimed_until < now()
           FOR UPDATE SKIP LOCKED`
        );

        for (const row of reservingRes.rows) {
          if (row.driverId && row.reservationId) {
            try {
              const checkRes = await fetch(
                `${driverUrl}/internal/drivers/${row.driverId}/reservation/${row.reservationId}`,
                {
                  headers: {
                    'X-Internal-Token': internalToken,
                    'X-Correlation-ID': row.correlationId ?? ''
                  },
                  signal: AbortSignal.timeout(2000)
                }
              );

              if (checkRes.ok) {
                const checkData = (await checkRes.json()) as { isMatching?: boolean; status?: string };
                if (checkData.isMatching && checkData.status === 'RESERVED') {
                  // Finalize as RESERVED
                  await client.query(
                    `UPDATE match_attempts
                     SET status = 'RESERVED', updated_at = now()
                     WHERE trip_id = $1 AND attempt = $2`,
                    [row.tripId, row.attempt]
                  );
                  logger?.info({
                    operation: 'LEASE_RECOVERED_RESERVED',
                    tripId: row.tripId,
                    attempt: row.attempt
                  });
                } else {
                  // Driver was not reserved, reset to PENDING
                  await client.query(
                    `UPDATE match_attempts
                     SET status = 'PENDING', candidate_driver_id = NULL, reservation_id = NULL,
                         claim_token = NULL, claimed_until = NULL, updated_at = now()
                     WHERE trip_id = $1 AND attempt = $2`,
                    [row.tripId, row.attempt]
                  );
                }
              }
            } catch (fetchErr) {
              logger?.warn({
                operation: 'LEASE_RECOVERY_DRIVER_CHECK_FAILED',
                tripId: row.tripId,
                attempt: row.attempt,
                err: fetchErr
              });
            }
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger?.warn({ operation: 'LEASE_RECOVERY_TX_ERR', err });
      } finally {
        client.release();
      }
    } catch (err) {
      logger?.warn({ operation: 'LEASE_RECOVERY_CONN_ERR', err });
    }
  };

  timer = setInterval(() => void recoverLeases(), 5000);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
}

