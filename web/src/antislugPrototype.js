// PROTOTYPE (throwaway): how to show active anti-slug control. A cut-open
// gas-lifted platform well slugs (casing heading) with the choke wide open;
// switch the controller on and the choke holds bottom-hole pressure, the
// slugs go away and the well can run more open, so it produces more.
// Topside the choke feeds the cut-open inlet separator from the separator
// scene, so the slugs show up as level swings there too (Adriaen picked
// "separator now, platform later"; the twin-well layout of the first
// preview is replaced by a faint "without controller" line in the trend).
// URL: antislug-prototype.html?auto=1&view=whole|topside|bottom&speed=120
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SlugSim } from './slugSim.js';
import { SlugWell, WELL_DIM as D, pipeRun, flowUpdate } from './slugWell.js';
import { Separator, SeparatorSim, DIM as SDIM } from './separator.js';
import { perfPanel, perfWatch } from './perf.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

perfPanel();
const q = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
perfWatch(renderer);
renderer.setPixelRatio(+q.get('dpr') || Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true; // the glass cuts of the choke and the separator

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141c21);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(-5, 10, 8);
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.7));

// Layout in metres: the deck top at y = 0. The well model is drawn at half
// size, so its group is scaled 2x (tree ~3 m); the separator is real size.
const WS = 2, WELL_X = -9, WELL_Y = 0.4 * WS; // casing head bottom on the deck
const wy = (local) => WELL_Y + WS * local; // well-local height -> world
const SEP = new THREE.Vector3(0, -SDIM.ground, 0); // skid feet on the deck
const BOTTOM = wy(D.res[0]) - 1.5;

