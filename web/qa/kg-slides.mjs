// Screenshots of the live knowledge-graph slides (src/story/kg/), every click.
//   node qa/kg-slides.mjs <base url, e.g. http://localhost:5173/> <out dir> [look c|b] [beat ids, comma separated]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const [base, out, look = 'c', only] = process.argv.slice(2);
const BEATS = only ? only.split(',') : ['h.s2', 'new.ctrl08', 'new.ctrl09', 'h.s1', 'new.ctrl11', 'new.ctrl12', 'new.ctrl13', 'new.ctrl14'];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const beat of BEATS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(beat, 'pageerror', String(e)));
  page.on('console', (m) => m.type() === 'error' && console.log(beat, 'console', m.text()));
  await page.goto(`${base}story.html?nofs&idles=0&kglook=${look}&beat=${beat}`);
  await page.waitForSelector('#storyGo', { timeout: 150000 });
  await page.click('#storyGo');
  await page.waitForSelector('.slide.live.on', { timeout: 150000 });
  await page.waitForTimeout(4000);
  const n = await page.evaluate(() => document.querySelector('.slide.live .kg')?.dataset.slide);
  let k = 0;
  const shot = async () => { await page.locator('.slide.live').screenshot({ path: `${out}/${beat}-${k++}.png` }); };
  await shot();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(beat === 'new.ctrl14' && k === 5 ? 6500 : 2600);
    const now = await page.evaluate(() => document.querySelector('.slide.live.on .kg')?.dataset.slide);
    if (now !== n) break;
    await shot();
  }
  await page.close();
}
await browser.close();
