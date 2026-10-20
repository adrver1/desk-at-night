// Lighting viewer for the control room bake: orbit around and mix the
// ceiling and screen light maps (see controlScene.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadControlRoom, SKY } from './controlScene.js';

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $('stage'), canvas: $('view'), status: $('status'),
  ceiling: $('ceiling'), ceilingOut: $('ceilingOut'),
  screens: $('screens'), screensOut: $('screensOut'),
  exposure: $('exposure'), expOut: $('expOut'),
  modes: [...document.querySelectorAll('[data-mode]')],
  home: $('homeBtn'), eq: $('eq'), facts: $('facts'),
};
const state = { ceiling: 0.25, screens: 1, mode: 0 };

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = SKY.clone();
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 500);
const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
controls.rotateSpeed = 0.5;
controls.minDistance = 0.3;
controls.maxDistance = 9;
const home = { position: new THREE.Vector3(), target: new THREE.Vector3() };

let room;

async function load() {
  room = await loadControlRoom(renderer);
  scene.add(room.root);
  const pick = Number(new URLSearchParams(location.search).get('cam')) || 0; // ?cam=2 for the operator's view
  const cam = room.cameras[Math.min(pick, room.cameras.length - 1)];
  cam.getWorldPosition(home.position);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
  home.target.copy(home.position).addScaledVector(forward, 5);
  camera.fov = cam.fov;
  goHome();

  const glbKb = Math.round(room.sizes.glb / 1e3);
  const mapsKb = Math.round(room.sizes.maps / 1e3);
  const meta = room.meta;
  ui.facts.textContent = `Atlas ${meta.resolution} × ${meta.resolution} at ${meta.samples} samples · geometry ${glbKb} kB · light maps ${mapsKb} kB. The screens and ceiling panels themselves are drawn flat; everything they light is baked.`;
}

function goHome() {
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  camera.updateProjectionMatrix();
  controls.update();
}

function setSlider(key, out, v) {
  state[key] = v;
  out.textContent = `×${v.toFixed(2)}`;
}
function setExposure(ev) {
  renderer.toneMappingExposure = 2 ** ev;
  ui.expOut.textContent = `${ev >= 0 ? '+' : '−'}${Math.abs(ev).toFixed(1)} EV`;
}
function setMode(mode) {
  state.mode = mode;
  ui.modes.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.mode) === mode)));
}

ui.ceiling.addEventListener('input', () => setSlider('ceiling', ui.ceilingOut, Number(ui.ceiling.value)));
ui.screens.addEventListener('input', () => setSlider('screens', ui.screensOut, Number(ui.screens.value)));
ui.exposure.addEventListener('input', () => setExposure(Number(ui.exposure.value)));
ui.modes.forEach((b) => b.addEventListener('click', () => setMode(Number(b.dataset.mode))));
ui.home.addEventListener('click', goHome);

new ResizeObserver(() => {
  const w = ui.stage.clientWidth, h = ui.stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(ui.stage);

renderer.setAnimationLoop(() => {
  if (!room) return;
  room.setLights(state.ceiling, state.screens, state.mode);
  controls.update();
  renderer.render(scene, camera);
  ui.eq.innerHTML = `pixel = albedo × ( <b class="l">${state.ceiling.toFixed(2)}</b> · E<sub>ceiling</sub> + <b class="m">${state.screens.toFixed(2)}</b> · E<sub>screens</sub> )`;
});

load()
  .then(() => { ui.status.hidden = true; })
  .catch((err) => { ui.status.textContent = err.message; ui.status.classList.add('error'); console.error(err); });

setExposure(0);
setMode(0);
