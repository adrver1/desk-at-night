// The optional opening at the heliport before the flight (?sola=1): about
// twenty seconds on the apron in the morning, the helicopter idling on its
// stand, the crew walking out of the gate in survival suits, and by the
// fence a pallet of chemical IBCs, just cargo in the background for now. They
// board the way the intro's #board scene has them (up the step holding the
// door post, bent along the aisle, sit down), into the seats they fly in.
// The title runs here; the credits follow in the cabin flight (intro.html).
// The music starts here and runs on through the flight (main.js).
//
// The same spot comes back as two stills (?solastills): in Act 1 the
// pallet is still waiting, in Act 3 it has gone.
//
// The apron is blender/sola_apron.py; the helicopter, its pilots and the
// passengers are the intro's. Three's axes: Blender (x, y, z) is (x, z, -y),
// so north is -z; the helicopter parks nose north on the origin.
import * as THREE from 'three';
import { Helicopter } from '../helicopter.js';
import { loadGltf } from './cast.js';

export const LENGTH = 27;   // s, from black to the hand-over to the cabin
const WALK = 1.25;   // m/s, the walk clip's pace (intro.js)
// The intro's cast and seats [row, place], so everyone flies where they boarded
const CREW = ['blazer_lead', 'bearded_operator', 'crop_supervisor', 'curly_analyst', 'curly_fade_tech', 'glasses_engineer', 'grey_beard_lead'];
const SEATING = [[0, 1], [0, 2], [0, 3], [1, 2], [2, 1], [2, 2], [3, 1]];
const GAP = 2.5;     // m between passengers on the walkway
const LEAD = 24.5;   // m along the walkway the first one is at t = 0 (at the helicopter by ~15 s)
// The walkway from the departures door through the gate to the stand, as
// painted by sola_apron.py; the last leg to the cabin door comes from intro.json
const PATH = [[-12, 38], [-12, 32.5], [-12, 14], [-4.5, 6]].map(([x, z]) => new THREE.Vector3(x, 0, z));
const SIDE = -1;     // the west door (the helicopter's left): local -z
const STEP_UP = 1.3, SIT = 1.5;   // s (intro.js)
const DUCK_CABIN = 0.45, DUCK_DOOR = 1.25;
const BEND = [['spine', 0.45], ['chest', 0.45], ['neck', -0.25]];
const KNEE = 0.35 / DUCK_DOOR;

// Shots: [from, to] for the camera and what it looks at, over [t0, t1]
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const SHOTS = [
  { t: [0, 7], pos: [v(24, 2.4, 16), v(20, 2.1, 13.5)], at: [v(-22, 5, -8), v(-20, 4.4, -7)], fov: 48 },   // the apron: the helicopter turning, SOLA HELIPORT on the hangar
  { t: [7, 14], pos: [v(16, 1.6, 31), v(14.5, 1.6, 31.3)], at: [v(-5.2, 1.4, 17.8), v(-6, 1.4, 18.5)], fov: 50 },  // along the fence: the pallet, the crew, the helicopter beyond
  { t: [14, LENGTH], pos: [v(-9.5, 1.75, 3.2), v(-8, 1.65, 1.8)], at: [v(-1.6, 1.35, -0.8), v(-1.4, 1.4, -0.9)], fov: 46 },   // at the door: boarding
];
const STILL = { pos: [v(16, 1.6, 31), v(15.3, 1.6, 31.1)], at: [v(-6.6, 1.4, 20.4), v(-6.8, 1.4, 20.6)], fov: 50 };   // as the fence shot, turned a little toward the pallet
export const STILLS = {
  full: ['Meanwhile at Sola heliport', 'Four IBCs, still by the fence'],
  empty: ['Sola heliport · the same spot', 'The pallet has gone'],
};

