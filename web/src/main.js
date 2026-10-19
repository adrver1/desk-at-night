import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { roomVertex, roomFragment, ballVertex, ballFragment, skyVertex, skyFragment } from './shaders.js';
import { Cradle } from './cradle.js';

const SCENE = 'scene/';
// Blender is Z-up, glTF is Y-up: (x, y, z)_blender -> (x, z, -y)_gltf
const LAMP = new THREE.Vector3(0.25, 1.1, -1.62);
const TARGET = new THREE.Vector3(-0.05, 0.92, -1.65);
const ROOM_MIN = new THREE.Vector3(-1.9, 0.15, -1.9);
const ROOM_MAX = new THREE.Vector3(1.9, 2.45, 1.9);
// The filament is a first-order lag: it heats faster than it cools.
const TAU_ON = 0.09;
const TAU_OFF = 0.25;
// Moonlight direction in glTF axes, from build_lights() in blender/build.py
const MOON_DIR = new THREE.Vector3(0.25, -0.75, 1.0).normalize();
const SHADOW_SIZE = 512;
const BALLS = 1; // render layer holding only the toy's balls (shadow casters)

const $ = (id) => document.getElementById(id);
const ui = {
  stage: $('stage'), canvas: $('view'), status: $('status'), hint: $('hint'),
  lampBtn: $('lampBtn'), lampState: $('lampState'),
  moon: $('moon'), moonOut: $('moonOut'),
  exposure: $('exposure'), expOut: $('expOut'),
  modes: [...document.querySelectorAll('[data-mode]')],
  compareBtn: $('compareBtn'), swingBtn: $('swingBtn'), ref: $('ref'), refImg: $('refImg'), handle: $('handle'),
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
let ballMaterial, threadMaterial, cradle;
const toy = { balls: [], rest: [], pivots: [], xAxis: new THREE.Vector3(), railAxis: new THREE.Vector3() };

// The balls are not in the bake, so they cast their shadows live: each light
// renders a depth map of the balls alone, and the room shader looks it up.
function shadowTarget() {
  const rt = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE);
  rt.depthTexture = new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE);
  rt.depthTexture.type = THREE.UnsignedIntType;
  return rt;
}
const shadow = {
  lamp: { rt: shadowTarget(), cam: new THREE.PerspectiveCamera(50, 1, 0.05, 2) },
  moon: { rt: shadowTarget(), cam: new THREE.OrthographicCamera(-0.25, 0.25, 0.25, -0.25, 0.05, 2) },
  depthMaterial: new THREE.MeshBasicMaterial(),
};
for (const s of [shadow.lamp, shadow.moon]) s.cam.layers.set(BALLS);
camera.layers.enable(BALLS);

// --------------------------------------------------------------- loading

// Hosts that refuse binary .glb files can serve the model as base64 in JSON
// instead: build with VITE_MODEL=scene.glb.b64.json (see qa/assemble_preview.py).
const MODEL = import.meta.env.VITE_MODEL || 'scene.glb';

