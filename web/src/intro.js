// The intro: flying out to the platform by helicopter in the morning. We sit
// in the right-hand window seat and can turn our head, not move. The
// helicopter comes in, circles the platform once with it in our window, and
// lands; for the landing the view cuts to a camera on the helideck to watch
// the gear come down and the rotors stop.
//
// Models from blender/intro_export.py (web/public/intro/), the passengers from
// characters/, the sky and sea from outdoor.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Outdoor, WEATHER } from './outdoor.js';
import { Helicopter } from './helicopter.js';

const q = new URLSearchParams(location.search);
const BASE = 'intro/';
const CAST = ['blazer_lead', 'bearded_operator', 'crop_supervisor', 'curly_analyst', 'curly_fade_tech', 'glasses_engineer', 'grey_beard_lead'];
// Who sits where: seat [row, place] (rows front to back, places right to
// left). Row 1 faces aft, at us; rows 2 and 3 sit back to back.
const SEATING = [[0, 1], [0, 2], [0, 3], [1, 2], [2, 1], [2, 2], [3, 1]];
const PLAYER_SEAT = [1, 0];
const OUTFIT = q.get('outfit') ?? 'survival'; // offshore flights: immersion suit and lifejacket

// The flight, in platform coordinates as Blender has them (x east, y north,
// z up, metres): in from the east, round the platform clockwise so it
// stays in our right-hand window, then a right turn onto the helideck from the east
const ROUTE = [
  // On the circle's tangent line, so it rolls straight into the right turn;
  // dense points so the spline follows the line and the arc, without the
  // small left wiggle a sparse one puts in before the turn
  ...[1100, 900, 700, 500, 300, 150, 60, 20].map((d) => [97.9 + 0.940 * d, -310.1 + 0.342 * d, 250 + d * 0.04]),
  ...Array.from({ length: 55 }, (_, i) => {   // the circle, sinking over its last quarter
    const a = -70 - 5 * i, r = THREE.MathUtils.degToRad(a);
    return [-15 + 330 * Math.cos(r), 330 * Math.sin(r), 250 - 70 * THREE.MathUtils.clamp((-250 - a) / 90, 0, 1)];
  }),
  // then on round to the right onto the deck's line, heading west
  ...Array.from({ length: 9 }, (_, i) => {
    const r = THREE.MathUtils.degToRad(-10 * (i + 1));
    return [182 + 113 * Math.cos(r), 113 + 113 * Math.sin(r), 180 - 75 * (i + 1) / 9];
  }),
];
const HOVER = 6;            // m over the deck where the descent starts
const SETTLE = 5;           // m short of the spot (east of it) where the route ends
const CRUISE = [60, 52];    // m/s on the way out and round the platform
const BRAKE = 2.2;          // m/s² slowing down for the deck
const DESCENT = 5;          // s from the end of the route to the deck
const CUT_AT = 260;         // m from the deck: cut to the helideck camera
const GEAR_AT = 170;        // m from the deck: gear down, in view of the helideck camera

const B = (x, y, z) => new THREE.Vector3(x, z, -y); // Blender to three.js axes

// ---------------------------------------------------------------- setup

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const coarse = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0);
const outdoor = new Outdoor(0);
outdoor.set({ clouds: 0.3, wind: 0.3, fog: 0.03, rain: 0, ...WEATHER[q.get('weather')], time: Number(q.get('time') ?? 9.0), speed: 0 });
scene.add(outdoor.room);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(hemi, sun, sun.target);

const cabinCam = new THREE.PerspectiveCamera(62, 1, 0.05, 80000);
const deckCam = new THREE.PerspectiveCamera(40, 1, 0.3, 80000);
let camera = cabinCam;

