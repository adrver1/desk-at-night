// Flat preview of every screen in the control room (see screens.js)
import { screenFor, drawScreen } from './screens.js';

const WALL_SCREENS = [...Array(7)].map((_, i) => screenFor(`Wall${i}Screen`));
const DESK_SCREENS = [0, 1].map((k) => [...Array(6)].map((_, i) => screenFor(`Desk${k}Mon${i}Screen`)));
const LINK_SCREEN = screenFor('LinkScreen');

const canvas = document.getElementById('wall');
const ctx = canvas.getContext('2d');
const GAP = 16, WALL = [512, 288], MON = [320, 200], LINK = [512, 288];
const W = GAP + WALL_SCREENS.length * (WALL[0] / 1.6 + GAP);
const wallW = (W - GAP) / WALL_SCREENS.length - GAP, wallH = wallW * 9 / 16;
const monW = (W - GAP * 7) / 6, monH = monW * 10 / 16; // one row of six per desk
const H = GAP + wallH + GAP * 3 + (monH + GAP) * 2 + GAP * 2 + LINK[1] + GAP;
const dpr = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * dpr; canvas.height = H * dpr;

const frozen = new URLSearchParams(location.search).get('t');
const t0 = performance.now();

function place(fn, x, y, w, h, t, nativeW) {
  // Draw at the texture's native size, then scale into the preview slot
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / nativeW, w / nativeW);
  drawScreen(ctx, fn, nativeW, nativeW * h / w, t);
  ctx.restore();
}

function frame() {
  const t = frozen != null ? Number(frozen) : (performance.now() - t0) / 1000;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d0f12'; ctx.fillRect(0, 0, W, H);
  WALL_SCREENS.forEach((fn, i) => place(fn, GAP + i * (wallW + GAP), GAP, wallW, wallH, t, 1024));
  const y0 = GAP + wallH + GAP * 3;
  DESK_SCREENS.forEach((desk, k) => desk.forEach((fn, i) => {
    const x = GAP + i * (monW + GAP), y = y0 + k * (monH + GAP);
    place(fn, x, y, monW, monH, t, 640);
  }));
  place(LINK_SCREEN, GAP, y0 + (monH + GAP) * 2 + GAP * 2, LINK[0], LINK[1], t, 1024);
  if (frozen == null) requestAnimationFrame(frame);
}
frame();
