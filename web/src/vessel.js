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
import { Wake } from './wake.js';
import { reflectable } from './outdoor.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Game-clock hours: start of the approach, alongside, start of the departure,
// gone. It is still coming in when the crew-change flight lands (11:00, the
// intro) and alongside when the game starts (11:30).
export const SCHEDULE = [10.75, 11.1, 14.0, 14.25];
// Called in on demand: seconds for the approach, alongside, the departure
const ON_DEMAND = [120, 300, 75];
const CRAB = 0.25;     // share of the approach spent crabbing in sideways (and of the departure crabbing out)
const RADAR_RPM = [24, 30];
// The platform crane (cctv.js's CraneSlew) swings its boom out over the
// cargo deck while the vessel is alongside: degrees a second, and the deck
// spot it aims at, metres aft of the vessel's middle (its cargo deck)
const SLEW_RATE = 2.5, CRANE_AIM = 22;

// Bezier paths in platform coordinates, from the berth (bx, by; the vessel
// alongside heads +X, true 240°). The approach comes in from the north-east
// (platform -X, a little -Y) bow first along the crane side and ends 60 m
// short of the berth and 30 m out; the departure carries on to the west.
const APPROACH = (bx, by) => [[-2125, -570], [-1000, by - 260], [bx - 260, by - 30], [bx - 60, by - 30]];
const DEPART = (bx, by) => [[bx, by - 30], [bx + 250, by - 30], [bx + 600, by - 250], [bx + 2400, by - 1100]];

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

const cache = new Map();
function pathsFor(B) {
  const key = `${B.x},${B.y}`;
  if (!cache.has(key)) {
    const approach = APPROACH(B.x, B.y), depart = DEPART(B.x, B.y);
    cache.set(key, { approach, depart, ta: arcTable(approach), td: arcTable(depart) });
  }
  return cache.get(key);
}

// Where the vessel is f (0..1) of the way through its approach to the berth
// ({x, y, yaw} in platform coordinates, metres and radians): sailing in and
// slowing down, then crabbing sideways onto the berth. Shared with the intro.
export function approachPose(B, f, p = {}) {
  const { approach, ta } = pathsFor(B);
  if (f < 1 - CRAB) {
    const g = clamp01(f / (1 - CRAB));
    bezier(approach, atDistance(ta, 1 - (1 - g) * (1 - g)), p);
  } else {
    const g = smooth(clamp01((f - (1 - CRAB)) / CRAB)), e = approach[3];
    p.x = e[0] + (B.x - e[0]) * g; p.y = e[1] + (B.y - e[1]) * g; p.yaw = B.yaw;
  }
  return p;
}

