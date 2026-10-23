// Seabirds round the platform: the four species you see from a northern
// North Sea platform (kittiwakes, fulmars, herring gulls and great
// black-backed gulls) as low-poly instanced meshes, one draw per species,
// whose wings flap and fold in the vertex shader, and a small flock
// simulation on the CPU (a few dozen birds: gliding and flapping bouts,
// circling round the platform and the supply vessel, perching on deck edges,
// resting on the sea).
//
// Looks: 'silhouette' (16 triangles, one grey) and 'detailed' (48 triangles,
// each species' own plumage). Behaviours: 'boids' (one mixed flock), 'flight'
// (each species flies its own way) and 'living' (flight plus perching on the
// platform and sitting on the sea). All kept: the game picks one with a setting.
import * as THREE from 'three';

// Sizes in metres, colours top / underside, how it flies: wingbeats per
// second and their swing (rad), how much of the time it glides, how fast,
// how high (m over the sea) and how far from what it circles (m)
export const SPECIES = {
  kittiwake: {
    name: 'Kittiwake', span: 1.05, length: 0.40, crook: 0.8,
    body: '#f5f6f3', mantle: '#8d969d', mid: '#a3abb1', tip: '#141516', bill: '#e2c43c', tail: '#f5f6f3',
    under: '#eef0ee', underTip: '#2a2b2d',
    flapHz: 3.4, flapAmp: 0.8, glide: 0.25, speed: 10.5, turn: 1.6, alt: [10, 45], radius: [10, 35], dihedral: 0.12, droop: -0.2,
  },
  fulmar: {
    name: 'Fulmar', span: 1.07, length: 0.47, crook: 0.1,
    body: '#eef0ec', mantle: '#858c93', mid: '#80878e', tip: '#5f656b', bill: '#c9b874', tail: '#8a9198',
    under: '#d8dcdd', underTip: '#9aa0a5',
    flapHz: 4.3, flapAmp: 0.45, glide: 0.8, speed: 13, turn: 0.9, alt: [0.8, 6], radius: [40, 160], dihedral: 0.02, droop: 0,
  },
  herring: {
    name: 'Herring gull', span: 1.40, length: 0.60, crook: 0.6,
    body: '#f6f6f3', mantle: '#a6adb3', mid: '#a6adb3', tip: '#18191b', bill: '#e9c63e', tail: '#f6f6f3',
    under: '#eef0ee', underTip: '#47494c',
    flapHz: 2.8, flapAmp: 0.7, glide: 0.6, speed: 10, turn: 1.0, alt: [20, 90], radius: [20, 60], dihedral: 0.14, droop: -0.25,
  },
  blackback: {
    name: 'Great black-backed gull', span: 1.62, length: 0.71, crook: 0.5,
    body: '#f3f3f0', mantle: '#2a2c2f', mid: '#2a2c2f', tip: '#161718', bill: '#e3bf38', tail: '#f3f3f0',
    under: '#d9dbdb', underTip: '#6c6e71',
    flapHz: 2.2, flapAmp: 0.65, glide: 0.65, speed: 10.5, turn: 0.8, alt: [25, 100], radius: [30, 80], dihedral: 0.12, droop: -0.2,
  },
};

const SILHOUETTE = { body: '#c9cdd1', mantle: '#c9cdd1', mid: '#c9cdd1', tip: '#c9cdd1', bill: '#c9cdd1', tail: '#c9cdd1', under: '#e8eaeb', underTip: '#e8eaeb' };

// ---------------------------------------------------------------- meshes

