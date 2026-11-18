import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Channel } from 'amqplib';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { FastifyBaseLogger } from 'fastify';
import { setupTopology } from '../src/common/src/rabbit.js';
import { startConsumer } from '../src/common/src/consumer.js';
import { createEnvelope } from '../src/common/src/messaging.js';
import { randomUUID } from 'node:crypto';

it('routes business commands to their consumers and configures each retry queue once', async () => {
  const bindQueue = vi.fn(async (_queue: string, _exchange: string, _key: string) => {});
  const assertQueue = vi.fn(async (_name: string, _options: unknown) => {});
  await setupTopology({ assertExchange: async () => {}, assertQueue, bindQueue } as unknown as Channel);
  for (const [queue, type] of [
    ['matching.commands', 'matching.find_driver'], ['matching.commands', 'matching.cancel_attempt'],
    ['driver.commands', 'driver.release'], ['payment.commands', 'payment.authorize'],
    ['payment.commands', 'payment.capture'], ['payment.commands', 'payment.void']
  ]) expect(bindQueue).toHaveBeenCalledWith(queue, 'ride.commands', type);
  expect(assertQueue.mock.calls.filter(call => call[0] === 'matching.commands.retry.1s')).toHaveLength(1);
});

it.each([true, false])('releases the DB client exactly once (first delivery=%s)', async firstDelivery => {
  const query = vi.fn(async (sql: string) => ({ rows: [], rowCount: sql.startsWith('INSERT INTO processed_messages') ? Number(firstDelivery) : 0 }));
  const release = vi.fn(), handler = vi.fn(async () => {}), ack = vi.fn();
  let callback: (message: unknown) => Promise<void> = async () => {};
  const wrapper = {
    addSetup: async () => {}, consume: async (_queue: string, work: typeof callback) => { callback = work; }, ack,
    publish: vi.fn(async () => {})
  } as unknown as ChannelWrapper;
  await startConsumer({ channelWrapper: wrapper, pool: { connect: async () => ({ query, release }) } as unknown as Pool,
    queue: 'matching.commands', handler, logger: { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger });
  const envelope = createEnvelope({ type: 'matching.find_driver', correlationId: randomUUID(), aggregateId: randomUUID(), service: 'test', payload: {} });
  await callback({ content: Buffer.from(JSON.stringify(envelope)), properties: {} });
  expect(handler).toHaveBeenCalledTimes(Number(firstDelivery));
  expect(release).toHaveBeenCalledTimes(1);
  expect(ack).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(firstDelivery ? 'COMMIT' : 'ROLLBACK');
});
