// The deck cameras' live pictures: the platform as they see it (cctv.glb, from
// blender/cctv_platform.py) under outdoor.js's sky, sea, sun, moon and fog,
// drawn in turn into small, coarse textures the wall screens show: a few
// pictures a second between them all, so they cost the room little. A
// picture is only taken while the room's frames come on time, and is drawn
// over two frames (the sky and sea, then the platform) into a spare target
// that is then copied to the screen's, so no one frame pays for all of it.
// The
// cameras see look B's flat sea, without its mirror (too small to see here).
// The pictures stay linear and bright; the screens' shader exposes them like
// a camera would (controlScene.js), and screens.js draws rain, noise and the
// caption over them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Helicopter } from './helicopter.js';
import { privateSigns } from './privateNames.js';

// Pixels across (16:9) and pictures a second for all the
// shown cameras together, taken in turn: ?cctv=256,3 sets both
const [WIDTH, HZ] = (new URLSearchParams(location.search).get('cctv') ?? '256,3').split(',').map(Number);
// The camera on a screen the player zooms in on: sharp and smooth, while
// the screen fills the view and little else is drawn
const FOCUS_WIDTH = 1024, FOCUS_HZ = 15;
// How the pictures look (?cctvlook=): sized (Adriaen's pick, 2026-11-01),
// filtered and antialiased, each taken as wide as its widest screen shows it
// (in steps of STEP, from WIDTH up to MAX_WIDTH); smooth, WIDTH across,
// filtered and antialiased; pixel, WIDTH across shown blocky (as before)
const LOOK = new URLSearchParams(location.search).get('cctvlook') ?? 'sized';
const MAX_WIDTH = 768, STEP = 128;
const FILTER = LOOK === 'pixel' ? THREE.NearestFilter : THREE.LinearFilter, SAMPLES = LOOK === 'pixel' ? 0 : 4;
// On time: within this much of the quickest recent frame (the display's
// refresh); after a late frame, wait for this many on time before the next
// picture, but never longer than MAX_WAIT seconds
const LATE = 1.2, SETTLE = 8, MAX_WAIT = 2;

// Copies a finished picture to the screen's target
const copy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { uTex: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D uTex; varying vec2 vUv; void main() { gl_FragColor = texture2D(uTex, vUv); }',
  depthTest: false, depthWrite: false,
}));
copy.frustumCulled = false;
const copyScene = new THREE.Scene().add(copy), copyCamera = new THREE.Camera();
copyScene.name = 'copy';

export class Cctv {
  // Resolves to null where the GPU can't render to a float texture
  static async load(renderer, outdoor, base = 'control/') {
    const ext = renderer.extensions;
    if (!ext.has('EXT_color_buffer_half_float') && !ext.has('EXT_color_buffer_float')) return null;
    const [gltf, info] = await Promise.all([
      new GLTFLoader().loadAsync(`${base}cctv.glb`),
      fetch(`${base}cctv.json`).then((r) => r.json()),
    ]);
    privateSigns(gltf.scene);
    return new Cctv(renderer, outdoor, gltf.scene, info);
  }

  constructor(renderer, outdoor, model, info) {
    this.renderer = renderer;
    this.outdoor = outdoor;
    this.scene = new THREE.Scene();
    this.scene.name = 'platform';   // pass names for the perf overlay (perf.js)
    this.model = model;   // the platform (gulls.js finds its way round it)
    this.scene.add(model);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.surface = outdoor.surface();   // the sea's surface hides what is under it
    this.scene.add(this.surface);
    this.scene.fog = new THREE.FogExp2(0x000000, 0);
    // The helicopter on the helideck: parked, rotors stopped (?heli=running to spin them)
    const q = new URLSearchParams(location.search).get('heli');
    this.heli = new Helicopter(model, { running: q === 'running' });
    // Lamps, lit windows, obstruction lights, flare pilot: exported at their
    // night strength, dimmed by day
    this.glowing = [];
    model.traverse((o) => {
      if (o.isMesh && o.material.emissive?.getHex()) this.glowing.push([o.material, o.material.emissiveIntensity]);
    });
    model.updateMatrixWorld(true);
    this.cams = Object.entries(info.cameras).map(([id, c]) => {
      const camera = new THREE.PerspectiveCamera(c.fov, 16 / 9, 0.5, 4000);
      camera.position.fromArray(c.position);
      camera.lookAt(new THREE.Vector3().fromArray(c.aim));
      camera.updateMatrixWorld();
      // A camera on a moving part (the crane boom's) rides along with it
      model.getObjectByName(c.parent ?? '')?.attach(camera);
      const target = new THREE.WebGLRenderTarget(WIDTH, Math.round(WIDTH * 9 / 16), { type: THREE.HalfFloatType, magFilter: FILTER });
      target.texture.name = 'cctv feed';
      return { id, camera, target };
    });
    // id -> texture, for the screens
    this.feeds = Object.fromEntries(this.cams.map((c) => [c.id, c.target.texture]));
    // How much the cameras amplify: more at night, like an auto-exposure
    this.gain = { value: 1 };
    this.at = -Infinity;
    this.job = null;          // a picture half drawn: { cam, work }
    this.work = new Map();    // spare targets by width
    this.gaps = [];           // recent frame times, s
    this.onTime = 0;          // frames on time in a row
  }

