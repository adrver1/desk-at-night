// PROTOTYPE (throwaway): two separator sims side by side on the same well
// stream; the 3D vessel shows one of them, the trends show both (solid = new,
// dashed = old). Two comparisons:
//   tuning  old vs re-tuned oil level gap controller, both on the mass-balance model
//   model   the simple level-only sim vs the mass-balance one
// URL: separator-sim-prototype.html?compare=tuning|model&show=a|b&slugging=1&speed=3
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Separator, DIM } from './separator.js';
import { SeparatorCompare, drawTrend } from './separatorCompare.js';

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
// floor and grid end together and fade into the background with fog
scene.fog = new THREE.Fog(0x1a2329, 18, 32);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshLambertMaterial({ color: 0x3a4246 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = DIM.ground;
const grid = new THREE.GridHelper(24, 24, 0x55626a, 0x465157); grid.position.y = DIM.ground + 0.005;
scene.add(floor, grid);

const sep = new Separator();
scene.add(sep.group);
sep.setCut({ style: 'glass', amount: 1 });
const speed0 = Object.fromEntries(Object.entries(sep.valves).map(([k, v]) => [k, v.speed]));

const state = {
  compare: q.get('compare') === 'model' ? 'model' : 'tuning',
  show: q.get('show') === 'a' ? 'a' : 'b',
  oil: 'gap', slugging: q.get('slugging') !== '0',
  slow: false, eqp: false, speed: q.get('speed') === '1' ? 1 : 3, step: null,
};
let cmp;
function build() {
  cmp = new SeparatorCompare(state.compare);
  cmp.slugging = state.slugging;
  state.oil = 'gap'; state.step = null; state.slow = false; state.eqp = false;
  for (const [k, v] of Object.entries(sep.valves)) v.speed = speed0[k];
}
build();

// ---------------------------------------------------------------- camera

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.target.set(-0.3, 0.2, 0); controls.maxPolarAngle = Math.PI * 0.55;
const hud = document.getElementById('hud');
const trendCanvases = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); hud.append(c); return c; });
function frame() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  const halfW = 6.2, halfH = 3.8, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(halfH / t, halfW / (t * camera.aspect)) + 2;
  camera.position.set(1.0, 2.2, dist).add(controls.target);
  camera.updateProjectionMatrix();
  for (const c of trendCanvases) { const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio; }
}

// ---------------------------------------------------------------- UI

const ui = document.getElementById('ui'), read = document.getElementById('read'), tag = document.getElementById('tag');
function row(label, items, visible = () => true) {
  const r = document.createElement('div'); r.className = 'row'; r._vis = visible;
  r.innerHTML = `<span class="lab">${label}</span>`;
  for (const [text, on, fn] of items) {
    const b = document.createElement('button'); b._text = text; b._on = on;
    b.onclick = () => { fn(); refresh(); }; r.append(b);
  }
  ui.append(r);
}
const both = (fn) => { for (const s of cmp.sims()) fn(s); };
row('Compare', [
  ['Tunings', () => state.compare === 'tuning', () => { state.compare = 'tuning'; build(); }],
  ['Models', () => state.compare === 'model', () => { state.compare = 'model'; build(); }],
]);
row('Well', [
  ['Slugging well', () => state.slugging, () => { state.slugging = cmp.slugging = !state.slugging; }],
  ['Big slug', () => false, () => cmp.slug(1.2)],
  ['Small slug', () => false, () => cmp.slug(0.4)],
]);
row('Oil LC', [['Gap', 'gap'], ['Old gap', 'gap-old'], ['Tight', 'tight'], ['Averaging', 'averaging']].map(([t, k]) => [t, () => state.oil === k, () => { state.oil = k; cmp.b.oilControl(k); }]), () => state.compare === 'model');
row('Test', [
  ['Step test LV water', () => state.step != null, () => {
    if (state.step != null) return;
    state.step = cmp.b.t; both((s) => s.manual('water', s.u.water + 0.1));
  }],
  ['Slow valves', () => state.slow, () => { state.slow = !state.slow; both((s) => { if (s.stroke) s.stroke = state.slow ? { gas: 20, oil: 30, water: 30 } : { gas: 6, oil: 8, water: 8 }; }); }],
  ['Eq % valves', () => state.eqp, () => { state.eqp = !state.eqp; both((s) => { s.valve = state.eqp ? 'eqp' : 'linear'; }); }],
]);
row('3D shows', [
  [() => cmp.names.b, () => state.show === 'b', () => { state.show = 'b'; }],
  [() => cmp.names.a, () => state.show === 'a', () => { state.show = 'a'; for (const [k, v] of Object.entries(sep.valves)) v.speed = speed0[k]; }],
  ...[1, 3].map((s) => [`${s}x time`, () => state.speed === s, () => { state.speed = s; }]),
]);
addEventListener('keydown', (e) => { if (e.key === 's' || e.key === 'S') { state.show = state.show === 'a' ? 'b' : 'a'; refresh(); } });
function refresh() {
  for (const r of ui.querySelectorAll('.row')) r.hidden = !r._vis();
  for (const b of ui.querySelectorAll('button')) { b.textContent = typeof b._text === 'function' ? b._text() : b._text; b.classList.toggle('on', b._on()); }
  const u = new URL(location.href);
  u.searchParams.set('compare', state.compare); u.searchParams.set('show', state.show);
  u.searchParams.set('slugging', state.slugging ? 1 : 0); u.searchParams.set('speed', state.speed);
  history.replaceState(null, '', u);
}
refresh();

