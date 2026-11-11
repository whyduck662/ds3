// UI TV1 với DB/MQ test thật; fixture MQ không phải producer nghiệp vụ Trip.
import { chromium, expect } from '@playwright/test';
import { Pool } from 'pg';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { migrate } from '../src/common/src/migrate.js';
import { identityApp } from '../src/services/identity-service/src/app.js';
import { notificationApp } from '../src/services/notification-service/src/app.js';
import { gatewayApp } from '../src/services/api-gateway/src/app.js';
import { consumeNotifications } from '../src/services/notification-service/src/consumer.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'ui-test-only-secret-at-least-32-characters';
process.env.RABBITMQ_URL = 'amqp://tv1:local-test-only@127.0.0.1:5673';
process.env.UI_ORIGIN = 'http://localhost:3000';
const identityDB = new Pool({ connectionString: 'postgres://identity:local-test-only@127.0.0.1:55431/identity_test' });
const notificationDB = new Pool({ connectionString: 'postgres://notification:local-test-only@127.0.0.1:55436/notification_test' });
const apps: Awaited<ReturnType<typeof identityApp>>[] = [];
const results: { name: string; status: string; detail?: string }[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let consumer: ReturnType<typeof consumeNotifications> | undefined;
let mq: Awaited<ReturnType<typeof amqp.connect>> | undefined;
await mkdir('artifacts/ui', { recursive: true });
try {
  await migrate(identityDB, new URL('../src/services/identity-service/migrations/', import.meta.url));
  await migrate(notificationDB, new URL('../src/services/notification-service/migrations/', import.meta.url));
  const identity = await identityApp(identityDB); apps.push(identity);
  const notification = await notificationApp(notificationDB); apps.push(notification);
  process.env.IDENTITY_URL = await identity.listen({ host: '127.0.0.1', port: 0 });
  process.env.NOTIFICATION_URL = await notification.listen({ host: '127.0.0.1', port: 0 });
  // Port đóng mô phỏng upstream chưa sẵn sàng, không thay thế bằng backend giả.
  process.env.TRIP_URL = process.env.DRIVER_URL = process.env.PAYMENT_URL = 'http://127.0.0.1:1';
  const gateway = await gatewayApp(); apps.push(gateway);
  await gateway.listen({ host: '127.0.0.1', port: 8080 });
  mq = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await mq.createConfirmChannel();
  await channel.assertExchange('ride.events', 'topic', { durable: true });
  consumer = consumeNotifications(notificationDB, notification.log);
  vite = await createServer({ root: 'src/web-ui', server: { host: 'localhost', port: 3000, strictPort: true } });
  await vite.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function check(name: string, work: () => Promise<void>) {
    try { await work(); results.push({ name, status: 'PASS' }); }
    catch (error) { results.push({ name, status: 'FAIL', detail: String(error) }); }
    await page.screenshot({ path: `artifacts/ui/${results.length}.png`, fullPage: true });
  }
  await page.goto('http://localhost:3000');
  const email = `ui-${randomUUID()}@test.local`, password = 'BrowserTest123!';
  await check('Đăng ký Passenger trên UI', async () => {
    await page.getByRole('button', { name: 'Đăng ký mới' }).click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByLabel('Họ tên').fill('Hành khách Hà Nội');
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Đăng ký thành công');
  });
  await check('Sai mật khẩu: hiển thị lỗi, vẫn ở màn hình login', async () => {
    await page.getByLabel('Mật khẩu', { exact: true }).fill('WrongPassword123!');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Email hoặc mật khẩu không đúng');
  });
  await check('Login Passenger, chọn địa điểm Hà Nội và phân quyền UI', async () => {
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
    await expect(page.getByLabel('Đón bạn ở đâu?')).toHaveValue('hoan-kiem');
    await expect(page.getByRole('button', { name: 'Trực tuyến', exact: true })).toHaveCount(0);
    await page.getByLabel('Bạn muốn đến đâu?').selectOption('hoan-kiem');
    await expect(page.getByRole('button', { name: 'Đặt xe', exact: true })).toBeDisabled();
    await page.getByLabel('Bạn muốn đến đâu?').selectOption('opera-house');
  });
  const login = await fetch('http://127.0.0.1:8080/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(r => r.json()) as { accessToken: string; user: { userId: string } };
  await check('Phân quyền Gateway khi gọi từ trình duyệt', async () => {
    const statuses = await page.evaluate(async token => {
      const headers = { Authorization: `Bearer ${token}` };
      return Promise.all(['/drivers/me', '/internal/test'].map(async path => (await fetch('http://localhost:8080' + path, { headers })).status));
    }, login.accessToken);
    expect(statuses).toEqual([403, 403]);
  });
  await check('Thông báo qua MQ thật và chống trùng hiển thị UI', async () => {
    const tripId = randomUUID();
    const event = { eventId: randomUUID(), type: 'trip.paid', schemaVersion: 1, occurredAt: new Date().toISOString(), causationId: null, correlationId: randomUUID(), producer: { service: 'ui-test-fixture', instanceId: 'fixture-1' }, aggregateId: tripId, aggregateVersion: 7, matchAttempt: 1, payload: { tripId, passengerId: login.user.userId, driverId: randomUUID() } };
    for (let i = 0; i < 2; i++) channel.publish('ride.events', 'trip.paid', Buffer.from(JSON.stringify(event)), { persistent: true });
    await channel.waitForConfirms();
    await expect(page.getByText(`Đã thanh toán chuyến đi · ${tripId}`, { exact: true })).toHaveCount(1, { timeout: 15000 });
  });
  await check('Upstream chưa chạy: UI hiện lỗi và còn thao tác được', async () => {
    await page.getByRole('button', { name: 'Đặt xe', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Dịch vụ tạm thời không sẵn sàng' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đặt xe', exact: true })).toBeEnabled();
  });
  await check('Phiên hết hạn: logout và yêu cầu đăng nhập lại', async () => {
    await page.route('**/notifications/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Token hết hạn' }) }));
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('status')).toContainText('Phiên đã hết hạn');
    await page.unroute('**/notifications/me');
  });
  await check('Đăng ký/login Driver và phân quyền UI', async () => {
    await page.getByRole('button', { name: 'Đăng ký mới' }).click();
    await page.getByLabel('Email', { exact: true }).fill(`driver-${randomUUID()}@test.local`);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByLabel('Họ tên').fill('Tài xế Hà Nội');
    await page.getByLabel('Vai trò').selectOption('DRIVER');
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Đăng nhập', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Vị trí tài xế' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đặt xe', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Bạn đang ở đâu?')).toBeVisible();
  });
  results.push({ name: 'Không có lỗi JavaScript chưa xử lý', status: errors.length ? 'FAIL' : 'PASS', detail: errors.join('\n') });
} catch (error) {
  results.push({ name: 'Môi trường kiểm thử', status: 'FAIL', detail: String(error) });
} finally {
  await writeFile('artifacts/ui/results.json', JSON.stringify({ timestamp: new Date().toISOString(), browser: 'Microsoft Edge headless', results }, null, 2));
  await browser?.close(); await vite?.close(); await consumer?.close(); await mq?.close();
  await Promise.all(apps.map(app => app.close()));
  await Promise.all([identityDB.end(), notificationDB.end()]);
}
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