  // Take the next camera's picture if one is due and the frames have time
  // to spare (t in seconds, once a frame); `shown` is the ids some screen
  // shows, so the others aren't drawn for nothing; `focus` the id of a
  // camera the player has zoomed in on, or null
  update(t, shown = null, focus = null) {
    if (this.lastT !== undefined) {
      const g = this.gaps;
      g.push(t - this.lastT);
      if (g.length > 120) g.shift();
      this.onTime = g.at(-1) <= Math.min(...g) * LATE + 0.001 ? this.onTime + 1 : 0;
    }
    this.lastT = t;
    if (this.job) { this.finish(); return; }
    if (focus !== (this.focus?.id ?? null)) {
      if (this.focus) this.resize(this.focus, WIDTH, FILTER);
      this.focus = this.cams.find((c) => c.id === focus) ?? null;
      if (this.focus) this.resize(this.focus, FOCUS_WIDTH, THREE.LinearFilter);
      this.focusAt = -Infinity;
    }
    const spare = this.onTime >= SETTLE;
    if (this.focus && t - this.focusAt >= 1 / FOCUS_HZ && (spare || t - this.focusAt > MAX_WAIT)) {
      this.focusAt = t;
      this.start(this.focus, t);
      return;
    }
    // The shown ones, and any not taken yet (so none is black when it turns
    // into view), the longest waiting first
    const cams = (shown ? this.cams.filter((c) => shown.has(c.id) || c.taken === undefined) : this.cams).filter((c) => c !== this.focus);
    if (!cams.length || t - this.at < 1 / HZ || !(spare || t - this.at > MAX_WAIT)) return;
    this.at = t;
    const cam = cams.reduce((a, c) => ((c.taken ?? -Infinity) < (a.taken ?? -Infinity) ? c : a));
    const px = LOOK === 'sized' && shown?.get?.(cam.id);
    this.start(cam, t, px ? THREE.MathUtils.clamp(Math.ceil(px / STEP) * STEP, WIDTH, MAX_WIDTH) : cam.target.width);
  }

  resize(cam, width, filter) {
    cam.target.texture.magFilter = filter;
    cam.target.setSize(width, Math.round(width * 9 / 16));
  }

  // First half of a picture: the sky and sea, into a spare target
  start(cam, t, width = cam.target.width) {
    cam.taken = t;
    this.heli.update(this.prevT === undefined ? 0 : t - this.prevT);
    this.prevT = t;
    const L = this.outdoor.light;
    this.hemi.color.copy(L.sky).multiplyScalar(Math.PI);
    this.hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
    this.sun.color.copy(L.sun);
    this.scene.fog.color.copy(L.fog);
    this.scene.fog.density = Math.LN2 / L.fogDistance;
    const lsky = L.sky.r * 0.2126 + L.sky.g * 0.7152 + L.sky.b * 0.0722;
    const night = 1 - THREE.MathUtils.smoothstep(lsky, 0.01, 0.15);
    for (const [m, k] of this.glowing) m.emissiveIntensity = k * (0.05 + 0.95 * night);
    this.gain.value = THREE.MathUtils.clamp(0.35 / Math.max(lsky, 1e-4), 0.25, 5);

    const at = cam.camera.getWorldPosition(new THREE.Vector3());
    this.sun.position.copy(at).addScaledVector(L.sunDir, 200);
    this.sun.target.position.copy(at);
    const height = Math.round(width * 9 / 16);
    let work = this.work.get(width);
    if (!work) {
      this.work.set(width, work = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: SAMPLES }));
      work.texture.name = 'cctv';
    }
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(work);
    this.outdoor.render(r, cam.camera); // clears, draws the sky and sea, clears depth
    r.setRenderTarget(prev);
    this.job = { cam, work, at };
  }

  // Second half, a frame later: the platform over it, then onto the screen
  finish() {
    const { cam, work, at } = this.job;
    this.job = null;
    // The room's own sea pass has been drawn since: put the surface back
    // under this camera, flat
    const u = this.outdoor.uniforms, displace = u.uDisplace.value;
    u.uDisplace.value = 0;
    this.surface.position.set(at.x, this.outdoor.seaLevel, at.z);
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(work);
    r.render(this.scene, cam.camera);
    copy.material.uniforms.uTex.value = work.texture;
    if (cam.target.width !== work.width) this.resize(cam, work.width, FILTER);   // a new size (sized look): only now, so the screen never shows an empty target
    r.setRenderTarget(cam.target);
    r.render(copyScene, copyCamera);
    r.setRenderTarget(prev);
    u.uDisplace.value = displace;
  }
}
