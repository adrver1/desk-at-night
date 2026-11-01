// Story mode benchmark (story.html?bench=1, Adriaen 2026-10-31): plays the
// heaviest beats under each pixel ratio with multisampling (?aa=msaa), then
// reloads with FXAA (?aa=fxaa) and with neither (?aa=0) and plays them
// again, and shows one table to copy into a chat.
// Per beat and setting: frame rate, and GPU time per frame where the browser
// has a GPU timer (desktop Chrome, Edge, Firefox), read from perf.js.
// Results carry across the reload in sessionStorage. Frames over 40 ms are
// listed with what they did (uploads, shader compiles, page code time), both
// while a beat plays and on the jump into it.
//
// URL: ?bench=1 (all), ?bench=quick (three beats, two ratios),
// ?bench=closeup (close-up beats with the sharp close-up canvases of
// closeups.js and without, ?closeup=0, at the page's own pixel ratio),
// ?bench=bakes and ?bench=bakesquick (the room's light maps at each size, and
// what they cost to load; needs a server that picks the files by ?variant=,
// so it starts and ends on today's maps to show if the laptop got hot).
// Each pass is a reload with its own URL options (?benchpass=N).
const BEATS = ['c.sim', 'm.build', 'm.twin', 'm.what1', 't.coffee', 'new.ctrl08', 'h.s1', 'ep.line'];
const AA = [{ aa: 'msaa' }, { aa: 'fxaa' }, { aa: '0', label: 'no aa' }];
const BAKES = [
  { label: 'today' },
  { variant: 'final_3072', label: 'new bake' },
  { label: 'today again' },
];
const MODES = {
  full: { beats: BEATS, ratios: 5, passes: AA },
  quick: { beats: ['c.sim', 'm.what1', 'ep.line'], ratios: 2, passes: AA },
  closeup: { beats: ['c.step', 'c.sim', 'm.build', 'm.twin', 'ep.line', 'm.what1'], ratios: 0,
    passes: [{ closeup: '0', label: 'no closeups' }, { label: 'closeups' }] },
  bakes: { beats: ['c.step', 'c.sim', 'm.build', 'm.twin', 'ep.line', 'm.what1'], ratios: 0, passes: BAKES, warm: 60000, post: true },
  bakesquick: { beats: ['c.sim', 'm.what1'], ratios: 0, passes: BAKES, warm: 60000, post: true },
};
const OPTIONS = ['aa', 'closeup', 'sharp', 'variant'];
const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';   // the URL options passes set
const SETTLE = 1500, MEASURE = 3000;   // ms per beat and setting
const KEY = 'storyBench';

const q = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) ?? null; } catch { return null; } }
function save(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: one pass only */ } }

// What each frame did, to tell why a long one was long: the time spent in
// the page's own code (from the first frame hook to the end of the story's
// render hooks), the textures uploaded (canvas to WebGL, slow on the Arc
// laptop) and shader programs compiled
const LONG = 40;   // ms: a frame this long is listed
function tagger(game) {
  const gl = game.renderer.getContext(), info = game.renderer.info;
  let cur = { up: 0, px: 0, sizes: [] };
  for (const k of ['texImage2D', 'texSubImage2D']) {
    const f = gl[k].bind(gl);
    gl[k] = (...a) => {
      const src = a.find((x) => x && typeof x === 'object' && 'width' in x && 'height' in x);
      const w = src ? src.width : typeof a[3] === 'number' ? a[3] : 0, h = src ? src.height : typeof a[4] === 'number' ? a[4] : 0;
      if (w * h >= 64 * 64) { cur.up++; cur.px += w * h; if (cur.sizes.length < 4) cur.sizes.push(`${w}×${h}`); }
      return f(...a);
    };
  }
  const frames = [];   // newest last: { at, js, up, px, sizes, shaders }
  game.hooks.frame.unshift(() => {
    cur = { at: performance.now(), up: 0, px: 0, sizes: [], programs: info.programs?.length ?? 0, steps: {} };
    if (window.__perf) window.__perf.frameLog = cur.steps;   // perf.js adds each step and pass of this frame
  });
  game.hooks.render.push(() => {
    cur.js = performance.now() - cur.at;
    cur.shaders = (info.programs?.length ?? 0) - cur.programs;
    frames.push(cur);
    if (frames.length > 600) frames.shift();
  });
  // the record of the last frame started before rAF time `now` (the one whose
  // work ran up to it)
  return (now) => { for (let i = frames.length - 1; i >= 0; i--) if (frames[i].at < now) return frames[i]; return null; };
}
const slowSteps = (st) => Object.entries(st ?? {}).filter(([, ms]) => ms >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, ms]) => `${k} ${ms.toFixed(0)}`).join(', ');
const tagText = (f) => (f ? `js ${f.js.toFixed(0)} ms${slowSteps(f.steps) ? ` (${slowSteps(f.steps)})` : ''}${f.up ? ` · ${f.up} uploads ${(f.px / 1e6).toFixed(1)} Mpx (${f.sizes.join(', ')})` : ''}${f.shaders ? ` · ${f.shaders} new shaders` : ''}` : '');

