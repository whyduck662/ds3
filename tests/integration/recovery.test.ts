import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type HTTPMethods } from 'fastify';
import { Pool } from 'pg';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../src/common/src/migrate.js';
import { createEnvelope, setupTopology } from '../../src/common/src/messaging.js';
import { consumePayments } from '../../src/services/payment-service/src/consumer.js';
import { consumeTripReplies } from '../../src/services/trip-service/src/consumer.js';
import { tripApp } from '../../src/services/trip-service/src/app.js';
import { driverApp } from '../../src/services/driver-service/src/app.js';
import { paymentApp } from '../../src/services/payment-service/src/app.js';
import { matchingApp } from '../../src/services/matching-service/src/app.js';
import { runMatchingRecovery } from '../../src/services/matching-service/src/jobs.js';
import { startDriverTtlJobs } from '../../src/services/driver-service/src/jobs.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'recovery-test-only-secret-with-32-characters';
process.env.INTERNAL_TOKEN = 'recovery-test-only-internal-token';
process.env.RABBITMQ_URL = 'amqp://tv1:local-test-only@127.0.0.1:5673';
const driver = new Pool({ connectionString: 'postgres://driver:local-test-only@127.0.0.1:55432/driver_test' });
const trip = new Pool({ connectionString: 'postgres://trip:local-test-only@127.0.0.1:55433/trip_test' });
const matching = new Pool({ connectionString: 'postgres://matching:local-test-only@127.0.0.1:55434/matching_test' });
const payment = new Pool({ connectionString: 'postgres://payment:local-test-only@127.0.0.1:55435/payment_test' });
let driverHttp: Awaited<ReturnType<typeof driverApp>>, tripHttp: Awaited<ReturnType<typeof tripApp>>;
let paymentHttp: Awaited<ReturnType<typeof paymentApp>>, matchingHttp: Awaited<ReturnType<typeof matchingApp>>;
const proxy = Fastify();
let releaseFailure = false, confirmLost = false;
let mq: Awaited<ReturnType<typeof amqp.connect>>, channel: amqp.ConfirmChannel;
let payments: ReturnType<typeof consumePayments>, trips: ReturnType<typeof consumeTripReplies>;
async function until(check: () => Promise<boolean>) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Recovery condition timed out');
}
async function publish(type: string, id: string, payload: Record<string, unknown>, replies = false) {
  const event = createEnvelope({ type, aggregateId: id, correlationId: id, service: 'recovery-test-fixture', payload });
  await new Promise<void>((resolve, reject) => channel.publish('ride.commands', replies ? 'trip.replies' : type,
    Buffer.from(JSON.stringify(event)), { persistent: true }, error => error ? reject(error) : resolve()));
  const pool = replies ? trip : payment;
  await until(async () => !!(await pool.query('SELECT 1 FROM processed_messages WHERE event_id=$1', [event.eventId])).rowCount);
  return event;
}
async function tripFixture(status = 'COMPLETED', driverId: string | null = null, reservationId: string | null = null) {
  const id = randomUUID();
  await trip.query(`INSERT INTO trips (id,passenger_id,driver_id,reservation_id,reservation_version,pickup_lat,pickup_lng,
    dropoff_lat,dropoff_lng,quoted_fare,status,payment_status,correlation_id,match_attempt)
    VALUES ($1,$2,$3,$4,1,10,106,11,107,12000,$5,'AUTHORIZED',$1,1)`, [id, randomUUID(), driverId, reservationId, status]);
  return id;
}
beforeAll(async () => {
  for (const [name, pool] of [['driver', driver], ['trip', trip], ['matching', matching], ['payment', payment]] as const) {
    expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(`${name}_test`);
    await migrate(pool, new URL(`../../src/services/${name}-service/migrations/`, import.meta.url));
  }
  driverHttp = await driverApp(driver); tripHttp = await tripApp(trip);
  paymentHttp = await paymentApp(payment); matchingHttp = await matchingApp(matching);
  proxy.all('/*', async (request, reply) => {
    if (request.url.endsWith('/release') && releaseFailure) return reply.code(503).send({ code: 'TEST_DRIVER_DOWN' });
    const result = await driverHttp.inject({ method: request.method as HTTPMethods, url: request.url,
      headers: { 'x-internal-token': process.env.INTERNAL_TOKEN }, payload: request.body as Record<string, unknown> });
    if (request.url.endsWith('/confirm') && confirmLost && result.statusCode === 200) return reply.code(503).send({ code: 'RESPONSE_LOST_AFTER_COMMIT' });
    return reply.code(result.statusCode).send(result.json());
  });
  process.env.DRIVER_URL = process.env.DRIVER_SERVICE_URL = await proxy.listen({ host: '127.0.0.1', port: 0 });
  mq = await amqp.connect(process.env.RABBITMQ_URL!); channel = await mq.createConfirmChannel();
  await setupTopology(channel);
  payments = consumePayments(payment, paymentHttp.log); trips = consumeTripReplies(trip, tripHttp.log);
  await until(async () => (await channel.checkQueue('payment.commands')).consumerCount > 0 && (await channel.checkQueue('trip.replies')).consumerCount > 0);
});
beforeEach(async () => {
  releaseFailure = confirmLost = false;
  // Dedicated _test DBs only. Other services' production databases are never touched.
  await matching.query('TRUNCATE match_attempts,outbox,processed_messages');
  await driver.query('TRUNCATE drivers,outbox,processed_messages');
});
afterAll(async () => {
  await payments?.close(); await trips?.close(); await channel?.close(); await mq?.close();
  await proxy.close();
  for (const app of [driverHttp, tripHttp, paymentHttp, matchingHttp]) await app?.close();
  await Promise.all([driver.end(), trip.end(), matching.end(), payment.end()]);
});
describe.sequential('Distributed recovery regressions — real DB/MQ', () => {
  it.each([
    ['AVAILABLE', 'RESERVED'], ['OFFLINE', 'RESERVED'],
    ['AVAILABLE', 'ON_TRIP'], ['OFFLINE', 'ON_TRIP']
  ])('status %s cannot overwrite a concurrent %s reservation', async (requested, busyState) => {
    const driverId = randomUUID(), firstTrip = randomUUID(), reservationId = randomUUID();
    await driver.query("INSERT INTO drivers(id,status,last_seen_at) VALUES ($1,'AVAILABLE',now())", [driverId]);
    let interleaved = false;
    const interceptedPool = {
      query: async (sql: string, params?: unknown[]) => {
        const result = await driver.query(sql, params);
        if (!interleaved && sql.includes('SELECT id, status, current_trip_id, reservation_id')) {
          interleaved = true;
          // Reserve (and optionally confirm) after the status request read AVAILABLE
          // but before its UPSERT: the exact failing schedule from the audit.
          const reserved = await driverHttp.inject({ method: 'POST', url: `/internal/drivers/${driverId}/reserve`,
            headers: { 'x-internal-token': process.env.INTERNAL_TOKEN },
            payload: { tripId: firstTrip, reservationId, matchAttempt: 1 } });
          expect(reserved.statusCode).toBe(200);
          if (busyState === 'ON_TRIP') {
            const confirmed = await driverHttp.inject({ method: 'POST', url: `/internal/drivers/${driverId}/confirm`,
              headers: { 'x-internal-token': process.env.INTERNAL_TOKEN },
              payload: { tripId: firstTrip, reservationId, reservationVersion: reserved.json().reservationVersion } });
            expect(confirmed.statusCode).toBe(200);
          }
        }
        return result;
      }
    } as unknown as Pool;
    const statusHttp = await driverApp(interceptedPool);
    try {
      const token = statusHttp.jwt.sign({ userId: driverId, role: 'DRIVER' });
      const updated = await statusHttp.inject({ method: 'PUT', url: '/drivers/me/status',
        headers: { authorization: `Bearer ${token}` }, payload: { status: requested } });
      expect(interleaved).toBe(true);
      expect(updated.statusCode).toBe(409);
      expect(updated.json().code).toBe('INVALID_STATE_TRANSITION');
      const second = await driverHttp.inject({ method: 'POST', url: `/internal/drivers/${driverId}/reserve`,
        headers: { 'x-internal-token': process.env.INTERNAL_TOKEN },
        payload: { tripId: randomUUID(), reservationId: randomUUID(), matchAttempt: 1 } });
      expect(second.statusCode).toBe(409);
      expect((await driver.query('SELECT status,current_trip_id,reservation_id,reservation_version FROM drivers WHERE id=$1', [driverId])).rows[0])
        .toEqual({ status: busyState, current_trip_id: firstTrip, reservation_id: reservationId, reservation_version: 1 });
    } finally { await statusHttp.close(); }
  });
  it('capture before authorize or after void never emits a successful capture', async () => {
    for (const voidFirst of [false, true]) {
      const id = randomUUID();
      if (voidFirst) await publish('payment.void', id, { tripId: id });
      await publish('payment.capture', id, { tripId: id, amount: 12000 });
      expect((await payment.query("SELECT 1 FROM outbox WHERE envelope->>'aggregateId'=$1 AND envelope->>'type'='payment.captured'", [id])).rowCount).toBe(0);
      expect((await payment.query("SELECT 1 FROM outbox WHERE envelope->>'aggregateId'=$1 AND envelope->>'type'='payment.capture_rejected'", [id])).rowCount).toBe(1);
    }
  });
  it('a captured event with wrong status or amount cannot make Trip PAID', async () => {
    const id = await tripFixture();
    await publish('payment.captured', id, { tripId: id, status: 'VOIDED', amount: 12000 }, true);
    await publish('payment.captured', id, { tripId: id, status: 'CAPTURED', amount: 1 }, true);
    expect((await trip.query('SELECT status FROM trips WHERE id=$1', [id])).rows[0].status).toBe('COMPLETED');
    await publish('payment.captured', id, { tripId: id, status: 'CAPTURED', amount: 12000 }, true);
    expect((await trip.query('SELECT status FROM trips WHERE id=$1', [id])).rows[0].status).toBe('PAID');
  });
  it('rejects mismatched capture amount and cannot void a CAPTURED payment', async () => {
    const id = randomUUID();
    await publish('payment.authorize', id, { tripId: id, passengerId: randomUUID(), amount: 12000 });
    await publish('payment.capture', id, { tripId: id, amount: 1 });
    expect((await payment.query('SELECT status FROM payments WHERE trip_id=$1', [id])).rows[0].status).toBe('AUTHORIZED');
    await publish('payment.capture', id, { tripId: id, amount: 12000 });
    await publish('payment.void', id, { tripId: id });
    expect((await payment.query('SELECT status FROM payments WHERE trip_id=$1', [id])).rows[0].status).toBe('CAPTURED');
    expect((await payment.query("SELECT 1 FROM outbox WHERE envelope->>'aggregateId'=$1 AND envelope->>'type'='payment.voided'", [id])).rowCount).toBe(0);
  });
  it('cancellation does not ACK on release 503, then recovers and releases Driver', async () => {
    const id = randomUUID(), driverId = randomUUID(), reservationId = randomUUID();
    await driver.query("INSERT INTO drivers(id,status,current_trip_id,reservation_id,reservation_version,reserved_until,last_seen_at) VALUES ($1,'RESERVED',$2,$3,1,now()+interval '30 seconds',now())", [driverId,id,reservationId]);
    await matching.query("INSERT INTO match_attempts(trip_id,attempt,status,correlation_id,candidate_driver_id,reservation_id) VALUES ($1,1,'CANCEL_REQUESTED',$1,$2,$3)", [id,driverId,reservationId]);
    releaseFailure = true; await runMatchingRecovery(matching);
    expect((await matching.query('SELECT status FROM match_attempts WHERE trip_id=$1', [id])).rows[0].status).toBe('CANCEL_REQUESTED');
    expect((await matching.query("SELECT 1 FROM outbox WHERE envelope->>'type'='matching.attempt_cancelled'")).rowCount).toBe(0);
    releaseFailure = false;
    await matching.query("UPDATE match_attempts SET claimed_until=now()-interval '1 second' WHERE trip_id=$1", [id]);
    await runMatchingRecovery(matching);
    expect((await matching.query('SELECT status FROM match_attempts WHERE trip_id=$1', [id])).rows[0].status).toBe('CANCELLED');
    expect((await driver.query('SELECT current_trip_id FROM drivers WHERE id=$1', [driverId])).rows[0].current_trip_id).toBeNull();
    expect((await matching.query("SELECT 1 FROM outbox WHERE envelope->>'type'='matching.attempt_cancelled'")).rowCount).toBe(1);
  });
  it('recovers expired RESERVING work using the persisted reservation and emits a reply', async () => {
    const id = randomUUID(), driverId = randomUUID(), reservationId = randomUUID();
    await driver.query("INSERT INTO drivers(id,status,current_trip_id,reservation_id,reservation_version,reserved_until,last_seen_at) VALUES ($1,'RESERVED',$2,$3,1,now()+interval '30 seconds',now())", [driverId,id,reservationId]);
    await matching.query("INSERT INTO match_attempts(trip_id,attempt,status,correlation_id,candidate_driver_id,reservation_id,claimed_until) VALUES ($1,1,'RESERVING',$1,$2,$3,now()-interval '1 second')", [id,driverId,reservationId]);
    await runMatchingRecovery(matching);
    expect((await matching.query('SELECT status,reservation_id FROM match_attempts WHERE trip_id=$1', [id])).rows[0]).toEqual({ status: 'RESERVED', reservation_id: reservationId });
    expect((await matching.query("SELECT envelope->'payload'->>'reservationId' AS id FROM outbox WHERE envelope->>'type'='matching.driver_reserved'")).rows[0].id).toBe(reservationId);
  });
  it('resumes persisted PENDING work after restart rather than only resetting its state', async () => {
    const id = randomUUID(), driverId = randomUUID();
    await driver.query("INSERT INTO drivers(id,status,latitude,longitude,last_seen_at) VALUES ($1,'AVAILABLE',10,106,now())", [driverId]);
    await matching.query("INSERT INTO match_attempts(trip_id,attempt,status,correlation_id,pickup_lat,pickup_lng) VALUES ($1,1,'PENDING',$1,10,106)", [id]);
    await runMatchingRecovery(matching);
    expect((await matching.query('SELECT status FROM match_attempts WHERE trip_id=$1', [id])).rows[0].status).toBe('RESERVED');
  });
  it('retains reservation identity and compensates when confirm response is lost after Driver commit', async () => {
    const driverId = randomUUID(), reservationId = randomUUID();
    const id = await tripFixture('DRIVER_ASSIGNED', driverId, reservationId);
    await driver.query("INSERT INTO drivers(id,status,current_trip_id,reservation_id,reservation_version,reserved_until,last_seen_at) VALUES ($1,'RESERVED',$2,$3,1,now()+interval '30 seconds',now())", [driverId,id,reservationId]);
    confirmLost = true;
    const token = tripHttp.jwt.sign({ userId: driverId, role: 'DRIVER' });
    const response = await tripHttp.inject({ method: 'POST', url: `/trips/${id}/accept`, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(response.statusCode).toBe(409);
    const result = (await trip.query('SELECT status,driver_id,reservation_id FROM trips WHERE id=$1', [id])).rows[0];
    expect(result).toEqual({ status: 'COMPENSATING', driver_id: driverId, reservation_id: reservationId });
    expect((await driver.query('SELECT status FROM drivers WHERE id=$1', [driverId])).rows[0].status).toBe('ON_TRIP');
    await until(async () => !!(await trip.query("SELECT 1 FROM outbox WHERE envelope->>'aggregateId'=$1 AND routing_key='driver.release'", [id])).rowCount);
  });
  it('internal endpoints fail closed for missing/wrong token and missing server configuration', async () => {
    const id = randomUUID();
    for (const [app, url] of [[driverHttp, '/internal/drivers/available'], [paymentHttp, `/internal/payments/${id}/status`], [matchingHttp, `/internal/matching/${id}/1`]] as const) {
      expect((await app.inject(url)).statusCode).toBe(403);
      expect((await app.inject({ url, headers: { 'x-internal-token': 'wrong' } })).statusCode).toBe(403);
      const saved = process.env.INTERNAL_TOKEN; delete process.env.INTERNAL_TOKEN;
      try { expect((await app.inject(url)).statusCode).toBe(503); }
      finally { process.env.INTERNAL_TOKEN = saved; }
    }
  });
  it('reservation expiry preserves old trip/reservation IDs in its durable event', async () => {
    const id = randomUUID(), driverId = randomUUID(), reservationId = randomUUID();
    await driver.query("INSERT INTO drivers(id,status,current_trip_id,reservation_id,reservation_version,reserved_until,last_seen_at) VALUES ($1,'RESERVED',$2,$3,1,now()-interval '1 second',now())", [driverId,id,reservationId]);
    const jobs = startDriverTtlJobs(driver);
    try { await jobs.runExpiry(); } finally { jobs.stop(); }
    const result = await driver.query("SELECT envelope FROM outbox WHERE envelope->>'type'='driver.reservation_expired'");
    expect(result.rowCount).toBe(1);
    expect(result.rows[0].envelope.payload).toMatchObject({ tripId: id, reservationId });
    expect((await driver.query('SELECT current_trip_id FROM drivers WHERE id=$1', [driverId])).rows[0].current_trip_id).toBeNull();
  });
});
