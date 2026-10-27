// PROTOTYPE (throwaway): electric control valves / choke, cut open like the
// separator. Three actuator looks side by side on the same globe valve, and
// the angle-body choke. URL: valve-prototype.html?variant=c&open=1&choke=box
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Valve } from './valve.js';
import { perfPanel, perfWatch } from './perf.js';

perfPanel();
const q = new URLSearchParams(location.search);
const VARIANTS = { c: { style: 'glass', name: 'C · Glass' }, a: { style: 'section', name: 'A · Section' } };
const LOOKS = { box: 'A · compact box', multiturn: 'B · multi-turn', linear: 'C · linear can' };

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
perfWatch(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2329);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-6, 12, 9);
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.6));
const floorY = -0.9;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshLambertMaterial({ color: 0x3a4246 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; scene.add(floor);
const grid = new THREE.GridHelper(40, 40, 0x55626a, 0x465157); grid.position.y = floorY + 0.005; scene.add(grid);

// three globe valves with the three actuator looks, then the angle choke
const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6f7a80, metalness: 0.5, roughness: 0.45 });
const valves = [];
const add = (opts, x, label) => {
  const v = new Valve(opts); v.group.position.set(x, 0, 0); scene.add(v.group); valves.push(v);
  const r = opts.r, len = 0.45;
  if (opts.body === 'angle') {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), pipeMat); a.rotation.z = Math.PI / 2; a.position.set(x - 3.4 * r - len / 2, 0, 0);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(r, r, -floorY - 3.4 * r, 10), pipeMat); b.position.set(x, (floorY - 3.4 * r) / 2, 0);
    scene.add(a, b);
  } else for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), pipeMat); p.rotation.z = Math.PI / 2; p.position.set(x + s * (3.4 * r + len / 2), 0, 0); scene.add(p);
  }
  const el = document.createElement('div'); el.className = 'lbl'; el.textContent = label; document.body.append(el);
  v.label = el;
};
add({ body: 'globe', actuator: 'box', r: 0.13, fluid: 'water', name: 'LV water' }, -2.7, 'A · compact box');
add({ body: 'globe', actuator: 'multiturn', r: 0.13, fluid: 'oil', name: 'LV oil' }, -0.9, 'B · multi-turn');
add({ body: 'globe', actuator: 'linear', r: 0.13, fluid: 'gas', name: 'PV gas' }, 0.9, 'C · linear can');
const choke = valves.length;
add({ body: 'angle', actuator: LOOKS[q.get('choke')] ? q.get('choke') : 'box', r: 0.2, fluid: 'well', name: 'inlet choke' }, 2.9, 'Choke (angle body)');

const state = {
  variant: VARIANTS[q.get('variant')] ? q.get('variant') : 'c',
  open: q.get('open') === '1', amount: q.get('open') === '1' ? 1 : 0,
  opening: 0.5, sweep: q.get('sweep') !== '0',
};

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.target.set(0.1, 0.2, 0); controls.maxPolarAngle = Math.PI * 0.55;
function frame() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  const halfW = 3.7, halfH = 1.1, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(halfH / t, halfW / (t * camera.aspect)) + 0.5;
  camera.position.set(0.4, 0.9, dist).add(controls.target);
  camera.updateProjectionMatrix();
}
addEventListener('resize', frame); frame();

const ui = document.getElementById('ui'), note = document.getElementById('note'), tag = document.getElementById('tag');
function row(label, items) {
  const r = document.createElement('div'); r.className = 'row';
  r.innerHTML = `<span class="lab">${label}</span>`;
  for (const [text, on, fn] of items) {
    const b = document.createElement('button'); b.textContent = text; b.classList.toggle('on', on());
    b.onclick = () => { fn(); refresh(); }; b._on = on; r.append(b);
  }
  ui.append(r);
}
row('Cut', [...Object.entries(VARIANTS).map(([k, v]) => [v.name, () => state.variant === k, () => { state.variant = k; }]),
  ['Open', () => state.open, () => { state.open = !state.open; }]]);
row('Opening', [...[0, 0.25, 0.5, 0.75, 1].map((u) => [`${u * 100}%`, () => !state.sweep && state.opening === u, () => { state.sweep = false; state.opening = u; }]),
  ['Sweep', () => state.sweep, () => { state.sweep = !state.sweep; }]]);
row('Choke', Object.entries(LOOKS).map(([k, n]) => [n, () => valves[choke].actuator === k, () => { valves[choke].setActuator(k); }]));
function refresh() {
  for (const b of ui.querySelectorAll('button')) b.classList.toggle('on', b._on());
  tag.textContent = `PROTOTYPE · valves · ${VARIANTS[state.variant].name}`;
  note.innerHTML = 'Electric actuators on cage-guided valves. The plug lifts inside the cage; the holes it uncovers are the opening. <b>Display</b> = % open.';
  const u = new URL(location.href);
  u.searchParams.set('variant', state.variant); u.searchParams.set('open', state.open ? 1 : 0); u.searchParams.set('choke', valves[choke].actuator);
  history.replaceState(null, '', u);
}
refresh();
document.getElementById('status').hidden = true;

const clock = new THREE.Clock(), v = new THREE.Vector3();
let t = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
  state.amount = THREE.MathUtils.clamp(state.amount + (state.open ? dt : -dt) / 1.6, 0, 1);
  valves.forEach((va, i) => {
    va.set(state.sweep ? 0.5 + 0.45 * Math.sin(t * 0.25 + i * 1.3) : state.opening);
    va.setCut({ style: VARIANTS[state.variant].style, amount: state.amount });
    va.update(dt);
    v.set(0, -0.36, 0).add(va.group.position).project(camera);
    va.label.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; va.label.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  });
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
window.proto = { valves, state, refresh };
requestAnimationFrame(tick);
