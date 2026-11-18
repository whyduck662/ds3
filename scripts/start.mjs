import { ensureEnv } from './env.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const added = ensureEnv();
if (added.length) console.log(`Đã bổ sung ${added.length} biến cấu hình ngẫu nhiên vào .env.`);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('docker', ['compose', 'up', '--build', '-d', '--wait']);
run(process.execPath, ['--import', 'tsx', 'scripts/demo/seed.ts']);
console.log('UI: http://localhost:3000 · Gateway: http://localhost:8080');
