// Test fixtures chỉ phát envelope mẫu, không thực hiện nghiệp vụ Trip/Payment/Driver.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import type { FastifyInstance } from 'fastify';
import { migrate } from '../../src/common/src/migrate.js';
import { identityApp } from '../../src/services/identity-service/src/app.js';
import { gatewayApp } from '../../src/services/api-gateway/src/app.js';
import { notificationApp } from '../../src/services/notification-service/src/app.js';
import { consumeNotifications } from '../../src/services/notification-service/src/consumer.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'tv1-integration-test-secret-only-32chars';
process.env.RABBITMQ_URL = process.env.TEST_RABBITMQ_URL ?? 'amqp://tv1:local-test-only@127.0.0.1:5673';
const identityDB = new Pool({ connectionString: process.env.TEST_IDENTITY_URL ?? 'postgres://identity:local-test-only@127.0.0.1:55431/identity_test', connectionTimeoutMillis: 2000 });
const notificationDB = new Pool({ connectionString: process.env.TEST_NOTIFICATION_URL ?? 'postgres://notification:local-test-only@127.0.0.1:55436/notification_test', connectionTimeoutMillis: 2000 });
const apps: FastifyInstance[] = [];
let gateway: FastifyInstance, notification: FastifyInstance;
let consumer: ReturnType<typeof consumeNotifications> | undefined;
let connection: ChannelModel | undefined, channel: ConfirmChannel;
const passengerId = randomUUID(), driverId = randomUUID();
const envelope = () => {
  const tripId = randomUUID();
  return { eventId: randomUUID(), type: 'trip.paid', schemaVersion: 1, occurredAt: new Date().toISOString(), causationId: null, correlationId: randomUUID(), producer: { service: 'tv1-test-fixture', instanceId: 'fixture-1' }, aggregateId: tripId, aggregateVersion: 7, matchAttempt: 1, payload: { tripId, passengerId, driverId } };
};
async function until(check: () => Promise<boolean>, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timeout đợi điều kiện integration');
}
async function publish(value: unknown, headers = {}) {
  await new Promise<void>((resolve, reject) => channel.publish('ride.events', 'trip.paid', Buffer.from(JSON.stringify(value)), { persistent: true, contentType: 'application/json', headers }, error => error ? reject(error) : resolve()));
}
async function startConsumer() {
  consumer = consumeNotifications(notificationDB, notification.log);
  await until(async () => {
    // Management connection đã tạo queue trước; checkQueue không đóng channel vì queue tồn tại.
    return (await channel.checkQueue('notification.events')).consumerCount > 0;
  });
}

beforeAll(async () => {
  // Chạy trên DB test riêng; không tự truncate DB triển khai.
  for (const pool of [identityDB, notificationDB]) {
    const result = await pool.query('SELECT current_database() AS name');
    if (!String(result.rows[0].name).endsWith('_test')) throw new Error('Integration chỉ chấp nhận DB tên kết thúc _test');
  }
  await migrate(identityDB, new URL('../../src/services/identity-service/migrations/', import.meta.url));
  await migrate(notificationDB, new URL('../../src/services/notification-service/migrations/', import.meta.url));
  // Migration lặp lại không mất data hoặc báo lỗi.
  await migrate(notificationDB, new URL('../../src/services/notification-service/migrations/', import.meta.url));
  const identity = await identityApp(identityDB); apps.push(identity);
  notification = await notificationApp(notificationDB); apps.push(notification);
  process.env.IDENTITY_URL = await identity.listen({ host: '127.0.0.1', port: 0 });
  process.env.NOTIFICATION_URL = await notification.listen({ host: '127.0.0.1', port: 0 });
  gateway = await gatewayApp(); apps.push(gateway);
  connection = await amqp.connect(process.env.RABBITMQ_URL!);
  channel = await connection.createConfirmChannel();
  await channel.assertExchange('ride.events', 'topic', { durable: true });
  await channel.assertQueue('notification.events', { durable: true });
  await startConsumer();
});
afterAll(async () => {
  await consumer?.close(); await channel?.close(); await connection?.close();
  await Promise.all(apps.map(app => app.close()));
  await Promise.all([identityDB.end(), notificationDB.end()]);
});