// A bird along +x (bill forward), y up, wings along ±z. Non-indexed, flat
// shaded, vertex colours; `wing` is 0 on the body, 1 on the inner wing
// (shoulder to wrist) and 2 on the outer wing, which the shader bends.
export function birdGeometry(sp, look = 'detailed') {
  const L = sp.length, S = sp.span / 2, C = 0.3 * S, k = sp.crook;
  const col = look === 'silhouette' ? SILHOUETTE : sp;
  const pos = [], nor = [], rgb = [], wing = [];
  const c3 = (hex) => new THREE.Color(hex);
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  // a triangle, wound so its normal points along `out`
  function tri(a, b, c, color, out, w = 0) {
    const n = tmp.subVectors(b, a).cross(tmp2.subVectors(c, a));
    if (n.dot(out) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); rgb.push(color.r, color.g, color.b); wing.push(w); }
  }
  const up = v(0, 1, 0), down = v(0, -1, 0);
  const both = (a, b, c, top, bottom, w = 0) => { tri(a, b, c, top, up, w); tri(a, b, c, bottom, down, w); };
  const body = c3(col.body), mantle = c3(col.mantle), mid = c3(col.mid), tip = c3(col.tip), bill = c3(col.bill), tail = c3(col.tail);
  const under = c3(col.under), underTip = c3(col.underTip);
  const root = 0.1 * L;

  if (look === 'silhouette') {
    // a flat diamond body and three-panel wings
    const nose = v(0.5 * L, 0, 0), aft = v(-0.5 * L, 0, 0), l = v(0.05 * L, 0, -root), r = v(0.05 * L, 0, root);
    both(nose, l, r, mantle, under); both(aft, l, r, mantle, under);
  } else {
    // Rings of four round the body: head, chest, belly; a bill and a tail fan
    const ring = (x, r, lift = 0) => [v(x, lift + 0.85 * r, 0), v(x, lift, r), v(x, lift - 0.9 * r, 0), v(x, lift, -r)];
    const billTip = v(0.5 * L, 0.015 * L, 0);
    const head = ring(0.36 * L, 0.065 * L, 0.035 * L), chest = ring(0.17 * L, 0.11 * L), belly = ring(-0.1 * L, 0.105 * L, 0.005 * L);
    const tailTip = v(-0.34 * L, 0.01 * L, 0);
    const centre = (x) => v(x, 0, 0);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, out = (p) => tmp2.copy(p).sub(centre(p.x)).clone();
      const face = (a, b, c, color) => tri(a, b, c, color, out(a.clone().add(b).add(c).divideScalar(3)));
      face(billTip, head[i], head[j], bill);
      face(head[i], head[j], chest[j], body); face(head[i], chest[j], chest[i], body);
      const back = i === 0 || j === 0 ? mantle : body;   // the faces either side of the top line
      face(chest[i], chest[j], belly[j], back); face(chest[i], belly[j], belly[i], back);
      face(belly[i], belly[j], tailTip, back);
    }
    const t0 = v(-0.18 * L, 0.03 * L, 0.06 * L), t1 = v(-0.5 * L, 0.03 * L, 0.08 * L);
    const m = (p) => v(p.x, p.y, -p.z);
    both(t0, t1, m(t1), tail, tail); both(t0, m(t1), m(t0), tail, tail);
  }

  // Wings: shoulder to wrist (swept forward by the crook), wrist to tip
  // (swept back), the tip its own triangle for the black wingtips
  for (const s of [1, -1]) {
    const w = (x, z) => v(x, 0.02 * L, s * z);
    const rootLead = w(0.35 * C, root), rootTrail = w(-0.65 * C, root);
    const wristLead = w((0.35 + 0.3 * k) * C, 0.5 * S), wristTrail = w(-0.6 * C, 0.5 * S);
    const lead80 = w((0.15 + 0.1 * k) * C, 0.8 * S), trail80 = w(-0.75 * C, 0.78 * S), wingTip = w((-0.45 - 0.35 * k) * C, S);
    both(rootLead, wristLead, wristTrail, mantle, under, 1); both(rootLead, wristTrail, rootTrail, mantle, under, 1);
    if (look === 'silhouette') {
      both(wristLead, wingTip, wristTrail, mantle, under, 2);
    } else {
      both(wristLead, lead80, trail80, mid, under, 2); both(wristLead, trail80, wristTrail, mid, under, 2);
      both(lead80, wingTip, trail80, tip, underTip, 2);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
  g.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1));
  g.computeVertexNormals();
  g.userData = { root, elbow: 0.5 * S, span: sp.span, triangles: pos.length / 9 };
  return g;
}