export class Sola {
  // open: play the apron scene before the flight; stills: the callbacks in Acts 1 and 3
  constructor(game, { open = true } = {}) {
    this.game = game;
    this.open = open;
    this.done = !open;
    this.playing = false;
    this.on = false;
    this.t = 0;
    this.scene = new THREE.Scene();
    this.scene.name = 'sola heliport';   // names the pass in the perf overlay
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 6000);
    this.loaded = null;
  }

  load() {
    this.loaded ??= (async () => {
      const [apron, heli, pilot, info, anims, ...crew] = await Promise.all([
        loadGltf('story/sola/sola.glb'), loadGltf('intro/heli.glb'), loadGltf('intro/chars/heli_pilot_flying_headset.glb').catch(() => null),
        fetch('intro/intro.json').then((r) => r.json()), loadGltf('intro/chars/anims.glb').catch(() => null),
        ...CREW.map((c) => loadGltf(`intro/chars/${c}_survival.glb`).catch(() => null)),
      ]);
      // Everybody plays the one clip set in anims.glb (web/scripts/pack_chars.mjs)
      // unless a model brings its own, and shares one palette material
      for (const m of [pilot, ...crew]) if (m && !m.animations.length) m.animations = anims?.animations ?? [];
      let palette = null;
      const share = (root) => root.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        palette ??= o.material;
        if (o.material === palette || o.material.name !== palette.name) return;
        o.material.map?.dispose();
        o.material.dispose();
        o.material = palette;
      });
      const s = this.scene;
      // A clear spring morning: blue overhead, hazy at the horizon
      const sky = document.createElement('canvas');
      sky.width = 2; sky.height = 256;
      const g = sky.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#5d8fc4'); grad.addColorStop(0.55, '#a9c6de'); grad.addColorStop(1, '#dfe6e6');
      g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
      s.background = new THREE.CanvasTexture(sky);
      s.background.colorSpace = THREE.SRGBColorSpace;
      s.fog = new THREE.Fog(0xd5dfe3, 250, 1600);
      s.add(new THREE.HemisphereLight(0xd6e6f5, 0x7a7a66, 1.4));
      const sun = new THREE.DirectionalLight(0xffe2bd, 3.2);
      sun.position.set(60, 38, 40);   // low in the south-east
      sun.castShadow = true;
      Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0005;
      s.add(sun, sun.target);
      this.game.renderer.shadowMap.enabled = true;

      apron.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.receiveShadow = true;
        o.castShadow = o.name !== 'SolaApron';   // the ground and buildings only take shadows
        if (o.material.name === 'SolaFenceMesh') Object.assign(o.material, { transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
        if (o.material.name === 'SolaTank') this.tank = o.material;   // see-through in the stills (show)
      });
      s.add(apron.scene);
      this.pallet = apron.scene.getObjectByName('SolaPallet');
      this.sock = apron.scene.getObjectByName('SolaSock');

      // The helicopter on its stand, nose north, rotors turning, doors open
      const h = new THREE.Group();
      h.rotation.y = Math.PI / 2;
      h.add(heli.scene);
      // Only the outside casts: the cabin's insides sit in the hull's shadow anyway, and the glass lets the sun through (as intro.js)
      const inside = ['HeliCabin', 'HeliFloor', 'HeliSeat', 'HeliPanel', 'HeliLining', 'HeliScreen', 'HeliGround', 'HeliMapScreen', 'HeliCabinLamp', 'HeliClear'];
      heli.scene.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = !inside.includes(o.material.name); } });
      this.rotor = new Helicopter(heli.scene, { running: true });
      this.rotor.setDoors(true);
      this.rotor.door = this.rotor.doorTarget = 1;
      if (pilot) {
        share(pilot.scene);
        for (const [i, at] of (info.pilots ?? []).entries()) {
          const p = i ? (await import('three/addons/utils/SkeletonUtils.js')).clone(pilot.scene) : pilot.scene;
          p.rotation.y = -Math.PI / 2;
          p.position.set(at[0], at[1] - 0.45, at[2]);
          const mixer = new THREE.AnimationMixer(p);
          const clip = THREE.AnimationClip.findByName(pilot.animations, 'flying');
          if (clip) mixer.clipAction(clip).play();
          mixer.setTime(i * 1.7);
          h.add(p);
          (this.mixers ??= []).push(mixer);
        }
      }
      s.add(h);
      this.heli = h;

      // The crew, children of the helicopter so the cabin part of the route
      // is in its frame: the walkway turned into that frame, then the foot of
      // the step, the sill, the aisle and the seat, as intro.js route()
      h.updateMatrixWorld(true);
      const walkway = PATH.map((q) => h.worldToLocal(q.clone()));
      const doorX = info.door.exit, floor = info.floor, deck = 0;
      this.crew = crew.map((gltf, i) => {
        if (!gltf) return null;
        const p = gltf.scene;
        share(p);
        const [row, place] = SEATING[i], sd = info.seats[row * 4 + place];
        const seat = new THREE.Vector3(sd[0], sd[1], sd[2]), face = sd[3];
        const up = new THREE.Vector3(seat.x + face * 0.35, floor, seat.z);
        const outside = [...walkway, new THREE.Vector3(doorX + 1.2, deck, SIDE * 3.2), new THREE.Vector3(doorX, deck, SIDE * 1.75)];
        const inside = [new THREE.Vector3(doorX, floor, SIDE * 1.15), new THREE.Vector3(doorX, floor, SIDE * 0.8), new THREE.Vector3(doorX, floor, SIDE * 0.4),
          new THREE.Vector3(up.x, floor, SIDE * 0.05), up];
        const mixer = new THREE.AnimationMixer(p);
        const act = Object.fromEntries(['seated_idle', 'stand_up', 'walk', 'blink', 'idle'].map((n) => {
          const clip = THREE.AnimationClip.findByName(gltf.animations, n);
          return [n, clip && mixer.clipAction(clip)];
        }));
        for (const k of ['stand_up', 'blink']) if (act[k]) { act[k].setLoop(THREE.LoopOnce); act[k].clampWhenFinished = k !== 'blink'; }
        const bones = {};
        p.traverse((o) => {
          if (o.isBone) bones[o.name] = o;
          if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
        });
        h.add(p);
        return { p, mixer, act, bones, seat, face, outside, inside, cast: CREW[i],
          hipsUp: bones.hips ? bones.hips.position.clone().normalize() : new THREE.Vector3(0, 1, 0), duck: 0, ducked: 0, grab: false, grabbed: 0, lift: null };
      }).filter(Boolean);
      // Farthest seat from the door first, so nobody climbs over anybody
      const far = (c) => Math.abs(c.seat.x - doorX) + (Math.sign(c.seat.z) === SIDE ? 0 : 0.5);
      [...this.crew].sort((a, b) => far(b) - far(a)).forEach((c, k) => { c.start = LEAD - k * GAP; });
      this.post = new THREE.Vector3(info.door.x[1] + 0.04, floor + 1.15, SIDE * 1.2);   // the door's front post, for a hand
    })();
    return this.loaded;
  }

  // The apron scene; resolves when it has played (or was skipped)
  async play(host, ui, say) {
    if (this.playing) return this.running;   // asked twice (Begin while the chapter is entering): one opening
    this.running = this.run(host, ui, say);
    return this.running;
  }

  async run(host, ui, say) {
    this.host = host; this.ui = ui;
    this.done = false;
    this.playing = true;
    this.black = Object.assign(document.createElement('div'), { className: 'blackout on' });
    host.append(this.black);
    await this.load().catch((e) => { console.warn('sola', e); });
    if (!this.playing || !this.heli) { this.finish(); return; }
    this.mode = 'open';
    this.show();
    this.cues = new Set();
    this.say = say;
    this.sound?.rotor(0.08, 2.5);
    if (this.music) this.sound?.music(this.music);   // runs on through the flight (main.js)
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  // A still of the pallet's spot: 'full' or 'empty'
  async still(kind, ui) {
    this.ui = ui;
    this.mode = 'still';
    this.kind = kind;
    await this.load().catch(() => {});
    if (this.mode !== 'still' || this.kind !== kind) return;
    this.show();
    ui.credit(STILLS[kind]);
  }

  show() {
    this.on = true;
    this.t = 0;
    this.t0 = performance.now();
    this.game.hooks.hidden = true;   // the room stops drawing; we draw instead
    const opening = this.mode === 'open';
    this.heli.visible = opening;
    for (const c of this.crew) this.reset(c, opening);
    this.pallet.visible = opening || this.kind === 'full';
    // In the act stills the chemical shows through the IBCs; the opening
    // leaves them as plain cargo by the fence
    if (this.tank) Object.assign(this.tank, opening ? { transparent: false, opacity: 1, depthWrite: true } : { transparent: true, opacity: 0.5, depthWrite: false });
    if (this.tank) this.tank.needsUpdate = true;
  }

  skip() {
    if (this.mode === 'open' && this.playing) this.t0 = Math.min(this.t0, performance.now() - (LENGTH - 1.2) * 1000);
  }

  finish() {
    this.playing = false;
    this.done = true;
    this.sound?.rotor(0, 1);
    this.ui?.title(null);
    this.ui?.credit(null);
    this.black?.remove();
    this.black = null;
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  hide() {
    if (this.mode === 'still') this.ui?.credit(null);
    if (this.playing) { this.on = false; this.finish(); }
    if (this.on) this.game.hooks.hidden = false;
    this.on = false;
    this.mode = null;
  }

  update(dt) {
    if (!this.on) return;
    this.t = (performance.now() - this.t0) / 1000;   // wall clock, like the epilogue
    const t = this.t;
    this.rotor?.update(dt);
    for (const m of this.mixers ?? []) m.update(dt);
    if (this.sock) this.sock.rotation.y = 0.6 + 0.08 * Math.sin(t * 0.9);   // a light breeze from the south-west
    let pose;
    if (this.mode === 'open') {
      this.crewAt(t, dt);
      this.cuesAt(t);
      const shot = SHOTS.find((s) => t < s.t[1]) ?? SHOTS.at(-1);
      pose = this.pose(shot, THREE.MathUtils.clamp((t - shot.t[0]) / (shot.t[1] - shot.t[0]), 0, 1));
      if (t >= LENGTH) { this.finish(); return; }
    } else pose = this.pose(STILL, Math.min(1, t / 10));
    const cam = this.camera, r = this.game.renderer;
    cam.position.copy(pose.pos);
    cam.lookAt(pose.at);
    cam.fov = pose.fov;
    const size = r.getSize(new THREE.Vector2());
    cam.aspect = size.x / size.y;
    cam.updateProjectionMatrix();
    const exposure = r.toneMappingExposure;
    r.toneMappingExposure = 1;
    r.render(this.scene, cam);
    r.toneMappingExposure = exposure;
  }

  pose(shot, k) {
    const e = k * k * (3 - 2 * k) * 0.6 + k * 0.4;   // a slow drift, eased a little
    return { pos: shot.pos[0].clone().lerp(shot.pos[1], e), at: shot.at[0].clone().lerp(shot.at[1], e), fov: shot.fov };
  }

  reset(c, on) {
    c.p.visible = on;
    Object.assign(c, { state: 'walk', leg: 0, duck: 0, ducked: 0, grab: false, grabbed: 0, lift: null });
    c.mixer.stopAllAction();
    c.act.walk?.play();
    c.mixer.setTime(Math.random() * 2);
  }

  // The point d metres along a polyline, turning the person along it; true past its end
  along(c, pts, d, dt) {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k], l = a.distanceTo(b);
      if (d <= l) {
        c.p.position.lerpVectors(a, b, Math.max(0, d) / l);
        c.p.rotation.y = lerpAngle(c.p.rotation.y, Math.atan2(-(b.x - a.x), -(b.z - a.z)), Math.min(1, dt * 8));
        c.leg = k - 1;
        return false;
      }
      d -= l;
    }
    c.p.position.copy(pts.at(-1));
    return true;
  }

  // intro.js embark(), in short: walk out, up the step holding the post,
  // bent along the aisle, turn round and sit (stand_up played backwards).
  // Placed by the wall clock, so a slow frame rate or a skip never stalls it
  crewAt(t, dt) {
    for (const c of this.crew) {
      if (c.state === 'walk') {
        c.duck = 0;
        if (this.along(c, c.outside, c.start + WALK * t, dt)) {
          Object.assign(c, { state: 'stepup', at: t });
          c.p.rotation.y = Math.atan2(0, Math.sign(c.inside[0].z));   // facing the door
          c.act.idle?.reset().play();
          if (c.act.idle) c.act.walk?.crossFadeTo(c.act.idle, 0.25, false);
        }
      }
      if (c.state === 'stepup') {
        const k = THREE.MathUtils.clamp((t - c.at) / STEP_UP, 0, 1), ss = THREE.MathUtils.smoothstep;
        const from = c.outside.at(-1), to = c.inside[0], stepY = from.y + 0.5;
        c.p.position.lerpVectors(from, to, 0.45 * ss(k, 0.1, 0.45) + 0.55 * ss(k, 0.55, 0.92));
        c.p.position.y = from.y + (stepY - from.y) * ss(k, 0.15, 0.45) + (to.y - stepY) * ss(k, 0.6, 0.92);
        const bump = (a, b) => Math.sin(Math.PI * THREE.MathUtils.clamp((k - a) / (b - a), 0, 1));
        c.lift = { thighR: 1.0 * bump(0.0, 0.42), thighL: 1.1 * bump(0.45, 0.9) };
        c.grab = k < 0.85;
        c.duck = k > 0.45 ? DUCK_DOOR : DUCK_CABIN * 0.6;
        if (k >= 1) {
          c.lift = null;
          c.act.walk?.reset().play();
          if (c.act.walk) c.act.idle?.crossFadeTo(c.act.walk, 0.25, false);
          Object.assign(c, { state: 'aisle', at: t, grab: false });
        }
      }
      if (c.state === 'aisle') {
        const done = this.along(c, c.inside, WALK * (t - c.at), dt);
        c.duck = c.leg < 2 ? DUCK_DOOR : DUCK_CABIN;
        if (done) {
          Object.assign(c, { state: 'sitting', at: t, from: c.p.position.clone(), turnFrom: c.p.rotation.y });
          const su = c.act.stand_up;
          if (su) { su.reset(); su.timeScale = -1; su.time = su.getClip().duration; su.play(); c.act.walk?.crossFadeTo(su, 0.3, false); }
        }
      }
      if (c.state === 'sitting') {
        const s = t - c.at, k = THREE.MathUtils.smoothstep(s, 0.1, SIT - 0.3);
        c.p.rotation.y = lerpAngle(c.turnFrom, -c.face * Math.PI / 2, Math.min(1, s / 0.5));
        c.p.position.lerpVectors(c.from, new THREE.Vector3(c.seat.x, c.seat.y - 0.45, c.seat.z), k);
        c.duck = DUCK_CABIN + 0.45 * Math.sin(Math.PI * THREE.MathUtils.clamp(s / SIT, 0, 1)) - DUCK_CABIN * k;
        if (s >= SIT) {
          c.state = 'seated';
          c.duck = 0;
          c.act.seated_idle?.reset().play();
          if (c.act.seated_idle) c.act.stand_up?.crossFadeTo(c.act.seated_idle, 0.4, false);
        }
      }
      this.unbend(c);
      c.mixer.update(dt);
      this.bend(c, dt);
    }
  }

  // Ducking on top of the clips (intro.js pose/bend/arms): bent at spine and
  // chest, head kept up, knees bent and hips sunk; at the door a hand on the post
  posture(c, k) {
    const b = c.bones, d = c.ducked * k, q = c.ducked * KNEE * k;
    const L = k > 0 ? (c.liftOn = c.lift && { ...c.lift }) : c.liftOn;
    for (const [n, f] of BEND) b[n]?.rotateX(-d * f);
    for (const n of ['thighL', 'thighR']) b[n]?.rotateX(q + (L?.[n] ?? 0) * k);
    for (const n of ['shinL', 'shinR']) b[n]?.rotateX(-2 * q - 1.3 * (L?.[n.replace('shin', 'thigh')] ?? 0) * k);
    if (b.hips) b.hips.position.addScaledVector(c.hipsUp, -0.84 * (1 - Math.cos(c.ducked * KNEE)) * k);
  }

  unbend(c) { if (c.bones.spine) this.posture(c, -1); }

  bend(c, dt) {
    if (!c.bones.spine || !c.bones.chest) return;
    c.ducked += (c.duck - c.ducked) * Math.min(1, dt * 5);
    c.grabbed += ((c.grab ? 1 : 0) - c.grabbed) * Math.min(1, dt * 6);
    this.posture(c, 1);
    const b = c.bones, w = Math.min(1, c.ducked / DUCK_CABIN) * 0.85;
    if (w <= 0.01) return;
    const qw = c.p.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(qw), r = new THREE.Vector3(1, 0, 0).applyQuaternion(qw);
    const post = this.heli.localToWorld(this.post.clone()), sh = c.p.getWorldPosition(new THREE.Vector3());
    const R = post.clone().sub(sh).dot(r) > 0, g = c.grabbed > 0.01;
    aimBone(b.upper_armL, new THREE.Vector3(0, -1, 0).addScaledVector(f, 0.35).addScaledVector(r, -0.15), w * (R ? 1 : 1 - c.grabbed));
    aimBone(b.upper_armR, new THREE.Vector3(0, -1, 0).addScaledVector(f, 0.35).addScaledVector(r, 0.15), w * (R ? 1 - c.grabbed : 1));
    const arm = R ? b.upper_armR : b.upper_armL, fore = R ? b.forearmR : b.forearmL;
    if (g && arm) {
      arm.getWorldPosition(sh);
      aimBone(arm, post.sub(sh).addScaledVector(r, R ? 0.1 : -0.1), c.grabbed);
      if (fore) fore.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35), c.grabbed);
    }
  }

  cuesAt(t) {
    const cue = (name, at, fn) => { if (t >= at && !this.cues.has(name)) { this.cues.add(name); fn(); } };
    cue('in', 0.4, () => this.black?.classList.remove('on'));
    cue('title', 1.5, () => this.ui.title({ text: this.titleText }));
    cue('title-off', 7, () => this.ui.title(null));
    cue('crew1', 7.6, () => this.say?.('sola.crew1'));
    cue('crew2', 14.6, () => this.say?.('sola.crew2'));
    cue('rotor-near', 14, () => this.sound?.rotor(0.13, 1));   // at the door, close to it
    cue('out', LENGTH - 1.2, () => this.black?.classList.add('on'));
  }
}

const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// Turn bone so its length (+Y) points along world direction dir, by w (intro.js)
function aimBone(bone, dir, w) {
  if (!bone || w <= 0) return;
  bone.updateWorldMatrix(true, false);
  const q = bone.getWorldQuaternion(new THREE.Quaternion());
  const along = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const turn = new THREE.Quaternion().setFromUnitVectors(along, dir.clone().normalize());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.slerp(pq.invert().multiply(turn).multiply(q), Math.min(1, w));
}