describe.sequential('TV1 — real PostgreSQL/RabbitMQ', () => {
  it('F01/F02: register/login/me qua Gateway, hash mật khẩu và role đúng', async () => {
    const input = { email: `tv1-${randomUUID()}@test.local`, password: 'TestPassword123!', name: 'TV1 test', role: 'PASSENGER' };
    const register = await gateway.inject({ method: 'POST', url: '/auth/register', payload: input });
    expect(register.statusCode).toBe(201);
    expect(register.json().role).toBe('PASSENGER');
    expect(register.json()).not.toHaveProperty('password_hash');
    const stored = await identityDB.query('SELECT password_hash FROM users WHERE email=$1', [input.email]);
    expect(stored.rows[0].password_hash).not.toBe(input.password);
    expect((await gateway.inject({ method: 'POST', url: '/auth/register', payload: input })).statusCode).toBe(409);
    const login = await gateway.inject({ method: 'POST', url: '/auth/login', payload: { email: input.email, password: input.password } });
    expect(login.statusCode).toBe(200);
    const me = await gateway.inject({ url: '/users/me', headers: { authorization: `Bearer ${login.json().accessToken}` } });
    expect(me.statusCode).toBe(200); expect(me.json().email).toBe(input.email);
    const denied = await gateway.inject({ method: 'POST', url: '/auth/login', payload: { email: input.email, password: 'WrongPassword' } });
    expect(denied.statusCode).toBe(401);
    const driver = { ...input, email: `driver-${randomUUID()}@test.local`, role: 'DRIVER' };
    expect((await gateway.inject({ method: 'POST', url: '/auth/register', payload: driver })).json().role).toBe('DRIVER');
    const driverLogin = await gateway.inject({ method: 'POST', url: '/auth/login', payload: { email: driver.email, password: driver.password } });
    expect(driverLogin.statusCode).toBe(200); expect(driverLogin.json().user.role).toBe('DRIVER');
  });
  it('F07/F10: event thật qua MQ lưu một lần cho cả passenger và driver', async () => {
    const event = envelope();
    await Promise.all([publish(event), publish(event), publish(event)]);
    await until(async () => Number((await notificationDB.query('SELECT count(*) AS count FROM notifications WHERE event_id=$1', [event.eventId])).rows[0].count) === 2);
    for (const [userId, role] of [[passengerId, 'PASSENGER'], [driverId, 'DRIVER']] as const) {
      const token = gateway.jwt.sign({ userId, role });
      const response = await gateway.inject({ url: '/notifications/me', headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(200);
      expect(response.json().items.filter((n: { eventId: string }) => n.eventId === event.eventId)).toHaveLength(1);
    }
    const stranger = gateway.jwt.sign({ userId: randomUUID(), role: 'PASSENGER' });
    expect((await gateway.inject({ url: '/notifications/me', headers: { authorization: `Bearer ${stranger}` } })).json().items).toHaveLength(0);
    expect((await notificationDB.query('SELECT count(*) AS count FROM processed_messages WHERE event_id=$1', [event.eventId])).rows[0].count).toBe('1');
  });
  it('event sai schema vào DLQ, không ghi inbox', async () => {
    const invalid = { ...envelope(), schemaVersion: 999 };
    await publish(invalid);
    await until(async () => (await channel.checkQueue('notification.events.dlq')).messageCount > 0);
    const message = await channel.get('notification.events.dlq');
    expect(message).not.toBe(false);
    if (message) { expect(JSON.parse(message.content.toString()).eventId).toBe(invalid.eventId); channel.ack(message); }
    expect((await notificationDB.query('SELECT 1 FROM processed_messages WHERE event_id=$1', [invalid.eventId])).rowCount).toBe(0);
  });
  it('rollback khi DB xử lý lỗi, retry hữu hạn rồi xử lý sau khôi phục', async () => {
    const event = envelope();
    await notificationDB.query('ALTER TABLE notifications RENAME TO notifications_unavailable');
    try {
      await publish(event);
      await until(async () => (await channel.checkQueue('notification.events.retry.1s')).messageCount > 0);
      expect((await notificationDB.query('SELECT 1 FROM processed_messages WHERE event_id=$1', [event.eventId])).rowCount).toBe(0);
    } finally { await notificationDB.query('ALTER TABLE notifications_unavailable RENAME TO notifications'); }
    await until(async () => (await notificationDB.query('SELECT 1 FROM notifications WHERE event_id=$1', [event.eventId])).rowCount === 2);
  });
  it('consumer dừng rồi chạy lại nhận message đang chờ', async () => {
    await consumer!.close(); consumer = undefined;
    const event = envelope(); await publish(event);
    expect((await channel.checkQueue('notification.events')).messageCount).toBeGreaterThan(0);
    await startConsumer();
    await until(async () => (await notificationDB.query('SELECT 1 FROM notifications WHERE event_id=$1', [event.eventId])).rowCount === 2);
  });
  it('hết retry budget vào DLQ, giữ eventId và không ghi inbox lỗi', async () => {
    const event = envelope();
    await notificationDB.query('ALTER TABLE notifications RENAME TO notifications_unavailable');
    try {
      // Mô phỏng message đã qua 3 lần retry; test đường kết thúc, không chờ lại 21 giây.
      await publish(event, { retryCount: 3 });
      await until(async () => (await channel.checkQueue('notification.events.dlq')).messageCount > 0);
      const message = await channel.get('notification.events.dlq');
      expect(message).not.toBe(false);
      if (message) {
        expect(message.properties.headers?.retryCount).toBe(4);
        expect(JSON.parse(message.content.toString()).eventId).toBe(event.eventId);
        channel.ack(message);
      }
      expect((await notificationDB.query('SELECT 1 FROM processed_messages WHERE event_id=$1', [event.eventId])).rowCount).toBe(0);
    } finally { await notificationDB.query('ALTER TABLE notifications_unavailable RENAME TO notifications'); }
  });
  it('event version cũ đến muộn vẫn lưu lịch sử riêng, không mất thông báo mới', async () => {
    const current = envelope();
    const older = { ...current, eventId: randomUUID(), type: 'trip.accepted', aggregateVersion: 3 };
    await publish(current); await publish(older);
    await until(async () => (await notificationDB.query('SELECT 1 FROM notifications WHERE trip_id=$1', [current.payload.tripId])).rowCount === 4);
    expect((await notificationDB.query('SELECT DISTINCT aggregate_version FROM notifications WHERE trip_id=$1 ORDER BY aggregate_version', [current.payload.tripId])).rows.map(row => row.aggregate_version)).toEqual([3, 7]);
  });
  it('X06: consumer tự reconnect sau khi RabbitMQ test restart', async () => {
    if (process.env.TEST_RABBITMQ_URL) throw new Error('X06 chỉ restart RabbitMQ của deploy/compose.test.yaml, không điều khiển broker tùy chỉnh');
    await channel.close(); await connection!.close(); connection = undefined;
    execFileSync('docker', ['compose', '-f', 'deploy/compose.test.yaml', 'restart', 'rabbitmq'], { timeout: 45000, stdio: 'pipe' });
    await until(async () => {
      try { connection = await amqp.connect(process.env.RABBITMQ_URL!); return true; }
      catch { return false; }
    }, 20000);
    channel = await connection!.createConfirmChannel();
    await until(async () => consumer!.connected() && (await channel.checkQueue('notification.events')).consumerCount > 0, 20000);
    const event = envelope(); await publish(event);
    await until(async () => (await notificationDB.query('SELECT 1 FROM notifications WHERE event_id=$1', [event.eventId])).rowCount === 2);
  }, 60000);
});
