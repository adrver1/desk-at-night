// The people in the room for story mode: the low-poly cast (characters/,
// copied to public/story/chars/) placed at named spots, sitting
// or standing, blinking, talking while their line plays (the jaw follows the
// line's loudness track from voices.py), and turning their head to the camera.
//
// They are lit, unlike the baked room, so they get their own scene and lights
// and are drawn after the room over the same depth buffer (play.js
// hooks.render), which keeps these lights off the supply vessel.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OVERRIDES, PRIVATE_BASE } from '../privateNames.js';

const BASE = 'story/chars/';
// Who is who: the speaker ids of content.js, plus the CEO's silent cameo.
// Offshore everyone wears PPE, visitors too: the 'ppe' look (?outfit=office
// for the everyday clothes). Callers on the video link are onshore and keep
// their everyday look (call.js)
export const OUTFIT = new URLSearchParams(location.search).get('outfit') ?? 'ppe';
export const MODELS = {
  operator: 'bearded_operator', supervisor: 'blazer_lead', oim: 'grey_beard_lead', ceo: 'glasses_ceo',
};

// Spots in three's axes: [x, z, facing], facing a point [x, z] or a yaw.
// Chair spots follow the chairs (play.js moves nothing; we may move Chair1).
const TABLE = [2.15, 2.35];
export const SPOTS = {
  desk0: { chair: 0 },
  desk0typing: { chair: 0, pose: 'typing' },
  desk2: { chair: 1 },
  desk2typing: { chair: 1, pose: 'typing' },
  besideDesk: { chair: 1, move: [-0.42, -1.12, 0.25] },   // Chair1 pulled up beside our desk, at [x, z, yaw]
  besideYou: { at: [0.1, -0.75], face: 'player' },
  behind: { at: [0.45, -0.2], face: 'player' },
  behindCeo: { at: [1.05, 0.25], face: 'player' },
  tableHead: { at: [0.95, 2.35], face: TABLE },
  table1: { at: [1.75, 1.6], face: TABLE },
  table2: { at: [2.55, 1.6], face: TABLE },
  table3: { at: [3.3, 2.0], face: TABLE },
  tableBand: { at: [1.3, 1.5], face: [0, -4] },   // at the meeting table, turned to the band (the supervisor, tomorrow)
  door: { at: [4.75, 2.3], face: [0, 0] },         // just in through the door in the right wall
  coffee: { at: [4.85, 4.72], face: [4.85, 6], left: [1, [4, 3.6]] },   // at the coffee machine in the rest corner; his chair left turned toward it
};

