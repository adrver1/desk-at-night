// Frame rate and performance panel, on every game page. It has three sizes:
//
//   fps   a small readout at the top, "60 fps · 18 ms" (frame rate and the
//         worst frame of the last half second). The default.
//   full  the whole panel, top left: tap the readout, press ` (left of 1),
//         or open the page with ?perf=1. Tap its first line to fold it back.
//   off   a faint "fps" tab, from "Hide" or ?fps=0. Tap it to get it back.
//
// The size is remembered between visits; ?fps=0, ?fps=1 and ?perf=1 in the
// URL override it. ` steps fps -> full -> off, Shift+` starts a scan.
//
// The full panel shows, every half second:
//   - frame rate, worst frame, and how the frame splits into GPU time, page
//     JavaScript (update) and three.js submitting draws (draw)
//   - draw calls, triangles, geometries, textures, shader programs
//   - one row per render pass (sky and sea, mirror, CCTV, room, characters…),
//     named from the scene and its render target, with draws, triangles,
//     CPU time and GPU time per frame
//   - one row per update step the page wraps in perfStep()
//
// GPU time comes from EXT_disjoint_timer_query_webgl2 where the browser has
// it (desktop Chrome, Firefox). Safari on the iPhone doesn't: there the GPU
// column is empty until "Sync GPU" is on (or ?perf=sync), which waits for the
// GPU after each pass (gl.finish) so CPU time then includes it. That slows
// the page, so read those numbers as shares, not absolutes.
//
// "Scan objects" times every single draw for a few frames and lists the most
// expensive objects, plus flags for likely savings (meshes that could be
// merged, objects drawn in many passes, heavy meshes, big textures). "Copy
// report" puts the whole readout on the clipboard, to paste into a chat.
//
// Trace markers: while the full panel is open, or with ?trace=1 (any size,
// so the page runs as normal), every pass and update step is also written
// as a User Timing measure ("render mirror: room", "step cctv"). A Chrome
// DevTools Performance recording shows them as named blocks in its Timings
// track, and a saved trace opens in Perfetto (ui.perfetto.dev). How to
// record one: docs/performance.md.
//
// Pages call perfPanel() once, hand their renderer over with
// perfWatch(renderer), wrap update steps in perfStep(name, fn), and can add
// a row of their own with perfRow(name, fn) (the sea's look, say). In the
// fps and off sizes all that costs a few performance.now() calls a frame.

import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const TRACE = q.has('trace') && q.get('trace') !== '0';
let sync = q.get('perf') === 'sync';
let view = (() => {   // 'fps' | 'full' | 'off'
  if (q.has('perf') && q.get('perf') !== '0') return 'full';
  if (q.has('fps')) return q.get('fps') === '0' ? 'off' : 'fps';
  let v = null;
  try { v = localStorage.getItem('fps'); } catch { /* private mode */ }
  return v === '0' || v === 'off' ? 'off' : v === 'full' ? 'full' : 'fps';
})();
const full = () => view === 'full';
const tracing = () => TRACE || view === 'full';

const WINDOW = 500;            // ms per readout
const SCAN_FRAMES = 30, SCAN_FRAMES_SYNC = 8;

const watched = [];            // { renderer, gl, ext, name, pending, pool }
const passes = new Map();      // label -> totals over the window
const rows = [];               // [name, fn] from the page
let current = null;            // label of the pass being drawn
let jsTime = 0;                // page JavaScript in animation frames, this window
let scan = null;               // a running or finished object scan
const steps = new Map();      // perfStep name -> { n, ms } this window

// ------------------------------------------------------------- measuring

// Time every animation frame callback, the page's update and render both,
// so the panel can tell JavaScript apart from drawing. Our own ticks use the
// original, so they don't count.
const raf = window.requestAnimationFrame.bind(window);
const measure = (name, start) => {
  if (!tracing()) return;
  try { performance.measure(name, { start, end: performance.now() }); } catch { /* old Safari */ }
};
window.requestAnimationFrame = (cb) => raf((t) => {
  const s = performance.now();
  try { cb(t); } finally { jsTime += performance.now() - s; measure('frame', s); }
});
// A recording keeps its own copy of the measures; the page's list would only grow
setInterval(() => { if (tracing()) performance.clearMeasures(); }, 2000);