// The wing joints, per bird (aPose): the shoulder angle, the extra bend at
// the wrist, and how far the wings are folded on the back. Lit by its own
// uniforms (`light`: sky, sun and fog from outdoor.js, see Seabirds.setLight)
// rather than the scene's lights and fog, so the same birds look the same in
// the room's scene (which has neither), the CCTV's and the intro's.
const birdVertex = /* glsl */ `
  attribute float wing;
  attribute vec3 aPose;
  uniform float uRoot, uElbow;
  varying vec3 vColor, vNormal;
  varying float vDist;
  void main() {
    vec3 p = position, n = normal;
    if (wing > 0.5) {
      float sz = sign(p.z), d = max(abs(p.z) - uRoot, 0.0), e = uElbow - uRoot;
      float d1 = min(d, e), d2 = max(d - e, 0.0), a1 = aPose.x, a2 = aPose.x + aPose.y;
      vec3 flap = vec3(p.x, p.y + d1 * sin(a1) + d2 * sin(a2), sz * (uRoot + d1 * cos(a1) + d2 * cos(a2)));
      // folded: laid back along the body, the tips crossing over the tail
      vec3 fold = vec3(0.3 * p.x - 0.55 * d, p.y + 0.5 * uRoot, sz * uRoot * (0.95 - 0.3 * d / (e + e)));
      p = mix(flap, fold, aPose.z);
      float th = -sz * (wing > 1.5 ? a2 : a1), c = cos(th), s = sin(th);
      n = vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
      n = normalize(mix(n, vec3(0.0, sign(n.y), 0.0), aPose.z));
    }
    mat4 m = modelMatrix * instanceMatrix;
    vNormal = normalize(mat3(m) * n);
    vColor = color;
    vec4 mv = viewMatrix * m * vec4(p, 1.0);
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const birdFragment = /* glsl */ `
  uniform vec3 uSky, uSun, uSunDir, uFogColor;
  uniform float uFogDensity;
  varying vec3 vColor, vNormal;
  varying float vDist;
  void main() {
    vec3 n = normalize(vNormal);
    // as the scenes' hemisphere light (sky above, a third of it from below) and sun
    vec3 light = mix(uSky * 0.3, uSky, 0.5 + 0.5 * n.y) + uSun * max(dot(n, uSunDir), 0.0);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
    gl_FragColor = vec4(mix(vColor * light, uFogColor, fog), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function birdLight() {
  return {
    uSky: { value: new THREE.Color(0.3, 0.3, 0.3) }, uSun: { value: new THREE.Color(1, 1, 1) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uFogColor: { value: new THREE.Color() }, uFogDensity: { value: 0 },
  };
}

export function birdMaterial(geometry, light = birdLight()) {
  const { root, elbow } = geometry.userData;
  return new THREE.ShaderMaterial({
    vertexShader: birdVertex, fragmentShader: birdFragment, vertexColors: true,
    uniforms: { ...light, uRoot: { value: root }, uElbow: { value: elbow } },
  });
}

// ---------------------------------------------------------------- the platform, as birds see it

// The platform's tops on a 2 m grid (for flying over it, not into it) and
// perches: level spots on deck edges, roofs and booms with a drop beside them,
// 18 m or more over the sea (seaLevel: its height in the model's frame)
export class PlatformMap {
  // avoid: [{ centre, radius }] where none sit (the helideck)
  constructor(object, { cell = 2, perches = 260, seaLevel = 0, avoid = [] } = {}) {
    object.updateMatrixWorld(true);
    this.seaLevel = seaLevel;
    const box = new THREE.Box3().setFromObject(object);
    this.box = box; this.cell = cell;
    this.x0 = box.min.x - 4; this.z0 = box.min.z - 4;
    this.nx = Math.ceil((box.max.x - this.x0 + 4) / cell); this.nz = Math.ceil((box.max.z - this.z0 + 4) / cell);
    this.top = new Float32Array(this.nx * this.nz).fill(-Infinity);
    const level = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
    object.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, P = g.attributes.position, I = g.index;
      const count = I ? I.count : P.count;
      for (let t = 0; t < count; t += 3) {
        const ia = I ? I.getX(t) : t, ib = I ? I.getX(t + 1) : t + 1, ic = I ? I.getX(t + 2) : t + 2;
        a.fromBufferAttribute(P, ia).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(P, ib).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(P, ic).applyMatrix4(o.matrixWorld);
        n.subVectors(b, a).cross(p.subVectors(c, a));
        const area = n.length() / 2;
        n.normalize();
        const steps = Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (cell * 0.5));
        for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
          const u = i / steps, w = j / steps;
          p.copy(a).multiplyScalar(1 - u - w).addScaledVector(b, u).addScaledVector(c, w);
          const k = this.index(p.x, p.z);
          if (k >= 0 && p.y > this.top[k]) this.top[k] = p.y;
          if (Math.abs(n.y) > 0.92 && p.y > seaLevel + 18 && area > 0.05) level.push(p.x, p.y, p.z);
        }
      }
    });
    // Perches: level points within a cell of an edge (a neighbour 3 m or
    // more lower), on the top surface there, spread out by a minimum gap
    const candidates = [];
    for (let i = 0; i < level.length; i += 3) {
      const x = level[i], y = level[i + 1], z = level[i + 2];
      if (y < this.height(x, z) - 0.3) continue;   // under another deck
      let edge = false;
      for (const [dx, dz] of [[cell, 0], [-cell, 0], [0, cell], [0, -cell]]) if (this.height(x + dx, z + dz) < y - 3) edge = true;
      const q = new THREE.Vector3(x, y, z);
      if (edge && avoid.every((a) => a.centre.distanceTo(q) > a.radius)) candidates.push(q);
    }
    for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
    this.perches = [];
    for (const q of candidates) {
      if (this.perches.length >= perches) break;
      if (this.perches.every((r) => r.position.distanceToSquared(q) > 2.25)) this.perches.push({ position: q, taken: false });
    }
    this.centre = box.getCenter(new THREE.Vector3());
  }

  index(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }

  height(x, z) { const k = this.index(x, z); return k < 0 ? -Infinity : this.top[k]; }
}

