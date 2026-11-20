import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, mkdtempSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const deploymentOnly = process.argv.includes('--deployment-only');
const full = process.argv.includes('--full') || deploymentOnly;
// Use npm's JS entrypoint to avoid Windows .cmd shell quoting.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run using npm run verify:tv1');

const artifactsByCheck = {
  TYPECHECK: [], BUILD: [], UNIT: ['unit.json'], DOCKER: [], 'TEST-INFRA': [],
  'INTEGRATION-TV1': ['integration.json'], 'UI-TV1': ['ui/results.json', 'ui/5.png', 'ui/8.png'],
  STARTUP: [], SMOKE: ['smoke.json'],
  E01: ['E01.json', 'E01-containers.log'], E02: ['E02.json', 'E02-containers.log'],
  E03: ['E03.json', 'E03-containers.log'], E04: ['E04.json', 'E04-containers.log'],
  'UI-BUSINESS': ['results.json', 'passenger.png', 'driver.png', 'passenger-trip.png', 'driver-trip.png']
    .map(file => `ui-business/${file}`),
  CONCURRENCY: ['c01.json', 'c02.json'], P01: ['p01.json'], REDEPLOY: [],
};
const evidenceRoot = 'docs/evidence/kiem-thu-du-an-ds03';
mkdirSync(evidenceRoot, { recursive: true });
let runNumber = readdirSync(evidenceRoot)
  .map(name => /^lan-chay-(\d+)$/.exec(name))
  .reduce((highest, match) => match ? Math.max(highest, Number(match[1])) : highest, 0);
let directory;
while (true) {
  directory = `${evidenceRoot}/lan-chay-${String(++runNumber).padStart(2, '0')}`;
  try {
    mkdirSync(directory);
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}
const detailDirectory = `${directory}/evidence`;
mkdirSync(detailDirectory);
mkdirSync('artifacts', { recursive: true });
const artifactRoot = resolve('artifacts');
const artifactDirectory = mkdtempSync(resolve(artifactRoot, 'verify-tv1-'));
process.on('exit', () => {
  if (dirname(artifactDirectory) === artifactRoot) rmSync(artifactDirectory, { recursive: true, force: true });
});
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
  owner: 'TV1', evidenceDirectory: 'evidence', startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'),
  workingTree: git('status', '--short'), mode: deploymentOnly ? 'deployment-only' : full ? 'full' : 'local',
  environment: { node: process.version, platform: process.platform, release: os.release(), arch: os.arch(), cpus: os.cpus().length, memoryBytes: os.totalmem() },
  checks: []
};
const latest = `${evidenceRoot}/latest.json`;
if (deploymentOnly && existsSync(latest)) {
  report.previousEvidence = JSON.parse(readFileSync(latest, 'utf8')).directory;
}
function run(testId, command, args, expected, dependency = false) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', DS03_ARTIFACT_DIR: artifactDirectory } });
  const status = result.status === 0 ? 'PASS' : dependency ? 'BLOCKED' : 'FAIL';
  const output = redact(`${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`);
  const log = `${testId}.txt`;
  writeFileSync(`${detailDirectory}/${log}`, output);
  const evidenceFiles = [];
  for (const artifact of artifactsByCheck[testId]) {
    const source = `${artifactDirectory}/${artifact}`;
    if (!existsSync(source)) continue;
    const filename = `${testId}-${source.split('/').pop()}`;
    if (source.endsWith('.png')) copyFileSync(source, `${detailDirectory}/${filename}`);
    else writeFileSync(`${detailDirectory}/${filename}`, redact(readFileSync(source, 'utf8')));
    evidenceFiles.push(filename);
  }
  report.checks.push({ testId, owner: 'TV1', command: [command, ...args].join(' '), expected,
    actual: `exit=${result.status}; ${result.signal ? `signal=${result.signal}` : status}`, status, startedAt, endedAt: new Date().toISOString(), log, evidenceFiles });
  console.log(`${testId}: ${status}`);
  return status === 'PASS';
}
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
for (const testId of Object.keys(artifactsByCheck)) {
  if (report.checks.some(check => check.testId === testId)) continue;
  const inScope = runtimeCases.includes(testId) || (!deploymentOnly && testId === 'TEST-INFRA');
  report.checks.push({
    testId, owner: 'TV1', status: inScope ? 'BLOCKED' : 'SKIPPED',
    expected: 'Executed with evidence on the integrated system',
    actual: !inScope ? 'Outside the selected mode' : !dockerReady ? 'Docker Engine unavailable'
      : !full ? 'Not requested in local mode; run with --full'
      : 'Requires browser business-flow verification, clean-machine verification, or preceding runtime check to pass'
  });
}
for (const check of report.checks) {
  const { testId } = check;
  check.evidenceFiles ??= [];
  check.missingEvidenceFiles = artifactsByCheck[testId]
    .map(source => `${testId}-${source.split('/').pop()}`)
    .filter(filename => !check.evidenceFiles.includes(filename));
}
report.endedAt = new Date().toISOString();
report.acceptance = report.checks.some(check => check.status === 'FAIL') ? 'FAIL' : report.checks.some(check => check.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
writeFileSync(`${directory}/results.json`, JSON.stringify(report, null, 2) + '\n');
writeFileSync(latest, JSON.stringify({ directory, acceptance: report.acceptance, endedAt: report.endedAt }, null, 2) + '\n');
console.log(`Evidence: ${directory}/results.json; overall ${report.acceptance}`);
await import('./check-summary.mjs');
if (report.acceptance !== 'PASS') process.exitCode = 1;
