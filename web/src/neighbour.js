// The neighbour platform on the horizon: the hub that takes our oil and gas,
// about 9 km to the south-south-east. Seen from our decks it is a small dark
// shape (about 0.6° wide, a bit wider than the full moon): a box of a
// topside on four legs, a tall tower, a long crane boom. Its flare is
// normally not lit, so at night it is a cluster of deck lights with steady
// red lights on the tower and crane. Proportions traced from a photo taken
// on our platform; heights scaled so the tower tip is 147 m above the sea.
//
// Three looks (LOOKS): a flat cut-out that turns to face you, low-poly
// blocks, and blocks with a lattice tower and crane. outdoor.js draws it in
// its own full-resolution pass over the sky and sea, lit and fogged like them.
import * as THREE from 'three';

// Where it is from our platform's origin: true bearing (deg) and distance (m)
export const NEIGHBOUR = { bearing: 162, distance: 9250, facing: 252 };   // facing: true bearing of its +x, our right as we look at it broadside

// Its shape in its own frame (m): x along the long axis (left to right as
// seen from us), y up from the sea, z toward us
const DECK = 28, ROOF = 83, TIP = 147;
const BOXES = [
  // x0, x1, y0, y1, z0, z1
  [-70, 64, DECK, ROOF, -22, 22],      // topside
  [64, 80, ROOF - 4, ROOF - 2, -16, 16],   // helideck overhang
  [-70, -52, ROOF, ROOF + 6, -12, 12],   // crane pedestal house
  [14, 22, ROOF, ROOF + 18, -4, 4],      // exhausts and vents on the roof
  [26, 32, ROOF, ROOF + 13, 6, 12],
  [36, 46, ROOF, ROOF + 8, -10, 2],
];
const LEGS = [[-24, -18], [24, -18], [-24, 18], [24, 18]];   // x, z at the deck
const TOWER = { x: -4, z: 0, base: 16, top: 9, cap: 12 };
const CRANE = { from: [-62, ROOF + 6, 0], to: [-110, ROOF + 92, 0] };   // pedestal to boom tip

export const LOOKS = {
  a: 'cut-out',
  b: 'blocks',
  c: 'lattice',
};

// ---------------------------------------------------------------- geometry

function box(list, x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  list.push(g);
}

// A square post from a to b (Vector3s), w wide
function post(list, a, b, w) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.BoxGeometry(w, len, w).toNonIndexed();
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  list.push(g);
}

// A tapered four-sided frustum, or its lattice: corner posts and X braces
function tower(list, lattice) {
  const { x, z, base, top, cap } = TOWER, y0 = ROOF, y1 = TIP - 6;
  if (!lattice) {
    const g = new THREE.CylinderGeometry(top / Math.SQRT2, base / Math.SQRT2, y1 - y0, 4, 1, false, Math.PI / 4).toNonIndexed();
    g.translate(x, (y0 + y1) / 2, z);
    list.push(g);
  } else {
    const corner = (y, sx, sz) => { const h = THREE.MathUtils.lerp(base, top, (y - y0) / (y1 - y0)) / 2; return new THREE.Vector3(x + sx * h, y, z + sz * h); };
    const sides = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sz] of sides) post(list, corner(y0, sx, sz), corner(y1, sx, sz), 1.4);
    const bays = 6;
    for (let i = 0; i < bays; i++) {
      const ya = y0 + (y1 - y0) * i / bays, yb = y0 + (y1 - y0) * (i + 1) / bays;
      for (let k = 0; k < 4; k++) {
        const [ax, az] = sides[k], [bx, bz] = sides[(k + 1) % 4];
        post(list, corner(ya, ax, az), corner(yb, bx, bz), 0.7);
        post(list, corner(yb, ax, az), corner(yb, bx, bz), 0.7);
      }
    }
  }
  box(list, x - cap / 2, x + cap / 2, y1, TIP, z - cap / 2, z + cap / 2);   // the flare tip's platform
}

