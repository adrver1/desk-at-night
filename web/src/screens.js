// Content for the control room's screens, drawn with the 2D canvas API so it
// can move: trends scroll, alarms arrive, the clock runs. Every screen is a
// pure function of the shift time t (seconds), so the preview page and the
// room's canvas textures show the same thing. All data is made up.
//
// Style: a dark "high-performance HMI" (after ISA-101). Grey for normal,
// colour only for what needs attention, so a calm screen reads as calm.
//
// Where the content comes from. Nothing is truly random: every value is a
// fixed function of t, so a given moment always looks the same.
//   calculated  a small made-up process model (`sim` below), e.g. the
//               separator level cycling under a sticky valve, or the
//               compressor bearing temperature creeping up over the shift
//   noise       wobble(): a few summed sine waves that look like process
//               noise around a fixed value
//   scripted    fixed lists played back in order over time (the alarm pool,
//               the assistant's steps, the alarm-rate bars)
//   static      text and numbers written into the layout (tags, labels,
//               targets, the shift log, procedure titles, ESD status)
// Each screen function below says which of these it uses.

const C = {
  bg: '#24282c', panel: '#2e3338', line: '#454b52', dim: '#7d858d', text: '#c9ced3', bright: '#eef1f3',
  value: '#9fd3ff', ai: '#8fe3c0', p1: '#ff5a4f', p2: '#ffb347', p3: '#f2e266', ok: '#7fbf7f',
};
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ---------------------------------------------------------------- the made-up process

const SHIFT_START = (2 * 60 + 10) * 60; // the night shift picks up at 02:10

// The weather and time outside, from outdoor.js (its `cctv` summary), and the
// shift time t at which it was last set. Without it the screens show a calm
// night, as before.
let outside = null, outsideAt = 0;
export function setOutside(o, t) { outside = o; outsideAt = t; }

// Cameras with a live 3D picture (cctv.js): their screens draw only what
// lies on top of it (rain on the lens, sensor noise, caption), on a clear
// canvas, and the picture shows through
const feeds = new Set();
export function setFeeds(ids) { feeds.clear(); for (const id of ids) feeds.add(id); }
export const isFeed = (id) => feeds.has(id);

// Smooth deterministic wobble, -1..1
function wobble(t, seed) {
  return (Math.sin(t * 0.37 + seed * 1.7) + Math.sin(t * 0.91 + seed * 4.1) * 0.5 + Math.sin(t * 2.3 + seed * 7.3) * 0.25) / 1.75;
}

// Separator level under a sticky valve: the controller winds up, the valve
// jumps, the level overshoots. A slow limit cycle with stair-step valve moves.
const STICK_PERIOD = 46;
function valvePos(t) {
  const phase = (((t / STICK_PERIOD) % 1) + 1) % 1;
  return phase < 0.5 ? 38 : 47;
}
function sepLevel(t) {
  const phase = (((t / STICK_PERIOD) % 1) + 1) % 1;
  const tri = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4; // -1..1, rising while the valve sits closed
  return 50 + 7 * tri + 0.6 * wobble(t, 3);
}

export const sim = {
  clock: (t) => {
    const s = ((Math.floor(outside ? outside.time * 3600 + (t - outsideAt) : SHIFT_START + t) % 86400) + 86400) % 86400;
    return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  },
  sepLevel, valvePos,
  sepPressure: (t) => 31.4 + 0.25 * wobble(t, 1),
  compDischarge: (t) => 142 + 1.2 * wobble(t, 2),
  bearingTemp: (t) => 78 + 6 * (1 - Math.exp(-Math.max(0, t) / 400)) + 0.3 * wobble(t * 2, 5), // creeping up over the shift
  compSpeed: (t) => 9850 + 40 * wobble(t, 6),
  oil: (t) => 18.2 + 0.25 * wobble(t * 0.3, 7) - 0.3 * Math.max(0, wobble(t / STICK_PERIOD * 6, 0)),
  gas: (t) => 4.1 + 0.08 * wobble(t * 0.3, 8),
  water: (t) => 6.3 + 0.15 * wobble(t * 0.3, 9),
  flare: (t) => 0.9 + 0.35 * Math.max(0, wobble(t * 0.2, 10)),
  wind: (t) => (outside ? 3 + outside.wind * 22 : 14) * (1 + 0.15 * wobble(t * 0.15, 11)),
  windDir: (t) => 235 + 12 * wobble(t * 0.1, 12),
  // Significant wave height for a sea grown fully under the mean wind
  waves: (t) => (outside ? 0.4 + 0.017 * (3 + outside.wind * 22) ** 2 : 2.6) + 0.2 * wobble(t * 0.05, 13),
  visibility: () => (outside ? 0.2 + 30 * (1 - outside.fog) ** 2.5 : 9),     // km
  cloudBase: () => (outside ? Math.round((4500 - 3800 * outside.clouds) / 100) * 100 : 1400), // ft
  gen: (i, t) => [62, 58, 0][i] + (i < 2 ? 3 * wobble(t * 0.4, 14 + i) : 0),
};

// Alarms arrive through the shift; the list shows the most recent ones
const ALARM_POOL = [
  [2, '20-LAH-1012', 'HP separator level high'],
  [3, '23-TI-2240', 'Compressor DE bearing temp rising'],
  [3, '44-PDI-4410', 'Cooling medium filter dP high'],
  [2, '20-LAL-1012', 'HP separator level low'],
  [3, '62-AI-6201', 'Produced water OiW analyser fault'],
  [1, '23-XA-2201', 'Compressor anti-surge valve deviation'],
  [3, '80-UA-8003', 'Gas turbine C on standby, not ready'],
  [2, '43-FAH-4301', 'Flare header flow high'],
  [3, '27-PI-2702', 'Fuel gas pressure low (warn)'],
  [3, '50-LI-5005', 'Diesel day tank level low'],
];
const ALARM_EVERY = 17;
export function alarms(t, n) {
  const newest = Math.floor(t / ALARM_EVERY) + 6;
  const out = [];
  for (let k = newest; k > newest - n && k >= 0; k--) {
    const [p, tag, text] = ALARM_POOL[(k * 7) % ALARM_POOL.length];
    out.push({ p, tag, text, time: sim.clock((k - 6) * ALARM_EVERY), acked: k < newest - 2, fresh: k === newest && (t % ALARM_EVERY) < 4 });
  }
  return out;
}
const alarmRate = (k) => [9, 11, 8, 14, 10, 7, 12, 9, 6, 10, 13, 8][((k % 12) + 12) % 12]; // per 10 min

