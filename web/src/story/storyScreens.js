// Screen content for story mode, added to the room's screens (screens.js
// CONTENT, drawn live through controlScene.js LIVE): the water injection
// pumps, the alarm flood and its rationalised view, the agents' activity,
// the knowledge graph and org chart on the band, and mock-ups of the Act 2
// tools. All made up. Each reads the story's state `S`, which main.js sets.
//
// TODO(Adriaen): the Act 2 tools are mock-ups. Put screenshots of the real
// tools in public/story/private/tools/<id>.png and they are drawn instead
// (stepTest, riser, antiSlug, scd).
import { CONTENT } from '../screens.js';
import { LIVE } from '../controlScene.js';
import { drawGraph } from './graph.js';
import { AGENTS, ORG, SPEAKERS, CHATS, GOV_DOCS } from './content.js';
import { PRIVATE, PRIVATE_BASE } from '../privateNames.js';
import { T } from './lang.js';

export const S = {
  wi: 'normal', wiAt: 0,          // water injection phase and when it began (s, story clock)
  alarms: 0,                       // alarms in the flood
  graph: 1, graphAt: -99,          // knowledge graph level and when it grew
  notices: [],                     // [agent, text, at] the agents' feed
  tool: null, toolAt: 0,           // the Act 2 demo and when it started
  now: 0,                          // story clock, s
  clock: '12:00',                  // game time, for the headers
  images: {},                      // private tool screenshots, if any
  chats: {}, chatAt: {},           // messages shown per chat (content.js CHATS) and when the last came
  reports: 'story/reports/',       // where the reports' pictures and videos are
  videos: {},                      // report videos by file, with when they were last drawn (seen)
  buddy: { look: 'splash', who: 'buddy', clickAt: -99 },   // CtrlBuddy's first appearance (buddy.js): how his screen looks, when he was clicked
};

