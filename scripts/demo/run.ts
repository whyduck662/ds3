import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const demo = process.argv[2] ?? 'help';
const commands: Record<string, string[]> = {
  '1': ['docker', 'compose', 'up', '--build', '-d', '--wait'],
  // E01 thực hiện liên tiếp 2–5. E03 thực hiện 7–9, bao gồm kill/restart thật.
  '2-5': [process.execPath, '--import', 'tsx', 'tests/e2e/scenarios.ts', 'E01'],
  '7-9': [process.execPath, '--import', 'tsx', 'tests/e2e/scenarios.ts', 'E03'],
  'cancel': [process.execPath, '--import', 'tsx', 'tests/e2e/scenarios.ts', 'E02'],
};
if (demo === '6') {
  // TV3 sở hữu test invariant, TV1 chỉ cung cấp điểm gọi trong automation.
  const path = 'tests/concurrency/c01.ts';
  if (!existsSync(path)) { console.error(`BLOCKED: chờ TV3 bàn giao ${path}; không giả lập PASS`); process.exit(1); }
  commands['6'] = [process.execPath, '--import', 'tsx', path];
}
const command = commands[demo];
if (!command) console.log('Demo: npm run demo -- 1 | 2-5 | 6 | 7-9 | cancel. Xem docs/demo.md; cần seed trước 2-9.');
else {
  const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
