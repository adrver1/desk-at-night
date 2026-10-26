// Story mode QA for a chat beat: enter it, press Space through its messages
// and reports, then ← back once, screenshotting each step.
//   node qa/story-chat.mjs <outDir> <chapter key> <beat id> [url]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [out, key, id, url = 'http://127.0.0.1:5173/story.html?nofs'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => document.querySelector('#storyGo') && !document.querySelector('#storyGo').disabled, null, { timeout: 150000 });
const i = await page.evaluate(([k, id]) => { __story.start(); for (let b = 0; b < __story.beats(k); b++) { __story.enter(k, b, { instant: true }); if (__story.state.beat === id) return b; } return -1; }, [+key, id]);
if (i < 0) throw new Error(`no beat ${id}`);
const shot = async (name) => { await page.evaluate(() => { const s = __story.shots(); if (s) s.k = 1; }); await page.waitForTimeout(3500); await page.screenshot({ path: `${out}/${id}-${name}.png` }); };
await shot('00');
for (let k = 1; k < 12; k++) {
  const before = await page.evaluate(() => JSON.stringify(__story.state.s.chats));
  await page.evaluate(() => __story.next());
  const st = await page.evaluate(() => __story.state);
  if (st.beat !== id) break;
  await shot(String(k).padStart(2, '0'));
  console.log(k, before, JSON.stringify(st.s.chats), st.s.shot);
}
await page.evaluate(() => __story.back());
console.log('back to', await page.evaluate(() => [__story.state.beat, JSON.stringify(__story.state.s.chats)]));
console.log(JSON.stringify(errors.slice(0, 10)));
await browser.close();