// Models: fetched, or base64 strings a bundled page carries in window.INTRO_MODELS
const loader = new GLTFLoader();
// Embedded images (the characters' palette) decoded straight to bitmaps:
// the stock loader goes through blob: URLs, which a strict content
// security policy blocks and headless Chromium sometimes drops
loader.register((parser) => {
  const stock = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (i, l) => {
    const def = parser.json.images[i];
    if (def.bufferView === undefined || typeof createImageBitmap !== 'function') return stock(i, l);
    return parser.getDependency('bufferView', def.bufferView)
      .then((buf) => createImageBitmap(new Blob([buf], { type: def.mimeType }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then((bitmap) => { const tex = new THREE.Texture(bitmap); tex.needsUpdate = true; return tex; });
  };
  return { name: 'bitmap_images' };
});
function load(name) {
  const inline = window.INTRO_MODELS?.[name];
  if (!inline) return loader.loadAsync(BASE + name);
  const bin = atob(inline), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return loader.parseAsync(buf.buffer, '');
}
const info = window.INTRO_INFO ?? await fetch(BASE + 'intro.json').then((r) => r.json());
const [platform, heliModel, ...people] = await Promise.all([
  load('platform.glb'), load('heli.glb'), ...CAST.map((c) => load(`chars/${c}_${OUTFIT}.glb`).catch(() => load(`chars/${c}.glb`)).catch(() => null)),
]);

scene.add(platform.scene);
const glowing = [];
platform.scene.traverse((o) => {
  if (!o.isMesh) return;
  if (o.material.name === 'PlatGlass') { o.material.transparent = true; o.material.opacity = 0.5; }
  if (o.material.emissive?.getHex()) glowing.push(o.material);
});

// The helicopter: root moves along the route; the camera rides in it
const heliRoot = new THREE.Group();
heliRoot.rotation.order = 'YZX'; // heading, then pitch, then bank
scene.add(heliRoot);
heliRoot.add(heliModel.scene);
const heli = new Helicopter(heliModel.scene, { running: true, gearDown: false });
// The sky lights the cabin through its windows only: dim what's inside so
// the ambient light doesn't flood it; the sun does come in, with shadows
const INSIDE = ['HeliCabin', 'HeliFloor', 'HeliSeat', 'HeliPanel', 'HeliSuit'];
heliModel.scene.traverse((o) => {
  if (!o.isMesh) return;
  o.castShadow = o.receiveShadow = true;
  if (INSIDE.includes(o.material.name)) o.material.color.multiplyScalar(0.6);
  if (o.material.name === 'HeliClear') { o.castShadow = false; o.material.depthWrite = false; }
});

// Passengers, sat down: each character carries a seated_idle clip for a
// 0.45 m seat pan with the root on the floor below it
const seat = ([row, place]) => new THREE.Vector3().fromArray(info.seats[row * 4 + place]);
const passengers = [];
people.forEach((gltf, i) => {
  if (!gltf) return;
  const p = gltf.scene;
  const s = seat(SEATING[i]), face = info.seats[SEATING[i][0] * 4 + SEATING[i][1]][3];
  p.rotation.y = -face * Math.PI / 2;    // characters face -z, a seat faces +x (1) or -x (-1)
  p.position.set(s.x, s.y - 0.45, s.z);
  const mixer = new THREE.AnimationMixer(p);
  const act = Object.fromEntries(['seated_idle', 'stand_up', 'walk', 'step_down', 'blink'].map((n) => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, n);
    return [n, clip && mixer.clipAction(clip)];
  }));
  act.seated_idle?.play();
  for (const k of ['stand_up', 'step_down', 'blink']) if (act[k]) { act[k].setLoop(THREE.LoopOnce); act[k].clampWhenFinished = k !== 'blink'; }
  mixer.setTime(Math.random() * 4);
  const mats = [];
  p.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    o.frustumCulled = false;
    o.material = o.material.clone();
    mats.push([o.material, o.material.color.clone()]);
  });
  const shade = (k) => { for (const [m, c] of mats) m.color.copy(c).multiplyScalar(k); };
  shade(0.7);  // in the cabin the sky only reaches them through the windows
  const bones = {};
  p.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  Object.assign(p.userData, { mixer, act, shade, seat: s.clone(), face, bones, duck: 0, ducked: 0,
    state: 'seated', blinkAt: Math.random() * 4 });
  heliRoot.add(p);
  passengers.push(p);
});