// Tomorrow's morning (Adriaen, 2026-10-25): the walks and the coffee run, in
// three's x, z. The supervisor comes in by the door, round the meeting table to his
// chair at the left desk; Adriaen goes through the opening in the rear wall
// to the coffee machine and back with the jug to the supervisor's mug. The desks are an
// arc round the room's centre (radius 1.95 to 2.95 m, the right one reaching
// round to about x 2.9, z -0.4), so the way to the rest corner first steps back
// into the middle of the room and round the desk's end.
export const PATHS = {
  doorToDesk0: [[4.75, 2.3], [3.9, 1.05], [1.6, 0.2], [0.2, -0.45], [-0.62, -0.9]],
  desk2ToCoffee: [[1.45, -0.9], [1.5, 0.2], [3.3, 1.0], [3.9, 1.6], [4.05, 3.1], [4.15, 4.0], [4.85, 4.72]],
  coffeeToDesk0: [[4.85, 4.72], [4.15, 4.0], [4.05, 3.1], [3.6, 1.4], [1.6, 0.3], [0.3, -1.0], [-0.22, -1.62]],
  desk0ToDesk2: [[-0.22, -1.62], [0.35, -0.95], [1.55, -0.95]],
};
const STRIDE = 1.15;       // m/s the walk clip's stride covers at its own pace
const WALK_SPEED = 1.4;    // m/s, a brisk walk: the clip plays faster to match
const TURN_RATE = 5;       // rad/s, how fast someone turns into a new direction
// the yaw that faces along (dx, dz): people and chairs look down their -Z
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
// Seated idles (Adriaen, 2026-10-29): now and then someone sitting at a desk
// takes a sip from the mug beside them or wiggles the mouse. The clips are on
// the shared rig (characters/_shared/anims.py sip, sip_left, mouse); SIP_MUG
// is where the hand meets the mug in their space (three's axes, ahead is -z),
// SIP_HOLD when the hand has it (s). ?idles=0 keeps everyone still (stills).
const SIP_MUG = [0.52, 0.80, -0.58], SIP_HOLD = [20 / 24, 76 / 24];
const IDLES = new URLSearchParams(location.search).get('idles') !== '0';
const IDLE_FIRST = [2, 5], IDLE_GAP = [6, 14];   // s before the first idle, and between one and the next
const wrap = (a) => ((a % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// The coffee jug of the rest corner's machine (props._coffee_machine), to
// carry and pour: glass round a third of coffee, a black lid and handle.
// Origin at its foot, handle on +X, spout (the lip opposite) on -X
function makeJug() {
  const g = new THREE.Group();
  g.name = 'CoffeeJug';
  const lathe = (pts, mat) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 24), mat);
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 });
  const coffee = new THREE.MeshStandardMaterial({ color: 0x2a160b, roughness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xd8e4ea, roughness: 0.05, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  g.add(lathe([[0, 0], [0.062, 0], [0.066, 0.012], [0.067, 0.07], [0, 0.07]], coffee));
  g.add(lathe([[0.062, 0], [0.067, 0.04], [0.067, 0.045], [0.064, 0.085], [0.052, 0.12], [0.053, 0.13]], glass));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.056, 0.016, 24), black);
  lid.position.y = 0.138;
  g.add(lid);
  const handle = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, 0.122, 0), new THREE.Vector3(0.092, 0.118, 0), new THREE.Vector3(0.097, 0.055, 0), new THREE.Vector3(0.066, 0.025, 0)]), 12, 0.007, 6), black);
  g.add(handle);
  g.userData.grip = new THREE.Vector3(0.094, 0.09, 0);   // where the hand holds the handle
  g.userData.spout = new THREE.Vector3(-0.056, 0.13, 0);
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 1, 6).translate(0, -0.5, 0), coffee);
  stream.visible = false;
  return { jug: g, stream };
}

