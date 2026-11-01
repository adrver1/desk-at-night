// The step-test report CtrlBuddy hands over in c.step, redrawn on the report
// screen as the web page it is (Adriaen, 2026-11-01: recreated, not a
// recording): its summary, the catalogue of manual-mode windows filtered to
// the likely step tests, and the best candidate's trace opening under its row.
// The data is public/story/reports/step-report.json (made up) or, with
// ?private=1, the real report's in story/private/reports/.
//
// drawStepReport(ctx, w, h, stage, age): stage 0 = the catalogue (scrolls
// from the top down to it, then the filter goes to the step tests), stage 1 =
// the best candidate (its trace opens, scrolls into view and draws). `age` is seconds since that message was sent.
import { PRIVATE, PRIVATE_BASE } from '../privateNames.js';

const FILE = 'step-report.json';
let data = null, asked = false;
function load(base) {
  if (asked) return;
  asked = true;
  const pub = () => fetch(base + FILE).then((r) => r.json());
  (PRIVATE ? fetch(`${PRIVATE_BASE}reports/${FILE}`).then((r) => (r.ok ? r.json() : pub())).catch(pub) : pub())
    .then((d) => { data = d; }).catch(() => {});
}

// The page's own look (light, magenta: as the report renders in a browser)
const P = {
  bg: '#f3f4f6', card: '#ffffff', line: '#e1e4e8', ink: '#17212b', dim: '#69727c', head: '#842849', accent: '#b62d65',
  callout: '#f8eaf1', calloutBar: '#bf3672', badge: '#f9e9f0', badgeLine: '#ecc8d8', th: '#faf6f8', win: 'rgba(0,138,89,0.10)',
};
const FONT = 'Lato, Arial, "Helvetica Neue", sans-serif';
const PAGE = 1280;        // the page's width in its own px; the screen shows it whole
const COL = [50, 1230];   // the content column (max-width 1180)
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const ramp = (age, a, b) => smooth((age - a) / (b - a));

