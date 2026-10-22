// Screenshot helper for story mode work: open a page, wait for a condition,
// run some code in the page, then save a screenshot.
//   node qa/story-shot.mjs <url> <out.png> [js to run] [wait js] [ms]
import { chromium } from '@playwright/test';
const [url, out, run = '', until = 'window.__game?.room', ms = '1500', vw = '1280', vh = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +vw, height: +vh } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('requestfailed', (r) => console.log('failed', r.url()));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.goto(url);
await page.waitForFunction(until, null, { timeout: 150000 });
if (run) console.log(JSON.stringify(await page.evaluate(run)));
await page.waitForTimeout(+ms);
await page.screenshot({ path: out });
await browser.close();
