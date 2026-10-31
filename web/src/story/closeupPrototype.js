// PROTOTYPE (throwaway, 2026-10-31): how should a screen the story shows
// close up look sharp without big WebGL texture uploads (slow on the Intel
// Arc laptop)? The screen's content is drawn into a plain 2D canvas in the
// page, which the browser shows at full resolution with no upload into WebGL.
//   ?closeup=a  in place: the canvas laid exactly over the monitor in the
//               picture (CSS matrix3d), following the camera
//   ?closeup=b  card: the canvas as a flat card over the dimmed picture, like
//               the slides
// Only for a live screen that covers at least MIN of the picture.
import { drawSlots, contentOf, isFeed } from '../screens.js';

const MIN = 0.12, HZ = 8, STATIC_T = 600;

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
  // unit square -> quad, then scale the box down to the unit square
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.join(',')})`;
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
const polyArea = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0)) / 2;

export function closeupPrototype(game, look) {
  const host = game.renderer.domElement.parentNode;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;display:none;filter:brightness(0.92)';
  const dim = document.createElement('div');
  dim.style.cssText = 'position:absolute;inset:0;background:rgba(5,8,10,.55);pointer-events:none;display:none';
  game.renderer.domElement.after(dim, canvas);
  if (look === 'b') Object.assign(canvas.style, { left: '50%', top: '46%', transform: 'translate(-50%,-50%)', borderRadius: '10px', boxShadow: '0 20px 60px rgba(0,0,0,.6)', filter: 'none' });
  let shown = null, drawn = -1;
  const v = new game.camera.position.constructor();
  return (dt, now) => {
    const room = game.room, cam = game.camera, slots = room?.meta.screens?.slots;
    if (!slots || game.hooks.hidden || game.hooks.covered) { canvas.style.display = dim.style.display = 'none'; return; }
    const W = host.clientWidth, H = host.clientHeight;
    cam.updateMatrixWorld();
    // The biggest screen in view, by its share of the picture
    let best = null;
    for (const name of Object.keys(slots)) {
      if (isFeed(contentOf(name))) continue;
      const f = room.screenFrame(name, cam.position);
      if (!f) continue;
      const p = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, w]) => { v.copy(f.at(u, w)).applyMatrix4(cam.matrixWorldInverse); if (v.z > -cam.near) return null; v.applyMatrix4(cam.projectionMatrix); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; });
      if (p.some((x) => !x || x[0] < -W || x[0] > 2 * W || x[1] < -H || x[1] > 2 * H)) continue;   // not reaching far off the picture
      const area = polyArea(clip(p, W, H));
      const share = Math.min(1, area / (W * H));
      if (share >= MIN && (!best || share > best.share)) best = { name, p, share };
    }
    if (!best) { canvas.style.display = dim.style.display = 'none'; shown = null; return; }
    const [, , sw, sh] = slots[best.name], dpr = devicePixelRatio;
    // CSS size: as wide as it shows (a), or 72% of the picture (b)
    const cssW = look === 'b' ? Math.min(W * 0.72, H * 0.78 * sw / sh) : Math.hypot(best.p[1][0] - best.p[0][0], best.p[1][1] - best.p[0][1]);
    const cssH = cssW * sh / sw;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; drawn = -1; }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (look !== 'b') canvas.style.transform = quadMatrix(cssW, cssH, best.p);
    if (shown !== best.name || now / 1000 - drawn >= 1 / HZ) {
      shown = best.name; drawn = now / 1000;
      drawSlots(canvas.getContext('2d'), { [best.name]: [0, 0, sw, sh] }, STATIC_T + now / 1000, pw / sw, undefined, true);
    }
    canvas.style.display = '';
    dim.style.display = look === 'b' ? '' : 'none';
  };
}
