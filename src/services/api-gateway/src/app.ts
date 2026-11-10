import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import proxy from '@fastify/http-proxy';
import { authenticate, createApp, fail } from '../../../common/src/platform.js';

export function allowed(role: string, method: string, path: string) {
  if (path === '/users/me' || path === '/notifications/me') return method === 'GET';
  if (/^\/drivers\/me(?:\/(status|location))?$/.test(path)) return role === 'DRIVER' && ['GET','PUT'].includes(method);
  if (/^\/payments\/[0-9a-f-]+$/i.test(path)) return method === 'GET';
  if (path === '/trips/offers') return role === 'DRIVER' && method === 'GET';
  if (path === '/trips') return role === 'PASSENGER' && method === 'POST';
  if (path === '/trips/me/active') return role === 'PASSENGER' && method === 'GET';
  if (/^\/trips\/[0-9a-f-]+$/i.test(path)) return method === 'GET';
  if (/^\/trips\/[0-9a-f-]+\/cancel$/i.test(path)) return role === 'PASSENGER' && method === 'POST';
  if (/^\/trips\/[0-9a-f-]+\/(accept|reject|start|complete)$/i.test(path)) return role === 'DRIVER' && method === 'POST';
  return false;
}
export async function gatewayApp() {
  const app = await createApp('api-gateway');
  await app.register(cors, { origin: process.env.UI_ORIGIN ?? 'http://localhost:3000', exposedHeaders: ['X-Correlation-ID'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onRequest', async (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (['/health','/ready','/dependencies'].includes(path)) return;
    if (path.startsWith('/internal') || path.includes('..') || path.includes('\\')) fail(403, 'INTERNAL_ROUTE_BLOCKED', 'API nội bộ bị chặn');
    if (req.method === 'OPTIONS') return;
    if (['/auth/login','/auth/register'].includes(path) && req.method === 'POST') return;
    await authenticate(req);
    if (!allowed(req.user.role, req.method, path)) fail(403, 'FORBIDDEN', 'Vai trò không có quyền gọi API này');
    // Downstream phải tự verify JWT và ownership. Không tin các header do client tự gán.
    delete req.headers['x-user-id']; delete req.headers['x-user-role']; delete req.headers['x-internal-token'];
    reply.header('X-Correlation-ID', req.id);
  });
  const authLimit = app.rateLimit({ max: 10, timeWindow: '1 minute' });
  for (const [prefix, service, port] of [ ['/auth','identity',8081], ['/users','identity',8081], ['/drivers','driver',8082], ['/trips','trip',8083], ['/payments','payment',8085], ['/notifications','notification',8086] ] as const) {
    await app.register(proxy, { upstream: process.env[`${service.toUpperCase()}_URL`] ?? `http://${service}-service:${port}`, prefix, rewritePrefix: prefix,
      httpMethods: ['GET','POST','PUT','DELETE','PATCH'],
      replyOptions: { rewriteRequestHeaders: (req, headers) => ({ ...headers, 'x-correlation-id': req.id }) },
      preHandler: prefix === '/auth' ? async (req, reply) => { await authLimit.call(app, req, reply); } : undefined });
  }
  return app;
}
