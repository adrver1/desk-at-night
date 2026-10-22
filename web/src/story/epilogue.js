// The epilogue: the camera pulls back from your chair, out through the
// window, to the whole platform at night, the knowledge graph glowing on the
// band inside. A clear, starry, windless night, so the lit platform and the
// supply vessel alongside it lie mirrored in a glassy sea. The platform is the intro's model (blender/intro_export.py),
// set into the room's frame with the same matrix the supply vessel uses.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { reflectable } from '../outdoor.js';

const FLIGHT = 16;   // s from the chair to the last frame
const FLOOD = new THREE.Color(0xffd9a0).multiplyScalar(0.55), FLOOD_LOW = new THREE.Color(0xffd9a0).multiplyScalar(0.18);   // the platform's own floodlights

export class Epilogue {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.loaded = null;
    this.on = false;
    this.t = 0;
    game.hooks.render.push((renderer, camera) => { if (this.on && this.root) renderer.render(this.scene, camera); });
  }

  load() {
    this.loaded ??= (async () => {
      const [gltf, info] = await Promise.all([
        new GLTFLoader().loadAsync('intro/platform.glb'),
        fetch('control/vessel.json').then((r) => r.json()),
      ]);
      const root = gltf.scene;
      root.matrixAutoUpdate = false;
      // toRoom takes Blender's platform axes (z up); the glb is y up
      const yUp = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
      root.matrix.fromArray(info.toRoom).multiply(yUp);
      // Under water is the sea's business; and leave a hole where our window
      // is, so the room (and the band) shows through from outside
      const sea = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.game.room.seaLevel);
      this.game.renderer.localClippingEnabled = true;
      this.glow = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.clippingPlanes = [sea];
        o.material.side = THREE.DoubleSide;
        if (o.material.emissive?.getHex()) this.glow.push(o.material);
        o.material.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
            .replace('void main() {', 'varying vec3 vWorldPos;\nvoid main() {');
          sh.fragmentShader = sh.fragmentShader.replace('void main() {', `varying vec3 vWorldPos;\nvoid main() {
            if (vWorldPos.x > -6.4 && vWorldPos.x < -4.6 && vWorldPos.y > 0.8 && vWorldPos.y < 2.5 && vWorldPos.z > -2.65 && vWorldPos.z < 2.45) discard;`);
        };
      });
      this.scene.add(root);
      root.updateMatrixWorld(true);
      reflectable(this.scene);   // the platform and its lights, in the sea's mirror
      this.root = root;
      this.centre = new THREE.Vector3(-4, -24, -38);   // the middle of the topsides, in the room's frame
      const out = new THREE.Vector3(-1, 0, 0);   // the window looks out along -x
      const seat = new THREE.Vector3(-1.13, 1.18, -1.27);
      this.path = new THREE.CatmullRomCurve3([
        seat, new THREE.Vector3(-3.6, 1.5, -0.2), new THREE.Vector3(-5.4, 1.6, 0.1),
        // then out and down, to end low over the water: from up high a calm sea
        // reflects only a few percent, at a glancing angle most of the light
        new THREE.Vector3(-12, 2.0, 0.5), new THREE.Vector3(-45, -2, 10), new THREE.Vector3(-120, -22, 25), new THREE.Vector3(-215, -36, 30),
      ], false, 'centripetal');
      this.windowAt = new THREE.Vector3(-5.4, 1.4, 0.1).addScaledVector(out, 60);
    })();
    return this.loaded;
  }

  show() {
    if (this.on) return;   // the OIM's line plays over the flight that is already running
    this.on = true;
    // Calm and clear: no cloud, fog, rain, wind or swell; the vessel alongside, lit
    const o = this.game.outdoor3, v = this.game.vessel;
    this.was = { weather: { ...o.state }, vessel: v?.mode };
    o.set({ clouds: 0, fog: 0, rain: 0, wind: -3 / 22, swellHs: 0 });   // wind 0 m/s (3 + 22 w)
    if (v) v.mode = 'alongside';
    if (!this.game.hooks.reflect.includes(this.scene)) this.game.hooks.reflect.push(this.scene);
    this.t0 = performance.now();
  }

  hide() {
    if (!this.on) return;
    this.on = false;
    const r = this.game.hooks.reflect, i = r.indexOf(this.scene);
    if (i >= 0) r.splice(i, 1);
    if (this.was) {
      const { clouds, fog, rain, wind, swellHs } = this.was.weather;
      this.game.outdoor3.set({ clouds, fog, rain, wind, swellHs });
      if (this.game.vessel && this.was.vessel) this.game.vessel.mode = this.was.vessel;
    }
  }

  // The camera's pose at time t of the flight: level through the window,
  // then turning round and down onto the whole platform as it climbs away
  pose() {
    const u = Math.min(1, this.t / FLIGHT), k = u * u * (3 - 2 * u);
    const pos = this.path.getPoint(k);
    const look = this.windowAt.clone().lerp(this.centre, THREE.MathUtils.smoothstep(k, 0.18, 0.7));
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0));
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m), fov: THREE.MathUtils.lerp(70, 50, THREE.MathUtils.smoothstep(k, 0, 0.5)) };
  }

  update(dt) {
    if (!this.on || !this.root) return;
    this.t = (performance.now() - this.t0) / 1000;   // wall clock, so a slow frame rate doesn't stretch it
    const L = this.game.outdoor3.light;
    // The sky, plus the platform's own floodlights at night
    this.hemi.color.copy(L.sky).multiplyScalar(Math.PI).add(FLOOD);
    this.hemi.groundColor.copy(L.sky).multiplyScalar(0.3).add(FLOOD_LOW);
    this.sun.color.copy(L.sun);
    this.sun.position.copy(this.centre).addScaledVector(L.sunDir, 100);
    this.sun.target.position.copy(this.centre);
    for (const m of this.glow) m.emissiveIntensity = 2.6;   // deck lights on at night
  }
}