function crane(list, lattice) {
  const a = new THREE.Vector3(...CRANE.from), b = new THREE.Vector3(...CRANE.to);
  if (!lattice) { post(list, a, b, 2.4); return; }
  // two chords and zig-zag lacing, narrowing to the tip
  const side = new THREE.Vector3(0, 0, 1);
  const n = 10;
  for (const s of [-1, 1]) post(list, a.clone().addScaledVector(side, 1.6 * s), b.clone().addScaledVector(side, 0.5 * s), 1.3);
  for (let i = 0; i < n; i++) {
    const p = a.clone().lerp(b, i / n), q = a.clone().lerp(b, (i + 1) / n), w = THREE.MathUtils.lerp(1.6, 0.5, i / n);
    post(list, p.clone().addScaledVector(side, -w), q.clone().addScaledVector(side, w), 0.4);
  }
  post(list, new THREE.Vector3(a.x, ROOF + 6, 0), new THREE.Vector3(a.x + 3, ROOF + 22, 0), 1.2);   // the A-frame
}

function legs(list, lattice) {
  for (const [x, z] of LEGS) post(list, new THREE.Vector3(x * 1.08, 0, z * 1.08), new THREE.Vector3(x, DECK, z), 3);
  if (!lattice) return;
  // X bracing on the two long faces, between the sea and the deck
  for (const z of [-18, 18]) for (const [y0, y1] of [[2, 14], [14, DECK]]) {
    post(list, new THREE.Vector3(-24, y0, z), new THREE.Vector3(24, y1, z), 1);
    post(list, new THREE.Vector3(24, y0, z), new THREE.Vector3(-24, y1, z), 1);
  }
}

// One merged, flat-shaded geometry for a look
export function neighbourGeometry(look = 'b') {
  const list = [], lattice = look === 'c';
  for (const b of BOXES) box(list, ...b);
  if (lattice) {   // steps in the roof line: modules of different heights
    box(list, -40, -12, ROOF, ROOF + 7, -20, 4);
    box(list, 34, 64, DECK + 6, DECK + 12, 22, 24);   // a walkway deck on the near face
    box(list, -70, 64, DECK + 24, DECK + 25.5, 22, 23.5);
  }
  tower(list, lattice);
  crane(list, lattice);
  legs(list, lattice);
  const g = mergeAll(list);
  if (look === 'a') {   // flattened to a card: the same outline, no depth
    g.scale(1, 1, 0.001);
    g.computeVertexNormals();
  }
  return g;
}