// ---------------------------------------------------------------- the flock

const G = 9.81;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const UP = new THREE.Vector3(0, 1, 0);

export class Seabirds {
  // map: a PlatformMap; sea: (x, z) => the sea's height there; anchors:
  // () => [{ position, weight }] of what the gulls like to circle (the
  // platform, the supply vessel); hang: [{ position, spread }] spots by
  // the quarters' windows where big gulls hang still in the updraft (spread:
  // how far round it, m, each way); counts: birds per species. The sea's
  // level comes from the map.
  // threat: () => a position birds flee (the helicopter), or null
  constructor({ map, sea = null, anchors = null, hang = [], threat = null, look = 'detailed', behaviour = 'living', counts = null }) {
    this.map = map; this.threat = threat; this.look = look; this.behaviour = behaviour; this.hangSpots = hang;
    this.seaLevel = map.seaLevel;
    this.sea = sea ?? (() => this.seaLevel);
    this.light = birdLight();
    this.night = 0;
    this.anchors = anchors ?? (() => [{ position: map.centre, weight: 1 }]);
    this.group = new THREE.Group();
    counts ??= look === 'silhouette' ? { herring: 24 } : { kittiwake: 14, fulmar: 6, herring: 7, blackback: 3 };
    this.meshes = {};
    this.birds = [];
    this.triangles = 0;
    for (const [key, n] of Object.entries(counts)) {
      const sp = SPECIES[key], geometry = birdGeometry(sp, look);
      const pose = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      pose.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aPose', pose);
      const mesh = new THREE.InstancedMesh(geometry, birdMaterial(geometry, this.light), n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes[key] = mesh;
      this.triangles += n * geometry.userData.triangles;
      for (let i = 0; i < n; i++) this.birds.push(this.spawn(sp, key, mesh, i));
    }
    this.wind = new THREE.Vector3(1, 0, 0);   // where the wind blows to: perched birds face into it
    this.ms = 0;
    if (behaviour === 'living') this.settle();
    // a couple of big gulls already hanging by the windows
    if (behaviour !== 'boids' && hang.length) {
      for (const b of this.birds.filter((x) => x.mode === 'fly' && (x.key === 'herring' || x.key === 'blackback')).slice(0, 2)) {
        this.hang(b); b.mode = 'hang'; b.p.copy(b.target.position); b.v.set(0, 0, 0);
      }
    }
  }

  spawn(sp, key, mesh, index) {
    const b = {
      sp, key, mesh, index, p: new THREE.Vector3(), v: new THREE.Vector3(), mode: 'fly',
      phase: Math.random() * 6.3, flapping: Math.random() > sp.glide, bout: rand(0.5, 3), amp: 0, bank: 0, fold: 0,
      centre: new THREE.Vector3(), radius: 30, alt: 30, dir: Math.random() < 0.5 ? 1 : -1, retarget: 0, seed: Math.random() * 100,
      target: null, timer: 0, heading: new THREE.Vector3(1, 0, 0),
    };
    this.orbit(b);
    const a = Math.random() * 6.3;
    b.p.set(b.centre.x + Math.cos(a) * b.radius, this.seaLevel + b.alt, b.centre.z + Math.sin(a) * b.radius);
    b.v.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(sp.speed * b.dir);
    return b;
  }

  // Something to circle: each species its own way
  orbit(b) {
    const sp = b.sp, m = this.map, box = m.box;
    if (this.behaviour === 'boids') {
      b.centre.copy(m.centre); b.radius = rand(40, 70); b.alt = rand(30, 70);
    } else if (b.key === 'kittiwake') {   // busy round the decks
      b.centre.set(rand(box.min.x, box.max.x), 0, rand(box.min.z, box.max.z)); b.radius = rand(...sp.radius); b.alt = rand(...sp.alt);
    } else if (b.key === 'fulmar') {      // wide, low arcs over the waves
      const a = Math.random() * 6.3, r = rand(30, 140);
      b.centre.set(m.centre.x + Math.cos(a) * r, 0, m.centre.z + Math.sin(a) * r); b.radius = rand(...sp.radius); b.alt = rand(...sp.alt);
    } else {                              // big gulls: soaring over the platform and the vessel
      const list = this.anchors(), total = list.reduce((s, x) => s + x.weight, 0);
      let r = Math.random() * total, a = list[0];
      for (const x of list) { if ((r -= x.weight) <= 0) { a = x; break; } }
      b.centre.copy(a.position).add(new THREE.Vector3(rand(-20, 20), 0, rand(-20, 20))); b.centre.y = 0;
      b.radius = rand(...sp.radius); b.alt = rand(...sp.alt);
    }
    if (Math.random() < 0.25) b.dir *= -1;
    b.retarget = rand(12, 40);
  }

  // Start the living flock half settled: kittiwakes on the ledges, some
  // fulmars and gulls on the water
  settle() {
    for (const b of this.birds) {
      const r = Math.random();
      if (b.key === 'kittiwake' && r < 0.55) this.perch(b, true);
      else if ((b.key === 'herring' || b.key === 'blackback') && r < 0.35) this.perch(b, true);
      else if ((b.key === 'fulmar' && r < 0.4) || (b.key === 'herring' && r > 0.8)) this.land(b, true);
    }
  }

  perch(b, now = false) {
    const free = this.map.perches.filter((x) => !x.taken && (b.key !== 'kittiwake' || x.position.y < this.seaLevel + 45));
    if (!free.length) return;
    // kittiwakes like company: next to another one if they can
    let spot = pick(free);
    if (b.key === 'kittiwake') {
      const friends = this.birds.filter((o) => o.mode === 'perch' && o.key === 'kittiwake');
      if (friends.length && Math.random() < 0.7) {
        const f = pick(friends).p;
        spot = free.reduce((best, x) => x.position.distanceToSquared(f) < best.position.distanceToSquared(f) ? x : best, free[0]);
      }
    }
    spot.taken = true;
    b.target = spot;
    if (now) { b.p.copy(spot.position); b.mode = 'perch'; b.fold = 1; b.v.set(0, 0, 0); b.timer = rand(10, 120); }
    else b.mode = 'toPerch';
  }

  land(b, now = false) {
    const m = this.map.centre, a = Math.random() * 6.3, r = rand(40, 160);
    b.target = { position: new THREE.Vector3(m.x + Math.cos(a) * r, 0, m.z + Math.sin(a) * r) };
    if (now) { b.p.copy(b.target.position); b.mode = 'sea'; b.fold = 1; b.v.set(0, 0, 0); b.timer = rand(20, 150); }
    else b.mode = 'toSea';
  }

  // Hold station in the wind by the windows: no wingbeats, small corrections
  hang(b) {
    const { position, spread } = pick(this.hangSpots);
    b.target = { position: position.clone().add(new THREE.Vector3(rand(-1, 1) * spread.x, rand(-0.5, 1) * spread.y, rand(-1, 1) * spread.z)) };
    b.mode = 'toHang'; b.timer = rand(12, 40);
  }

  takeOff(b) {
    if (b.target?.taken) b.target.taken = false;
    b.target = null; b.mode = 'fly'; b.flapping = true; b.bout = rand(2, 4);
    b.v.copy(b.heading).multiplyScalar(3).addScaledVector(UP, 2.5);
    this.orbit(b);
  }

  // Each frame: follow outdoor.js (light, fog, time of day, the wind in the
  // frame's axes) and move on dt seconds
  tick(dt, outdoor) {
    this.setLight(outdoor.light);
    const b = THREE.MathUtils.degToRad(outdoor.state.windFrom + 180), h = outdoor.heading;
    const east = Math.sin(b), north = Math.cos(b);
    this.wind.set(east * Math.cos(h) - north * Math.sin(h), 0, -(north * Math.cos(h) + east * Math.sin(h)));
    this.clock = (this.clock ?? 0) + dt;
    this.update(dt, this.clock);
  }

  // Light, fog and the time of day from outdoor.js's light (Outdoor.light)
  setLight(L) {
    const u = this.light;
    u.uSky.value.copy(L.sky); u.uSun.value.copy(L.sun); u.uSunDir.value.copy(L.sunDir);
    u.uFogColor.value.copy(L.fog); u.uFogDensity.value = Math.LN2 / L.fogDistance;
    const lsky = L.sky.r * 0.2126 + L.sky.g * 0.7152 + L.sky.b * 0.0722;
    this.night = 1 - THREE.MathUtils.smoothstep(lsky, 0.01, 0.15);
    // Starting at night: most are already roosting
    if (!this.lit && this.night > 0.5 && this.behaviour === 'living') {
      for (const b of this.birds) {
        if (b.mode !== 'fly' || Math.random() < 0.2) continue;
        if (b.key === 'fulmar') this.land(b, true); else this.perch(b, true);
        b.timer *= 5;
      }
    }
    this.lit = true;
  }

  // The same birds for another scene (the CCTV's): sharing the geometry,
  // material and instance matrices, so it costs only the draws
  copy() {
    const group = new THREE.Group();
    for (const m of Object.values(this.meshes)) {
      const c = new THREE.InstancedMesh(m.geometry, m.material, m.count);
      c.instanceMatrix = m.instanceMatrix;
      c.frustumCulled = false;
      group.add(c);
    }
    return group;
  }

  update(dt, time) {
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    if (dt > 0) for (const b of this.birds) this.step(b, dt, time);
    for (const b of this.birds) this.pose(b, dt);
    for (const m of Object.values(this.meshes)) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aPose.needsUpdate = true; }
    this.ms = this.ms * 0.95 + (performance.now() - t0) * 0.05;
  }

