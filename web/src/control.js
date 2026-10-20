// Viewer for the control room bake (blender/bake_control_room.py). Same
// lighting model as the desk: albedo × a weighted sum of baked irradiance,
// here with a ceiling map and a screens map. The glowing parts (screens,
// ceiling panels, clock, platform lights) are not baked; they are drawn flat
// in their own colour, scaled by the same weights.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { roomVertex } from './shaders.js';

const SCENE = 'control/';
const SKY = new THREE.Color(0.012, 0.02, 0.045); // Blender world colour (linear)
// The screens carry a pattern in Cycles but are drawn here in their average
// colour; at full strength that reads as a white slab, so draw them dimmer.
const DISPLAY = { screens: 0.45, ceiling: 1 };

const roomFragment = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uLightCeiling;
  uniform sampler2D uLightScreens;
  uniform float uScaleCeiling;
  uniform float uScaleScreens;
  uniform float uCeiling;
  uniform float uScreens;
  uniform int uMode;     // 0 final, 1 albedo, 2 ceiling light, 3 screens light
  varying vec2 vUv;

  vec3 decode(sampler2D map, float scale) {
    vec3 c = texture2D(map, vUv).rgb;
    return c * c * c * scale;
  }

  void main() {
    vec3 albedo = texture2D(uAlbedo, vUv).rgb;
    vec3 eCeiling = uCeiling * decode(uLightCeiling, uScaleCeiling);
    vec3 eScreens = uScreens * decode(uLightScreens, uScaleScreens);
    vec3 color = albedo * (eCeiling + eScreens);
    if (uMode == 2) color = eCeiling;
    if (uMode == 3) color = eScreens;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    if (uMode == 1) gl_FragColor = linearToOutputTexel(vec4(albedo, 1.0));
  }
`;

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

let roomMaterial;
const emitters = []; // { material, color, strength, group }

async function bytes(name) {
  const res = await fetch(SCENE + name);
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}). Run blender/bake_control_room.py first.`);
  return res.arrayBuffer();
}

async function texture(buffer, srgb) {
  const bitmap = await createImageBitmap(new Blob([buffer]), { imageOrientation: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

async function load() {
  const [meta, glb, albedoBuf, ceilBuf, scrBuf] = await Promise.all([
    fetch(SCENE + 'meta.json').then((r) => { if (!r.ok) throw new Error('Could not load meta.json. Run blender/bake_control_room.py first.'); return r.json(); }),
    bytes('scene.glb'), bytes('albedo.png'), bytes('light_ceiling.png'), bytes('light_screens.png'),
  ]);
  const [albedo, lightCeiling, lightScreens] = await Promise.all([
    texture(albedoBuf, true), texture(ceilBuf, false), texture(scrBuf, false),
  ]);
  const gltf = await new GLTFLoader().parseAsync(glb, '');

  roomMaterial = new THREE.ShaderMaterial({
    vertexShader: roomVertex,
    fragmentShader: roomFragment,
    uniforms: {
      uAlbedo: { value: albedo }, uLightCeiling: { value: lightCeiling }, uLightScreens: { value: lightScreens },
      uScaleCeiling: { value: meta.scaleCeiling }, uScaleScreens: { value: meta.scaleScreens },
      uCeiling: { value: state.ceiling }, uScreens: { value: state.screens }, uMode: { value: 0 },
    },
  });
  gltf.scene.getObjectByName('Room').material = roomMaterial;
  for (const [name, e] of Object.entries(meta.emitters)) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    const material = new THREE.MeshBasicMaterial();
    mesh.material = material;
    emitters.push({ material, color: new THREE.Color(...e.color), strength: e.strength, group: e.group });
  }
  scene.add(gltf.scene);

  gltf.scene.updateMatrixWorld(true);
  const pick = Number(new URLSearchParams(location.search).get('cam')) || 0; // ?cam=2 for the operator's view
  const cam = gltf.cameras[Math.min(pick, gltf.cameras.length - 1)];
  cam.getWorldPosition(home.position);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
  home.target.copy(home.position).addScaledVector(forward, 5);
  camera.fov = cam.fov;
  goHome();

  const glbKb = Math.round(glb.byteLength / 1e3);
  const mapsKb = Math.round((albedoBuf.byteLength + ceilBuf.byteLength + scrBuf.byteLength) / 1e3);
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
  if (!roomMaterial) return;
  const u = roomMaterial.uniforms;
  u.uCeiling.value = state.ceiling;
  u.uScreens.value = state.screens;
  u.uMode.value = state.mode;
  for (const e of emitters) {
    const w = e.group === 'screens' ? state.screens : state.ceiling;
    e.material.color.copy(e.color).multiplyScalar(e.strength * DISPLAY[e.group] * (state.mode === 0 ? w : 0.02));
  }
  controls.update();
  renderer.render(scene, camera);
  ui.eq.innerHTML = `pixel = albedo × ( <b class="l">${state.ceiling.toFixed(2)}</b> · E<sub>ceiling</sub> + <b class="m">${state.screens.toFixed(2)}</b> · E<sub>screens</sub> )`;
});

load()
  .then(() => { ui.status.hidden = true; })
  .catch((err) => { ui.status.textContent = err.message; ui.status.classList.add('error'); console.error(err); });

setExposure(0);
setMode(0);
