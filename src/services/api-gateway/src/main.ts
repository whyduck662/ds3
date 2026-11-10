import { serve } from '../../../common/src/serve.js';
import { gatewayApp } from './app.js';

await serve(await gatewayApp(), 8080);
