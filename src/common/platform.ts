import Fastify, { type FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';

export const roleSchema = z.enum(['PASSENGER', 'DRIVER', 'ADMIN']);
export const claimsSchema = z.object({ userId: z.uuid(), role: roleSchema });
export type Claims = z.infer<typeof claimsSchema>;
declare module '@fastify/jwt' { interface FastifyJWT { payload: Claims; user: Claims } }
export function required(name: string) {
  const value = process.env[name];
  if (!value || value.length < 16) throw new Error(`${name} phải có ít nhất 16 ký tự`);
  return value;
}
export function fail(statusCode: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { statusCode, code });
}
export async function authenticate(request: FastifyRequest) {
  try { await request.jwtVerify(); claimsSchema.parse(request.user); }
  catch { fail(401, 'UNAUTHORIZED', 'Token thiếu, sai hoặc hết hạn'); }
}
export function database() { return new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, max: 10 }); }
export async function createApp(service: string, pool?: Pool) {
  const app = Fastify({ bodyLimit: 10 * 1024,
    logger: process.env.NODE_ENV === 'test' ? false : { base: { service, instanceId: process.env.INSTANCE_ID ?? service }, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-internal-token'] },
    requestIdHeader: false, genReqId: req => {
      const value = req.headers['x-correlation-id'];
      return typeof value === 'string' && z.uuid().safeParse(value).success ? value : randomUUID();
    } });
  await app.register(jwt, { secret: required('JWT_SECRET'), sign: { expiresIn: '15m', iss: 'ds03', aud: 'ride' }, verify: { allowedIss: 'ds03', allowedAud: 'ride', algorithms: ['HS256'] } });
  app.addHook('onRequest', async (req, reply) => { reply.header('X-Correlation-ID', req.id); });
  app.setErrorHandler((error, req, reply) => {
    const e = error as Error & { statusCode?: number; code?: string };
    const status = error instanceof z.ZodError ? 400 : e.statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, 'REQUEST_FAILED');
    reply.code(status).send({ code: error instanceof z.ZodError ? 'INVALID_INPUT' : e.code ?? 'INTERNAL_ERROR', message: status >= 500 ? 'Dịch vụ tạm thời không sẵn sàng' : e.message, correlationId: req.id });
  });
  app.get('/health', async () => ({ status: 'ok', service }));
  app.get('/ready', async () => { if (pool) await pool.query('SELECT 1'); return { status: 'ready', service }; });
  app.get('/dependencies', async () => {
    try { if (pool) await pool.query('SELECT 1'); return { database: pool ? 'up' : 'unused' }; }
    catch { return { database: 'down' }; }
  });
  return app;
}
