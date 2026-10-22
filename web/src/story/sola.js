// The optional opening at the heliport before the flight (?sola=1): about
// twenty seconds on the apron in the morning, the helicopter idling on its
// stand, the crew walking out of the gate in survival suits, and by the
// fence a pallet of chemical IBCs that is not going anywhere today. The
// title and credits run here, then the cabin flight (intro.html) takes over.
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

const LENGTH = 24;   // s, from black to the hand-over to the cabin
const WALK = 1.25;   // m/s, the walk clip's pace (intro.js)
const CREW = ['bearded_operator', 'blazer_lead', 'crop_supervisor', 'curly_analyst', 'glasses_engineer', 'grey_beard_lead'];
const GAP = 3.5;     // m between passengers on the walkway
// The walkway from the departures door through the gate to the cabin door,
// as painted by sola_apron.py, ending at the foot of the west door
const PATH = [[-12, 38], [-12, 32.5], [-12, 14], [-4.5, 6], [-2.2, 1.0], [-1.95, 0.1]].map(([x, z]) => new THREE.Vector3(x, 0, z));

// Shots: [from, to] for the camera and what it looks at, over [t0, t1]
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const SHOTS = [
  { t: [0, 8], pos: [v(21, 5.5, -12), v(18.5, 4.8, -10.5)], at: [v(-1, 1.6, 7), v(-1.5, 1.6, 7)], fov: 48 },     // the apron, the crew coming out
  { t: [8, 15], pos: [v(16, 1.6, 31), v(14.5, 1.6, 31.3)], at: [v(-5.2, 1.4, 17.8), v(-6, 1.4, 18.5)], fov: 50 },  // along the fence: the pallet, the helicopter beyond
  { t: [15, LENGTH], pos: [v(-10, 1.7, -8), v(-9, 1.65, -6.5)], at: [v(-2, 1.4, 2.5), v(-2, 1.4, 1.5)], fov: 48 },   // at the door
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
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 6000);
    this.loaded = null;
  }

  load() {
    this.loaded ??= (async () => {
      const [apron, heli, pilot, info, ...crew] = await Promise.all([
        loadGltf('story/sola/sola.glb'), loadGltf('intro/heli.glb'), loadGltf('intro/chars/heli_pilot_flying_headset.glb').catch(() => null),
        fetch('intro/intro.json').then((r) => r.json()),
        ...CREW.map((c) => loadGltf(`intro/chars/${c}_survival.glb`).catch(() => null)),
      ]);
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
      });
      s.add(apron.scene);
      this.pallet = apron.scene.getObjectByName('SolaPallet');
      this.sock = apron.scene.getObjectByName('SolaSock');

      // The helicopter on its stand, nose north, rotors turning, doors open
      const h = new THREE.Group();
      h.rotation.y = Math.PI / 2;
      h.add(heli.scene);
      heli.scene.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      this.rotor = new Helicopter(heli.scene, { running: true });
      this.rotor.setDoors(true);
      this.rotor.door = this.rotor.doorTarget = 1;
      if (pilot) {
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

      // The crew on the walkway, a few metres apart
      const len = PATH.slice(1).reduce((a, q, k) => a + q.distanceTo(PATH[k]), 0);
      this.pathLen = len;
      this.crew = crew.filter(Boolean).map((gltf, i) => {
        const p = gltf.scene;
        p.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        const mixer = new THREE.AnimationMixer(p);
        const walk = THREE.AnimationClip.findByName(gltf.animations, 'walk');
        if (walk) mixer.clipAction(walk).play();
        mixer.setTime(i * 0.37);
        s.add(p);
        return { p, mixer, start: len - 12 - i * GAP };   // metres along the path at t = 0
      });
    })();
    return this.loaded;
  }

  // Where along the walkway (metres from the departures door) and which way
  pointAt(d, out) {
    for (let k = 1; k < PATH.length; k++) {
      const a = PATH[k - 1], b = PATH[k], l = a.distanceTo(b);
      if (d <= l || k === PATH.length - 1) {
        out.lerpVectors(a, b, Math.min(1, Math.max(0, d / l)));
        return Math.atan2(-(b.x - a.x), -(b.z - a.z));
      }
      d -= l;
    }
    return 0;
  }

  // The apron scene; resolves when it has played (or was skipped)
  async play(host, ui, say) {
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
    this.sound?.rotor(0.06, 2.5);
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
    for (const c of this.crew) c.p.visible = opening;
    this.pallet.visible = opening || this.kind === 'full';
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

  crewAt(t, dt) {
    const at = new THREE.Vector3();
    for (const c of this.crew) {
      const d = c.start + WALK * t;
      c.p.visible = d < this.pathLen - 0.05;   // in through the door
      c.p.rotation.y = this.pointAt(d, at);
      c.p.position.copy(at);
      c.mixer.update(dt);
    }
  }

  cuesAt(t) {
    const cue = (name, at, fn) => { if (t >= at && !this.cues.has(name)) { this.cues.add(name); fn(); } };
    cue('in', 0.4, () => this.black?.classList.remove('on'));
    cue('title', 1.5, () => this.ui.title({ text: this.titleText }));
    cue('title-off', 7, () => this.ui.title(null));
    cue('crew1', 3.2, () => this.say?.('sola.crew1'));
    this.credits?.forEach((c, i) => {
      cue(`credit${i}`, 8.5 + i * 5, () => this.ui.credit(c));
      cue(`credit${i}-off`, 12.5 + i * 5, () => this.ui.credit(null));
    });
    cue('crew2', 10, () => this.say?.('sola.crew2'));
    cue('out', LENGTH - 1.2, () => this.black?.classList.add('on'));
  }
}
