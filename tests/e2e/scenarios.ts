import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, base, login } from '../../scripts/demo/api.js';

const scenario = process.argv[2] ?? 'E01';
if (!['E01', 'E02', 'E03'].includes(scenario)) throw new Error('Dùng E01 (happy path), E02 (cancel), E03 (capture recovery)');
const evidence: unknown[] = [];
const compose = (...args: string[]) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', timeout: 60000 });
async function waitFor(path: string, token: string, predicate: (value: any) => boolean, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await api(path, {}, token);
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timeout: ${path}`);
}
let heartbeat: ReturnType<typeof setInterval> | undefined;
let stoppedPayment = false;
let id: string | undefined;
await mkdir('artifacts', { recursive: true });
try {
  if (scenario === 'E03' && base !== 'http://localhost:8080') throw new Error('E03 chỉ điều khiển Compose local qua API mặc định http://localhost:8080');
  const passenger = await login(0), driver = await login(2);
  const location = { lat: 10.7769, lng: 106.7009 };
  await api('/drivers/me/location', { method: 'PUT', body: JSON.stringify(location) }, driver.accessToken);
  await api('/drivers/me/status', { method: 'PUT', body: JSON.stringify({ status: 'AVAILABLE' }) }, driver.accessToken);
  heartbeat = setInterval(() => {
    void api('/drivers/me/location', { method: 'PUT', body: JSON.stringify(location) }, driver.accessToken).catch(error => evidence.push({ operation: 'HEARTBEAT_FAILED', error: String(error) }));
  }, 5000);
  const trip = await api('/trips', { method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ pickup: location, dropoff: { lat: 10.782, lng: 106.71 } }) }, passenger.accessToken);
  id = trip.id;
  assert.ok(id, 'POST /trips phải trả id');
  evidence.push({ tripId: id, correlationId: trip.correlationId, quotedFare: trip.quotedFare });
  await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'DRIVER_ASSIGNED');
  if (scenario === 'E02') {
    await api(`/trips/${id}/cancel`, { method: 'POST', body: '{}' }, passenger.accessToken);
    await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'CANCELLED');
    await waitFor('/drivers/me', driver.accessToken, d => d.currentTripId === null && d.status === 'AVAILABLE');
    await waitFor(`/payments/${id}`, passenger.accessToken, p => p.status === 'VOIDED');
    evidence.push({ cleanup: 'driver released, payment voided' });
  } else {
    await api(`/trips/${id}/accept`, { method: 'POST', body: '{}' }, driver.accessToken);
    await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'ACCEPTED');
    await api(`/trips/${id}/start`, { method: 'POST', body: '{}' }, driver.accessToken);
    await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'IN_PROGRESS');
    if (scenario === 'E03') {
      // Đánh dấu trước kill để finally luôn thử khôi phục kể cả Docker command lỗi.
      stoppedPayment = true;
      compose('kill', 'payment-service');
      assert.equal(compose('ps', '--status', 'running', '--services', 'payment-service').trim(), '', 'Payment phải dừng thật');
      evidence.push({ operation: 'PAYMENT_KILLED', time: new Date().toISOString() });
    }
    await api(`/trips/${id}/complete`, { method: 'POST', body: '{}' }, driver.accessToken);
    if (scenario === 'E03') {
      const pending = await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'COMPLETED' && t.paymentStatus === 'CAPTURE_PENDING');
      evidence.push({ operation: 'CAPTURE_PENDING_WHILE_PAYMENT_DOWN', status: pending.status });
      compose('up', '-d', 'payment-service'); stoppedPayment = false;
      evidence.push({ operation: 'PAYMENT_RESTARTED', time: new Date().toISOString() });
    }
    await waitFor(`/trips/${id}`, passenger.accessToken, t => t.status === 'PAID', 120000);
    const payment = await api(`/payments/${id}`, {}, passenger.accessToken);
    assert.equal(payment.status, 'CAPTURED'); assert.equal(payment.amount, trip.quotedFare);
    evidence.push({ payment: { status: payment.status, amount: payment.amount }, note: 'TV2 bổ sung DB invariant evidence cho số lần capture' });
  }
  const type = scenario === 'E02' ? 'trip.cancelled' : 'trip.paid';
  for (const session of [passenger, driver]) {
    const notifications = await waitFor('/notifications/me', session.accessToken, n => n.items.some((item: any) => item.tripId === id && item.type === type));
    assert.equal(notifications.items.filter((n: any) => n.tripId === id && n.type === type).length, 1);
  }
  evidence.push({ result: 'PASS', finalNotification: type });
} catch (error) { evidence.push({ result: 'FAIL', error: String(error) }); process.exitCode = 1; }
finally {
  clearInterval(heartbeat);
  if (stoppedPayment) {
    try { compose('up', '-d', 'payment-service'); }
    catch (error) { evidence.push({ operation: 'RESTORE_FAILED', error: String(error) }); process.exitCode = 1; }
  }
  try { await writeFile(`artifacts/${scenario}-containers.log`, compose('logs', '--no-color', '--since', '10m')); }
  catch (error) { evidence.push({ operation: 'LOG_COLLECTION_FAILED', error: String(error) }); }
  await writeFile(`artifacts/${scenario}.json`, JSON.stringify({ scenario, time: new Date().toISOString(), evidence }, null, 2));
  console.log(evidence);
}
