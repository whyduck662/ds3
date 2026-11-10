import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, login } from './api.js';
const scenario = process.argv[2] ?? 'E01';
if (!['E01','E02','E03'].includes(scenario)) throw new Error('Dung E01 (happy path), E02 (cancel), E03 (capture recovery)');
const evidence: unknown[] = [];
async function waitFor(path: string, token: string, predicate: (value: any) => boolean, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await api(path, {}, token);
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timeout: ${path}`);
}
try {
  const passenger = await login(0), driver = await login(2);
  await api('/drivers/me/location', { method: 'PUT', body: JSON.stringify({ lat: 10.7769, lng: 106.7009 }) }, driver.accessToken);
  await api('/drivers/me/status', { method: 'PUT', body: JSON.stringify({ status: 'AVAILABLE' }) }, driver.accessToken);
  const heartbeat = setInterval(() => { void api('/drivers/me/status', { method: 'PUT', body: JSON.stringify({ status: 'AVAILABLE' }) }, driver.accessToken).catch(() => undefined); }, 5000);
  heartbeat.unref();
  try {
    const trip = await api('/trips', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ pickup: { lat: 10.7769, lng: 106.7009 }, dropoff: { lat: 10.782, lng: 106.71 } }) }, passenger.accessToken);
    const id = trip.id ?? trip.tripId;
    assert.ok(id, 'POST /trips phai tra id/tripId');
    evidence.push({ tripId: id, correlationId: trip.correlationId });
    if (scenario === 'E02') {
      await api(`/trips/${id}/cancel`, { method: 'POST', body: '{}' }, passenger.accessToken);
      await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'CANCELLED');
    } else {
      await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'DRIVER_ASSIGNED');
      for (const action of ['accept','start']) await api(`/trips/${id}/${action}`, { method: 'POST', body: '{}' }, driver.accessToken);
      if (scenario === 'E03') console.log('Demo 7-9: dung payment-service truoc khi complete, sau do khoi dong lai. Script doi toi da 120s.');
      // E03 yêu cầu người chạy kill Payment trước lệnh này (xem docs/demo.md).
      await api(`/trips/${id}/complete`, { method: 'POST', body: '{}' }, driver.accessToken);
      await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'PAID', 120000);
    }
    const type = scenario === 'E02' ? 'trip.cancelled' : 'trip.paid';
    const notifications = await waitFor('/notifications/me', passenger.accessToken, n => n.items.some((item: any) => item.tripId === id && item.type === type));
    assert.equal(notifications.items.filter((n: any) => n.tripId === id && n.type === type).length, 1);
    evidence.push({ result: 'PASS', finalNotification: type });
  } finally { clearInterval(heartbeat); }
} catch (error) { evidence.push({ result: 'FAIL', error: String(error) }); process.exitCode = 1; }
await mkdir('artifacts', { recursive: true });
await writeFile(`artifacts/${scenario}.json`, JSON.stringify({ scenario, time: new Date().toISOString(), evidence }, null, 2));
console.log(evidence);
