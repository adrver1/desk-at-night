// PROTOTYPE (throwaway): how should the cut-open inlet separator open up,
// and do the liquids read as liquid? Three cut styles for the same model:
//   a  section: a cut plane sweeps in, cut faces hatched like a drawing
//   c  glass: the near half turns to glass, the liquids stay whole
// URL: separator-prototype.html?variant=a&open=1&look=1&slugging=1
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Separator, SeparatorSim, DIM } from './separator.js';
import { Gauge } from './gauge.js';
import { perfPanel, perfWatch } from './perf.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Adriaen (the bearded_operator cast model, deck PPE) for scale; inlined so
// the one-file preview page needs no fetch
import adriaenGlb from '../../characters/bearded_operator/bearded_operator_ppe_deck.glb?inline';

perfPanel();

const q = new URLSearchParams(location.search);
const VARIANTS = {
  a: { style: 'section', name: 'A · Section', text: 'A cut plane sweeps in from the front. Cut steel is hatched like an engineering drawing; the liquids show their section on the same plane.' },
  c: { style: 'glass', name: 'C · Glass', text: 'The near half turns to glass. Nothing is cut: the liquids stay whole and you look through the shell at them.' },
};

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
perfWatch(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.25 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.autoUpdate = false; // the scene is static apart from the cut: redraw shadows only when it moves

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2329);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-6, 12, 9); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -6, near: 1, far: 40 });
scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.6));
const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x3a4246, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = DIM.ground; floor.receiveShadow = true;
const grid = new THREE.GridHelper(60, 60, 0x55626a, 0x465157); grid.position.y = DIM.ground + 0.005;
scene.add(floor, grid);

const sep = new Separator({ inlet: q.get('inlet') ?? 'vane' });
scene.add(sep.group);
const sim = new SeparatorSim();

const gauges = {
  inlet: new Gauge({ tag: 'TI 2001', unit: '°C', min: 0, max: 120, red: [95, 120], major: 20 }),
  gas: new Gauge({ tag: 'PI 2002', unit: 'barg', min: 0, max: 16, red: [13, 16], major: 2 }),
  water: new Gauge({ tag: 'FI 2003', unit: 'm³/h', min: 0, max: 2500, major: 500 }),
  oil: new Gauge({ tag: 'FI 2004', unit: 'm³/h', min: 0, max: 2500, major: 500 }),
};
for (const [k, g] of Object.entries(gauges)) {
  const key = 'gauge' + k[0].toUpperCase() + k.slice(1), at = sep.anchors[key];
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 10), sep.mats.pipe);
  stem.rotation.x = Math.PI / 2; stem.position.copy(at).add(new THREE.Vector3(0, 0, 0.12));
  g.group.position.copy(at).add(new THREE.Vector3(0, 0, 0.42));
  scene.add(stem, g.group);
}

// Adriaen beside the inlet head, for scale (1.75 m against the 3 m vessel)
let mixer = null;
{
  const bin = Uint8Array.from(atob(adriaenGlb.split(',')[1]), (ch) => ch.charCodeAt(0));
  new GLTFLoader().parse(bin.buffer, '', (gltf) => {
    const p = gltf.scene;
    p.position.set(-5.5, DIM.ground, 0.9); p.rotation.y = 0.6;
    p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(p);
    mixer = new THREE.AnimationMixer(p); renderer.shadowMap.needsUpdate = true;
    const idle = gltf.animations.find((a) => a.name === 'idle');
    if (idle) mixer.clipAction(idle).play();
    const blink = gltf.animations.find((a) => a.name === 'blink');
    if (blink) mixer.clipAction(blink).play();
  });
}

// labels
const LABELS = [
  ['Gas', () => new THREE.Vector3(0.2, 0.5, sep.c)],
  ['Oil', () => new THREE.Vector3(-0.8, (sep.levels.surface + sep.levels.interface) / 2 + 0.05, sep.c)],
  ['Emulsion', () => new THREE.Vector3(0.2, sep.levels.interface, sep.c)],
  ['Water', () => new THREE.Vector3(-0.8, (sep.levels.interface - 1.5) / 2, sep.c)],
  ['Weir', () => new THREE.Vector3(DIM.weirX, DIM.crest + 0.32, sep.c)],
  ['Oil compartment', () => new THREE.Vector3(DIM.weirX + 1.2, sep.levels.bucket - 0.3, sep.c)],
  ['Inlet device', () => new THREE.Vector3(-2.9, 1.25, sep.c)],
  ['Mist extractor', () => new THREE.Vector3((DIM.mistX[0] + DIM.mistX[1]) / 2, 0.55, sep.c)],
].map(([text, at]) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.append(el); return { el, at }; });

const state = {
  variant: VARIANTS[q.get('variant')] ? q.get('variant') : 'a',
  open: q.get('open') === '1', amount: q.get('open') === '1' ? 1 : 0,
  look: q.get('look') !== '0', labels: q.get('labels') !== '0', slugging: q.get('slugging') === '1', nextSlug: 3,
};

