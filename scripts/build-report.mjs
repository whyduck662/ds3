import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const rendered = spawnSync('python', ['scripts/build-report.py'], { stdio: 'inherit' });
if (rendered.status !== 0) throw new Error('Report rendering failed');
const browser = await chromium.launch({ channel: process.env.REPORT_BROWSER ?? 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(readFileSync('artifacts/report-preview.html','utf8'), { waitUntil: 'load' });
  await page.pdf({ path: 'docs/report.pdf', format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>', footerTemplate: '<div style="width:100%;text-align:center;font-size:9px">DS03 — Hệ thống đặt xe · <span class="pageNumber"></span>/<span class="totalPages"></span></div>' });
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.screenshot({ path: 'artifacts/report-cover-preview.png' });
} finally { await browser.close(); }
console.log('Created docs/report.pdf, report.docx and review preview.');
