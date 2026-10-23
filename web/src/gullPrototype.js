// PROTOTYPE (throwaway): what should the seabirds round the platform look
// like and do? Three options from gulls.js, around the intro's platform and
// supply vessel, under outdoor.js's sky and sea:
//   a  one flock of 24 plain grey silhouettes (16 triangles each) circling
//      together, boids-style
//   b  the four North Sea species (kittiwake, fulmar, herring gull, great
//      black-backed gull, 48 triangles each), each flying its own way
//   c  b, and they also perch on deck edges and booms and rest on the sea
// URL: gull-prototype.html?variant=c&view=window&weather=cloudy&time=11.5
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Outdoor, WEATHER, PLATFORM_HEADING, windSpeed } from './outdoor.js';
import { approachPose, floatOn } from './vessel.js';
import { Seabirds, PlatformMap, SPECIES, birdGeometry, birdMaterial } from './gulls.js';
import { fpsCounter } from './fps.js';

fpsCounter();

const q = new URLSearchParams(location.search);
const B = (x, y, z) => new THREE.Vector3(x, z, -y); // Blender to three.js axes
const TO_THREE = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1), FROM_THREE = TO_THREE.clone().invert();

const VARIANTS = {
  a: { look: 'silhouette', behaviour: 'boids', name: 'A · simple flock',
    text: '24 plain silhouettes, 16 triangles each, one draw. They circle the platform together like a flock of starlings, which real gulls rarely do.' },
  b: { look: 'detailed', behaviour: 'flight', name: 'B · four species',
    text: 'Kittiwakes busy round the decks, fulmars gliding low over the waves on stiff wings, herring and great black-backed gulls soaring over the platform and the vessel. 48 triangles each, one draw per species.' },
  c: { look: 'detailed', behaviour: 'living', name: 'C · species that also land',
    text: 'B, and they come and go: kittiwakes sit in rows on deck edges (they nest on North Sea platforms), big gulls loaf on roofs and booms, fulmars and gulls rest on the sea and drift.' },
};

// ---------------------------------------------------------------- setup

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
const coarse = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80000);
const outdoor = new Outdoor(0, { heading: PLATFORM_HEADING });
const state = {
  variant: VARIANTS[q.get('variant')] ? q.get('variant') : 'c',
  view: q.get('view') ?? 'window', weather: WEATHER[q.get('weather')] ? q.get('weather') : 'cloudy',
  time: Number(q.get('time') ?? 11.5), follow: 0,
};
outdoor.set({ ...WEATHER[state.weather], time: state.time, speed: 0 });
scene.add(outdoor.room);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
scene.add(hemi, sun, sun.target);

const loader = new GLTFLoader();
function load(name) {
  const inline = window.INTRO_MODELS?.[name];
  if (!inline) return loader.loadAsync('intro/' + name);
  const bin = atob(inline), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return loader.parseAsync(buf.buffer, '');
}
const info = window.INTRO_INFO ?? await fetch('intro/intro.json').then((r) => r.json());
const [platform, vessel] = await Promise.all([load('platform.glb'), load('vessel.glb').catch(() => null)]);
scene.add(platform.scene);
platform.scene.traverse((o) => {
  if (!o.isMesh) return;
  if (o.material.name === 'PlatGlass') { o.material.transparent = true; o.material.opacity = 0.5; }
  if (o.material.emissive?.getHex() && o.material.name !== 'PlatFlare') o.material.emissiveIntensity = 0.05;
});
const map = new PlatformMap(platform.scene);

// The supply vessel alongside, floating
const berth = info.berth && { x: info.berth.position[0], y: info.berth.position[1], yaw: info.berth.yaw };
const vesselPose = berth ? approachPose(berth, 1) : null;
if (vessel && berth) scene.add(vessel.scene);
function moveVessel() {
  if (!vessel || !berth) return;
  const f = floatOn(outdoor, TO_THREE, vesselPose.x, vesselPose.y, vesselPose.yaw, 88.5, 19);
  vessel.scene.position.copy(B(vesselPose.x, vesselPose.y, f.heave));
  vessel.scene.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(f.roll, f.pitch, vesselPose.yaw, 'ZYX'))
    .premultiply(TO_THREE).multiply(FROM_THREE));
}
const vesselAt = berth ? B(vesselPose.x, vesselPose.y, 0) : null;
const anchors = () => [{ position: map.centre, weight: 0.6 }, ...(vesselAt ? [{ position: vesselAt, weight: 0.4 }] : [])];