function mergeAll(list) {
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// Night lights: [x, y, z, red?] floodlights round the deck edges and roof,
// red obstruction lights on the tower top, crane tip and roof corners
function lightPoints() {
  const pts = [];
  const rnd = (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let i = 0; i < 26; i++) {
    const x = -68 + 130 * (i + 0.5) / 26 + 2 * rnd(i);
    if (rnd(i + 11) > -0.6) pts.push([x, DECK + 1 + 2 * Math.abs(rnd(i + 5)), 22.5, 0]);   // under the deck on our side
    if (i % 2 === 0) pts.push([x + 3 * rnd(i + 3), DECK + 14 + 16 * Math.abs(rnd(i + 7)), 22.5, 0]);   // module walkways and stairs
    if (i % 3 === 0) pts.push([x, ROOF + 0.5, 22, 0]);                // roof edge
  }
  pts.push([TOWER.x, TIP + 0.5, 0, 1], [TOWER.x, (ROOF + TIP) / 2, 3, 1]);
  pts.push([CRANE.to[0], CRANE.to[1], 0, 1]);
  pts.push([-70, ROOF + 1, 22, 1], [64, ROOF + 1, 22, 1], [80, ROOF - 1.5, 16, 0.4]);
  return pts;
}

// ---------------------------------------------------------------- shading

const vertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const fragment = /* glsl */ `
  uniform vec3 uSky, uSun, uSunDir, uFogColor;
  uniform float uVisibility, uAlbedo, uHaze;
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    // painted steel in the sea air: dull grey, lit by the sky from above
    // more than from the sides, and by the sun where it faces it
    float skyFrom = 0.4 + 0.6 * n.y;
    vec3 col = uAlbedo * (uSky * skyFrom + uSun * max(dot(n, uSunDir), 0.0));
    float dist = length(vWorld - cameraPosition);
    col = mix(col, uFogColor, 1.0 - exp(-dist / uVisibility * uHaze));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const lightVertex = /* glsl */ `
  attribute float aRed;
  uniform float uSize;
  varying float vRed;
  varying float vFog;
  uniform float uVisibility;
  void main() {
    vRed = aRed;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vFog = exp(-length(w.xyz - cameraPosition) / uVisibility);
    gl_Position = projectionMatrix * viewMatrix * w;
    gl_PointSize = uSize * (aRed > 0.5 ? 1.15 : 1.0);
  }`;
const lightFragment = /* glsl */ `
  uniform float uOn;
  varying float vRed;
  varying float vFog;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, r);
    vec3 white = vec3(1.0, 0.82, 0.55) * 6.0, red = vec3(1.0, 0.04, 0.02) * 9.0;
    vec3 col = mix(white, red, step(0.5, vRed)) * a * a * uOn * vFog;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Neighbour {
  // look: 'a' | 'b' | 'c' (LOOKS)
  constructor(look = 'b') {
    this.group = new THREE.Group();
    this.group.name = 'neighbour platform';
    this.uniforms = {
      uSky: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogColor: { value: new THREE.Color() }, uVisibility: { value: 45000 }, uAlbedo: { value: 0.05 }, uHaze: { value: 0.5 },
    };
    this.mesh = new THREE.Mesh(neighbourGeometry(look), new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.look = look;
    const pts = lightPoints();
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => p.slice(0, 3)), 3));
    lg.setAttribute('aRed', new THREE.Float32BufferAttribute(pts.map((p) => p[3]), 1));
    this.lights = new THREE.Points(lg, new THREE.ShaderMaterial({
      vertexShader: lightVertex, fragmentShader: lightFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uOn: { value: 0 }, uSize: { value: 2.5 }, uVisibility: this.uniforms.uVisibility },
    }));
    this.lights.frustumCulled = false;
    this.group.add(this.mesh, this.lights);
  }

  // Put it in a frame whose -z points at true bearing `heading` (rad), with
  // our platform's origin at `origin` (three.js, at sea level)
  place(heading, origin) {
    const b = THREE.MathUtils.degToRad(NEIGHBOUR.bearing) - heading;   // bearing in the frame, clockwise from -z
    this.group.position.set(origin.x + Math.sin(b) * NEIGHBOUR.distance, origin.y, origin.z - Math.cos(b) * NEIGHBOUR.distance);
    // its +x (left to right seen from us) runs at the `facing` bearing
    this.yaw = -(THREE.MathUtils.degToRad(NEIGHBOUR.facing) - heading) + Math.PI / 2;
    this.group.rotation.set(0, this.yaw, 0);
  }

  // Light, fog and night from outdoor.js's state; the cut-out turns to the camera
  update(outdoor, camera) {
    const u = this.uniforms, L = outdoor.light;
    u.uSky.value.copy(L.sky);
    u.uSun.value.copy(L.sun);
    u.uSunDir.value.copy(L.sunDir);
    u.uFogColor.value.copy(outdoor.uniforms.uFogColor.value);
    u.uVisibility.value = THREE.MathUtils.lerp(60000, 350, outdoor.uniforms.uFog.value ** 0.6);
    // the lights are always on, but only show once the sun is down
    this.lights.material.uniforms.uOn.value = 1 - THREE.MathUtils.smoothstep(outdoor.uniforms.uSunDir.value.y, -0.05, 0.1);
    if (this.look === 'a' && camera) {
      const p = camera.getWorldPosition(new THREE.Vector3());
      this.group.rotation.set(0, Math.atan2(p.x - this.group.position.x, p.z - this.group.position.z), 0);
    }
  }
}