// ---------------------------------------------------------------- drawing helpers

function font(ctx, px, weight = 500, mono = false) {
  ctx.font = `${weight} ${px}px ${mono ? MONO : SANS}`;
}
function text(ctx, s, x, y, { px = 14, color = C.text, weight = 500, align = 'left', mono = false } = {}) {
  font(ctx, px, weight, mono);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function rect(ctx, x, y, w, h, fill, stroke) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
}
const S = (w) => w / 640; // scale factor so layouts work at any texture size

// Title strip common to every screen
function header(ctx, w, title, t, right) {
  const s = S(w), h = 30 * s;
  rect(ctx, 0, 0, w, h, C.panel);
  text(ctx, title, 12 * s, 20 * s, { px: 14 * s, weight: 600, color: C.bright });
  text(ctx, right ?? sim.clock(t), w - 12 * s, 20 * s, { px: 13 * s, color: C.dim, align: 'right', mono: true });
  return h;
}

// Scrolling trend of f over the last `span` seconds, with optional limits
function trend(ctx, x, y, w, h, t, f, { span = 240, lo, hi, color = C.value, limits = [], label, unit = '', decimals = 1, step = false } = {}) {
  const s = Math.max(0.6, h / 120);
  rect(ctx, x, y, w, h, C.bg, C.line);
  ctx.strokeStyle = C.line; ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x, y + (h * k) / 4 + 0.5); ctx.lineTo(x + w, y + (h * k) / 4 + 0.5); ctx.stroke(); }
  const yOf = (v) => y + h - ((v - lo) / (hi - lo)) * h;
  for (const [v, col] of limits) {
    ctx.strokeStyle = col; ctx.setLineDash([4 * s, 4 * s]);
    ctx.beginPath(); ctx.moveTo(x, yOf(v)); ctx.lineTo(x + w, yOf(v)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = color; ctx.lineWidth = 1.6 * s; ctx.beginPath();
  const n = Math.ceil(w / 2);
  let prev;
  for (let i = 0; i <= n; i++) {
    const px = x + (i / n) * w, v = f(t - span + (i / n) * span), py = yOf(v);
    if (i === 0) ctx.moveTo(px, py);
    else if (step) { ctx.lineTo(px, prev); ctx.lineTo(px, py); } else ctx.lineTo(px, py);
    prev = py;
  }
  ctx.stroke(); ctx.restore();
  if (label) {
    text(ctx, label, x + 6 * s, y + 14 * s, { px: 11 * s, color: C.dim });
    text(ctx, `${f(t).toFixed(decimals)} ${unit}`, x + w - 6 * s, y + 14 * s, { px: 12 * s, color, align: 'right', mono: true, weight: 600 });
  }
}

// A process value box: tag, value, unit; coloured only when abnormal
function pv(ctx, x, y, s, tag, v, unit, decimals = 1, state) {
  const w = 108 * s, h = 40 * s, col = state === 'p1' ? C.p1 : state === 'p2' ? C.p2 : state === 'p3' ? C.p3 : null;
  rect(ctx, x, y, w, h, C.bg, col ?? C.line);
  text(ctx, tag, x + 6 * s, y + 14 * s, { px: 10 * s, color: C.dim, mono: true });
  text(ctx, v.toFixed(decimals), x + w - 34 * s, y + 33 * s, { px: 16 * s, color: col ?? C.value, weight: 600, align: 'right', mono: true });
  text(ctx, unit, x + w - 30 * s, y + 33 * s, { px: 10 * s, color: C.dim });
}

// Horizontal bar with target marker
function bar(ctx, x, y, w, h, frac, target, color = C.value) {
  rect(ctx, x, y, w, h, C.bg, C.line);
  rect(ctx, x + 1, y + 1, Math.max(0, (w - 2) * Math.min(1, frac)), h - 2, color);
  if (target != null) rect(ctx, x + w * target - 1, y - 3, 2, h + 6, C.bright);
}

function vessel(ctx, x, y, w, h, level, s, label) {
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1.5 * s;
  const r = h / 2;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.clip();
  rect(ctx, x, y + h * (1 - level / 100), w, h * level / 100, '#3c4d5e');
  ctx.restore();
  text(ctx, label, x + w / 2, y + h + 16 * s, { px: 11 * s, color: C.dim, align: 'center' });
}

function pipe(ctx, pts, s, color = C.dim) {
  ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.stroke();
}

// ---------------------------------------------------------------- desk monitors (16:10)

// Sources: level and valve position calculated (stiction model); pressure,
// temperature noise; oil flow calculated from `sim.oil`; tags and labels
// static.
function separatorOverview(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Separation · Train 1', t);
  const lvl = sim.sepLevel(t);
  pipe(ctx, [[20 * s, 120 * s], [150 * s, 120 * s]], s);
  text(ctx, 'From wells', 20 * s, 110 * s, { px: 11 * s, color: C.dim });
  vessel(ctx, 150 * s, 80 * s, 240 * s, 90 * s, lvl, s, '20-VA-001 HP separator');
  pipe(ctx, [[390 * s, 95 * s], [470 * s, 95 * s], [470 * s, 70 * s], [620 * s, 70 * s]], s);
  text(ctx, 'Gas → compression', 500 * s, 62 * s, { px: 11 * s, color: C.dim });
  pipe(ctx, [[390 * s, 155 * s], [470 * s, 155 * s], [470 * s, 200 * s], [620 * s, 200 * s]], s);
  text(ctx, 'Oil → export', 520 * s, 192 * s, { px: 11 * s, color: C.dim });
  // Level control valve symbol (bow tie)
  const vx = 470 * s, vy = 175 * s;
  ctx.fillStyle = C.dim; ctx.beginPath();
  ctx.moveTo(vx - 10 * s, vy - 7 * s); ctx.lineTo(vx + 10 * s, vy + 7 * s); ctx.lineTo(vx + 10 * s, vy - 7 * s); ctx.lineTo(vx - 10 * s, vy + 7 * s); ctx.closePath(); ctx.fill();
  text(ctx, `LV-1012  ${sim.valvePos(t).toFixed(0)} %`, vx + 16 * s, vy + 4 * s, { px: 11 * s, color: C.text, mono: true });
  const high = lvl > 56;
  pv(ctx, 20 * s, top + 190 * s, s, '20-LIC-1012', lvl, '%', 1, high ? 'p2' : null);
  pv(ctx, 140 * s, top + 190 * s, s, '20-PI-1005', sim.sepPressure(t), 'barg');
  pv(ctx, 260 * s, top + 190 * s, s, '20-TI-1007', 64.2 + 0.2 * wobble(t, 20), '°C');
  pv(ctx, 380 * s, top + 190 * s, s, '20-FI-1020', sim.oil(t) * 1000 / 24, 'Sm³/h', 0);
  text(ctx, 'Level controller in AUTO · SP 50 %', 20 * s, h - 16 * s, { px: 11 * s, color: C.dim });
}

// Sources: level and valve output calculated (stiction model); limits static.
function separatorTrend(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Trend · 20-LIC-1012 level loop', t);
  const pad = 14 * s, gw = w - pad * 2, gh = (h - top - pad * 3) / 2;
  trend(ctx, pad, top + pad, gw, gh, t, sim.sepLevel, { lo: 35, hi: 65, label: 'Level PV (SP 50 %)', unit: '%', limits: [[56, C.p2], [44, C.p2], [50, C.dim]], span: 300 });
  trend(ctx, pad, top + pad * 2 + gh, gw, gh, t, sim.valvePos, { lo: 30, hi: 55, label: 'Valve output', unit: '%', decimals: 0, color: '#d7b8ff', span: 300, step: true });
}

// Sources: bearing temperature calculated (slow creep); discharge pressure,
// speed, vibration noise; tags static.
function compressor(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Gas compression · 23-KA-001', t);
  // Compressor symbol: trapezoid
  ctx.strokeStyle = C.dim; ctx.lineWidth = 1.5 * s; ctx.beginPath();
  ctx.moveTo(200 * s, 70 * s); ctx.lineTo(300 * s, 95 * s); ctx.lineTo(300 * s, 145 * s); ctx.lineTo(200 * s, 170 * s); ctx.closePath(); ctx.stroke();
  text(ctx, '1st stage', 250 * s, 125 * s, { px: 11 * s, color: C.dim, align: 'center' });
  pipe(ctx, [[30 * s, 120 * s], [200 * s, 120 * s]], s);
  pipe(ctx, [[300 * s, 120 * s], [610 * s, 120 * s]], s);
  text(ctx, 'Suction', 30 * s, 110 * s, { px: 11 * s, color: C.dim });
  text(ctx, 'Discharge → export', 470 * s, 110 * s, { px: 11 * s, color: C.dim });
  const temp = sim.bearingTemp(t);
  pv(ctx, 20 * s, top + 160 * s, s, '23-PI-2210', sim.compDischarge(t), 'barg');
  pv(ctx, 140 * s, top + 160 * s, s, '23-SI-2205', sim.compSpeed(t), 'rpm', 0);
  pv(ctx, 260 * s, top + 160 * s, s, '23-TI-2240', temp, '°C', 1, temp > 82 ? 'p3' : null);
  pv(ctx, 380 * s, top + 160 * s, s, '23-VI-2231', 2.1 + 0.15 * wobble(t * 3, 21), 'mm/s');
  trend(ctx, 20 * s, top + 215 * s, w - 40 * s, h - top - 230 * s, t, sim.bearingTemp, { lo: 74, hi: 90, label: 'DE bearing temp, last hour', unit: '°C', span: 3600, color: C.p3, limits: [[85, C.p2]] });
}

// Sources: scripted, a new alarm from ALARM_POOL every 17 s; times from the
// shift clock; older than the last three shown as acknowledged.
function alarmList(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Alarm list · all areas', t);
  const rowH = 30 * s, list = alarms(t, Math.floor((h - top - 50 * s) / rowH));
  text(ctx, 'Pri', 12 * s, top + 18 * s, { px: 10 * s, color: C.dim });
  text(ctx, 'Time', 50 * s, top + 18 * s, { px: 10 * s, color: C.dim });
  text(ctx, 'Tag', 130 * s, top + 18 * s, { px: 10 * s, color: C.dim });
  text(ctx, 'Description', 250 * s, top + 18 * s, { px: 10 * s, color: C.dim });
  list.forEach((a, i) => {
    const y = top + 26 * s + i * rowH, col = [null, C.p1, C.p2, C.p3][a.p];
    if (a.fresh && Math.floor(t * 2) % 2 === 0) rect(ctx, 0, y, w, rowH, '#3a3226');
    else if (i % 2) rect(ctx, 0, y, w, rowH, '#282c31');
    // Priority shape (ISA-101: shape and colour, so it reads without colour too)
    ctx.fillStyle = col; ctx.beginPath();
    const cx = 20 * s, cy = y + rowH / 2, r = 8 * s;
    if (a.p === 1) { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy + r * 0.8); ctx.lineTo(cx - r, cy + r * 0.8); }
    else if (a.p === 2) { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); }
    else ctx.rect(cx - r * 0.75, cy - r * 0.75, r * 1.5, r * 1.5);
    ctx.fill();
    text(ctx, String(a.p), cx, cy + 4 * s, { px: 10 * s, color: '#111', align: 'center', weight: 700 });
    const tc = a.acked ? C.dim : C.text;
    text(ctx, a.time, 50 * s, y + 20 * s, { px: 12 * s, color: tc, mono: true });
    text(ctx, a.tag, 130 * s, y + 20 * s, { px: 12 * s, color: tc, mono: true });
    text(ctx, a.text, 250 * s, y + 20 * s, { px: 12 * s, color: tc });
  });
  text(ctx, `${list.filter((a) => !a.acked).length} unacknowledged`, 12 * s, h - 10 * s, { px: 11 * s, color: C.p2 });
}

