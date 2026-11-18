import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { createEnvelope, insertOutbox } from '../../../common/src/messaging.js';

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// Durable worker: all claims/candidate IDs commit before HTTP; replay keeps the same reservation ID.
export async function runMatchingRecovery(pool: Pool, logger?: FastifyBaseLogger) {
  const url = process.env.DRIVER_SERVICE_URL ?? 'http://driver-service:8082';
  const token = process.env.INTERNAL_TOKEN;
  if (!token || token.length < 16) throw new Error('INTERNAL_TOKEN is required for Matching');
  const claim = randomUUID();
  const row = await transaction(pool, async client => {
    const result = await client.query(`SELECT * FROM match_attempts
      WHERE (status IN ('PENDING','CANCEL_REQUESTED') OR status IN ('RUNNING','RESERVING') AND claimed_until < now())
        AND (claimed_until IS NULL OR claimed_until < now())
      ORDER BY CASE WHEN status='CANCEL_REQUESTED' THEN 0 ELSE 1 END, updated_at
      FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!result.rows[0]) return null;
    const current = result.rows[0];
    await client.query(`UPDATE match_attempts SET claim_token=$3, claimed_by=$4,
      claimed_until=now()+interval '15 seconds',
      status=CASE WHEN status='PENDING' THEN 'RUNNING' ELSE status END WHERE trip_id=$1 AND attempt=$2`,
    [current.trip_id, current.attempt, claim, process.env.INSTANCE_ID ?? 'matching-worker']);
    return current;
  });
  if (!row) return false;
  const headers = { 'Content-Type': 'application/json', 'X-Internal-Token': token, 'X-Correlation-ID': row.correlation_id };
  const request = async (path: string, body?: Record<string, unknown>) => fetch(url + path, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(2000)
  });
  const reply = async (client: PoolClient, type: string, payload: Record<string, unknown>) => insertOutbox(client, {
    exchange: 'ride.commands', routingKey: 'trip.replies', envelope: createEnvelope({ type,
      service: 'matching-service', aggregateId: row.trip_id, correlationId: row.correlation_id,
      matchAttempt: row.attempt, payload: { tripId: row.trip_id, matchAttempt: row.attempt, ...payload } })
  });
  try {
    if (row.status === 'CANCEL_REQUESTED') {
      if (row.candidate_driver_id && row.reservation_id) {
        const released = await request(`/internal/drivers/${row.candidate_driver_id}/release`, {
          tripId: row.trip_id, reservationId: row.reservation_id });
        // 404 proves no such driver; every technical failure keeps cancellation pending.
        if (!released.ok && released.status !== 404) throw new Error(`Driver release ${released.status}`);
        if (released.ok) {
          const result = await released.json() as { status: string };
          if (!['RELEASED', 'STALE_RELEASE'].includes(result.status)) throw new Error('Unconfirmed Driver release');
        }
      }
      await transaction(pool, async client => {
        const result = await client.query(`UPDATE match_attempts SET status='CANCELLED',claimed_until=NULL,updated_at=now()
          WHERE trip_id=$1 AND attempt=$2 AND claim_token=$3 AND status='CANCEL_REQUESTED' RETURNING 1`, [row.trip_id, row.attempt, claim]);
        if (result.rowCount) await reply(client, 'matching.attempt_cancelled', { cancelled: true });
      });
      return true;
    }

    let candidates: { id: string }[];
    if (row.candidate_driver_id && row.reservation_id) candidates = [{ id: row.candidate_driver_id }];
    else {
      const response = await request(`/internal/drivers/available?lat=${row.pickup_lat}&lng=${row.pickup_lng}&limit=50`);
      if (!response.ok) throw new Error(`Driver discovery ${response.status}`);
      const available = await response.json() as { drivers: { id: string }[] };
      candidates = available.drivers.filter(driver => !row.excluded_drivers.includes(driver.id));
    }
    for (const candidate of candidates) {
      const reservationId = row.reservation_id ?? randomUUID();
      const persisted = await pool.query(`UPDATE match_attempts SET status='RESERVING',candidate_driver_id=$4,reservation_id=$5,
        updated_at=now() WHERE trip_id=$1 AND attempt=$2 AND claim_token=$3 AND status IN ('RUNNING','RESERVING') RETURNING 1`,
      [row.trip_id, row.attempt, claim, candidate.id, reservationId]);
      if (!persisted.rowCount) return true; // cancellation wins; its worker will release the persisted candidate
      const reserved = await request(`/internal/drivers/${candidate.id}/reserve`, {
        tripId: row.trip_id, reservationId, matchAttempt: row.attempt });
      if (reserved.ok) {
        const result = await reserved.json() as { reservationVersion: number };
        await transaction(pool, async client => {
          const saved = await client.query(`UPDATE match_attempts SET status='RESERVED',claimed_until=NULL,updated_at=now()
            WHERE trip_id=$1 AND attempt=$2 AND claim_token=$3 AND status='RESERVING' RETURNING 1`, [row.trip_id, row.attempt, claim]);
          if (saved.rowCount) await reply(client, 'matching.driver_reserved', {
            driverId: candidate.id, reservationId, reservationVersion: result.reservationVersion });
          // If cancellation raced with REST, leave candidate persisted for its release worker.
        });
        return true;
      }
      if (reserved.status !== 409) throw new Error(`Driver reserve ${reserved.status}`);
      await pool.query(`UPDATE match_attempts SET status='RUNNING',candidate_driver_id=NULL,reservation_id=NULL
        WHERE trip_id=$1 AND attempt=$2 AND claim_token=$3 AND status='RESERVING'`, [row.trip_id, row.attempt, claim]);
      row.reservation_id = null;
    }
    await transaction(pool, async client => {
      const result = await client.query(`UPDATE match_attempts SET status='FAILED',claimed_until=NULL,updated_at=now()
        WHERE trip_id=$1 AND attempt=$2 AND claim_token=$3 AND status='RUNNING' RETURNING 1`, [row.trip_id, row.attempt, claim]);
      if (result.rowCount) await reply(client, 'matching.no_driver', { reason: 'NO_AVAILABLE_DRIVERS' });
    });
  } catch (error) {
    // Keep RESERVING and its reservation ID after ambiguous HTTP outcomes.
    await pool.query(`UPDATE match_attempts SET claimed_until=now()+interval '2 seconds',updated_at=now()
      WHERE trip_id=$1 AND attempt=$2 AND claim_token=$3`, [row.trip_id, row.attempt, claim]);
    logger?.warn({ operation: 'MATCHING_RETRY', tripId: row.trip_id, err: error });
  }
  return true;
}

export function startMatchingLeaseRecoveryJob(pool: Pool, logger?: FastifyBaseLogger) {
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { for (let count = 0; count < 10 && !stopped; count++) if (!await runMatchingRecovery(pool, logger)) break; }
    catch (error) { logger?.warn({ operation: 'MATCHING_WORKER_ERROR', err: error }); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 500);
  return { stop: () => { stopped = true; clearInterval(timer); }, runOnce: tick };
}
