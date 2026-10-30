// First-person walk around the control room: walk with WASD and the mouse,
// sit in an operator chair and spin it, drink the coffee on the desks, and
// run the room from the desk touch panels and the light switch by the door.
// Scroll or click (or E, or tap Zoom in on phones) while looking at a screen
// to glide in until it fills the view; it runs live and sharp while zoomed.
//
// Collision is 2D, on the floor plan the bake exports (meta.layout, in
// Blender's X/Y). glTF swaps axes, so Blender (x, y) is three's (x, -z).
import * as THREE from 'three';
import { loadControlRoom } from './controlScene.js';
import { Outdoor, ROOM_HEADING, ROOM_ORIGIN } from './outdoor.js';
import { Cctv } from './cctv.js';
import { addVessel } from './vessel.js';
import { addSeabirds } from './gulls.js';
import { outdoorControls } from './outdoorControls.js';
import { RoomControls } from './roomControls.js';
import { CONTENT, DEFAULT_LAYOUT, contentOf, screenLabel } from './screens.js';
import { Highlight } from './highlight.js';
import { perfPanel, perfWatch, perfRow, perfStep } from './perf.js';

perfPanel(); // frame rate readout; tap it or press ` for the performance panel (see perf.js)

const EYE = 1.65;          // standing eye height, m
const SEATED_EYE = 1.18;
// Ceiling light at 100%, as a multiple of the bake (LED panels at 1.5): the
// bake's level read far too dim for a working control room
let FULL_LIGHT = 3;
const BODY = 0.28;         // player radius for collisions
const WALK = 1.5, RUN = 3.0; // m/s
const REACH = 1.9;         // how far away things can be used, m
const SIPS = 5, SIP_DROP = 0.011; // coffee level per sip, m
const CHAIR_R = 0.34;
const LOOK = 0.0022;       // radians per pixel of mouse movement
const SCREEN_REACH = 9;    // how far away a screen can be zoomed in on, m
const ZOOM_TIME = 0.45;    // s to glide in or out
const ASSIST = 0.06;       // radians: aiming this close to something still counts
const TAP = { px: 12, ms: 350 }; // a touch that moves less than this is a tap, not a look

const $ = (id) => document.getElementById(id);
const ui = {
  game: $('game'), canvas: $('view'), overlay: $('overlay'), go: $('go'), intro: $('intro'),
  prompt: $('prompt'), toast: $('toast'), crosshair: $('crosshair'),
  stick: $('stick'), spinBtn: $('spinBtn'),
  tp: $('tp'), tpClose: $('tpClose'), perf: $('tpPerf'),
  screenPick: $('tpScreen'), screenShows: $('tpShows'), screenReset: $('tpReset'),
};
const controls = new RoomControls({
  scenes: [...document.querySelectorAll('[data-scene]')], light: $('tpLight'), lightOut: $('tpLightOut'),
  screens: [...document.querySelectorAll('[data-screens]')],
  curtains: [...document.querySelectorAll('[data-curtains]')],
  volume: $('tpVolume'), volumeOut: $('tpVolumeOut'), setpoint: $('tpSetpoint'), temp: $('tpTemp'),
  warmer: $('tpWarmer'), cooler: $('tpCooler'),
});
// The game picks up at 11:30, half an hour after the crew-change flight
// (intro.html) lands: daylight, ceiling at full
const START_TIME = 11.5;
controls.setScene('full');
controls.ceiling = controls.light / 100;
const coarse = matchMedia('(pointer: coarse)').matches;
if (coarse) ui.game.classList.add('coarse');

// ?aa=0 turns off multisampling, to see what it costs (docs/performance.md)
const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: new URLSearchParams(location.search).get('aa') !== '0' });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false; // outdoor.render() clears and draws the sky and sea first
perfWatch(renderer); // ?perf=1 overlay, ?trace=1 markers (see perf.js)
const scene = new THREE.Scene();
scene.name = 'room';
perfRow('sea look', () => outdoor ? `${outdoor.quality.level.toUpperCase()}${outdoor.quality.auto ? ' (auto)' : ''}` : '…');
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 500);
camera.rotation.order = 'YXZ';
const highlight = new Highlight(scene, renderer, { width: coarse ? 3 : 2.5, frameOf: (name, from) => room.screenFrame(name, from) });

const player = {
  pos: new THREE.Vector3(0, EYE, 1.5), // behind the desks; three coordinates; feet at y = 0, eye at pos.y
  vel: new THREE.Vector3(), yaw: 0, pitch: -0.08, bob: 0,
  seat: null,   // the chair we're sitting in
  busy: null,   // the drinking animation, while it runs
};
const keys = new Set();
const touch = { move: new THREE.Vector2() };
let room, outdoor, cctv, vessel, birds, layout, playing = false, panelOpen = false;
const lamps = {}; // the rest corner's lamps: name -> { on, w (eased brightness) }
const chairs = [], mugs = [], pickables = [], items = [];
const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
let target = null; // { kind: 'chair' | 'mug' | 'panel' | 'switch' | 'screen', item, meshes }
const screenRay = new THREE.Raycaster();
screenRay.far = SCREEN_REACH;
const pointer = new THREE.Vector2(); // the mouse, when looking by dragging rather than pointer lock
let zoom = null; // { name, k: 0..1, dir: ±1, pos, quat }, while gliding to or looking at a screen

