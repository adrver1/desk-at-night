// The deck cameras' live pictures: the platform as they see it (cctv.glb, from
// blender/cctv_platform.py) under outdoor.js's sky, sea, sun, moon and fog,
// each drawn a few times a second into a small texture the wall screens show.
// The pictures stay linear and bright; the screens' shader exposes them like
// a camera would (controlScene.js), and screens.js draws rain, noise and the
// caption over them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const COARSE = matchMedia('(pointer: coarse)').matches;
const WIDTH = COARSE ? 384 : 512; // pixels across, 16:9
const HZ = 4;                     // pictures a second per camera, taken in turn

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
    this.scene.fog = new THREE.FogExp2(0x000000, 0);
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
      const target = new THREE.WebGLRenderTarget(WIDTH, Math.round(WIDTH * 9 / 16), { type: THREE.HalfFloatType });
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
  // is the ids some screen shows, so the others aren't drawn for nothing
  update(t, shown = null) {
    const cams = shown ? this.cams.filter((c) => shown.has(c.id)) : this.cams;
    if (!cams.length || t - this.at < 1 / (HZ * cams.length)) return;
    this.at = t;
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

    const cam = cams[this.next++ % cams.length];
    this.sun.position.copy(cam.camera.position).addScaledVector(L.sunDir, 200);
    this.sun.target.position.copy(cam.camera.position);
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(cam.target);
    this.outdoor.render(r, cam.camera); // clears, draws the sky and sea, clears depth
    r.render(this.scene, cam.camera);
    r.setRenderTarget(prev);
  }
}
