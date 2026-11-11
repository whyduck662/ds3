import { migrate } from '../../../common/src/migrate.js';
import { database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
import { identityApp } from './app.js';

const pool = database();
await migrate(pool, new URL('../migrations/', import.meta.url));
const app = await identityApp(pool);
app.addHook('onClose', () => pool.end());
await serve(app, 8081);