// Off the helicopter: in turn, nearest the door first, each passenger stands
// up (out of the seat, so as not to rise through it), walks bent under the
// low cabin roof to the door on the stairs side, ducks through it, steps
// down to the deck and walks across the helideck to the stairs down into
// the quarters
const WALK = 1.25;          // m/s, the walk clip's pace
const EXIT_AT = 3;          // s after touchdown the first one stands up
const EXIT_GAP = 1.4;       // s between passengers
const STAND = 1.5;          // s the stand_up clip takes
const doorX = info.door.exit;   // clear of the sponson, over the step
const stairs = B(47.5, -4, 72.5);  // top of the stairs from the helideck down into the quarters
const parked = new THREE.Object3D();   // where the helicopter sits once down
parked.position.fromArray(info.park.position);
parked.rotation.y = info.park.yaw;
parked.updateMatrixWorld(true);
const stairsLocal = () => parked.worldToLocal(stairs.clone());
const EXIT_SIDE = Math.sign(stairsLocal().z) || -1;   // everyone uses the door facing the stairs
passengers.sort((a, b) => Math.abs(a.userData.seat.x - doorX) + (Math.sign(a.userData.seat.z) === EXIT_SIDE ? 0 : 0.5)
  - Math.abs(b.userData.seat.x - doorX) - (Math.sign(b.userData.seat.z) === EXIT_SIDE ? 0 : 0.5));
passengers.forEach((p, i) => { p.userData.leaveAt = EXIT_AT + i * EXIT_GAP; });

const STEP = 4;   // the route point at the door sill
// How far they bend (rad, split over spine and chest): under the cabin
// roof (1.75 m people, 1.70 m inside), and lower through the 1.4 m door
const DUCK_CABIN = 0.45, DUCK_DOOR = 1.25;

function route(p) {
  const { seat: st, face } = p.userData, side = EXIT_SIDE;
  const floor = info.floor, deck = info.helideck.centre[1] - info.park.position[1];
  const up = new THREE.Vector3(st.x + face * 0.35, floor, st.z);   // stood up, clear of the seat
  // Along the aisle, out through the door to the sill, the step_down clip
  // down onto the deck (1.0 m down, 0.6 m out), out from under the rotor
  // ahead of the sponson, then straight on to the stairs
  return [up, new THREE.Vector3(up.x, floor, side * 0.05),
    new THREE.Vector3(doorX, floor, side * 0.4), new THREE.Vector3(doorX, floor, side * 0.8),
    new THREE.Vector3(doorX, floor, side * 1.15),
    new THREE.Vector3(doorX, deck, side * 1.75), new THREE.Vector3(doorX + 1.2, deck, side * 3.2), stairsLocal().setY(deck)];
}

// Bend forward from the hips by u.duck, eased; undone first, so it never
// adds up on bones the playing clip doesn't move
// The arms hang from the chest, so they would swing back with it: turn
// them back toward hanging down, the right one a little ahead, reaching
// for the door frame
const BEND = [['spine', 0.55], ['chest', 0.55], ['neck', -0.25], ['upper_armL', -0.95], ['upper_armR', -1.25]];
function bend(p, dt) {
  const u = p.userData;
  if (!u.bones.spine || !u.bones.chest) return;
  u.ducked += (u.duck - u.ducked) * Math.min(1, dt * 5);
  for (const [n, k] of BEND) u.bones[n]?.rotateX(-u.ducked * k);
}
function unbend(p) {
  const u = p.userData;
  for (const [n, k] of BEND) u.bones[n]?.rotateX(u.ducked * k);
}

