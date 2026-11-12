import { migrate } from '../../../common/src/migrate.js';
import { database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
import {
  connectBroker,
  setupTopology,
  startOutboxPoller
} from '../../../common/src/messaging.js';
import { matchingApp } from './app.js';
import { setupMatchingConsumer } from './consumer.js';
import { startMatchingLeaseRecoveryJob } from './jobs.js';

const pool = database();
await migrate(pool, new URL('../migrations/', import.meta.url));

const app = await matchingApp(pool);

let poller: { stop: () => void } | null = null;
let brokerConn: { connection: { close: () => Promise<void> }; channelWrapper: any } | null = null;

if (process.env.RABBITMQ_URL) {
  try {
    const { connection, channelWrapper } = connectBroker(process.env.RABBITMQ_URL);
    brokerConn = { connection, channelWrapper };
    await channelWrapper.addSetup(setupTopology);
    poller = startOutboxPoller(pool, channelWrapper, app.log, 500);
    setupMatchingConsumer(channelWrapper, pool, app.log);
  } catch (err) {
    app.log.warn({ operation: 'RABBITMQ_CONNECT_WARN', err });
  }
}

const leaseRecovery = startMatchingLeaseRecoveryJob(pool, app.log);

app.addHook('onClose', async () => {
  leaseRecovery.stop();
  poller?.stop();
  if (brokerConn) {
    await brokerConn.channelWrapper.close().catch(() => {});
    await brokerConn.connection.close().catch(() => {});
  }
  await pool.end();
});

await serve(app, 8084);
