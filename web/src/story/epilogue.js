// The epilogue: the camera pulls back from your chair, out through the
// window, to the whole platform at night, the knowledge graph glowing on the
// band inside. A clear, starry, windless night, so the lit platform and the
// supply vessel alongside it lie mirrored in a glassy sea. The platform is the intro's model (blender/intro_export.py),
// set into the room's frame with the same matrix the supply vessel uses.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { reflectable } from '../outdoor.js';

const FLIGHT = 16;   // s from the chair to the last frame
const FLOOD = new THREE.Color(0xffd9a0).multiplyScalar(0.22), FLOOD_LOW = new THREE.Color(0xffd9a0).multiplyScalar(0.08);   // the platform's lights, overall
// The glb carries the night materials with their emission off (the intro is
// by day), so they are lit here by name: colour, strength, halo colour
const NIGHT = {
  PlatLampWhite: [0xdde9ff, 6, 0xcfe0ff], PlatLamp: [0xffd49a, 6, 0xffc070],
  PlatWindow: [0xffd9a0, 1.4], PlatRed: [0xff2010, 4, 0xff3018],
};
const SPOTS = 8;   // point lights at the floodlights, so the decks around them are lit, the rest dark

// A soft round glow, for the halo round each fitting
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,0.6)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.12)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Centres of the little boxes in a mesh: its vertices bunched on a 1.5 m grid
function fittings(mesh) {
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3(), cells = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const k = `${Math.round(v.x / 1.5)},${Math.round(v.y / 1.5)},${Math.round(v.z / 1.5)}`;
    const c = cells.get(k) ?? cells.set(k, { p: new THREE.Vector3(), n: 0 }).get(k);
    c.p.add(v); c.n++;
  }
  return [...cells.values()].map((c) => c.p.divideScalar(c.n));
}

export class Epilogue {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.name = 'epilogue';   // names the pass in the perf overlay
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
      root.updateMatrixWorld(true);
      const halos = {}, floods = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        const night = NIGHT[o.material.name];
        if (night) {
          o.material.emissive.set(night[0]);
          o.material.emissiveIntensity = night[1];
          if (night[2]) {
            const at = fittings(o).filter((p) => p.y > this.game.room.seaLevel + 1);
            (halos[night[2]] ??= []).push(...at);
            if (o.material.name === 'PlatLamp') floods.push(...at);
          }
        }
        o.material.clippingPlanes = [sea];
        o.material.side = THREE.DoubleSide;
        if (o.material.name === 'PlatFlare') this.glow.push(o.material);
        o.material.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
            .replace('void main() {', 'varying vec3 vWorldPos;\nvoid main() {');
          sh.fragmentShader = sh.fragmentShader.replace('void main() {', `varying vec3 vWorldPos;\nvoid main() {
            if (vWorldPos.x > -6.4 && vWorldPos.x < -4.6 && vWorldPos.y > 0.8 && vWorldPos.y < 2.5 && vWorldPos.z > -2.65 && vWorldPos.z < 2.45) discard;`);
        };
      });
      this.scene.add(root);
      // A halo round every fitting, so the lights read from far off and in the sea
      const tex = haloTexture();
      for (const [color, at] of Object.entries(halos)) {
        const geo = new THREE.BufferGeometry().setFromPoints(at);
        const size = color == 0xff3018 ? 4 : 3.2, mat = new THREE.PointsMaterial({
          map: tex, color: Number(color), size, sizeAttenuation: true,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const pts = new THREE.Points(geo, mat);
        // Point sizes go by the canvas height, so in the sea's smaller mirror
        // target they would come out too big: scale them down to match
        pts.onBeforeRender = (r) => { const rt = r.getRenderTarget(); mat.size = rt ? size * rt.height / r.domElement.height : size; };
        this.scene.add(pts);
      }
      // Light pools round the biggest floodlights, a few metres out from the steel
      const picked = [];
      for (const p of floods.sort((a, b) => b.y - a.y)) if (picked.length < SPOTS && picked.every((q) => q.distanceTo(p) > 18)) picked.push(p);
      for (const p of picked) {
        const l = new THREE.PointLight(0xffd8a8, 350, 40, 1.6);
        l.position.copy(p);
        this.scene.add(l);
      }
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
    for (const m of this.glow) m.emissiveIntensity = 2.6;   // the flare
  }
}
