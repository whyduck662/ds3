import { readFile } from 'node:fs/promises';
import { database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
import { identityApp } from './app.js';

const pool = database();
await pool.query(await readFile(new URL('../migrations/001_init.sql', import.meta.url), 'utf8'));
const app = await identityApp(pool);
app.addHook('onClose', () => pool.end());
await serve(app, 8081);