  step(b, dt, time) {
    const sp = b.sp;
    if (b.mode === 'perch' || b.mode === 'sea') {
      b.fold = Math.min(1, b.fold + dt * 2);
      b.amp = Math.max(0, b.amp - dt * 3);
      if (b.mode === 'sea') {   // drifting downwind, riding the waves
        b.p.addScaledVector(this.wind, dt * 0.15);
        b.p.y = this.sea(b.p.x, b.p.z) + 0.04;
      }
      const danger = this.threat?.();
      if ((b.timer -= dt) < 0 || (danger && danger.distanceTo(b.p) < 35)) this.takeOff(b);
      return;
    }
    b.fold = Math.max(0, b.fold - dt * 3);

    const desired = new THREE.Vector3();
    let speed = sp.speed, climb = 0;
    if (b.mode === 'toHang' || b.mode === 'hang') {
      // Fly to the spot, then match the wind: still over the ground, facing
      // into it, wobbling a little in the gusts
      const goal = b.target.position.clone().add(new THREE.Vector3(Math.sin(time * 0.7 + b.seed), 0.6 * Math.sin(time * 1.1 + b.seed * 2), Math.cos(time * 0.5 + b.seed)));
      const to = goal.sub(b.p), d = to.length();
      if (b.mode === 'toHang' && d < 3) b.mode = 'hang';
      if (b.mode === 'hang') {
        desired.copy(to).multiplyScalar(0.6);
        b.flapping = false; b.bout = 2;
        if ((b.timer -= dt) < 0) { b.mode = 'fly'; b.target = null; this.orbit(b); }
      } else desired.copy(to).normalize().multiplyScalar(Math.min(sp.speed, 2 + d * 0.4));
    } else if (b.mode === 'toPerch' || b.mode === 'toSea') {
      // Glide in, flap to brake for the last few metres
      const goal = b.target.position.clone();
      if (b.mode === 'toSea') goal.y = this.sea(goal.x, goal.z) + 0.04;
      const to = goal.clone().sub(b.p), d = to.length();
      speed = Math.min(sp.speed, 1.2 + d * 0.5);
      desired.copy(to).normalize().multiplyScalar(speed);
      if (d < 8) { b.flapping = true; b.bout = 1; }
      if (d < 0.35) {
        b.p.copy(goal); b.v.set(0, 0, 0);
        b.mode = b.mode === 'toPerch' ? 'perch' : 'sea';
        b.timer = rand(20, 120) * (1 + 4 * this.night);   // most of the night roosting
        b.heading.copy(this.wind).negate();
        return;
      }
    } else {
      if ((b.retarget -= dt) < 0) {
        const r = Math.random();
        const big = b.key === 'herring' || b.key === 'blackback';
        if (this.behaviour === 'living' && this.night > 0.5 && Math.random() < 0.85) b.key === 'fulmar' ? this.land(b) : this.perch(b);
        else if (big && this.behaviour !== 'boids' && this.hangSpots.length && Math.random() < 0.45) this.hang(b);
        else if (this.behaviour === 'living' && b.key === 'kittiwake' && r < 0.45) this.perch(b);
        else if (this.behaviour === 'living' && b.key !== 'kittiwake' && r < 0.25) b.key === 'fulmar' || r < 0.1 ? this.land(b) : this.perch(b);
        else this.orbit(b);
        if (b.mode !== 'fly') return;
      }
      // Round the centre, back to the circle, towards the height it wants
      const rx = b.p.x - b.centre.x, rz = b.p.z - b.centre.z, d = Math.hypot(rx, rz) || 1;
      const pull = THREE.MathUtils.clamp((b.radius - d) * 0.15, -1.2, 1.2);
      desired.set(-rz / d * b.dir + rx / d * pull, 0, rx / d * b.dir + rz / d * pull).normalize().multiplyScalar(speed);
      let alt = this.seaLevel + b.alt;
      if (b.key === 'fulmar' && this.behaviour !== 'boids') {   // shearwater-style arcs up and down over the swell
        alt = this.sea(b.p.x, b.p.z) + b.alt * 0.3 + b.alt * Math.max(0, Math.sin(time * 0.7 + b.seed));
      } else alt += 6 * Math.sin(time * 0.15 + b.seed);
      climb = THREE.MathUtils.clamp((alt - b.p.y) * 0.4, -3, 3);
      desired.y = climb;
    }

    // Over the platform, not into it: look ahead and climb over what's there
    if (b.mode === 'fly' || (b.mode === 'toHang' && b.target.position.distanceTo(b.p) > 10)) {
      const ax = b.p.x + b.v.x * 1.5, az = b.p.z + b.v.z * 1.5;
      const top = Math.max(this.map.height(ax, az), this.map.height(b.p.x, b.p.z));
      if (b.p.y < top + 6) { desired.y += (top + 6 - b.p.y) * 1.5; climb = Math.max(climb, desired.y); }
      if (b.p.y < this.sea(b.p.x, b.p.z) + 0.6) desired.y += 3;
    }

    // Keep a little apart; the boids flock also lines up and closes in
    const near = new THREE.Vector3(), align = new THREE.Vector3(), mid = new THREE.Vector3();
    let n = 0;
    for (const o of this.birds) {
      if (o === b || o.mode !== 'fly') continue;
      const dx = b.p.x - o.p.x, dy = b.p.y - o.p.y, dz = b.p.z - o.p.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 9 && d2 > 1e-6) near.add(new THREE.Vector3(dx, dy, dz).divideScalar(d2));
      if (this.behaviour === 'boids' && d2 < 400) { align.add(o.v); mid.add(o.p); n++; }
    }
    desired.addScaledVector(near, 4);
    // Out of the helicopter's way: away from it, and up off a perch
    const danger = this.threat?.();
    if (danger) {
      const away = b.p.clone().sub(danger), d = away.length();
      if (d < 45) desired.addScaledVector(away.normalize(), (45 - d) * 0.5);
    }
    if (n) {
      desired.addScaledVector(align.divideScalar(n).sub(b.v), 0.4);
      desired.addScaledVector(mid.divideScalar(n).sub(b.p), 0.08);
    }

