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
  await app.register(rateLimit, {
    max: req => req.url.startsWith('/auth/') ? 10 : req.method === 'POST' && req.url.split('?')[0] === '/trips' ? 30 : 120,
    keyGenerator: req => `${req.ip}:${req.url.startsWith('/auth/') ? 'auth' : req.method === 'POST' && req.url.split('?')[0] === '/trips' ? 'booking' : 'api'}`,
    timeWindow: '1 minute'
  });
  app.addHook('onRequest', async (req, reply) => {
    let path: string;
    try { path = decodeURIComponent(req.url.split('?')[0]); }
    catch { fail(400, 'INVALID_URL', 'URL không hợp lệ'); }
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
  for (const [prefix, service, port] of [ ['/auth','identity',8081], ['/users','identity',8081], ['/drivers','driver',8082], ['/trips','trip',8083], ['/payments','payment',8085], ['/notifications','notification',8086] ] as const) {
    await app.register(proxy, { upstream: process.env[`${service.toUpperCase()}_URL`] ?? `http://${service}-service:${port}`, prefix, rewritePrefix: prefix,
      maxRetriesOn503: 0, retryMethods: ['GET'],
      http: { requestOptions: { timeout: 2000 } }, destroyAgent: true,
      proxyPayloads: false, // Parse JSON ở Gateway để bodyLimit 10 KB được áp dụng trước proxy.
      httpMethods: ['GET','POST','PUT','DELETE','PATCH'],
      replyOptions: { timeout: 2000, retriesCount: 0,
        onError: (reply) => { reply.code(503).send({ code: 'SERVICE_UNAVAILABLE', message: 'Dịch vụ tạm thời không sẵn sàng', correlationId: reply.request.id }); },
        rewriteRequestHeaders: (req, headers) => {
        const safe = { ...headers };
        delete safe['x-user-id']; delete safe['x-user-role']; delete safe['x-internal-token'];
        return { ...safe, 'x-correlation-id': req.id };
      } } });
  }
  return app;
}
