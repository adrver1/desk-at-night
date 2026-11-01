// A live slide on a room screen (Adriaen, 2026-11-01; ctrl-08s in kg/slides.js):
// a slide def with `screen` is drawn by the same LiveSlide as always, but its
// box is laid over that monitor's face with a CSS matrix3d that follows the
// camera (as closeups.js does for the screens' own content). The camera stays
// on the screen until the click `zoomAt`, then pulls back to `zoomShot`, the
// screen and the person at it (`who`), and the slide's green two-way arrow is
// drawn in the room between them, in the slide's chunky style.
import * as THREE from 'three';
import { quadMatrix } from './closeups.js';
import { LiveSlide } from './kg/engine.js';
import { LIVE_SLIDES } from './kg/slides.js';

const BOX = [1280, 720];   // the slide's layout size (story.css .slide.onscreen)
const GREEN = '#1a9f6e', HALO = '#f7f5f0';
const FLY = 1.4;   // s for the slide to fly from the full screen onto the monitor
const FLY_DOWN = new URLSearchParams(location.search).get('flydown') === '1';   // the old fly-down entry, kept behind ?flydown=1

export function screenSlide(o) {
  const { game, ui, shots, host } = o;   // o.cast is read each frame: the cast loads later
  const canvas = document.createElement('canvas');
  canvas.className = 'room-arrow';
  host.append(canvas);
  const c = canvas.getContext('2d');
  const v = new THREE.Vector3();
  let shown = false, zoomT = null, thinkT = null, frame = null, frameOf = null;
  let from = null, enterT = 0, lastOverlay = null, lastFull = false;   // the full-screen slide before it, to fly down from

  const project = (p, W, H) => {
    const cam = game.camera;
    v.copy(p).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -cam.near) return null;
    v.applyMatrix4(cam.projectionMatrix);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  };
  const clear = () => c.clearRect(0, 0, canvas.width, canvas.height);

  return (state, now) => {
    const lv = ui.live, def = lv?.def, el = ui.el.slide;
    const on = Boolean(def?.screen && state.overlay === `slide:${def.id}` && game.room && !game.hooks.hidden);
    // coming from a slide on the full screen (h-02 before ctrl-08s): the box flies from where that
    // slide stood down onto the monitor while the camera moves in (Adriaen, 2026-11-01)
    if (on && !shown) {
      from = null;
      // (Adriaen, 2026-11-01, ctrl-13s after ctrl-12) not a fly-down any more: cut to the room with the
      // slide small on its monitor, and zoom in on it as any monitor shot does
      if (FLY_DOWN && lastOverlay?.startsWith('slide:') && lastOverlay !== state.overlay && !el.classList.contains('onscreen')) {
        const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect(), x0 = r.left - hr.left, y0 = r.top - hr.top, x1 = x0 + r.width, y1 = y0 + r.height;
        from = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        enterT = now;
      }
    }
    // (Adriaen, 2026-11-01, ctrl-13s after ctrl-12) from a full-screen slide, not a fly-down any more: cut
    // to the room with the slide small on its monitor, then zoom in on it as any monitor shot does; on the
    // overlay's change, before the live slide is built, so the camera never sets off from the old shot
    if (state.overlay !== lastOverlay) {
      const to = state.overlay?.startsWith('slide:') ? LIVE_SLIDES[state.overlay.slice(6)] ?? {} : null;
      if (!FLY_DOWN && to?.screen && lastFull) shots.cut(to.zoomShot ?? 'agentDesk');
      if (to) lastFull = !to.screen; else if (state.overlay) lastFull = false;   // through a null overlay it holds
    }
    lastOverlay = state.overlay;
    el.classList.toggle('onscreen', on);
    if (!on) {
      if (shown) { el.style.transform = ''; clear(); shown = false; zoomT = null; }
      return;
    }
    shown = true;
    const zoom = lv.build >= def.zoomAt;
    shots.go(zoom ? def.zoomShot : `monitor:${def.screen}`);
    if (frameOf !== def.screen) { frame = game.room.screenFrame(def.screen, null); frameOf = def.screen; }
    if (!frame) return;
    const W = host.clientWidth, H = host.clientHeight;
    game.camera.updateMatrixWorld();
    let p = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => project(frame.at(s, t), W, H));
    if (p.some((x) => !x)) { el.style.transform = 'scale(0)'; return; }
    if (from) {
      // on the camera's own clock while it glides in, so the two land together even when frames are slow
      const t = shots.k < 1 ? shots.k : Math.min(1, (now - enterT) / FLY), e = t * t * (3 - 2 * t);
      p = p.map(([x, y], i) => [from[i][0] + (x - from[i][0]) * e, from[i][1] + (y - from[i][1]) * e]);
      if (t >= 1) from = null;
    }
    el.style.transform = quadMatrix(...BOX, p);

    // the arrow, once the camera has pulled back
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    clear();
    if (!zoom || shots.k < 1) { zoomT = null; return; }
    zoomT ??= now;
    const k = Math.min(1, (now - zoomT) / 0.8);
    const head = o.cast?.head(def.who);
    const hp = head && project(head, W, H);
    if (!hp) return;
    // from the screen's side nearest the person to just short of their head
    const side = [0, 1].map((s) => project(frame.at(s, 0.45), W, H));
    const a0 = side.sort((m, n) => Math.hypot(m[0] - hp[0], m[1] - hp[1]) - Math.hypot(n[0] - hp[0], n[1] - hp[1]))[0];
    const d = Math.hypot(hp[0] - a0[0], hp[1] - a0[1]) || 1, ux = (hp[0] - a0[0]) / d, uy = (hp[1] - a0[1]) / d;
    const u = H / 720;
    const ax = a0[0] + ux * 18 * u, ay = a0[1] + uy * 18 * u, bx = hp[0] - ux * 70 * u, by = hp[1] - uy * 70 * u;
    const bend = -0.25 * Math.sign(ux || 1);   // bowing up, over the desk (Adriaen, 2026-11-01)
    const mx = (ax + bx) / 2 - (by - ay) * bend, my = (ay + by) / 2 + (bx - ax) * bend;
    const q = (t) => [(1 - t) ** 2 * ax + 2 * (1 - t) * t * mx + t * t * bx, (1 - t) ** 2 * ay + 2 * (1 - t) * t * my + t * t * by];
    c.save();
    c.scale(dpr, dpr);
    c.fillStyle = GREEN;
    c.shadowColor = '#0008'; c.shadowBlur = 12 * u;
    if (def.roomArrow) LiveSlide.prototype.chunky.call({ U: () => 16 * u }, { both: true }, k, q, GREEN, c);   // ctrl-13z: no arrow, a thought
    c.shadowBlur = 0;
    if (def.roomArrow && k > 0.5) {
      // the words follow the arrow, on its outside, read left to right (Adriaen, 2026-11-01)
      c.globalAlpha = Math.min(1, (k - 0.5) * 2);
      c.font = `700 ${Math.round(22 * u)}px "Instrument Sans", system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 6 * u; c.strokeStyle = HALO; c.lineJoin = 'round';
      const N = 60, pts = [], len = [0];
      const ltr = bx >= ax, at = (t) => q(ltr ? t : 1 - t);
      for (let i = 0; i <= N; i++) pts.push(at(i / N));
      for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = len[N], text = def.roomArrow, wTot = c.measureText(text).width, off = 30 * u;
      let s0 = L / 2 - wTot / 2;
      for (const ch of text) {
        const w = c.measureText(ch).width, sm = s0 + w / 2;
        let i = 1; while (i < N && len[i] < sm) i++;
        const f = (sm - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        const ang = Math.atan2(y1 - y0, x1 - x0);
        let nx = Math.sin(ang), ny = -Math.cos(ang);   // left of the travel direction, up on screen for left to right
        if (ny > 0) { nx = -nx; ny = -ny; }
        c.save();
        c.translate(x0 + (x1 - x0) * f + nx * off, y0 + (y1 - y0) * f + ny * off);
        c.rotate(ang);
        c.strokeText(ch, 0, 0); c.fillText(ch, 0, 0);
        c.restore();
        s0 += w;
      }
    }
    c.restore();
    if (def.think && lv.build >= def.thinkAt) drawThink(c, def.think, hp, u, dpr, now - (thinkT ??= now));
    else thinkT = null;
  };
}

// A thought bubble over the person's head: a cloud with the words, two little
// puffs trailing down to them (ctrl-13z; Adriaen, 2026-11-01)
function drawThink(c, text, hp, u, dpr, since) {
  const k = Math.min(1, since / 0.45), e = 1 - (1 - k) ** 3;
  c.save();
  c.scale(dpr, dpr);
  c.font = `600 ${Math.round(24 * u)}px "Instrument Sans", system-ui, sans-serif`;
  const tw = c.measureText(text).width, w = tw + 70 * u, h = 84 * u;
  const cx = hp[0] - 70 * u, cy = hp[1] - 185 * u;
  c.globalAlpha = e;
  c.fillStyle = HALO; c.strokeStyle = '#1b2a33'; c.lineWidth = 2.5 * u;
  c.shadowColor = '#0006'; c.shadowBlur = 14 * u;
  const puff = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.stroke(); };
  // the trail first, from the head up
  puff(hp[0] - 8 * u, hp[1] - 58 * u, 7 * u * e);
  puff(hp[0] - 24 * u, hp[1] - 90 * u, 11 * u * e);
  // the cloud: bumps round an ellipse, drawn as one filled path then outlined
  const rx = w / 2 * (0.85 + 0.15 * e), ry = h / 2 * (0.85 + 0.15 * e), n = 11;
  c.beginPath();
  for (let i = 0; i <= n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry], p1 = [cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry];
    if (i === 0) c.moveTo(...p0);
    if (i < n) c.quadraticCurveTo(cx + Math.cos(am) * rx * 1.22, cy + Math.sin(am) * ry * 1.3, ...p1);
  }
  c.closePath();
  c.fill(); c.shadowBlur = 0; c.stroke();
  c.fillStyle = '#1b2a33'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, cx, cy + 1 * u);
  c.restore();
}