// And f of the way through leaving: crabbing out, then sailing off
export function departPose(B, f, p = {}) {
  const { depart, td } = pathsFor(B);
  if (f < CRAB) {
    const g = smooth(clamp01(f / CRAB)), s = depart[0];
    p.x = B.x + (s[0] - B.x) * g; p.y = B.y + (s[1] - B.y) * g; p.yaw = B.yaw;
  } else {
    const g = clamp01((f - CRAB) / (1 - CRAB));
    bezier(depart, atDistance(td, g * g), p);
  }
  return p;
}

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
  // room's scene has none of its own); what is under its waterline is
  // clipped away (the plane rides with it), which the pictures would show
  // over the sea; `outdoor`: the Outdoor whose waves its wake rides.
  copy({ seaLevel, fog = false, lights = false, outdoor = null }) {
    const root = this.model.clone(true);
    root.matrixAutoUpdate = false;
    this.waterline ??= new THREE.Plane(new THREE.Vector3(0, 1, 0), -seaLevel);
    const clip = [this.waterline];
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
    // The wake, laid in the platform's frame
    this.wakeFog ??= { color: new THREE.Color(), density: { value: 0 } };
    const wake = new Wake({ length: this.info.length ?? 88, fog: this.wakeFog, sea: outdoor?.surfaceUniforms });
    const sea = new THREE.Group();
    sea.matrixAutoUpdate = false;
    sea.matrix.copy(this.toRoom);
    sea.add(wake.mesh);
    group.add(sea);
    const c = { group, root, glowing, radars, wake };
    this.copies.push(c);
    if (!lights) return group;
    // The room's own surfaces are baked; the vessel and the story's desk
    // phones use these. Outside `group`, so they stay while the vessel is
    // away: the room's scene keeps the same lights, and so the same shaders,
    // all day (a light going away recompiled the phones on a beat change)
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    const outer = new THREE.Group();
    outer.add(group, this.hemi, this.sun, this.sun.target);
    return outer;
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
    if (!visible) {
      for (const c of this.copies) c.wake.clear();
      this.last = null;
      this.light(outdoor.light, this.sun?.target.position);
      return;
    }

    const p = this.pose, B = this.berth;
    if (phase === 'approaching') approachPose(B, f, p);
    else if (phase === 'departing') departPose(B, f, p);
    else { p.x = B.x; p.y = B.y; p.yaw = B.yaw; }
    // Unwrap the heading so it turns the short way from the berth heading
    p.yaw = B.yaw + Math.atan2(Math.sin(p.yaw - B.yaw), Math.cos(p.yaw - B.yaw));
    // Speed through the water, smoothed, for the wake; when it first shows
    // up or the clock jumps, lay the wake it would have left behind it
    const jump = !this.last || Math.hypot(p.x - this.last.x, p.y - this.last.y) > 100;
    const moved = !jump && dt > 0 ? Math.hypot(p.x - this.last.x, p.y - this.last.y) / dt : 0;
    this.speed = jump ? this.trackSpeed(phase, f) : THREE.MathUtils.lerp(this.speed, Math.min(moved, 12), 1 - Math.exp(-dt * 2));
    this.last = { x: p.x, y: p.y };
    if (jump) {
      const past = this.pastTrack(phase, f);
      for (const c of this.copies) c.wake.seed(past);
    }

    // Dynamic positioning: small slow drifts around the target; the waves:
    // it floats on the sea outdoor.js draws, heaving, pitching and rolling
    // with the surface under its bow, stern and sides, a little slower than
    // the water (a ship this size doesn't follow every wave)
    const t = this.t;
    const dp = phase === 'alongside' ? 1 : 0.3;
    const x = p.x + dp * 0.5 * Math.sin(t * 0.07 + 1.3);
    const y = p.y + dp * 0.6 * Math.sin(t * 0.05);
    const yaw = p.yaw + dp * THREE.MathUtils.degToRad(0.6) * Math.sin(t * 0.04 + 2.1);
    const fl = floatOn(outdoor, this.toRoom, x, y, yaw, this.info.length ?? 88, BEAM);
    const k = jump ? 1 : 1 - Math.exp(-dt / 0.8);
    this.float ??= { ...fl };
    for (const key of ['heave', 'pitch', 'roll']) this.float[key] += (fl[key] - this.float[key]) * k;
    const { heave, pitch, roll } = this.float;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, heave),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(roll, pitch, yaw, 'ZYX')),
      new THREE.Vector3(1, 1, 1),
    );
    m.premultiply(this.toRoom);
    // Clip at its own waterline, tilted with it
    const up = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize();
    this.waterline?.setFromNormalAndCoplanarPoint(up, new THREE.Vector3().setFromMatrixPosition(m));
    m.multiply(this.yUp);

    // Lit windows, floodlights and nav lights: full at night, faint by day
    const L = outdoor.light;
    const lsky = L.sky.r * 0.2126 + L.sky.g * 0.7152 + L.sky.b * 0.0722;
    const night = 1 - THREE.MathUtils.smoothstep(lsky, 0.01, 0.15);
    const spin = (i) => (this.t * RADAR_RPM[i] / 60) * Math.PI * 2;
    // Foam takes the light of the sky and sun
    this.foam ??= new THREE.Color();
    this.foam.copy(L.sun).multiplyScalar(0.5 * Math.max(0, L.sunDir.y)).add(L.sky.clone().multiplyScalar(Math.PI));
    this.wakeFog.density.value = Math.LN2 / L.fogDistance;
    for (const c of this.copies) {
      c.wake.update(dt, p.x, p.y, p.yaw, this.speed);
      c.wake.uniforms.uFoam.value.copy(this.foam);
      c.root.matrix.copy(m);
      c.root.matrixWorldNeedsUpdate = true;
      for (const [mat, k] of c.glowing) mat.emissiveIntensity = k * (0.03 + 0.97 * night);
      c.radars.forEach((r, i) => { r.rotation.y = spin(i % 2); });
    }
    this.light(L, new THREE.Vector3().setFromMatrixPosition(m));
  }

  // The lights of the copy that has them, from outdoor.js's light, aimed at `at`
  light(L, at) {
    if (!this.hemi) return;
    const lsky = L.sky.r * 0.2126 + L.sky.g * 0.7152 + L.sky.b * 0.0722;
    const night = 1 - THREE.MathUtils.smoothstep(lsky, 0.01, 0.15);
    // By night the deck floodlights light the vessel up a little
    this.hemi.color.copy(L.sky).multiplyScalar(Math.PI).add(FLOOD.clone().multiplyScalar(night));
    this.hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
    this.sun.color.copy(L.sun);
    this.sun.position.copy(at).addScaledVector(L.sunDir, 200);
    this.sun.target.position.copy(at);
    this.sun.target.updateMatrixWorld();
    this.fog.color.copy(L.fog);
    this.fog.density.value = Math.LN2 / L.fogDistance;
  }
}

