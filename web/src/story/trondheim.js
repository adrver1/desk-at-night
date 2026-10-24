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

const BASE = 'story/trondheim/';
const GLIDE = 14;   // s from the drone view down to the door
const SKY = 0xf1f3f4;
// Blender's frame (x east, y north, z up) to three's (y up, north along -z)
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
// The cameras of preview_trondheim.py: B is fitted to Adriaen's drone photo
// over the south-east corner, A stands at the Føniks door looking at it
const CAM = {
  B: V(79.3, -47.1, 48.1), B_AT: V(-20, 10, 4),
  A: V(-28.5, 30.5, 1.7), A_AT: V(-44.5, 37.5, 2.7),
  ME: V(-33.5, 31.5, 0),   // Adriaen by the fountain, turned to the camera at A
};

export class Trondheim {
  constructor(host) {
    this.host = host;
    this.on = false;
    this.loaded = null;
  }

  load() {
    this.loaded ??= (async () => {
      const loader = new GLTFLoader();
      const [torvet, foniks, me] = await Promise.all([
        loader.loadAsync(`${BASE}torvet.glb`).catch((e) => { console.warn('trondheim: torvet.glb', e); return null; }),
        loader.loadAsync(`${BASE}foniks.glb`).catch((e) => { console.warn('trondheim: foniks.glb', e); return null; }),
        loadModel('bearded_operator').catch(() => null),   // one year ago: his own clothes, no PPE
      ]);
      const scene = this.scene = new THREE.Scene();
      scene.background = new THREE.Color(SKY);
      scene.fog = new THREE.Fog(SKY, 120, 420);   // the dream's horizon melts away
      scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b6ae, 2.2));
      const sun = new THREE.DirectionalLight(0xfff4e4, 2.2);
      sun.position.set(60, 90, 40);
      scene.add(sun, sun.target);
      for (const g of [torvet, foniks]) if (g) scene.add(g.scene);
      if (me) {
        const p = me.scene;
        p.position.copy(CAM.ME);
        p.rotation.y = Math.atan2(-(CAM.A.x - CAM.ME.x), -(CAM.A.z - CAM.ME.z));
        this.mixer = new THREE.AnimationMixer(p);
        const idle = THREE.AnimationClip.findByName(me.animations, 'idle');
        if (idle) this.mixer.clipAction(idle).play();
        scene.add(p);
      }
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
    return { pos, at, fov: THREE.MathUtils.lerp(50, 55, k) };
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
    this.mixer?.update(dt);
    const t = (now - this.t0) / 1000, p = this.pose(t), cam = this.camera;
    cam.position.copy(p.pos);
    cam.lookAt(p.at);
    // A breath of life once it has landed
    cam.rotateY(0.004 * Math.sin(t * 0.37));
    cam.rotateX(0.003 * Math.sin(t * 0.51 + 1));
    if (cam.fov !== p.fov) cam.fov = p.fov;
    cam.updateProjectionMatrix();
    r.render(this.scene, cam);
  }
}
