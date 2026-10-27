// Screenshots of the separator prototype: node qa/separator-shots.mjs [base] [outdir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:5199/separator-prototype.html';
const out = process.argv[3] ?? new URL('./shots/separator/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shots = (process.env.SHOTS ?? 'a,b,c').split(',');
for (const v of shots) {
  const [variant, extra] = v.split(':');
  await page.goto(`${base}?variant=${variant}&open=1&${extra ?? ''}`);
  await page.waitForTimeout(2500);
  if (extra?.includes('slug')) { await page.evaluate(() => window.proto.sim.slug(1)); await page.waitForTimeout(Number(process.env.WAIT ?? 4500)); }
  await page.screenshot({ path: `${out}${v.replace(/[:=&]/g, '-')}.png` });
}
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
