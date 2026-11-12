import { database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
import { migrate } from '../../../common/src/migrate.js';
import { tripApp } from './app.js';
import { consumeTripReplies } from './consumer.js';

const pool = database();
await migrate(pool, new URL('../migrations', import.meta.url));

let consumer: ReturnType<typeof consumeTripReplies> | undefined;

const app = await tripApp(pool, () => consumer?.triggerPoller());

if (process.env.RABBITMQ_URL) {
  consumer = consumeTripReplies(pool, app.log);
}

app.addHook('onClose', async () => {
  if (consumer) await consumer.close();
  await pool.end();
});

await serve(app, Number(process.env.PORT ?? 8083));
