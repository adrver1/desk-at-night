// Story mode draw audit: enter every beat, let it settle, then record per
// pass draw calls and triangles (from the perf panel) and which objects the
// room pass draws that put no pixel on screen. Those are found with an ID
// render: every visible mesh of the room scene and the characters scene gets
// a flat colour of its own, drawn from the story camera into a small target,
// opaque first, then the transparent ones over the same depth.
//   npx vite --port 5173 &
//   node qa/story-draws.mjs [out.json] [chapter keys, e.g. 2,3] [seconds per beat] [url]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const [out = 'qa/shots/story-draws.json', keysArg = '', secs = '3', url = 'http://127.0.0.1:5173/story.html?nofs&idles=0&perf=1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => document.querySelector('#storyGo') && !document.querySelector('#storyGo').disabled, null, { timeout: 180000 });
const keys = keysArg ? keysArg.split(',').map(Number) : await page.evaluate(() => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((k) => __story.beats(k)));

// In the page: the ID render of the room and characters scenes
await page.evaluate(() => {
  window.__audit = async () => {
    const THREE = window.__THREE;
    const g = window.__game, renderer = g.renderer, camera = g.camera;
    const scenes = [g.scene, window.__story.cast()?.scene].filter(Boolean);
    const W = 320, H = 180;
    const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    const shown = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const items = [];
    for (const sc of scenes) sc.traverse((o) => {
      if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || !shown(o)) return;
      for (const m of [].concat(o.material)) if (m && m.visible !== false) items.push({ o, m, scene: sc });
    });
    // One flat material per object (several when an object has several materials)
    const swaps = new Map();
    items.forEach((it, i) => {
      const id = i + 1, c = new THREE.Color((id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255);
      const mat = new THREE.MeshBasicMaterial({ color: c, side: it.m.side, transparent: false, depthWrite: !it.m.transparent, depthTest: it.m.depthTest, colorWrite: it.m.colorWrite });
      mat.toneMapped = false;
      it.id = id; it.flat = mat; it.transparent = it.m.transparent || it.m.colorWrite === false || !it.m.depthWrite;
    });
    const count = new Map();
    const read = () => {
      const px = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
      for (let p = 0; p < px.length; p += 4) {
        const id = px[p] | (px[p + 1] << 8) | (px[p + 2] << 16);
        if (id) count.set(id, (count.get(id) ?? 0) + 1);
      }
    };
    const was = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), cs: renderer.outputColorSpace, tm: renderer.toneMapping, vp: renderer.getViewport(new THREE.Vector4()), sc: renderer.getScissorTest() };
    const nothing = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const set = () => {
      for (const it of items) if (!swaps.has(it.o)) swaps.set(it.o, it.o.material);
      for (const [o, orig] of swaps) {
        const flat = [].concat(orig).map((m) => items.find((y) => y.o === o && y.m === m)?.flat ?? nothing);
        o.material = Array.isArray(orig) ? flat : flat[0];
      }
    };
    renderer.setRenderTarget(rt);
    renderer.setScissorTest(false);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    const bg = scenes.map((s) => s.background);
    scenes.forEach((s) => { s.background = null; });
    // Opaque: everything writes its id; transparent ones write nothing yet
    for (const it of items) it.flat.colorWrite = !it.transparent, it.flat.depthWrite = !it.transparent;
    set();
    for (const s of scenes) renderer.render(s, camera);
    read();
    // Transparent: over the opaque depth, on a cleared colour
    renderer.clear(true, false, false);
    for (const it of items) { it.flat.colorWrite = it.transparent; it.flat.depthWrite = false; }
    for (const s of scenes) renderer.render(s, camera);
    read();
    for (const [o, m] of swaps) o.material = m;
    scenes.forEach((s, i) => { s.background = bg[i]; });
    renderer.setRenderTarget(was.target);
    renderer.setClearColor(was.color, was.alpha);
    renderer.outputColorSpace = was.cs; renderer.toneMapping = was.tm;
    renderer.setViewport(was.vp); renderer.setScissorTest(was.sc);
    rt.dispose();
    for (const it of items) it.flat.dispose();
    // Which of them would three.js actually draw (in the camera's frustum)?
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const name = (o) => { const p = []; for (let x = o; x && p.length < 3; x = x.parent) if (x.name && !x.isScene) p.unshift(x.name); return p.join('/') || `${o.type}#${o.id}`; };
    const tris = (o) => { const geo = o.geometry; if (!geo) return 0; const n = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0; const inst = o.isInstancedMesh ? o.count : 1; return Math.round(Math.min(n, geo.drawRange.count) / 3) * inst; };
    const rows = items.map((it) => {
      const inFrustum = !it.o.frustumCulled || (it.o.geometry && (it.o.geometry.boundingSphere || it.o.geometry.computeBoundingSphere(), fr.intersectsObject(it.o)));
      return { name: name(it.o), scene: it.scene.name, px: count.get(it.id) ?? 0, inFrustum, tris: tris(it.o), transparent: it.transparent, culls: it.o.frustumCulled };
    });
    return rows;
  };
});
// The module's THREE is not global; borrow it from the renderer's scene
await page.evaluate(async () => { window.__THREE = await import('/node_modules/.vite/deps/three.js').catch(() => null) ?? await import('three'); });

const result = [];
await page.evaluate(() => __story.start());
for (const key of keys) {
  const n = await page.evaluate((k) => __story.beats(k), key);
  for (let i = 0; i < n; i++) {
    await page.evaluate(([k, b]) => __story.enter(k, b, { instant: true }), [key, i]);
    await page.waitForTimeout(+secs * 1000);
    const snap = await page.evaluate(() => {
      const s = window.__perf.snapshot;
      return { fps: s.fps, beat: __story.state.beat, hidden: __game.hooks.hidden, covered: __game.hooks.covered, passes: s.passes.map((p) => ({ label: p.label, n: +(+p.runs).toFixed(2), calls: Math.round(p.calls), tris: Math.round(p.tris) })), calls: s.calls, tris: s.tris };
    });
    const audit = await page.evaluate(() => window.__audit());
    const wasted = audit.filter((r) => r.inFrustum && r.px === 0);
    result.push({ key, i, ...snap, objects: audit.length, drawnNotSeen: wasted.length, wastedTris: wasted.reduce((a, r) => a + r.tris, 0), wasted, seen: audit.filter((r) => r.px > 0).length, audit });
    console.log(key, i, snap.beat, 'calls', snap.calls, 'tris', snap.tris, 'objects', audit.length, 'in view but unseen', wasted.length, wasted.reduce((a, r) => a + r.tris, 0));
  }
}
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(errors.slice(0, 10)));
await browser.close();
