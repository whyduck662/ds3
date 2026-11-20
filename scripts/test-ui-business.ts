// Real deployment only: no route interception, fixture events or fake business responses.
import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { accounts } from './demo/api.js';

const ui = process.env.UI_URL ?? 'http://localhost:3000';
const directory = process.env.DS03_ARTIFACT_DIR
  ? `${process.env.DS03_ARTIFACT_DIR}/ui-business`
  : `artifacts/ui-business/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(directory, { recursive: true });
const report: { testId: string; owner: string; commit: string; startedAt: string; expected: string; status: string; steps: string[]; actual?: string } = {
  testId: 'UI-BUSINESS', owner: 'TV1', commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), expected: 'Two real browser sessions complete and pay a trip; real notifications reach both users', status: 'FAIL', steps: []
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pages: Page[] = [];
const pageErrors: string[] = [];
const httpFailures: string[] = [];
async function login(page: Page, index: number) {
  await page.goto(ui);
  await page.getByLabel('Email', { exact: true }).fill(accounts[index].email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(accounts[index].password);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(value => value.url().endsWith('/auth/login') && value.request().method() === 'POST');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    const result = await response;
    if (result.status() !== 429 || attempt === 1) {
      expect(result.status(), 'Real UI login HTTP status').toBe(200);
      break;
    }
    const seconds = Number(result.headers()['retry-after'] ?? 60);
    const delay = Math.min(61000, Math.max(1000, (Number.isFinite(seconds) ? seconds : 60) * 1000 + 500));
    report.steps.push(`Auth rate limit observed; respected Retry-After (${Math.ceil(delay / 1000)}s)`);
    await page.waitForTimeout(delay);
  }
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible({ timeout: 15000 });
}
const section = (page: Page, heading: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
try {
  browser = await chromium.launch({ channel: process.env.REPORT_BROWSER ?? 'msedge', headless: true });
  const passengerContext = await browser.newContext();
  const driverContext = await browser.newContext();
  const passenger = await passengerContext.newPage(), driver = await driverContext.newPage();
  pages.push(passenger, driver);
  for (const page of pages) {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) httpFailures.push(`${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()}`);
    });
  }
  await login(passenger, 0); await login(driver, 2);
  report.steps.push('Passenger and Driver logged in through real UI');
  await expect(driver.getByText(/^Trạng thái tài xế:/)).toBeVisible({ timeout: 15000 });
  const onlineResponse = driver.waitForResponse(response => response.url().endsWith('/drivers/me/status') && response.request().method() === 'PUT');
  await driver.getByRole('button', { name: 'Trực tuyến', exact: true }).click();
  const onlineResult = await onlineResponse;
  expect(onlineResult.status(), 'Driver online HTTP status').toBe(200);
  expect((await onlineResult.json() as { status: string }).status).toBe('AVAILABLE');
  report.steps.push('Driver online API returned AVAILABLE');
  await expect(driver.getByText('Trạng thái tài xế: AVAILABLE', { exact: true })).toBeVisible({ timeout: 15000 });
  // Observe actual heartbeat requests for >30s rather than changing availability from the test.
  let heartbeats = 0;
  driver.on('response', response => {
    if (response.url().endsWith('/drivers/me/location') && response.request().method() === 'PUT' && response.ok()) heartbeats++;
  });
  await expect.poll(() => heartbeats, { timeout: 45000, intervals: [1000] }).toBeGreaterThanOrEqual(7);
  await expect(driver.getByText('Trạng thái tài xế: AVAILABLE', { exact: true })).toBeVisible();
  report.steps.push('Seven successful location heartbeats, Driver remains AVAILABLE');
  const createdResponse = passenger.waitForResponse(response => response.url().endsWith('/trips') && response.request().method() === 'POST');
  await passenger.getByRole('button', { name: 'Đặt xe', exact: true }).click();
  const created = await createdResponse;
  expect(created.ok()).toBe(true);
  const trip = await created.json() as { id: string; correlationId: string; quotedFare: number };
  expect(trip.id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(trip.quotedFare).toBeGreaterThan(0);
  await expect(section(passenger, 'Chuyến đi')).toContainText(`Correlation ID: ${trip.correlationId}`);
  await driver.getByRole('button', { name: `Xem đề nghị ${trip.id}`, exact: true }).click({ timeout: 60000 });
  await driver.getByRole('button', { name: 'Nhận chuyến', exact: true }).click();
  await expect(section(passenger, 'Chuyến đi')).toContainText('Trạng thái: Đã nhận', { timeout: 30000 });
  await driver.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await expect(section(passenger, 'Chuyến đi')).toContainText('Trạng thái: Đang di chuyển', { timeout: 30000 });
  await driver.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await expect(section(passenger, 'Chuyến đi')).toContainText('Trạng thái: Đã thanh toán', { timeout: 120000 });
  await expect(section(passenger, 'Chuyến đi')).toContainText('Thanh toán: CAPTURED', { timeout: 15000 });
  for (const page of pages) {
    const notifications = section(page, 'Thông báo').locator('p').filter({ hasText: `Đã thanh toán chuyến đi · ${trip.id}` });
    await expect(notifications).toHaveCount(1, { timeout: 30000 });
  }
  expect(pageErrors).toEqual([]);
  report.steps.push(`Trip ${trip.id}: accepted, started, paid; CAPTURED shown; one paid notification per user; no pageerror`);
  await passenger.screenshot({ path: `${directory}/passenger.png`, fullPage: true });
  await driver.screenshot({ path: `${directory}/driver.png`, fullPage: true });
  await section(passenger, 'Chuyến đi').screenshot({ path: `${directory}/passenger-trip.png` });
  await section(driver, 'Chuyến đi').screenshot({ path: `${directory}/driver-trip.png` });
  report.status = 'PASS'; report.actual = 'All real UI business assertions passed';
} catch (error) {
  // Do not record Playwright request objects, credentials, cookies or tokens.
  report.actual = error instanceof Error ? error.message.replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]') : String(error);
  report.steps.push(...httpFailures);
  for (const [index, page] of pages.entries()) {
    if (!page.isClosed()) {
      report.steps.push(`Page ${index}: ${(await page.locator('main').innerText().catch(() => '')).slice(-2000)}`);
      await page.screenshot({ path: `${directory}/failure-${index}.png`, fullPage: true }).catch(() => {});
    }
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(`${directory}/results.json`, JSON.stringify({ ...report, endedAt: new Date().toISOString(), browser: 'Playwright Chromium/Edge', ui }, null, 2));
  console.log(`UI-BUSINESS: ${report.status}; evidence ${directory}/results.json`);
}
