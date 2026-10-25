// PROTOTYPE (throwaway): how should the flags move, and what does it cost?
// Three options from flags.js on the Føniks-style banner masts and on a
// pole flag in a sleeve and on a traditional halyard flag, driven by the weather's wind:
//   a  sway    one sine wave, weighted from the held edges
//   b  ripple  layered waves, gusts, flutter, lean, light through the cloth
//   c  cloth   a cloth simulation baked at load into a texture, played back
// URL: flag-prototype.html?variant=b&kind=banner&wind=cloudy&from=left&view=terrace&sun=front
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WEATHER, windSpeed } from './outdoor.js';
import { FlagField, KINDS, BAKE, bakeCloth, loadCloth } from './flags.js';
import bannerCloth from './flag-cloth/banner.bin?url';
import poleCloth from './flag-cloth/pole.bin?url';
import flagCloth from './flag-cloth/flag.bin?url';
import { perfPanel, perfWatch } from './perf.js';

perfPanel();

const q = new URLSearchParams(location.search);

const VARIANTS = {
  a: { name: 'A · sway', text: 'One travelling sine wave, zero where the cloth is held, full at the free corner. Normals from the same sine. The cheapest: a few sines per vertex, nothing else.' },
  b: { name: 'B · ripple', text: 'Three waves at different lengths and angles, gusts, a fast flutter along the free edges, the banner pressed out by the wind, sun shining through the cloth. Still pure shader maths, ~3× A per vertex.' },
  c: { name: 'C · cloth bake', text: 'A real cloth simulation, baked ahead of time (three wind speeds, a 2 s seamless loop each) and shipped as a small file the shader plays back, blending between wind speeds. Real folds; costs a download and texture memory, no simulation on the device.' },
};
const WINDS = {
  calm: { name: 'Calm', speed: 1.5 },
  clear: { name: 'Clear', speed: windSpeed(WEATHER.clear.wind) },
  cloudy: { name: 'Cloudy', speed: windSpeed(WEATHER.cloudy.wind) },
  storm: { name: 'Storm', speed: windSpeed(WEATHER.storm.wind) },
};
// downwind directions; the banners face the camera (+z)
const FROM = {
  left: { name: 'Left', dir: [1, 0] }, front: { name: 'Front', dir: [0.25, -1] },
  behind: { name: 'Behind', dir: [0.25, 1] }, right: { name: 'Right', dir: [-1, 0] }, turning: { name: 'Turning', dir: null },
};
const VIEWS = {
  close: { name: 'Close', pos: [3.6, 7.2, 4.6], at: [1.4, 7.4, 0] },
  terrace: { name: 'Terrace', pos: [2.5, 4.5, 12], at: [0, 6.6, 0] },
  crowd: { name: '120 flags', pos: [0, 30, 90], at: [0, 4, 0] },
};
const pick = (o, k, d) => (o[q.get(k)] ? q.get(k) : d);
const state = {
  variant: pick(VARIANTS, 'variant', 'b'), kind: pick(KINDS, 'kind', 'flag'), wind: pick(WINDS, 'wind', 'cloudy'),
  from: pick(FROM, 'from', 'left'), view: pick(VIEWS, 'view', 'terrace'), sun: q.get('sun') === 'behind' ? 'behind' : 'front',
  lod: q.has('lod'),
};

// ---------------------------------------------------------------- setup

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
perfWatch(renderer);
const coarse = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// a pale sky, a stone terrace, a cream facade behind the masts
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 vP; void main() { float h = normalize(vP).y; gl_FragColor = vec4(mix(vec3(0.82, 0.86, 0.9), vec3(0.36, 0.55, 0.78), smoothstep(0.0, 0.6, h)), 1.0); }',
}));
scene.add(sky);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0xb9b2a3, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const facade = new THREE.Mesh(new THREE.BoxGeometry(34, 17, 1), new THREE.MeshStandardMaterial({ color: 0xe2d6bd, roughness: 0.9 }));
facade.position.set(0, 8.5, -7);
scene.add(facade);
const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x8a8478, 1.4);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
scene.add(hemi, sun);