function disembark(p, since, dt) {
  const u = p.userData;
  if (u.state === 'seated' && since >= u.leaveAt) {
    u.state = 'standing';
    u.act.stand_up?.reset().play();
    u.act.seated_idle?.crossFadeTo(u.act.stand_up, 0.3, false);
    u.path = route(p);
    u.leg = 0;
    u.along = 0;
    u.from = p.position.clone();
  }
  if (u.state === 'standing') {
    // Rise forward out of the seat, bending under the roof as they come up
    const k = THREE.MathUtils.smoothstep(since - u.leaveAt, 0.2, STAND);
    p.position.lerpVectors(u.from, u.path[0], k);
    u.duck = DUCK_CABIN * k;
    if (since >= u.leaveAt + STAND) {
      u.state = 'walking';
      u.act.walk?.reset().play();
      if (u.act.walk) u.act.stand_up?.crossFadeTo(u.act.walk, 0.35, false);
    }
    return;
  }
  if (u.state === 'stepping') {
    // Head clear of the door as they go down: straighten up
    u.duck = since < u.stepEnd - 0.6 ? DUCK_DOOR : 0;
    if (since < u.stepEnd) return;
    // The clip ends 1.0 m down and 0.6 m out: move the root there and walk
    // on, cut over (a cross-fade would blend in the clip's drop as well,
    // and dip them into the deck)
    u.state = 'walking';
    u.act.step_down.stop();
    u.act.walk?.reset().play();
    u.leg = STEP + 1;
    u.along = 0;
    p.position.copy(u.path[u.leg]);
  }
  if (u.state !== 'walking') return;
  if (u.leg === STEP && u.act.step_down) { // at the sill, facing out: step down
    u.state = 'stepping';
    u.stepEnd = since + u.act.step_down.getClip().duration;
    p.position.copy(u.path[STEP]);
    p.rotation.y = Math.atan2(0, -Math.sign(u.path[STEP].z));
    u.act.step_down.reset().play();
    u.act.walk?.crossFadeTo(u.act.step_down, 0.15, false);
    u.shade(1);
    return;
  }
  const a = u.path[u.leg], b = u.path[u.leg + 1];
  if (!b) { u.state = 'gone'; p.visible = false; return; }
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  u.along += WALK * dt;
  if (u.along >= len) { u.along -= len; u.leg++; return disembark(p, since, 0); }
  p.position.copy(a).addScaledVector(d, u.along / len);
  const want = Math.atan2(-d.x, -d.z);
  p.rotation.y = lerpAngle(p.rotation.y, want, Math.min(1, dt * 8));
  // Bent under the roof in the cabin, lower still for the door
  u.duck = u.leg >= STEP ? 0 : u.leg >= STEP - 2 ? DUCK_DOOR : DUCK_CABIN;
  if (u.leg > STEP) u.shade(1);
  // Fade out at the top of the stairs
  const left = u.path.slice(u.leg + 1).reduce((acc, q, k, arr) => acc + (k ? q.distanceTo(arr[k - 1]) : q.distanceTo(p.position)), 0);
  if (left < 1.5) p.visible = false;
}


// Our head: in the window seat, turning but not moving
const head = new THREE.Group();
head.rotation.order = 'YXZ';
head.position.fromArray(info.eye);
heliRoot.add(head);
head.add(cabinCam);
const look = { yaw: -0.35, pitch: -0.08, toYaw: -0.35, toPitch: -0.08 };
const YAW = [-1.95, 1.25], PITCH = [-0.9, 0.7];
const PLATFORM_EYE = B(-10, 0, 55);   // where the eyes go when left alone  // right is negative; we're against the right wall

// ---------------------------------------------------------------- the route

const curve = new THREE.CatmullRomCurve3([...ROUTE.map((p) => B(...p)),
  B(info.park.position[0] + 40 + SETTLE, -info.park.position[2], info.park.position[1] + HOVER + 5),  // lined up with the deck
  new THREE.Vector3().fromArray(info.park.position).add(new THREE.Vector3(SETTLE, HOVER, 0))], false, 'centripetal', 0.5);
const LENGTH = curve.getLength();
const circleStart = curve.getLengthAtFraction?.(0) ?? 0;
// Speed along the path: cruise, then slow to a walk over the deck
const N = 3000, times = new Float32Array(N + 1);
const startCircle = (() => { // arc length where the route reaches the circle
  const p = B(...ROUTE[3]);
  let best = 0, d = Infinity;
  for (let i = 0; i <= 400; i++) {
    const e = curve.getPointAt(i / 400).distanceTo(p);
    if (e < d) { d = e; best = i / 400; }
  }
  return best * LENGTH;
})();
const speedAt = (s) => {
  const cruise = THREE.MathUtils.lerp(CRUISE[0], CRUISE[1], THREE.MathUtils.smoothstep(s, startCircle - 600, startCircle + 100));
  return Math.min(cruise, Math.sqrt(4 + 2 * BRAKE * (LENGTH - s)));
};
for (let i = 1; i <= N; i++) {
  const s0 = (i - 1) / N * LENGTH, s1 = i / N * LENGTH;
  times[i] = times[i - 1] + (s1 - s0) / speedAt((s0 + s1) / 2);
}
const FLIGHT = times[N];
const sAt = (t) => { // arc length at flight time t
  let lo = 0, hi = N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid; else hi = mid; }
  const f = (t - times[lo]) / Math.max(1e-6, times[hi] - times[lo]);
  return (lo + THREE.MathUtils.clamp(f, 0, 1)) / N * LENGTH;
};
const T_LAND = FLIGHT + DESCENT;
const T_END = T_LAND + 24;   // fade out as the last ones walk to the stairs

