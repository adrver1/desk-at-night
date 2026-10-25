// PROTOTYPE: screenshots of flag-prototype.html for each option and view.
//   npx vite --port 5199 &  node qa/flag-shots.mjs [outdir] [combos...]
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'qa/shots';
const combos = process.argv.slice(3);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
for (const c of combos) {
  await page.goto(`http://localhost:5199/flag-prototype.html?shot&${c}`);
  await page.waitForFunction(() => window.lab, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${c.replace(/[&=]/g, '_')}.png` });
}
console.log(errors.join('\n') || 'no errors');
await browser.close();