// Time one update step: perfStep('cctv', () => cctv.update(...)). Returns
// what fn returns.
export function perfStep(name, fn) {
  const s = performance.now();
  try { return fn(); } finally {
    let st = steps.get(name);
    if (!st) steps.set(name, st = { n: 0, ms: 0 });
    st.n++;
    st.ms += performance.now() - s;
    measure(`step ${name}`, s);
  }
}

function totals(label) {
  let p = passes.get(label);
  if (!p) passes.set(label, p = { n: 0, calls: 0, tris: 0, other: 0, cpu: 0, gpu: 0, gpuN: 0, show: null });
  return p;
}

function labelOf(w, scene, target) {
  const s = scene.name || (scene.isScene ? 'scene' : scene.type);
  const t = target ? target.texture?.name || `${target.width}×${target.height}` : '';
  const l = t ? `${t}: ${s}` : s;
  return w.name === 'main' ? l : `${w.name} · ${l}`;
}

// Hand a renderer to the panel: its render() is wrapped to count and time
// each pass. Several renderers are fine (story mode's video call has one).
export function perfWatch(renderer, name = 'main') {
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const w = { renderer, gl, ext, name, pending: [], pool: [], depth: 0 };
  watched.push(w);
  const render = renderer.render;
  renderer.render = function (scene, camera) {
    const label = labelOf(w, scene, renderer.getRenderTarget());
    const info = renderer.info.render, before = { calls: info.calls, tris: info.triangles, other: info.points + info.lines };
    const outer = current;
    current = label;
    let query = null;
    const on = full(), wait = on && sync;
    if (wait) gl.finish();
    else if (on && ext && !scan?.running && w.depth === 0) {
      query = w.pool.pop() ?? gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    }
    w.depth++;
    const s = performance.now();
    try {
      render.call(this, scene, camera);
      if (wait) gl.finish();
    } finally {
      const cpu = performance.now() - s;
      measure(`render ${label}`, s);
      w.depth--;
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); w.pending.push({ query, label }); }
      current = outer;
      // With autoReset (the default) render() zeroes the counts first
      const fresh = renderer.info.autoReset;
      const p = totals(label);
      p.n++;
      p.calls += fresh ? info.calls : info.calls - before.calls;
      p.tris += fresh ? info.triangles : info.triangles - before.tris;
      p.other += fresh ? info.points + info.lines : info.points + info.lines - before.other;
      p.cpu += cpu;
      if (wait) { p.gpu += cpu; p.gpuN++; }
      p.target = renderer.getRenderTarget();
      p.scene = scene;
      p.renderer = w;
    }
  };
}

// A row of the page's own, e.g. perfRow('sea', () => 'C auto')
export function perfRow(name, fn) {
  rows.push([name, fn]);
}

// Collect finished GPU timer queries (they come back a frame or two later)
function collect() {
  for (const w of watched) {
    const { gl, ext } = w;
    if (!ext) continue;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {   // the clock jumped: throw the lot away
      for (const p of w.pending) w.pool.push(p.query);
      w.pending.length = 0;
      continue;
    }
    while (w.pending.length) {
      const { query, label } = w.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      w.pending.shift();
      const p = totals(label);
      p.gpu += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      p.gpuN++;
      w.pool.push(query);
    }
  }
}

// ---------------------------------------------------------------- scanning

function trisOf(obj, geo, group) {
  const pos = geo.attributes?.position;
  let count = geo.index ? geo.index.count : pos ? pos.count : 0;
  count = Math.min(count, geo.drawRange.count);
  if (group) count = Math.min(count, group.count);
  const instances = obj.isInstancedMesh ? obj.count : geo.isInstancedBufferGeometry ? geo.instanceCount : 1;
  return (obj.isMesh || obj.isSkinnedMesh ? count / 3 : obj.isSprite ? 2 : count) * (Number.isFinite(instances) ? instances : 1);
}