// ---------------------------------------------------------------- loading

async function load() {
  room = await loadControlRoom(renderer);
  layout = room.meta.layout;
  if (!layout) throw new Error('This scene was baked before the walk-around existed. Reload the page; if that does not help, re-run blender/bake_control_room.py.');
  scene.add(room.root);
  outdoor = new Outdoor(room.seaLevel, { heading: ROOM_HEADING, origin: ROOM_ORIGIN });
  outdoor.setWindow(room.window.lo, room.window.hi);
  outdoor.set({ time: START_TIME });   // ?time= on the URL still wins (outdoorControls)
  // The deck cameras' live pictures; without them the screens draw their own
  const cctvReady = Cctv.load(renderer, outdoor);
  cctvReady.then((c) => { cctv = c; if (c) room.setFeeds(c.feeds, c.gain); }).catch((e) => console.warn('cctv', e)).finally(() => { cctvSettled = true; });
  scene.add(outdoor.room);
  outdoorControls($('tpOutdoor'), outdoor);
  // The supply vessel: through the window, on the crane camera, and its row on the panel
  addVessel({ renderer, scene, room, outdoor, cctv: cctvReady, panel: $('tpOutdoor') })
    .then((v) => { vessel = v; }).catch((e) => console.warn('vessel', e));
  // Seabirds round the platform: through the window and on the cameras (gulls.js).
  // Not in story mode, where a gull darting past distracts from the talk
  // (Adriaen, 2026-10-29); the prologue's flight keeps its own flock. ?birds= brings them back
  const storyPage = /story\.html$/.test(location.pathname) && !new URLSearchParams(location.search).has('birds');
  // The curtains start open: midday, and always in story mode (Adriaen,
  // 2026-10-30). ?curtainsclosed=1 starts the walk-around with them closed
  if (!/story\.html$/.test(location.pathname) && new URLSearchParams(location.search).get('curtainsclosed') === '1') controls.setCurtains(false);
  room.curtains?.set(controls.curtains, true);
  if (!storyPage) addSeabirds({ scene, room, outdoor, cctv: cctvReady, vessel: () => vessel })
    .then((b) => { birds = b; }).catch((e) => console.warn('birds', e));
  const root = room.root;
  for (const name of room.meta.movable ?? []) {
    const obj = root.getObjectByName(name);
    if (name.startsWith('Chair')) chairs.push({ obj, omega: 0 });
    if (name.endsWith('Mug')) {
      const coffee = root.getObjectByName(name.slice(0, -3) + 'Coffee');
      if (coffee) obj.attach(coffee); // the coffee travels with its mug
      mugs.push({ obj, coffee, sips: SIPS, rest: { p: obj.position.clone(), q: obj.quaternion.clone() } });
    }
  }
  for (const c of chairs) usable({ kind: 'chair', item: c }, c.obj);
  for (const m of mugs) usable({ kind: 'mug', item: m }, m.obj, m.coffee);
  for (const name of room.meta.movable ?? []) {
    const obj = root.getObjectByName(name);
    if (name.endsWith('TouchPanel')) {
      usable({ kind: 'panel', item: obj }, obj);
      obj.add(panelScreen());
    } else if (name.endsWith('LightPanel')) {
      usable({ kind: 'switch', item: obj }, obj);
      switchKeys.push(...lightKeys(obj));
    }
  }
  for (const name of room.lamps) {
    lamps[name] = { on: true, w: 1 };
    usable({ kind: 'lamp', item: name }, root.getObjectByName(room.meta.lamps[name].body), ...room.lampMeshes(name));
  }
  pickables.push(root.getObjectByName('Room')); // so walls and desks block the view of things behind them
  setUpScreenPicker();
  clearSpawn();
  lookAt(-0.6, 2.2);
  ui.go.disabled = false;
  ui.go.textContent = coarse ? 'Tap to start' : 'Click to start';
}

// Something the player can aim at and use, made of these meshes (which light
// up together when aimed at)
function usable(item, ...meshes) {
  item.meshes = meshes.filter(Boolean);
  for (const mesh of item.meshes) { mesh.userData.item = item; pickables.push(mesh); }
  items.push(item);
}

