import { database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
import { migrate } from '../../../common/src/migrate.js';
import { paymentApp } from './app.js';
import { consumePayments } from './consumer.js';

const pool = database();
await migrate(pool, new URL('../migrations', import.meta.url));

const app = await paymentApp(pool);
let consumer: ReturnType<typeof consumePayments> | undefined;

if (process.env.RABBITMQ_URL) {
  consumer = consumePayments(pool, app.log);
}

app.addHook('onClose', async () => {
  if (consumer) await consumer.close();
  await pool.end();
});

await serve(app, Number(process.env.PORT ?? 8085));
