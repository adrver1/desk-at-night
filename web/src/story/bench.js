// Story mode benchmark (story.html?bench=1, Adriaen 2026-10-31): plays the
// heaviest beats under each pixel ratio, with antialiasing on, then reloads
// with ?aa=0 and plays them again, and shows one table to copy into a chat.
// Per beat and setting: frame rate, and GPU time per frame where the browser
// has a GPU timer (desktop Chrome, Edge, Firefox), read from perf.js.
// Results carry across the reload in sessionStorage.
//
// URL: ?bench=1 (all), ?bench=quick (three beats, two ratios).
const BEATS = ['c.sim', 'm.build', 'm.twin', 'm.what1', 't.coffee', 'new.ctrl08', 'h.s1', 'ep.line'];
const QUICK = ['c.sim', 'm.what1', 'ep.line'];
const SETTLE = 1500, MEASURE = 3000;   // ms per beat and setting
const KEY = 'storyBench';

const q = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) ?? null; } catch { return null; } }
function save(v) { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: one pass only */ } }

// Frame rate from requestAnimationFrame over `ms`, and the perf panel's
// last GPU readings over the same time
async function measure(ms) {
  const gpu = [], room = [];
  let frames = 0, first = null, last = null;
  await new Promise((done) => {
    const tick = (now) => {
      if (first == null) first = now;
      frames++; last = now;
      if (now - first < ms) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
    const poll = setInterval(() => {
      const s = window.__perf?.snapshot;
      if (s?.gpu != null) gpu.push(s.gpu);
      const r = s?.passes?.find((p) => p.label === 'room');
      if (r?.gpu != null) room.push(r.gpu);
      if (last != null && last - first >= ms) clearInterval(poll);
    }, 500);
  });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { fps: ((frames - 1) * 1000) / (last - first), gpu: avg(gpu), room: avg(room) };
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
    b.onclick = () => navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copied'; }, () => { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); });
    el.append(b);
  }
}

function report(results, info) {
  const L = [`story bench · ${info.device} · ${info.css} CSS px · devicePixelRatio ${info.dpr} · GPU timer ${info.timer ? 'yes' : 'no'}`, navigator.userAgent, ''];
  const settings = [...new Set(results.map((r) => r.setting))];
  L.push(`${'setting'.padEnd(14)} ${'fps'.padStart(5)} ${'gpu ms'.padStart(7)} ${'room ms'.padStart(8)}   (averaged over beats; slowest beat)`);
  for (const s of settings) {
    const rs = results.filter((r) => r.setting === s);
    const avg = (k) => { const v = rs.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const worst = rs.reduce((a, r) => (r.fps < a.fps ? r : a), rs[0]);
    const f = (x, d = 1) => (x == null ? '–' : x.toFixed(d));
    L.push(`${s.padEnd(14)} ${f(avg('fps')).padStart(5)} ${f(avg('gpu')).padStart(7)} ${f(avg('room')).padStart(8)}   ${worst.beat} ${f(worst.fps)} fps`);
  }
  L.push('', 'per beat (fps / gpu ms):', `${'beat'.padEnd(12)} ${settings.map((s) => s.padStart(12)).join('')}`);
  for (const beat of [...new Set(results.map((r) => r.beat))]) {
    L.push(`${beat.padEnd(12)} ${settings.map((s) => { const r = results.find((x) => x.beat === beat && x.setting === s); return (r ? `${r.fps.toFixed(0)}/${r.gpu == null ? '–' : r.gpu.toFixed(1)}` : '').padStart(12); }).join('')}`);
  }
  return L.join('\n');
}

// story: { start, goto, game } from main.js
export async function runBench(story) {
  // the GPU timer needs the full perf panel
  if (!q.has('perf')) { q.set('perf', '1'); location.search = q.toString(); return; }
  const quick = q.get('bench') === 'quick';
  const beats = quick ? QUICK : BEATS;
  const renderer = story.game.renderer;
  const aa = q.get('aa') !== '0';
  let state = load();
  if (!aa && !state) state = { results: [] };   // opened straight with aa=0
  if (aa) state = { results: [] };               // the first pass starts over
  story.start();
  document.querySelector('.iris')?.remove();
  window.__perf?.setView?.('full');
  const dpr = devicePixelRatio;
  const ratios = [...new Set([Math.min(dpr, 2), 1.5, 1.25, 1, 0.75].filter((r) => r <= Math.max(dpr, 1) + 1e-6))].slice(0, quick ? 2 : 5);
  const gl = renderer.getContext();
  const info = { device: window.__perf?.snapshot?.device ?? '', css: `${innerWidth}×${innerHeight}`, dpr: +dpr.toFixed(2), timer: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')) };
  const before = renderer.getPixelRatio();
  for (const r of ratios) {
    renderer.setPixelRatio(r);
    for (const beat of beats) {
      const setting = `${aa ? 'aa' : 'no aa'} @${r}`;
      show(state.results, info, `running: ${setting} · ${beat}`);
      if (!story.goto(beat)) continue;
      await wait(SETTLE);
      const m = await measure(MEASURE);
      state.results.push({ setting, beat, ...m });
      save(state);
    }
  }
  renderer.setPixelRatio(before);
  if (aa) { q.set('aa', '0'); location.search = q.toString(); return; }   // the second pass, without antialiasing
  show(state.results, info, null);
  try { sessionStorage.removeItem(KEY); } catch { /* fine */ }
}