// The panel's screen picker: choose a screen, then what it shows. Choices
// are remembered in this browser only.
const LAYOUT_KEY = 'controlRoom.screens';
function setUpScreenPicker() {
  const names = Object.keys(room.meta.screens?.slots ?? {});
  ui.screenPick.replaceChildren(...names.map((n) => new Option(screenLabel(n), n)));
  ui.screenShows.replaceChildren(...Object.entries(CONTENT).map(([id, [label]]) => new Option(label, id)));
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LAYOUT_KEY)) ?? {}; } catch { /* private mode: start fresh */ }
  for (const [n, id] of Object.entries(saved)) if (names.includes(n) && CONTENT[id] && id !== contentOf(n)) room.setContent(n, id);
  const sync = () => { ui.screenShows.value = contentOf(ui.screenPick.value); };
  const save = () => {
    const changed = Object.fromEntries(names.filter((n) => contentOf(n) !== DEFAULT_LAYOUT[n]).map((n) => [n, contentOf(n)]));
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(changed)); } catch { /* not remembered */ }
  };
  ui.screenPick.addEventListener('change', sync);
  ui.screenShows.addEventListener('change', () => { room.setContent(ui.screenPick.value, ui.screenShows.value); save(); });
  ui.screenReset.addEventListener('click', () => {
    for (const n of names) if (contentOf(n) !== DEFAULT_LAYOUT[n]) room.setContent(n, DEFAULT_LAYOUT[n]);
    save();
    sync();
  });
  sync();
}

// The glowing face of a desk touch panel: a plane over its glass, in the
// panel's own frame (see props.make_touchpanel: glass leaning back 50°)
function panelScreen() {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.185, 0.115),
    new THREE.MeshBasicMaterial({ map: controls.texture, color: new THREE.Color(0.55, 0.55, 0.55) }));
  const lean = THREE.MathUtils.degToRad(-50);
  const out = 0.0095; // just proud of the glass
  mesh.position.set(0, 0.06 + out * Math.sin(-lean), -(0.02 - out * Math.cos(lean)));
  mesh.rotation.x = lean;
  return mesh;
}

// The light switch's three keys (full, night, off from the top; see
// props.make_lightpanel), drawn over the baked ones so the one for the
// current scene can glow. The panel comes out of the bake unrotated, its
// face toward -X.
const KEY_ON = new THREE.Color(1.0, 0.8, 0.45), KEY_OFF = new THREE.Color(0.045, 0.045, 0.05);
const switchKeys = [];
function lightKeys(panel) {
  return ['full', 'night', 'off'].map((name, i) => {
    const key = new THREE.Mesh(new THREE.PlaneGeometry(0.054, 0.024), new THREE.MeshBasicMaterial({ color: KEY_OFF }));
    key.position.set(-0.0172, 0.04 - i * 0.04, 0); // just proud of the key's face
    key.rotation.y = -Math.PI / 2;
    key.userData.scene = name;
    panel.add(key);
    return key;
  });
}

// Point the player at a spot on the floor plan (Blender x, y)
function lookAt(bx, by) {
  const dx = bx - player.pos.x, dz = -by - player.pos.z;
  player.yaw = Math.atan2(-dx, -dz);
}

// -------------------------------------------------------------- collision

function rFront(a) {
  const c = layout.desks.reduce((p, d) => (Math.abs(a - d) < Math.abs(a - p) ? d : p));
  const t = Math.min(Math.abs(a - c) / layout.deskHalf, 1);
  return layout.rFront + layout.bayDepth * Math.cos(0.5 * Math.PI * t) ** 2;
}

// Is a body of radius BODY at Blender (x, y) inside the room, the rest
// corner behind it, or the opening between the two?
function walkable(bx, by) {
  const inside = ([x0, y0, x1, y1]) => bx > x0 + BODY && bx < x1 - BODY && by > y0 + BODY && by < y1 - BODY;
  if (inside(layout.room)) return true;
  if (!layout.nook) return false;
  if (inside(layout.nook)) return true;
  const [d0, d1] = layout.nookDoor, wall = layout.room[1];
  return bx > d0 + BODY && bx < d1 - BODY && Math.abs(by - wall) <= BODY + 0.02;
}

// Is a body of radius BODY at three (x, z) inside anything solid?
function blocked(x, z) {
  const bx = x, by = -z;
  if (!walkable(bx, by)) return true;
  const r = Math.hypot(bx, by), a = Math.atan2(bx, by);
  const spread = BODY / Math.max(r, 0.5);
  for (const c of layout.desks) {
    if (Math.abs(a - c) <= layout.deskHalf + spread) {
      const ac = Math.max(c - layout.deskHalf, Math.min(c + layout.deskHalf, a));
      if (r > rFront(ac) - BODY && r < layout.rBack + BODY) return true;
    }
  }
  if (Math.abs(a) <= layout.wallHalf + spread && r > layout.wallR - 0.1 - BODY && r < layout.wallR + 0.15 + BODY) return true;
  // The TV hanging past the end of the band is below head height
  if (layout.tv && Math.abs(a - layout.tv[0]) <= layout.tv[1] + spread && r > layout.wallR - 0.1 - BODY && r < layout.wallR + 0.15 + BODY) return true;
  const [tx, ty, trx, try_] = layout.table;
  if (((bx - tx) / (trx + BODY)) ** 2 + ((by - ty) / (try_ + BODY)) ** 2 < 1) return true;
  for (const [cx, cy, hx, hy, yaw] of layout.boxes ?? []) {
    const dx = bx - cx, dy = by - cy, c = Math.cos(yaw), s = Math.sin(yaw);
    if (Math.abs(dx * c + dy * s) < hx + BODY && Math.abs(-dx * s + dy * c) < hy + BODY) return true;
  }
  for (const c of chairs) {
    if (c === player.seat) continue;
    if (Math.hypot(x - c.obj.position.x, z - c.obj.position.z) < CHAIR_R + BODY) return true;
  }
  return false;
}