// The ground and the sea as a 3D block diagram, cut on the well's plane
// (z = 0) with a notch around the well so its cut-open half stays in view.
// Platform well, not subsea (Adriaen 2026-10-30): the well goes straight
// down from the wellbay through a conductor inside the jacket, so there is
// no riser between the tree and the choke. Depths are squeezed: the sea is
// ~110 m deep, the reservoir ~2 km down.
const SEA = -1.4, SEABED = -6, BACK = -9, NOTCH = [WELL_X - 1.9, WELL_X + 1.9, -1.9];
const BX0 = -17, BX1 = 9;
function strataTexture() { // rows run from the seabed (top) to the bottom of the block
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const g = c.getContext('2d'), y = (m) => ((SEABED - m) / (SEABED - BOTTOM)) * 512;
  g.fillStyle = '#6d6248'; g.fillRect(0, 0, 64, 10); // seabed sediment
  const bands = ['#3b3a35', '#45423a', '#34332f', '#4a463c', '#3a3832', '#433f37'];
  for (let i = 0, yy = 10; yy < y(wy(D.res[1])); i++) { const h = 18 + (i * 37) % 30; g.fillStyle = bands[i % bands.length]; g.fillRect(0, yy, 64, h); yy += h; }
  const r0 = y(wy(D.res[1])), r1 = y(wy(D.res[0]));
  g.fillStyle = '#7a6236'; g.fillRect(0, r0, 64, r1 - r0);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,20,8,${0.25 + 0.3 * Math.random()})`; g.fillRect(Math.random() * 64, r0 + Math.random() * (r1 - r0), 1.5, 1.5); }
  g.fillStyle = '#2b2925'; g.fillRect(0, r1, 64, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
// a box x0..x1, y0..y1, z0..z1; with `earth`, uv follows world height (strata
// line up across every face) and the top gets a gentle seabed swell
function block(x0, x1, y0, y1, z0, z1, earth) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, earth ? Math.ceil(x1 - x0) : 1, 1, earth ? Math.ceil(z1 - z0) : 1);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  if (earth) {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (p.getY(i) > y1 - 1e-3) p.setY(i, y1 + 0.12 * Math.sin(x * 0.7 + z * 0.4) + 0.08 * Math.sin(z * 1.3 - x * 0.3));
      uv.setXY(i, (x + z) / 9, 1 - (SEABED - p.getY(i)) / (SEABED - BOTTOM));
    }
    g.computeVertexNormals();
  }
  return g.toNonIndexed();
}
const notched = (y0, y1, earth) => [block(BX0, NOTCH[0], y0, y1, BACK, 0, earth), block(NOTCH[1], BX1, y0, y1, BACK, 0, earth), block(NOTCH[0], NOTCH[1], y0, y1, BACK, NOTCH[2], earth)];
const earth = new THREE.Mesh(mergeGeometries(notched(BOTTOM, SEABED, true)), new THREE.MeshLambertMaterial({ map: strataTexture() }));
const water = new THREE.Mesh(mergeGeometries(notched(SEABED, SEA, false)),
  new THREE.MeshStandardMaterial({ color: 0x1f6f8a, transparent: true, opacity: 0.38, roughness: 0.15, metalness: 0, depthWrite: false }));
water.renderOrder = 1;
const deck = new THREE.Mesh(new THREE.BoxGeometry(28, 0.25, 9), new THREE.MeshStandardMaterial({ color: 0x55606a, roughness: 0.8, metalness: 0.2 }));
deck.position.set(-4, -0.125, -3.5);
scene.add(earth, water, deck);

// jacket: four battered legs from the deck to the seabed, braced on every
// face, and the conductor around the well (back half, cut like the well)
const jacketMat = new THREE.MeshStandardMaterial({ color: 0xc9b23a, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide });
{
  const parts = [], V = (x, y, z) => new THREE.Vector3(x, y, z);
  const tubeAB = (a, b, r, seg = 8) => {
    const t = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg, 1, true);
    t.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize()));
    t.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); parts.push(t);
  };
  const top = [V(-15.5, -0.25, -6.5), V(6.5, -0.25, -6.5), V(6.5, -0.25, -0.5), V(-15.5, -0.25, -0.5)];
  const bot = [V(-16.6, SEABED, -7.6), V(7.6, SEABED, -7.6), V(7.6, SEABED, -0.3), V(-16.6, SEABED, -0.3)];
  const at = (k, f) => top[k].clone().lerp(bot[k], f);
  for (let k = 0; k < 4; k++) tubeAB(top[k], bot[k], 0.5, 10);
  const levels = [0.02, 0.5, 0.98];
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    for (const f of levels) tubeAB(at(k, f), at(n, f), 0.18, 6); // horizontal frames
    for (let j = 0; j < levels.length - 1; j++) { // X braces between frames
      tubeAB(at(k, levels[j]), at(n, levels[j + 1]), 0.14, 5); tubeAB(at(n, levels[j]), at(k, levels[j + 1]), 0.14, 5);
    }
  }
  const cond = new THREE.CylinderGeometry(WS * (D.rc + 0.16), WS * (D.rc + 0.16), -0.25 - SEABED + 0.6, 14, 1, true, Math.PI / 2, Math.PI);
  cond.translate(WELL_X, (-0.25 + SEABED - 0.6) / 2, 0); parts.push(cond);
  scene.add(new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), jacketMat));
}

// the well, its choke and controller
const well = new SlugWell({ name: 'well', flowline: false });
well.group.position.set(WELL_X, WELL_Y, 0); well.group.scale.setScalar(WS);
scene.add(well.group);

// the separator, cut open (glass), with its own level loops
const sep = new Separator({ inlet: 'vane', gas: 'cyclones', inletChoke: false }); // the tree's production choke does the choking
sep.group.position.copy(SEP);
sep.setCut({ style: 'glass', amount: 1 });
sep.U.uLook.value = 1;
scene.add(sep.group);
const sepSim = new SeparatorSim();
// the well stream drives the separator's inflow through sepSim.feed (1 = normal)
const NOMINAL = 14.8; // kg/s of well liquid that counts as the separator's normal inflow (the controlled well)
// The well runs ~120x faster than the separator (which runs in real time), so a
// surge that takes minutes in the well passes in seconds on screen; scaling
// the deviation keeps roughly the liquid volume a real surge would bring.
const SURGE = 8;

// flowline: choke outlet down, back behind the separator, along to its inlet pipe
const chokeOut = new THREE.Vector3(WELL_X + WS * D.chokeX, wy(D.wing - 3.4 * 0.13), 0);
const inletStart = new THREE.Vector3(SDIM.inletX, SDIM.R + 1.7, -4).add(SEP); // where the separator's own inlet pipe begins
const FY = 1.0;
const run = pipeRun([chokeOut, new THREE.Vector3(chokeOut.x, FY, 0), new THREE.Vector3(chokeOut.x, FY, -4), new THREE.Vector3(inletStart.x, FY, -4), inletStart], 0.24);
scene.add(run.contents, run.sleeve);

// sims: the well, a twin without controller (faint line in the trend), and
// a safe fixed choke as the reference for the production bar
const SAFE_U = 0.3; // the fixed choke an operator would settle for without a controller
const state = {
  auto: q.get('auto') === '1', u: 0.7, sp: 110,
  view: ['whole', 'topside', 'bottom', 'separator'].includes(q.get('view')) ? q.get('view') : 'whole', speed: +q.get('speed') || 120, labels: q.get('labels') !== '0',
};
const sim = new SlugSim(), ghost = new SlugSim();
const ref = new SlugSim(); ref.u = SAFE_U; ref.step(9000);
const REF = { oil: ref.wro, pbh: ref.pbh };
const DT_S = 10, KEEP = 360, AVG = 300; // trend: last hour; averages: last 50 min (two slug cycles)
const hist = [[], []];
let acc = 0;
function sample() {
  [sim, ghost].forEach((s, i) => { hist[i].push({ p: s.pbh, u: s.uOut, oil: s.wro, auto: s.auto }); if (hist[i].length > KEEP) hist[i].shift(); });
  // separator levels alongside (it runs in screen time, so these are its last ~30 s)
  hist[0].at(-1).lv = { L: sepSim.hL, W: sepSim.hW, O: sepSim.hO };
}
function applyModes() {
  sim.auto = state.auto; sim.u = state.u; sim.sp = state.sp;
  ghost.auto = false; ghost.u = state.auto ? 0.7 : state.u;
}
function advance(t) { for (; t > 0; t -= DT_S) { sim.step(DT_S); ghost.step(DT_S); sample(); } }
// pre-roll: slugging with the choke at 70 %, so the trend starts full
for (const s of [sim, ghost]) { s.u = 0.7; s.step(8000); }
applyModes(); advance(KEEP * DT_S);

// camera: fit the chosen view into the band between the HUD and the dock
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400); // near 0.5: more depth precision for the far views
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const VIEWS = { // centre and half extents (m)
  whole: { c: [-4, -10.9], h: [12.5, 17.6] },
  topside: { c: [-4.4, 3.4], h: [9.6, 4.6] },
  separator: { c: [0, 3.6], h: [5.6, 3.6] },
  bottom: { c: [WELL_X - 0.6, wy(-11.2)], h: [4.4, 4.4] },
};
const hud = document.getElementById('hud'), dock = document.getElementById('dock');
function frame() {
  const w = innerWidth, h = innerHeight, bot = dock.offsetHeight;
  // the HUD sits on top (portrait) or as a column on the right (wide screens)
  const sideHud = hud.offsetWidth < w - 1;
  const top = sideHud ? 0 : hud.offsetHeight, right = sideHud ? hud.offsetWidth : 0;
  const bandH = Math.max(120, h - top - bot), bandW = Math.max(120, w - right);
  renderer.setSize(w, h, false); camera.aspect = w / h;
  camera.setViewOffset(w, h, right / 2, -(top - bot) / 2, w, h);
  const v = VIEWS[state.view], t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(v.h[1] / (t * bandH / h), v.h[0] / (t * camera.aspect * bandW / w)) * (state.view === 'whole' ? 1.1 : 1.04);
  controls.target.set(v.c[0], v.c[1], 0);
  // three-quarter views from the front right and above, so the block, the
  // jacket and the deck read as 3D
  const [side, lift] = { whole: [0.55, 0.32], topside: [0.3, 0.24], separator: [0.15, 0.22], bottom: [0.35, 0.1] }[state.view];
  camera.position.set(controls.target.x + dist * side, controls.target.y + dist * lift, dist);
  camera.updateProjectionMatrix();
}
addEventListener('resize', frame);

// labels: [text, world position, views (w whole, t topside, s separator, b bottom)]
const wl = (key) => () => well.group.localToWorld(well.anchors[key].clone());
const LABELS = [
  ['Lift gas in', wl('gasIn'), 't'], ['Christmas tree', wl('tree'), 't'], ['Production choke', wl('choke'), 'tw'], ['Controller (PIC)', wl('pic'), 't'],
  ['Flowline', () => new THREE.Vector3((chokeOut.x + inletStart.x) / 2, FY + 0.5, -4), 't'],
  ['Inlet separator', () => new THREE.Vector3(1.5, SEP.y + SDIM.R + 0.5, 0), 'tws'],
  ['Liquid level', () => new THREE.Vector3(-2.6, SEP.y + sepSim.hL + 0.2, 1.2), 's'], ['Weir', () => new THREE.Vector3(SDIM.weirX, SEP.y + SDIM.crest + 0.3, 1.2), 's'],
  ['Conductor (no riser)', () => new THREE.Vector3(WELL_X + WS * (D.rc + 0.2) + 0.2, -2.6, 0), 'w'], ['Seabed', () => new THREE.Vector3(-13.5, SEABED + 0.5, 0), 'w'], ['Sea', () => new THREE.Vector3(3, SEA - 0.8, 0), 'w'],
  ['Tubing', wl('tubing'), 'w'], ['Annulus (lift gas)', wl('annulus'), 'w'], ['Gas-lift valve', wl('glv'), 'wb'], ['Packer', wl('packer'), 'b'],
  ['Reservoir ≈ 2 km down', wl('res'), 'wb'], ['Bottom-hole pressure', wl('gauge'), 'wb'],
].map(([text, at, views]) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.append(el); return { el, at, views }; });

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
row('Control', [
  ['Off', () => !state.auto, () => { state.auto = false; state.u = Math.round(sim.uOut * 10) / 10; }],
  ['On · hold BHP', () => state.auto, () => { state.auto = true; }],
  ...[30, 50, 70, 100].map((p) => [`${p} %`, () => !state.auto && Math.abs(state.u - p / 100) < 1e-3, () => { state.auto = false; state.u = p / 100; }]),
]);
row('Setpoint', [105, 110, 120].map((p) => [`${p} bar`, () => state.sp === p, () => { state.sp = p; }]));
row('View', [
  ...Object.keys(VIEWS).map((k) => [k[0].toUpperCase() + k.slice(1), () => state.view === k, () => { state.view = k; frame(); }]),
  ['Labels', () => state.labels, () => { state.labels = !state.labels; }],
]);
row('Speed', [60, 120, 240].map((x) => [`×${x}`, () => state.speed === x, () => { state.speed = x; }]));
function refresh() {
  for (const b of ui.querySelectorAll('button')) b.classList.toggle('on', b._on());
  applyModes();
  const u = new URL(location.href);
  for (const [k, v] of Object.entries({ auto: state.auto ? 1 : 0, view: state.view, speed: state.speed })) u.searchParams.set(k, v);
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
  const hm = hist[0], ghostOn = hm.some((s) => s.auto);
  g.fillStyle = C.on; // controller-on spans
  for (let i = 0; i < hm.length; i++) if (hm[i].auto) g.fillRect(x(i + KEEP - hm.length) - 0.5, T, (R - L) / (KEEP - 1) + 1, B - T);
  g.strokeStyle = C.grid; g.lineWidth = 1; g.font = '500 9.5px "JetBrains Mono", monospace'; g.fillStyle = C.text;
  for (const p of [100, 125, 150]) { g.beginPath(); g.moveTo(L, yp(p)); g.lineTo(R, yp(p)); g.stroke(); g.textAlign = 'right'; g.fillText(p, L - 4, yp(p) + 3); }
  g.textAlign = 'left'; for (const u of [0, 0.5, 1]) g.fillText(`${u * 100}%`, R + 4, yu(u) + 3);
  if (state.auto) { g.setLineDash([4, 4]); g.strokeStyle = C.sp; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(L, yp(state.sp)); g.lineTo(R, yp(state.sp)); g.stroke(); g.globalAlpha = 1; g.setLineDash([]); }
  const line = (h, key, col, y, w = 1.6, from = 0) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let started = false; h.forEach((s, i) => { if (i < from) return; const xx = x(i + KEEP - h.length), yy = y(s[key]); started ? g.lineTo(xx, yy) : g.moveTo(xx, yy); started = true; }); g.stroke(); };
  if (ghostOn) { const from = hm.findIndex((s) => s.auto); g.globalAlpha = 0.45; line(hist[1], 'p', C.p2, yp, 1.2, from); g.globalAlpha = 1; }
  line(hm, 'u', C.u, yu); line(hm, 'p', C.p, yp, 2);
  g.textAlign = 'left'; g.font = '600 10px "Instrument Sans", system-ui, sans-serif';
  g.fillStyle = C.p; g.fillText('Bottom-hole pressure (bar)', L, 10);
  g.fillStyle = C.u; g.fillText('Choke opening', L + 150, 10);
  if (ghostOn) { g.fillStyle = C.p2; g.fillText('faint: without', L + 240, 10); }
}
// separator levels (m above the vessel bottom): liquid surface, oil-water
// interface, oil compartment behind the weir, with the weir crest and setpoints
const lc = document.getElementById('levels');
const LC = { L: '#e8a33d', W: '#5aa9e6', O: '#c98be0' };
const bottomOf = SDIM.R - SDIM.T; // interior radius: level 0 is the vessel bottom
function drawLevels() {
  const dpr = Math.min(devicePixelRatio, 2), W = lc.clientWidth, H = lc.clientHeight;
  if (lc.width !== Math.round(W * dpr)) { lc.width = Math.round(W * dpr); lc.height = Math.round(H * dpr); }
  const g = lc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const L = 30, R = W - 30, T = 14, B = H - 3, Y0 = 0.4, Y1 = 1.3;
  const x = (i) => L + ((R - L) * i) / (KEEP - 1), y = (h) => B - ((h + bottomOf - Y0) / (Y1 - Y0)) * (B - T);
  const hm = hist[0];
  g.fillStyle = C.on;
  for (let i = 0; i < hm.length; i++) if (hm[i].auto) g.fillRect(x(i + KEEP - hm.length) - 0.5, T, (R - L) / (KEEP - 1) + 1, B - T);
  g.strokeStyle = C.grid; g.lineWidth = 1; g.font = '500 9.5px "JetBrains Mono", monospace'; g.fillStyle = C.text; g.textAlign = 'right';
  for (const m of [0.6, 1.0]) { const yy = B - ((m - Y0) / (Y1 - Y0)) * (B - T); g.beginPath(); g.moveTo(L, yy); g.lineTo(R, yy); g.stroke(); g.fillText(m.toFixed(1), L - 4, yy + 3); }
  g.setLineDash([3, 4]); g.globalAlpha = 0.6;
  for (const [h, col] of [[SDIM.crest, C.sp], [sepSim.sp.interface, LC.W], [sepSim.sp.bucket, LC.O]]) { g.strokeStyle = col; g.beginPath(); g.moveTo(L, y(h)); g.lineTo(R, y(h)); g.stroke(); }
  g.setLineDash([]); g.globalAlpha = 1;
  for (const k of ['W', 'O', 'L']) {
    g.strokeStyle = LC[k]; g.lineWidth = 1.6; g.beginPath(); let on = false;
    hm.forEach((s, i) => { if (!s.lv) return; const xx = x(i + KEEP - hm.length), yy = y(s.lv[k]); on ? g.lineTo(xx, yy) : g.moveTo(xx, yy); on = true; });
    g.stroke();
  }
  g.textAlign = 'left'; g.font = '600 10px "Instrument Sans", system-ui, sans-serif';
  [['Liquid level', 'L', 0], ['Interface', 'W', 78], ['Oil compartment', 'O', 140], ['(m) dashed: weir, SP', null, 236]].forEach(([t, k, dx]) => { g.fillStyle = k ? LC[k] : C.text; g.fillText(t, L + dx, 10); });
}
const avg = (h, k) => { const s = h.slice(-AVG); return s.reduce((a, b) => a + b[k], 0) / s.length; };
const span = (h, k) => { const s = h.slice(-AVG).map((v) => v[k]); return [Math.min(...s), Math.max(...s)]; };
const m3d = (kgs) => Math.round((kgs / 760) * 86400 / 10) * 10;
const lvl = []; // separator liquid level, last 30 s of screen time
function drawStats() {
  const h = hist[0], oil = avg(h, 'oil'), [lo, hi] = span(h, 'p'), gain = (oil / REF.oil - 1) * 100, full = REF.oil * 1.6;
  const catching = sim.auto && hi - lo >= 3 ? ' · <b>catching the slug…</b>' : '';
  const sw = lvl.length ? (Math.max(...lvl) - Math.min(...lvl)) * 100 : 0;
  stats.innerHTML = `<div><b>${sim.auto ? 'Controller on' : 'Controller off'}</b>${catching} · choke ${Math.round(avg(h, 'u') * 100)} % avg · BHP ${hi - lo < 3 ? `${avg(h, 'p').toFixed(0)} steady` : `${lo.toFixed(0)}–${hi.toFixed(0)} swinging`} · separator level ${sw < 6 ? 'steady' : `swings ${sw.toFixed(0)} cm`}</div>
    <div>Oil <b>${m3d(oil)} m³/d</b> (${gain >= 0 ? '+' : ''}${gain.toFixed(0)} % vs safe fixed choke at ${SAFE_U * 100} %, the line on the bar)</div>
    <div class="bar"><i style="width:${(100 * oil) / full}%;background:${gain > 5 ? '#f2b544' : '#9fb3ba'}"></i><u style="left:${(100 * REF.oil) / full}%"></u></div>`;
}
note.innerHTML = 'PROTOTYPE · not to scale. Gas-lifted well: lift gas fills the annulus, pushes through the gas-lift valve, the column lightens and blows out, then fills up again. The controller reads bottom-hole pressure and moves the choke a little, fast. Averages over the last 50 min of well time.';
drawStats(); frame();

const clock = new THREE.Clock(), v3 = new THREE.Vector3();
let statT = 0, lvlT = 0, lastFeed = 1, waveCool = 0;
function place(el, p, show) {
  v3.copy(p).project(camera);
  const y = ((1 - v3.y) / 2) * innerHeight; // hide behind the HUD and the dock
  const x = ((v3.x + 1) / 2) * innerWidth, side = hud.offsetWidth < innerWidth - 1;
  const clear = side ? x < innerWidth - hud.offsetWidth - 8 : y > hud.offsetHeight + 8;
  el.style.opacity = show && v3.z < 1 && clear && y < innerHeight - dock.offsetHeight - 8 ? 1 : 0;
  el.style.left = `${((v3.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - v3.y) / 2) * innerHeight}px`;
}
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  stepWorld(dt);
  controls.update();
  renderer.render(scene, camera);
  drawTrend(); drawLevels();
  if ((statT -= dt) < 0) { statT = 0.5; drawStats(); }
  for (const l of LABELS) place(l.el, l.at(), state.labels && l.views.includes(state.view[0]));
  requestAnimationFrame(tick);
}
/** Everything that moves, for one frame of dt seconds (also used by QA to fast-forward). */
function stepWorld(dt) {
  const simDt = dt * state.speed;
  sim.step(simDt); ghost.step(simDt);
  acc += simDt; while (acc >= DT_S) { acc -= DT_S; sample(); }
  well.update(dt, sim);
  flowUpdate(run.contents.material.uniforms, dt, sim);
  // the well stream into the separator; a sharp rise starts a wave down the vessel
  const f = Math.max(0.1, 1 + (sim.wOil / NOMINAL - 1) * SURGE);
  sepSim.feed = f;
  if ((waveCool -= dt) < 0 && (f - lastFeed) / Math.max(dt, 1e-3) > 1.5) { sepSim.packets.push({ x: sepSim.source, v: 3.2, a: 0.12 }); waveCool = 2.5; }
  lastFeed = f;
  sepSim.step(dt); sepSim.apply(sep); sep.update(dt, sepSim.stir);
  if ((lvlT -= dt) < 0) { lvlT = 0.25; lvl.push(sepSim.hL); if (lvl.length > 120) lvl.shift(); }
}
window.proto = { sim, ghost, sepSim, well, sep, state, refresh, advance, frame, run: (sec) => { for (let t = 0; t < sec; t += 1 / 60) stepWorld(1 / 60); } };
requestAnimationFrame(tick);
