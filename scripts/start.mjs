import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (!existsSync('.env')) {
  const keys = ['JWT_SECRET', 'RABBITMQ_PASSWORD', ...['IDENTITY', 'DRIVER', 'TRIP', 'MATCHING', 'PAYMENT', 'NOTIFICATION'].map(name => `${name}_DB_PASSWORD`)];
  writeFileSync('.env', keys.map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n') + '\n', { flag: 'wx' });
  console.log('Đã tạo .env với secrets ngẫu nhiên.');
}
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('docker', ['compose', 'up', '--build', '-d', '--wait']);
run(process.execPath, ['--import', 'tsx', 'scripts/demo/seed.ts']);
console.log('UI: http://localhost:3000 · Gateway: http://localhost:8080');