// If furniture has moved onto the start, step out to the nearest clear floor
function clearSpawn() {
  const p = player.pos;
  for (let r = 0; r < 3; r += 0.1) {
    for (let i = 0, n = Math.max(1, Math.round(r * 40)); i < n; i++) {
      const a = (i / n) * 2 * Math.PI, x = p.x + r * Math.cos(a), z = p.z + r * Math.sin(a);
      if (!blocked(x, z)) { p.x = x; p.z = z; return; }
    }
  }
}

// Move by (dx, dz), sliding along whatever is in the way
function move(dx, dz) {
  const p = player.pos;
  if (!blocked(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return; }
  if (!blocked(p.x + dx, p.z)) p.x += dx;
  else if (!blocked(p.x, p.z + dz)) p.z += dz;
}

// ------------------------------------------------------------ interaction

const center = new THREE.Vector2(0, 0), tapPoint = new THREE.Vector2();
const aimDir = new THREE.Vector3(), toward = new THREE.Vector3(), bestCenter = new THREE.Vector3(), bounds = new THREE.Sphere();

// What the ray from the camera through `ndc` (screen centre by default) lands
// on, if it is something usable and not the chair we sit in
function usableAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const item = raycaster.intersectObjects(pickables, false)[0]?.object.userData.item;
  return item && item.item !== player.seat ? item : null;
}

// A screen further out, which can be zoomed in on (the room still hides them)
function screenAt(ndc) {
  screenRay.setFromCamera(ndc, camera);
  const far = screenRay.intersectObjects([room.root.getObjectByName('Room'), ...room.screenMeshes], false)[0];
  const name = far && room.screenMeshes.includes(far.object) ? room.screenAt(far) : null;
  return name ? { kind: 'screen', item: name } : null;
}

function findTarget() {
  if (player.busy || panelOpen) return null;
  // Screens follow the mouse when looking by dragging
  const direct = usableAt(center) ?? screenAt(dragLook && !coarse ? pointer : center);
  if (direct) return direct;
  // Nearly on it counts too, so a mug or a switch doesn't need pixel-perfect
  // aim: take the thing whose bounds come closest to the crosshair, if
  // nothing stands between it and the eye
  camera.getWorldDirection(aimDir);
  let best = null, bestAngle = ASSIST;
  for (const item of items) {
    if (item.item === player.seat) continue;
    for (const mesh of item.meshes) {
      if (!mesh.visible) continue;
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      bounds.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld);
      toward.subVectors(bounds.center, camera.position);
      const d = toward.length();
      if (d - bounds.radius > REACH) continue;
      const angle = aimDir.angleTo(toward) - Math.asin(Math.min(1, bounds.radius / d));
      if (angle < bestAngle) { best = item; bestAngle = angle; bestCenter.copy(bounds.center); }
    }
  }
  if (best) {
    raycaster.set(camera.position, toward.subVectors(bestCenter, camera.position).normalize());
    const seen = raycaster.intersectObjects(pickables, false)[0]?.object.userData.item;
    if (seen === best) return best;
  }
  return null;
}

