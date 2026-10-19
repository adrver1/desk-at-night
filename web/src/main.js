import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { roomVertex, roomFragment, skyVertex, skyFragment } from './shaders.js';

const SCENE = 'scene/';
// Blender is Z-up, glTF is Y-up: (x, y, z)_blender -> (x, z, -y)_gltf
const LAMP = new THREE.Vector3(0.25, 1.1, -1.62);
const TARGET = new THREE.Vector3(-0.05, 0.92, -1.65);
const ROOM_MIN = new THREE.Vector3(-1.9, 0.15, -1.9);
const ROOM_MAX = new THREE.Vector3(1.9, 2.45, 1.9);
// The filament is a first-order lag: it heats faster than it cools.
const TAU_ON = 0.09;
const TAU_OFF = 0.25;

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $('stage'), canvas: $('view'), status: $('status'), hint: $('hint'),
  lampBtn: $('lampBtn'), lampState: $('lampState'),
  moon: $('moon'), moonOut: $('moonOut'),
  exposure: $('exposure'), expOut: $('expOut'),
  modes: [...document.querySelectorAll('[data-mode]')],
  compareBtn: $('compareBtn'), ref: $('ref'), refImg: $('refImg'), handle: $('handle'),
  eq: $('eq'),
};

const state = { lampOn: true, lamp: 1, moon: 1, mode: 0, comparing: false, wipe: 0.5 };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping; // Blender's default view transform
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(49, 16 / 9, 0.02, 100);
const home = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 0.5;
controls.maxDistance = 3.0; // must exceed the home camera's 2.6 m, or it gets pulled in
controls.rotateSpeed = 0.5;

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(40, 32, 16),
  new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false }),
);
scene.add(sky);

let roomMaterial, bulbMaterial, glow, room, bulb;

// --------------------------------------------------------------- loading