// ---------------------------------------------------------------- loop

addEventListener('resize', frame); frame();
document.getElementById('status').hidden = true;
const clock = new THREE.Clock();
function stepAll(dt) {
  if (state.step != null && cmp.b.t - state.step > 20) { state.step = null; both((s) => s.auto('water')); refresh(); }
  cmp.step(dt);
}
const pctOf = (s) => cmp.b.pct(s.hO, cmp.b.range.oil);
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (let i = 0; i < state.speed; i++) stepAll(dt);
  const s = cmp[state.show];
  s.apply(sep);
  sep.update(dt * state.speed, s.stir);
  controls.update();
  renderer.render(scene, camera);
  cmp.trends.forEach((tr, i) => drawTrend(trendCanvases[i], cmp, tr));
  const { a, b } = cmp, N = cmp.names;
  const zone = (x) => (x.ctl?.oil?.gap ? `${x.ctl.oil.zone} the gap` : '');
  tag.innerHTML = `PROTOTYPE · 3D: ${N[state.show]} <span>(S swaps)</span><br><span>${state.slugging ? 'Slugging well' : 'Steady well'}${state.compare === 'tuning' ? ` · old: ${zone(a)} · new: ${zone(b)}` : ` · oil LC ${state.oil}`}${state.step != null ? ' · step test running' : ''}</span>`;
  const m3h = (q) => (q * 3600).toFixed(0);
  read.innerHTML = `<b>Trends</b> solid = ${N.b.toLowerCase()} · dashed = ${N.a.toLowerCase()} · band = gap${state.compare === 'tuning' ? ' (dotted = old gap)' : ' · green = valve actual'}` +
    `<br><b>${N.b}</b> oil out ${m3h(b.qOout)} m³/h · level ${pctOf(b).toFixed(0)} % · P ${b.P.toFixed(2)} barg${b.oiw != null ? ` · OiW ${b.oiw.toFixed(0)} ppm` : ''}` +
    `<br><b>${N.a}</b> oil out ${m3h(a.qOout)} m³/h · level ${pctOf(a).toFixed(0)} % · P ${a.P.toFixed(2)} barg${a.oiw != null ? ` · OiW ${a.oiw.toFixed(0)} ppm` : ''}`;
  requestAnimationFrame(tick);
}
window.proto = { get cmp() { return cmp; }, sep, state, run: (sec) => { for (let t = 0; t < sec; t += 1 / 60) stepAll(1 / 60); } };
requestAnimationFrame(tick);
