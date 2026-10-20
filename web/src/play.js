// First-person walk around the control room: walk with WASD and the mouse,
// sit in an operator chair and spin it, drink the coffee on the desks, and
// run the room from the desk touch panels and the light switch by the door.
//
// Collision is 2D, on the floor plan the bake exports (meta.layout, in
// Blender's X/Y). glTF swaps axes, so Blender (x, y) is three's (x, -z).
import * as THREE from 'three';
import { loadControlRoom, SKY } from './controlScene.js';
import { RoomControls } from './roomControls.js';

const EYE = 1.65;          // standing eye height, m
const SEATED_EYE = 1.18;
const BODY = 0.28;         // player radius for collisions
const WALK = 1.5, RUN = 3.0; // m/s
const REACH = 1.9;         // how far away things can be used, m
const SIPS = 5, SIP_DROP = 0.011; // coffee level per sip, m
const CHAIR_R = 0.34;
const LOOK = 0.0022;       // radians per pixel of mouse movement

const $ = (id) => document.getElementById(id);
const ui = {
  game: $('game'), canvas: $('view'), overlay: $('overlay'), go: $('go'), intro: $('intro'),
  prompt: $('prompt'), toast: $('toast'), crosshair: $('crosshair'), summary: $('summary'),
  stick: $('stick'), useBtn: $('useBtn'), spinBtn: $('spinBtn'),
  tp: $('tp'), tpClose: $('tpClose'),
};
const controls = new RoomControls({
  scenes: [...document.querySelectorAll('[data-scene]')], light: $('tpLight'), lightOut: $('tpLightOut'),
  volume: $('tpVolume'), volumeOut: $('tpVolumeOut'), setpoint: $('tpSetpoint'), temp: $('tpTemp'),
  warmer: $('tpWarmer'), cooler: $('tpCooler'),
});
const coarse = matchMedia('(pointer: coarse)').matches;
if (coarse) ui.game.classList.add('coarse');

const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = SKY.clone();
const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.03, 500);
camera.rotation.order = 'YXZ';

const player = {
  pos: new THREE.Vector3(1.6, EYE, 1.8), // three coordinates; feet at y = 0, eye at pos.y
  vel: new THREE.Vector3(), yaw: 0, pitch: -0.08, bob: 0,
  seat: null,   // the chair we're sitting in
  busy: null,   // the drinking animation, while it runs
};
const keys = new Set();
const touch = { move: new THREE.Vector2() };
let room, layout, playing = false, panelOpen = false;
const chairs = [], mugs = [], pickables = [];
const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
let target = null; // { kind: 'chair' | 'mug' | 'panel' | 'switch', item }

// ---------------------------------------------------------------- loading

