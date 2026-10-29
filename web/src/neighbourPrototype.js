// PROTOTYPE (throwaway): how should the neighbour platform on the horizon
// look? Our platform from the intro in the foreground, the neighbour 9 km
// SSE under outdoor.js's sky and sea (?neighbour=a|b|c picks the look).
// URL: neighbour-prototype.html?neighbour=b&view=deck|zoom|heli&time=12&weather=cloudy
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Outdoor, WEATHER, PLATFORM_HEADING } from './outdoor.js';
import { NEIGHBOUR } from './neighbour.js';

const q = new URLSearchParams(location.search);
const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 80000);
const outdoor = new Outdoor(0, { heading: PLATFORM_HEADING });
const weather = WEATHER[q.get('weather')] ? q.get('weather') : 'cloudy';
outdoor.set({ ...WEATHER[weather], time: Number(q.get('time') ?? 12), speed: 0 });
outdoor.update(0);
scene.add(outdoor.room);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
scene.add(hemi, sun, sun.target);

const platform = await new GLTFLoader().loadAsync('intro/platform.glb');
scene.add(platform.scene);
platform.scene.traverse((o) => {
  if (o.isMesh && o.material.emissive?.getHex() && o.material.name !== 'PlatFlare') o.material.emissiveIntensity = 0.05;
});

// The views: from the helideck at eye height, the same through a long lens
// (like the photo), and from the helicopter 15 km out on the way in
const at = outdoor.neighbour.group.position.clone().add(new THREE.Vector3(0, 55, 0));
const deck = new THREE.Vector3(65.5, 59.2, 0);
const toward = (b) => { const r = THREE.MathUtils.degToRad(b - PLATFORM_HEADING); return new THREE.Vector3(Math.sin(r), 0, -Math.cos(r)); };
const heli = toward(90).multiplyScalar(15000).add(new THREE.Vector3(0, 450, 0));
const VIEWS = {
  deck: { pos: deck, at: deck.clone().lerp(at, 0.02).setY(55), fov: 55, name: 'From the helideck, 55° view' },
  zoom: { pos: deck, at, fov: 14, name: 'From the helideck, long lens (14°, like the photo)' },
  heli: { pos: heli, at: heli.clone().add(toward(240).multiplyScalar(1000)).setY(380), fov: 62, name: 'From the helicopter, 15 km out' },
};
const view = VIEWS[q.get('view')] ?? VIEWS.deck;
camera.position.copy(view.pos);
camera.fov = view.fov;
const controls = new OrbitControls(camera, canvas);
controls.target.copy(view.pos.clone().add(view.at.clone().sub(view.pos).normalize()));
controls.rotateSpeed = -0.3;
controls.enableZoom = controls.enablePan = false;
controls.update();
document.querySelector('#tag').textContent = `${view.name} · ${NEIGHBOUR.distance / 1000} km at ${NEIGHBOUR.bearing}° · ?neighbour=${q.get('neighbour') ?? 'b'}`;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((t) => {
  outdoor.update(1 / 60);
  const L = outdoor.light;
  hemi.color.copy(L.sky).multiplyScalar(Math.PI); hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
  sun.color.copy(L.sun); sun.position.copy(L.sunDir).multiplyScalar(500); renderer.toneMappingExposure = L.exposure;
  controls.update();
  outdoor.render(renderer, camera, { reflect: scene });
  renderer.render(scene, camera);
  window.__frames = (window.__frames ?? 0) + 1;
});