const loader = new GLTFLoader();
loader.register((parser) => {   // as intro.js: embedded images straight to bitmaps (no blob: URLs)
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
// The private build's own looks (overrides.json `chars`: the PPE with the real
// company logo) come from story/private/chars/
export const loadModel = (name) => loader.loadAsync(OVERRIDES.chars?.includes(name) ? `${PRIVATE_BASE}chars/${name}.glb` : `${BASE}${name}.glb`);
export const loadGltf = (url) => loader.loadAsync(url);

export class Cast {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.name = 'characters';   // names the pass in the perf overlay
    this.hemi = new THREE.HemisphereLight(0xfff6ea, 0x3a3f48, 2.2);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(0.5, 3, 1.5);
    this.scene.add(this.hemi, this.key);
    this.people = {};
    game.hooks.render.push((renderer, camera) => { if (this.visible) renderer.render(this.scene, camera); });
    this.visible = true;
  }

  async load() {
    await Promise.all(Object.entries(MODELS).map(async ([who, file]) => {
      const look = OUTFIT === 'office' ? file : `${file}_${OUTFIT}`;
      const gltf = await loadModel(look).catch(() => loadModel(file)).catch((e) => { console.warn('cast', file, e); return null; });
      if (!gltf) return;
      const p = gltf.scene;
      const mixer = new THREE.AnimationMixer(p);
      const act = Object.fromEntries(['idle', 'seated_idle', 'talk', 'blink', 'walk', 'stand_up', 'typing', 'point', 'sip', 'sip_left', 'mouse'].map((n) => {
        const clip = THREE.AnimationClip.findByName(gltf.animations, n);
        return [n, clip && mixer.clipAction(clip)];
      }));
      if (act.blink) act.blink.setLoop(THREE.LoopOnce);
      if (act.talk) { act.talk.play(); act.talk.setEffectiveWeight(0); }
      for (const n of ['stand_up', 'point', 'sip', 'sip_left', 'mouse']) if (act[n]) { act[n].setLoop(THREE.LoopOnce); act[n].clampWhenFinished = true; }
      const bones = {};
      p.traverse((o) => {
        if (o.isBone) bones[o.name] = o;
        if (o.isMesh) o.frustumCulled = false;
      });
      p.visible = false;
      this.scene.add(p);
      this.people[who] = { who, root: p, mixer, act, bones, pose: null, level: 0, mouth: null, blinkAt: Math.random() * 3, turn: 0, queue: [], task: null, at: null };
    }));
    this.chairHomes = this.game.chairs.map(({ obj: c }) => [c.position.x, c.position.z, c.rotation.y]);
    const { jug, stream } = makeJug();
    this.jug = jug; this.stream = stream;
    jug.visible = false;
    this.scene.add(jug, stream);
    this.mugsRest = {};
    for (const name of ['S0Mug', 'S1Mug']) {
      const mug = this.game.room.root.getObjectByName(name), coffee = this.game.room.root.getObjectByName(name.replace('Mug', 'Coffee'));
      if (mug && coffee) this.mugsRest[name] = { mug, coffee, y: coffee.position.y, home: mug.position.clone() };
    }
  }

  // Put everyone where `cast` ({ who: { at } }) says; those not named go
  // away. Someone already at their spot stays as they are (a `set` step in the
  // middle of a walk must not snap them back); halt() makes everyone go.
  place(cast = {}) {
    let moved = null, any = false;
    for (const [who, p] of Object.entries(this.people)) {
      const name = cast[who]?.at, spot = SPOTS[name];
      // the state's spot unchanged since we last put them there (they may have
      // walked off since, which the beat's moves are doing: a mid-beat `set`
      // re-applies the beat's start), or they have walked there by now (the
      // next beat names where the last one's moves took them): leave them be
      if ((name === p.want || name === p.at) && (p.root.visible || !spot)) { p.want = name; continue; }
      any = true;
      this.endFidget(p);
      p.at = name; p.want = name;
      p.queue.length = 0; p.task = null;
      for (const r of p.waiters ?? []) r();   // nobody waits for moves that will never come
      p.waiters = [];
      p.root.visible = Boolean(spot);
      if (p.carry && !spot) this.carry(p, null);
      if (!spot) continue;
      if (spot.chair !== undefined) {
        const c = this.game.chairs[spot.chair]?.obj;
        if (spot.move) moved = [spot.chair, spot.move];
        const [x, z, yaw] = spot.move ?? this.chairHomes[spot.chair];
        if (!spot.move) { c.position.x = x; c.position.z = z; c.rotation.y = yaw; }
        const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        p.root.position.set(x + f.x * 0.06, 0, z + f.z * 0.06);
        p.root.rotation.set(0, yaw, 0);
        this.pose(p, spot.pose ?? 'seated_idle');
      } else {
        const [x, z] = spot.at;
        const to = spot.face === 'player' ? [this.game.chairs[0].obj.position.x, this.game.chairs[0].obj.position.z] : spot.face;
        p.root.position.set(x, 0, z);
        p.root.rotation.set(0, Math.atan2(-(to[0] - x), -(to[1] - z)), 0);
        this.pose(p, spot.pose ?? 'idle');
      }
      this.carry(p, spot.carry ?? null);
    }
    if (!any) return;
    // The chairs go home, or where the operator pulled one, unless someone sits in it elsewhere
    for (const [i, home] of this.chairHomes.entries()) {
      const c = this.game.chairs[i]?.obj;
      const sat = Object.values(this.people).some((p) => p.root.visible && SPOTS[p.at]?.chair === i);
      if (!c || sat) continue;
      // left turned by someone who got up from it (a jump straight to them away)
      const left = Object.values(this.people).map((p) => p.root.visible && SPOTS[p.at]?.left).find((l) => l?.[0] === i);
      const turned = left && [home[0], home[1], yawTo(left[1][0] - home[0], left[1][1] - home[1])];
      const [x, z, yaw] = moved?.[0] === i ? moved[1] : turned ?? home;
      c.position.x = x; c.position.z = z; c.rotation.y = yaw;
    }
    if (moved) { const c = this.game.chairs[moved[0]].obj; [c.position.x, c.position.z, c.rotation.y] = moved[1]; }
  }

  // Stop every walk and sit midway: the next place() puts those people at their spots
  halt() {
    for (const p of Object.values(this.people)) {
      this.endFidget(p);
      if (!p.task && !p.queue.length) continue;
      p.queue.length = 0; p.task = null; p.at = null; p.want = null;
      for (const r of p.waiters ?? []) r();
      p.waiters = [];
    }
    this.stream.visible = false;
  }

  // How full the mugs on the desks are (0 empty .. 1 full), and where they
  // stand if not at home: { S0Mug: k | [k, x, z] }
  mugs(fill = {}) {
    for (const [name, m] of Object.entries(this.mugsRest ?? {})) {
      const [k, x, z] = [].concat(fill[name] ?? 1);
      // in someone's hand for a sip: where it goes back to changes instead
      const held = Object.values(this.people).find((p) => p.fidget?.mug?.m === m && p.fidget.mug.rest)?.fidget.mug.rest;
      const pos = held?.pos ?? m.mug.position;
      pos.copy(m.home);
      if (x !== undefined) { pos.x = x; pos.z = z; }
      this.fillMug(name, k);
    }
  }
  fillMug(name, k) {
    const m = this.mugsRest[name];
    if (!m) return;
    m.coffee.position.y = m.y - (1 - k) * 0.055;
    m.coffee.visible = k > 0.03;
    m.k = k;
  }

  // ------------------------------------------------------------ moving about
  // A move: { walk: [[x, z], ...] } | { sit: chair } | { stand: chair, toward: [x, z] }
  // | { carry: 'jug' | null } | { pour: 'S0Mug' } | { face: [x, z] } | { pose: name }
  // | { wait: s }. Moves queue up per person and play one after the other;
  // `to` names the spot where the last one leaves them.
  move(who, m) {
    const p = this.people[who];
    if (!p) return;
    p.queue.push(m);
    if (m.to) p.atAfter = m.to;
  }
  // Play every queued move to its end at once (a start partway into a beat)
  rush(camera, now) {
    const busy = () => Object.values(this.people).some((p) => p.root.visible && (p.task || p.queue.length));
    for (let i = 0; i < 1200 && busy(); i++) this.update(0.05, camera, now);
  }
  // Resolves once everyone named has finished their moves
  idle(...whos) {
    return Promise.all(whos.map((who) => {
      const p = this.people[who];
      if (!p || (!p.task && !p.queue.length)) return null;
      return new Promise((r) => (p.waiters ??= []).push(r));
    }));
  }

  fade(p, name, dur = 0.3) {
    const next = p.act[name];
    if (!next || p.pose === name) return;
    const prev = p.pose && p.act[p.pose];
    next.reset().setEffectiveWeight(1).play();
    if (prev) next.crossFadeFrom(prev, dur, false);
    p.pose = name;
  }

  start(p, m) {
    const root = p.root, chairs = this.game.chairs;
    const t = { m, k: 0 };
    if (m.walk) {
      const pts = m.walk.map(([x, z]) => new THREE.Vector3(x, 0, z));
      if (pts[0].distanceTo(root.position) > 0.05) pts.unshift(root.position.clone());
      t.pts = pts; t.d = 0;
      t.len = pts.slice(1).reduce((a, q, i) => a + q.distanceTo(pts[i]), 0);
      this.fade(p, 'walk', 0.25);
      if (p.act.walk) p.act.walk.timeScale = (m.speed ?? WALK_SPEED) / STRIDE;
      t.step = (dt) => {
        t.d = Math.min(t.len, t.d + dt * (m.speed ?? WALK_SPEED));
        let left = t.d, pos = pts.at(-1), dir = pts.at(-1).clone().sub(pts.at(-2));
        for (let i = 1; i < pts.length; i++) {
          const seg = pts[i].clone().sub(pts[i - 1]), len = seg.length();
          if (left <= len) { pos = pts[i - 1].clone().addScaledVector(seg, left / len); dir = seg; break; }
          left -= len;
        }
        root.position.copy(pos);
        this.turnToward(root, yawTo(dir.x, dir.z), dt);
        if (t.d >= t.len) { this.fade(p, 'idle', 0.3); return true; }
        return false;
      };
    } else if (m.face) {
      const want = yawTo(m.face[0] - root.position.x, m.face[1] - root.position.z);
      t.step = (dt) => this.turnToward(root, want, dt) < 0.02;
    } else if (m.pose) {
      this.fade(p, m.pose, m.fade ?? 0.4);
      t.step = () => true;
    } else if (m.wait) {
      t.step = (dt) => (t.k += dt) >= m.wait;
    } else if (m.carry !== undefined) {
      this.carry(p, m.carry);
      if (m.put) {   // set the jug down there, upright, handle toward us
        this.jug.visible = true;
        this.jug.rotation.set(0, root.rotation.y - Math.PI / 2, 0);
        this.jug.position.set(...m.put);
      }
      t.step = () => true;
    } else if (m.sit !== undefined) {
      // Turn the chair round to face us, step in front of it, sit down, and
      // swing back round to the desk with it
      const c = chairs[m.sit].obj, home = this.chairHomes[m.sit];
      const pivot = new THREE.Vector3(c.position.x, 0, c.position.z);
      const off = root.position.clone().sub(pivot).setY(0);
      const face = yawTo(off.x, off.z);   // the chair's yaw when its seat faces us
      const f = new THREE.Vector3(-Math.sin(face), 0, -Math.cos(face));
      const from = c.rotation.y, spin = wrap(face - from), start = root.position.clone();
      const toChair = yawTo(-off.x, -off.z), seatYaw0 = root.rotation.y;
      const su = p.act.stand_up, dur = su?.getClip().duration ?? 1.5;
      t.step = (dt) => {
        t.k += dt;
        const k = t.k;
        // 0 - 0.7 s: he turns to the chair and spins it round to face him
        if (k < 0.7) {
          root.rotation.y = seatYaw0 + wrap(toChair - seatYaw0) * smooth(k / 0.3);
          c.rotation.y = from + spin * smooth((k - 0.1) / 0.6);
          return false;
        }
        c.rotation.y = face;
        // 0.7 - 1.15 s: turns his back to it and steps up to the seat
        if (k < 1.15) {
          const u = smooth((k - 0.7) / 0.45);
          root.rotation.y = toChair + wrap(face - toChair) * u;
          root.position.lerpVectors(start, pivot.clone().addScaledVector(f, 0.3), u);
          if (k - dt < 0.7) this.fade(p, 'walk', 0.15);
          return false;
        }
        // 1.15 s +: sits down (the stand-up clip backwards)
        const s0 = 1.15, s1 = s0 + dur * 0.7;
        if (k < s1) {
          if (k - dt < s0) { this.fade(p, 'stand_up', 0.25); if (su) su.timeScale = 0; }
          const u = (k - s0) / (s1 - s0);
          if (su) su.time = dur * (1 - u) * 0.999;
          root.rotation.y = face;
          root.position.copy(pivot.clone().addScaledVector(f, 0.3 - 0.24 * smooth(u)));
          return false;
        }
        // then swings back round to the desk, chair and all
        const s2 = s1 + 0.9;
        // (the stand-up clip stays frozen as it fades out: played on, it would lift him off the seat)
        if (k - dt < s1) this.fade(p, 'seated_idle', 0.3);
        const u = smooth((k - s1) / (s2 - s1));
        const yaw = face + wrap(home[2] - face) * u;
        c.rotation.y = yaw;
        const fy = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        root.rotation.y = yaw;
        root.position.copy(pivot).addScaledVector(fy, 0.06);
        if (k >= s2) { if (su) su.timeScale = 1; if (m.then) this.fade(p, m.then, 0.6); return true; }
        return false;
      };
    } else if (m.stand !== undefined) {
      // Swing the chair round toward where we are going, then stand up out of it
      const c = chairs[m.stand].obj;
      const pivot = new THREE.Vector3(c.position.x, 0, c.position.z);
      const from = c.rotation.y, face = yawTo(m.toward[0] - pivot.x, m.toward[1] - pivot.z), spin = wrap(face - from);
      const su = p.act.stand_up, dur = su?.getClip().duration ?? 1.5;
      t.step = (dt) => {
        t.k += dt;
        const k = t.k;
        if (k < 0.8) {
          if (k - dt <= 0 && p.pose !== 'seated_idle') this.fade(p, 'seated_idle', 0.3);
          const yaw = from + spin * smooth(k / 0.8);
          c.rotation.y = yaw; root.rotation.y = yaw;
          root.position.copy(pivot).addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 0.06);
          return false;
        }
        c.rotation.y = face;
        const f = new THREE.Vector3(-Math.sin(face), 0, -Math.cos(face));
        const s1 = 0.8 + dur * 0.8;
        if (k - dt < 0.8) { this.fade(p, 'stand_up', 0.2); if (su) su.timeScale = 0; }
        const u = Math.min(1, (k - 0.8) / (dur * 0.8));
        if (su) su.time = dur * u * 0.999;
        root.rotation.y = face;
        root.position.copy(pivot).addScaledVector(f, 0.06 + 0.32 * smooth(u));
        if (k >= s1) { if (su) su.timeScale = 1; this.fade(p, 'idle', 0.3); return true; }
        return false;
      };
    } else if (m.pour) {
      // Tip the jug over the mug (the arm stays bent, see carryArm), fill it, and back
      const mug = this.mugsRest[m.pour];
      const at = mug ? mug.mug.getWorldPosition(new THREE.Vector3()) : root.position.clone();
      const want = yawTo(at.x - root.position.x, at.z - root.position.z);
      const fill0 = mug?.k ?? 0;
      t.shift = new THREE.Vector3();
      t.step = (dt) => {
        t.k += dt * 1.35;   // a brisk pour: the 5 s below take about 3.7 s
        const k = t.k;
        this.turnToward(root, want, dt);
        const tilt = smooth((k - 0.9) / 0.6) * (1 - smooth((k - 3.4) / 0.5));
        p.tilt = tilt * 1.25;
        this.stream.visible = tilt > 0.75;
        if (mug && tilt > 0.75) this.fillMug(m.pour, Math.min(1, fill0 + (1 - fill0) * (k - 1.3) / 1.9));
        // step in so the spout is over the mug (at most 40 cm)
        if (p.spoutAt && k > 0.3 && k < 3.4) {
          const d = new THREE.Vector3(at.x - p.spoutAt.x, 0, at.z - p.spoutAt.z).multiplyScalar(Math.min(1, dt * 3));
          if (t.shift.clone().add(d).length() < 0.4) { t.shift.add(d); root.position.add(d); }
        }
        if (k >= 5) { p.tilt = 0; return true; }
        return false;
      };
    } else t.step = () => true;
    return t;
  }

  // Turn a root toward a yaw at TURN_RATE; returns how far it still has to go
  turnToward(root, want, dt) {
    const d = wrap(want - root.rotation.y);
    root.rotation.y += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt * Math.max(0.35, Math.min(1, Math.abs(d))));
    return Math.abs(d);
  }

  carry(p, what) {
    p.carry = what;
    if (this.jug) this.jug.visible = Object.values(this.people).some((q) => q.carry === 'jug' && q.root.visible);
    if (!what) p.tilt = 0;
  }

  // The right arm of whoever carries the jug, over the clip: upper arm down
  // the side, elbow bent at 90 degrees, forearm level and forward, so the jug
  // rides steady instead of swinging with the walk (Adriaen, 2026-10-25).
  // The forearm dips a little while pouring. k blends it in and out.
  carryArm(p, k) {
    const up = p.bones.upper_armR ?? p.bones['upper_arm.R'], fore = p.bones.forearmR ?? p.bones['forearm.R'], hand = p.bones.handR ?? p.bones['hand.R'];
    if (!up || !fore) return;
    p.root.updateMatrixWorld(true);
    const yaw = p.root.rotation.y, f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // out: from the body's middle toward the right shoulder, level
    const out = up.getWorldPosition(new THREE.Vector3()).sub(p.root.position).setY(0);
    out.addScaledVector(f, -out.dot(f)).normalize();
    const down = new THREE.Vector3(0, -1, 0);
    const dip = 0.35 * Math.min(1, (p.tilt ?? 0) / 1.25);
    this.aim(up, down.clone().addScaledVector(f, 0.12).addScaledVector(out, 0.1).normalize(), k);
    const level = f.clone().addScaledVector(out, -0.12).addScaledVector(down, dip).normalize();
    this.aim(fore, level, k);
    if (hand) this.aim(hand, level, k);
  }

  // Turn a bone so its length (+Y) points along a world direction, k of the way
  aim(bone, want, k) {
    bone.updateMatrixWorld(true);
    const qb = bone.getWorldQuaternion(new THREE.Quaternion());
    const now = new THREE.Vector3(0, 1, 0).applyQuaternion(qb);
    const world = new THREE.Quaternion().setFromUnitVectors(now, want).multiply(qb);
    const qp = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.slerp(qp.multiply(world), k);
    bone.updateMatrixWorld(true);
  }

  // The jug in the right hand, hanging level from its handle, tipped forward by p.tilt
  holdJug(p) {
    const hand = p.bones.handR ?? p.bones['hand.R'];
    if (!hand) return;
    p.root.updateMatrixWorld(true);
    // the handle sits in the palm, a little way down the hand from the wrist
    const h = hand.localToWorld(new THREE.Vector3(0, 0.07, 0));
    const yaw = p.root.rotation.y;
    this.jug.rotation.order = 'YXZ';
    this.jug.rotation.set(0, yaw - Math.PI / 2, p.tilt ?? 0);
    this.jug.updateMatrix();
    const grip = this.jug.userData.grip.clone().applyEuler(this.jug.rotation);
    this.jug.position.copy(h).sub(grip);
    this.jug.updateMatrixWorld(true);
    p.spoutAt = this.jug.localToWorld(this.jug.userData.spout.clone());
    if (this.stream.visible) {
      const top = p.spoutAt, mug = Object.values(this.mugsRest).reduce((a, m) => {
        const w = m.mug.getWorldPosition(new THREE.Vector3());
        return !a || w.distanceTo(top) < a.distanceTo(top) ? w : a;
      }, null);
      const bottom = mug ? new THREE.Vector3(top.x, mug.y + 0.07, top.z) : top.clone().setY(top.y - 0.15);
      this.stream.position.copy(top);
      this.stream.scale.set(1, Math.max(0.01, top.y - bottom.y), 1);
    }
  }

  // ------------------------------------------------------------ seated idles
  // Someone sitting still at a desk (no moves, not talking) now and then
  // sips from the mug beside them, if there is one in reach, or wiggles the mouse
  fidget(p, now, dt) {
    if (p.fidget) return this.fidgeting(p, now, dt);
    const sitting = SPOTS[p.at]?.chair !== undefined && (p.pose === 'seated_idle' || p.pose === 'typing');
    if (!IDLES || !sitting || p.task || p.queue.length || p.mouth) { p.fidgetAt = null; return; }
    if (p.fidgetAt == null) { p.fidgetAt = now + IDLE_FIRST[0] + Math.random() * (IDLE_FIRST[1] - IDLE_FIRST[0]); return; }
    if (now < p.fidgetAt) return;
    p.fidgetAt = null;
    // a mug where the clip's hand goes, on either side
    let sip = null;
    for (const side of [1, -1]) {
      const at = p.root.localToWorld(new THREE.Vector3(side * SIP_MUG[0], SIP_MUG[1], SIP_MUG[2]));
      for (const m of Object.values(this.mugsRest ?? {})) {
        const w = m.mug.getWorldPosition(new THREE.Vector3());
        if (Math.hypot(w.x - at.x, w.z - at.z) < 0.4) sip = { side, m };
      }
    }
    // coffee first, then mostly turn about with the mouse
    let name = sip && (!p.sipped || Math.random() < 0.4) ? (sip.side > 0 ? 'sip' : 'sip_left') : 'mouse';
    if (p.forceIdle) { name = p.forceIdle; p.forceIdle = null; if (name !== 'mouse' && !sip) return; }
    if (!p.act[name]) name = 'mouse';   // a model built before the sip clips
    const a = p.act[name];
    if (!a) { console.warn(`story: ${p.name ?? 'someone'} has no idle clips (rebuild the model)`); p.fidgetAt = Infinity; return; }
    p.sipped ||= name !== 'mouse';
    p.fidget = { name, back: p.pose, t: 0, dur: a.getClip().duration, mug: name === 'mouse' ? null : sip };
    this.fade(p, name, 0.35);
  }
  fidgeting(p, now, dt) {
    const f = p.fidget, t = (f.t += dt);   // the clip's own clock (dt, as the mixer has it)
    if (p.task || p.queue.length) return this.endFidget(p);
    if (t >= f.dur - 0.3 && p.pose === f.name) this.fade(p, f.back, 0.3);
    if (f.mug) this.holdMug(p, f, t);
    if (t >= f.dur) { this.endFidget(p); p.fidgetAt = now + IDLE_GAP[0] + Math.random() * (IDLE_GAP[1] - IDLE_GAP[0]); }
  }
  // The mug goes from the desk into the hand and back while the clip holds it
  holdMug(p, f, t) {
    const { m, side } = f.mug, mug = m.mug;
    if (!f.mug.rest) f.mug.rest = { pos: mug.position.clone(), quat: mug.quaternion.clone() };
    const hand = p.bones[side > 0 ? 'handR' : 'handL'] ?? p.bones[side > 0 ? 'hand.R' : 'hand.L'];
    const k = smooth((t - SIP_HOLD[0] + 0.12) / 0.2) * smooth((SIP_HOLD[1] + 0.12 - t) / 0.2);
    if (!hand || k <= 0) { mug.position.copy(f.mug.rest.pos); mug.quaternion.copy(f.mug.rest.quat); return; }
    p.root.updateMatrixWorld(true);
    // the handle in the palm, the cup beside the hand on the inside, its
    // handle (the mug's +x) pointing out at the hand
    const palm = hand.localToWorld(new THREE.Vector3(0, 0.06, 0));
    const inward = new THREE.Vector3(-side, 0, 0).transformDirection(p.root.matrixWorld);
    const want = palm.addScaledVector(inward, 0.1).add(new THREE.Vector3(0, -0.05, 0));
    mug.parent.updateMatrixWorld(true);
    mug.parent.worldToLocal(want);
    mug.position.lerpVectors(f.mug.rest.pos, want, k);
    // tipped toward the mouth while it is up there
    const up = smooth((t - 1.4) / 0.4) * smooth((2.6 - t) / 0.4);
    const qp = mug.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const held = qp.multiply(p.root.getWorldQuaternion(new THREE.Quaternion()))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? 0 : Math.PI))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(side > 0 ? 1 : -1, 0, 0), 0.6 * up));
    mug.quaternion.slerpQuaternions(f.mug.rest.quat, held, k);
  }
  endFidget(p) {
    const f = p.fidget;
    if (!f) return;
    p.fidget = null;
    if (f.mug?.rest) { f.mug.m.mug.position.copy(f.mug.rest.pos); f.mug.m.mug.quaternion.copy(f.mug.rest.quat); }
    if (p.pose === f.name) this.fade(p, f.back, 0.3);
  }

  // Straight into a pose, with any other body clip stopped (talk and blink play on top)
  pose(p, name) {
    const next = p.act[name];
    if (!next) return;
    for (const [n, a] of Object.entries(p.act)) if (a && n !== name && n !== 'talk' && n !== 'blink') { a.stop(); a.timeScale = 1; }
    if (p.pose === name && next.isRunning()) return;
    next.reset().setEffectiveWeight(1).play();
    p.pose = name;
    p.mixer.update(Math.random() * 3);
  }

  // Start talking along a line's mouth track (a string of 0-3 per 1/30 s)
  talk(who, mouth) {
    const p = this.people[who];
    if (p) { p.mouth = mouth; p.mouthT = 0; }
  }
  quiet() { for (const p of Object.values(this.people)) p.mouth = null; }

  head(who) {
    const p = this.people[who];
    if (!p?.root.visible) return null;
    const b = p.bones.head ?? p.root;
    return b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.08, 0));
  }

  update(dt, camera, now) {
    for (const p of Object.values(this.people)) {
      if (!p.root.visible) continue;
      // Moves: the current one steps, the next starts when it is done
      if (!p.task && p.queue.length) p.task = this.start(p, p.queue.shift());
      if (p.task && p.task.step(dt)) {
        p.task = null;
        if (!p.queue.length) {
          if (p.atAfter) { p.at = p.atAfter; p.atAfter = null; }
          for (const r of p.waiters ?? []) r();
          p.waiters = [];
        }
      }
      let level = 0;
      if (p.mouth) {
        p.mouthT += dt;
        const i = Math.floor(p.mouthT * 30);
        if (i >= p.mouth.length) p.mouth = null;
        else level = Number(p.mouth[i]) / 3;
      }
      p.level += (level - p.level) * Math.min(1, dt * 18);
      p.act.talk?.setEffectiveWeight(Math.min(1, p.level * 1.6));
      if (p.act.blink && now > p.blinkAt) { p.act.blink.reset().play(); p.blinkAt = now + 2.5 + Math.random() * 4; }
      // The head turns toward the camera (us), within reason: last frame's
      // turn undone first, as the clips may not key these bones
      const neck = p.bones.neck;
      if (neck && p.applied) { neck.rotateY(-p.applied); p.bones.head?.rotateY(-p.applied); }
      p.applied = 0;
      p.mixer.update(dt);
      if (neck) {
        const to = camera.position.clone();
        p.root.worldToLocal(to);
        const want = THREE.MathUtils.clamp(Math.atan2(-to.x, -to.z), -0.75, 0.75) * 0.8;
        p.turn += (want - p.turn) * Math.min(1, dt * 3);
        p.applied = p.turn * 0.5;
        neck.rotateY(p.applied);
        p.bones.head?.rotateY(p.applied);
      }
      this.fidget(p, now, dt);
      p.armK = THREE.MathUtils.clamp((p.armK ?? 0) + (p.carry === 'jug' ? dt : -dt) / 0.3, 0, 1);
      if (p.armK) this.carryArm(p, smooth(p.armK));
      if (p.carry === 'jug') this.holdJug(p);
    }
  }
}