// Sources: scripted, the steps appear one every 4 s on a 60 s loop, then wait
// at the approval gate; all text static.
function assistant(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Operations assistant', t, 'AI · suggestions only');
  // Steps appear one by one, then wait at the approval gate
  const steps = [
    'Separator level cycling ±7 % every 46 s for 3 h 12 min',
    'Valve output moves in steps of ~9 %, level lags each jump',
    'Pattern matches valve stiction, not tuning (confidence: high)',
    'Maintenance history: LV-1012 last serviced 26 months ago',
    'Drafted work order: inspect and re-pack LV-1012',
  ];
  const shown = Math.min(steps.length, Math.floor((t % 60) / 4) + 1);
  rect(ctx, 14 * s, top + 14 * s, w - 28 * s, 40 * s, C.panel);
  text(ctx, 'Why is the HP separator level oscillating?', 26 * s, top + 40 * s, { px: 14 * s, color: C.bright });
  steps.slice(0, shown).forEach((st, i) => {
    const y = top + 80 * s + i * 30 * s;
    text(ctx, i < shown - 1 || shown === steps.length ? '✓' : '…', 26 * s, y, { px: 13 * s, color: C.ai, weight: 700 });
    text(ctx, st, 48 * s, y, { px: 12.5 * s, color: C.text });
  });
  if (shown === steps.length) {
    const y = h - 58 * s;
    rect(ctx, 14 * s, y, w - 28 * s, 44 * s, '#23332d', C.ai);
    text(ctx, 'Waiting for operator approval', 26 * s, y + 27 * s, { px: 13 * s, color: C.ai, weight: 600 });
    rect(ctx, w - 200 * s, y + 8 * s, 80 * s, 28 * s, C.ai);
    text(ctx, 'Approve', w - 160 * s, y + 27 * s, { px: 12 * s, color: '#10241b', align: 'center', weight: 700 });
    rect(ctx, w - 112 * s, y + 8 * s, 84 * s, 28 * s, null, C.dim);
    text(ctx, 'Edit', w - 70 * s, y + 27 * s, { px: 12 * s, color: C.text, align: 'center' });
  }
}