    b.v.lerp(desired, Math.min(1, dt * sp.turn));
    b.p.addScaledVector(b.v, dt);

    // Flap or glide, in bouts; flap to climb unless the platform's updraft
    // carries it (big gulls hang in it without a wingbeat)
    if ((b.bout -= dt) < 0) {
      b.flapping = !b.flapping;
      b.bout = b.flapping ? rand(0.8, 3) * (1 - sp.glide + 0.2) : rand(1.5, 6) * (sp.glide + 0.2);
    }
    const updraft = (b.key === 'herring' || b.key === 'blackback') && Math.hypot(b.p.x - this.map.centre.x, b.p.z - this.map.centre.z) < 70;
    const flap = b.flapping || (climb > 1.2 && !updraft) || b.mode === 'toPerch' || b.mode === 'toSea';
    b.amp += ((flap ? 1 : 0) - b.amp) * Math.min(1, dt * 4);
    b.phase += dt * Math.PI * 2 * sp.flapHz * (0.3 + 0.7 * b.amp);
    if (b.amp < 0.02) b.phase = Math.PI * 0.5;   // glide with the wings level, start the next beat from the top
  }

  // Into the instance matrix and the wing pose
  pose(b, dt) {
    const sp = b.sp, flying = b.mode !== 'perch' && b.mode !== 'sea';
    const f = new THREE.Vector3();
    if (b.mode === 'hang') f.copy(this.wind).negate().addScaledVector(b.v, 0.3).setY(b.v.y * 0.2).normalize();
    else if (flying && b.v.lengthSq() > 0.01) f.copy(b.v).normalize();
    else f.copy(b.heading).setY(0).normalize();
    // Bank into the turn: tan(bank) = v ω / g
    const h = new THREE.Vector3(f.x, 0, f.z).normalize();
    if (dt > 0 && flying) {
      const w = (b.heading.z * h.x - b.heading.x * h.z) / dt;
      const speed = b.mode === 'hang' ? 2 : Math.hypot(b.v.x, b.v.z);
      const target = THREE.MathUtils.clamp(-Math.atan(speed * w / G), -1.1, 1.1);
      b.bank += (target - b.bank) * Math.min(1, dt * 3);
    } else b.bank *= 0.9;
    if (h.lengthSq() > 0.5) b.heading.copy(h);
    if (!flying) f.y = 0;
    const X = f.clone().normalize(), Z = new THREE.Vector3().crossVectors(X, UP).normalize(), Y = new THREE.Vector3().crossVectors(Z, X);
    if (flying) { Y.applyAxisAngle(X, b.bank); Z.applyAxisAngle(X, b.bank); }
    const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(b.p);
    // sitting birds sit a little higher (on their legs) and bob on the sea
    if (!flying) m.elements[13] += b.sp.length * 0.12;
    b.mesh.setMatrixAt(b.index, m);
    const s = Math.sin(b.phase), a = b.amp * sp.flapAmp;
    const shoulder = a * s + (1 - b.amp) * sp.dihedral + b.amp * 0.15;
    const wrist = a * 0.7 * Math.sin(b.phase - 0.9) + (1 - b.amp) * sp.droop;
    b.mesh.geometry.attributes.aPose.setXYZ(b.index, shoulder, wrist, b.fold);
  }

  get flying() { return this.birds.filter((b) => b.mode !== 'perch' && b.mode !== 'sea').length; }
}