// The models up close: each species flying (top) and sitting (below), in
// front of the platform
const showcase = new THREE.Group();
showcase.position.set(map.centre.x, 45, map.box.max.z + 40);
showcase.visible = false;
scene.add(showcase);
let shown = [];
function buildShowcase(look) {
  for (const s of shown) { showcase.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
  shown = [];
  const list = look === 'silhouette' ? [['herring', SPECIES.herring]] : Object.entries(SPECIES);
  list.forEach(([key, sp], i) => {
    for (const sit of [0, 1]) {
      const g = birdGeometry(sp, look);
      g.setAttribute('aPose', new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
      const mesh = new THREE.InstancedMesh(g, birdMaterial(g), 1);
      mesh.frustumCulled = false;
      const m = new THREE.Matrix4().makeRotationY(sit ? -0.9 : 1.0).setPosition((i - (list.length - 1) / 2) * 1.7, sit ? -1.1 : 0.25, 0);
      mesh.setMatrixAt(0, m);
      showcase.add(mesh);
      shown.push({ mesh, sp, sit, seed: i * 1.7 });
    }
  });
}
function animateShowcase(t) {
  for (const s of shown) {
    const flap = !s.sit && (t + s.seed) % 6 < 3.5 ? 1 : 0, a = s.sp.flapAmp * flap, ph = t * Math.PI * 2 * s.sp.flapHz;
    const shoulder = s.sit ? 0 : a * Math.sin(ph) + (1 - flap) * s.sp.dihedral + flap * 0.15;
    const wrist = s.sit ? 0 : a * 0.7 * Math.sin(ph - 0.9) + (1 - flap) * s.sp.droop;
    s.mesh.geometry.attributes.aPose.setXYZ(0, shoulder, wrist, s.sit);
    s.mesh.geometry.attributes.aPose.needsUpdate = true;
  }
}

// Where big gulls hang in the updraft: just outside the control room's window
const HANG = new THREE.Vector3(30, 56, 33);

let birds = null;
function build() {
  buildShowcase(VARIANTS[state.variant].look);
  if (birds) { scene.remove(birds.group); for (const m of Object.values(birds.meshes)) { m.geometry.dispose(); m.material.dispose(); } }
  for (const p of map.perches) p.taken = false;
  const v = VARIANTS[state.variant];
  birds = new Seabirds({ map, sea: (x, z) => outdoor.heightAt(x, z), anchors, hang: [HANG], look: v.look, behaviour: v.behaviour });
  scene.add(birds.group);
  // a few seconds of flight so they are spread out from the start
  for (let i = 0; i < 60; i++) birds.update(0.1, i * 0.1);
  state.follow = 0;
}
build();

// ---------------------------------------------------------------- views

// The control room's window, roughly: the quarters' crane side, 53 m up,
// looking out over the crane and the vessel
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const VIEWS = {
  window: { name: 'Control room window', pos: new THREE.Vector3(40, 54, 19.5), at: new THREE.Vector3(10, 46, 60), look: true },
  models: { name: 'The models', pos: null, at: null },
  wide: { name: 'From the helicopter', pos: new THREE.Vector3(-150, 80, 170), at: new THREE.Vector3(25, 35, 0) },
  close: { name: 'Close to the decks', pos: null, at: null },
  follow: { name: 'Follow a bird', pos: null, at: null },
};
function setView(name) {
  state.view = name;
  const v = VIEWS[name];
  controls.enabled = name !== 'follow';
  if (name === 'close') {
    // near a perched bird if there is one, else the crane-side deck edge
    const sitter = birds.birds.find((b) => b.mode === 'perch' && b.key === 'kittiwake') ?? birds.birds.find((b) => b.mode === 'perch');
    const at = sitter ? sitter.p.clone() : map.perches[0]?.position.clone() ?? map.centre.clone();
    const out = new THREE.Vector3(at.x - map.centre.x, 0, at.z - map.centre.z).normalize();
    camera.position.copy(at).addScaledVector(out, 3.5).add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(new THREE.Vector3(-out.z, 0, out.x), 1.5);
    controls.target.copy(at);
  } else if (name === 'models') {
    camera.position.copy(showcase.position).add(new THREE.Vector3(0, 1.6, 4.6));
    controls.target.copy(showcase.position).add(new THREE.Vector3(0, -0.3, 0));
  } else if (v.pos) {
    camera.position.copy(v.pos);
    controls.target.copy(v.look ? v.pos.clone().add(v.at.clone().sub(v.pos).normalize()) : v.at);
  }
  showcase.visible = name === 'models';
  controls.enableZoom = !v.look;
  controls.enablePan = !v.look;
  controls.rotateSpeed = v.look ? -0.3 : 1;
  controls.update();
  render();
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
row('Option', Object.entries(VARIANTS).map(([k, v]) => [k, v.name]), 'variant', (id) => { state.variant = id; build(); if (state.view === 'close') setView('close'); });
row('View', Object.entries(VIEWS).map(([k, v]) => [k, v.name]), 'view', (id) => {
  if (id === 'follow' && state.view === 'follow') state.follow++;
  setView(id);
});
row('Weather', [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['overcast', 'Overcast'], ['fog', 'Fog']], 'weather', (id) => { state.weather = id; outdoor.set(WEATHER[id]); });
row('Time', [[8, '08:00'], [11.5, '11:30'], [17, '17:00'], [20.5, '20:30']], 'time', (id) => { state.time = Number(id); outdoor.set({ time: state.time }); });
function refresh() {
  for (const el of ui.children) for (const b of el.querySelectorAll('button')) b.classList.toggle('on', String(state[el.dataset.key]) === b.dataset.id);
  const v = VARIANTS[state.variant];
  const counts = Object.entries(birds.meshes).map(([k, m]) => `${m.count} ${state.variant === 'a' ? 'birds' : SPECIES[k].name.toLowerCase() + (m.count > 1 ? 's' : '')}`).join(', ');
  note.innerHTML = `<b>${v.name}.</b> ${v.text}<br>${counts} · ${birds.triangles.toLocaleString()} triangles, ${Object.keys(birds.meshes).length} draw${Object.keys(birds.meshes).length > 1 ? 's' : ''}`
    + ` · <span id="cpu"></span>${state.view === 'follow' ? ' · tap Follow again for the next bird' : ''}`;
}
refresh();

// ---------------------------------------------------------------- frame

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const followAt = new THREE.Vector3(), followLook = new THREE.Vector3();
function follow(dt) {
  // behind and a little above a flying bird of each species in turn
  const flying = birds.birds.filter((b) => b.mode !== 'perch' && b.mode !== 'sea');
  const list = flying.length ? flying : birds.birds;
  const byKind = Object.keys(birds.meshes).map((k) => list.find((b) => b.key === k)).filter(Boolean);
  const b = state.variant === 'a' ? list[state.follow % list.length] : byKind[state.follow % byKind.length];
  const f = b.v.lengthSq() > 0.01 ? b.v.clone().normalize() : b.heading;
  const want = b.p.clone().addScaledVector(f, -b.sp.span * 1.6).add(new THREE.Vector3(0, b.sp.span * 0.45, 0));
  const k = dt ? 1 - Math.exp(-dt * 4) : 1;
  if (followAt.distanceTo(want) > 30) followAt.copy(want);
  followAt.lerp(want, k);
  followLook.copy(b.p);
  camera.position.copy(followAt);
  camera.lookAt(followLook);
  tag.textContent = `${b.sp.name} · ${b.mode === 'fly' ? (b.amp > 0.5 ? 'flapping' : 'gliding') : b.mode} · ${(b.p.y).toFixed(0)} m up`;
}

function render() {
  outdoor.render(renderer, camera);
  renderer.render(scene, camera);
}

let last = performance.now(), clock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  outdoor.update(dt);
  const L = outdoor.light;
  renderer.toneMappingExposure = L.exposure;
  hemi.color.copy(L.sky).multiplyScalar(Math.PI);
  hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
  sun.color.copy(L.sun);
  sun.position.copy(L.sunDir).multiplyScalar(100);
  scene.fog.color.copy(L.fog);
  scene.fog.density = Math.LN2 / L.fogDistance;
  // the wind blows from windFrom (true bearing), in this frame
  const to = THREE.MathUtils.degToRad(outdoor.state.windFrom + 180), hd = THREE.MathUtils.degToRad(PLATFORM_HEADING);
  const east = Math.sin(to), north = Math.cos(to);
  birds.wind.set(east * Math.cos(hd) - north * Math.sin(hd), 0, -(north * Math.cos(hd) + east * Math.sin(hd)));
  moveVessel();
  birds.update(dt, clock);
  if (showcase.visible) animateShowcase(clock);
  if (state.view === 'follow') follow(dt);
  else { controls.update(); tag.textContent = `${VIEWS[state.view].name} · ${birds.flying} of ${birds.birds.length} flying · wind ${windSpeed(outdoor.state.wind).toFixed(0)} m/s`; }
  const cpu = document.querySelector('#cpu');
  if (cpu) cpu.textContent = `flock ${birds.ms.toFixed(2)} ms/frame`;
  render();
  requestAnimationFrame(frame);
}
setView(state.view);
document.querySelector('#status').hidden = true;
requestAnimationFrame(frame);

// for screenshots: jump the flock forward, pick a bird
window.lab = {
  state, birds: () => birds, setView,
  run(seconds) { for (let t = 0; t < seconds; t += 0.05) { birds.update(0.05, clock += 0.05); } },
};