// Sources: GT-A/B load noise; GT-C standby static; MW and spinning reserve
// calculated from the loads.
function utilities(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Power generation', t);
  ['GT-A', 'GT-B', 'GT-C'].forEach((name, i) => {
    const y = top + 30 * s + i * 62 * s, load = sim.gen(i, t);
    text(ctx, name, 20 * s, y + 18 * s, { px: 14 * s, color: C.bright, weight: 600 });
    text(ctx, i === 2 ? 'Standby' : 'Running', 90 * s, y + 18 * s, { px: 12 * s, color: i === 2 ? C.dim : C.text });
    bar(ctx, 200 * s, y + 4 * s, 320 * s, 18 * s, load / 100, 0.8);
    text(ctx, `${load.toFixed(0)} %`, 600 * s, y + 18 * s, { px: 13 * s, color: C.value, align: 'right', mono: true });
    text(ctx, i === 2 ? '—' : `${(load * 0.235).toFixed(1)} MW`, 600 * s, y + 38 * s, { px: 11 * s, color: C.dim, align: 'right', mono: true });
  });
  const total = sim.gen(0, t) * 0.235 + sim.gen(1, t) * 0.235;
  text(ctx, `Total ${total.toFixed(1)} MW · spinning reserve ${(23.5 * 2 - total).toFixed(1)} MW`, 20 * s, h - 20 * s, { px: 12 * s, color: C.text });
}

// Sources: the log lines are static; the clock and cursor follow the shift
// time.
function logbook(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Shift log · night', t);
  const lines = [
    ['02:10', 'Handover from day shift. Train 1 at 18.2 kSm³/d.'],
    ['02:24', 'Separator level cycling, under observation.'],
    ['02:41', 'GT-C on standby after filter change.'],
    ['03:02', 'Compressor DE bearing trending up, vib normal.'],
    ['03:15', 'Supply vessel ETA 06:30, swell 2.6 m.'],
  ];
  lines.forEach(([tm, l], i) => {
    const y = top + 34 * s + i * 34 * s;
    text(ctx, tm, 20 * s, y, { px: 12 * s, color: C.dim, mono: true });
    text(ctx, l, 80 * s, y, { px: 13 * s, color: C.text });
  });
  const cursor = Math.floor(t * 2) % 2 ? '▍' : '';
  text(ctx, sim.clock(t).slice(0, 5), 20 * s, top + 34 * s + 5 * 34 * s, { px: 12 * s, color: C.dim, mono: true });
  text(ctx, cursor, 80 * s, top + 34 * s + 5 * 34 * s, { px: 13 * s, color: C.text });
}

// Sources: per-well choke, pressure and temperature are static numbers
// derived from the well's index, plus noise; A-09 shut in static.
function wellOverview(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Wells · production manifold', t);
  const wells = ['A-01', 'A-03', 'A-04', 'A-07', 'A-09', 'A-12', 'A-15', 'A-18'];
  wells.forEach((name, i) => {
    const col = i % 4, row = Math.floor(i / 4), x = 16 * s + col * 154 * s, y = top + 16 * s + row * 140 * s;
    const shut = name === 'A-09';
    rect(ctx, x, y, 144 * s, 126 * s, C.panel, C.line);
    text(ctx, name, x + 10 * s, y + 22 * s, { px: 15 * s, color: C.bright, weight: 600 });
    text(ctx, shut ? 'Shut in' : 'Flowing', x + 134 * s, y + 22 * s, { px: 11 * s, color: shut ? C.dim : C.text, align: 'right' });
    const choke = shut ? 0 : 30 + ((i * 17) % 40) + wobble(t, 30 + i);
    text(ctx, 'Choke', x + 10 * s, y + 50 * s, { px: 11 * s, color: C.dim });
    bar(ctx, x + 10 * s, y + 56 * s, 124 * s, 12 * s, choke / 100);
    text(ctx, 'WHP', x + 10 * s, y + 92 * s, { px: 11 * s, color: C.dim });
    text(ctx, shut ? '—' : `${(68 + ((i * 13) % 30) + wobble(t, 40 + i)).toFixed(1)} barg`, x + 134 * s, y + 92 * s, { px: 12 * s, color: C.value, align: 'right', mono: true });
    text(ctx, 'WHT', x + 10 * s, y + 112 * s, { px: 11 * s, color: C.dim });
    text(ctx, shut ? '—' : `${(58 + ((i * 7) % 20)).toFixed(0)} °C`, x + 134 * s, y + 112 * s, { px: 12 * s, color: C.value, align: 'right', mono: true });
  });
}