// masts: four in a row on the terrace (as at Føniks), or a crowd of 120
const mastMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
const MAST_H = 9;
function mastPoses(view) {
  const gap = state.kind === 'flag' ? 3.4 : 2.6;   // the big flags need room to fly
  if (view !== 'crowd') return [-1.5, -0.5, 0.5, 1.5].map((x) => new THREE.Vector3(x * gap, 0, 0));
  const out = [];
  for (let j = 0; j < 10; j++) for (let i = 0; i < 12; i++) out.push(new THREE.Vector3((i - 5.5) * 7, 0, -j * 9 + 20));
  return out;
}
let masts = null, field = null;
const cloth = {}, bakeMs = {};
const CLOTH_URLS = { banner: bannerCloth, pole: poleCloth, flag: flagCloth };
const liveBake = q.get('bake') === 'live';   // simulate at load instead, to compare
async function prepareCloth(kind) {
  const s = performance.now();
  cloth[kind] = liveBake ? bakeCloth(kind) : await loadCloth(kind, CLOTH_URLS[kind]);
  bakeMs[kind] = performance.now() - s;
}
const getCloth = (kind) => cloth[kind];

function build() {
  if (masts) { scene.remove(masts); masts.geometry.dispose(); }
  if (field) { scene.remove(field); field.dispose(); field.cloth = null; }
  const bases = mastPoses(state.view);
  const banner = state.kind === 'banner';
  // mast, truck and (banners) the arm, merged into one instanced mesh
  const parts = [new THREE.CylinderGeometry(0.06, 0.07, MAST_H, 6).translate(0, MAST_H / 2, 0),
    new THREE.SphereGeometry(0.1, 6, 4).translate(0, MAST_H + 0.05, 0)];
  if (banner) parts.push(new THREE.BoxGeometry(KINDS.banner.w + 0.12, 0.04, 0.04).translate(0.08 + KINDS.banner.w / 2, MAST_H - 0.4, 0));
  if (state.kind === 'flag') {   // the halyard: up the pole beside it, round the truck, down to a cleat
    parts.push(new THREE.BoxGeometry(0.012, MAST_H - 1.2, 0.012).translate(0.075, (MAST_H + 1.2) / 2, 0.02));
    parts.push(new THREE.BoxGeometry(0.06, 0.15, 0.05).translate(0.07, 1.2, 0));
  }
  const g = mergeGeometries(parts);
  masts = new THREE.InstancedMesh(g, mastMat, bases.length);
  bases.forEach((b, i) => masts.setMatrixAt(i, new THREE.Matrix4().setPosition(b)));
  scene.add(masts);
  const top = banner ? MAST_H - 0.4 : MAST_H - 0.12;
  const poses = bases.map((b) => ({ position: b.clone().add(new THREE.Vector3(banner ? 0.08 : state.kind === 'flag' ? 0.09 : 0.07, top, 0)), yaw: 0 }));
  const c = state.variant === 'c' ? getCloth(state.kind) : null;
  field = new FlagField(state.kind, state.variant, poses, { cloth: c, tintLod: state.lod, lodDistance: 30 });
  scene.add(field);
}

