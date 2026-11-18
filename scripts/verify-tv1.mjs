import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const deploymentOnly = process.argv.includes('--deployment-only');
const full = process.argv.includes('--full') || deploymentOnly;
const id = new Date().toISOString().replace(/[:.]/g, '-');
const directory = `docs/evidence/tv1/${id}`;
mkdirSync(directory, { recursive: true });
const secretValues = ['DemoPass123!', ...Object.entries(process.env).filter(([key]) => /TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value)];
try {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && /TOKEN|SECRET|PASSWORD/.test(match[1])) secretValues.push(match[2]);
  }
} catch {}
function redact(value) {
  let result = value.replace(/\x1b\[[0-9;]*m/g, '');
  for (const secret of secretValues.filter(value => value && value.length >= 8)) result = result.split(secret).join('[REDACTED]');
  return result.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/(postgres(?:ql)?|amqp):\/\/[^\s"']+/g, '$1://[REDACTED]');
}
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout?.trim();
const report = {
  owner: 'TV1', startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'),
  workingTree: git('status', '--short'), mode: deploymentOnly ? 'deployment-only' : full ? 'full' : 'local',
  environment: { node: process.version, platform: process.platform, release: os.release(), arch: os.arch(), cpus: os.cpus().length, memoryBytes: os.totalmem() },
  checks: []
};
if (deploymentOnly && existsSync('docs/evidence/tv1/latest.json')) {
  report.previousEvidence = JSON.parse(readFileSync('docs/evidence/tv1/latest.json', 'utf8')).directory;
}
function run(testId, command, args, expected, dependency = false) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  const status = result.status === 0 ? 'PASS' : dependency ? 'BLOCKED' : 'FAIL';
  const output = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`);
  const log = `${testId}.txt`;
  writeFileSync(`${directory}/${log}`, output);
  const evidenceFiles = [];
  const candidates = testId === 'CONCURRENCY' ? ['artifacts/c01.json','artifacts/c02.json'] : testId === 'P01' ? ['artifacts/p01.json'] : testId === 'UI-TV1' ? ['artifacts/ui/results.json', 'artifacts/ui/5.png', 'artifacts/ui/8.png'] : testId === 'UNIT' ? ['artifacts/unit.json'] : testId === 'INTEGRATION-TV1' ? ['artifacts/integration.json'] : testId === 'SMOKE' ? ['artifacts/smoke.json'] : /^E0[1234]$/.test(testId) ? [`artifacts/${testId}.json`, `artifacts/${testId}-containers.log`] : [];
  if (testId === 'UI-BUSINESS' && existsSync('artifacts/ui-business')) {
    for (const entry of readdirSync('artifacts/ui-business')) {
      const folder = `artifacts/ui-business/${entry}`;
      if (statSync(folder).isDirectory() && statSync(folder).mtimeMs >= Date.parse(startedAt)) {
        for (const file of readdirSync(folder)) if (/^(results\.json|passenger(?:-trip)?\.png|driver(?:-trip)?\.png)$/.test(file)) candidates.push(`${folder}/${file}`);
      }
    }
  }
  for (const source of candidates) {
    if (!existsSync(source) || statSync(source).mtimeMs < Date.parse(startedAt)) continue;
    const filename = `${testId}-${source.split('/').pop()}`;
    if (source.endsWith('.png')) copyFileSync(source, `${directory}/${filename}`);
    else writeFileSync(`${directory}/${filename}`, redact(readFileSync(source, 'utf8')));
    evidenceFiles.push(filename);
  }
  report.checks.push({ testId, owner: 'TV1', command: [command, ...args].join(' '), expected,
    actual: `exit=${result.status}; ${result.signal ? `signal=${result.signal}` : status}`, status, startedAt, endedAt: new Date().toISOString(), log, evidenceFiles });
  console.log(`${testId}: ${status}`);
  return status === 'PASS';
}
// Use npm's JS entrypoint to avoid Windows .cmd shell quoting.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run using npm run verify:tv1');
const npm = (testId, args, expected) => run(testId, process.execPath, [npmCli, ...args], expected);
if (!deploymentOnly) {
  npm('TYPECHECK', ['run', 'typecheck'], 'Backend, tools and UI typecheck exit 0');
  npm('BUILD', ['run', 'build'], 'TypeScript and production UI build exit 0');
  npm('UNIT', ['test'], 'All unit tests pass; see test counts in log');
}
const dockerReady = run('DOCKER', 'docker', ['info', '--format', '{{.ServerVersion}}'], 'Docker Engine responds', true);
const runtimeCases = [...(deploymentOnly ? [] : ['INTEGRATION-TV1', 'UI-TV1']), 'SMOKE', 'E01', 'E02', 'E03', 'E04', 'UI-BUSINESS', 'CONCURRENCY', 'P01', 'REDEPLOY'];
if (full && dockerReady) {
  if (!deploymentOnly) {
  const ready = run('TEST-INFRA', 'docker', ['compose', '-f', 'deploy/compose.test.yaml', 'up', '-d', '--wait'], 'Dedicated test DB/MQ healthy');
  if (ready) {
      npm('INTEGRATION-TV1', ['run', 'test:integration'], 'Identity/Notification plus Payment/Trip/Matching/Driver recovery with real test DB/MQ');
    npm('UI-TV1', ['run', 'test:ui'], 'TV1 browser checks pass with real test DB/MQ, fixture events, isolated ports');
  }
  }
  // Leave infrastructure/data intact for inspection; never delete volumes here.
  const started = npm('STARTUP', ['run', 'up'], 'Build/start deployment and seed through HTTP');
  if (started) {
    npm('SMOKE', ['run', 'smoke'], 'Gateway smoke suite passes');
    let e2eReady = true;
    for (const scenario of ['E01', 'E02', 'E03', 'E04']) {
      if (!npm(scenario, ['run', 'e2e', '--', scenario], 'Complete scenario and all API/notification assertions pass')) { e2eReady = false; break; }
    }
    if (e2eReady) {
      npm('UI-BUSINESS', ['run', 'test:ui:business'], 'Real browser heartbeat/booking/accept/start/complete/payment/notifications pass');
      npm('CONCURRENCY', ['run', 'test:concurrency'], 'C01 and C02 verify final states, reject unexpected failures, and clean up');
      npm('P01', ['run', 'benchmark'], 'Read API experiment records latency/throughput/error at concurrency 1/5/10');
    }
  }
}
for (const testId of runtimeCases) {
  if (!report.checks.some(check => check.testId === testId)) report.checks.push({
    testId, owner: 'TV1', status: 'BLOCKED', expected: 'Executed with evidence on the integrated system',
    actual: !dockerReady ? 'Docker Engine unavailable' : !full ? 'Not requested in local mode; run with --full' : 'Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass'
  });
}
report.endedAt = new Date().toISOString();
report.acceptance = report.checks.some(check => check.status === 'FAIL') ? 'FAIL' : report.checks.some(check => check.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
writeFileSync(`${directory}/results.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync('docs/evidence/tv1/latest.json', JSON.stringify({ directory, acceptance: report.acceptance, endedAt: report.endedAt }, null, 2) + '\n');
console.log(`Evidence: ${directory}/results.json; overall ${report.acceptance}`);
await import('./check-summary.mjs');
if (report.acceptance !== 'PASS') process.exitCode = 1;
