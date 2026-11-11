import { migrate } from '../../../common/src/migrate.js';
import { database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
import { notificationApp } from './app.js';
import { consumeNotifications } from './consumer.js';

const pool = database();
await migrate(pool, new URL('../migrations/', import.meta.url));
const app = await notificationApp(pool);
const consumer = consumeNotifications(pool, app.log);
app.get('/broker', async () => ({ broker: consumer.connected() ? 'up' : 'down' }));
app.addHook('onClose', async () => { await consumer.close(); await pool.end(); });
await serve(app, 8086);