// Sources: all static (the search, the hits, the assistant's cited answer).
function procedures(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'Procedures · search', t);
  rect(ctx, 14 * s, top + 14 * s, w - 28 * s, 34 * s, C.bg, C.line);
  text(ctx, 'start-up of standby gas turbine after filter change', 26 * s, top + 36 * s, { px: 13 * s, color: C.text });
  const hits = [
    ['OP-80-014', 'Gas turbine start from standby', 'Rev 7'],
    ['OP-80-002', 'Fuel gas filter changeover', 'Rev 4'],
    ['MT-80-110', 'GT inlet filter replacement', 'Rev 2'],
  ];
  hits.forEach(([id, title, rev], i) => {
    const y = top + 66 * s + i * 54 * s;
    rect(ctx, 14 * s, y, w - 28 * s, 46 * s, i === 0 ? C.panel : null, C.line);
    text(ctx, id, 26 * s, y + 20 * s, { px: 11 * s, color: C.dim, mono: true });
    text(ctx, title, 26 * s, y + 38 * s, { px: 13 * s, color: C.bright });
    text(ctx, rev, w - 26 * s, y + 20 * s, { px: 11 * s, color: C.dim, align: 'right' });
  });
  text(ctx, 'Assistant: step 4.2 needs a gas test before purge. Cited: OP-80-014 §4.2', 14 * s, h - 18 * s, { px: 12 * s, color: C.ai });
}

// Sources: all static, every zone healthy.
function esdOverview(ctx, w, h, t) {
  const s = S(w), top = header(ctx, w, 'ESD / F&G status', t, 'Safety system · read only');
  const zones = ['Wellbay', 'Separation', 'Compression', 'Utilities', 'Turbine hall', 'Living quarters'];
  zones.forEach((z, i) => {
    const col = i % 3, row = Math.floor(i / 3), x = 16 * s + col * 204 * s, y = top + 20 * s + row * 110 * s;
    rect(ctx, x, y, 194 * s, 96 * s, C.panel, C.line);
    text(ctx, z, x + 12 * s, y + 24 * s, { px: 14 * s, color: C.bright, weight: 600 });
    text(ctx, 'Gas  0 / 24', x + 12 * s, y + 52 * s, { px: 12 * s, color: C.text, mono: true });
    text(ctx, 'Fire 0 / 12', x + 12 * s, y + 74 * s, { px: 12 * s, color: C.text, mono: true });
    rect(ctx, x + 150 * s, y + 46 * s, 30 * s, 30 * s, C.ok);
  });
  text(ctx, 'No inhibits · no overrides · last ESD test 14 days ago', 16 * s, h - 18 * s, { px: 12 * s, color: C.dim });
}

// ---------------------------------------------------------------- video wall (16:9)

const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;
const NIGHT_CCTV = {
  day: 0, clouds: 0.3, wind: 0.35, fog: 0.1, rain: 0,
  skyTop: [11, 16, 24], skyLow: [20, 28, 38], cloud: [26, 32, 40], fogColor: [24, 30, 38],
  seaFar: [12, 16, 21], seaNear: [6, 8, 11], glint: [160, 180, 200],
};

// Sources: in the room, the platform model drawn live under the sky outside
// (cctv.js) with only rain, noise and caption drawn here; elsewhere (the
// screens preview) a drawn scene lit like the sky outside (outdoor.js
// `cctv`, or a calm night without it): sky, clouds, sea glints, whitecaps,
// fog and rain follow the weather and move with t; flare flicker and sensor
// noise move with t; caption static.
function deckCamera(ctx, w, h, t, { name = 'CAM 04 · Helideck', flare = false, feed = false } = {}) {
  const s = w / 1024, o = outside ?? NIGHT_CCTV, horizon = 320;
  if (!feed) drawnCamera(ctx, w, h, t, s, o, horizon, flare);
  cameraOverlay(ctx, w, h, t, s, o, name);
}

