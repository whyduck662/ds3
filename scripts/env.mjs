import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

// Add missing keys without replacing credentials or printing their values.
export function ensureEnv(path = '.env') {
  const keys = ['JWT_SECRET', 'INTERNAL_TOKEN', 'RABBITMQ_PASSWORD',
    ...['IDENTITY', 'DRIVER', 'TRIP', 'MATCHING', 'PAYMENT', 'NOTIFICATION'].map(name => `${name}_DB_PASSWORD`)];
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const missing = keys.filter(key => !new RegExp(`^${key}=.+$`, 'm').test(existing));
  for (const key of missing) {
    if (new RegExp(`^${key}=`, 'm').test(existing)) throw new Error(`${key} is empty; fill it in ${path}`);
  }
  if (missing.length) {
    const content = (existing && !existing.endsWith('\n') ? '\n' : '') +
      missing.map(key => `${key}=${randomBytes(32).toString('hex')}`).join('\n') + '\n';
    if (existsSync(path)) appendFileSync(path, content);
    else writeFileSync(path, content, { flag: 'wx' });
  }
  return missing;
}