// Glide the camera to face a screen, near enough that it fills the view
function zoomIn(name) {
  const f = room.screenFrame(name, camera.position);
  if (!f) return;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / 1.06;
  const d = Math.max(f.height / 2 / t, f.width / 2 / (t * camera.aspect));
  const pos = f.center.clone().addScaledVector(f.normal, d);
  const m = new THREE.Matrix4().lookAt(pos, f.center, f.up);
  zoom = { name, k: 0, dir: 1, pos, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
  keys.clear();
  player.vel.set(0, 0, 0);
  room.setFocus(name);
}
function zoomOut() { if (zoom) zoom.dir = -1; }
function zoomEnd() { zoom = null; room.setFocus(null); }

function chairForward(c) {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(c.obj.quaternion); // the sitter faces the chair's -Z
}

function sit(c) {
  player.seat = c;
  player.vel.set(0, 0, 0);
  const f = chairForward(c);
  player.yaw = Math.atan2(-f.x, -f.z);
  player.pitch = -0.15;
  toast('Seated. A and D spin the chair, E to stand up.');
}

function standUp() {
  const c = player.seat;
  player.seat = null;
  const f = chairForward(c);
  // Step out of the chair: back from the desk first, then to either side
  for (const [back, side] of [[0.65, 0], [0.65, 0.4], [0.65, -0.4], [0.9, 0], [0.4, 0.7], [0.4, -0.7]]) {
    const x = c.obj.position.x - f.x * back - f.z * side, z = c.obj.position.z - f.z * back + f.x * side;
    if (!blocked(x, z)) { player.pos.set(x, EYE, z); return; }
  }
  player.pos.set(c.obj.position.x - f.x * 0.65, EYE, c.obj.position.z - f.z * 0.65);
}

function spin(c, dir = Math.random() < 0.5 ? -1 : 1) {
  c.omega += dir * (5 + Math.random() * 3);
}

const LINES = [
  'Ahh. Strong enough to see you through to the evening handover.',
  'Lukewarm, but it does the job.',
  'Someone made this at six this morning. You can tell.',
  'Still better than the machine on the lower deck.',
  'Last sip.',
];

function drink(m) {
  if (m.sips === 0) { toast('The mug is empty. The coffee machine is a long walk away.'); return; }
  player.busy = { mug: m, t: 0 };
}

function openPanel() {
  panelOpen = true;
  keys.clear();
  player.vel.set(0, 0, 0);
  ui.tp.hidden = false;
  if (document.pointerLockElement) document.exitPointerLock();
}

// `relock` only from a click: browsers refuse pointer lock without one
function closePanel(relock) {
  if (!panelOpen) return;
  panelOpen = false;
  ui.tp.hidden = true;
  if (coarse || dragLook) return;
  if (relock) Promise.resolve(ui.canvas.requestPointerLock?.()).catch(() => pause());
  else pause();
}

function pause() {
  if (zoom) zoomEnd();
  playing = false;
  keys.clear();
  ui.overlay.hidden = false;
  ui.go.textContent = 'Click to continue';
}

function interact() {
  if (player.busy || panelOpen) return;
  if (zoom) return zoomOut();
  if (target?.kind === 'screen' && !player.seat) return zoomIn(target.item);
  if (target?.kind === 'mug') return drink(target.item);
  if (target?.kind === 'panel') return openPanel();
  if (target?.kind === 'switch') return controls.nextScene(); // the room itself shows the change
  if (target?.kind === 'lamp') { lamps[target.item].on = !lamps[target.item].on; return; }
  if (player.seat) return standUp();
  if (target?.kind === 'chair') return sit(target.item);
}

let toastTimer;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('on'), 3200);
}


// ------------------------------------------------------------- the frame

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
const holdQ = new THREE.Quaternion(), holdP = new THREE.Vector3(), tiltE = new THREE.Euler(0, 0, 0, 'YXZ');

function update(dt) {
  // Chairs keep spinning a while after a push
  for (const c of chairs) {
    if (Math.abs(c.omega) < 1e-3) continue;
    const turn = c.omega * dt;
    c.obj.rotateY(turn);
    if (c === player.seat) player.yaw += turn;
    c.omega *= Math.exp(-1.6 * dt);
  }

  if (zoom) {
    player.vel.set(0, 0, 0);
  } else if (player.seat) {
    const c = player.seat;
    const push = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) + touch.move.x * -1;
    c.omega += push * 9 * dt;
    c.omega = Math.max(-9, Math.min(9, c.omega));
    const f = chairForward(c);
    player.pos.set(c.obj.position.x - f.x * 0.1, SEATED_EYE, c.obj.position.z - f.z * 0.1);
  } else if (!player.busy) {
    fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    right.set(-fwd.z, 0, fwd.x);
    const ax = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.move.x;
    const az = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - touch.move.y;
    wish.copy(fwd).multiplyScalar(az).addScaledVector(right, ax);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.multiplyScalar(keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK);
    player.vel.lerp(wish, 1 - Math.exp(-10 * dt));
    move(player.vel.x * dt, player.vel.z * dt);
    const speed = Math.hypot(player.vel.x, player.vel.z);
    player.bob += speed * dt * 5.5;
    player.pos.y = EYE + Math.sin(player.bob) * 0.022 * Math.min(speed / WALK, 1);
  } else {
    player.vel.set(0, 0, 0);
  }

  camera.position.copy(player.pos);
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (zoom) {
    zoom.k = Math.max(0, Math.min(1, zoom.k + zoom.dir * dt / ZOOM_TIME));
    const k = smooth(zoom.k);
    camera.position.lerp(zoom.pos, k);
    camera.quaternion.slerp(zoom.quat, k);
    if (zoom.dir < 0 && zoom.k === 0) zoomEnd();
  }
  camera.updateMatrixWorld();

  if (player.busy) drinking(dt);

  target = playing && !zoom ? findTarget() : null;
  highlight.set(target?.meshes);
  highlight.frame(target?.kind === 'screen' ? target.item : null, camera.position);
  highlight.update(dt);
  showPrompt();
}

