// The ?perf=1 overlay on each game page: a screenshot with the panel open,
// one after an object scan, and the copied report as text. Checks that the
// panel shows passes and that the pages log no errors with it on.
//   npx vite --port 5173 &
//   node qa/perf-shots.mjs [base url] [out dir]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? new URL('./shots/perf/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const PAGES = [
  ['play', 'play.html?perf=1'],
  ['control', 'control.html?perf=1&cam=1'],
  ['intro', 'intro.html?perf=1'],
  ['play-phone', 'play.html?perf=1', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const result = {};
for (const [name, path, device] of PAGES) {
  const ctx = await browser.newContext(device ? { viewport: { width: device.width, height: device.height }, ...device } : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + path);
  await page.waitForFunction(() => window.__perf?.snapshot?.passes.length >= 2, null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}${name}.png` });
  await page.evaluate(() => window.__perf.startScan());
  await page.waitForFunction(() => window.__perf.scan, null, { timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}${name}-scan.png` });
  const report = await page.evaluate(() => window.__perf.report());
  writeFileSync(`${out}${name}.txt`, report);
  result[name] = { errors, passes: await page.evaluate(() => window.__perf.snapshot.passes.map((p) => p.label)) };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(result, null, 2));
process.exit(Object.values(result).some((r) => r.errors.length) ? 1 : 0);
