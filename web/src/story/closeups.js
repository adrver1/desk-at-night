// Sharp close-up screens (Adriaen's pick 2026-10-31, option A "in place"):
// when a room screen fills a good part of the picture, its content is drawn
// into a plain 2D canvas in the page, laid exactly over the monitor with a
// CSS matrix3d and following the camera. The browser shows it at full
// resolution with no upload into WebGL: big WebGL screen textures took the
// Intel Arc laptop from 16 to 134 ms a frame, this costs about nothing
// (story.html?bench=closeup). Up to MAX screens at once, the biggest first;
// camera pictures (cctv.js, the workshop, the twin) stay in WebGL.
// Anything in front of the monitor would be hidden by the canvas, so it is
// for close-ups of screens with nobody in front. ?closeup=0 turns it off.
import { drawSlots, contentOf, isFeed } from '../screens.js';
import { LIVE } from '../controlScene.js';

const SHOW = 0.12, HIDE = 0.09;   // share of the picture a screen must cover to get (and keep) its canvas
const MAX = 2, HZ = 8, STATIC_T = 600;   // STATIC_T as in controlScene.js
// The in-world screens are drawn with the room's exposure; the canvas a touch
// dimmer than full white to sit with them. Painted into the canvas (black at
// this alpha = brightness 0.92) rather than a CSS filter, which made the
// browser composite the layer through an extra pass every frame.
const DIM = 0.08;

// The CSS matrix3d that maps a w×h box onto the quad p (four [x, y] corners:
// top left, top right, bottom right, bottom left)
function quadMatrix(w, h, p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (sx * dy2 - dx2 * sy) / det, hh = (dx1 * sy - sx * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  // the unit square onto the quad, after scaling the box down to it
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1].join(',')})`;
}

// The quad cut to the picture (Sutherland-Hodgman), and a polygon's area
function clip(poly, W, H) {
  const edges = [[(q) => q[0] >= 0, (a, b) => a[0] / (a[0] - b[0])], [(q) => q[0] <= W, (a, b) => (W - a[0]) / (b[0] - a[0])],
    [(q) => q[1] >= 0, (a, b) => a[1] / (a[1] - b[1])], [(q) => q[1] <= H, (a, b) => (H - a[1]) / (b[1] - a[1])]];
  for (const [inside, t] of edges) {
    const out = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) { const k = t(a, b); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
    });
    poly = out;
    if (!poly.length) break;
  }
  return poly;
}
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

// game: play.js's __game. Returns the per-frame step for hooks.frame.
export function closeups(game) {
  const host = game.renderer.domElement.parentNode;
  const pool = [];   // { canvas, name, drawn }
  for (let i = 0; i < MAX; i++) {
    const canvas = document.createElement('canvas');
    canvas.className = 'closeup';
    canvas.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;display:none;`;
    (pool[i - 1]?.canvas ?? game.renderer.domElement).after(canvas);
    pool.push({ canvas, name: null, drawn: -1, css: '' });
  }
  const v = new game.camera.position.constructor();
  // The screens don't move: each one's face is found once (faceFrame walks
  // the overlay's triangles), and feeds are known from the start
  const frames = new Map();
  const frameOf = (room, name) => { if (!frames.has(name)) frames.set(name, room.screenFrame(name, null)); return frames.get(name); };
  const hideAll = () => { for (const o of pool) { o.canvas.style.display = 'none'; o.name = null; } };
  return (dt, now) => {
    const room = game.room, cam = game.camera, slots = room?.meta.screens?.slots;
    if (!slots || game.hooks.hidden || game.hooks.covered) { hideAll(); return; }
    const W = host.clientWidth, H = host.clientHeight;
    cam.updateMatrixWorld();
    // Screens big in the picture, the biggest first
    const big = [];
    for (const name of Object.keys(slots)) {
      if (isFeed(contentOf(name))) continue;
      const f = frameOf(room, name);
      if (!f) continue;
      const p = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => {
        v.copy(f.at(s, t)).applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -cam.near) return null;
        v.applyMatrix4(cam.projectionMatrix);
        return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
      });
      if (p.some((x) => !x || x[0] < -W || x[0] > 2 * W || x[1] < -H || x[1] > 2 * H)) continue;   // reaching far off the picture
      const share = area(clip(p, W, H)) / (W * H);
      if (share >= (pool.some((o) => o.name === name) ? HIDE : SHOW)) big.push({ name, p, share });
    }
    big.sort((a, b) => b.share - a.share);
    const want = big.slice(0, MAX);
    // Keep each screen on the canvas it had, so it isn't redrawn for nothing
    const free = pool.filter((o) => !want.some((w) => w.name === o.name));
    for (const w of want) {
      const o = pool.find((x) => x.name === w.name) ?? free.shift();
      const [, , sw, sh] = slots[w.name], dpr = devicePixelRatio;
      const cssW = Math.hypot(w.p[1][0] - w.p[0][0], w.p[1][1] - w.p[0][1]), cssH = cssW * sh / sw;
      const pw = Math.max(1, Math.round(cssW * dpr)), ph = Math.max(1, Math.round(cssH * dpr));
      const c = o.canvas;
      if (o.name !== w.name || c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; o.drawn = -1; o.css = ''; }
      o.name = w.name;
      // only touch the style when it changes, so a still camera costs no restyle
      const css = `${cssW.toFixed(1)}px ${cssH.toFixed(1)}px ${quadMatrix(cssW, cssH, w.p)}`;
      if (o.css !== css) {
        o.css = css;
        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;
        c.style.transform = quadMatrix(cssW, cssH, w.p);
      }
      // live content moves with the story's clock; the rest is drawn as the
      // room's atlas has it (STATIC_T), so it only needs the clock now and then
      const live = LIVE.includes(contentOf(w.name));
      if (now / 1000 - o.drawn >= (live ? 1 / HZ : 1)) {
        o.drawn = now / 1000;
        const ctx = c.getContext('2d');
        drawSlots(ctx, { [w.name]: [0, 0, sw, sh] }, live ? STATIC_T + now / 1000 : STATIC_T, pw / sw, undefined, true);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = `rgba(0,0,0,${DIM})`;
        ctx.fillRect(0, 0, pw, ph);
        ctx.restore();
      }
      c.style.display = '';
    }
    for (const o of free) { o.canvas.style.display = 'none'; o.name = null; }
  };
}
