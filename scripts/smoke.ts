import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, base, login } from './api.js';
const evidence: unknown[] = [];
try {
  assert.equal((await api('/health')).status, 'ok');
  const session = await login();
  const me = await api('/users/me', {}, session.accessToken);
  assert.equal(me.email, 'passenger1@demo.local');
  assert.ok(Array.isArray((await api('/notifications/me', {}, session.accessToken)).items));
  evidence.push({ test: 'F01/F02/F10', result: 'PASS' });
  for (const [id, path, token, status] of [
    ['S01','/users/me','',401], ['S01','/users/me','bad-token',401],
    ['S02','/drivers/me',session.accessToken,403],
    ['S05','/internal/drivers/available',session.accessToken,403],
    ['S03','/notifications/me?since=wrong',session.accessToken,400]
  ] as const) {
    const response = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    assert.equal(response.status, status, `${id}: ${path}`);
    evidence.push({ test: id, path, status, result: 'PASS' });
  }
} catch (error) { evidence.push({ result: 'FAIL', error: String(error) }); process.exitCode = 1; }
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/smoke.json', JSON.stringify({ time: new Date().toISOString(), evidence }, null, 2));
console.log(evidence);
