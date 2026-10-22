// The supply vessel (blender/supply_vessel.py): it sails in from the sea,
// turns, crabs sideways under the platform crane and holds station there on
// dynamic positioning, rolling and heaving with the swell, then leaves.
// One visit a day by the game clock (SCHEDULE), or on demand (callIn).
//
// The same model is drawn twice: in the room's scene, seen through the
// window, and in the CCTV cameras' scene (cctv.js). Positions are worked out
// in platform coordinates (metres, +Z up, the berth from vessel.json) and
// mapped into the room's frame with its toRoom matrix.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Game-clock hours: start of the approach, alongside, start of the departure, gone
export const SCHEDULE = [6.75, 7.0, 10.0, 10.25];
// Called in on demand: seconds for the approach, alongside, the departure
const ON_DEMAND = [120, 300, 75];
const CRAB = 0.25;     // share of the approach spent crabbing in sideways (and of the departure crabbing out)
const RADAR_RPM = [24, 30];
// The platform crane (cctv.js's CraneSlew) swings its boom out over the
// cargo deck while the vessel is alongside: degrees a second, and the deck
// spot it aims at, metres aft of the vessel's middle (its cargo deck)
const SLEW_RATE = 2.5, CRANE_AIM = 22;

// Bezier paths in platform coordinates, relative to the berth (bx, by).
// The approach comes up from the south-east bow first and ends heading -X
// (the berth heading) 30 m out; the departure leaves westward.
const APPROACH = (bx, by) => [[bx + 400, by - 2150], [bx + 380, by - 350], [bx + 170, by - 30], [bx + 50, by - 30]];
const DEPART = (bx, by) => [[bx - 30, by - 30], [bx - 200, by - 30], [bx - 450, by - 260], [bx - 520, by - 2400]];

function bezier(p, t, out) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  out.x = a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0];
  out.y = a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1];
  // Heading along the curve's tangent
  const dx = 3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]);
  const dy = 3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]);
  out.yaw = Math.atan2(dy, dx);
  return out;
}

// Arc-length table so the vessel moves at an even speed along a path
function arcTable(p, n = 64) {
  const s = [0], q = {}, prev = bezier(p, 0, {});
  let len = 0;
  for (let i = 1; i <= n; i++) {
    bezier(p, i / n, q);
    len += Math.hypot(q.x - prev.x, q.y - prev.y);
    s.push(len);
    prev.x = q.x; prev.y = q.y;
  }
  return s.map((v) => v / len);
}
function atDistance(table, f) {
  let i = 1;
  while (i < table.length - 1 && table[i] < f) i++;
  const t0 = table[i - 1], t1 = table[i];
  return (i - 1 + (f - t0) / Math.max(t1 - t0, 1e-9)) / (table.length - 1);
}

const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

export class SupplyVessel {
  static async load(base = 'control/') {
    const [gltf, info] = await Promise.all([
      new GLTFLoader().loadAsync(`${base}vessel.glb`),
      fetch(`${base}vessel.json`).then((r) => r.json()),
    ]);
    return new SupplyVessel(gltf.scene, info);
  }

  constructor(model, info) {
    this.info = info;
    this.toRoom = new THREE.Matrix4().fromArray(info.toRoom);
    // The model is y-up (glTF); poses are built z-up, so undo that on the right
    this.yUp = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const [bx, by, byaw] = info.berth;
    this.berth = { x: bx, y: by, yaw: byaw };
    this.approach = APPROACH(bx, by);
    this.depart = DEPART(bx, by);
    this.tables = [arcTable(this.approach), arcTable(this.depart)];
    this.copies = [];
    this.model = model;
    // ?vessel=alongside keeps it at the berth, =call calls it in now, =off hides it
    this.mode = new URLSearchParams(location.search).get('vessel') ?? 'schedule';
    this.demand = this.mode === 'call' ? 0 : null; // seconds since it was called in, or null
    this.phase = 'away';
    this.t = 0;
    this.pose = { x: bx, y: by, yaw: byaw };
    this.crane = null;
  }