const C = {
  bg: '#24282c', panel: '#2e3338', line: '#454b52', dim: '#7d858d', text: '#c9ced3', bright: '#eef1f3',
  value: '#9fd3ff', ai: '#5fe0b7', p1: '#ff5a4f', p2: '#ffb347', ok: '#7fbf7f',
};
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function text(ctx, s, x, y, { px = 14, color = C.text, weight = 500, align = 'left', mono = false } = {}) {
  ctx.font = `${weight} ${px}px ${mono ? MONO : SANS}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function rect(ctx, x, y, w, h, fill, stroke, lw = 1) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw); }
}
function header(ctx, w, title, right = S.clock, color = C.panel) {
  const s = w / 640, h = 30 * s;
  rect(ctx, 0, 0, w, h, color);
  text(ctx, title, 12 * s, 20 * s, { px: 14 * s, weight: 600, color: C.bright });
  text(ctx, right, w - 12 * s, 20 * s, { px: 13 * s, color: C.dim, align: 'right', mono: true });
  return h;
}
const since = (at) => S.now - at;
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const wob = (t, k) => (Math.sin(t * 0.9 + k) + 0.5 * Math.sin(t * 2.3 + 2 * k)) / 1.5;

// A trend over the last `span` seconds of f(t) (t in story seconds)
function trend(ctx, x, y, w, h, f, { lo, hi, color = C.value, label, unit = '', span = 40, limit } = {}) {
  const s = w / 600;
  rect(ctx, x, y, w, h, '#1d2125', C.line);
  if (limit !== undefined) {
    const ly = y + h - ((limit - lo) / (hi - lo)) * h;
    ctx.setLineDash([4 * s, 4 * s]); ctx.strokeStyle = C.p2; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + w, ly); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, 2 * s);
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const t = S.now - span + (i / 120) * span, v = f(t);
    const px = x + (i / 120) * w, py = y + h - Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * h;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.stroke();
  if (label) text(ctx, label, x + 8 * s, y + 18 * s, { px: 13 * s, color: C.dim });
  text(ctx, `${f(S.now).toFixed(1)} ${unit}`, x + w - 8 * s, y + 18 * s, { px: 14 * s, color, align: 'right', mono: true });
}

// ---------------------------------------------------------------- water injection

// The pumps' story: A's vibration creeps up and it trips; B takes the load,
// suction pressure swings and B trips; all injection is lost. In Act 3 the
// new changeover logic holds and A's wear is caught weeks ahead.
function wiModel(t) {
  const p = S.wi, dt = t - S.wiAt;
  const m = { a: 'RUN', b: 'RUN', vib: 3.1 + 0.15 * wob(t, 1), suct: 4.2 + 0.05 * wob(t, 2), flow: 100 + 1.5 * wob(t * 0.5, 3) };
  if (p === 'vibration') m.vib = 5.4 + 0.3 * wob(t, 1);
  if (p === 'tripA' || p === 'tripAll' || p === 'frozen') {
    if (dt > 0.8 || p !== 'tripA') { m.a = 'TRIP'; m.vib = 0.2; }
    else m.vib = 9 + 2 * Math.random();
    const k = p === 'tripA' ? Math.max(0, dt - 0.8) : 99;
    m.suct = 4.2 - 1.2 * Math.sin(k * 2.2) * Math.exp(-k * 0.05) - 0.5 * smooth(k / 6);
    m.flow = 100 - 35 * smooth(k / 3) + 8 * Math.sin(k * 2.2);
  }
  if (p === 'tripAll' || p === 'frozen') {
    const k = p === 'frozen' ? 99 : dt;
    m.b = k > 1.5 ? 'TRIP' : 'RUN';
    m.suct = k > 1.5 ? 1.1 + 0.05 * wob(t, 4) : 2.5 - 1.2 * Math.sin(k * 5);
    m.flow = k > 1.5 ? 0 : 50 * (1 - k / 1.5);
  }
  if (p === 'fixed') { m.vib = 5.2 + 0.3 * wob(t, 1); m.b = 'READY'; }
  return m;
}

function waterInjection(ctx, w, h) {
  const s = w / 640, m = wiModel(S.now);
  const top = header(ctx, w, 'Water injection · booster pumps', S.clock, m.a === 'TRIP' ? '#5a2422' : C.panel);
  const pump = (x, name, state, vib) => {
    const col = state === 'TRIP' ? C.p1 : state === 'READY' ? C.dim : C.ok;
    rect(ctx, x, top + 16 * s, 280 * s, 120 * s, C.panel, col, 2 * s);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + 46 * s, top + 76 * s, 26 * s, 0, Math.PI * 2); ctx.fill();
    text(ctx, name, x + 86 * s, top + 52 * s, { px: 18 * s, weight: 600, color: C.bright });
    text(ctx, state, x + 86 * s, top + 80 * s, { px: 16 * s, weight: 600, color: col, mono: true });
    if (vib !== undefined) {
      text(ctx, 'Vibration', x + 86 * s, top + 108 * s, { px: 12 * s, color: C.dim });
      const frac = Math.min(1, vib / 10), bx = x + 150 * s, bw = 110 * s;
      rect(ctx, bx, top + 98 * s, bw, 12 * s, '#1d2125', C.line);
      rect(ctx, bx, top + 98 * s, bw * frac, 12 * s, vib > 7 ? C.p1 : vib > 5 ? C.p2 : C.value);
      rect(ctx, bx + bw * 0.7, top + 94 * s, 2 * s, 20 * s, C.p2);
    }
  };
  pump(20 * s, 'Pump A', m.a, m.vib);
  pump(340 * s, 'Pump B', m.b);
  const ty = top + 150 * s, th = (h - ty - 50 * s) / 2 - 6 * s;
  trend(ctx, 20 * s, ty, 600 * s, th, (t) => wiModel(t).suct, { lo: 0, hi: 6, label: 'Suction pressure B', unit: 'bar', limit: 2.0 });
  trend(ctx, 20 * s, ty + th + 12 * s, 600 * s, th, (t) => wiModel(t).flow, { lo: 0, hi: 120, label: 'Injection flow', unit: '%', color: C.ok });
  const note = S.wi === 'fixed' ? ['Changeover logic v2 in service · pump A bearings: maintenance planned', C.ai]
    : S.wi === 'vibration' ? ['Anomaly agent: pump A vibration trending up', C.ai]
      : m.b === 'TRIP' ? ['ALL WATER INJECTION LOST', C.p1] : m.a === 'TRIP' ? ['Pump A tripped: high vibration', C.p1] : null;
  if (note) text(ctx, note[0], 20 * s, h - 18 * s, { px: 15 * s, weight: 600, color: note[1] });
}

// ---------------------------------------------------------------- alarms

const TAGS = ['WI', 'PT', 'FT', 'LT', 'XV', 'PDT', 'TT', 'ZSC'];
const TEXTS = ['Injection header pressure low', 'Booster suction pressure low', 'Injection well flow low', 'Pump B trip', 'Discharge valve not open', 'Seal pressure low', 'Recycle valve deviation', 'Well choke position deviation', 'Header pressure low low', 'Filter dP high', 'Lube oil pressure low', 'Motor current low'];
function alarmRow(k) {
  const p = k % 7 === 0 ? 1 : k % 3 === 0 ? 2 : 3;
  return { p, tag: `${29 + (k % 4)}-${TAGS[k % TAGS.length]}-${String(1000 + ((k * 37) % 900))}`, text: TEXTS[(k * 5) % TEXTS.length] };
}

function flood(ctx, w, h) {
  const s = w / 640, n = Math.floor(S.alarms);
  const top = header(ctx, w, `Alarm list · ${n} unacknowledged`, S.clock, n > 30 ? '#5a2422' : C.panel);
  const rowH = 24 * s, rows = Math.floor((h - top) / rowH);
  for (let i = 0; i < rows && i < n; i++) {
    const k = n - i, a = alarmRow(k), y = top + i * rowH;
    const col = [null, C.p1, C.p2, '#f2e266'][a.p];
    rect(ctx, 0, y, w, rowH - 1, i % 2 ? '#2a2e33' : '#262a2e');
    rect(ctx, 0, y, 6 * s, rowH - 1, col);
    if (i === 0 && S.now % 0.5 < 0.25) rect(ctx, 0, y, w, rowH - 1, 'rgba(255,90,79,0.25)');
    text(ctx, `P${a.p}`, 14 * s, y + 17 * s, { px: 13 * s, weight: 600, color: col, mono: true });
    text(ctx, a.tag, 54 * s, y + 17 * s, { px: 13 * s, color: C.text, mono: true });
    text(ctx, a.text, 210 * s, y + 17 * s, { px: 13 * s, color: C.text });
  }
}

function rootCause(ctx, w, h) {
  const s = w / 640;
  const top = header(ctx, w, 'Alarms · grouped by root cause', S.clock);
  text(ctx, '41 alarms → 1 root cause', 20 * s, top + 40 * s, { px: 22 * s, weight: 600, color: C.ai });
  rect(ctx, 20 * s, top + 60 * s, 600 * s, 92 * s, C.panel, C.p2, 2 * s);
  text(ctx, 'P2  Pressure transmitter failing (signal frozen, then noisy)', 36 * s, top + 92 * s, { px: 15 * s, weight: 600, color: C.p2 });
  text(ctx, 'Plant running normally. Trip function still active.', 36 * s, top + 118 * s, { px: 14 * s, color: C.text });
  text(ctx, 'Suggested: work order to instrument technician', 36 * s, top + 140 * s, { px: 13 * s, color: C.dim });
  text(ctx, '40 consequential alarms, grouped:', 20 * s, top + 186 * s, { px: 14 * s, color: C.dim });
  for (let i = 0; i < 6; i++) {
    const a = alarmRow(i * 3 + 2), y = top + 198 * s + i * 22 * s;
    if (y > h - 10 * s) break;
    text(ctx, `${a.tag}  ${a.text}`, 36 * s, y + 14 * s, { px: 12 * s, color: '#6d757d', mono: true });
  }
}

// ---------------------------------------------------------------- agents

function agentIcon(ctx, x, y, r, color = C.ai) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.35); ctx.fill();
  ctx.fillStyle = '#0c1a16';
  ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.1, r * 0.16, 0, Math.PI * 2); ctx.arc(x + r * 0.35, y - r * 0.1, r * 0.16, 0, Math.PI * 2); ctx.fill();
}

function agents(ctx, w, h) {
  const s = w / 640;
  const top = header(ctx, w, 'Agents · activity', S.clock);
  const list = S.notices.slice(-7).reverse();
  if (!list.length) text(ctx, 'No agent activity yet today.', 20 * s, top + 40 * s, { px: 15 * s, color: C.dim });
  list.forEach(([agent, msg], i) => {
    const y = top + 14 * s + i * 62 * s, a = AGENTS[agent];
    rect(ctx, 14 * s, y, w - 28 * s, 54 * s, i === 0 ? '#25322e' : C.panel);
    agentIcon(ctx, 38 * s, y + 27 * s, 13 * s);
    text(ctx, a?.label ?? agent, 62 * s, y + 21 * s, { px: 13 * s, weight: 600, color: C.ai });
    text(ctx, `lead: ${SPEAKERS[a?.lead]?.name ?? ''}`, w - 24 * s, y + 21 * s, { px: 11 * s, color: C.dim, align: 'right' });
    const words = msg.length > 70 ? msg.slice(0, 68) + '…' : msg;
    text(ctx, words, 62 * s, y + 42 * s, { px: 13 * s, color: C.text });
  });
}

function graphScreen(ctx, w, h) {
  drawGraph(ctx, w, h, { level: S.graph, since: since(S.graphAt), t: S.now, labels: w > 300, legend: w > 300 });
  text(ctx, T('Kunnskapsgraf', 'Knowledge graph'), 12 * (w / 640), 22 * (w / 640), { px: 14 * (w / 640), weight: 600, color: '#cfe' });
}

function orgScreen(ctx, w, h) {
  const s = w / 640;
  rect(ctx, 0, 0, w, h, '#101820');
  text(ctx, 'Who leads which agent', 16 * s, 30 * s, { px: 16 * s, weight: 600, color: C.bright });
  const cw = (w - 32 * s) / 3;
  ORG.forEach((col, i) => {
    const x = 16 * s + i * cw;
    rect(ctx, x + 4 * s, 46 * s, cw - 8 * s, 46 * s, '#22303c');
    text(ctx, SPEAKERS[col.who].name.split(',')[0], x + 14 * s, 74 * s, { px: 14 * s, weight: 600, color: C.bright });
    col.agents.forEach(([id], j) => {
      const y = 104 * s + j * 40 * s;
      agentIcon(ctx, x + 22 * s, y + 14 * s, 10 * s);
      text(ctx, AGENTS[id].label, x + 40 * s, y + 19 * s, { px: 12 * s, color: C.ai });
    });
  });
}

// ---------------------------------------------------------------- Act 2 tools (mock-ups)

function image(ctx, w, h, id) {
  const img = S.images[id];
  if (!img) return false;
  ctx.drawImage(img, 0, 0, w, h);
  return true;
}

// Step-test finder: Act 1's history; usable stretches light up, then a
// fitted model is drawn over them
function stepTest(ctx, w, h) {
  if (image(ctx, w, h, 'stepTest')) return;
  const s = w / 640, t = since(S.toolAt);
  const top = header(ctx, w, T('Steptest-finner · injeksjonstrykk-sløyfe', 'Step-test finder · injection pressure loop'), T('historikk: i går', 'history: yesterday'));
  const x0 = 20 * s, x1 = w - 20 * s, y0 = top + 30 * s, y1 = h - 60 * s;
  const pv = (u) => 50 + 12 * Math.sin(u * 9) * (u > 0.2 && u < 0.3 ? 1 : 0.25) + 18 * (u > 0.55 && u < 0.62 ? 1 : 0) + 6 * wob(u * 40, 1) + (u > 0.8 && u < 0.86 ? -14 : 0);
  const windows = [[0.2, 0.3], [0.55, 0.64], [0.8, 0.88]];
  const found = Math.min(3, Math.floor(t / 1.6));
  windows.slice(0, found).forEach(([a, b]) => rect(ctx, x0 + a * (x1 - x0), y0, (b - a) * (x1 - x0), y1 - y0, 'rgba(95,224,183,0.16)', C.ai));
  const scan = Math.min(1, t / 5);
  rect(ctx, x0 + scan * (x1 - x0) - 1, y0, 2 * s, y1 - y0, 'rgba(255,255,255,0.5)');
  ctx.strokeStyle = C.value; ctx.lineWidth = 2 * s; ctx.beginPath();
  for (let i = 0; i <= 300; i++) { const u = i / 300, x = x0 + u * (x1 - x0), y = y1 - (pv(u) / 100) * (y1 - y0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  if (t > 5.5) {
    ctx.strokeStyle = C.p2; ctx.setLineDash([6 * s, 4 * s]); ctx.beginPath();
    for (let i = 0; i <= 300; i++) { const u = i / 300, x = x0 + u * (x1 - x0), y = y1 - ((pv(u) + 2 * Math.sin(u * 23)) / 100) * (y1 - y0); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  text(ctx, T(`${found} brukbare strekk funnet (manuell modus, nok eksitasjon)`, `${found} usable stretches found (manual mode, enough excitation)`), x0, h - 34 * s, { px: 14 * s, color: C.ai, weight: 600 });
  if (t > 5.5) text(ctx, T('Modell tilpasset: forsterkning 0,82 bar/%, tidskonstant 41 s, dødtid 6 s   (oppdiktede tall)', 'Model fitted: gain 0.82 bar/%, time constant 41 s, dead time 6 s   (made-up numbers)'), x0, h - 14 * s, { px: 12 * s, color: C.p2 });
  text(ctx, 'MOCK-UP', w - 20 * s, top + 22 * s, { px: 11 * s, color: C.dim, align: 'right', weight: 600 });
}

// Riser simulator: a riser drawn as a pipe that fills with liquid and blows
// through; with the controller on, the level holds steady
function riser(ctx, w, h, controlled = false) {
  if (image(ctx, w, h, controlled ? 'antiSlug' : 'riser')) return;
  const s = w / 640, t = since(S.toolAt);
  const top = header(ctx, w, controlled ? T('Stigerørsimulator · anti-slug-regulering PÅ', 'Riser simulator · anti-slug control ON') : T('Stigerørsimulator · åpen sløyfe', 'Riser simulator · open loop'), T('OPC UA ● tilkoblet', 'OPC UA ● connected'));
  // The geometry: flowline along the bottom, then up the riser to the topside
  const bx = 60 * s, by = h - 70 * s, rx = 250 * s, ry = top + 30 * s;
  const period = 9, ph = (t % period) / period;
  let fill = controlled ? 0.45 + 0.04 * Math.sin(t * 1.5) * Math.exp(-t * 0.3) : ph < 0.75 ? ph / 0.75 : 1 - (ph - 0.75) / 0.25;
  if (controlled && t < 3) fill = (1 - smooth(t / 3)) * ((t % period) / period) + smooth(t / 3) * 0.45;
  ctx.lineWidth = 18 * s; ctx.strokeStyle = '#3a4048'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(rx, by); ctx.lineTo(rx, ry); ctx.lineTo(rx + 60 * s, ry); ctx.stroke();
  ctx.lineWidth = 12 * s; ctx.strokeStyle = '#3d7dd8';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(rx, by); ctx.lineTo(rx, by - fill * (by - ry)); ctx.stroke();
  if (!controlled && ph > 0.75) { ctx.fillStyle = 'rgba(200,220,255,0.6)'; ctx.beginPath(); ctx.arc(rx + 60 * s, ry, 20 * s * (1 - (ph - 0.75) * 4), 0, Math.PI * 2); ctx.fill(); }
  // The choke valve topside, and the controller block when on
  rect(ctx, rx + 50 * s, ry - 12 * s, 20 * s, 24 * s, controlled ? C.ai : C.dim);
  if (controlled) {
    rect(ctx, rx + 30 * s, ry + 30 * s, 110 * s, 40 * s, '#1f2f2a', C.ai, 2 * s);
    text(ctx, 'PI · anti-slug', rx + 40 * s, ry + 56 * s, { px: 13 * s, color: C.ai, weight: 600 });
  }
  // Trend of riser base pressure
  const tx = 360 * s, tw = w - tx - 20 * s, ty = top + 20 * s, th = h - ty - 60 * s;
  trend(ctx, tx, ty, tw, th, (u) => {
    const k = u - S.toolAt;
    if (controlled) return 24 + 6 * Math.sin(k * 0.7) * Math.exp(-Math.max(0, k) * 0.25);
    const q = ((k % period) + period) % period / period;
    return 18 + 14 * (q < 0.75 ? q / 0.75 : 1 - (q - 0.75) / 0.25);
  }, { lo: 10, hi: 40, label: T('Trykk i bunnen av stigerøret', 'Riser base pressure'), unit: 'bar', span: 30 });
  text(ctx, controlled ? T('Slugene borte: jevn strøm, jevnt trykk', 'Slugs gone: steady flow, steady pressure') : T('Kraftig slugging: fylles, så blåser det gjennom', 'Severe slugging: fill, then blow-through'), 20 * s, h - 22 * s, { px: 15 * s, weight: 600, color: controlled ? C.ai : C.p2 });
  text(ctx, T('MOCK-UP · Python + CasADi-modell', 'MOCK-UP · Python + CasADi model'), w - 20 * s, h - 22 * s, { px: 11 * s, color: C.dim, align: 'right' });
}

// SCD and logic tester: a small function diagram; the test run steps through
// it, finds a missing interlock (red), and it is added (green)
function scd(ctx, w, h) {
  if (image(ctx, w, h, 'scd')) return;
  const s = w / 640, t = since(S.toolAt);
  const top = header(ctx, w, T('SCD · omkoblingslogikk pumper · logikktester', 'SCD · pump changeover logic · logic tester'), T('testkjøring', 'test run'));
  const box = (x, y, bw, label, state) => {
    const col = state === 'bad' ? C.p1 : state === 'good' ? C.ai : state === 'on' ? C.value : C.line;
    rect(ctx, x, y, bw, 44 * s, '#1d2125', col, 2 * s);
    text(ctx, label, x + bw / 2, y + 27 * s, { px: 13 * s, color: C.bright, align: 'center' });
  };
  const step = Math.floor(t / 1.2), fixed = t > 7;
  const y1 = top + 40 * s, y2 = top + 130 * s, y3 = top + 220 * s;
  box(30 * s, y1, 150 * s, T('Pumpe A går', 'Pump A running'), step >= 0 ? 'on' : '');
  box(30 * s, y2, 150 * s, T('Pumpe A tripp', 'Pump A trip'), step >= 1 ? 'on' : '');
  box(250 * s, y2, 120 * s, T('OG', 'AND'), step >= 2 ? 'on' : '');
  box(250 * s, y1, 120 * s, T('B klar', 'B ready'), step >= 2 ? 'on' : '');
  box(440 * s, y2, 170 * s, T('Start pumpe B', 'Start pump B'), step >= 3 ? 'on' : '');
  box(250 * s, y3, 120 * s, fixed ? T('Sugetrykk OK', 'Suction OK') : '?', step >= 4 ? (fixed ? 'good' : 'bad') : '');
  box(440 * s, y3, 170 * s, T('Rampe B sakte', 'Ramp B slowly'), fixed ? 'good' : '');
  ctx.strokeStyle = C.dim; ctx.lineWidth = 2 * s;
  const line = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
  line(180 * s, y2 + 22 * s, 250 * s, y2 + 22 * s); line(310 * s, y1 + 44 * s, 310 * s, y2); line(370 * s, y2 + 22 * s, 440 * s, y2 + 22 * s);
  line(310 * s, y2 + 44 * s, 310 * s, y3); line(370 * s, y3 + 22 * s, 440 * s, y3 + 22 * s);
  const msg = step < 4 ? [T('Kjører testtilfelle 3: pumpe A tripper på full last…', 'Running test case 3: pump A trips at full load…'), C.dim]
    : !fixed ? [T('FEIL: B starter før sugetrykket er sjekket. Manglende forrigling.', 'FAIL: B starts before suction pressure is checked. Missing interlock.'), C.p1]
      : [T('OK: forrigling lagt til. Alle 12 testtilfeller består.', 'PASS: interlock added. All 12 test cases pass.'), C.ai];
  text(ctx, msg[0], 20 * s, h - 22 * s, { px: 15 * s, weight: 600, color: msg[1] });
  text(ctx, 'MOCK-UP', w - 20 * s, top + 22 * s, { px: 11 * s, color: C.dim, align: 'right', weight: 600 });
}

// ---------------------------------------------------------------- tomorrow's agents

// Word-wrap `s` to lines of at most `maxW` px in the current font
function wrap(ctx, s, maxW) {
  const out = [];
  let line = '';
  for (const word of s.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// A chat with an agent: the person's messages on the right, the agent's on
// the left, newest at the bottom; the agent types for a moment first
function chat(ctx, w, h, id) {
  const c = CHATS[id], s = w / 640, n = S.chats[id] ?? 0, age = S.now - (S.chatAt[id] ?? -99);
  rect(ctx, 0, 0, w, h, '#14191f');
  const top = header(ctx, w, c.title, S.clock, '#1c2a27');
  agentIcon(ctx, w - 110 * s, 15 * s, 8 * s);
  const px = 15 * s, lh = 20 * s, pad = 10 * s, maxW = w * 0.58, fr = 30 * s, gap = 2 * fr + 22 * s;
  ctx.font = `500 ${px}px ${SANS}`;
  const bubbles = c.messages.slice(0, n).map(([who, msg], i) => {
    const typing = who === 'ai' && i === n - 1 && age < 1.4;
    const lines = typing ? ['•••'] : who === 'show' ? [`▤  ${msg}`] : wrap(ctx, msg, maxW - 2 * pad);
    return { who: who === 'show' ? 'ai' : who, lines, typing, h: lines.length * lh + 2 * pad + (who === 'me' ? 0 : 16 * s) };
  });
  // Stack from the bottom up, dropping what no longer fits
  let y = h - 44 * s;   // clear of the story's navigator when the screen fills the view
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], row = Math.max(b.h, 2 * fr);   // a row as tall as its portrait at least
    y -= row;
    if (y < top + 6 * s) break;
    y += row - b.h;   // the bubble sits at the row's foot
    ctx.font = `500 ${px}px ${SANS}`;   // text() below changes it
    const bw = Math.min(maxW, Math.max(...b.lines.map((l) => ctx.measureText(l).width)) + 2 * pad);
    const x = b.who === 'me' ? w - gap - bw : gap;
    const fresh = i === n - 1 && age < 0.4 ? Math.max(0, age / 0.4) : 1;   // still being typed until age 0
    ctx.globalAlpha = fresh;
    // the writer's portrait, level with the bubble's foot
    const fx = b.who === 'me' ? w - 10 * s - fr : 10 * s + fr, fy = y + b.h - fr;
    if (!face(ctx, c.faces[b.who], fx, fy, fr) && b.who === 'ai') agentIcon(ctx, fx, fy, fr * 0.8);
    ctx.fillStyle = b.who === 'me' ? '#2c4a6e' : '#20342f';
    ctx.beginPath(); ctx.roundRect(x, y, bw, b.h, 12 * s); ctx.fill();
    let ty = y + pad + 15 * s;
    if (b.who === 'ai') { text(ctx, c.title.split(' · ')[0], x + pad, ty - 2 * s, { px: 11 * s, weight: 600, color: C.ai }); ty += 16 * s; }
    for (const l of b.lines) {
      const dots = b.typing ? '•••'.slice(0, 1 + (Math.floor(S.now * 4) % 3)) : l;
      text(ctx, dots, x + pad, ty, { px, color: C.bright });
      ty += lh;
    }
    ctx.globalAlpha = 1;
    y -= row - b.h + 10 * s;
  }
  if (!n) text(ctx, T('Klar.', 'Ready.'), 20 * s, top + 40 * s, { px: 15 * s, color: C.dim });
}

// A portrait in a ring (public/story/faces/<id>.png); false until it loads
const faces = {};
function face(ctx, id, x, y, r) {
  if (!id) return false;
  const img = faces[id] ??= Object.assign(new Image(), { src: `story/faces/${id}.png` });
  if (!img.complete || !img.naturalWidth) return false;
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2a3a44'; ctx.fill(); ctx.clip();
  ctx.drawImage(img, x - r, y - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  return true;
}

// The report beside a chat: the last one handed over, as its picture or
// video (public/story/reports/<file>), or a placeholder until it loads
function report(ctx, w, h, id) {
  const s = w / 640, n = S.chats[id] ?? 0;
  const m = CHATS[id].messages.slice(0, n).filter(([who]) => who === 'show').pop();
  rect(ctx, 0, 0, w, h, '#14191f');
  if (!m) { text(ctx, T('Venter på agenten …', 'Waiting for the agent …'), w / 2, h / 2, { px: 15 * s, color: C.dim, align: 'center' }); return; }
  const [, title, { file } = {}] = m;
  const media = file && S.reports ? reportMedia(file) : null;
  const iw = media?.videoWidth || media?.naturalWidth, ih = media?.videoHeight || media?.naturalHeight;
  if (iw && (media.complete || media.readyState >= 2)) {
    if (media.tagName === 'VIDEO') { media.seen = S.now; if (media.paused) media.play().catch(() => {}); }
    const k = Math.min(w / iw, h / ih), dw = iw * k, dh = ih * k;
    ctx.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }
  const top = header(ctx, w, title, T('rapport', 'report'), '#1c2a27');
  agentIcon(ctx, w / 2, top + (h - top) * 0.42, 26 * s);
  text(ctx, title, w / 2, top + (h - top) * 0.62, { px: 22 * s, weight: 600, color: C.bright, align: 'center' });
}
const reportFiles = {};
function reportMedia(file) {
  if (!(file in reportFiles)) {
    const video = /\.(mp4|webm)$/i.test(file);
    const el = reportFiles[file] = document.createElement(video ? 'video' : 'img');
    if (video) { Object.assign(el, { muted: true, loop: true, playsInline: true, preload: 'auto', seen: 0 }); S.videos[file] = el; }
    // public: a blurred copy (scripts/blur_public.py); ?private=1: the sharp
    // original in story/private/reports/ (pictures as .png), if it is there
    if (PRIVATE) {
      el.onerror = () => { el.onerror = null; el.src = S.reports + file; };
      el.src = `${PRIVATE_BASE}reports/${file.replace(/\.webp$/, '.png')}`;
    } else el.src = S.reports + file;
  }
  return reportFiles[file];
}

// The business plan beside the supervisor's chat: production by quarter, the plan
// against a late well, and the gap closing once the agent's drafts are in
function planChart(ctx, w, h) {
  const s = w / 640, n = S.chats.plan ?? 0;
  const top = header(ctx, w, T('Forretningsplan · produksjon per kvartal', 'Business plan · production by quarter'), T('utkast', 'draft'));
  const q = ['K1', 'K2', 'K3', 'K4', 'K1', 'K2'].map((k, i) => T(k, k.replace('K', 'Q')) + (i < 4 ? '' : '+1'));
  const plan = [100, 102, 108, 110, 112, 112], late = [100, 102, 101, 105, 110, 112], fix = [100, 102, 106, 109, 112, 112];
  const x0 = 50 * s, x1 = w - 20 * s, y0 = top + 30 * s, y1 = h - 50 * s, bw = (x1 - x0) / q.length;
  const Y = (v) => y1 - ((v - 90) / 25) * (y1 - y0);
  q.forEach((label, i) => {
    const x = x0 + i * bw;
    rect(ctx, x + bw * 0.18, Y(plan[i]), bw * 0.28, y1 - Y(plan[i]), '#3d5a7a');
    const v = n >= 4 ? fix[i] : n >= 1 ? late[i] : plan[i];
    rect(ctx, x + bw * 0.5, Y(v), bw * 0.28, y1 - Y(v), n >= 4 ? C.ai : n >= 1 ? C.p2 : '#5b7fa6');
    text(ctx, label, x + bw / 2, y1 + 20 * s, { px: 12 * s, color: C.dim, align: 'center' });
  });
  text(ctx, T('Plan', 'Plan'), x0, y0 - 8 * s, { px: 12 * s, color: '#7fa3c8' });
  text(ctx, n >= 4 ? T('Med to prosjekter flyttet fram', 'With two projects moved forward') : n >= 1 ? T('Brønnen tre måneder for sent', 'The well three months late') : '',
    x0 + 60 * s, y0 - 8 * s, { px: 12 * s, weight: 600, color: n >= 4 ? C.ai : C.p2 });
  text(ctx, T('Oppdiktede tall', 'Made-up numbers'), w - 20 * s, h - 14 * s, { px: 11 * s, color: C.dim, align: 'right' });
}

// A governing-document agent: a question, an answer, and where it says so
function govDocs(ctx, w, h) {
  if (image(ctx, w, h, 'govDocs')) return;
  const s = w / 640, t = since(S.toolAt);
  const top = header(ctx, w, T('Styrende dokumenter · agent', 'Governing documents · agent'), T('kilder: 3', 'sources: 3'));
  ctx.font = `500 ${15 * s}px ${SANS}`;
  rect(ctx, 20 * s, top + 16 * s, w - 40 * s, 40 * s, '#2c4a6e');
  text(ctx, GOV_DOCS.q, 32 * s, top + 41 * s, { px: 15 * s, color: C.bright });
  let y = top + 84 * s;
  if (t < 1.2) { text(ctx, '•••'.slice(0, 1 + (Math.floor(S.now * 4) % 3)), 32 * s, y, { px: 18 * s, color: C.ai }); return; }
  for (const para of GOV_DOCS.a) {
    for (const l of wrap(ctx, para, w - 64 * s)) { text(ctx, l, 32 * s, y, { px: 15 * s, color: C.text }); y += 21 * s; }
    y += 8 * s;
  }
  y += 4 * s;
  GOV_DOCS.sources.forEach((src, i) => {
    if (t < 2 + i * 0.6) return;
    rect(ctx, 32 * s, y - 15 * s, w - 64 * s, 24 * s, '#20342f');
    text(ctx, `[${i + 1}]  ${src}`, 42 * s, y + 2 * s, { px: 13 * s, color: C.ai });
    y += 30 * s;
  });
  text(ctx, 'MOCK-UP', w - 20 * s, top + 22 * s, { px: 11 * s, color: C.dim, align: 'right', weight: 600 });
}

// ---------------------------------------------------------------- CtrlBuddy's first appearance

// Where CtrlBuddy himself stands on his screen, per look: his middle (x, y)
// and height, as shares of the screen. buddy.js draws him there in 3D, under
// this screen's picture (the screen is a live feed, see controlScene.js), and
// the mouse pointer goes there to click him.
//   popup  a small window over the usual process picture, Clippy style
//   splash his own start screen, big in the middle
//   chat   in the empty chat window that the click then starts
// Adriaen picked splash (2026-10-29); the other two stay for ?buddylook=
// Who appears (state buddyWho): the model, and the name on his start screen
export const BUDDY_WHO = {
  buddy: { model: 'control_buddy', name: () => 'CtrlBuddy', sub: () => T('Din assistent i kontrollrommet', 'Your control room assistant') },
  // Per's business-plan agent tomorrow: CtrlBuddy's model, its own name (Adriaen, 2026-10-29)
  planner: { model: 'control_buddy', name: () => 'PlanBuddy', sub: () => T('Din assistent for forretningsplanen', 'Your business-plan assistant') },
  scholar: { model: 'control_buddy_scholar', name: () => T('Forretningsplan-agent', 'Business-plan agent'), sub: () => T('Utkast, tall og kilder til planen', 'Drafts, figures and sources for the plan') },
};
export const BUDDY_LOOKS = {
  popup: { x: 0.8, y: 0.6, h: 0.5, bg: '#1d2a33' },
  splash: { x: 0.5, y: 0.55, h: 0.55, bg: '#16323a' },
  chat: { x: 0.5, y: 0.42, h: 0.62, bg: '#14191f' },
};
function buddyScreen(ctx, w, h, t) {
  const s = w / 640, look = S.buddy.look, L = BUDDY_LOOKS[look];
  const hi = since(S.buddy.clickAt) < 0.6;   // just clicked: his frame lights up
  if (look === 'popup') {
    CONTENT.separator[1](ctx, w, h, t);
    const bw = 0.36 * w, bh = 0.62 * h, bx = L.x * w - bw / 2, by = L.y * h - bh / 2 + 6 * s;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 8 * s); ctx.fill();
    ctx.restore();
    rect(ctx, bx, by - 22 * s, bw, 22 * s, '#2a4a56');
    agentIcon(ctx, bx + 13 * s, by - 11 * s, 6 * s);
    text(ctx, 'CtrlBuddy', bx + 25 * s, by - 6 * s, { px: 12 * s, weight: 600, color: C.bright });
    text(ctx, '×', bx + bw - 10 * s, by - 6 * s, { px: 14 * s, color: C.dim, align: 'right' });
    ctx.strokeStyle = hi ? C.ai : '#2a4a56'; ctx.lineWidth = 2 * s;
    ctx.strokeRect(bx, by - 22 * s, bw, bh + 22 * s);
    // his speech bubble, to the left of the window
    const tw = 150 * s, tx = bx - tw - 12 * s, ty = by + 20 * s;
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath(); ctx.roundRect(tx, ty, tw, 58 * s, 8 * s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx + tw, ty + 18 * s); ctx.lineTo(tx + tw + 12 * s, ty + 26 * s); ctx.lineTo(tx + tw, ty + 32 * s); ctx.fill();
    text(ctx, T('Hei! Jeg er CtrlBuddy.', 'Hi! I am CtrlBuddy.'), tx + 10 * s, ty + 22 * s, { px: 12 * s, weight: 600, color: '#222' });
    text(ctx, T('Trenger du hjelp?', 'Need a hand?'), tx + 10 * s, ty + 42 * s, { px: 12 * s, color: '#333' });
    return;
  }
  if (look === 'splash') {
    // his own start screen: the picture is the 3D feed, with a title and a button over it
    const who = BUDDY_WHO[S.buddy.who] ?? BUDDY_WHO.buddy;
    text(ctx, who.name(), w / 2, 46 * s, { px: 30 * s, weight: 700, color: C.bright, align: 'center' });
    text(ctx, who.sub(), w / 2, 68 * s, { px: 13 * s, color: '#9cc', align: 'center' });
    const bw = 170 * s, bx = w / 2 - bw / 2, by = h - 70 * s;
    ctx.fillStyle = hi ? '#8ff0cf' : C.ai;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 34 * s, 17 * s); ctx.fill();
    text(ctx, T('Start samtale', 'Start a chat'), w / 2, by + 22 * s, { px: 14 * s, weight: 600, color: '#0c1a16', align: 'center' });
    return;
  }
  // chat: the window the click opens, still empty, with him waving in it
  header(ctx, w, 'CtrlBuddy', S.clock, '#1c2a27');
  agentIcon(ctx, w - 110 * s, 15 * s, 8 * s);
  const bx = 18 * s, by = h - 96 * s;
  ctx.fillStyle = '#20342f';
  ctx.beginPath(); ctx.roundRect(bx, by, 250 * s, 40 * s, 12 * s); ctx.fill();
  text(ctx, T('Hei! Hva kan jeg hjelpe deg med?', 'Hi! What can I help you with?'), bx + 12 * s, by + 25 * s, { px: 14 * s, color: C.bright });
  rect(ctx, 0, h - 44 * s, w, 44 * s, '#1a2026');
  ctx.strokeStyle = hi ? C.ai : C.line; ctx.lineWidth = 1.5 * s;
  ctx.beginPath(); ctx.roundRect(14 * s, h - 36 * s, w - 28 * s, 28 * s, 14 * s); ctx.stroke();
  text(ctx, T('Skriv en melding …', 'Type a message …'), 28 * s, h - 17 * s, { px: 13 * s, color: C.dim });
}

const ADD = {
  buddy: ['CtrlBuddy', buddyScreen],
  wi: ['Water injection', waterInjection],
  flood: ['Alarm flood', flood],
  rootCause: ['Alarms by root cause', rootCause],
  agents: ['Agents', agents],
  graph: ['Knowledge graph', graphScreen],
  org: ['Agent leads', orgScreen],
  stepTest: ['Step-test finder', stepTest],
  riser: ['Riser simulator', (c, w, h) => riser(c, w, h, false)],
  antiSlug: ['Anti-slug control', (c, w, h) => riser(c, w, h, true)],
  scd: ['Logic tester', scd],
  chatPlan: ['Business-plan agent', (c, w, h) => chat(c, w, h, 'plan')],
  chatSlug: ['Control agent', (c, w, h) => chat(c, w, h, 'slug')],
  planChart: ['Business plan', planChart],
  govDocs: ['Governing documents', govDocs],
};
export function addStoryScreens() {
  // a chat and its report screen for every chat (chat beats use them)
  for (const id of Object.keys(CHATS)) {
    ADD[`chat:${id}`] = [CHATS[id].title, (c, w, h) => chat(c, w, h, id)];
    ADD[`report:${id}`] = ['Report', (c, w, h) => report(c, w, h, id)];
  }
  for (const [id, entry] of Object.entries(ADD)) {
    CONTENT[id] = entry;
    if (!LIVE.includes(id)) LIVE.push(id);
  }
}
export { agentIcon };