async function load() {
  room = await loadControlRoom(renderer);
  layout = room.meta.layout;
  if (!layout) throw new Error('This scene was baked before the walk-around existed. Reload the page; if that does not help, re-run blender/bake_control_room.py.');
  scene.add(room.root);
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
  for (const c of chairs) { c.obj.userData.item = { kind: 'chair', item: c }; pickables.push(c.obj); }
  for (const m of mugs) {
    m.obj.userData.item = { kind: 'mug', item: m };
    pickables.push(m.obj);
    if (m.coffee) { m.coffee.userData.item = m.obj.userData.item; pickables.push(m.coffee); }
  }
  for (const name of room.meta.movable ?? []) {
    const obj = root.getObjectByName(name);
    if (name.endsWith('TouchPanel')) {
      obj.userData.item = { kind: 'panel', item: obj };
      obj.add(panelScreen());
      pickables.push(obj);
    } else if (name.endsWith('LightPanel')) {
      obj.userData.item = { kind: 'switch', item: obj };
      pickables.push(obj);
    }
  }
  pickables.push(root.getObjectByName('Room')); // so walls and desks block the view of things behind them
  lookAt(-0.6, 2.2);
  ui.go.disabled = false;
  ui.go.textContent = coarse ? 'Tap to start' : 'Click to start';
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

// Is a body of radius BODY at three (x, z) inside anything solid?
function blocked(x, z) {
  const bx = x, by = -z;
  const [x0, y0, x1, y1] = layout.room;
  if (bx < x0 + BODY || bx > x1 - BODY || by < y0 + BODY || by > y1 - BODY) return true;
  const r = Math.hypot(bx, by), a = Math.atan2(bx, by);
  const spread = BODY / Math.max(r, 0.5);
  for (const c of layout.desks) {
    if (Math.abs(a - c) <= layout.deskHalf + spread) {
      const ac = Math.max(c - layout.deskHalf, Math.min(c + layout.deskHalf, a));
      if (r > rFront(ac) - BODY && r < layout.rBack + BODY) return true;
    }
  }
  if (Math.abs(a) <= layout.wallHalf + spread && r > layout.wallR - 0.1 - BODY && r < layout.wallR + 0.15 + BODY) return true;
  const [tx, ty, trx, try_] = layout.table;
  if (((bx - tx) / (trx + BODY)) ** 2 + ((by - ty) / (try_ + BODY)) ** 2 < 1) return true;
  for (const c of chairs) {
    if (c === player.seat) continue;
    if (Math.hypot(x - c.obj.position.x, z - c.obj.position.z) < CHAIR_R + BODY) return true;
  }
  return false;
}

// Move by (dx, dz), sliding along whatever is in the way
function move(dx, dz) {
  const p = player.pos;
  if (!blocked(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return; }
  if (!blocked(p.x + dx, p.z)) p.x += dx;
  else if (!blocked(p.x, p.z + dz)) p.z += dz;
}

// ------------------------------------------------------------ interaction

const center = new THREE.Vector2(0, 0);
function findTarget() {
  if (player.busy) return null;
  raycaster.setFromCamera(center, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0];
  const item = hit?.object.userData.item;
  if (!item) return null;
  return item;
}

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
  'Ahh. Strong enough to see you through to the morning handover.',
  'Lukewarm, but it does the job.',
  'Someone made this at midnight. You can tell.',
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
  playing = false;
  keys.clear();
  ui.overlay.hidden = false;
  ui.go.textContent = 'Click to continue';
}

function interact() {
  if (player.busy || panelOpen) return;
  if (target?.kind === 'mug') return drink(target.item);
  if (target?.kind === 'panel') return openPanel();
  if (target?.kind === 'switch') return toast(`Ceiling lights: ${controls.nextScene()}`);
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

  if (player.seat) {
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
  camera.updateMatrixWorld();

  if (player.busy) drinking(dt);

  target = playing ? findTarget() : null;
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
  else if (player.seat) { use = 'Stand up'; spinOk = true; }
  else if (target?.kind === 'chair') { use = 'Sit'; spinOk = true; }
  if (use) text = `<kbd>E</kbd>${use}`;
  if (spinOk) text += player.seat ? '&nbsp;&nbsp;<kbd>A</kbd><kbd>D</kbd>Spin' : '&nbsp;&nbsp;<kbd>Click</kbd>Spin';
  if (player.busy || panelOpen) text = '';
  if (ui.prompt.innerHTML !== text) ui.prompt.innerHTML = coarse ? '' : text;
  ui.crosshair.classList.toggle('on', Boolean(use));
  ui.useBtn.hidden = !use || Boolean(player.busy);
  ui.useBtn.textContent = use;
  ui.spinBtn.hidden = !spinOk;
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
  keys.add(e.code);
  if (e.code === 'KeyE' && !e.repeat) interact();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

ui.canvas.addEventListener('mousemove', (e) => {
  if (!playing || coarse) return;
  if (document.pointerLockElement !== ui.canvas && !(dragLook && e.buttons & 1)) return;
  player.yaw -= e.movementX * LOOK;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - e.movementY * LOOK));
});
ui.canvas.addEventListener('mousedown', (e) => {
  if (!playing || coarse || panelOpen || e.button !== 0) return;
  const c = player.seat ?? (target?.kind === 'chair' ? target.item : null);
  if (c) spin(c);
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
ui.canvas.addEventListener('pointerdown', (e) => { if (coarse) looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
ui.canvas.addEventListener('pointermove', (e) => {
  const last = looks.get(e.pointerId);
  if (!last || !playing) return;
  player.yaw -= (e.clientX - last.x) * 0.005;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - (e.clientY - last.y) * 0.005));
  looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
const lookEnd = (e) => looks.delete(e.pointerId);
ui.canvas.addEventListener('pointerup', lookEnd);
ui.canvas.addEventListener('pointercancel', lookEnd);
ui.useBtn.addEventListener('click', interact);
ui.spinBtn.addEventListener('click', () => { const c = player.seat ?? target?.item; if (c?.omega !== undefined) spin(c); });

new ResizeObserver(() => {
  const w = ui.game.clientWidth, h = ui.game.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe(ui.game);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!room) return;
  update(dt);
  controls.step(dt);
  room.setLights(controls.ceiling, 1);
  room.updateScreens(now / 1000);
  const summary = controls.summary();
  if (ui.summary.textContent !== summary) ui.summary.textContent = summary;
  renderer.render(scene, camera);
});

// For automated screenshots: put the player somewhere and act without a mouse
window.__game = {
  play() { playing = true; ui.overlay.hidden = true; },
  place(bx, by, lookX, lookY, pitch = -0.1) { player.seat = null; player.pos.set(bx, EYE, -by); lookAt(lookX, lookY); player.pitch = pitch; },
  look(yaw, pitch) { player.yaw += yaw; player.pitch = pitch; },
  aim(name, up = 0.05) {
    const p = room.root.getObjectByName(name).getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, up, 0)).sub(player.pos);
    player.yaw = Math.atan2(-p.x, -p.z);
    player.pitch = Math.atan2(p.y, Math.hypot(p.x, p.z));
  },
  interact, controls, closePanel,
  get panelOpen() { return panelOpen; },
  spin() { const c = player.seat ?? target?.item; if (c?.omega !== undefined) spin(c, 1); },
  get state() { return { pos: player.pos.toArray(), seated: Boolean(player.seat), target: target?.kind ?? null, busy: Boolean(player.busy) }; },
  blocked: (bx, by) => blocked(bx, -by),
};

load().catch((err) => { ui.intro.textContent = err.message; ui.go.textContent = 'Could not load'; console.error(err); });