// Time every draw for a few frames. Three.js calls onBeforeRender and
// onAfterRender around each one, so those get wrapped: on the prototype, and
// on the few objects that bring their own.
function startScan() {
  if (scan?.running) return;
  const timer = watched.find((w) => w.ext && w.name === 'main') ?? watched.find((w) => w.ext);
  const draws = new Map(), textures = new Map(), targets = new Set();
  const own = [];
  const proto = THREE.Object3D.prototype, before0 = proto.onBeforeRender, after0 = proto.onAfterRender;
  const mode = sync || !timer ? 'sync' : 'timer';
  let open = null;   // { query | start, key }

  function before(renderer, scene, camera, geo, mat, group) {
    if (this.isScene || !mat) return;   // a Scene's own onBeforeRender has other arguments
    const w = watched.find((x) => x.renderer === renderer);
    const key = `${this.id}/${mat.id}/${current}`;
    let d = draws.get(key);
    if (!d) draws.set(key, d = { obj: this, mat, pass: current, draws: 0, tris: 0, gpu: 0, gpuN: 0 });
    d.draws++;
    d.tris += trisOf(this, geo, group);
    collectTextures(mat, textures);
    if (mode === 'timer' && w === timer && !open) {
      const query = timer.pool.pop() ?? timer.gl.createQuery();
      timer.gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, query);
      open = { query, d };
    } else if (mode === 'sync' && w) {
      w.gl.finish();
      open = { start: performance.now(), d, w };
    }
  }
  function after() {
    if (!open) return;
    if (open.query) {
      timer.gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
      scan.pending.push(open);
    } else {
      open.w.gl.finish();
      open.d.gpu += performance.now() - open.start;
      open.d.gpuN++;
    }
    open = null;
  }

  proto.onBeforeRender = function (...a) { before.apply(this, a); };
  proto.onAfterRender = function () { if (!this.isScene) after(); };
  // Objects with their own callbacks: chain ours in
  for (const p of passes.values()) {
    if (p.target) targets.add(p.target);
    p.scene?.traverse((o) => {
      if (Object.hasOwn(o, 'onBeforeRender') || Object.hasOwn(o, 'onAfterRender')) {
        const b = o.onBeforeRender, a = o.onAfterRender;
        own.push([o, b, a, Object.hasOwn(o, 'onBeforeRender'), Object.hasOwn(o, 'onAfterRender')]);
        o.onBeforeRender = function (...x) { before.apply(this, x); b.apply(this, x); };
        o.onAfterRender = function (...x) { a.apply(this, x); if (!this.isScene) after(); };
      }
    });
  }

  scan = {
    running: true, mode, frames: 0, length: mode === 'sync' ? SCAN_FRAMES_SYNC : SCAN_FRAMES,
    draws, textures, targets, pending: [], at: new Date(),
    stop() {
      proto.onBeforeRender = before0;
      proto.onAfterRender = after0;
      for (const [o, b, a, hb, ha] of own) {
        if (hb) o.onBeforeRender = b; else delete o.onBeforeRender;
        if (ha) o.onAfterRender = a; else delete o.onAfterRender;
      }
      this.running = false;
      this.result = analyse(this);
    },
  };
  // Free the pass timers for the scan
  for (const w of watched) if (w.ext) { for (const p of w.pending) w.pool.push(p.query); w.pending.length = 0; }
}

