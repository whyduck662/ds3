// Khung bàn giao TV2; chưa có logic nghiệp vụ.
import { createApp, database } from '../../../common/src/platform.js';
import { serve } from '../../../common/src/serve.js';
const pool = database();
const app = await createApp('payment-service', pool);
app.setNotFoundHandler((req, reply) => reply.code(501).send({ code: 'NOT_IMPLEMENTED', message: 'payment-service: chờ owner triển khai', correlationId: req.id }));
app.addHook('onClose', () => pool.end());
await serve(app, 8085);