// How long the phase lasts in seconds of game time
SupplyVessel.prototype.duration = function duration(phase) {
  const i = { approaching: 0, alongside: 1, departing: 2 }[phase];
  return this.demand !== null ? ON_DEMAND[i] : (SCHEDULE[i + 1] - SCHEDULE[i]) * 3600;
};

SupplyVessel.prototype.poseAt = function poseAt(phase, f, p = {}) {
  const B = this.berth;
  if (phase === 'approaching') return approachPose(B, f, p);
  if (phase === 'departing') return departPose(B, f, p);
  return Object.assign(p, B);
};

// Speed in m/s at progress f through a phase
SupplyVessel.prototype.trackSpeed = function trackSpeed(phase, f) {
  if (phase === 'alongside') return 0;
  const a = this.poseAt(phase, Math.max(0, f - 0.005)), b = this.poseAt(phase, f);
  return Math.hypot(b.x - a.x, b.y - a.y) / (Math.max(f - Math.max(0, f - 0.005), 1e-6) * this.duration(phase));
};

// Where it sailed before progress f, newest first, for the wake
SupplyVessel.prototype.pastTrack = function pastTrack(phase, f) {
  if (phase === 'alongside') return [];
  const out = [], T = this.duration(phase);
  for (let k = 0, g = f; k < 110 && g >= 0; k++, g -= 0.002) {
    const q = this.poseAt(phase, g);
    out.push({ x: q.x, y: q.y, yaw: q.yaw, speed: this.trackSpeed(phase, g), age: (f - g) * T });
  }
  return out;
};

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
const BEAM = 19;   // m
const FLOOD = new THREE.Color(0.35, 0.3, 0.22);

// How a ship at x, y (platform metres, heading yaw from +X) floats on an
// Outdoor's sea, its frame given by toPage (platform to the page's frame,
// z up to y up): heave (m), pitch (rad, bow down) and roll (rad, port up)
// from the surface under points along and across its hull
export function floatOn(outdoor, toPage, x, y, yaw, length, beam) {
  const c = Math.cos(yaw), s = Math.sin(yaw), h = (along, across) => {
    const q = new THREE.Vector3(x + c * along - s * across, y + s * along + c * across, 0).applyMatrix4(toPage);
    return outdoor.heightAt(q.x, q.z);
  };
  const bow = h(length * 0.35, 0), stern = h(-length * 0.35, 0), port = h(0, beam * 0.4), starboard = h(0, -beam * 0.4);
  return {
    heave: (bow + stern + port + starboard) / 4,
    pitch: -Math.atan2(bow - stern, length * 0.7),
    roll: Math.atan2(port - starboard, beam * 0.8),
  };
}

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
  const seen = vessel.copy({ seaLevel: room.seaLevel, fog: true, lights: true, outdoor });
  reflectable(seen);
  scene.add(seen);
  outdoor.seenThroughWindow(vessel.copies.at(-1).root);   // not drawn while the walls hide it
  if (panel) vesselControls(panel, vessel, outdoor);
  cctv.then((c) => {
    if (!c) return;
    c.scene.add(vessel.copy({ seaLevel: room.seaLevel, outdoor }));
    const crane = c.scene.getObjectByName('CraneSlew');
    if (crane) vessel.attachCrane(crane);
  }).catch(() => {});
  return vessel;
}
