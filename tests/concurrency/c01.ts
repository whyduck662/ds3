import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, base, login } from '../../scripts/demo/api.js';

/**
 * C01 Concurrency Test:
 * 2 Passengers simultaneously request a ride with only 1 Driver available.
 * Expected outcome:
 * - Exactly ONE trip wins the driver reservation (DRIVER_ASSIGNED / ACCEPTED).
 * - The other trip fails matching (NO_DRIVER or enters COMPENSATING/CANCELLED).
 * - Invariant I01 & I02 hold: Driver has AT MOST ONE active reservation/trip.
 *
 * Usage: node --import tsx tests/concurrency/c01.ts
 */

async function waitFor(path: string, token: string, predicate: (val: any) => boolean, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const res = await api(path, {}, token);
      if (predicate(res)) return res;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Timeout waiting for predicate on ${path}`);
}

async function runC01() {
  console.log('=== Running C01 Concurrency Test ===');
  console.log(`Target API Gateway: ${base}`);

  await mkdir('artifacts', { recursive: true });
  const evidence: any = {
    test: 'C01',
    description: '2 Passengers concurrent booking with 1 Driver',
    startedAt: new Date().toISOString(),
    steps: []
  };

  try {
    // 1. Log in users
    console.log('[1/5] Logging in Passenger 1, Passenger 2, and Driver...');
    const p1 = await login(0);
    const p2 = await login(1);
    const driver = await login(2);

    evidence.steps.push({ step: 'LOGIN_OK', p1Id: p1.user.userId, p2Id: p2.user.userId, driverId: driver.user.userId });

    // 2. Setup driver: ONLINE and AVAILABLE at designated location
    console.log('[2/5] Setting driver location and status to AVAILABLE...');
    const loc = { lat: 10.7769, lng: 106.7009 };
    await api('/drivers/me/location', { method: 'PUT', body: JSON.stringify(loc) }, driver.accessToken);
    await api('/drivers/me/status', { method: 'PUT', body: JSON.stringify({ status: 'AVAILABLE' }) }, driver.accessToken);

    const driverStatus = await api('/drivers/me', {}, driver.accessToken);
    assert.equal(driverStatus.status, 'AVAILABLE', 'Driver must be AVAILABLE before test');

    // 3. Concurrently submit 2 trip bookings
    console.log('[3/5] Firing 2 concurrent trip requests for same driver location...');
    const tripPayload = {
      pickup: loc,
      dropoff: { lat: 10.7850, lng: 106.7100 }
    };

    const [trip1, trip2] = await Promise.all([
      api('/trips', {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify(tripPayload)
      }, p1.accessToken),
      api('/trips', {
        method: 'POST',
        headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify(tripPayload)
      }, p2.accessToken)
    ]);

    assert.ok(trip1.id, 'Trip 1 must return an id');
    assert.ok(trip2.id, 'Trip 2 must return an id');
    assert.notEqual(trip1.id, trip2.id, 'Trip 1 and Trip 2 must be different trips');

    console.log(`Trip 1 ID: ${trip1.id}`);
    console.log(`Trip 2 ID: ${trip2.id}`);
    evidence.steps.push({
      step: 'TRIPS_CREATED',
      trip1: { id: trip1.id, correlationId: trip1.correlationId },
      trip2: { id: trip2.id, correlationId: trip2.correlationId }
    });

    // 4. Wait for matching resolution on both trips
    console.log('[4/5] Waiting for matching resolution on both trips...');
    const deadline = Date.now() + 20000;
    let t1Final: any = null;
    let t2Final: any = null;

    while (Date.now() < deadline) {
      t1Final = await api(`/trips/${trip1.id}`, {}, p1.accessToken);
      t2Final = await api(`/trips/${trip2.id}`, {}, p2.accessToken);

      const t1Resolved = ['DRIVER_ASSIGNED', 'ACCEPTED', 'CANCELLED', 'FAILED'].includes(t1Final.status);
      const t2Resolved = ['DRIVER_ASSIGNED', 'ACCEPTED', 'CANCELLED', 'FAILED'].includes(t2Final.status);

      if (t1Resolved && t2Resolved) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`Trip 1 final status: ${t1Final?.status}`);
    console.log(`Trip 2 final status: ${t2Final?.status}`);
    evidence.steps.push({
      step: 'TRIPS_RESOLVED',
      trip1Status: t1Final?.status,
      trip2Status: t2Final?.status
    });

    // 5. Verify invariant
    console.log('[5/5] Checking Invariants I01 & I02...');
    const t1Won = ['DRIVER_ASSIGNED', 'ACCEPTED'].includes(t1Final?.status);
    const t2Won = ['DRIVER_ASSIGNED', 'ACCEPTED'].includes(t2Final?.status);

    assert.ok(
      (t1Won && !t2Won) || (!t1Won && t2Won),
      `INVARIANT VIOLATION: Exactly one trip must win driver. Got trip1=${t1Final?.status}, trip2=${t2Final?.status}`
    );

    evidence.passed = true;
    evidence.winner = t1Won ? trip1.id : trip2.id;
    evidence.endedAt = new Date().toISOString();

    await writeFile('artifacts/c01.json', JSON.stringify(evidence, null, 2));
    console.log('>>> C01 PASSED! Evidence saved to artifacts/c01.json');
    process.exit(0);
  } catch (err: any) {
    console.error('>>> C01 FAILED:', err.message);
    evidence.passed = false;
    evidence.error = err.message;
    evidence.endedAt = new Date().toISOString();
    await writeFile('artifacts/c01.json', JSON.stringify(evidence, null, 2)).catch(() => {});
    process.exit(1);
  }
}

void runC01();

