// Story mode QA: open story.html, enter each beat of the chosen chapters,
// let it play for a while and screenshot it. Also reports page errors.
//   node qa/story-tour.mjs <outDir> <chapter keys, e.g. 2,3> [seconds per beat] [url]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [out, keys = '2', secs = '5', url = 'http://127.0.0.1:5173/story.html?nofs', vw = '1280', vh = '720'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +vw, height: +vh } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => document.querySelector('#storyGo') && !document.querySelector('#storyGo').disabled, null, { timeout: 150000 });
for (const key of keys.split(',').map(Number)) {
  const n = await page.evaluate((k) => { __story.start(); __story.enter(k, 0, { instant: true }); return __story.beats(k); }, key);
  for (let i = 0; i < Number(n ?? 1); i++) {
    await page.evaluate(([k, b]) => __story.enter(k, b, { instant: true }), [key, i]);
    await page.waitForTimeout(+secs * 1000);
    const id = await page.evaluate(() => __story.state.beat);
    await page.screenshot({ path: `${out}/${key}-${String(i + 1).padStart(2, '0')}-${id}.png` });
    console.log(key, i + 1, id);
  }
}
console.log(JSON.stringify(errors.slice(0, 10)));
await browser.close();