// ---------------------------------------------------------------- camera

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(-0.5, -0.1, 0);
controls.maxPolarAngle = Math.PI * 0.55;
function frame() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  // fit the vessel's length (plus pipes) across the width
  const halfW = 6.4, halfH = 3.6, t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(halfH / t, halfW / (t * camera.aspect)) + 2;
  camera.position.set(1.2, 2.4, dist).add(controls.target);
  camera.updateProjectionMatrix();
}
addEventListener('resize', frame); frame();

// ---------------------------------------------------------------- UI

const ui = document.getElementById('ui'), note = document.getElementById('note'), tag = document.getElementById('tag');
function row(label, items) {
  const r = document.createElement('div'); r.className = 'row';
  r.innerHTML = `<span class="lab">${label}</span>`;
  for (const [text, on, fn] of items) {
    const b = document.createElement('button'); b.textContent = text; b.classList.toggle('on', on());
    b.onclick = () => { fn(); refresh(); }; b.dataset.on = ''; b._on = on; r.append(b);
  }
  ui.append(r);
}
row('Cut', Object.entries(VARIANTS).map(([k, v]) => [v.name, () => state.variant === k, () => { state.variant = k; }]));
row('Show', [
  ['Open', () => state.open, () => { state.open = !state.open; }],
  ['Slug', () => false, () => { sim.slug(1); }],
  ['Slugging well', () => state.slugging, () => { state.slugging = !state.slugging; state.nextSlug = sim.t + 1; }],
  ['Inlet: vane', () => sep.inlet === 'vane', () => { sep.setInlet('vane'); }],
  ['Inlet: plate', () => sep.inlet === 'diverter', () => { sep.setInlet('diverter'); }],
  ['Liquid look', () => state.look, () => { state.look = !state.look; }],
  ['Labels', () => state.labels, () => { state.labels = !state.labels; }],
]);
function refresh() {
  for (const b of ui.querySelectorAll('button')) b.classList.toggle('on', b._on());
  sep.U.uLook.value = state.look ? 1 : 0;
  tag.textContent = `PROTOTYPE · ${VARIANTS[state.variant].name}`;
  const u = new URL(location.href);
  u.searchParams.set('variant', state.variant); u.searchParams.set('open', state.open ? 1 : 0);
  u.searchParams.set('look', state.look ? 1 : 0); u.searchParams.set('inlet', sep.inlet); u.searchParams.set('slugging', state.slugging ? 1 : 0);
  history.replaceState(null, '', u);
}
refresh();
document.getElementById('status').hidden = true;

// ---------------------------------------------------------------- loop

const clock = new THREE.Clock(), v = new THREE.Vector3();
const m3h = (q) => q * 3600;
let lastStyle = null;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.slugging && sim.t > state.nextSlug) { sim.slug(0.7 + 0.6 * Math.random()); state.nextSlug = sim.t + 14 + 8 * Math.random(); }
  sim.step(dt); sim.apply(sep);
  state.amount = THREE.MathUtils.clamp(state.amount + (state.open ? dt : -dt) / 2.2, 0, 1);
  const style = VARIANTS[state.variant].style;
  if (style !== lastStyle) { lastStyle = style; }
  if (sep.cut.style !== style || sep.cut.amount !== state.amount) renderer.shadowMap.needsUpdate = true;
  sep.setCut({ style, amount: state.amount });
  sep.update(dt, state.look ? sim.stir : 0);
  gauges.inlet.set(sim.Tin); gauges.gas.set(sim.P); gauges.water.set(m3h(sim.qWout)); gauges.oil.set(m3h(sim.qOout));
  for (const g of Object.values(gauges)) g.update(dt);
  mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
  const show = state.labels && state.amount > 0.85;
  for (const l of LABELS) {
    const p = l.at(); if (p.z > 10) p.z = state.variant === 'c' ? 1.2 : 0;
    v.copy(p).project(camera);
    l.el.style.opacity = show ? 1 : 0;
    l.el.style.left = `${((v.x + 1) / 2) * innerWidth}px`; l.el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  }
  const lvl = (h) => (h + 1.5).toFixed(2); // above the bottom
  note.innerHTML = `${VARIANTS[state.variant].text}<br><b>Interface</b> ${lvl(sim.hW)} m · <b>Oil</b> ${lvl(sim.hL)} m · <b>Oil comp.</b> ${lvl(sim.hO)} m · ` +
    `<b>Over weir</b> ${m3h(sim.qOver).toFixed(0)} m³/h · <b>Water out</b> ${m3h(sim.qWout).toFixed(0)} · <b>Oil out</b> ${m3h(sim.qOout).toFixed(0)} · <b>P</b> ${sim.P.toFixed(1)} barg`;
  requestAnimationFrame(tick);
}
window.proto = { sim, sep, state, refresh };
tick();
