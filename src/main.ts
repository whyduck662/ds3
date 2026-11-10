import { readFile } from 'node:fs/promises';
import { database, createApp } from './common/platform.js';
import { identityApp } from './identity-service/app.js';
import { gatewayApp } from './api-gateway/app.js';
import { notificationApp } from './notification-service/app.js';
import { consumeNotifications } from './notification-service/consumer.js';

const name = process.env.SERVICE_NAME ?? 'identity-service';
const pool = name === 'api-gateway' ? undefined : database();
if (pool && ['identity-service','notification-service'].includes(name)) {
  // SQL idempotent: mỗi service chỉ migrate DB của chính mình.
  await pool.query(await readFile(new URL(`../src/${name}/migration.sql`, import.meta.url), 'utf8'));
}
const app = name === 'identity-service' ? await identityApp(pool!) : name === 'notification-service' ? await notificationApp(pool!) : name === 'api-gateway' ? await gatewayApp() : await createApp(name, pool);
if (!['identity-service','notification-service','api-gateway'].includes(name)) {
  app.setNotFoundHandler((req, reply) => reply.code(501).send({ code: 'NOT_IMPLEMENTED', message: `Khung ${name}: chờ TV2/TV3 triển khai`, correlationId: req.id }));
}
const consumer = name === 'notification-service' ? consumeNotifications(pool!, app.log) : undefined;
if (consumer) app.get('/broker', async () => ({ broker: consumer.connected() ? 'up' : 'down' }));
app.addHook('onClose', async () => { await consumer?.close(); await pool?.end(); });
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 8081) });
for (const signal of ['SIGTERM','SIGINT'] as const) process.on(signal, () => { void app.close(); });
