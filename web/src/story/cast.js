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
  desk2: { chair: 1 },
  besideDesk: { chair: 1, move: [-0.42, -1.12, 0.25] },   // Chair1 pulled up beside our desk, at [x, z, yaw]
  besideYou: { at: [0.1, -0.75], face: 'player' },
  behind: { at: [0.45, -0.2], face: 'player' },
  behindCeo: { at: [1.05, 0.25], face: 'player' },
  tableHead: { at: [0.95, 2.35], face: TABLE },
  table1: { at: [1.75, 1.6], face: TABLE },
  table2: { at: [2.55, 1.6], face: TABLE },
  table3: { at: [3.3, 2.0], face: TABLE },
};

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
export const loadModel = (name) => loader.loadAsync(`${BASE}${name}.glb`);
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
    this.chairHome = null;
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
      const act = Object.fromEntries(['idle', 'seated_idle', 'talk', 'blink'].map((n) => {
        const clip = THREE.AnimationClip.findByName(gltf.animations, n);
        return [n, clip && mixer.clipAction(clip)];
      }));
      if (act.blink) act.blink.setLoop(THREE.LoopOnce);
      if (act.talk) { act.talk.play(); act.talk.setEffectiveWeight(0); }
      const bones = {};
      p.traverse((o) => {
        if (o.isBone) bones[o.name] = o;
        if (o.isMesh) o.frustumCulled = false;
      });
      p.visible = false;
      this.scene.add(p);
      this.people[who] = { root: p, mixer, act, bones, pose: null, level: 0, mouth: null, blinkAt: Math.random() * 3, turn: 0 };
    }));
    const c = this.game.chairs[1]?.obj;
    if (c) this.chairHome = [c.position.x, c.position.z, c.rotation.y];
  }

  // Put everyone where `cast` ({ who: { at } }) says; those not named go away
  place(cast = {}) {
    const chair = this.game.chairs[1]?.obj;
    let moved = null;
    for (const [who, p] of Object.entries(this.people)) {
      const spot = SPOTS[cast[who]?.at];
      p.root.visible = Boolean(spot);
      if (!spot) continue;
      if (spot.chair !== undefined) {
        const c = this.game.chairs[spot.chair]?.obj;
        if (spot.move) moved = spot.move;
        const [x, z, yaw] = spot.move ?? [c.position.x, c.position.z, c.rotation.y];
        const f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        p.root.position.set(x + f.x * 0.06, 0, z + f.z * 0.06);
        p.root.rotation.set(0, yaw, 0);
        this.pose(p, 'seated_idle');
      } else {
        const [x, z] = spot.at;
        const to = spot.face === 'player' ? [this.game.chairs[0].obj.position.x, this.game.chairs[0].obj.position.z] : spot.face;
        p.root.position.set(x, 0, z);
        p.root.rotation.set(0, Math.atan2(-(to[0] - x), -(to[1] - z)), 0);
        this.pose(p, 'idle');
      }
    }
    // Chair1 goes where the operator pulled it, or back home
    if (chair && this.chairHome) {
      const [x, z, yaw] = moved ?? this.chairHome;
      chair.position.x = x; chair.position.z = z; chair.rotation.y = yaw;
    }
  }

  pose(p, name) {
    if (p.pose === name) return;
    const next = p.act[name];
    if (!next) return;
    next.reset().play();
    if (p.pose && p.act[p.pose]) p.act[p.pose].stop();
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
    }
  }
}