// Bring the mug up to the face, tip it, put it back
function drinking(dt) {
  const b = player.busy, m = b.mug;
  b.t += dt;
  const UP = 0.6, SIP = 1.0, DOWN = 0.6;
  holdP.set(0.02, -0.12, -0.26);
  camera.localToWorld(holdP);
  holdQ.setFromEuler(tiltE.set(0, player.yaw, 0));
  let k, tilt = 0;
  if (b.t < UP) k = smooth(b.t / UP);
  else if (b.t < UP + SIP) { k = 1; tilt = Math.sin(Math.PI * (b.t - UP) / SIP) * 1.05; }
  else k = 1 - smooth(Math.min((b.t - UP - SIP) / DOWN, 1));
  if (tilt) holdQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
  m.obj.position.copy(m.rest.p).lerp(holdP, k);
  m.obj.quaternion.copy(m.rest.q).slerp(holdQ, k);
  if (!b.sipped && b.t > UP + SIP * 0.5) {
    b.sipped = true;
    m.sips -= 1;
    if (m.coffee) {
      m.coffee.position.y -= SIP_DROP;
      m.coffee.visible = m.sips > 0;
    }
    toast(LINES[SIPS - 1 - m.sips] ?? LINES[0]);
  }
  if (b.t >= UP + SIP + DOWN) {
    m.obj.position.copy(m.rest.p);
    m.obj.quaternion.copy(m.rest.q);
    player.busy = null;
  }
}

const smooth = (t) => t * t * (3 - 2 * t);

function showPrompt() {
  let text = '', spinOk = false, use = '';
  if (target?.kind === 'mug') use = target.item.sips ? `Drink (${target.item.sips} sip${target.item.sips > 1 ? 's' : ''} left)` : 'Empty mug';
  else if (target?.kind === 'panel') use = 'Room controls';
  else if (target?.kind === 'switch') use = `Lights: ${controls.nextSceneName()}`;
  else if (target?.kind === 'lamp') use = lamps[target.item].on ? 'Lamp off' : 'Lamp on';
  else if (target?.kind === 'screen' && !player.seat) use = 'Zoom in';
  else if (player.seat) { use = 'Stand up'; spinOk = true; }
  else if (target?.kind === 'chair') { use = 'Sit'; spinOk = true; }
  if (use) text = `<kbd>E</kbd>${use}`;
  if (spinOk) text += player.seat ? '&nbsp;&nbsp;<kbd>A</kbd><kbd>D</kbd>Spin' : '&nbsp;&nbsp;<kbd>Click</kbd>Spin';
  const zoomable = target?.kind === 'screen';
  if (zoomable) text = `${player.seat ? text + '&nbsp;&nbsp;' : ''}<kbd>Click</kbd><kbd>Scroll</kbd>Zoom in`;
  if (zoom) text = '<kbd>Click</kbd><kbd>Scroll</kbd>Back';
  if (player.busy || panelOpen) text = '';
  // On phones a tap zooms on a screen, before anything else
  const btn = zoom ? 'Back' : zoomable ? 'Zoom in' : use;
  if (coarse) text = btn && !player.busy && !panelOpen ? `<kbd>Tap</kbd>${btn}` : '';
  if (ui.prompt.innerHTML !== text) ui.prompt.innerHTML = text;
  ui.crosshair.classList.toggle('on', Boolean(use) && !zoom);
  ui.crosshair.hidden = Boolean(zoom);
  ui.prompt.classList.toggle('low', Boolean(zoom)); // out of the way of the screen
  ui.spinBtn.hidden = !spinOk || Boolean(zoom);
}

// ------------------------------------------------------------------ input

function start() {
  if (ui.go.disabled) return;
  playing = true;
  ui.overlay.hidden = true;
  controls.startAudio();
  if (coarse || dragLook) return;
  // Some browsers and embedded views refuse pointer lock: look by dragging instead
  Promise.resolve(ui.canvas.requestPointerLock?.()).catch(() => { dragLook = true; });
}
let dragLook = false;
document.addEventListener('pointerlockerror', () => { dragLook = true; });
ui.overlay.addEventListener('click', start);
document.addEventListener('pointerlockchange', () => {
  if (coarse || dragLook || panelOpen) return;
  if (document.pointerLockElement === ui.canvas) return;
  pause();
});
ui.tpClose.addEventListener('click', () => closePanel(true));
ui.tp.addEventListener('click', (e) => { if (e.target === ui.tp) closePanel(true); });

