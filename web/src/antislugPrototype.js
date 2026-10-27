// PROTOTYPE (throwaway): how to show active anti-slug control. A cut-open
// gas-lifted platform well slugs (casing heading) with the choke wide open;
// switch the controller on and the choke holds bottom-hole pressure, the
// slugs go away and the well can run more open, so it produces more.
//   A  single: one well, controller on/off, trend keeps the "before"
//   B  twins:  the same well twice, left without and right with the controller
// URL: antislug-prototype.html?layout=single|twins&auto=1&view=whole|top|bottom&speed=120
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SlugSim } from './slugSim.js';
import { SlugWell, WELL_DIM as D } from './slugWell.js';
import { perfPanel, perfWatch } from './perf.js';

perfPanel();
const q = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
perfWatch(renderer);
renderer.setPixelRatio(+q.get('dpr') || Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true; // the choke's glass cut

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141c21);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(-5, 10, 8);
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.7));

// backdrop: sea under the deck, rock strata, the reservoir band at the bottom
function strataTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const g = c.getContext('2d'), y = (m) => ((-0.25 - m) / 14.25) * 512; // scene y (m) -> pixel row
  const grd = g.createLinearGradient(0, 0, 0, y(-2.6)); grd.addColorStop(0, '#1d4a5e'); grd.addColorStop(1, '#0f2a38');
  g.fillStyle = grd; g.fillRect(0, 0, 64, y(-2.6));
  const bands = ['#3b3a35', '#45423a', '#34332f', '#4a463c', '#3a3832', '#433f37'];
  for (let i = 0, yy = y(-2.6); yy < y(D.res[1]); i++) { const h = 18 + (i * 37) % 30; g.fillStyle = bands[i % bands.length]; g.fillRect(0, yy, 64, h); yy += h; }
  g.fillStyle = '#7a6236'; g.fillRect(0, y(D.res[1]), 64, y(D.res[0]) - y(D.res[1]));
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,20,8,${0.25 + 0.3 * Math.random()})`; g.fillRect(Math.random() * 64, y(D.res[1]) + Math.random() * (y(D.res[0]) - y(D.res[1])), 1.5, 1.5); }
  g.fillStyle = '#2b2925'; g.fillRect(0, y(D.res[0]), 64, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(30, 14.25), new THREE.MeshBasicMaterial({ map: strataTexture() }));
backdrop.position.set(0.5, -0.25 - 14.25 / 2, -1.6);
const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 0.25, 2.6), new THREE.MeshStandardMaterial({ color: 0x55606a, roughness: 0.8, metalness: 0.2 }));
deck.position.set(0.5, -0.125, -0.3);
scene.add(backdrop, deck);

// wells and their sims; the second one only shows in the twins layout
const SAFE_U = 0.3; // the fixed choke an operator would settle for without a controller
const state = {
  layout: q.get('layout') === 'twins' ? 'twins' : 'single', auto: q.get('auto') === '1', u: 0.7, sp: 110,
  view: ['whole', 'top', 'bottom'].includes(q.get('view')) ? q.get('view') : 'whole', speed: +q.get('speed') || 120, labels: q.get('labels') !== '0',
};
const wells = [new SlugWell({ name: 'well A' }), new SlugWell({ name: 'well B' })];
const sims = [new SlugSim(), new SlugSim()];
for (const w of wells) scene.add(w.group);
const ref = new SlugSim(); ref.u = SAFE_U; ref.step(9000);
const REF = { oil: ref.wro, pbh: ref.pbh };

// history for the trend: one sample per 10 sim s
const DT_S = 10, KEEP = 360, AVG = 300; // trend: last hour; averages: last 50 min (two slug cycles)
const hist = [[], []];
let acc = 0;
function sample() {
  for (let i = 0; i < 2; i++) { const s = sims[i]; hist[i].push({ p: s.pbh, u: s.uOut, oil: s.wro, auto: s.auto }); if (hist[i].length > KEEP) hist[i].shift(); }
}
function applyModes() {
  const twins = state.layout === 'twins';
  sims[0].auto = twins ? false : state.auto; sims[0].u = state.u;
  sims[1].auto = true; sims[1].u = state.u;
  for (const s of sims) s.sp = state.sp;
  wells[1].group.visible = twins;
  wells[0].group.position.x = twins ? -2.7 : 0; wells[1].group.position.x = 2.7;
}
// pre-roll: slugging with the choke at 70 %, so the trend starts full
applyModes();
for (const s of sims) { s.u = 0.7; s.auto = false; s.step(8000); }
applyModes();
advance(KEEP * DT_S);
function advance(t) { for (; t > 0; t -= DT_S) { for (const s of sims) s.step(DT_S); sample(); } }

// camera: fit the chosen view into the band between the HUD and the dock
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const VIEWS = { // centre and half extents (scene m) for the single layout; twins widen x
  whole: { c: [0.4, -5.4], h: [3.0, 8.6] },
  top: { c: [0.6, 1.2], h: [2.6, 1.9] },
  bottom: { c: [-0.2, -11.4], h: [2.4, 2.4] },
};
const hud = document.getElementById('hud'), dock = document.getElementById('dock');
function frame() {
  const w = innerWidth, h = innerHeight, top = hud.offsetHeight, bot = dock.offsetHeight, band = Math.max(120, h - top - bot);
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.setViewOffset(w, h, 0, -(top - bot) / 2, w, h);
  const v = VIEWS[state.view], twins = state.layout === 'twins';
  const hx = v.h[0] + (twins ? 2.7 : 0), hy = v.h[1], t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(hy / (t * band / h), hx / (t * camera.aspect)) * 1.04;
  controls.target.set(twins && state.view !== 'whole' ? 0 : v.c[0], v.c[1], 0);
  camera.position.set(controls.target.x + dist * 0.12, controls.target.y + dist * 0.05, dist);
  camera.updateProjectionMatrix();
}
addEventListener('resize', frame);

// labels
// which labels each view shows (the topside is too small to label in the whole view)
const LABELS = [
  ['Lift gas in', 'gasIn', 't'], ['Christmas tree', 'tree', 't'], ['Production choke', 'choke', 'tw'], ['Controller (PIC)', 'pic', 't'], ['To separator', 'toSep', 't'],
  ['Tubing', 'tubing', 'w'], ['Annulus (lift gas)', 'annulus', 'w'], ['Gas-lift valve', 'glv', 'wb'], ['Packer', 'packer', 'b'], ['Reservoir ≈ 2 km down', 'res', 'wb'],
  ['Bottom-hole pressure', 'gauge', 'wb'],
].map(([text, key, views]) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.append(el); return { el, key, views }; });
const titles = ['Without controller', 'Anti-slug control'].map((text) => { const el = document.createElement('div'); el.className = 'lbl'; el.style.font = '600 13px var(--sans)'; el.textContent = text; document.body.append(el); return el; });

// dock
const ui = document.getElementById('ui'), note = document.getElementById('note');
function row(label, items) {
  const r = document.createElement('div'); r.className = 'row';
  r.innerHTML = `<span class="lab">${label}</span>`;
  for (const [text, on, fn] of items) {
    const b = document.createElement('button'); b.textContent = text; b._on = on;
    b.onclick = () => { fn(); refresh(); }; r.append(b);
  }
  ui.append(r);
}
row('Layout', [
  ['A · One well', () => state.layout === 'single', () => { state.layout = 'single'; frame(); }],
  ['B · Twins', () => state.layout === 'twins', () => { state.layout = 'twins'; frame(); }],
  ['Labels', () => state.labels, () => { state.labels = !state.labels; }],
]);
row('Control', [
  ['Off', () => !state.auto && state.layout === 'single', () => { state.auto = false; state.u = sims[0].uOut; }],
  ['On · hold BHP', () => state.auto && state.layout === 'single', () => { state.auto = true; }],
  ...[30, 50, 70, 100].map((p) => [`${p} %`, () => !state.auto && Math.abs(state.u - p / 100) < 1e-3, () => { state.auto = false; state.u = p / 100; }]),
]);
row('Setpoint', [105, 110, 120].map((p) => [`${p} bar`, () => state.sp === p, () => { state.sp = p; }]));
row('View', [
  ...Object.keys(VIEWS).map((k) => [k[0].toUpperCase() + k.slice(1), () => state.view === k, () => { state.view = k; frame(); }]),
  ...[60, 120, 240].map((x) => [`×${x}`, () => state.speed === x, () => { state.speed = x; }]),
]);
function refresh() {
  for (const b of ui.querySelectorAll('button')) b.classList.toggle('on', b._on());
  applyModes();
  const u = new URL(location.href);
  for (const [k, v] of Object.entries({ layout: state.layout, auto: state.auto ? 1 : 0, view: state.view, speed: state.speed })) u.searchParams.set(k, v);
  history.replaceState(null, '', u);
}
refresh();
document.getElementById('status').hidden = true;

// trend + numbers
const tc = document.getElementById('trend'), stats = document.getElementById('stats');
const C = { p: '#ff7a59', p2: '#ffb39f', u: '#57c7e3', u2: '#a6e1ef', sp: '#eef3f4', on: 'rgba(242,181,68,0.13)', grid: 'rgba(238,243,244,0.10)', text: '#9fb3ba' };
function drawTrend() {
  const dpr = Math.min(devicePixelRatio, 2), W = tc.clientWidth, H = tc.clientHeight;
  if (tc.width !== Math.round(W * dpr)) { tc.width = Math.round(W * dpr); tc.height = Math.round(H * dpr); }
  const g = tc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const L = 30, R = W - 30, T = 14, B = H - 4, P0 = 80, P1 = 170;
  const x = (i) => L + ((R - L) * i) / (KEEP - 1), yp = (p) => B - ((p - P0) / (P1 - P0)) * (B - T), yu = (u) => B - u * (B - T);
  const twins = state.layout === 'twins', main = twins ? 1 : 0, hm = hist[main];
  // controller-on spans of the main well
  g.fillStyle = C.on;
  for (let i = 0; i < hm.length; i++) if (hm[i].auto) g.fillRect(x(i + KEEP - hm.length) - 0.5, T, (R - L) / (KEEP - 1) + 1, B - T);
  g.strokeStyle = C.grid; g.lineWidth = 1; g.font = '500 9.5px "JetBrains Mono", monospace'; g.fillStyle = C.text;
  for (const p of [100, 125, 150]) { g.beginPath(); g.moveTo(L, yp(p)); g.lineTo(R, yp(p)); g.stroke(); g.textAlign = 'right'; g.fillText(p, L - 4, yp(p) + 3); }
  g.textAlign = 'left'; for (const u of [0, 0.5, 1]) g.fillText(`${u * 100}%`, R + 4, yu(u) + 3);
  g.setLineDash([4, 4]); g.strokeStyle = C.sp; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(L, yp(state.sp)); g.lineTo(R, yp(state.sp)); g.stroke(); g.globalAlpha = 1; g.setLineDash([]);
  const line = (h, key, col, y, w = 1.6) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); h.forEach((s, i) => { const xx = x(i + KEEP - h.length), yy = y(s[key]); i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }); g.stroke(); };
  if (twins) { line(hist[0], 'u', C.u2, yu, 1); line(hist[0], 'p', C.p2, yp, 1); }
  line(hm, 'u', C.u, yu); line(hm, 'p', C.p, yp, 2);
  g.textAlign = 'left'; g.font = '600 10px "Instrument Sans", system-ui, sans-serif';
  g.fillStyle = C.p; g.fillText('Bottom-hole pressure (bar)', L, 10);
  g.fillStyle = C.u; g.fillText('Choke opening', L + 150, 10);
  if (twins) { g.fillStyle = C.text; g.fillText('faint = without', L + 240, 10); }
}
const avg = (h, k) => { const s = h.slice(-AVG); return s.reduce((a, b) => a + b[k], 0) / s.length; };
const span = (h, k) => { const s = h.slice(-AVG).map((v) => v[k]); return [Math.min(...s), Math.max(...s)]; };
const m3d = (kgs) => Math.round((kgs / 760) * 86400 / 10) * 10;
function statLine(h, label) {
  const oil = avg(h, 'oil'), [lo, hi] = span(h, 'p'), gain = (oil / REF.oil - 1) * 100, full = REF.oil * 1.6;
  const catching = h.at(-1).auto && hi - lo >= 3 ? ' · <b>catching the slug…</b>' : '';
  return `<div><b>${label}</b>${catching} choke ${Math.round(avg(h, 'u') * 100)} % avg · BHP ${hi - lo < 3 ? `${avg(h, 'p').toFixed(0)} steady` : `${lo.toFixed(0)}–${hi.toFixed(0)} swinging`} · oil <b>${m3d(oil)} m³/d</b> (${gain >= 0 ? '+' : ''}${gain.toFixed(0)} %)</div>
    <div class="bar"><i style="width:${(100 * oil) / full}%;background:${gain > 5 ? '#f2b544' : '#9fb3ba'}"></i><u style="left:${(100 * REF.oil) / full}%"></u></div>`;
}
function drawStats() {
  const twins = state.layout === 'twins';
  stats.innerHTML = (twins ? statLine(hist[0], 'Without') + statLine(hist[1], 'With controller') : statLine(hist[0], sims[0].auto ? 'Controller on' : 'Controller off'))
    + `<div>Line on the bar = safe fixed choke at ${SAFE_U * 100} % (${m3d(REF.oil)} m³/d, BHP ${REF.pbh.toFixed(0)}). Averages over the last 50 min of well time.</div>`;
}
note.innerHTML = 'PROTOTYPE · not to scale. Gas-lifted well: lift gas fills the annulus, pushes through the gas-lift valve, the column lightens and blows out, then fills up again. The controller reads bottom-hole pressure and moves the choke a little, fast.';

drawStats(); frame();
const clock = new THREE.Clock(), v3 = new THREE.Vector3();
let statT = 0;
function place(el, p, show) {
  v3.copy(p).project(camera);
  const y = ((1 - v3.y) / 2) * innerHeight; // hide behind the HUD and the dock
  el.style.opacity = show && v3.z < 1 && y > hud.offsetHeight + 8 && y < innerHeight - dock.offsetHeight - 8 ? 1 : 0;
  el.style.left = `${((v3.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - v3.y) / 2) * innerHeight}px`;
}
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), simDt = dt * state.speed;
  for (const s of sims) s.step(simDt);
  acc += simDt; while (acc >= DT_S) { acc -= DT_S; sample(); }
  wells[0].update(dt, sims[0]);
  if (wells[1].group.visible) wells[1].update(dt, sims[1]);
  controls.update();
  renderer.render(scene, camera);
  drawTrend();
  if ((statT -= dt) < 0) { statT = 0.5; drawStats(); }
  const twins = state.layout === 'twins';
  for (const l of LABELS) place(l.el, wells[0].group.localToWorld(v3.copy(wells[0].anchors[l.key])).clone(), state.labels && !twins && l.views.includes(state.view[0]));
  titles.forEach((el, i) => place(el, wells[i].group.localToWorld(new THREE.Vector3(0, 3.6, 0)), twins));
  requestAnimationFrame(tick);
}
window.proto = { sims, wells, state, refresh, advance, frame };
requestAnimationFrame(tick);
