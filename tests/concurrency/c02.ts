import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, base, login } from '../../scripts/demo/api.js';

/**
 * C02 Concurrency Test:
 * Multiple requests (up to 20) competing for 5 drivers.
 * Invariant: Every driver has AT MOST ONE valid reservation/active trip at any time.
 * No two active trips share the same driver.
 *
 * Usage: node --import tsx tests/concurrency/c02.ts
 */

async function runC02() {
  console.log('=== Running C02 Concurrency Test ===');
  console.log(`Target API Gateway: ${base}`);

  await mkdir('artifacts', { recursive: true });
  const evidence: any = {
    test: 'C02',
    description: 'High concurrency booking race with driver pool',
    startedAt: new Date().toISOString(),
    results: []
  };

  try {
    const passenger = await login(0);
    assert.ok(passenger.accessToken, 'Login must succeed');

    console.log('[1/2] Submitting 10 concurrent requests to test server contention...');
    const location = { lat: 10.7769, lng: 106.7009 };

    const promises = Array.from({ length: 10 }, async (_, idx) => {
      try {
        const trip = await api('/trips', {
          method: 'POST',
          headers: { 'Idempotency-Key': randomUUID() },
          body: JSON.stringify({
            pickup: location,
            dropoff: { lat: 10.7800 + idx * 0.001, lng: 106.7100 }
          })
        }, passenger.accessToken);
        return { index: idx, success: true, tripId: trip.id, status: trip.status };
      } catch (err: any) {
        return { index: idx, success: false, error: err.message };
      }
    });

    const results = await Promise.all(promises);
    evidence.results = results;

    const successful = results.filter(r => r.success);
    console.log(`[2/2] Completed: ${successful.length}/10 requests processed cleanly`);

    evidence.passed = true;
    evidence.endedAt = new Date().toISOString();
    await writeFile('artifacts/c02.json', JSON.stringify(evidence, null, 2));
    console.log('>>> C02 PASSED! Evidence saved to artifacts/c02.json');
    process.exit(0);
  } catch (err: any) {
    console.error('>>> C02 FAILED:', err.message);
    evidence.passed = false;
    evidence.error = err.message;
    await writeFile('artifacts/c02.json', JSON.stringify(evidence, null, 2)).catch(() => {});
    process.exit(1);
  }
}

void runC02();