addEventListener('keydown', (e) => {
  if (!playing) return;
  if (panelOpen) {
    if (e.code === 'Escape' || e.code === 'KeyE') closePanel(false);
    return;
  }
  if (zoom && e.code === 'Escape') return zoomOut();
  keys.add(e.code);
  if (e.code === 'KeyE' && !e.repeat) interact();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

ui.canvas.addEventListener('mousemove', (e) => {
  if (dragLook) {
    const r = ui.canvas.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  }
  if (!playing || coarse || zoom) return;
  if (document.pointerLockElement !== ui.canvas && !(dragLook && e.buttons & 1)) return;
  player.yaw -= e.movementX * LOOK;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * LOOK));
});
ui.canvas.addEventListener('mousedown', (e) => {
  if (!playing || coarse || panelOpen || e.button !== 0) return;
  if (zoom) return zoomOut();
  if (target?.kind === 'screen') {
    // Without pointer lock a press may start a drag to look: zoom on release, if it didn't move
    if (!dragLook) return zoomIn(target.item);
    press = { x: e.clientX, y: e.clientY, name: target.item };
    return;
  }
  const c = player.seat ?? (target?.kind === 'chair' ? target.item : null);
  if (c) spin(c);
});
let press = null;
ui.canvas.addEventListener('mouseup', (e) => {
  if (press && !zoom && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) zoomIn(press.name);
  press = null;
});

// Touch: a stick bottom-left to walk, drag anywhere else to look
const looks = new Map();
let stickId = null;
ui.stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; ui.stick.setPointerCapture(e.pointerId); stickMove(e); });
ui.stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; touch.move.set(0, 0); ui.stick.firstElementChild.style.transform = ''; };
ui.stick.addEventListener('pointerup', stickEnd);
ui.stick.addEventListener('pointercancel', stickEnd);
function stickMove(e) {
  const r = ui.stick.getBoundingClientRect();
  const v = new THREE.Vector2(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2).divideScalar(r.width / 2);
  if (v.length() > 1) v.normalize();
  touch.move.copy(v);
  ui.stick.firstElementChild.style.transform = `translate(${v.x * 37}px, ${v.y * 37}px)`;
}
// A short touch that barely moves is a tap: it uses what was tapped, or else
// whatever is lit up under the crosshair
ui.canvas.addEventListener('pointerdown', (e) => {
  if (coarse) looks.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0, t0: performance.now() });
});
ui.canvas.addEventListener('pointermove', (e) => {
  const last = looks.get(e.pointerId);
  if (!last || !playing) return;
  const dx = e.clientX - last.x, dy = e.clientY - last.y;
  last.x = e.clientX; last.y = e.clientY; last.moved += Math.hypot(dx, dy);
  if (zoom) return;
  player.yaw -= dx * 0.005;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * 0.005));
});
ui.canvas.addEventListener('pointerup', (e) => {
  const look = looks.get(e.pointerId);
  looks.delete(e.pointerId);
  if (look && look.moved < TAP.px && performance.now() - look.t0 < TAP.ms) tap(e.clientX, e.clientY);
});
ui.canvas.addEventListener('pointercancel', (e) => looks.delete(e.pointerId));

function tap(x, y) {
  if (!playing || panelOpen || player.busy) return;
  if (zoom) return zoomOut();
  const r = ui.canvas.getBoundingClientRect();
  tapPoint.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  const tapped = usableAt(tapPoint) ?? target ?? screenAt(tapPoint);
  if (!tapped && !player.seat) return; // seated, a tap on nothing stands you up
  if (tapped?.kind === 'screen') return zoomIn(tapped.item); // seated too
  target = tapped;
  interact();
}
ui.canvas.addEventListener('wheel', (e) => {
  if (!playing || panelOpen) return;
  e.preventDefault();
  if (e.deltaY < 0 && !zoom && target?.kind === 'screen') zoomIn(target.item);
  else if (e.deltaY > 0 && zoom) zoomOut();
}, { passive: false });
ui.spinBtn.addEventListener('click', () => { const c = player.seat ?? target?.item; if (c?.omega !== undefined) spin(c); });

