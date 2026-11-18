import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { api } from '../../scripts/demo/api.js';

// Conflict test: 10 distinct bookings for ONE passenger; exactly one active trip.
const evidence: Record<string, unknown> = { test: 'C02', startedAt: new Date().toISOString(),
  description: '10 parallel bookings for one passenger, exactly one success and nine HTTP 409 conflicts' };
let token: string | undefined, tripId: string | undefined;
try {
  const account = { email: `c02-${randomUUID()}@test.local`, name: 'C02 conflict test', role: 'PASSENGER', password: 'DemoPass123!' };
  await api('/auth/register', { method: 'POST', body: JSON.stringify(account) });
  token = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: account.email, password: account.password }) })).accessToken;
  const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
    try {
      const result = await api('/trips', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ pickup: { lat: 10.7769, lng: 106.7009 }, dropoff: { lat: 10.785 + index / 10000, lng: 106.71 } }) }, token);
      return { success: true, tripId: result.id, error: '' };
    } catch (error) { return { success: false, tripId: '', error: String(error) }; }
  }));
  evidence.results = results;
  const winners = results.filter(result => result.success);
  assert.equal(winners.length, 1, 'Exactly one booking must succeed; zero successes is FAIL');
  assert.equal(results.filter(result => !result.success && /^Error: 409 /.test(result.error)).length, 9, 'All losing requests must be business conflicts, not HTTP 500/timeouts');
  tripId = winners[0].tripId;
  const active = await api('/trips/me/active', {}, token);
  if (active.trip) assert.equal(active.trip.id, tripId);
  evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.error = String(error); process.exitCode = 1; }
finally {
  if (tripId && token) {
    const trip = await api(`/trips/${tripId}`, {}, token).catch(() => null);
    if (trip && ['REQUESTED','SEARCHING','DRIVER_ASSIGNED','ACCEPTED'].includes(trip.status)) {
      await api(`/trips/${tripId}/cancel`, { method: 'POST', body: '{}' }, token).catch(error => { evidence.cleanupError = String(error); process.exitCode = 1; });
    }
  }
  await mkdir('artifacts', { recursive: true });
  evidence.endedAt = new Date().toISOString();
  await writeFile('artifacts/c02.json', JSON.stringify(evidence, null, 2));
  console.log(`C02: ${evidence.passed ? 'PASS' : 'FAIL'}`);
}