function font(ctx, px, weight = 400) { ctx.font = `${weight} ${px}px ${FONT}`; }
function wrap(ctx, s, maxW) {
  const out = [];
  let line = '';
  for (const word of String(s).split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
function para(ctx, s, x, y, maxW, px, color, lh = 1.55, weight = 400) {
  font(ctx, px, weight);
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const lines = wrap(ctx, s, maxW);
  lines.forEach((l, i) => ctx.fillText(l, x, y + px + i * px * lh));
  return lines.length * px * lh;
}
function label(ctx, s, x, y, px, color, { weight = 400, align = 'left' } = {}) {
  font(ctx, px, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(s, x, y);
}
function round(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

// The page from the top, laid out as it is drawn: each part returns its height.
// `view` = { filter: 0..1 (all -> step tests), open: 0..1 (the best row's trace), draw: 0..1, cursor: 0..1 | null }
function page(ctx, d, view, measure) {
  const [x0, x1] = COL, cw = x1 - x0;
  let y = 0;
  // hero
  if (!measure) {
    const g = ctx.createLinearGradient(0, 0, PAGE, 220);
    g.addColorStop(0, '#812849'); g.addColorStop(1, '#c23979');
    ctx.fillStyle = g; ctx.fillRect(0, 0, PAGE, 218);
    label(ctx, d.hero.eyebrow.toUpperCase(), x0, 58, 13, 'rgba(255,255,255,0.85)');
    label(ctx, d.hero.title, x0, 104, 30, '#fff', { weight: 700 });
    label(ctx, d.hero.sub, x0, 140, 16, '#fff');
    let mx = x0;
    for (const m of d.hero.meta) { label(ctx, m, mx, 180, 14, 'rgba(255,255,255,0.92)'); font(ctx, 14); mx += ctx.measureText(m).width + 24; }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 218, PAGE, 48);
    ['Summary', 'Method', 'Period catalogue'].forEach((s, i) => label(ctx, s, x0 + i * 110, 248, 15, '#555'));
  }
  y = 296;
  // summary card
  const sumH = (() => {
    let h = 24 + 34;
    font(ctx, 16); h += wrap(ctx, d.summary[0], cw - 48).length * 16 * 1.55 + 14;
    h += wrap(ctx, d.summary[1], cw - 80).length * 16 * 1.55 + 28 + 24;
    return h;
  })();
  if (!measure) {
    round(ctx, x0, y, cw, sumH, 10, P.card, P.line);
    label(ctx, 'Summary', x0 + 24, y + 46, 22, P.head, { weight: 700 });
    let yy = y + 64;
    yy += para(ctx, d.summary[0], x0 + 24, yy, cw - 48, 16, P.ink) + 14;
    const ch = wrap(ctx, d.summary[1], cw - 80).length * 16 * 1.55 + 28;
    round(ctx, x0 + 24, yy, cw - 48, ch, 4, P.callout);
    ctx.fillStyle = P.calloutBar; ctx.fillRect(x0 + 24, yy, 4, ch);
    para(ctx, d.summary[1], x0 + 44, yy + 12, cw - 80, 16, P.ink);
  }
  y += sumH + 28;
  // catalogue card
  const cat = y;
  const rows = d.rows.filter((r, i) => view.filter < 0.5 || r.kind === 'step-test');
  const rowH = 64, traceH = view.open * 900;
  const tableH = 44 + rows.length * rowH + traceH;
  const catH = 24 + 34 + 70 + 92 + Math.min(tableH, 99999) + 24;
  if (!measure) {
    round(ctx, x0, y, cw, catH, 10, P.card, P.line);
    label(ctx, 'Period catalogue', x0 + 24, y + 46, 22, P.head, { weight: 700 });
    para(ctx, 'Use the assessment filter or search, and select a column heading to sort. Scores are preliminary screening estimates for suitability as an isolated model-identification record, not model-fit results or confidence in the assessment.', x0 + 24, y + 60, cw - 48, 15, P.ink, 1.5);
    // controls
    const cy = y + 150;
    label(ctx, 'Assessment', x0 + 24, cy, 15, '#45505b', { weight: 700 });
    const flash = view.filter > 0 && view.filter < 1 ? 1 - Math.abs(view.filter * 2 - 1) : 0;
    round(ctx, x0 + 24, cy + 10, 300, 40, 6, '#fff', flash > 0.1 ? P.head : '#c9cdd2');
    label(ctx, view.filter < 0.5 ? d.options[0] : d.options[1], x0 + 36, cy + 36, 15, P.ink, { weight: view.filter < 0.5 ? 400 : 700 });
    label(ctx, '▾', x0 + 306, cy + 35, 13, P.dim, { align: 'right' });
    label(ctx, 'Search', x0 + 344, cy, 15, '#45505b', { weight: 700 });
    round(ctx, x0 + 344, cy + 10, 260, 40, 6, '#fff', '#c9cdd2');
    label(ctx, 'Date, evidence or category', x0 + 356, cy + 36, 15, '#9aa2ab');
    round(ctx, x0 + 620, cy + 10, 120, 40, 6, '#fff', '#c9cdd2');
    label(ctx, 'Clear filters', x0 + 680, cy + 36, 15, P.ink, { align: 'center' });
    label(ctx, `Showing ${rows.length} of ${d.rows.length} periods`, x1 - 24, cy + 36, 15, '#5d6872', { align: 'right' });
    // table
    const ty = y + 222, tx = x0 + 24, tw = cw - 48;
    const cols = [0, 250, 352, 478, 598, 720, 1046].map((c) => tx + c);
    ctx.save(); ctx.beginPath(); ctx.rect(tx, ty, tw, tableH); ctx.clip();
    round(ctx, tx, ty, tw, tableH, 8, '#fff', P.line);
    ctx.fillStyle = P.th; ctx.fillRect(tx + 1, ty + 1, tw - 2, 43);
    d.heads.forEach((s, i) => label(ctx, s, cols[i] + 9, ty + 28, 13, P.head, { weight: 700 }));
    let ry = ty + 44;
    rows.forEach((r, i) => {
      const hot = i === 0 && view.open > 0;
      if (hot) { ctx.fillStyle = '#fbf3f7'; ctx.fillRect(tx + 1, ry, tw - 2, rowH); }
      ctx.fillStyle = P.line; ctx.fillRect(tx, ry + rowH - 1, tw, 1);
      label(ctx, r.win, cols[0] + 9, ry + 24, 13, P.ink);
      label(ctx, 'UTC', cols[0] + 9, ry + 42, 12, P.dim);
      label(ctx, r.dur, cols[1] + 9, ry + 24, 13, P.ink);
      label(ctx, r.moves, cols[2] + 9, ry + 24, 13, P.ink);
      font(ctx, 10); label(ctx, wrap(ctx, r.unit, 104)[0], cols[2] + 9, ry + 40, 10, P.dim);
      label(ctx, String(r.score), cols[3] + 9, ry + 24, 13, P.ink, { weight: 700 });
      round(ctx, cols[3] + 9, ry + 34, 90, 6, 3, '#eee');
      round(ctx, cols[3] + 9, ry + 34, 90 * r.score / 100, 6, 3, r.kind === 'step-test' ? P.accent : '#c79bb0');
      font(ctx, 12); const bw = ctx.measureText(r.assess).width + 20;
      round(ctx, cols[4] + 9, ry + 12, Math.min(bw, 118), 22, 11, r.kind === 'step-test' ? '#e6f4ec' : P.badge, r.kind === 'step-test' ? '#b9dfc8' : P.badgeLine);
      ctx.save(); ctx.beginPath(); ctx.rect(cols[4] + 9, ry + 8, 118, 30); ctx.clip();
      label(ctx, r.assess, cols[4] + 19, ry + 27, 12, r.kind === 'step-test' ? '#1f7a4c' : P.head);
      ctx.restore();
      font(ctx, 12); wrap(ctx, r.evidence, 310).slice(0, 3).forEach((l, k) => label(ctx, l, cols[5] + 9, ry + 20 + k * 15, 12, '#3c4650'));
      label(ctx, hot ? 'Hide trace' : 'Show trace', cols[6] + 9, ry + 24, 13, P.head);
      ctx.fillStyle = P.head; font(ctx, 13); ctx.fillRect(cols[6] + 9, ry + 27, ctx.measureText(hot ? 'Hide trace' : 'Show trace').width, 1);
      ry += rowH;
      if (i === 0 && traceH > 0) { trace(ctx, d.best, tx + 16, ry + 16, tw - 32, view); ry += traceH; }
    });
    ctx.restore();
  }
  return { catalogue: cat, chart: cat + 222 + 44 + rowH + 16 + 150, total: y + catH + 80 };
}

// The best candidate's trace: its stats and the four stacked panels, drawn
// left to right as `view.draw` goes 0..1, with a reading cursor at `view.cursor`
function trace(ctx, b, x, y, w, view) {
  label(ctx, b.title, x, y + 30, 22, P.head, { weight: 700 });
  b.stats.forEach(([k, v, sub], i) => {
    const cx = x + i * (w + 10) / 4, cw = (w - 30) / 4;
    round(ctx, cx, y + 48, cw, 88, 8, '#fff', '#e3e5e8');
    label(ctx, k, cx + 14, y + 70, 12, P.dim);
    label(ctx, v, cx + 14, y + 100, 21, P.accent, { weight: 700 });
    label(ctx, sub, cx + 14, y + 124, 12, P.dim);
  });
  const top = y + 150, H = 700, L = x + 90, R = x + w - 40, plotH = H - 120;
  round(ctx, x, top, w, H, 6, '#fff', P.line);
  label(ctx, b.plotTitle, x + 60, top + 30, 17, '#2a3f5f');
  const tx = (t) => L + (t / b.span) * (R - L);
  const t1 = b.span * view.draw;
  for (const p of b.panels) {
    const py0 = top + 72 + (1 - p.domain[1]) * plotH, py1 = top + 72 + (1 - p.domain[0]) * plotH;
    const [lo, hi] = p.range, yv = (v) => py1 - ((v - lo) / (hi - lo)) * (py1 - py0);
    label(ctx, p.title, L, py0 - 8, 15, '#2a3f5f');
    // the likely step test, marked once the trace is in: swept across left to right (Adriaen, 2026-11-01)
    if (view.mark > 0) { ctx.fillStyle = P.win; ctx.fillRect(tx(b.window[0]), py0, (tx(b.window[1]) - tx(b.window[0])) * view.mark, py1 - py0); }
    // gridlines and ticks
    ctx.strokeStyle = '#eceef1'; ctx.lineWidth = 1;
    const ticks = p.ticks ?? niceTicks(lo, hi).map((v) => [v, String(v)]);
    for (const [v, s] of ticks) {
      const yy = yv(v); if (yy < py0 || yy > py1) continue;
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(R, yy); ctx.stroke();
      label(ctx, s, L - 8, yy + 4, 11, '#444', { align: 'right' });
    }
    ctx.save(); ctx.translate(x + 26, (py0 + py1) / 2); ctx.rotate(-Math.PI / 2);
    label(ctx, p.ytitle, 0, 0, 12, '#2a3f5f', { align: 'center' }); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(L, py0 - 2, tx(t1) - L, py1 - py0 + 4); ctx.clip();
    for (const tr of p.traces) {
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1.4; ctx.setLineDash(tr.dash ? [3, 3] : []);
      ctx.beginPath();
      tr.pts.forEach(([t, v], i) => {
        const X = tx(t), Y = yv(v);
        if (!i) ctx.moveTo(X, Y);
        else if (tr.step) { ctx.lineTo(X, yv(tr.pts[i - 1][1])); ctx.lineTo(X, Y); } else ctx.lineTo(X, Y);
      });
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // legend
    const lw = Math.max(...p.traces.map((tr) => { font(ctx, 11); return ctx.measureText(tr.name).width; })) + 52;
    round(ctx, R - lw - 8, py0 + 8, lw, 10 + p.traces.length * 18, 0, 'rgba(255,255,255,0.85)', '#aab0b8');
    p.traces.forEach((tr, i) => {
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5; ctx.setLineDash(tr.dash ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(R - lw, py0 + 23 + i * 18); ctx.lineTo(R - lw + 28, py0 + 23 + i * 18); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, tr.name, R - lw + 34, py0 + 27 + i * 18, 11, '#2a3f5f');
    });
    // the cursor's readings
    if (view.cursor != null) {
      const ct = b.span * view.cursor, X = tx(ct);
      ctx.strokeStyle = '#7d858d'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(X, py0); ctx.lineTo(X, py1); ctx.stroke(); ctx.setLineDash([]);
      p.traces.forEach((tr, i) => {
        const v = valueAt(tr, ct); if (v == null) return;
        ctx.fillStyle = tr.color; ctx.beginPath(); ctx.arc(X, yv(v), 4, 0, Math.PI * 2); ctx.fill();
        const s = p.ticks ? (v > 0.5 ? 'AUTO' : 'MAN') : v.toFixed(1);
        round(ctx, X + 8, yv(v) - 11 + i * 2, 50, 20, 3, tr.color);
        label(ctx, s, X + 33, yv(v) + 3 + i * 2, 11, '#fff', { align: 'center', weight: 700 });
      });
    }
  }
  // time axis
  const yb = top + 72 + plotH;
  for (let m = Math.ceil(b.start / 60) * 60; m <= b.start + b.span; m += 60) {
    const X = tx(m - b.start), hh = Math.floor(m / 60) % 24;
    label(ctx, `${String(hh).padStart(2, '0')}:00`, X, yb + 18, 11, '#444', { align: 'center' });
  }
  label(ctx, b.day, L, yb + 33, 11, '#444');
  label(ctx, 'Time (UTC)', (L + R) / 2, yb + 34, 12, '#2a3f5f', { align: 'center' });
}
function niceTicks(lo, hi) {
  const span = hi - lo, step = [1, 2, 5, 10, 20, 25, 50, 100].map((s) => s).find((s) => span / s <= 5) ?? 100;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}
function valueAt(tr, t) {
  let prev = null;
  for (const p of tr.pts) { if (p[0] > t) return prev ? prev[1] : p[1]; prev = p; }
  return prev?.[1];
}

export function drawStepReport(ctx, w, h, stage, age, base) {
  load(base);
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, w, h);
  if (!data) return;
  const k = w / PAGE, vh = h / k;
  // the scroll and the page's state along this message's timeline
  const view = { filter: 0, open: 0, draw: 0, mark: 0, cursor: null };
  let scroll = 0;
  const at = (v) => page(ctx, data, v, true);
  if (stage === 0) {
    view.filter = ramp(age, 4.4, 4.9);
    const m = at(view);
    scroll = ramp(age, 0.8, 3.8) * (m.catalogue - 60);   // one smooth scroll down to it (Adriaen, 2026-11-01)
  } else {
    Object.assign(view, { filter: 1, open: ramp(age, 1.0, 1.8), draw: ramp(age, 3.4, 5.6), mark: ramp(age, 5.9, 7.1) });
    const m = at({ ...view, open: 1 });
    const chartTop = m.catalogue + 222 + 44 + 64 + 16 + 150;
    scroll = (m.catalogue - 60) + ramp(age, 1.6, 3.4) * (chartTop - 56 - (m.catalogue - 60));
  }
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(0, -scroll);
  page(ctx, data, view, false);
  ctx.restore();
  // the page's sticky nav once scrolled past it
  if (scroll > 218) {
    ctx.save(); ctx.scale(k, k);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE, 48);
    ctx.fillStyle = 'rgba(0,0,0,0.06)'; ctx.fillRect(0, 48, PAGE, 2);
    ['Summary', 'Method', 'Period catalogue'].forEach((s, i) => label(ctx, s, COL[0] + i * 110, 30, 15, '#555'));
    ctx.restore();
  }
}