new ResizeObserver(() => {
  const w = ui.game.clientWidth, h = ui.game.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(ui.game);

// Average frame time, shown on the touch panel so the screens' cost can be
// compared with them on and off
const perf = { sum: 0, n: 0 };
function showFrameTime(frame) {
  perf.sum += frame; perf.n++;
  if (perf.sum < 0.5) return;
  const ms = (perf.sum / perf.n) * 1000;
  ui.perf.textContent = `Frame time ${ms.toFixed(1)} ms · ${Math.round(1000 / ms)} fps`;
  perf.sum = perf.n = 0;
}

// Story mode (story.html) runs on top of this page: it adds per-frame steps
// and render passes, and can hide the room while its prologue plays
const hooks = { frame: [], render: [], reflect: [], hidden: false, covered: false };   // reflect: more scenes for the sea's mirror; covered: an opaque title is over the picture

// Behind the story's prologue or a solid title the room doesn't show, so it isn't drawn, apart
// from a few frames once it and the CCTV have loaded, into a single pixel:
// that compiles every shader (room, sea, mirror, CCTV) out of sight instead
// of stalling the first frame after the intro
const WARM = { frames: 10, ms: 2500 };   // and long enough for the CCTV to take a picture
let warm = 0, warmFrom = 0, cctvSettled = false;
const fullSize = new THREE.Vector2();

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const frame = (now - last) / 1000, dt = Math.min(frame, 0.05);
  last = now;
  if (!room) return;
  perfStep('player', () => update(dt));
  for (const f of hooks.frame) perfStep('story', () => f(dt, now));   // story mode (src/story/) steps here and may take the camera
  const tiny = hooks.hidden || hooks.covered;   // behind the story's prologue or a solid title: see WARM
  if (tiny && (!cctvSettled || (warm >= WARM.frames && now - warmFrom >= WARM.ms))) return;
  if (tiny) {
    if (!warm++) warmFrom = now;
    renderer.setViewport(0, 0, 1, 1);
    renderer.setScissor(0, 0, 1, 1);
    renderer.setScissorTest(true);
  }
  controls.step(dt);
  for (const key of switchKeys) key.material.color.copy(key.userData.scene === controls.scene ? KEY_ON : KEY_OFF);
  perfStep('sky + sea', () => outdoor.update(dt));
  if (vessel) perfStep('vessel', () => vessel.update(dt, outdoor));
  if (birds) perfStep('seabirds', () => birds.tick(dt, outdoor));
  renderer.toneMappingExposure = outdoor.light.exposure;
  room.setLights(controls.ceiling * FULL_LIGHT, controls.screens ? 1 : 0);
  if (room.curtains) {
    if (room.curtains.open !== controls.curtains) room.curtains.set(controls.curtains);
    room.curtains.step(dt);
  }
  for (const [name, l] of Object.entries(lamps)) {
    l.w += ((l.on ? 1 : 0) - l.w) * Math.min(1, dt * 12); // a quick fade, like a bulb
    room.setLamp(name, l.w);
  }
  perfStep('daylight + sun shadow', () => room.setDaylight(outdoor.light, now / 1000));
  room.setClock(outdoor.state.time); // the wall clock runs with the screens off too
  if (controls.screens) perfStep('screens', () => room.updateScreens(now / 1000, outdoor.cctv));
  if (controls.screens && cctv) perfStep('cctv', () => cctv.update(now / 1000, room.feedsShown(), room.focusedFeed()));
  outdoor.render(renderer, camera, { reflect: hooks.reflect.length ? [scene, ...hooks.reflect] : scene });   // the vessel mirrored in the sea
  renderer.render(scene, camera);
  for (const f of hooks.render) f(renderer, camera); // the story's own lit pass (characters), over the same depth
  if (tiny) {
    renderer.getSize(fullSize);
    renderer.setViewport(0, 0, fullSize.x, fullSize.y);
    renderer.setScissor(0, 0, fullSize.x, fullSize.y);
    renderer.setScissorTest(false);
  }
  if (panelOpen) showFrameTime(frame);
});

// For automated screenshots: put the player somewhere and act without a mouse
window.__game = {
  play() { playing = true; ui.overlay.hidden = true; },
  place(bx, by, lookX, lookY, pitch = -0.1) { player.seat = null; player.pos.set(bx, EYE, -by); lookAt(lookX, lookY); player.pitch = pitch; },
  look(yaw, pitch) { player.yaw += yaw; player.pitch = pitch; },
  nudge(yaw) { player.yaw += yaw; },
  aim(name, up = 0.05) {
    const p = room.root.getObjectByName(name).getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, up, 0)).sub(player.pos);
    player.yaw = Math.atan2(-p.x, -p.z);
    player.pitch = Math.atan2(p.y, Math.hypot(p.x, p.z));
  },
  interact, controls, closePanel, tap, zoomIn, zoomOut,
  get zoom() { return zoom && { name: zoom.name, k: zoom.k }; },
  get target() { return target; },
  get panelOpen() { return panelOpen; },
  spin() { const c = player.seat ?? target?.item; if (c?.omega !== undefined) spin(c, 1); },
  lamps,
  get state() { return { pos: player.pos.toArray(), seated: Boolean(player.seat), target: target?.kind ?? null, busy: Boolean(player.busy) }; },
  blocked: (bx, by) => blocked(bx, -by),
  set fullLight(k) { FULL_LIGHT = k; },
  outdoor(changes) { outdoor.set(changes); },
  // For story mode (src/story/): the room and everything in it, and a way
  // to hand the controls back to the player at a given spot
  hooks, renderer, scene, camera, player, chairs, ready: null,
  get room() { return room; }, get outdoor3() { return outdoor; }, get vessel() { return vessel; }, get birds() { return birds; },
  get playing() { return playing; },
  free(pos, yaw, pitch) {
    zoomEnd();
    player.seat = null;
    player.pos.set(pos.x, EYE, pos.z);
    player.yaw = yaw; player.pitch = pitch;
    clearSpawn();
    start();
  },
  stop() { if (zoom) zoomEnd(); playing = false; keys.clear(); if (document.pointerLockElement) document.exitPointerLock(); },
  sit, standUp, lookAt, toast,
};

window.__game.ready = load();
window.__game.ready.catch((err) => { ui.intro.textContent = err.message; ui.go.textContent = 'Could not load'; console.error(err); });