const park = new THREE.Vector3().fromArray(info.park.position);
const deckEdge = B(56, 15.5, 75.2);   // camera on a lamp post at the helideck's north-west rim
deckCam.position.copy(deckEdge);

// Pose of the helicopter at time t
const P = new THREE.Vector3(), D = new THREE.Vector3(), D2 = new THREE.Vector3();
let bank = 0;
function poseAt(t, dt) {
  let s, yaw, pitch = 0, v;
  if (t < FLIGHT) {
    s = sAt(t);
    v = speedAt(s);
    curve.getPointAt(s / LENGTH, P);
    curve.getTangentAt(s / LENGTH, D);
    curve.getTangentAt(Math.min(1, (s + v) / LENGTH), D2); // a second ahead, for the bank
    yaw = Math.atan2(-D.z, D.x);
    let turn = Math.atan2(-D2.z, D2.x) - yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));      // rad/s
    const want = THREE.MathUtils.clamp(-Math.atan(v * turn / 9.81), -0.5, 0.5);
    bank += (want - bank) * Math.min(1, dt * 1.5);
    // Nose a little down in cruise, up as it brakes, easing level again as
    // it slows to a walk over the deck
    const braking = THREE.MathUtils.smoothstep(CRUISE[1] - v, 0, 4) * THREE.MathUtils.smoothstep(v, 2, 14);
    pitch = -0.05 * v / CRUISE[0] + 0.05 * BRAKE * braking;
    // Over the last stretch, turn to the heading it parks with
    const k = 1 - THREE.MathUtils.smoothstep(LENGTH - s, 0, 80);
    yaw = lerpAngle(yaw, info.park.yaw, k);
  } else {
    // Settling onto the deck: still drifting forward the last few metres and
    // already sinking as the route ends, so neither motion stops dead
    const k = Math.min(t - FLIGHT, DESCENT) / DESCENT;
    const sink = 0.3 * k + 0.7 * THREE.MathUtils.smoothstep(k, 0, 1), drift = 1 - (1 - k) ** 2;
    P.copy(park).add(new THREE.Vector3(SETTLE * (1 - drift) * Math.cos(info.park.yaw + Math.PI), HOVER * (1 - sink), 0));
    yaw = info.park.yaw;
    pitch = -0.05 * 2 / CRUISE[0] * (1 - k);
    bank += (0 - bank) * Math.min(1, (dt || 0.016) * 1.5);
    s = LENGTH;
  }
  heliRoot.position.copy(P);
  heliRoot.rotation.set(0, yaw, 0);
  heliRoot.rotateZ(pitch);
  heliRoot.rotateX(bank);
  return LENGTH - s;
}
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// ---------------------------------------------------------------- input