async function fetchBytes(name) {
  const res = await fetch(SCENE + name);
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}). Run the Blender build first.`);
  return res.arrayBuffer();
}

async function textureFrom(buffer, srgb) {
  // glTF UVs assume the image's top-left origin, so no vertical flip.
  const bitmap = await createImageBitmap(new Blob([buffer]), { imageOrientation: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

function glowSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,214,150,1)');
  grad.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.22);
  return s;
}

async function load() {
  const [meta, glbBuf, albedoBuf, moonBuf, lampBuf] = await Promise.all([
    fetch(SCENE + 'meta.json').then((r) => { if (!r.ok) throw new Error('Could not load meta.json. Run the Blender build first.'); return r.json(); }),
    fetchBytes('scene.glb'), fetchBytes('albedo.png'), fetchBytes('light_ambient.png'), fetchBytes('light_lamp.png'),
  ]);
  const [albedo, lightMoon, lightLamp] = await Promise.all([
    textureFrom(albedoBuf, true), textureFrom(moonBuf, false), textureFrom(lampBuf, false),
  ]);
  const gltf = await new GLTFLoader().parseAsync(glbBuf, '');

  roomMaterial = new THREE.ShaderMaterial({
    vertexShader: roomVertex,
    fragmentShader: roomFragment,
    uniforms: {
      uAlbedo: { value: albedo }, uLightMoon: { value: lightMoon }, uLightLamp: { value: lightLamp },
      uScaleMoon: { value: meta.scaleAmbient }, uScaleLamp: { value: meta.scaleLamp },
      uMoon: { value: 1 }, uLamp: { value: 1 }, uMode: { value: 0 },
    },
  });
  bulbMaterial = new THREE.MeshBasicMaterial();

  room = gltf.scene.getObjectByName('Room');
  bulb = gltf.scene.getObjectByName('Bulb');
  room.material = roomMaterial;
  bulb.material = bulbMaterial;
  scene.add(gltf.scene);

  glow = glowSprite();
  glow.position.copy(LAMP);
  scene.add(glow);

  // Start exactly where the Blender camera is, so the Cycles reference lines up.
  gltf.scene.updateMatrixWorld(true);
  const cam = gltf.cameras[0];
  cam.getWorldPosition(home.position);
  cam.getWorldQuaternion(home.quaternion);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  goHome();

  fillPipeline(meta, { glb: glbBuf.byteLength, maps: albedoBuf.byteLength + moonBuf.byteLength + lampBuf.byteLength });
  ui.refImg.src = SCENE + 'reference.png';
  ui.refImg.onerror = () => { ui.compareBtn.disabled = true; ui.compareBtn.title = 'No reference render. Run the build with --reference.'; };
}

function goHome() {
  camera.position.copy(home.position);
  camera.quaternion.copy(home.quaternion);
  // Orbit around the point the camera already looks at, so nothing jumps
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(home.quaternion);
  controls.target.copy(home.position).addScaledVector(forward, home.position.distanceTo(TARGET));
  controls.update();
}

// -------------------------------------------------------------- controls

function setLamp(on) {
  state.lampOn = on;
  ui.lampBtn.setAttribute('aria-pressed', String(on));
  ui.lampState.textContent = on ? 'On' : 'Off';
}

function setMode(mode) {
  state.mode = mode;
  ui.modes.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.mode) === mode)));
}

function setExposure(ev) {
  renderer.toneMappingExposure = 2 ** ev;
  ui.expOut.textContent = `${ev >= 0 ? '+' : '−'}${Math.abs(ev).toFixed(1)} EV`;
}

function setMoon(v) {
  state.moon = v;
  ui.moonOut.textContent = `×${v.toFixed(2)}`;
}

ui.lampBtn.addEventListener('click', () => setLamp(!state.lampOn));
ui.moon.addEventListener('input', () => setMoon(Number(ui.moon.value)));
ui.exposure.addEventListener('input', () => setExposure(Number(ui.exposure.value)));
ui.modes.forEach((b) => b.addEventListener('click', () => setMode(Number(b.dataset.mode))));

ui.compareBtn.addEventListener('click', () => {
  state.comparing = !state.comparing;
  ui.compareBtn.setAttribute('aria-pressed', String(state.comparing));
  ui.ref.hidden = !state.comparing;
  ui.hint.hidden = state.comparing;
  controls.enabled = !state.comparing;
  [ui.lampBtn, ui.moon, ui.exposure, ...ui.modes].forEach((el) => { el.disabled = state.comparing; });
  if (state.comparing) {
    // The reference was rendered with these exact settings
    setLamp(true); state.lamp = 1;
    ui.moon.value = 1; setMoon(1);
    ui.exposure.value = 0; setExposure(0);
    setMode(0);
    goHome();
    setWipe(0.5);
  }
});

function setWipe(f) {
  state.wipe = Math.min(1, Math.max(0, f));
  ui.ref.style.setProperty('--wipe', `${state.wipe * 100}%`);
}
ui.ref.addEventListener('pointerdown', (e) => {
  ui.ref.setPointerCapture(e.pointerId);
  const move = (ev) => setWipe((ev.clientX - ui.ref.getBoundingClientRect().left) / ui.ref.clientWidth);
  move(e);
  ui.ref.onpointermove = move;
  ui.ref.onpointerup = () => { ui.ref.onpointermove = null; };
});

// Click the lamp itself to switch it
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
function lampUnder(e) {
  if (!room) return false;
  const r = ui.canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([room, bulb], false)[0];
  return !!hit && hit.point.distanceTo(LAMP) < 0.24;
}
ui.canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
ui.canvas.addEventListener('pointerup', (e) => {
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5 && lampUnder(e)) setLamp(!state.lampOn);
  downAt = null;
});
ui.canvas.addEventListener('pointermove', (e) => {
  if (e.buttons === 0) ui.canvas.style.cursor = lampUnder(e) ? 'pointer' : '';
});

// ------------------------------------------------------------------ loop

new ResizeObserver(() => {
  const w = ui.stage.clientWidth, h = ui.stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(ui.stage);

const clock = new THREE.Clock();
let eqTimer = 0;
const warm = new THREE.Color(8, 5.2, 2.6);
const cold = new THREE.Color(0.04, 0.035, 0.03);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!roomMaterial) return;

  const target = state.lampOn ? 1 : 0;
  const tau = target > state.lamp ? TAU_ON : TAU_OFF;
  state.lamp = reduceMotion ? target : state.lamp + (target - state.lamp) * (1 - Math.exp(-dt / tau));

  const u = roomMaterial.uniforms;
  u.uLamp.value = state.lamp;
  u.uMoon.value = state.moon;
  u.uMode.value = state.mode;
  bulbMaterial.color.copy(cold).lerp(warm, state.lamp);
  glow.material.opacity = 0.55 * state.lamp;
  glow.visible = state.mode === 0;

  controls.update();
  camera.position.clamp(ROOM_MIN, ROOM_MAX); // stay inside the room
  renderer.render(scene, camera);

  if ((eqTimer -= dt) <= 0) {
    eqTimer = 0.05;
    ui.eq.innerHTML = `pixel = albedo × ( <b class="m">${state.moon.toFixed(2)}</b> · E<sub>moon</sub> + <b class="l">${state.lamp.toFixed(2)}</b> · E<sub>lamp</sub> )`;
  }
});

// ------------------------------------------------------- pipeline facts

function kb(n) { return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`; }

function fillPipeline(meta, sizes) {
  $('factRes').textContent = `${meta.resolution} × ${meta.resolution}`;
  $('factSamples').textContent = `${meta.samples} samples`;
  $('factGlb').textContent = kb(sizes.glb);
  $('factMaps').textContent = kb(sizes.maps);
}

load()
  .then(() => { ui.status.hidden = true; })
  .catch((err) => { ui.status.textContent = err.message; ui.status.classList.add('error'); console.error(err); });

setMoon(1);
setExposure(0);
setMode(0);