// a tiny merge (non-indexed) so the prototype needs no extra addon
function mergeGeometries(list) {
  const pos = [], nrm = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function setView(id) {
  const rebuild = (id === 'crowd') !== (state.view === 'crowd') || !field;
  state.view = id;
  const v = VIEWS[id];
  const lift = id === 'close' ? { banner: 0, pole: 1.0, flag: 0.9 }[state.kind] : 0;   // a pole flag sits higher on its mast
  const back = state.kind === 'flag' && id !== 'crowd' ? (id === 'close' ? 1.6 : 1.35) : 1;   // and the traditional flags are bigger
  camera.position.set(v.at[0] + (v.pos[0] - v.at[0]) * back, v.pos[1] + lift, v.at[2] + (v.pos[2] - v.at[2]) * back);
  controls.target.set(v.at[0], v.at[1] + lift, v.at[2]);
  controls.update();
  if (rebuild) build();
}
function setSun() {
  // low afternoon sun from the front-left, or behind the flags so it shines through
  sun.position.set(-10, 6, state.sun === 'behind' ? -6 : 5);
  facade.visible = state.sun !== 'behind';
}

// ---------------------------------------------------------------- UI

const ui = document.querySelector('#ui'), note = document.querySelector('#note'), tag = document.querySelector('#tag');
function row(label, options, key, onPick) {
  const el = document.createElement('div');
  el.className = 'row';
  el.innerHTML = `<span class="lab">${label}</span>`;
  for (const [id, text] of options) {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset.id = id;
    b.onclick = () => { onPick(id); refresh(); };
    el.append(b);
  }
  el.dataset.key = key;
  ui.append(el);
}
const names = (o) => Object.entries(o).map(([k, v]) => [k, v.name]);
row('Option', names(VARIANTS), 'variant', (id) => { state.variant = id; build(); });
row('Flag', [['banner', 'Banner (Føniks)'], ['pole', 'Pole flag'], ['flag', 'Traditional flag']], 'kind', (id) => { state.kind = id; build(); if (state.view === 'close') setView('close'); });
row('Wind', Object.entries(WINDS).map(([k, v]) => [k, `${v.name} ${v.speed.toFixed(0)} m/s`]), 'wind', (id) => { state.wind = id; });
row('From', names(FROM), 'from', (id) => { state.from = id; });
row('View', names(VIEWS), 'view', (id) => setView(id));
row('Sun', [['front', 'In front'], ['behind', 'Behind']], 'sun', (id) => { state.sun = id; setSun(); });
function refresh() {
  for (const el of ui.children) for (const b of el.querySelectorAll('button')) b.classList.toggle('on', String(state[el.dataset.key]) === b.dataset.id);
  const v = VARIANTS[state.variant], k = KINDS[state.kind];
  const near = (k.nu - 1) * (k.nv - 1) * 2, far = ((k.nu - 1) / k.stride) * ((k.nv - 1) / k.stride) * 2;
  const cl = cloth[state.kind];
  const bake = state.variant === 'c' ? (liveBake ? ` · simulated live in ${bakeMs[state.kind].toFixed(0)} ms` : ` · ${(cl.fileBytes / 1024).toFixed(0)} KB file, loaded in ${bakeMs[state.kind].toFixed(0)} ms`)
    + `, ${(cl.bytes / 1024).toFixed(0)} KB on the GPU` : '';
  note.innerHTML = `<b>${v.name}.</b> ${v.text}<br>${near} triangles a flag (${far} beyond 30 m) · ${field.meshes.filter((m) => m.count).length} draw${field.meshes.filter((m) => m.count).length > 1 ? 's' : ''} for all ${field.poses.length} flags${bake}`
    + ` · <span id="cpu"></span>`;
}

// ---------------------------------------------------------------- frame

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 50;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const wind = new THREE.Vector3(), sunDir = new THREE.Vector3();
let last = performance.now(), clock = Number(q.get('t') ?? 0), cpuMs = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  const f = FROM[state.from].dir;
  if (f) wind.set(f[0], 0, f[1]).normalize();
  else wind.set(Math.cos(clock * 0.15), 0, Math.sin(clock * 0.15));
  const speed = WINDS[state.wind].speed;
  sunDir.copy(sun.position).normalize();
  const s = performance.now();
  field.update(clock, camera, { speed, dir: wind, sunDir, sunColor: sun.color });
  cpuMs = 0.9 * cpuMs + 0.1 * (performance.now() - s);
  controls.update();
  const cpu = document.querySelector('#cpu');
  if (cpu) cpu.textContent = `flag update ${cpuMs.toFixed(3)} ms/frame`;
  tag.textContent = `${VARIANTS[state.variant].name} · ${speed.toFixed(1)} m/s from the ${FROM[state.from].name.toLowerCase()}`;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// load the baked cloths while the status shows, so picking C later doesn't stall
document.querySelector('#status').textContent = liveBake ? 'Simulating the cloth…' : 'Loading…';
await new Promise((r) => setTimeout(r, 50));
for (const k of Object.keys(KINDS)) await prepareCloth(k);
setSun();
setView(state.view);
refresh();
document.querySelector('#status').hidden = true;
requestAnimationFrame(frame);

window.lab = { state, field: () => field, bakeMs, BAKE };
