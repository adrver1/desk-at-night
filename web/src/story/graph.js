// The knowledge graph of Act 3: what the agents know and share (equipment,
// procedures, requirements, lessons, data), drawn with the 2D canvas so the
// same picture works on the display band and as a full-screen overlay. It
// grows a level at a time as agents use and add knowledge; new nodes pulse.
import { GRAPH } from './content.js';
import { T } from './lang.js';

export const KIND = {
  equipment: ['#9fb4c8', T('Utstyr', 'Equipment')],
  procedure: ['#f2b25c', T('Prosedyre', 'Procedure')],
  requirement: ['#b9a2f0', T('Krav', 'Requirement')],
  lesson: ['#f08a8a', T('Lærdom', 'Lesson')],
  data: ['#7fb0ff', T('Data', 'Data')],
  agent: ['#5fe0b7', T('Agent', 'Agent')],
};

const nodes = GRAPH.map(([id, label, kind, level, links, [x, y]]) => ({ id, label, kind, level, links, x, y }));
const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
const edges = nodes.flatMap((n) => n.links.filter((l) => byId[l]).map((l) => [n, byId[l]]));

// Draw the graph at growth `level` into a w × h box; `since` is seconds since
// the level last grew (new nodes pulse), `t` any running time (a gentle shimmer)
export function drawGraph(ctx, w, h, { level = 1, since = 99, t = 0, labels = true, legend = true, bg = '#0d1622' } = {}) {
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  const s = Math.min(w / 3.6, h / 2.3), cx = w / 2, cy = h / 2 + (legend ? -h * 0.035 : 0);
  const P = (n) => [cx + n.x * s, cy + n.y * s];
  const shown = (n) => n.level <= level;
  const fresh = (n) => n.level === level && since < 4;
  ctx.lineCap = 'round';
  for (const [a, b] of edges) {
    if (!shown(a) || !shown(b)) continue;
    const [x0, y0] = P(a), [x1, y1] = P(b);
    const hot = fresh(a) || fresh(b);
    ctx.strokeStyle = hot ? `rgba(95,224,183,${0.5 + 0.4 * Math.sin(since * 6)})` : 'rgba(150,175,200,0.28)';
    ctx.lineWidth = Math.max(1, s * (hot ? 0.012 : 0.006));
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  const r = Math.max(3, s * 0.035);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of nodes) {
    if (!shown(n)) continue;
    const [x, y] = P(n), [col] = KIND[n.kind];
    const pulse = fresh(n) ? 1 + 0.6 * Math.max(0, 1 - since / 4) * (0.5 + 0.5 * Math.sin(since * 8)) : 1 + 0.06 * Math.sin(t * 1.3 + n.x * 5);
    ctx.fillStyle = col + '33';
    ctx.beginPath(); ctx.arc(x, y, r * 2.2 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    if (n.kind === 'agent') ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.35); else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (labels) {
      ctx.font = `500 ${Math.max(9, s * 0.05)}px system-ui, sans-serif`;
      ctx.fillStyle = fresh(n) ? '#ffffff' : 'rgba(225,232,240,0.85)';
      ctx.fillText(n.label, x, y + r * 1.5);
    }
  }
  if (legend) {
    const kinds = Object.entries(KIND);
    ctx.font = `500 ${Math.max(9, s * 0.045)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = w * 0.04;
    const y = h - Math.max(14, s * 0.08);
    for (const [, [col, name]] of kinds) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(225,232,240,0.8)';
      ctx.fillText(name, x + r * 1.6, y);
      x += ctx.measureText(name).width + r * 5;
    }
  }
  return nodes.filter(shown).length;
}