// The longest frame over `ms` from now, with what it and the frame before did
async function longest(ms, tagOf) {
  let first = null, last = null, worst = { ms: 0 };
  await new Promise((done) => {
    const tick = (now) => {
      if (first == null) first = now;
      if (last != null && now - last > worst.ms) worst = { ms: now - last, tag: [tagOf?.(last), tagOf?.(now)].filter(Boolean).map(tagText).join(' | then ') };
      last = now;
      if (now - first < ms) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  return worst;
}

// Frame rate from requestAnimationFrame over `ms`, and the perf panel's
// last GPU readings over the same time
async function measure(ms, tagOf) {
  const gpu = [], room = [], passes = {};
  let frames = 0, first = null, last = null, worst = 0, worstTag = '';
  await new Promise((done) => {
    const tick = (now) => {
      if (first == null) first = now;
      if (last != null && now - last > worst) { worst = now - last; worstTag = [tagOf?.(last), tagOf?.(now)].filter(Boolean).map(tagText).join(' | then '); }
      frames++; last = now;
      if (now - first < ms) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
    const poll = setInterval(() => {
      const s = window.__perf?.snapshot;
      if (s?.gpu != null) gpu.push(s.gpu);
      const r = s?.passes?.find((p) => p.label === 'room');
      if (r?.gpu != null) room.push(r.gpu);
      for (const x of s?.passes ?? []) if (x.gpu != null) (passes[x.label] ??= []).push(x.gpu);
      if (last != null && last - first >= ms) clearInterval(poll);
    }, 500);
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const top = Object.entries(passes).map(([l, v]) => [l, avg(v)]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return { fps: ((frames - 1) * 1000) / (last - first), worst, worstTag, gpu: avg(gpu), room: avg(room), top };
}

// What the room's baked files cost this page load: when it was ready to play,
// the download inside that, and the maps' size on the GPU (read from the PNG
// headers: width × height × 4 bytes, a third more for mipmaps)
async function loadCost(label, readyMs, capped) {
  const baked = performance.getEntriesByType('resource').filter((e) => /\/control\/(light_\w+\.png|albedo\.png|scene\.glb)/.test(e.name));
  const pngs = baked.filter((e) => e.name.includes('.png')).map((e) => e.name);
  const sizes = await Promise.all(pngs.map(async (name) => {
    const head = new DataView(await (await fetch(name, { headers: { Range: 'bytes=0-23' } })).arrayBuffer());
    return [head.getUint32(16), head.getUint32(20)];
  }));
  return {
    label, readyMs, capped,
    downloadMs: baked.length ? Math.max(...baked.map((e) => e.responseEnd)) - Math.min(...baked.map((e) => e.startTime)) : 0,
    fileMb: baked.reduce((n, e) => n + e.decodedBodySize, 0) / 1e6,
    gpuMb: sizes.reduce((n, [w, h]) => n + (w * h * 4 * 4) / 3, 0) / 1e6,
    sizes: sizes.map(([w]) => w).join(' '),
  };
}

function show(results, info, running) {
  let el = document.getElementById('benchOut');
  if (!el) {
    el = document.createElement('div');
    el.id = 'benchOut';
    el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99;max-width:min(560px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:rgba(10,14,13,.92);color:#e4ebe8;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:10px 12px;border-radius:6px;white-space:pre';
    document.body.append(el);
  }
  const text = report(results, info);
  el.textContent = running ? `${running}\n\n${text}` : text;
  if (!running) {
    const b = document.createElement('button');
    b.textContent = 'Copy';
    b.style.cssText = 'display:block;margin-top:8px;font:inherit;padding:4px 12px';
    const select = () => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); };
    // no navigator.clipboard on plain http, as when served from another machine
    b.onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(text).then(() => { b.textContent = 'Copied'; }, select) : select());
    el.append(b);
  }
}

function report(results, info) {
  const L = [`story bench · build ${info.build}${info.builds?.length > 1 ? ` (passes ran different builds: ${info.builds.join(' / ')}, reload and run again)` : ''} · ${info.device} · ${info.css} CSS px · devicePixelRatio ${info.dpr} · GPU timer ${info.timer ? 'yes' : 'no'}`, navigator.userAgent, ''];
  const settings = [...new Set(results.map((r) => r.setting))];
  L.push(`${'setting'.padEnd(14)} ${'fps'.padStart(5)} ${'gpu ms'.padStart(7)} ${'room ms'.padStart(8)} ${'worst ms'.padStart(9)}   (averaged over beats; worst = longest frame; slowest beat)`);
  for (const s of settings) {
    const rs = results.filter((r) => r.setting === s);
    const avg = (k) => { const v = rs.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const worst = rs.reduce((a, r) => (r.fps < a.fps ? r : a), rs[0]);
    const f = (x, d = 1) => (x == null ? '–' : x.toFixed(d));
    const hitch = Math.max(...rs.map((r) => r.worst ?? 0));
    L.push(`${s.padEnd(14)} ${f(avg('fps')).padStart(5)} ${f(avg('gpu')).padStart(7)} ${f(avg('room')).padStart(8)} ${f(hitch, 0).padStart(9)}   ${worst.beat} ${f(worst.fps)} fps`);
  }
  L.push('', 'per beat (fps / gpu ms / longest frame ms / longest frame of the jump into it ms):', `${'beat'.padEnd(12)} ${settings.map((s) => s.padStart(18)).join('')}`);
  for (const beat of [...new Set(results.map((r) => r.beat))]) {
    L.push(`${beat.padEnd(12)} ${settings.map((s) => { const r = results.find((x) => x.beat === beat && x.setting === s); return (r ? `${r.fps.toFixed(0)}/${r.gpu == null ? '–' : r.gpu.toFixed(1)}/${(r.worst ?? 0).toFixed(0)}/${(r.jump ?? 0).toFixed(0)}` : '').padStart(18); }).join('')}`);
  }
  if (info.loads?.length) {
    L.push('', 'load (page start to ready ms / download ms / files MB / maps on the GPU MB / map widths):');
    for (const l of info.loads) L.push(`${l.label.padEnd(14)} ${`${l.capped ? '>' : ''}${l.readyMs.toFixed(0)}`.padStart(7)} ${l.downloadMs.toFixed(0).padStart(7)} ${l.fileMb.toFixed(1).padStart(6)} ${l.gpuMb.toFixed(0).padStart(6)}   ${l.sizes}`);
  }
  if (info.lost) L.push('', `WebGL context lost ${info.lost} times (out of GPU memory, most likely)`);
  // Where the GPU time goes in the slowest beats
  const slow = [...results].sort((a, b) => a.fps - b.fps).filter((r) => r.top?.length).slice(0, 4);
  if (slow.length) L.push('', 'slowest beats, top passes (gpu ms):', ...slow.map((r) => `${r.beat} · ${r.setting}: ${r.top.map(([l, ms]) => `${l} ${ms.toFixed(1)}`).join(' · ')}`));
  // The longest frames, while playing (steady) and on the jump into a beat,
  // with what that frame and the one before it did
  const long = results.flatMap((r) => [{ r, ms: r.worst, tag: r.worstTag, when: 'playing' }, { r, ms: r.jump, tag: r.jumpTag, when: 'jump' }])
    .filter((x) => x.ms > LONG).sort((a, b) => b.ms - a.ms).slice(0, 10);
  if (long.length) L.push('', `frames over ${LONG} ms (what the frame before and that frame did):`, ...long.map((x) => `${x.r.beat} · ${x.r.setting} · ${x.when} ${x.ms.toFixed(0)} ms: ${x.tag || '–'}`));
  return L.join('\n');
}

// story: { start, goto, game } from main.js
export async function runBench(story) {
  // the GPU timer needs the full perf panel
  if (!q.has('perf')) { q.set('perf', '1'); location.search = q.toString(); return; }
  const mode = MODES[q.get('bench')] ?? MODES.full, beats = mode.beats;
  const renderer = story.game.renderer;
  // Each pass: its URL options, then a reload; the results carry over
  // (`run` makes each reload a new URL, so no pass gets an old cached page)
  const go = (i) => { for (const k of OPTIONS) q.delete(k); for (const [k, v] of Object.entries(mode.passes[i])) if (k !== 'label') q.set(k, v); q.set('benchpass', i); q.set('run', Date.now().toString(36)); location.search = q.toString(); };
  // A pass carries on only from the pass before it, with that run's results
  // and its own URL options; anything else (say, an old bench URL opened
  // again) starts the run over
  const pass = q.has('benchpass') ? +q.get('benchpass') : -1, passOpts = mode.passes[pass], saved = load();
  const fits = passOpts && OPTIONS.every((k) => (q.get(k) ?? undefined) === (passOpts[k] ?? undefined));
  if (!fits || (pass > 0 && (saved?.mode !== q.get('bench') || saved?.pass !== pass - 1))) { go(0); return; }
  const label = passOpts.label ?? passOpts.aa;
  const state = pass > 0 ? saved : { results: [] };
  state.mode = q.get('bench'); state.pass = pass;
  state.builds = [...new Set([...(state.builds ?? []), BUILD])];
  // As in the presentation, where the warm-up runs behind the Begin screen:
  // otherwise the first beat's jump times shader compiles and first uploads
  story.game.renderer.domElement.addEventListener('webglcontextlost', () => { state.lost = (state.lost ?? 0) + 1; save(state); });
  const warmedBy = mode.warm ?? 15000;
  const capped = await Promise.race([story.game.hooks.warmed.then(() => false), wait(warmedBy).then(() => true)]);
  if (mode.post) (state.loads ??= []).push(await loadCost(label, performance.now(), capped));
  story.start();
  document.querySelector('.iris')?.remove();
  window.__perf?.setView?.('full');
  const dpr = devicePixelRatio;
  const ratios = mode.ratios ? [...new Set([Math.min(dpr, 2), 1.5, 1.25, 1, 0.75].filter((r) => r <= Math.max(dpr, 1) + 1e-6))].slice(0, mode.ratios) : [renderer.getPixelRatio()];
  const gl = renderer.getContext();
  const info = { build: BUILD, device: window.__perf?.snapshot?.device ?? '', css: `${innerWidth}×${innerHeight}`, dpr: +dpr.toFixed(2), timer: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')) };
  const before = renderer.getPixelRatio();
  const tagOf = tagger(story.game);
  for (const r of ratios) {
    renderer.setPixelRatio(r);
    for (const beat of beats) {
      const setting = mode.ratios ? `${label} @${r}` : label;
      show(state.results, info, `running: ${setting} · ${beat}`);
      const g0 = performance.now();
      if (!story.goto(beat)) continue;
      const gotoMs = performance.now() - g0;
      const j = await longest(SETTLE, tagOf);
      const m = await measure(MEASURE, tagOf);
      state.results.push({ setting, beat, ...m, jump: j.ms, jumpTag: `goto ${gotoMs.toFixed(0)} ms | ${j.tag}` });
      save(state);
    }
  }
  renderer.setPixelRatio(before);
  save(state);
  if (pass < mode.passes.length - 1) { go(pass + 1); return; }
  info.builds = state.builds;
  info.loads = state.loads;
  info.lost = state.lost;
  show(state.results, info, null);
  if (mode.post) fetch('bench-report', { method: 'POST', body: report(state.results, info) }).catch(() => { /* the Copy button still has it */ });
  try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
}