// ---------------------------------------------------------------- in the game

// The flock for the control room pages (control.html, play.html): in the
// room's frame, round the platform model the CCTV draws (cctv.js), seen
// through the window and on the cameras. Big gulls hang in the updraft
// outside the window. ?birds=off|boids|flight|living (living by default).
// Resolves to the Seabirds, for tick(), or null without the CCTV's model.
export async function addSeabirds({ scene, room, outdoor, cctv, vessel = () => null }) {
  const mode = new URLSearchParams(location.search).get('birds') ?? 'living';
  if (mode === 'off') return null;
  const c = await cctv;
  if (!c) return null;
  const sea = room.seaLevel;
  // the helideck, in the room's frame (platform x 65.5, 57.5 m up, by vessel.json's toRoom)
  const map = new PlatformMap(c.model, { seaLevel: sea, avoid: [{ centre: new THREE.Vector3(13.1, sea + 57.5, 29.1), radius: 13 }] });
  const w = room.window, mid = w.lo.clone().add(w.hi).multiplyScalar(0.5);
  const birds = new Seabirds({
    map, behaviour: mode === 'boids' || mode === 'flight' ? mode : 'living', look: mode === 'boids' ? 'silhouette' : 'detailed',
    sea: (x, z) => sea + outdoor.heightAt(x, z),
    anchors: () => {
      const v = vessel(), list = [{ position: map.centre, weight: 0.6 }];
      if (v && v.phase !== 'away' && v.copies[0]) list.push({ position: new THREE.Vector3().setFromMatrixPosition(v.copies[0].root.matrix), weight: 0.4 });
      return list;
    },
    hang: [{ position: new THREE.Vector3(w.lo.x - 14, mid.y + 3, mid.z), spread: new THREE.Vector3(4, 3, 10) }],
  });
  birds.tick(0, outdoor);
  for (let i = 0; i < 60; i++) birds.update(0.1, i * 0.1);   // spread out from the start
  scene.add(birds.group);
  c.scene.add(birds.copy());
  return birds;
}
