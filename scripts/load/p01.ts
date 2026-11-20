import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { api, base } from '../demo/api.js';

const artifactDirectory = process.env.DS03_ARTIFACT_DIR ?? 'artifacts';

// Reproducible read-path experiment; does not claim booking/matching throughput.
const evidence: Record<string, unknown> = { testId: 'P01', startedAt: new Date().toISOString(),
  workload: 'Authenticated GET /notifications/me, 100 requests at concurrency 1/5/10; distinct user for each stage',
  environment: { node: process.version, platform: process.platform, cpus: os.cpus().length, memory: os.totalmem() }, stages: [] };
try {
  const stages: Record<string, unknown>[] = [];
  for (const concurrency of [1, 5, 10]) {
    const user = { email: `p01-${randomUUID()}@test.local`, name: 'Performance read test', password: 'DemoPass123!', role: 'PASSENGER' };
    await api('/auth/register', { method: 'POST', body: JSON.stringify(user) });
    const session = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: user.email, password: user.password }) });
    let next = 0, errors = 0;
    const latency: number[] = [];
    const start = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next++ < 100) {
        const began = performance.now();
        try {
          const response = await fetch(base + '/notifications/me', { signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${session.accessToken}` } });
          const body = await response.json() as { items?: unknown[] };
          if (!response.ok || !Array.isArray(body.items)) errors++;
        } catch { errors++; }
        latency.push(performance.now() - began);
      }
    }));
    const elapsed = performance.now() - start;
    latency.sort((a, b) => a - b);
    stages.push({ concurrency, requests: latency.length, errors, elapsedMs: elapsed,
      throughputRps: latency.length / (elapsed / 1000), p50Ms: latency[49], p95Ms: latency[94], p99Ms: latency[98], latencyMs: latency });
    if (errors) process.exitCode = 1;
  }
  evidence.stages = stages; evidence.status = process.exitCode ? 'FAIL' : 'PASS';
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error); process.exitCode = 1; }
await mkdir(artifactDirectory, { recursive: true });
evidence.endedAt = new Date().toISOString();
await writeFile(`${artifactDirectory}/p01.json`, JSON.stringify(evidence, null, 2));
console.log(`P01: ${evidence.status}; ${artifactDirectory}/p01.json`);