let drag = null, touched = -Infinity; // when we last turned our head ourselves
// On the deck camera a drag only nudges the view a little, so the
// helicopter stays in the picture; it eases back when let go
const DECK_YAW = [-0.18, 0.18], DECK_PITCH = [-0.08, 0.08];
const deckLook = { yaw: 0, pitch: 0, toYaw: 0, toPitch: 0 };
function turn(dyaw, dpitch) {
  const [l, a, b] = cut ? [deckLook, DECK_YAW, DECK_PITCH] : [look, YAW, PITCH];
  l.toYaw = THREE.MathUtils.clamp(l.toYaw + dyaw * (cut ? 0.4 : 1), ...a);
  l.toPitch = THREE.MathUtils.clamp(l.toPitch + dpitch * (cut ? 0.4 : 1), ...b);
}
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); touched = t; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  touched = t;
  const k = 2.4 / Math.max(innerWidth, innerHeight);
  turn((e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
  drag = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', () => { drag = null; });
addEventListener('keydown', (e) => {
  const step = { ArrowLeft: [0.15, 0], ArrowRight: [-0.15, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] }[e.key];
  if (step) {
    touched = t;
    turn(...step);
  }
});

const ui = {
  caption: document.querySelector('.caption'),
  skip: document.querySelector('.skip'),
  clock: document.querySelector('.clock'),
  end: document.querySelector('.end'),
};
let t = Number(q.get('t') ?? 0);
const paused = q.has('pause');
// One button: skip to the landing in flight, then to the walk-off
const WALKOUT = () => T_LAND + EXIT_AT - 0.8;
ui.skip?.addEventListener('click', () => { t = t < FLIGHT - 8 ? FLIGHT - 7 : Math.max(t, WALKOUT()); });

const CAPTIONS = [
  [0, '09:00, crew change day. The platform is dead ahead.'],
  [8, 'Drag to look around.'],
  [16, ''],
  [T_LAND + 1, 'On the deck. Rotors running down.'],
  [T_LAND + 6, ''],
];

// ---------------------------------------------------------------- frame

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  for (const c of [cabinCam, deckCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  // Upright phone: keep about 80 degrees across, so the window still fits
  const a = w / h;
  cabinCam.fov = a < 1 ? Math.min(100, 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / a))) : 62;
  cabinCam.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const aim = new THREE.Vector3(), aimTo = new THREE.Vector3();
let last = performance.now(), landed = false, cut = q.get('view') === 'deck';
function frame(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // a first frame stamp can come before last
  last = now;
  step(paused ? 0 : dt);
  outdoor.render(renderer, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Advance everything by dt seconds (0 while paused)
function step(dt) {
  t += dt;
  const left = poseAt(t, dt || 0.016);
  if (left < GEAR_AT) heli.setGear(true);
  if (!landed && t >= T_LAND) { landed = true; heli.stop(); }
  heli.setDoors(t >= T_LAND + 1);
  heli.update(dt);

  // Left alone for a while, our eyes drift to the platform (when it's in reach)
  if (!cut && t - touched > 5) {
    heliRoot.updateMatrixWorld(true);
    const v = heliRoot.worldToLocal(PLATFORM_EYE.clone()).sub(head.position);
    const yaw = Math.atan2(-v.z, v.x), pitch = Math.atan2(v.y, Math.hypot(v.x, v.z));
    const k = Math.min(1, dt * 0.6);
    if (yaw > YAW[0] - 0.2 && yaw < YAW[1]) {
      look.toYaw += (THREE.MathUtils.clamp(yaw, ...YAW) - look.toYaw) * k;
      look.toPitch += (THREE.MathUtils.clamp(pitch * 0.8, ...PITCH) - look.toPitch) * k;
    }
  }
  // Head: eases to where the finger left it, with a little cabin shake
  look.yaw += (look.toYaw - look.yaw) * Math.min(1, dt * 8);
  look.pitch += (look.toPitch - look.pitch) * Math.min(1, dt * 8);
  const shake = landed ? 0 : 0.0016;
  head.rotation.set(look.pitch + shake * Math.sin(t * 23.1), -Math.PI / 2 + look.yaw + shake * Math.sin(t * 17.3), 0);
  for (const p of passengers) {
    if (landed) disembark(p, t - T_LAND, dt);
    const u = p.userData;
    if (u.act.blink && t > u.blinkAt) { u.act.blink.reset().play(); u.blinkAt = t + 2.5 + Math.random() * 4; }
    unbend(p);
    p.userData.mixer.update(dt);
    bend(p, dt);
  }

  // On short final, the helideck camera picks it up and follows it down
  if (left < CUT_AT || q.get('view') === 'deck') cut = true;
  camera = cut ? deckCam : cabinCam;
  if (q.has('off')) { // debug: a camera riding along outside, at ?off=x,y,z in the helicopter's frame
    camera = deckCam;
    deckCam.position.copy(heliRoot.localToWorld(new THREE.Vector3(...q.get('off').split(',').map(Number))));
    deckCam.lookAt(heliRoot.localToWorld(new THREE.Vector3(0, 1.8, 0)));
    deckCam.fov = 40;
    deckCam.updateProjectionMatrix();
  }
  if (cut && !q.has('off')) {
    const close = t - T_LAND > EXIT_AT - 0.5;
    if (close && !deckCam.userData.close) {   // cut to a camera close to the door as they get up
      deckCam.userData.close = true;
      deckCam.position.copy(parked.localToWorld(new THREE.Vector3(doorX + 7, 1.7, EXIT_SIDE * 8)));
      aim.set(0, 0, 0);
    }
    if (close) {
      // On the door, then a little way after them toward the stairs
      aimTo.copy(parked.localToWorld(new THREE.Vector3(doorX + 0.6, 1.5, EXIT_SIDE * 1.3)));
      aimTo.lerp(stairs, 0.22 * THREE.MathUtils.smoothstep(t - T_LAND, EXIT_AT + 5, EXIT_AT + 16));
    } else {
      aimTo.copy(heliRoot.position).add(new THREE.Vector3(0, 2.0, 0));
    }
    aim.lengthSq() ? aim.lerp(aimTo, Math.min(1, dt * 4)) : aim.copy(aimTo);
    deckCam.lookAt(aim);
    if (t - touched > 3 && !drag) { deckLook.toYaw *= 1 - Math.min(1, dt * 0.8); deckLook.toPitch *= 1 - Math.min(1, dt * 0.8); }
    deckLook.yaw += (deckLook.toYaw - deckLook.yaw) * Math.min(1, dt * 6);
    deckLook.pitch += (deckLook.toPitch - deckLook.pitch) * Math.min(1, dt * 6);
    deckCam.rotateY(deckLook.yaw);
    deckCam.rotateX(deckLook.pitch);
    deckCam.fov = close ? 50 : THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(14 / deckCam.position.distanceTo(aim))), 28, 55);
    deckCam.updateProjectionMatrix();
  }

  outdoor.update(dt);
  const L = outdoor.light;
  renderer.toneMappingExposure = L.exposure;
  hemi.color.copy(L.sky).multiplyScalar(Math.PI);
  hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
  sun.color.copy(L.sun);
  scene.fog.color.copy(L.fog);
  scene.fog.density = Math.LN2 / L.fogDistance;
  sun.target.position.copy(heliRoot.position);
  sun.position.copy(heliRoot.position).addScaledVector(L.sunDir, 30);
  for (const m of glowing) if (m.name !== 'PlatFlare') m.emissiveIntensity = 0.05;

  if (ui.clock) ui.clock.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} / ${Math.floor(T_END / 60)}:${String(Math.floor(T_END % 60)).padStart(2, '0')}`;
  if (ui.caption) {
    const c = CAPTIONS.filter(([at]) => t >= at).pop();
    if (ui.caption.dataset.text !== c[1]) { ui.caption.dataset.text = c[1]; ui.caption.textContent = c[1]; }
    ui.caption.classList.toggle('on', !!c[1]);
  }
  if (ui.skip) {
    ui.skip.hidden = t > WALKOUT() - 0.5 || (t > FLIGHT - 8 && t < FLIGHT - 7 + 3);   // a beat between the two
  }
  ui.end?.classList.toggle('on', t > T_END);

}
document.body.classList.add('ready');
requestAnimationFrame(frame);
window.intro = { advance(sec) { for (let k = 0; k < sec * 30; k++) step(1 / 30); }, // for screenshots
   bearing(tt) { // debug: where the platform is from our seat at time tt, in degrees (right negative) and down
    poseAt(tt, 0.016); heliRoot.updateMatrixWorld(true);
    const v = heliRoot.worldToLocal(new THREE.Vector3(0, 40, 0)).sub(head.position);
    return [Math.round(THREE.MathUtils.radToDeg(Math.atan2(-v.z, v.x))), Math.round(THREE.MathUtils.radToDeg(Math.atan2(v.y, Math.hypot(v.x, v.z)))), Math.round(THREE.MathUtils.radToDeg(heliRoot.rotation.y)), heliRoot.position.toArray().map(Math.round).join(",")];
  }, get t() { return t; }, set t(v) { t = v; }, FLIGHT, T_LAND, T_END, LENGTH, heli: heliRoot, look, curve, passengers };
