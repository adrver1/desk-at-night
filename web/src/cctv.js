// The deck cameras' live pictures: the platform as they see it (cctv.glb, from
// blender/cctv_platform.py) under outdoor.js's sky, sea, sun, moon and fog,
// drawn in turn into small, coarse textures the wall screens show: a few
// pictures a second between them all, so they cost the room little. The
// cameras see look B's flat sea, without its mirror (too small to see here).
// The pictures stay linear and bright; the screens' shader exposes them like
// a camera would (controlScene.js), and screens.js draws rain, noise and the
// caption over them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Helicopter } from './helicopter.js';

// Pixels across (16:9, shown pixelated) and pictures a second for all the
// shown cameras together, taken in turn: ?cctv=256,3 sets both
const [WIDTH, HZ] = (new URLSearchParams(location.search).get('cctv') ?? '256,3').split(',').map(Number);
// The camera on a screen the player zooms in on: sharp and smooth, while
// the screen fills the view and little else is drawn
const FOCUS_WIDTH = 1024, FOCUS_HZ = 15;

export class Cctv {
  // Resolves to null where the GPU can't render to a float texture
  static async load(renderer, outdoor, base = 'control/') {
    const ext = renderer.extensions;
    if (!ext.has('EXT_color_buffer_half_float') && !ext.has('EXT_color_buffer_float')) return null;
    const [gltf, info] = await Promise.all([
      new GLTFLoader().loadAsync(`${base}cctv.glb`),
      fetch(`${base}cctv.json`).then((r) => r.json()),
    ]);
    return new Cctv(renderer, outdoor, gltf.scene, info);
  }

  constructor(renderer, outdoor, model, info) {
    this.renderer = renderer;
    this.outdoor = outdoor;
    this.scene = new THREE.Scene();
    this.scene.add(model);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.scene.add(outdoor.surface());   // the sea's surface hides what is under it
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
    this.cams = Object.entries(info.cameras).map(([id, c]) => {
      const camera = new THREE.PerspectiveCamera(c.fov, 16 / 9, 0.5, 4000);
      camera.position.fromArray(c.position);
      camera.lookAt(new THREE.Vector3().fromArray(c.aim));
      camera.updateMatrixWorld();
      const target = new THREE.WebGLRenderTarget(WIDTH, Math.round(WIDTH * 9 / 16), { type: THREE.HalfFloatType, magFilter: THREE.NearestFilter });
      return { id, camera, target };
    });
    // id -> texture, for the screens
    this.feeds = Object.fromEntries(this.cams.map((c) => [c.id, c.target.texture]));
    // How much the cameras amplify: more at night, like an auto-exposure
    this.gain = { value: 1 };
    this.next = 0;  // whose turn it is
    this.at = -Infinity;
  }

  // Take the next camera's picture if one is due (t in seconds); `shown`
  // is the ids some screen shows, so the others aren't drawn for nothing;
  // `focus` the id of a camera the player has zoomed in on, or null
  update(t, shown = null, focus = null) {
    if (focus !== (this.focus?.id ?? null)) {
      if (this.focus) this.resize(this.focus, WIDTH, THREE.NearestFilter);
      this.focus = this.cams.find((c) => c.id === focus) ?? null;
      if (this.focus) this.resize(this.focus, FOCUS_WIDTH, THREE.LinearFilter);
      this.focusAt = -Infinity;
    }
    if (this.focus && t - this.focusAt >= 1 / FOCUS_HZ) {
      this.focusAt = t;
      this.draw(this.focus, t);
      return;
    }
    const cams = (shown ? this.cams.filter((c) => shown.has(c.id)) : this.cams).filter((c) => c !== this.focus);
    if (!cams.length || t - this.at < 1 / HZ) return;
    this.at = t;
    this.draw(cams[this.next++ % cams.length], t);
  }

  resize(cam, width, filter) {
    cam.target.texture.magFilter = filter;
    cam.target.setSize(width, Math.round(width * 9 / 16));
  }

  draw(cam, t) {
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

    this.sun.position.copy(cam.camera.position).addScaledVector(L.sunDir, 200);
    this.sun.target.position.copy(cam.camera.position);
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(cam.target);
    this.outdoor.render(r, cam.camera); // clears, draws the sky and sea, clears depth
    r.render(this.scene, cam.camera);
    r.setRenderTarget(prev);
  }
}
