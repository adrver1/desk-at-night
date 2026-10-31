// Screen sharpness audit for story mode: enter every beat, then for each room
// screen in view, measure how many canvas pixels it covers on screen against
// the pixels of the texture it is drawn from. Above 1 the screen is
// magnified (soft); the story's close-ups are the ones that matter. texW is
// the size from before ?sharp (slot, or half the atlas on phones), so `mag`
// says how soft a screen was the old way.
//   npx vite --port 5173 &
//   node qa/screen-sharpness.mjs [out.json] [chapter keys, e.g. 2,3] [width] [height] [dpr]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const [out = 'qa/shots/screen-sharpness.json', keysArg = '', W = '1920', H = '1080', DPR = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: +DPR });
await page.goto('http://127.0.0.1:5173/story.html?nofs&idles=0&perf=1');
await page.waitForFunction(() => document.querySelector('#storyGo') && !document.querySelector('#storyGo').disabled, null, { timeout: 180000 });
const keys = keysArg ? keysArg.split(',').map(Number) : await page.evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => __story.beats(k)));
await page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js').catch(() => import('three'));
  const sc = await import('/src/screens.js'), cs = await import('/src/controlScene.js');
  const coarse = matchMedia('(pointer: coarse)').matches;
  window.__sharp = () => {
    const g = __game, room = g.room, cam = g.camera, canvas = g.renderer.domElement;
    cam.updateMatrixWorld();
    const slots = room.meta.screens.slots, rows = [];
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    if (!vis(room.root)) return { canvas: [canvas.width, canvas.height], rows };
    for (const name of Object.keys(slots)) {
      const f = room.screenFrame(name, cam.position);
      if (!f) continue;
      const { center, normal } = f;
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => f.at(u, v));
      if (!corners.some((p) => fr.containsPoint(p)) && !fr.containsPoint(center)) continue;
      const toCam = cam.position.clone().sub(center);
      if (toCam.dot(normal) <= 0) continue;
      const px = corners.map((p) => { const q = p.clone().project(cam); return [(q.x + 1) / 2 * canvas.width, (1 - q.y) / 2 * canvas.height]; });
      const wpx = (Math.hypot(px[1][0] - px[0][0], px[1][1] - px[0][1]) + Math.hypot(px[2][0] - px[3][0], px[2][1] - px[3][1])) / 2;
      const hpx = (Math.hypot(px[3][0] - px[0][0], px[3][1] - px[0][1]) + Math.hypot(px[2][0] - px[1][0], px[2][1] - px[1][1])) / 2;
      // clipped to the canvas, roughly: the share of the screen in view
      const id = sc.contentOf(name), live = cs.LIVE.includes(id);
      const tex = live ? slots[name][2] : slots[name][2] * (coarse ? 0.5 : 1);
      rows.push({ name, id, live, wpx: Math.round(wpx), hpx: Math.round(hpx), texW: tex, mag: +(wpx / tex).toFixed(2), coverage: +(Math.min(wpx, canvas.width) * Math.min(hpx, canvas.height) / (canvas.width * canvas.height)).toFixed(3) });
    }
    rows.sort((a, b) => b.wpx - a.wpx);
    return { canvas: [canvas.width, canvas.height], rows };
  };
});
const result = [];
await page.evaluate(() => __story.start());
for (const key of keys) {
  const n = await page.evaluate((k) => __story.beats(k), key);
  for (let i = 0; i < n; i++) {
    await page.evaluate(([k, b]) => __story.enter(k, b, { instant: true }), [key, i]);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ beat: __story.state.beat, hidden: __game.hooks.hidden, covered: __game.hooks.covered, ...__sharp(), steps: (window.__perf?.snapshot?.steps ?? []).map((s) => [s.name, +s.ms.toFixed(2)]) }));
    result.push({ key, i, ...r });
    const top = r.rows[0];
    console.log(key, i, r.beat, top ? `${top.name}(${top.id}) ${top.wpx}px from ${top.texW} tex = x${top.mag} cover ${top.coverage}` : '-', JSON.stringify(r.steps).slice(0, 160));
  }
}
writeFileSync(out, JSON.stringify(result, null, 1));
await browser.close();
