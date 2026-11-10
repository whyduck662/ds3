import type { FastifyInstance } from 'fastify';

export async function serve(app: FastifyInstance, defaultPort: number) {
  await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? defaultPort) });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => { void app.close(); });
  }
}
