// Story mode QA for beats that run by themselves (the cold open): start the
// story at a chapter and screenshot it every few seconds as it plays.
//   node qa/story-timeline.mjs <outDir> [url] [every s] [total s]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [out, url = 'http://127.0.0.1:5173/story.html?nofs&chapter=2', every = '6', total = '130'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => document.querySelector('#storyGo') && !document.querySelector('#storyGo').disabled, null, { timeout: 150000 });
await page.evaluate(() => __story.start());
const t0 = Date.now();
let i = 0;
while ((Date.now() - t0) / 1000 < +total) {
  await page.waitForTimeout(+every * 1000);
  const st = await page.evaluate(() => `${__story.state.chapter}:${__story.state.beat}`);
  const t = Math.round((Date.now() - t0) / 1000);
  await page.screenshot({ path: `${out}/${String(i++).padStart(2, '0')}-${t}s-${st.replace(':', '_')}.png` });
  console.log(t, st);
  if (st.startsWith('year-ago')) break;
}
console.log(JSON.stringify(errors.slice(0, 10)));
await browser.close();
