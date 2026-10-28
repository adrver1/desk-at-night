// One year ago: Torvet in Trondheim as a dream. Føniks and the Olav
// Tryggvason column keep their colours; everything else is white on a pale
// ground under a pale sky (the "dream" variant of
// blender/trondheim_surroundings.py). The camera glides down from the drone
// view over the square (B) to Adriaen at the Føniks door (A).
//
// The models: story/trondheim/torvet.glb (the square, its blocks and the
// column, from trondheim_surroundings.py) and story/trondheim/foniks.glb
// (Føniks, from preview_trondheim.py --glb), both in the square's own frame:
// the column at the origin, metres, x east, north along -z. This place is
// nowhere near the platform, so it draws on its own canvas over the game
// while the room underneath rests (game.hooks.hidden).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadModel } from './cast.js';
import { FlagField, loadCloth } from '../flags.js';
import flagCloth from '../flag-cloth/flag.bin?url';

const BASE = 'story/trondheim/';
const GLIDE = 14;   // s from the drone view down to the door
const SKY = 0xf1f3f4;
// Blender's frame (x east, y north, z up) to three's (y up, north along -z)
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
// The Aker BP flags on Føniks's five masts fly south along the front, as on
// Adriaen's photo of the entrance, in a breeze between a light and a fresh one
// (flags.js option C: the baked cloth). Hoists from flags.json, written by the
// Føniks export.
const FLAG_DOWNWIND = new THREE.Vector3(0.3, 0, 1).normalize();   // three's axes: south, a little out to the square
const flagWind = (t) => 7 + 1.5 * Math.sin(t * 0.23) + 0.8 * Math.sin(t * 0.71 + 1);   // m/s
// The cameras of preview_trondheim.py: B is fitted to Adriaen's drone photo
// over the south-east corner, A stands at the Føniks door looking at it
const CAM = {
  // B: the drone over the south-east of the square, looking across Olav's
  // column to Føniks behind it (Adriaen, 2026-10-24)
  B: V(60, -36, 30), B_AT: V(-52, 38, 8),
  A: V(-28.5, 30.5, 1.7), A_AT: V(-44.5, 37.5, 2.7),
  ME: V(-33.5, 31.5, 0),   // Adriaen by the fountain, turned to the camera at A
};
// As the camera arrives he turns round and walks to the entrance: up the
// steps south of the fountain (not over the ramp's rail) and across the
// terrace to the foot of the platform steps (Adriaen, 2026-10-25). Heights
// follow the ground and steps under people.
const WALK = { at: GLIDE - 3, speed: 1.15, path: [CAM.ME, V(-34.6, 34.6, 0), V(-39.6, 35.3, 0), V(-40.6, 36.2, 0), V(-40.97, 38.15, 0)] };
// The CEO comes out of the left-hand door while Adriaen is still on the steps
// by the fountain, welcomes him to Aker BP on the way down to meet him (the
// beat's { torvet: 'meet' } step waits for MEET before the line), and they
// shake hands at the foot of the platform steps while the camera closes in
// beside them ({ torvet: 'shake' } waits for the end of it). Then
// { torvet: 'in' }: they go in together, the CEO leading (Adriaen, 2026-10-25).
const DOOR = V(-44.3, 38.4, 0);
// They meet on the terrace midway between two flag masts (x -41.2 at y 35.6
// and 42.7), clear of both (Adriaen, 2026-10-25)
const CEO = { at: GLIDE + 0.5, speed: 0.9, path: [V(-43.7, 38.4, 0), V(-41.75, 38.3, 0)] };
const MEET = GLIDE + 1.8;
const SHAKE = { at: GLIDE + 7.7, len: 2.2 };
const CLOSE = { from: GLIDE + 4.4, to: GLIDE + 7.9, pos: V(-42.4, 34.9, 2.3), at: V(-41.3, 38.2, 1.8), fov: 48 };
const IN = { ceo: [CEO.path.at(-1), V(-42.6, 38.4, 0), V(-43.6, 38.4, 0), DOOR], me: [WALK.path.at(-1), V(-41.6, 38.2, 0), V(-42.7, 38.3, 0), V(-43.5, 38.4, 0), DOOR], lag: 0.7 };
// Without the CEO (the default since 2026-10-27, Adriaen: the greeting took
// too long) Adriaen walks on from the foot of the steps straight in at the
// door; ?ceo=1 brings back the CEO, the welcome and the handshake
export const CEO_MEET = new URLSearchParams(location.search).get('ceo') === '1';
// He walks the whole glide: in from the south-east of the square, past the
// fountain and up the steps, in shot all the way down (Adriaen, 2026-10-27).
// He comes through the gap between the planters at (-29, 18) and (-29, 27)
// (trondheim_surroundings.py PLANTER_SPOTS), not through their trees
const SOLO = [V(-26.5, 22.5, 0), V(-31, 23, 0), ...WALK.path, ...IN.me.slice(1)];
const pathLength = (pts) => pts.slice(1).reduce((n, q, i) => n + q.distanceTo(pts[i]), 0);
const CUES = { meet: MEET, shake: SHAKE.at + SHAKE.len, door: pathLength(SOLO) / WALK.speed };
// Where someone is d metres along a path: the point, the way they face, still walking or not
function along(pts, d) {
  let left = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].clone().sub(pts[i - 1]), len = seg.length();
    if (left < len) return { pos: pts[i - 1].clone().addScaledVector(seg, left / len), dir: seg, walking: true };
    left -= len;
  }
  return { pos: pts.at(-1).clone(), dir: pts.at(-1).clone().sub(pts.at(-2)), walking: false };
}
const yawOf = (dir) => Math.atan2(-dir.x, -dir.z);
// Turn a bone so its length (+Y) points along a world direction, k of the way (as cast.js)
function aim(bone, want, k) {
  bone.updateMatrixWorld(true);
  const qb = bone.getWorldQuaternion(new THREE.Quaternion());
  const now = new THREE.Vector3(0, 1, 0).applyQuaternion(qb);
  const world = new THREE.Quaternion().setFromUnitVectors(now, want).multiply(qb);
  const qp = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.slerp(qp.multiply(world), k);
  bone.updateMatrixWorld(true);
}
const turnTo = (from, to, k) => from + (((to - from + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * k;

export class Trondheim {
  constructor(host) {
    this.host = host;
    this.on = false;
    this.loaded = null;
  }

  load() {
    this.loaded ??= (async () => {
      const loader = new GLTFLoader();
      const [torvet, foniks, me, ceo, flags] = await Promise.all([
        loader.loadAsync(`${BASE}torvet.glb`).catch((e) => { console.warn('trondheim: torvet.glb', e); return null; }),
        loader.loadAsync(`${BASE}foniks.glb`).catch((e) => { console.warn('trondheim: foniks.glb', e); return null; }),
        loadModel('bearded_operator').catch(() => null),   // one year ago: his own clothes, no PPE
        loadModel('glasses_ceo').catch(() => null),        // in town: no PPE either
        Promise.all([fetch(`${BASE}flags.json`).then((r) => r.json()), loadCloth('flag', flagCloth)])
          .catch((e) => { console.warn('trondheim: flags', e); return null; }),
      ]);
      const scene = this.scene = new THREE.Scene();
      scene.background = new THREE.Color(SKY);
      scene.fog = new THREE.Fog(SKY, 150, 600);   // the ground fades into the sky well before the horizon, so it melts away
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b6ae, 2.2));
      const sun = new THREE.DirectionalLight(0xfff4e4, 2.2);
      sun.position.set(60, 90, 40);
      scene.add(sun, sun.target);
      for (const g of [torvet, foniks]) if (g) scene.add(g.scene);
      if (flags) {
        const [{ hoists }, cloth] = flags;
        this.flags = new FlagField('flag', 'c', hoists.map(([x, y, z]) => ({ position: V(x, y, z) })), { cloth });
        this.sunDir = sun.position.clone().normalize();
        this.sunColor = sun.color;
        scene.add(this.flags);
      }
      // People: { root, mixer, idle, walk, talk, act }
      const person = (g) => {
        const root = g.scene, mixer = new THREE.AnimationMixer(root);
        const clip = (n) => { const c = THREE.AnimationClip.findByName(g.animations, n); return c && mixer.clipAction(c); };
        scene.add(root);
        const talk = clip('talk');
        talk?.setEffectiveWeight(0).play();
        const bones = {};
        root.traverse((o) => { if (o.isBone) bones[o.name.replace('.', '')] = o; });
        return { root, mixer, bones, idle: clip('idle'), walk: clip('walk'), talk, act: null, mouth: null, level: 0 };
      };
      if (me) {
        this.me = person(me);
        this.me.root.position.copy(CAM.ME);
        this.faceCam = Math.atan2(-(CAM.A.x - CAM.ME.x), -(CAM.A.z - CAM.ME.z));
      }
      if (ceo && CEO_MEET) this.ceo = person(ceo);
      this.ground = [torvet?.scene, foniks?.scene].filter(Boolean);
      this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.3, 1500);
      this.ok = Boolean(torvet || foniks);
    })();
    return this.loaded;
  }

  async show() {
    if (this.on) return;
    this.on = true;
    await this.load();
    if (!this.on) return;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.domElement.className = 'trondheim';
    }
    this.host.insertBefore(this.renderer.domElement, this.host.querySelector('.tint'));   // over the game, under the story's overlays
    this.t0 = performance.now();
    this.last = this.t0;
    this.tIn = null;
    for (const p of [this.me, this.ceo]) if (p) p.mouth = null;
    this.place(0);
    const loop = (now) => {
      if (!this.on) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide() {
    if (!this.on) return;
    this.on = false;
    cancelAnimationFrame(this.raf);
    this.renderer?.domElement.remove();
    for (const w of this.waits ?? []) w.r();
    this.waits = [];
  }

  // The beat's { torvet: cue } steps: 'meet' resolves once the CEO has come
  // out to Adriaen (or at once if the scene isn't up); 'in' sends them inside
  reach(cue) {
    if (cue === 'in') { this.tIn ??= this.time(); return Promise.resolve(); }
    const at = CUES[cue] ?? 0;
    if (!this.on || this.time() >= at) return Promise.resolve();
    return new Promise((r) => (this.waits ??= []).push({ at, r }));
  }

  time() { return this.on && this.t0 !== undefined ? (performance.now() - this.t0) / 1000 : 0; }

  // A spoken line's mouth track (as cast.talk): who is 'operator' or 'ceo'
  talk(who, mouth) {
    const p = who === 'ceo' ? this.ceo : who === 'operator' ? this.me : null;
    if (p) { p.mouth = mouth; p.mouthT = 0; }
  }

  // Where the camera is t seconds into the glide: from B, descending in an
  // arc over the square, to A at the door; the gaze moves from the square
  // to the entrance
  pose(t) {
    const u = Math.min(1, t / GLIDE), k = u * u * (3 - 2 * u);
    const mid = CAM.B.clone().lerp(CAM.A, 0.55).setY(THREE.MathUtils.lerp(CAM.B.y, CAM.A.y, 0.4));
    const a = CAM.B.clone().lerp(mid, k), b = mid.clone().lerp(CAM.A, k);
    const pos = a.lerp(b, k);
    const at = CAM.B_AT.clone().lerp(CAM.A_AT, THREE.MathUtils.smoothstep(k, 0.1, 0.8));
    // then in beside the two of them for the handshake
    const c = CEO_MEET ? THREE.MathUtils.smoothstep(t, CLOSE.from, CLOSE.to) : 0;
    if (c > 0) return { pos: pos.lerp(CLOSE.pos, c), at: at.lerp(CLOSE.at, c), fov: THREE.MathUtils.lerp(55, CLOSE.fov, c) };
    return { pos, at, fov: THREE.MathUtils.lerp(50, 55, k) };
  }

  // Everyone at t seconds. Adriaen: facing the camera, then turning and
  // walking to the foot of the steps, turned to the CEO as they meet. The
  // CEO: out of the door and down to him. After 'in', both up and inside.
  place(t) {
    const me = this.me, ceo = this.ceo;
    const gone = (p, pos) => { p.root.visible = pos.distanceTo(DOOR) > 0.25; };
    if (me && !CEO_MEET) {
      const { pos, dir, walking } = along(SOLO, t * WALK.speed);
      me.root.rotation.y = yawOf(dir);
      this.stand(me, pos, walking);
      gone(me, pos);
    } else if (me) {
      let { pos, dir, walking } = along(WALK.path, (t - WALK.at - 0.6) * WALK.speed);   // 0.6 s to turn first
      const inside = this.tIn !== null && t - this.tIn > IN.lag;
      if (inside) ({ pos, dir, walking } = along(IN.me, (t - this.tIn - IN.lag) * WALK.speed));
      const r = me.root.rotation;
      if (t < WALK.at) r.y = this.faceCam;
      else if (t < WALK.at + 0.6) r.y = turnTo(this.faceCam, yawOf(dir), THREE.MathUtils.smoothstep(t, WALK.at, WALK.at + 0.6));
      else if (walking || inside) r.y = yawOf(dir);
      else if (ceo?.root.visible) r.y = turnTo(r.y, yawOf(ceo.root.position.clone().sub(pos)), 0.12);   // turned to the CEO
      this.stand(me, pos, walking && t >= WALK.at + 0.6);
      gone(me, pos);
    }
    if (ceo) {
      let { pos, dir, walking } = along(CEO.path, (t - CEO.at) * CEO.speed), want = yawOf(dir);
      if (!walking && me) want = yawOf(me.root.position.clone().sub(pos));
      if (this.tIn !== null) ({ pos, dir, walking } = along(IN.ceo, (t - this.tIn) * WALK.speed)), want = yawOf(dir);
      ceo.root.rotation.y = walking ? want : turnTo(ceo.root.rotation.y, want, 0.15);
      this.stand(ceo, pos, walking);
      ceo.root.visible = t >= CEO.at;
      if (ceo.root.visible) gone(ceo, pos);
    }
    for (const w of this.waits ?? []) if (t >= w.at) w.r();
    this.waits = (this.waits ?? []).filter((w) => t < w.at);
  }

  // Feet on whatever is under them (ground, terrace steps, the ramp), walking or standing
  stand(p, pos, walking) {
    this.ray ??= new THREE.Raycaster();
    this.ray.set(new THREE.Vector3(pos.x, 4, pos.z), new THREE.Vector3(0, -1, 0));
    const hit = this.ray.intersectObjects(this.ground, true).find((h) => h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.7);
    p.root.position.set(pos.x, hit ? hit.point.y : 0, pos.z);
    const act = walking ? p.walk : p.idle;
    if (act && act !== p.act) { act.reset().fadeIn(0.3).play(); p.act?.fadeOut(0.3); p.act = act; }
  }

  // Mouths: the talk clip weighted by the line's loudness, as in cast.js
  mouths(dt) {
    for (const p of [this.me, this.ceo]) {
      if (!p) continue;
      let level = 0;
      if (p.mouth) {
        p.mouthT += dt;
        const i = Math.floor(p.mouthT * 30);
        if (i >= p.mouth.length) p.mouth = null;
        else level = Number(p.mouth[i]) / 3;
      }
      p.level += (level - p.level) * Math.min(1, dt * 18);
      p.talk?.setEffectiveWeight(Math.min(1, p.level * 1.6));
      p.mixer.update(dt);
    }
    this.shake(this.t ?? 0);
  }

  // The handshake: both right hands out to the point between them, pumping
  // gently, blended in and out over the clips
  shake(t) {
    const me = this.me, ceo = this.ceo;
    if (!me || !ceo || this.tIn !== null) return;
    const k = THREE.MathUtils.smoothstep(t, SHAKE.at - 0.4, SHAKE.at) * (1 - THREE.MathUtils.smoothstep(t, SHAKE.at + SHAKE.len - 0.3, SHAKE.at + SHAKE.len + 0.2));
    if (!k) return;
    const hand = me.root.position.clone().lerp(ceo.root.position, 0.5);
    hand.y = Math.max(me.root.position.y, ceo.root.position.y) + 0.98 + 0.035 * Math.sin((t - SHAKE.at) * Math.PI * 4.4);
    for (const [p, q] of [[me, ceo], [ceo, me]]) {
      const up = p.bones.upper_armR, fore = p.bones.forearmR, h = p.bones.handR;
      if (!up || !fore) continue;
      p.root.updateMatrixWorld(true);
      const toward = q.root.position.clone().sub(p.root.position).setY(0).normalize();
      aim(up, new THREE.Vector3(0, -1, 0).addScaledVector(toward, 0.55).normalize(), k);
      const elbow = fore.getWorldPosition(new THREE.Vector3());
      const dir = hand.clone().sub(elbow).normalize();
      aim(fore, dir, k);
      if (h) aim(h, dir, k);
    }
  }

  frame(now) {
    const r = this.renderer, cv = r.domElement;
    const w = cv.parentElement?.clientWidth || innerWidth, h = cv.parentElement?.clientHeight || innerHeight;
    if (cv.width !== Math.round(w * r.getPixelRatio()) || cv.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = this.t = (now - this.t0) / 1000, p = this.pose(t), cam = this.camera;
    this.place(t);
    this.mouths(dt);
    cam.position.copy(p.pos);
    cam.lookAt(p.at);
    // A breath of life once it has landed
    cam.rotateY(0.004 * Math.sin(t * 0.37));
    cam.rotateX(0.003 * Math.sin(t * 0.51 + 1));
    if (cam.fov !== p.fov) cam.fov = p.fov;
    cam.updateProjectionMatrix();
    this.flags?.update(t, cam, { speed: flagWind(t), dir: FLAG_DOWNWIND, sunDir: this.sunDir, sunColor: this.sunColor });
    r.render(this.scene, cam);
  }
}