async function fetchBytes(name) {
  const res = await fetch(SCENE + name);
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}). Run the Blender build first.`);
  if (name.endsWith('.b64.json')) {
    const { base64 } = await res.json();
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
  }
  return res.arrayBuffer();
}

async function envTextureFrom(buffer) {
  // A panorama: wrap around horizontally, and no mipmaps, which would show
  // a seam where u jumps from 1 back to 0.
  const tex = await textureFrom(buffer, false);
  tex.wrapS = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
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
  const [meta, glbBuf, albedoBuf, moonBuf, lampBuf, envMoonBuf, envLampBuf] = await Promise.all([
    fetch(SCENE + 'meta.json').then((r) => { if (!r.ok) throw new Error('Could not load meta.json. Run the Blender build first.'); return r.json(); }),
    fetchBytes(MODEL), fetchBytes('albedo.png'), fetchBytes('light_ambient.png'), fetchBytes('light_lamp.png'),
    fetchBytes('env_ambient.png'), fetchBytes('env_lamp.png'),
  ]);
  const [albedo, lightMoon, lightLamp, envMoon, envLamp] = await Promise.all([
    textureFrom(albedoBuf, true), textureFrom(moonBuf, false), textureFrom(lampBuf, false),
    envTextureFrom(envMoonBuf), envTextureFrom(envLampBuf),
  ]);
  const gltf = await new GLTFLoader().parseAsync(glbBuf, '');

  roomMaterial = new THREE.ShaderMaterial({
    vertexShader: roomVertex,
    fragmentShader: roomFragment,
    uniforms: {
      uAlbedo: { value: albedo }, uLightMoon: { value: lightMoon }, uLightLamp: { value: lightLamp },
      uScaleMoon: { value: meta.scaleAmbient }, uScaleLamp: { value: meta.scaleLamp },
      uMoon: { value: 1 }, uLamp: { value: 1 }, uMode: { value: 0 },
      uShadowLamp: { value: shadow.lamp.rt.depthTexture }, uShadowMoon: { value: shadow.moon.rt.depthTexture },
      uLampMatrix: { value: new THREE.Matrix4() }, uMoonMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 1 / SHADOW_SIZE },
    },
  });
  bulbMaterial = new THREE.MeshBasicMaterial();
  ballMaterial = new THREE.ShaderMaterial({
    vertexShader: ballVertex,
    fragmentShader: ballFragment,
    uniforms: {
      uEnvMoon: { value: envMoon }, uEnvLamp: { value: envLamp },
      uScaleEnvMoon: { value: meta.scaleEnvAmbient }, uScaleEnvLamp: { value: meta.scaleEnvLamp },
      uMoon: { value: 1 }, uLamp: { value: 1 },
      uLampPos: { value: LAMP }, uEnvCenter: { value: new THREE.Vector3(...meta.toy.envCenter) },
    },
  });
  threadMaterial = new THREE.MeshBasicMaterial();

  room = gltf.scene.getObjectByName('Room');
  bulb = gltf.scene.getObjectByName('Bulb');
  room.material = roomMaterial;
  bulb.material = bulbMaterial;
  scene.add(gltf.scene);
  setupToy(gltf.scene, meta.toy);

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

function setupToy(root, info) {
  for (let i = 0; ; i++) {
    const ball = root.getObjectByName(`Ball${i}`);
    if (!ball) break;
    ball.material = ballMaterial;
    ball.layers.enable(BALLS);
    ball.children.forEach((t) => { t.material = threadMaterial; }); // too thin to cast a visible shadow
    toy.balls.push(ball);
    toy.rest.push(ball.quaternion.clone());
    toy.pivots.push(ball.getWorldPosition(new THREE.Vector3()));
  }
  // Blender's local X (along the row) and Y (along the rails) in glTF axes
  toy.xAxis.set(1, 0, 0).applyQuaternion(toy.rest[0]);
  toy.railAxis.set(0, 0, -1).applyQuaternion(toy.rest[0]);
  cradle = new Cradle(toy.balls.length, info.drop, info.radius, info.pitch);

  // Aim both shadow cameras at the toy
  const centre = new THREE.Vector3(...info.envCenter);
  shadow.lamp.cam.position.copy(LAMP);
  shadow.lamp.cam.lookAt(centre);
  shadow.moon.cam.position.copy(centre).addScaledVector(MOON_DIR, -1);
  shadow.moon.cam.lookAt(centre);
  for (const s of [shadow.lamp, shadow.moon]) s.cam.updateMatrixWorld();
  roomMaterial.uniforms.uLampMatrix.value.multiplyMatrices(shadow.lamp.cam.projectionMatrix, shadow.lamp.cam.matrixWorldInverse);
  roomMaterial.uniforms.uMoonMatrix.value.multiplyMatrices(shadow.moon.cam.projectionMatrix, shadow.moon.cam.matrixWorldInverse);
}

// Swing about Blender's local Y, which is glTF local -Z
const swingAxis = new THREE.Vector3(0, 0, 1);
const swingQ = new THREE.Quaternion();
function poseToy() {
  toy.balls.forEach((ball, i) => {
    ball.quaternion.copy(toy.rest[i]).multiply(swingQ.setFromAxisAngle(swingAxis, cradle.theta[i]));
  });
}

function renderShadows() {
  scene.overrideMaterial = shadow.depthMaterial;
  for (const s of [shadow.lamp, shadow.moon]) {
    renderer.setRenderTarget(s.rt);
    renderer.render(scene, s.cam);
  }
  scene.overrideMaterial = null;
  renderer.setRenderTarget(null);
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
  [ui.lampBtn, ui.moon, ui.exposure, ui.swingBtn, ...ui.modes].forEach((el) => { el.disabled = state.comparing; });
  if (state.comparing) {
    cradle?.reset(); // the reference shows the toy at rest
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

ui.swingBtn.addEventListener('click', () => {
  if (!cradle) return;
  cradle.reset();
  cradle.hold(0, -0.6);
  cradle.release();
});

// Click the lamp itself to switch it; drag a ball of the toy to swing it
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
function lampUnder(e) {
  if (!room) return false;
  aimRay(e);
  const hit = raycaster.intersectObjects([room, bulb], false)[0];
  return !!hit && hit.point.distanceTo(LAMP) < 0.24;
}

function aimRay(e) {
  const r = ui.canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

function ballUnder(e) {
  if (!toy.balls.length || state.comparing) return -1;
  aimRay(e);
  const hit = raycaster.intersectObjects(toy.balls, false)[0];
  return hit ? toy.balls.indexOf(hit.object) : -1;
}

// Dragging moves the ball along its swing circle: intersect the pointer ray
// with the vertical plane the ball swings in, then take the angle from the pivot.
let drag = null;
const swingPlane = new THREE.Plane();
const onPlane = new THREE.Vector3();
function dragAngle(e) {
  aimRay(e);
  swingPlane.setFromNormalAndCoplanarPoint(toy.railAxis, toy.pivots[drag.i]);
  if (!raycaster.ray.intersectPlane(swingPlane, onPlane)) return drag.a;
  onPlane.sub(toy.pivots[drag.i]);
  return Math.atan2(onPlane.dot(toy.xAxis), -onPlane.y);
}

ui.canvas.addEventListener('pointerdown', (e) => {
  downAt = [e.clientX, e.clientY];
  const i = ballUnder(e);
  if (i < 0) return;
  // Capture phase, so OrbitControls sees itself disabled before it reacts
  controls.enabled = false;
  ui.canvas.setPointerCapture(e.pointerId);
  ui.canvas.style.cursor = 'grabbing';
  drag = { i, a: cradle.theta[i], t: performance.now(), omega: 0 };
  downAt = null;
}, { capture: true });

ui.canvas.addEventListener('pointerup', (e) => {
  if (drag) {
    // Let go with the speed the pointer had, so a flick swings harder
    cradle.release(Math.max(-12, Math.min(12, drag.omega)));
    drag = null;
    controls.enabled = !state.comparing;
    ui.canvas.style.cursor = 'grab';
    return;
  }
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5 && lampUnder(e)) setLamp(!state.lampOn);
  downAt = null;
});
ui.canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const a = dragAngle(e), now = performance.now(), dt = Math.max((now - drag.t) / 1000, 1e-3);
    drag.omega = 0.6 * drag.omega + 0.4 * (a - drag.a) / dt;
    drag.a = a;
    drag.t = now;
    cradle.hold(drag.i, a);
    return;
  }
  if (e.buttons === 0) ui.canvas.style.cursor = ballUnder(e) >= 0 ? 'grab' : lampUnder(e) ? 'pointer' : '';
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
  ballMaterial.uniforms.uMoon.value = state.moon;
  ballMaterial.uniforms.uLamp.value = state.lamp;
  // Cotton thread, lit about as brightly as the desk under the lamp
  threadMaterial.color.setScalar(0.05 * state.moon + 1.2 * state.lamp);
  cradle.step(dt);
  poseToy();
  toy.balls.forEach((b) => { b.visible = state.mode === 0; }); // the bake views show the room only
  renderShadows();
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
