// PROTOTYPE (throwaway): the mass-balance separator model next to the simple
// one. Both run side by side on the same well stream; the 3D vessel shows one
// of them, the trends show both (solid = new, dashed = old).
// URL: separator-sim-prototype.html?show=mass|simple&oil=gap|tight|averaging&slugging=1
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Separator, DIM } from './separator.js';
import { makeSeparatorSim } from './separatorSim.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('gl'), view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2329);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-6, 12, 9);
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.6));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshLambertMaterial({ color: 0x3a4246 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = DIM.ground;
const grid = new THREE.GridHelper(60, 60, 0x55626a, 0x465157); grid.position.y = DIM.ground + 0.005;
scene.add(floor, grid);

const sep = new Separator();
scene.add(sep.group);
sep.setCut({ style: 'glass', amount: 1 });
const speed0 = Object.fromEntries(Object.entries(sep.valves).map(([k, v]) => [k, v.speed]));

const sims = { mass: makeSeparatorSim('mass'), simple: makeSeparatorSim('simple') };
const state = {
  show: q.get('show') === 'simple' ? 'simple' : 'mass',
  oil: ['gap', 'tight', 'averaging'].includes(q.get('oil')) ? q.get('oil') : 'gap',
  slugging: q.get('slugging') === '1', nextSlug: 4, big: false,
  slow: false, eqp: false, speed: 1, step: null,
};
sims.mass.oilControl(state.oil);
const slug = (size) => { for (const s of Object.values(sims)) s.slug(size); };

// ---------------------------------------------------------------- camera

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.target.set(-0.3, 0.2, 0); controls.maxPolarAngle = Math.PI * 0.55;
function frame() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  const halfW = 6.2, halfH = 3.8, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(halfH / t, halfW / (t * camera.aspect)) + 2;
  camera.position.set(1.0, 2.2, dist).add(controls.target);
  camera.updateProjectionMatrix();
  for (const c of trends) c.size();
}

// ---------------------------------------------------------------- trends

const C = { mass: '#f2b544', simple: '#9fb3ba', sp: 'rgba(238,243,244,0.45)', band: 'rgba(242,181,68,0.13)', act: '#7dffa8', grid: 'rgba(238,243,244,0.1)' };
const SPAN = 90, RATE = 5; // seconds shown, samples per second
const hist = [];
class Trend {
  constructor(title, unit, lo, hi, lines, extra) {
    Object.assign(this, { title, unit, lo, hi, lines, extra });
    this.c = document.createElement('canvas'); document.getElementById('hud').append(this.c);
  }
  size() { const r = this.c.getBoundingClientRect(); this.c.width = r.width * devicePixelRatio; this.c.height = r.height * devicePixelRatio; }
  draw() {
    const g = this.c.getContext('2d'), d = devicePixelRatio, W = this.c.width, H = this.c.height, top = 16 * d, bot = H - 4 * d;
    g.clearRect(0, 0, W, H);
    const y = (v) => bot - ((v - this.lo) / (this.hi - this.lo)) * (bot - top), x = (i) => (i / (SPAN * RATE - 1)) * W;
    g.fillStyle = C.grid; for (let k = 0; k <= 4; k++) g.fillRect(0, top + ((bot - top) * k) / 4, W, d);
    this.extra?.(g, y, W);
    for (const [key, col, dash, width] of this.lines) {
      g.strokeStyle = col; g.lineWidth = (width ?? 1.6) * d; g.setLineDash(dash ? [4 * d, 3 * d] : []);
      g.beginPath();
      hist.forEach((h, i) => { const v = h[key]; if (v == null) return; const yy = Math.max(top, Math.min(bot, y(v))); i ? g.lineTo(x(i), yy) : g.moveTo(x(i), yy); });
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = '#eef3f4'; g.font = `500 ${10.5 * d}px Instrument Sans, system-ui`; g.textBaseline = 'top';
    g.fillText(this.title, 0, 2 * d);
    g.fillStyle = '#9fb3ba'; g.textAlign = 'right';
    const range = `${this.lo}–${this.hi}`;
    if (g.measureText(this.title).width + g.measureText(range).width + 12 * d < W) g.fillText(range, W, 2 * d);
    g.textAlign = 'left';
  }
}
const spLine = (v) => (g, y, W) => { g.fillStyle = C.sp; g.fillRect(0, y(v()), W, devicePixelRatio); };
const m = sims.mass;
const trends = [
  new Trend('Pressure, barg', 'barg', 6, 11, [['Ps', C.simple, true], ['P', C.mass]], spLine(() => m.sp.P)),
  new Trend('Oil compartment level, %', '%', 0, 100, [['oilS', C.simple, true], ['oil', C.mass]], (g, y, W) => {
    const sp = m.spPct('oil'), gap = m.ctl.oil.gap;
    if (gap) { g.fillStyle = C.band; g.fillRect(0, y(sp + gap.width), W, y(sp - gap.width) - y(sp + gap.width)); }
    spLine(() => sp)(g, y, W);
  }),
  new Trend('Oil valve, %', '%', 0, 100, [['uS', C.simple, true], ['u', C.mass, false, 1], ['z', C.act]]),
  new Trend('Oil in water, ppm', 'ppm', 0, 1500, [['oiw', C.mass]]),
];

// ---------------------------------------------------------------- UI

const ui = document.getElementById('ui'), read = document.getElementById('read'), tag = document.getElementById('tag');
function row(label, items) {
  const r = document.createElement('div'); r.className = 'row';
  r.innerHTML = `<span class="lab">${label}</span>`;
  for (const [text, on, fn] of items) {
    const b = document.createElement('button'); b.textContent = text; b._on = on;
    b.onclick = () => { fn(); refresh(); }; r.append(b);
  }
  ui.append(r);
}
row('Well', [
  ['Big slug', () => false, () => slug(1.2)],
  ['Small slug', () => false, () => slug(0.4)],
  ['Slugging well', () => state.slugging, () => { state.slugging = !state.slugging; state.nextSlug = m.t + 1; }],
]);
row('Oil LC', [['Gap', 'gap'], ['Tight', 'tight'], ['Averaging', 'averaging']].map(([t, k]) => [t, () => state.oil === k, () => { state.oil = k; m.oilControl(k); }]));
row('Test', [
  ['Step test LV water', () => state.step != null, () => {
    if (state.step != null) return;
    state.step = m.t; for (const s of Object.values(sims)) s.manual('water', s.u.water + 0.1);
  }],
  ['Slow valves', () => state.slow, () => { state.slow = !state.slow; m.stroke = state.slow ? { gas: 20, oil: 30, water: 30 } : { gas: 6, oil: 8, water: 8 }; }],
  ['Eq % valves', () => state.eqp, () => { state.eqp = !state.eqp; for (const s of Object.values(sims)) s.valve = state.eqp ? 'eqp' : 'linear'; }],
]);
row('3D shows', [
  ['New model', () => state.show === 'mass', () => { state.show = 'mass'; }],
  ['Old model', () => state.show === 'simple', () => { state.show = 'simple'; for (const [k, v] of Object.entries(sep.valves)) v.speed = speed0[k]; }],
  ...[1, 3].map((s) => [`${s}x time`, () => state.speed === s, () => { state.speed = s; }]),
]);
function refresh() {
  for (const b of ui.querySelectorAll('button')) b.classList.toggle('on', b._on());
  const u = new URL(location.href);
  u.searchParams.set('show', state.show); u.searchParams.set('oil', state.oil); u.searchParams.set('slugging', state.slugging ? 1 : 0);
  history.replaceState(null, '', u);
}
refresh();

// ---------------------------------------------------------------- loop

addEventListener('resize', frame); frame();
document.getElementById('status').hidden = true;
const clock = new THREE.Clock();
let sampleT = 0;
function stepAll(dt) {
  if (state.slugging && m.t > state.nextSlug) { state.big = !state.big; slug(state.big ? 1.1 : 0.4); state.nextSlug = m.t + (state.big ? 28 : 14); }
  if (state.step != null && m.t - state.step > 20) { state.step = null; for (const s of Object.values(sims)) s.auto('water'); refresh(); }
  for (const s of Object.values(sims)) s.step(dt);
  if ((sampleT += dt) >= 1 / RATE) {
    sampleT = 0;
    const o = sims.simple;
    hist.push({ P: m.P, Ps: o.P, oil: m.pv('oil'), oilS: m.pct(o.hO, m.range.oil), u: m.u.oil * 100, z: m.z.oil * 100, uS: o.u.oil * 100, oiw: m.oiw });
    if (hist.length > SPAN * RATE) hist.shift();
  }
}
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (let i = 0; i < state.speed; i++) stepAll(dt);
  const s = sims[state.show];
  s.apply(sep);
  sep.update(dt * state.speed, s.stir);
  controls.update();
  renderer.render(scene, camera);
  for (const t of trends) t.draw();
  const zone = m.ctl.oil.gap ? ` (${m.ctl.oil.zone} the gap)` : '';
  tag.innerHTML = `PROTOTYPE · 3D: ${state.show === 'mass' ? 'new mass-balance model' : 'old level-only model'}<br><span>Oil level control: ${state.oil}${zone}${state.step != null ? ' · step test running' : ''}</span>`;
  read.innerHTML = `<b>Trends</b> solid = new · dashed = old · green = valve actual (new) · band = oil gap<br><b>New</b> P ${m.P.toFixed(2)} barg · OiW ${m.oiw.toFixed(0)} ppm · WiO ${m.wio.toFixed(1)} % · gas load ${(100 * m.sbRatio).toFixed(0)} % of Souders-Brown${m.carry > 0.001 ? ` · carry-over ${(100 * m.carry).toFixed(1)} %` : ''}` +
    `<br><b>Valves</b> gas ${(100 * m.z.gas).toFixed(0)} % · water ${(100 * m.z.water).toFixed(0)} % · oil ${(100 * m.z.oil).toFixed(0)} % · <b>Old</b> P ${sims.simple.P.toFixed(2)} barg`;
  requestAnimationFrame(tick);
}
window.proto = { sims, sep, state, run: (sec) => { for (let t = 0; t < sec; t += 1 / 60) stepAll(1 / 60); } };
requestAnimationFrame(tick);