function drawnCamera(ctx, w, h, t, s, o, horizon, flare) {
  const sky = ctx.createLinearGradient(0, 0, 0, horizon * s);
  sky.addColorStop(0, rgba(o.skyTop)); sky.addColorStop(1, rgba(o.skyLow));
  rect(ctx, 0, 0, w, horizon * s, sky);
  // Clouds: soft blobs drifting with the wind
  if (o.clouds > 0.05) {
    ctx.save();
    ctx.filter = `blur(${18 * s}px)`;
    ctx.fillStyle = rgba(o.cloud, Math.min(0.9, 0.25 + o.clouds * 0.7));
    const n = Math.round(4 + o.clouds * 14), drift = t * (4 + o.wind * 30);
    for (let i = 0; i < n; i++) {
      const x = (((i * 211 + drift) % 1400) + 1400) % 1400 - 200, y = 30 + ((i * 97) % 220) * (1 - i / n * 0.3);
      ctx.beginPath(); ctx.ellipse(x * s, y * s, (90 + (i * 53) % 120) * s, (22 + (i * 31) % 26) * s, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  const sea = ctx.createLinearGradient(0, horizon * s, 0, h);
  sea.addColorStop(0, rgba(o.seaFar)); sea.addColorStop(1, rgba(o.seaNear));
  rect(ctx, 0, horizon * s, w, h - horizon * s, sea);
  // Glints and whitecaps on the sea, more of them in wind
  ctx.fillStyle = rgba(o.glint, 0.18);
  const glints = Math.round(30 + o.wind * 90);
  for (let i = 0; i < glints; i++) {
    const x = ((i * 137.5) % 1024) * s, y = (horizon + 8 + ((i * 53) % 250)) * s;
    ctx.fillRect(x + Math.sin(t * (0.8 + o.wind) + i) * 6 * s, y, (10 + (i % 5) * 6) * s * (y / h + 0.3), 1.5 * s);
  }
  if (o.wind > 0.5) {
    ctx.fillStyle = `rgba(235,240,245,${(o.wind - 0.5) * 0.5 * (0.3 + 0.7 * o.day)})`;
    for (let i = 0; i < 60 * (o.wind - 0.5) * 2; i++) {
      const x = ((i * 311 + t * 20) % 1024) * s, y = (horizon + 20 + ((i * 71) % 230)) * s;
      ctx.beginPath(); ctx.ellipse(x, y, (6 + (i % 4) * 4) * s * (y / h + 0.4), 2 * s, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Steel: a dark silhouette at night, grey by day
  const lit = (night, day) => rgba(night.map((v, i) => Math.round(v + (day[i] - v) * o.day)));
  if (flare) {
    ctx.strokeStyle = lit([42, 48, 56], [150, 156, 162]); ctx.lineWidth = 10 * s;
    ctx.beginPath(); ctx.moveTo(140 * s, 560 * s); ctx.lineTo(620 * s, 180 * s); ctx.stroke();
    const flick = 1 + 0.12 * Math.sin(t * 9) + 0.08 * Math.sin(t * 23) + o.wind * 0.1 * Math.sin(t * 3.1);
    const g = ctx.createRadialGradient(640 * s, 160 * s, 4 * s, 640 * s, 160 * s, 120 * s * flick);
    g.addColorStop(0, 'rgba(255,240,200,0.95)'); g.addColorStop(0.25, `rgba(255,170,60,${0.7 - 0.3 * o.day})`); g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(640 * s, 160 * s, 130 * s * flick, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = lit([27, 33, 41], [120, 126, 132]);
    ctx.fillRect(0, 470 * s, w, 106 * s);
    ctx.strokeStyle = lit([50, 58, 68], [196, 168, 60]); ctx.lineWidth = 4 * s; // yellow rails by day
    ctx.beginPath(); ctx.moveTo(0, 470 * s); ctx.lineTo(w, 470 * s); ctx.moveTo(0, 430 * s); ctx.lineTo(w, 430 * s); ctx.stroke();
    for (let x = 30; x < 1024; x += 80) { ctx.beginPath(); ctx.moveTo(x * s, 430 * s); ctx.lineTo(x * s, 470 * s); ctx.stroke(); }
    ctx.strokeStyle = lit([34, 40, 48], [210, 180, 40]); ctx.lineWidth = 9 * s;
    ctx.beginPath(); ctx.moveTo(760 * s, 470 * s); ctx.lineTo(760 * s, 210 * s); ctx.lineTo(420 * s, 90 * s); ctx.stroke();
    for (const [x, y] of [[120, 455], [400, 455], [690, 455], [930, 455]]) {
      const g = ctx.createRadialGradient(x * s, y * s, 1, x * s, y * s, 40 * s);
      g.addColorStop(0, `rgba(255,220,160,${0.6 * (1 - 0.8 * o.day)})`); g.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g; ctx.fillRect((x - 40) * s, (y - 40) * s, 80 * s, 80 * s);
    }
  }
  // Fog: thickest at the horizon, over everything far away
  if (o.fog > 0.05) {
    const f = ctx.createLinearGradient(0, 0, 0, h);
    const a = Math.min(0.95, o.fog * 1.1);
    f.addColorStop(0, rgba(o.fogColor, a * 0.7)); f.addColorStop(horizon / 576, rgba(o.fogColor, a)); f.addColorStop(1, rgba(o.fogColor, a * 0.45));
    ctx.fillStyle = f; ctx.fillRect(0, 0, w, h);
  }
}

function cameraOverlay(ctx, w, h, t, s, o, name) {
  // Rain: slanting streaks, and drops on the lens
  if (o.rain > 0.02) {
    ctx.strokeStyle = `rgba(220,228,236,${0.12 + 0.18 * o.day})`; ctx.lineWidth = 1.2 * s;
    const seed = Math.floor(t * 12), slant = 8 + o.wind * 30;
    ctx.beginPath();
    for (let i = 0; i < o.rain * 260; i++) {
      const x = ((i * 7919 + seed * 3301) % 1100) * s, y = ((i * 104729 + seed * 7177) % 600) * s;
      ctx.moveTo(x, y); ctx.lineTo(x - slant * s, y + 34 * s);
    }
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${0.05 + 0.06 * o.day})`;
    for (let i = 0; i < o.rain * 24; i++) {
      ctx.beginPath(); ctx.arc(((i * 389) % 1024) * s, ((i * 251) % 576) * s, (5 + (i % 4) * 4) * s, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Sensor noise, grainier in the dark
  ctx.fillStyle = `rgba(255,255,255,${0.035 * (1 - 0.7 * o.day)})`;
  const seed = Math.floor(t * 12);
  for (let i = 0; i < 400; i++) ctx.fillRect(((i * 7919 + seed * 104729) % 1024) * s, ((i * 104729 + seed * 7919) % 576) * s, 2 * s, 2 * s);
  const caption = o.day > 0.5 ? '#111' : '#e6e6e6';
  ctx.fillStyle = o.day > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0)';
  ctx.fillRect(10 * s, 10 * s, w - 20 * s, 36 * s);
  text(ctx, name, 20 * s, 36 * s, { px: 20 * s, color: caption, mono: true });
  text(ctx, `${sim.clock(t)}  ● REC`, w - 20 * s, 36 * s, { px: 20 * s, color: caption, mono: true, align: 'right' });
}

// Helicopters fly within wind, visibility and deck-motion limits
function helideck(t) {
  if (sim.wind(t) > 25) return 'Closed · wind';
  if (sim.visibility() < 0.8) return 'Closed · visibility';
  const motion = 0.3 + sim.waves(t) * 0.35;
  return motion > 3 ? 'Closed · deck motion' : `Open · pitch/roll ${motion.toFixed(1)}°/${(motion * 0.7).toFixed(1)}°`;
}

// Sources: wind speed and wave height follow the weather outside (outdoor.js)
// plus noise, direction noise; visibility and cloud base from the fog and
// cloud cover; temperatures and vessel window static.
function weather(ctx, w, h, t) {
  const s = w / 1024;
  rect(ctx, 0, 0, w, h, C.bg);
  const top = header(ctx, w, 'Weather · helideck · marine', t);
  // Wind rose
  const cx = 180 * s, cy = top + 200 * s, r = 130 * s, dir = sim.windDir(t) * Math.PI / 180;
  ctx.strokeStyle = C.line; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
  ['N', 'E', 'S', 'W'].forEach((d, i) => text(ctx, d, cx + Math.sin(i * Math.PI / 2) * (r + 16 * s), cy - Math.cos(i * Math.PI / 2) * (r + 16 * s) + 6 * s, { px: 16 * s, color: C.dim, align: 'center' }));
  ctx.strokeStyle = C.value; ctx.lineWidth = 5 * s; ctx.beginPath();
  ctx.moveTo(cx + Math.sin(dir) * r * 0.9, cy - Math.cos(dir) * r * 0.9); ctx.lineTo(cx - Math.sin(dir) * r * 0.3, cy + Math.cos(dir) * r * 0.3); ctx.stroke();
  text(ctx, `${sim.wind(t).toFixed(1)} m/s`, cx, cy + r + 50 * s, { px: 28 * s, color: C.value, align: 'center', weight: 600, mono: true });
  text(ctx, `from ${sim.windDir(t).toFixed(0)}°`, cx, cy + r + 76 * s, { px: 16 * s, color: C.dim, align: 'center' });
  // Numbers
  const rows = [
    ['Significant wave height', `${sim.waves(t).toFixed(1)} m`], ['Max wave', `${(sim.waves(t) * 1.9).toFixed(1)} m`],
    ['Visibility', `${sim.visibility() < 1 ? sim.visibility().toFixed(1) : Math.round(sim.visibility())} km`],
    ['Cloud base', `${sim.cloudBase().toLocaleString('en')} ft`], ['Air / sea temp', '6 / 9 °C'], ['Helideck', helideck(t)],
  ];
  rows.forEach(([k, v], i) => {
    const y = top + 60 * s + i * 52 * s;
    text(ctx, k, 400 * s, y, { px: 18 * s, color: C.dim });
    text(ctx, v, 990 * s, y, { px: 22 * s, color: i === 5 ? (v.startsWith('Open') ? C.ok : C.p2) : C.text, align: 'right', mono: true });
  });
  text(ctx, 'Supply vessel window: 06:00–11:00 (Hs < 3.0 m)', 400 * s, h - 30 * s, { px: 17 * s, color: C.text });
}

// Sources: values from `sim` (calculated and noise); a block turns yellow
// when its value crosses a static threshold.
function platformOverview(ctx, w, h, t) {
  const s = w / 1024;
  rect(ctx, 0, 0, w, h, C.bg);
  const top = header(ctx, w, 'Platform overview · process flow', t);
  const blocks = [
    ['Wells', 30, 'flowing 7 / 8'], ['Separation', 230, `level ${sim.sepLevel(t).toFixed(0)} %`], ['Compression', 430, `${sim.compDischarge(t).toFixed(0)} barg`],
    ['Gas export', 630, `${sim.gas(t).toFixed(2)} MSm³/d`], ['Oil export', 630, `${sim.oil(t).toFixed(1)} kSm³/d`], ['Water treatment', 430, `${sim.water(t).toFixed(1)} kSm³/d`],
    ['Flare', 830, `${sim.flare(t).toFixed(2)} t/h`],
  ];
  const ys = [140, 140, 140, 90, 330, 330, 90];
  blocks.forEach(([name, x, val], i) => {
    const y = top + ys[i] * s, warn = (i === 1 && sim.sepLevel(t) > 56) || (i === 2 && sim.bearingTemp(t) > 82);
    rect(ctx, x * s, y, 170 * s, 90 * s, C.panel, warn ? C.p3 : C.line);
    text(ctx, name, (x + 12) * s, y + 30 * s, { px: 18 * s, color: C.bright, weight: 600 });
    text(ctx, val, (x + 12) * s, y + 66 * s, { px: 17 * s, color: C.value, mono: true });
  });
  const P = (pts) => pipe(ctx, pts.map(([x, y]) => [x * s, top + y * s]), s * 1.4);
  P([[200, 185], [230, 185]]); P([[400, 185], [430, 185]]); P([[600, 160], [630, 135]]);
  P([[315, 230], [315, 375], [630, 375]]); P([[315, 260], [430, 360]]); P([[800, 135], [830, 135]]);
}

// Sources: oil, gas and water noise around their rates; targets static.
function production(ctx, w, h, t) {
  const s = w / 1024;
  rect(ctx, 0, 0, w, h, C.bg);
  const top = header(ctx, w, 'Production · today', t);
  const rows = [['Oil', sim.oil, 18.5, 'kSm³/d'], ['Gas', sim.gas, 4.2, 'MSm³/d'], ['Water', sim.water, 7.0, 'kSm³/d']];
  rows.forEach(([name, f, target, unit], i) => {
    const y = top + 30 * s + i * 160 * s;
    text(ctx, name, 30 * s, y + 40 * s, { px: 26 * s, color: C.bright, weight: 600 });
    text(ctx, f(t).toFixed(2), 360 * s, y + 44 * s, { px: 44 * s, color: C.value, align: 'right', weight: 600, mono: true });
    text(ctx, unit, 370 * s, y + 44 * s, { px: 16 * s, color: C.dim });
    text(ctx, `target ${target}`, 30 * s, y + 76 * s, { px: 15 * s, color: C.dim });
    trend(ctx, 480 * s, y, 510 * s, 120 * s, t, f, { lo: target * 0.85, hi: target * 1.1, span: 600, limits: [[target, C.dim]] });
  });
}

// Sources: bars scripted from a fixed 12-value pattern stepping once a
// minute; benchmark line static; standing counts from the alarm list.
function alarmRateWall(ctx, w, h, t) {
  const s = w / 1024;
  rect(ctx, 0, 0, w, h, C.bg);
  const top = header(ctx, w, 'Alarm load · last 2 hours', t);
  const x0 = 60 * s, y0 = h - 70 * s, gh = 320 * s, bw = 64 * s, max = 20;
  const now = Math.floor(t / 60);
  for (let i = 0; i < 12; i++) {
    const v = alarmRate(now + i), bh = (v / max) * gh, x = x0 + i * (bw + 10 * s);
    rect(ctx, x, y0 - bh, bw, bh, v > 10 ? '#7a6340' : '#4a5562');
    text(ctx, String(v), x + bw / 2, y0 - bh - 8 * s, { px: 15 * s, color: C.text, align: 'center', mono: true });
  }
  const benchY = y0 - (10 / max) * gh;
  ctx.strokeStyle = C.p2; ctx.setLineDash([8 * s, 6 * s]); ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(x0, benchY); ctx.lineTo(x0 + 12 * (bw + 10 * s), benchY); ctx.stroke(); ctx.setLineDash([]);
  text(ctx, 'Manageable: ~1 alarm per minute (EEMUA 191)', x0, top + 40 * s, { px: 17 * s, color: C.p2 });
  text(ctx, 'Alarms per 10 minutes', x0, y0 + 34 * s, { px: 15 * s, color: C.dim });
  const list = alarms(t, 30), counts = [1, 2, 3].map((p) => list.filter((a) => a.p === p && !a.acked).length);
  text(ctx, `Standing: P1 ${counts[0]}  P2 ${counts[1]}  P3 ${counts[2]}`, w - 30 * s, top + 40 * s, { px: 17 * s, color: C.text, align: 'right', mono: true });
}

// Sources: flare rate noise; CO₂ today grows slowly with t; survey and pilot
// status static.
function emissions(ctx, w, h, t) {
  const s = w / 1024;
  rect(ctx, 0, 0, w, h, C.bg);
  const top = header(ctx, w, 'Flare & emissions', t);
  trend(ctx, 30 * s, top + 30 * s, w - 60 * s, 230 * s, t, sim.flare, { lo: 0, hi: 2, span: 1800, label: 'Flare rate, last 30 min', unit: 't/h', decimals: 2, color: '#ffb36b', limits: [[1.2, C.p2]] });
  const tiles = [['CO₂ today', `${(310 + t * 0.002).toFixed(0)} t`], ['Methane leak survey', 'No findings'], ['Flare pilot', 'Lit']];
  tiles.forEach(([k, v], i) => {
    const x = (30 + i * 330) * s, y = top + 300 * s;
    rect(ctx, x, y, 310 * s, 110 * s, C.panel, C.line);
    text(ctx, k, x + 16 * s, y + 34 * s, { px: 17 * s, color: C.dim });
    text(ctx, v, x + 16 * s, y + 80 * s, { px: 28 * s, color: C.text, weight: 600 });
  });
}

// Sources: static people and labels; the speaker highlight moves every 6 s.
function videoCall(ctx, w, h, t) {
  const s = w / 1024;
  rect(ctx, 0, 0, w, h, '#16191d');
  const people = [['Onshore support centre', 'Process engineer'], ['Onshore support centre', 'Rotating equipment'], ['Supply base', 'Logistics'], ['Night OIM', 'On board']];
  people.forEach(([where, role], i) => {
    const x = (16 + (i % 2) * 500) * s, y = (16 + Math.floor(i / 2) * 280) * s, tw = 492 * s, th = 268 * s;
    rect(ctx, x, y, tw, th, ['#2a3138', '#2d2f36', '#29302c', '#33302b'][i]);
    // Head-and-shoulders silhouette
    ctx.fillStyle = '#495260';
    ctx.beginPath(); ctx.arc(x + tw / 2, y + th * 0.42, 48 * s, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + tw / 2, y + th + 20 * s, 120 * s, 110 * s, 0, Math.PI, 0); ctx.fill();
    const talking = Math.floor(t / 6) % 4 === i;
    if (talking) { ctx.strokeStyle = C.ai; ctx.lineWidth = 4 * s; ctx.strokeRect(x + 2 * s, y + 2 * s, tw - 4 * s, th - 4 * s); }
    const label = `${role} · ${where}`;
    font(ctx, 16 * s);
    rect(ctx, x + 10 * s, y + th - 44 * s, ctx.measureText(label).width + 20 * s, 34 * s, 'rgba(0,0,0,0.55)');
    text(ctx, label, x + 20 * s, y + th - 21 * s, { px: 16 * s, color: '#e8e8e8' });
  });
}

// ---------------------------------------------------------------- what goes where

// Everything a screen can show, by id: [name for the panel, draw function]
export const CONTENT = {
  wells: ['Wells', wellOverview],
  separator: ['Separation', separatorOverview],
  levelTrend: ['Level loop trend', separatorTrend],
  compressor: ['Gas compression', compressor],
  alarms: ['Alarm list', alarmList],
  assistant: ['Operations assistant', assistant],
  power: ['Power generation', utilities],
  esd: ['ESD / F&G status', esdOverview],
  procedures: ['Procedures', procedures],
  log: ['Shift log', logbook],
  deckCam: ['Helideck camera', (ctx, w, h, t) => deckCamera(ctx, w, h, t, { feed: feeds.has('deckCam') })],
  flareCam: ['Flare camera', (ctx, w, h, t) => deckCamera(ctx, w, h, t, { name: 'CAM 11 · Flare boom', flare: true, feed: feeds.has('flareCam') })],
  weather: ['Weather & helideck', weather],
  overview: ['Platform overview', platformOverview],
  production: ['Production', production],
  alarmLoad: ['Alarm load', alarmRateWall],
  emissions: ['Flare & emissions', emissions],
  call: ['Video call', videoCall],
  blank: ['Blank', () => {}],
};

// What each screen shows unless the player changes it on the room panel.
// Desks left to right as seen from the chairs, then the wall band, then the
// meeting table's video link and the TV beside the band, both on the call.
export const DEFAULT_LAYOUT = {
  ...Object.fromEntries(['wells', 'separator', 'levelTrend', 'compressor', 'alarms', 'assistant'].map((id, i) => [`Desk0Mon${i}Screen`, id])),
  ...Object.fromEntries(['power', 'esd', 'alarms', 'procedures', 'log', 'assistant'].map((id, i) => [`Desk1Mon${i}Screen`, id])),
  ...Object.fromEntries(['deckCam', 'weather', 'overview', 'production', 'alarmLoad', 'emissions', 'flareCam'].map((id, i) => [`Wall${i}Screen`, id])),
  LinkScreen: 'call',
  TvScreen: 'call',
};
const layout = { ...DEFAULT_LAYOUT };

// Panel names for the screens themselves
export function screenLabel(name) {
  let m = name.match(/^Desk(\d)Mon(\d)Screen$/);
  if (m) return `${m[1] === '0' ? 'Left' : 'Right'} desk ${Number(m[2]) + 1}`;
  m = name.match(/^Wall(\d)Screen$/);
  if (m) return `Wall ${Number(m[1]) + 1}`;
  return { LinkScreen: 'Meeting room', TvScreen: 'Left wall TV' }[name] ?? name;
}

export const contentOf = (name) => layout[name];
export function assign(name, id) { if (CONTENT[id]) layout[name] = id; }

// Draw one screen into a w × h region of ctx (origin already translated)
export function drawScreen(ctx, fn, w, h, t, clear = false) {
  ctx.save();
  if (clear) ctx.clearRect(0, 0, w, h);
  else rect(ctx, 0, 0, w, h, C.bg);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  fn(ctx, w, h, t);
  ctx.restore();
}

// The function that draws a screen, by its mesh name in the bake
export function screenFor(name) {
  return CONTENT[layout[name]]?.[1];
}

// Draw every screen into its slot of the shared canvas (meta.screens from the
// bake), at `scale` times the slot's pixel size; `names` picks a subset
// clear: leave live camera feeds transparent (for a screen's own overlay)
export function drawSlots(ctx, slots, t, scale = 1, names = Object.keys(slots), clear = false) {
  for (const name of names) {
    const [x, y, w, h] = slots[name];
    const fn = screenFor(name);
    if (!fn) continue;
    ctx.setTransform(scale, 0, 0, scale, x * scale, y * scale);
    drawScreen(ctx, fn, w, h, t, clear && feeds.has(layout[name]));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
