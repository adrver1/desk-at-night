// Screenshots of the sea and sky in each page that draws them (outdoor.js):
// the lighting viewer, the game at the window, the helicopter intro.
//   npx vite --port 5199 &  node qa/sea-shots.mjs [outdir]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = process.env.URL ?? 'http://localhost:5199/';
const out = process.argv[2] ?? new URL('./shots/sea/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const shots = [
  ['control-cloudy', 'control.html?fps=0&weather=cloudy&time=11.5&vessel=alongside'],
  ['control-storm', 'control.html?fps=0&weather=storm&time=15&vessel=alongside'],
  ['play-window', 'play.html?fps=0&weather=cloudy&time=11.5&vessel=alongside&sea=c', async () => {
    await page.evaluate(() => { window.__game.play(); window.__game.place(-4.6, 1.2, -10, 3, -0.2); });
  }],
  ['play-window-storm', 'play.html?fps=0&weather=storm&time=11.5&vessel=alongside&sea=c', async () => {
    await page.evaluate(() => { window.__game.play(); window.__game.place(-4.6, 1.2, -10, 3, -0.2); });
  }],
  ['play-vessel', 'play.html?fps=0&weather=clear&time=11.5&vessel=alongside&sea=c', async () => {
    await page.evaluate(() => { window.__game.play(); window.__game.place(-4.8, 1.0, -31.9, 24.4, -0.75); });
  }],
  ['play-vessel-b', 'play.html?fps=0&weather=clear&time=11.5&vessel=alongside&sea=b', async () => {
    await page.evaluate(() => { window.__game.play(); window.__game.place(-4.8, 1.0, -31.9, 24.4, -0.75); });
  }],
  ['intro-approach', 'intro.html?fps=0&weather=cloudy&sea=c', async () => { await page.evaluate(() => window.intro.advance(20)); }],
  ['intro-low', 'intro.html?fps=0&weather=clear&sea=c&world=-110,-170,7&at=20,-30,14', async () => { await page.evaluate(() => window.intro.advance(60)); }],
  ['intro-low-b', 'intro.html?fps=0&weather=clear&sea=b&world=-110,-170,7&at=20,-30,14', async () => { await page.evaluate(() => window.intro.advance(60)); }],
  ['intro-deck', 'intro.html?fps=0&weather=storm&view=deck', async () => { await page.evaluate(() => window.intro.advance(40)); }],
];
const only = process.argv.slice(3);
for (const [name, path, act] of shots) {
  if (only.length && !only.includes(name)) continue;
  await page.goto(base + path);
  await page.waitForFunction(() => window.__game || window.intro || document.querySelector('#status')?.hidden, null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  if (act) await act();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log(name, await page.evaluate(() => document.querySelector('canvas') ? 'ok' : 'no canvas'));
}
console.log(errors.join('\n') || 'no errors');
await browser.close();