function scanTick() {
  if (!scan?.running) return;
  if (scan.mode === 'timer') {
    const { gl, ext } = watched.find((w) => w.ext && w.name === 'main') ?? watched.find((w) => w.ext);
    while (scan.pending.length && gl.getQueryParameter(scan.pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const { query, d } = scan.pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { d.gpu += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6; d.gpuN++; }
    }
  }
  if (++scan.frames >= scan.length && (scan.mode !== 'timer' || !scan.pending.length || scan.frames > scan.length + 30)) scan.stop();
}

function collectTextures(mat, into) {
  if (into.has(mat)) return;
  into.set(mat, true);
  const look = (v, key) => { if (v?.isTexture && !into.has(v)) into.set(v, { mat, key }); };
  for (const [key, v] of Object.entries(mat)) look(v, key);
  if (mat.uniforms) for (const [key, u] of Object.entries(mat.uniforms)) [].concat(u?.value).forEach((v) => look(v, key));
}

const BYTES = { [THREE.HalfFloatType]: 8, [THREE.FloatType]: 16, [THREE.UnsignedByteType]: 4 };
function textureBytes(t) {
  if (t.isCompressedTexture) return (t.mipmaps ?? []).reduce((a, m) => a + (m.data?.byteLength ?? 0), 0);
  const img = t.image ?? t.source?.data;
  const w = img?.width ?? img?.videoWidth ?? 0, h = img?.height ?? img?.videoHeight ?? 0;
  const mips = t.generateMipmaps && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1;
  return w * h * (BYTES[t.type] ?? 4) * mips;
}
function targetBytes(rt) {
  const depth = rt.depthBuffer || rt.depthTexture ? 4 : 0;
  return rt.width * rt.height * ((BYTES[rt.texture.type] ?? 4) + depth);
}

// An object's name and its parent's; unnamed ones by their geometry and scene
const nameOf = (o) => {
  const parts = [];
  for (let x = o; x && parts.length < 2; x = x.parent) if (x.name && !x.isScene && x.name !== 'Scene') parts.unshift(x.name);
  if (parts.length) return parts.join('/');
  let root = o;
  while (root.parent) root = root.parent;
  return `${(o.geometry?.type ?? o.type).replace(/(Buffer)?Geometry$/, '')} #${o.id}${root.name ? ` in ${root.name}` : ''}`;
};

function analyse(s) {
  const frames = s.frames;
  // Per object and material, over all the passes it was drawn in
  const byObj = new Map();
  for (const d of s.draws.values()) {
    const k = `${d.obj.id}/${d.mat.id}`;
    let o = byObj.get(k);
    if (!o) byObj.set(k, o = { obj: d.obj, mat: d.mat, draws: 0, tris: 0, gpu: 0, timed: 0, passes: new Set() });
    o.draws += d.draws / frames;
    o.tris += d.tris / frames;
    o.gpu += d.gpuN ? (d.gpu / d.gpuN) * (d.draws / frames) : 0;
    o.timed += d.gpuN;
    o.passes.add(d.pass);
  }
  const objects = [...byObj.values()].sort((a, b) => b.gpu - a.gpu || b.tris - a.tris);
  const total = objects.reduce((a, o) => a + o.gpu, 0);
  const flags = [];

  for (const o of objects.slice(0, 5)) if (total && o.gpu / total > 0.15) {
    flags.push(`${nameOf(o.obj)} takes ${Math.round(100 * o.gpu / total)}% of draw time (${o.mat.type}${o.mat.transparent ? ', transparent' : ''})`);
  }
  for (const o of objects) if (o.tris / Math.max(1, o.draws) > 100e3) {
    flags.push(`${nameOf(o.obj)}: ${k(o.tris / o.draws)} triangles in one draw, a lighter mesh or LOD?`);
  }
  for (const o of objects) if (o.passes.size >= 3 && o.tris > 5e3) {
    flags.push(`${nameOf(o.obj)} is drawn in ${o.passes.size} passes (${[...o.passes].join(', ')}), ${k(o.tris)} tris a frame; leave it out of some?`);
  }
  // Many small draws with one material in one pass: merge or instance
  const shared = new Map();
  for (const d of s.draws.values()) {
    const key = `${d.pass}|${d.mat.id}`;
    let g = shared.get(key);
    if (!g) shared.set(key, g = { pass: d.pass, mat: d.mat, objs: new Set(), tris: 0 });
    g.objs.add(d.obj.id);
    g.tris += d.tris / frames;
  }
  for (const g of shared.values()) if (g.objs.size >= 8 && g.tris / g.objs.size < 3000) {
    flags.push(`${g.objs.size} meshes share material "${g.mat.name || g.mat.type}" in ${g.pass} (${k(g.tris)} tris): merge or instance them to save ~${g.objs.size - 1} draws`);
  }
  // Textures and render targets
  const tex = [];
  for (const [t, mat] of s.textures) if (t.isTexture && mat !== true) {
    if (t.isRenderTargetTexture || t.isFramebufferTexture) continue;
    const img = t.image ?? {};
    const file = img.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:') ? img.src.split('/').pop().split('?')[0] : '';
    tex.push({ name: t.name || file || `${mat.mat.name || mat.mat.type}.${mat.key}`, w: img.width ?? 0, h: img.height ?? 0, bytes: textureBytes(t) });
  }
  for (const rt of s.targets) tex.push({ name: `target ${rt.texture.name || ''}`.trim(), w: rt.width, h: rt.height, bytes: targetBytes(rt), target: true });
  tex.sort((a, b) => b.bytes - a.bytes);
  for (const t of tex) if (!t.target && (t.w > 2048 || t.h > 2048)) flags.push(`texture ${t.name} is ${t.w}×${t.h} (${mb(t.bytes)}): 2048 is plenty on a phone`);
  const programs = watched[0]?.renderer.info.programs?.length ?? 0;
  if (programs > 40) flags.push(`${programs} shader programs: materials that differ only in colour could share one`);
  const transparent = objects.filter((o) => o.mat.transparent);
  if (transparent.length > 30) flags.push(`${transparent.length} transparent draws: they are sorted and overdraw each other`);

  return { objects, total, flags, textures: tex, mode: s.mode, frames };
}

// --------------------------------------------------------------- the panel

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k` : `${Math.round(n)}`);
const ms = (n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));
const mb = (b) => `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

let snapshot = null;   // the last readout, for the panel and the copied report

const gpuNames = new WeakMap();
function gpuName(gl) {
  if (gpuNames.has(gl)) return gpuNames.get(gl);
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const s = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const name = String(s).replace(/^ANGLE \((.*)\)$/, '$1').replace(/\s*\(0x[0-9a-f]+\)/gi, '').replace(/, Unspecified Version|Direct3D11 vs_5_0 ps_5_0, D3D11|OpenGL ES|, OpenGL 4.1/g, '').trim();
  gpuNames.set(gl, name);
  return name;
}

function readout(frames, span, worst) {
  collect();
  const list = [];
  let calls = 0, tris = 0, other = 0, cpu = 0, gpu = 0, gpuKnown = false;
  for (const [label, p] of passes) {
    if (!p.n) { passes.delete(label); continue; }   // not drawn for a whole window: gone
    if (p.gpuN) p.gpuAvg = p.gpu / p.gpuN;           // timer results lag; a pass that runs now and then keeps its last one
    const per = {
      label,
      runs: p.n / frames,
      calls: p.calls / frames, tris: p.tris / frames, other: p.other / frames,
      cpu: p.cpu / frames,
      gpu: p.gpuAvg != null ? p.gpuAvg * (p.n / frames) : null,
    };
    list.push(per);
    calls += per.calls; tris += per.tris; other += per.other; cpu += per.cpu;
    if (per.gpu != null) { gpu += per.gpu; gpuKnown = true; }
    Object.assign(p, { n: 0, calls: 0, tris: 0, other: 0, cpu: 0, gpu: 0, gpuN: 0 });
  }
  list.sort((a, b) => (b.gpu ?? b.cpu) - (a.gpu ?? a.cpu));
  const stepList = [...steps].map(([name, st]) => ({ name, ms: st.ms / frames, runs: st.n / frames })).sort((a, b) => b.ms - a.ms);
  steps.clear();
  const js = jsTime / frames;
  jsTime = 0;
  const main = watched.find((w) => w.name === 'main') ?? watched[0];
  const r = main?.renderer;
  const mem = performance.memory?.usedJSHeapSize;
  const size = r ? r.getDrawingBufferSize(new THREE.Vector2()) : null;
  return {
    fps: (frames * 1000) / span, frame: span / frames, worst,
    gpu: gpuKnown ? gpu : null, cpu, update: Math.max(0, js - cpu), js,
    calls, tris, other,
    geometries: r?.info.memory.geometries ?? 0, textures: r?.info.memory.textures ?? 0, programs: r?.info.programs?.length ?? 0,
    heap: mem ? mem / 1048576 : null,
    canvas: size ? `${size.x}×${size.y} @${r.getPixelRatio().toFixed(2).replace(/\.?0+$/, '')}x` : '',
    device: main ? gpuName(main.gl) : '',
    timer: sync ? 'sync' : main?.ext ? 'timer' : 'none',
    passes: list, steps: stepList,
    rows: rows.map(([n, fn]) => { try { return [n, fn()]; } catch { return [n, '?']; } }),
  };
}

export function perfReport() {
  const s = snapshot;
  if (!s) return '';
  const L = [];
  L.push(`${location.pathname.split('/').pop() || 'index.html'}${location.search} · ${new Date().toISOString().slice(0, 19)}Z`);
  L.push(`${navigator.userAgent}`);
  L.push(`${s.device} · ${s.canvas} · GPU timing: ${s.timer}`);
  L.push(`fps ${s.fps.toFixed(1)} · frame ${ms(s.frame)} ms · worst ${ms(s.worst)} ms`);
  L.push(`gpu ${s.gpu == null ? '–' : ms(s.gpu)} ms · update ${ms(s.update)} ms · draw (cpu) ${ms(s.cpu)} ms`);
  L.push(`draws ${Math.round(s.calls)} · tris ${k(s.tris)} · geometries ${s.geometries} · textures ${s.textures} · programs ${s.programs}${s.heap ? ` · heap ${s.heap.toFixed(0)} MB` : ''}`);
  for (const [n, v] of s.rows) L.push(`${n}: ${v}`);
  L.push('', 'pass                              runs  draws   tris  cpu ms  gpu ms');
  for (const p of s.passes) {
    L.push(`${p.label.padEnd(32).slice(0, 32)}  ${p.runs.toFixed(2).padStart(4)}  ${String(Math.round(p.calls)).padStart(5)}  ${k(p.tris).padStart(5)}  ${p.cpu.toFixed(2).padStart(6)}  ${p.gpu == null ? '     –' : p.gpu.toFixed(2).padStart(6)}`);
  }
  if (s.steps.length) {
    L.push('', 'update step                        runs  cpu ms');
    for (const st of s.steps) L.push(`${st.name.padEnd(32).slice(0, 32)}  ${st.runs.toFixed(2).padStart(4)}  ${st.ms.toFixed(2).padStart(6)}`);
  }
  const r = scan?.result;
  if (r) {
    L.push('', `scan (${r.mode}, ${r.frames} frames, per frame) at ${scan.at.toISOString().slice(11, 19)}Z`);
    L.push('object                                  material              passes  draws   tris   ms');
    for (const o of r.objects.slice(0, 25)) {
      L.push(`${nameOf(o.obj).padEnd(38).slice(0, 38)}  ${(o.mat.name || o.mat.type).padEnd(20).slice(0, 20)}  ${String(o.passes.size).padStart(6)}  ${o.draws.toFixed(1).padStart(5)}  ${k(o.tris).padStart(5)}  ${o.gpu.toFixed(2).padStart(5)}`);
    }
    L.push('', 'flags:', ...(r.flags.length ? r.flags.map((f) => `- ${f}`) : ['- none']));
    L.push('', 'textures and targets (estimated GPU memory):');
    for (const t of r.textures.slice(0, 15)) L.push(`- ${t.name} ${t.w}×${t.h} ${mb(t.bytes)}`);
    L.push(`- total ${mb(r.textures.reduce((a, t) => a + t.bytes, 0))}`);
  }
  return L.join('\n');
}

export function perfPanel({ parent = document.body } = {}) {
  const el = document.createElement('div');
  el.className = 'fps-counter perf-panel';   // fps-counter: story mode hides it unless ?fps=1 or ?perf
  el.setAttribute('role', 'button');
  const style = document.createElement('style');
  style.textContent = `
    .perf-panel { position: fixed; top: max(8px, env(safe-area-inset-top)); z-index: 1001; box-sizing: border-box;
      border-radius: 5px; background: #000000b0; color: #d8dee4; cursor: pointer;
      font: 400 10.5px/1.45 'JetBrains Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums;
      user-select: none; -webkit-user-select: none; touch-action: manipulation; }
    .perf-panel.fps, .perf-panel.off { left: 50%; transform: translateX(-50%); padding: 3px 8px; min-width: 44px; min-height: 24px;
      text-align: center; font-weight: 500; font-size: 11px; line-height: 18px; letter-spacing: 0.04em; white-space: nowrap; }
    .perf-panel.off { opacity: 0.35; }
    .perf-panel.full { left: max(8px, env(safe-area-inset-left)); max-width: min(calc(100vw - 16px), 400px); max-height: calc(100dvh - 16px);
      overflow: auto; padding: 6px 8px; cursor: default; background: #000000c8; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
    .perf-panel.full.right { left: auto; right: max(8px, env(safe-area-inset-right)); }
    .perf-panel b { font-weight: 500; color: #fff; }
    .perf-panel .head { cursor: pointer; white-space: nowrap; min-height: 22px; display: flex; align-items: center; gap: 8px; }
    .perf-panel .dim { color: #8b96a1; }
    .perf-panel table { border-collapse: collapse; width: 100%; margin-top: 4px; }
    .perf-panel td, .perf-panel th { padding: 1px 0 1px 8px; text-align: right; white-space: nowrap; font-weight: 400; }
    .perf-panel th { color: #8b96a1; }
    .perf-panel td:first-child, .perf-panel th:first-child { text-align: left; padding-left: 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
    .perf-panel tr.pass td:first-child { background: linear-gradient(90deg, #4a90d966 var(--w), transparent var(--w)); }
    .perf-panel .btns { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .perf-panel button { font: inherit; color: #d8dee4; background: #ffffff1a; border: 1px solid #ffffff2a; border-radius: 4px; padding: 4px 9px; min-height: 28px; cursor: pointer; }
    .perf-panel button.on { background: #e8d27a33; border-color: #e8d27a88; color: #f3e6a8; }
    .perf-panel .flags { margin: 4px 0 0; padding-left: 14px; color: #f3c98b; white-space: normal; }
    .perf-panel .flags li { margin: 2px 0; }
    .perf-panel .sec { margin-top: 6px; color: #8b96a1; text-transform: uppercase; letter-spacing: 0.06em; font-size: 9.5px; }
    .perf-panel textarea { width: 100%; height: 160px; font: inherit; font-size: 9px; background: #0008; color: #d8dee4; border: 1px solid #ffffff2a; margin-top: 6px; }`;
  document.head.appendChild(style);
  parent.appendChild(el);
  if (window !== window.top) el.classList.add('right');   // story mode's intro frame: clear of the story's own panel

  let frames = 0, since = performance.now(), last = since, worst = 0;
  let copied = null;
  const color = (fps) => (fps >= 50 ? '#9fe0a0' : fps >= 30 ? '#e8d27a' : '#ff8a7a');

  function draw() {
    el.className = `fps-counter perf-panel ${view}${el.classList.contains('right') ? ' right' : ''}`;
    el.title = view === 'full' ? '' : 'Frame rate: tap or ` for the performance panel';
    const s = snapshot;
    if (view === 'off') { el.textContent = 'fps'; el.style.color = ''; return; }
    if (view === 'fps') {
      el.textContent = s ? `${s.fps.toFixed(0)} fps · ${s.worst.toFixed(0)} ms` : '… fps';
      el.style.color = s ? color(s.fps) : '';
      return;
    }
    el.style.color = '';
    if (!s) { el.innerHTML = '<div class="head" data-act="fold">… perf</div>'; return; }
    const head = `<div class="head" data-act="fold" title="Fold to the frame rate"><b style="color:${color(s.fps)}">${s.fps.toFixed(0)} fps</b>`
      + `<span>${ms(s.frame)} ms</span><span class="dim">worst ${ms(s.worst)}</span>`
      + `<span>${Math.round(s.calls)} draws</span>${s.gpu != null ? `<span>gpu ${ms(s.gpu)}</span>` : ''}<span class="dim">▾</span></div>`;
    const frameGpu = s.gpu ?? 0;
    const share = (p) => (frameGpu ? (p.gpu ?? 0) / frameGpu : s.cpu ? p.cpu / s.cpu : 0);
    let h = head;
    h += `<div>gpu <b>${s.gpu == null ? '–' : ms(s.gpu)}</b> ms · update <b>${ms(s.update)}</b> · draw <b>${ms(s.cpu)}</b> <span class="dim">cpu ms</span></div>`;
    h += `<div>tris <b>${k(s.tris)}</b>${s.other ? ` · pts/lines ${k(s.other)}` : ''} · geo ${s.geometries} · tex ${s.textures} · progs ${s.programs}${s.heap ? ` · heap ${s.heap.toFixed(0)} MB` : ''}</div>`;
    h += `<div class="dim">${esc(s.canvas)} · ${esc(s.device).slice(0, 48)} · ${s.timer === 'timer' ? 'GPU timer' : s.timer === 'sync' ? 'sync GPU (slow)' : 'no GPU timer'}</div>`;
    for (const [n, v] of s.rows) h += `<div>${esc(n)} <b>${esc(v)}</b></div>`;
    h += '<table><tr><th>pass</th><th>×</th><th>draws</th><th>tris</th><th>cpu</th><th>gpu</th></tr>';
    for (const p of s.passes) {
      h += `<tr class="pass" style="--w:${Math.round(100 * share(p))}%"><td title="${esc(p.label)}">${esc(p.label)}</td><td class="dim">${p.runs < 0.995 ? p.runs.toFixed(2) : Math.round(p.runs)}</td><td>${Math.round(p.calls)}</td><td>${k(p.tris)}</td><td>${p.cpu.toFixed(1)}</td><td>${p.gpu == null ? '–' : p.gpu.toFixed(1)}</td></tr>`;
    }
    h += '</table>';
    if (s.steps.length) {
      h += '<table><tr><th>update step</th><th>×</th><th>cpu</th></tr>';
      for (const st of s.steps.slice(0, 10)) h += `<tr><td>${esc(st.name)}</td><td class="dim">${st.runs < 0.995 ? st.runs.toFixed(2) : Math.round(st.runs)}</td><td>${st.ms.toFixed(2)}</td></tr>`;
      h += '</table>';
    }
    if (scan?.running) h += `<div class="sec">scanning draws… ${scan.frames}/${scan.length}</div>`;
    const r = !scan?.running && scan?.result;
    if (r) {
      h += `<div class="sec">top objects · ${r.mode === 'timer' ? 'GPU ms' : 'ms incl. GPU wait'} per frame</div><table><tr><th>object</th><th>passes</th><th>tris</th><th>ms</th></tr>`;
      for (const o of r.objects.slice(0, 10)) {
        h += `<tr><td title="${esc(nameOf(o.obj))} · ${esc(o.mat.name || o.mat.type)} · ${esc([...o.passes].join(', '))}">${esc(nameOf(o.obj))}${o.mat.name === 'sun shadow depth' ? ' (shadow)' : ''}</td><td>${o.passes.size}</td><td>${k(o.tris)}</td><td>${o.gpu.toFixed(2)}</td></tr>`;
      }
      h += '</table>';
      const texTotal = r.textures.reduce((a, t) => a + t.bytes, 0);
      h += `<div class="dim">textures + targets ≈ ${mb(texTotal)}; biggest ${r.textures.slice(0, 3).map((t) => `${esc(t.name)} ${mb(t.bytes)}`).join(', ')}</div>`;
      h += r.flags.length ? `<div class="sec">could save</div><ul class="flags">${r.flags.slice(0, 8).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<div class="sec">no flags</div>';
    }
    h += `<div class="btns"><button data-act="scan">${scan?.running ? 'Scanning…' : 'Scan objects'}</button>`
      + `<button data-act="sync" class="${sync ? 'on' : ''}">Sync GPU${sync ? ' on' : ''}</button>`
      + `<button data-act="copy">${copied ? 'Copied' : 'Copy report'}</button>`
      + '<button data-act="off">Hide</button></div>';
    if (copied === false) h += `<textarea readonly>${esc(perfReport())}</textarea>`;
    el.innerHTML = h;
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem('fps', v === 'off' ? '0' : v === 'full' ? 'full' : '1'); } catch { /* private mode */ }
    frames = 0; since = last = performance.now(); worst = 0;
    for (const p of passes.values()) Object.assign(p, { gpu: 0, gpuN: 0, gpuAvg: null });
    draw();
  }

  function act(a) {
    if (a === 'open') setView('full');
    if (a === 'fold') setView('fps');
    if (a === 'off') setView('off');
    if (a === 'cycle') setView(view === 'fps' ? 'full' : view === 'full' ? 'off' : 'fps');
    if (a === 'scan') { if (view !== 'full') setView('full'); startScan(); }
    if (a === 'sync') { sync = !sync; for (const p of passes.values()) Object.assign(p, { gpu: 0, gpuN: 0, gpuAvg: null }); }
    if (a === 'copy') {
      const text = perfReport();
      const done = (ok) => { copied = ok; draw(); if (ok) setTimeout(() => { copied = null; draw(); }, 1500); };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
      else done(false);
    }
    draw();
  }

  // Keep taps from reaching the game underneath (look, use, zoom)
  for (const type of ['pointerdown', 'touchstart', 'mousedown', 'wheel']) {
    el.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (view === 'fps') return act('open');
    if (view === 'off') return act('fold');
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a) act(a);
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Backquote' && !e.repeat) act(e.shiftKey ? 'scan' : 'cycle');
  });

  function tick(now) {
    raf(tick);
    frames++;
    worst = Math.max(worst, now - last);
    last = now;
    scanTick();
    if (now - since >= WINDOW) {
      snapshot = readout(frames, now - since, worst);
      frames = 0; since = now; worst = 0;
      draw();
    }
  }
  draw();
  raf(tick);
  window.__perf = { report: perfReport, startScan, setView, get snapshot() { return snapshot; }, get scan() { return scan?.result; } };   // for qa/perf-shots.mjs

  return { el, setView, get view() { return view; } };
}
