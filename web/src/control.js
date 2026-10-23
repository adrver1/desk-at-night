// Lighting viewer for the control room bake: orbit around and mix the
// ceiling and screen light maps (see controlScene.js), with the live sky and
// sea outside (outdoor.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadControlRoom } from './controlScene.js';
import { Outdoor, ROOM_HEADING } from './outdoor.js';
import { Cctv } from './cctv.js';
import { addVessel } from './vessel.js';
import { addSeabirds } from './gulls.js';
import { outdoorControls } from './outdoorControls.js';
import { perfPanel, perfWatch, perfRow, perfStep } from './perf.js';

perfPanel(); // frame rate readout; tap it or press ` for the performance panel (see perf.js)

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
renderer.autoClear = false; // outdoor.render() clears, draws the sky and sea, then the room goes on top
perfWatch(renderer); // ?perf=1 overlay, ?trace=1 markers (see perf.js)

const scene = new THREE.Scene();
scene.name = 'room';
perfRow('sea look', () => outdoor ? `${outdoor.quality.level.toUpperCase()}${outdoor.quality.auto ? ' (auto)' : ''}` : '…');
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 500);
const controls = new OrbitControls(camera, ui.canvas);
controls.enableDamping = true;
controls.rotateSpeed = 0.5;
controls.minDistance = 0.3;
controls.maxDistance = 9;
const home = { position: new THREE.Vector3(), target: new THREE.Vector3() };

let room, outdoor, cctv, vessel, birds, last = 0, userEv = 0;

async function load() {
  room = await loadControlRoom(renderer);
  scene.add(room.root);
  outdoor = new Outdoor(room.seaLevel, { heading: ROOM_HEADING });
  outdoor.setWindow(room.window.lo, room.window.hi);
  // The deck cameras' live pictures; without them the screens draw their own
  const cctvReady = Cctv.load(renderer, outdoor);
  cctvReady.then((c) => { cctv = c; if (c) room.setFeeds(c.feeds, c.gain); }).catch((e) => console.warn('cctv', e));
  scene.add(outdoor.room);
  outdoorControls(document.getElementById('outdoor'), outdoor);
  // The supply vessel: through the window, on the crane camera, and its row on the panel
  addVessel({ renderer, scene, room, outdoor, cctv: cctvReady, panel: document.getElementById('outdoor') })
    .then((v) => { vessel = v; }).catch((e) => console.warn('vessel', e));
  // Seabirds round the platform: through the window and on the cameras (gulls.js)
  addSeabirds({ scene, room, outdoor, cctv: cctvReady, vessel: () => vessel })
    .then((b) => { birds = b; }).catch((e) => console.warn('birds', e));
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
  ui.facts.textContent = `Atlas ${meta.resolution} × ${meta.resolution} at ${meta.samples} samples · geometry ${glbKb} kB · light maps ${mapsKb} kB. The ceiling panels are drawn flat and the screens show live, made-up content; everything they light is baked.`;
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
  userEv = ev;
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

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!room) return;
  perfStep('sky + sea', () => outdoor.update(dt));
  if (vessel) perfStep('vessel', () => vessel.update(dt, outdoor));
  if (birds) perfStep('seabirds', () => birds.tick(dt, outdoor));
  renderer.toneMappingExposure = 2 ** userEv * outdoor.light.exposure;
  room.setLights(state.ceiling, state.screens, state.mode);
  perfStep('daylight + sun shadow', () => room.setDaylight(outdoor.light, now / 1000));
  room.setClock(outdoor.state.time);
  perfStep('screens', () => room.updateScreens(now / 1000, outdoor.cctv));
  if (cctv) perfStep('cctv', () => cctv.update(now / 1000, room.feedsShown(), room.focusedFeed()));
  controls.update();
  outdoor.render(renderer, camera, { reflect: scene });   // the vessel mirrored in the sea
  renderer.render(scene, camera);
  ui.eq.innerHTML = `pixel = albedo × ( <b class="l">${state.ceiling.toFixed(2)}</b> · E<sub>ceiling</sub> + <b class="m">${state.screens.toFixed(2)}</b> · E<sub>screens</sub> + <b>sky</b> · E<sub>sky</sub> )`;
});

load()
  .then(() => { ui.status.hidden = true; })
  .catch((err) => { ui.status.textContent = err.message; ui.status.classList.add('error'); console.error(err); });

setExposure(0);
setMode(0);
