// Sola opening: draw calls, triangles and GPU objects per shot, bytes
// loaded, and a screenshot of each shot (for before/after checks).
//   node qa/sola-perf.mjs [url] [out dir]
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:5173/story.html?sola=1&nofs';
const out = process.argv[3] ?? new URL('./shots/sola/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const bytes = {};
page.on('response', async (r) => {
  const u = new URL(r.url()).pathname;
  if (!/\/(story\/sola|intro)\//.test(u)) return;
  try { bytes[u] = (await r.body()).length; } catch { /* redirects */ }
});
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(url);
await page.waitForFunction('window.__story && window.__game?.renderer', null, { timeout: 150000 });
// Play the opening by hand, frozen at chosen times
await page.evaluate(async () => {
  const s = window.__story.sola();
  const t = performance.now();
  await s.load();
  window.__solaLoad = performance.now() - t;
  document.querySelector('.begin')?.remove();
  const css = document.createElement('style');   // the picture alone, no titles or navigator
  css.textContent = '* { visibility: hidden !important } canvas { visibility: visible !important }';
  document.head.append(css);
  Object.assign(s, { mode: 'open', cues: new Set(), say: null, host: document.body, ui: window.__story.ui });
  s.show();
  // Hold the clock at window.__solaHold (s) once it gets there, so slow software GL still shoots the right moment
  const update = s.update.bind(s);
  s.update = (dt) => { if (window.__solaHold != null && (performance.now() - s.t0) / 1000 > window.__solaHold) s.t0 = performance.now() - window.__solaHold * 1000; update(dt); };
  const r = window.__game.renderer, render = r.render.bind(r);
  r.render = (scene, cam) => {
    render(scene, cam);
    if (scene === s.scene) window.__solaInfo = { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
  };
});
const shots = {};
for (const [name, at] of [['apron', 4], ['fence', 10], ['door', 17], ['seated', 25]]) {
  await page.evaluate((at) => { const s = window.__story.sola(); s.cues = new Set(['in', 'title', 'title-off', 'crew1', 'crew2', 'rotor-near', 'out']); s.t0 = performance.now() - (at - 2) * 1000; window.__solaHold = at; }, at);
  await page.waitForTimeout(4000);
  shots[name] = await page.evaluate(() => window.__solaInfo);
  await page.screenshot({ path: `${out}${name}.png` });
}
// The Act 1 still: the pallet by the fence, its bottles see-through
await page.evaluate(() => { const s = window.__story.sola(); window.__solaHold = 10; s.mode = 'still'; s.kind = 'full'; s.show(); s.t0 = performance.now() - 10000; });
await page.waitForTimeout(4000);
shots.still = await page.evaluate(() => window.__solaInfo);
await page.screenshot({ path: `${out}still.png` });
await page.evaluate(() => { const s = window.__story.sola(); s.mode = 'open'; s.show(); s.t0 = performance.now() - 10000; });
// Frame time over 3 s (software GL, so only useful as a before/after ratio)
const ms = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (++n < 90 ? requestAnimationFrame(f) : res((performance.now() - t0) / n)); requestAnimationFrame(f); }));
const load = await page.evaluate(() => window.__solaLoad);
const res = { shots, bytes, totalBytes: Object.values(bytes).reduce((a, b) => a + b, 0), frameMs: +ms.toFixed(1), loadMs: Math.round(load) };
writeFileSync(`${out}perf.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
