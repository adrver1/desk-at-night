// Headless QA: open the built site, screenshot a few states, and save them
// for a pixel diff against the Cycles reference (see qa/diff.py).
//
//   npm run build && npx vite preview --port 4173 &
//   node qa/check.mjs [url]
//
// Set CHROME_PATH if Playwright's own browser isn't installed.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = new URL('./shots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1312, height: 1100 } }); // stage = 1280x720
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(url);
await page.waitForSelector('#status', { state: 'hidden', timeout: 60_000 });
await page.waitForTimeout(1500); // let damping and the lamp settle

const stage = page.locator('#stage');
const shot = async (name) => { await page.waitForTimeout(900); await stage.screenshot({ path: `${out}${name}.png` }); };

await shot('home-lamp-on');
await page.click('#lampBtn');
await shot('home-lamp-off');
await page.click('#lampBtn');
await page.click('[data-mode="1"]');
await shot('albedo');
await page.click('[data-mode="3"]');
await shot('lamp-bake');
await page.click('[data-mode="0"]');
await page.screenshot({ path: `${out}page.png`, fullPage: true });

await page.setViewportSize({ width: 400, height: 900 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}phone.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

await browser.close();
console.log(JSON.stringify({ errors, phoneOverflow: overflow }, null, 2));
process.exit(errors.length || overflow ? 1 : 0);