  // The crane's turning part: rotated about the world's up axis from where
  // it was exported (boom stowed toward platform -X)
  attachCrane(obj) {
    const [cx, cy] = this.info.crane, B = this.berth;
    // Platform heading from the crane to the cargo deck, less the stowed heading
    const ax = B.x - CRANE_AIM * Math.cos(B.yaw), ay = B.y - CRANE_AIM * Math.sin(B.yaw);
    const out = Math.atan2(ay - cy, ax - cx) - Math.PI;
    this.crane = { obj, rest: obj.quaternion.clone(), out: Math.atan2(Math.sin(out), Math.cos(out)), angle: 0 };
    if (this.mode === 'alongside') this.crane.angle = this.crane.out;
  }

  // A copy of the model for one scene. `fog` gives it the outdoor fog (the
  // room's scene has none of its own); `seaLevel` (y in the room's frame)
  // clips what is under the water, which the CCTV pictures would show.
  copy({ seaLevel, fog = false, lights = false }) {
    const root = this.model.clone(true);
    root.matrixAutoUpdate = false;
    const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -seaLevel)];
    const glowing = [], radars = [];
    root.traverse((o) => {
      if (o.name.startsWith('PsvRadar')) radars.push(o);
      if (!o.isMesh) return;
      const src = o.material;
      const m = fog
        ? new THREE.MeshLambertMaterial({ color: src.color, emissive: src.emissive, emissiveIntensity: src.emissiveIntensity })
        : src.clone();
      m.clippingPlanes = clip;
      m.side = THREE.DoubleSide;
      if (fog) addFog(m, this);
      if (m.emissive?.getHex()) glowing.push([m, m.emissiveIntensity]);
      o.material = m;
    });
    const group = new THREE.Group();
    group.add(root);
    if (lights) {
      // The room's own surfaces are baked; only the vessel uses these
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
      this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
      group.add(this.hemi, this.sun, this.sun.target);
    }
    const c = { group, root, glowing, radars };
    this.copies.push(c);
    return group;
  }

  // Call the vessel in now (or send it away if it is already here)
  callIn() {
    if (this.phase === 'away' || this.phase === 'departing') this.demand = 0;
    else this.demand = ON_DEMAND[0] + ON_DEMAND[1]; // skip to its departure
    if (this.mode !== 'schedule') this.mode = 'schedule';
  }

  // What it is doing and until when, for the panel
  status(hours) {
    const fmt = (h) => `${String(Math.floor(h % 24)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    if (this.demand !== null) {
      const left = ON_DEMAND[0] + ON_DEMAND[1] - this.demand;
      if (this.phase === 'approaching') return 'Supply vessel coming in';
      if (this.phase === 'alongside') return `Supply vessel alongside, leaves in ${Math.max(1, Math.round(left / 60))} min`;
      if (this.phase === 'departing') return 'Supply vessel leaving';
    }
    if (this.mode === 'alongside') return 'Supply vessel alongside';
    if (this.phase === 'approaching') return `Supply vessel arriving ${fmt(SCHEDULE[1])}`;
    if (this.phase === 'alongside') return `Supply vessel alongside until ${fmt(SCHEDULE[2])}`;
    if (this.phase === 'departing') return 'Supply vessel leaving';
    return `Next supply vessel ${fmt(SCHEDULE[1])}`;
  }

  // Where it is: phase and progress through it (0..1)
  where(hours) {
    if (this.mode === 'off') return ['away', 0];
    if (this.mode === 'alongside') return ['alongside', 0];
    if (this.demand !== null) {
      const [a, b, c] = ON_DEMAND, s = this.demand;
      if (s < a) return ['approaching', s / a];
      if (s < a + b) return ['alongside', (s - a) / b];
      if (s < a + b + c) return ['departing', (s - a - b) / c];
      this.demand = null;
    }
    const [h0, h1, h2, h3] = SCHEDULE;
    if (hours >= h0 && hours < h1) return ['approaching', (hours - h0) / (h1 - h0)];
    if (hours >= h1 && hours < h2) return ['alongside', (hours - h1) / (h2 - h1)];
    if (hours >= h2 && hours < h3) return ['departing', (hours - h2) / (h3 - h2)];
    return ['away', 0];
  }

  // dt in seconds; outdoor is outdoor.js (its clock, wind and light)
  update(dt, outdoor) {
    this.t += dt;
    if (this.demand !== null) this.demand += dt;
    const [phase, f] = this.where(outdoor.state.time);
    this.phase = phase;
    const visible = phase !== 'away';
    for (const c of this.copies) c.group.visible = visible;
    this.slew(dt, phase === 'alongside');
    if (!visible) return;

    const p = this.pose, B = this.berth, [ta, td] = this.tables;
    if (phase === 'approaching') {
      // Sail in slowing down (ease-out), then crab sideways onto the berth
      if (f < 1 - CRAB) {
        const g = f / (1 - CRAB);
        bezier(this.approach, atDistance(ta, 1 - (1 - g) * (1 - g)), p);
      } else {
        const g = smooth((f - (1 - CRAB)) / CRAB), e = this.approach[3];
        p.x = e[0] + (B.x - e[0]) * g; p.y = e[1] + (B.y - e[1]) * g; p.yaw = B.yaw;
      }
    } else if (phase === 'departing') {
      if (f < CRAB) {
        const g = smooth(f / CRAB), s = this.depart[0];
        p.x = B.x + (s[0] - B.x) * g; p.y = B.y + (s[1] - B.y) * g; p.yaw = B.yaw;
      } else {
        const g = (f - CRAB) / (1 - CRAB);
        bezier(this.depart, atDistance(td, g * g), p);
      }
    } else {
      p.x = B.x; p.y = B.y; p.yaw = B.yaw;
    }
    // Unwrap the heading so it turns the short way from the berth heading
    p.yaw = B.yaw + Math.atan2(Math.sin(p.yaw - B.yaw), Math.cos(p.yaw - B.yaw));

    // Dynamic positioning: small slow drifts around the target; the swell:
    // heave, roll and pitch growing with the wind
    const t = this.t, w = outdoor.state.wind ?? 0.3;
    const dp = phase === 'alongside' ? 1 : 0.3;
    const x = p.x + dp * 0.5 * Math.sin(t * 0.07 + 1.3);
    const y = p.y + dp * 0.6 * Math.sin(t * 0.05);
    const yaw = p.yaw + dp * THREE.MathUtils.degToRad(0.6) * Math.sin(t * 0.04 + 2.1);
    const heave = (0.25 + 1.1 * w) * (0.6 * Math.sin(t * 0.55) + 0.4 * Math.sin(t * 0.83 + 1));
    const roll = THREE.MathUtils.degToRad(0.8 + 5 * w) * (0.7 * Math.sin(t * 0.45 + 0.5) + 0.3 * Math.sin(t * 0.71));
    const pitch = THREE.MathUtils.degToRad(0.3 + 1.6 * w) * Math.sin(t * 0.6 + 2);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, heave),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX')),
      new THREE.Vector3(1, 1, 1),
    );
    m.premultiply(this.toRoom).multiply(this.yUp);

    // Lit windows, floodlights and nav lights: full at night, faint by day
    const L = outdoor.light;
    const lsky = L.sky.r * 0.2126 + L.sky.g * 0.7152 + L.sky.b * 0.0722;
    const night = 1 - THREE.MathUtils.smoothstep(lsky, 0.01, 0.15);
    const spin = (i) => (this.t * RADAR_RPM[i] / 60) * Math.PI * 2;
    for (const c of this.copies) {
      c.root.matrix.copy(m);
      c.root.matrixWorldNeedsUpdate = true;
      for (const [mat, k] of c.glowing) mat.emissiveIntensity = k * (0.03 + 0.97 * night);
      c.radars.forEach((r, i) => { r.rotation.y = spin(i % 2); });
    }
    if (this.hemi) {
      // By night the deck floodlights light the vessel up a little
      this.hemi.color.copy(L.sky).multiplyScalar(Math.PI).add(FLOOD.clone().multiplyScalar(night));
      this.hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
      this.sun.color.copy(L.sun);
      const at = new THREE.Vector3().setFromMatrixPosition(m);
      this.sun.position.copy(at).addScaledVector(L.sunDir, 200);
      this.sun.target.position.copy(at);
      this.sun.target.updateMatrixWorld();
      this.fog.color.copy(L.fog);
      this.fog.density.value = Math.LN2 / L.fogDistance;
    }
  }
}

SupplyVessel.prototype.slew = function slew(dt, out) {
  const c = this.crane;
  if (!c) return;
  // Out over the deck while alongside, with slow small swings as if lifting
  // cargo; back to the rest when it leaves
  const target = out ? c.out + THREE.MathUtils.degToRad(7) * Math.sin(this.t * 0.03) : 0;
  const step = THREE.MathUtils.degToRad(SLEW_RATE) * dt;
  c.angle += THREE.MathUtils.clamp(target - c.angle, -step, step);
  c.obj.quaternion.setFromAxisAngle(UP, c.angle).multiply(c.rest);
};
const UP = new THREE.Vector3(0, 1, 0);
const FLOOD = new THREE.Color(0.35, 0.3, 0.22);

// Exponential fog by distance from the camera, from outdoor.js, on a Lambert
// material (the room's scene has no THREE.Fog of its own: its baked
// surfaces do their own)
function addFog(m, vessel) {
  vessel.fog ??= { color: new THREE.Color(), density: { value: 0 } };
  const f = vessel.fog;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uVFogColor = { value: f.color };
    sh.uniforms.uVFogDensity = f.density;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vVFogDepth;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvVFogDepth = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vVFogDepth;\nuniform vec3 uVFogColor;\nuniform float uVFogDensity;')
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uVFogColor, 1.0 - exp(-uVFogDensity * vVFogDepth));');
  };
}

// The panel's row: what the vessel is doing and a button to call it in
export function vesselControls(root, vessel, outdoor) {
  const row = document.createElement('div');
  row.className = 'vessel-row';
  const label = document.createElement('span');
  label.className = 'slider-label';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost';
  btn.addEventListener('click', () => { vessel.callIn(); show(); });
  row.append(label, btn);
  root.append(row);
  function show() {
    label.textContent = vessel.status(outdoor.state.time);
    btn.textContent = vessel.phase === 'away' || vessel.phase === 'departing' ? 'Call the supply vessel' : 'Send it away';
  }
  show();
  setInterval(show, 1000);
}

// Load the vessel into a page: seen through the window (scene), in the CCTV
// pictures once cctv (a promise of cctv.js's Cctv or null) is ready, with its
// row on the panel (an element). Resolves to the vessel, for update().
export async function addVessel({ renderer, scene, room, outdoor, cctv, panel }) {
  const vessel = await SupplyVessel.load();
  renderer.localClippingEnabled = true;
  scene.add(vessel.copy({ seaLevel: room.seaLevel, fog: true, lights: true }));
  if (panel) vesselControls(panel, vessel, outdoor);
  cctv.then((c) => {
    if (!c) return;
    c.scene.add(vessel.copy({ seaLevel: room.seaLevel }));
    const crane = c.scene.getObjectByName('CraneSlew');
    if (crane) vessel.attachCrane(crane);
  }).catch(() => {});
  return vessel;
}
