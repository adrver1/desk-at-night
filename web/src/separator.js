// Weir-type three-phase inlet separator that can be cut open along its axis.
//
//   const sep = new Separator();  scene.add(sep.group);
//   sep.setCut({ style: 'section' | 'lift' | 'glass', amount: 0..1 });
//   sep.levels = { interface, surface, bucket, emulsion }   (metres, y = 0 on the axis)
//   sep.update(dt, time)  rebuilds the liquids and caps
//
// x runs along the vessel (inlet end at -x), y up, z toward the viewer. The
// vessel is generated here in code; the liquids are rebuilt every frame from
// the levels so they can slosh. SeparatorSim (below) drives the levels with a
// simple slug + level-control model.
import * as THREE from 'three';

export const DIM = {
  R: 1.5, T: 0.05, L: 12, // outer radius, wall, tangent to tangent
  weirX: 3.4, weirT: 0.04, crest: 0.15,
  baffleX: -3.8, baffleTop: 0.55,
  inletX: -5.1, gasX: 5.1, waterX: 2.6, oilX: 4.4,
  saddleX: [-3.9, 3.9], ground: -3.2,
};
const { R, T, L } = DIM;
const A = R / 2, RI = R - T, AI = A - T; // 2:1 elliptical heads
const X0 = -L / 2, X1 = L / 2;
const BIG = 1e3;

/** Interior radius at axial position x (0 beyond the head apex). */
export function rIn(x) {
  const u = x < X0 ? (X0 - x) / AI : x > X1 ? (x - X1) / AI : 0;
  return u >= 1 ? 0 : RI * Math.sqrt(1 - u * u);
}
/** Liquid surface width at height y inside the cylinder. */
export const chord = (y) => 2 * Math.sqrt(Math.max(0.0025, RI * RI - y * y));

const MAT = {
  shell: () => new THREE.MeshStandardMaterial({ color: 0x8c949a, metalness: 0.35, roughness: 0.55 }),
  inner: () => new THREE.MeshStandardMaterial({ color: 0xb9b3a6, metalness: 0.2, roughness: 0.75 }),
  internals: () => new THREE.MeshStandardMaterial({ color: 0xd7cfbf, metalness: 0.25, roughness: 0.6, side: THREE.DoubleSide }),
  pipe: () => new THREE.MeshStandardMaterial({ color: 0x6f7a80, metalness: 0.5, roughness: 0.45 }),
  saddle: () => new THREE.MeshStandardMaterial({ color: 0x5b6266, metalness: 0.3, roughness: 0.7 }),
};
export const LIQUID = {
  water: 0x2f8a96, emulsion: 0xd9c98f, oil: 0xb7802f,
};

function hatchTexture(col = '#e2553b') {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = col; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(40,10,5,0.55)'; g.lineWidth = 5;
  for (let i = -64; i <= 128; i += 21) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function holesTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#000'; g.beginPath(); g.arc(32, 32, 15, 0, 2 * Math.PI); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 0.18, 1 / 0.18);
  return t;
}
function meshTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#8e8a80'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#d9d3c4'; g.lineWidth = 2;
  for (let i = 0; i < 64; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 2); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Lathe profile (radius, axial) from the left apex to the right apex
function profile(r, a, n = 18) {
  const p = [];
  for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI / 2; p.push(new THREE.Vector2(r * Math.sin(t), X0 - a * Math.cos(t))); }
  for (let i = 1; i <= n; i++) { const t = (i / n) * Math.PI / 2; p.push(new THREE.Vector2(r * Math.cos(t), X1 + a * Math.sin(t))); }
  return p;
}
// Half shell: front = z > 0, back = z < 0
function halfShell(r, a, front) {
  const g = new THREE.LatheGeometry(profile(r, a), 32, front ? -Math.PI / 2 : Math.PI / 2, Math.PI);
  g.rotateZ(-Math.PI / 2); // lathe axis y -> x
  return g;
}
// Outline (x, y) of the ellipsoid-headed cylinder r, a cut by the plane z = c
function sectionOutline(r, a, c, n = 28) {
  if (Math.abs(c) >= r) return null;
  const Y = Math.sqrt(r * r - c * c), pts = [];
  const head = (y) => a * Math.sqrt(Math.max(0, 1 - (y * y + c * c) / (r * r)));
  for (let i = 0; i <= n; i++) { const y = Y * Math.sin(-Math.PI / 2 + (i / n) * Math.PI); pts.push(new THREE.Vector2(X1 + head(y), y)); }
  for (let i = 0; i <= n; i++) { const y = Y * Math.sin(Math.PI / 2 - (i / n) * Math.PI); pts.push(new THREE.Vector2(X0 - head(y), y)); }
  return pts;
}
function capGeometry(c) {
  const outer = sectionOutline(R, A, c);
  if (!outer) return null;
  const shape = new THREE.Shape(outer);
  const inner = sectionOutline(RI, AI, c);
  if (inner) shape.holes.push(new THREE.Path(inner));
  const g = new THREE.ShapeGeometry(shape, 1);
  g.translate(0, 0, c);
  return g;
}
// Circle segment of radius r below height top, in the (z, y) plane, placed at x
function segmentShape(r, top, n = 32) {
  const pm = Math.acos(THREE.MathUtils.clamp(-top / r, -1, 1)), s = new THREE.Shape();
  for (let i = 0; i <= n; i++) { const p = -pm + (2 * pm * i) / n; const v = [r * Math.sin(p), -r * Math.cos(p)]; i ? s.lineTo(...v) : s.moveTo(...v); }
  s.closePath();
  return s;
}
function atX(g, x) { g.rotateY(-Math.PI / 2); g.translate(x, 0, 0); return g; }

function pipeAlong(points, radius, mat) {
  // straight runs joined by tight bends
  const path = new THREE.CurvePath(), bend = radius * 2.2;
  let prev = points[0].clone();
  for (let i = 1; i < points.length; i++) {
    const p = points[i], next = points[i + 1];
    if (!next) { path.add(new THREE.LineCurve3(prev, p.clone())); break; }
    const a = p.clone().sub(prev).normalize(), b = next.clone().sub(p).normalize();
    const p0 = p.clone().addScaledVector(a, -bend), p1 = p.clone().addScaledVector(b, bend);
    path.add(new THREE.LineCurve3(prev, p0));
    path.add(new THREE.QuadraticBezierCurve3(p0, p.clone(), p1));
    prev = p1;
  }
  return new THREE.Mesh(new THREE.TubeGeometry(path, points.length * 12, radius, 14, false), mat);
}

export class Separator {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'separator 20-VA-001';
    this.cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), BIG); // keeps z <= constant
    this.cut = { style: 'section', amount: 0 };
    this.levels = { interface: -0.45, surface: DIM.crest + 0.066, bucket: -0.75, emulsion: 0.12 };
    this.waves = (x) => 0; // surface displacement in the separation section
    this.ripple = (x) => 0; // surface displacement in the oil compartment
    this.overflow = 0; // head over the weir crest, m
    this.anchors = {}; // named points for labels and gauges

    const clip = [this.cutPlane];
    const m = { shell: MAT.shell(), inner: MAT.inner(), int: MAT.internals(), pipe: MAT.pipe(), saddle: MAT.saddle() };
    for (const k of ['shell', 'inner', 'int']) m[k].clippingPlanes = clip;
    m.inner.side = THREE.BackSide;
    this.mats = m;

    // shell halves
    this.back = new THREE.Group(); this.front = new THREE.Group();
    this.front.name = 'front half'; this.back.name = 'back half';
    for (const [grp, front] of [[this.back, false], [this.front, true]]) {
      const outer = new THREE.Mesh(halfShell(R, A, front), front ? m.shell.clone() : m.shell);
      const inner = new THREE.Mesh(halfShell(RI, AI, front), front ? m.inner.clone() : m.inner);
      outer.castShadow = true;
      grp.add(outer, inner);
      grp.userData.mats = [outer.material, inner.material];
    }
    this.group.add(this.back, this.front);

    // section caps: one live cap for the sweeping plane, two fixed ones at z = 0
    this.capMat = new THREE.MeshStandardMaterial({ map: hatchTexture(), roughness: 0.7, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.sweepCap = new THREE.Mesh(new THREE.BufferGeometry(), this.capMat);
    this.backCap = new THREE.Mesh(capGeometry(0), this.capMat);
    this.frontCap = new THREE.Mesh(capGeometry(0), this.capMat);
    this.capC = null;
    this.group.add(this.sweepCap, this.backCap);
    this.front.add(this.frontCap);

    // internals (clipped with the cut)
    const int = new THREE.Group(); int.name = 'internals';
    const weir = new THREE.Mesh(atX(new THREE.ExtrudeGeometry(segmentShape(RI - 0.005, DIM.crest), { depth: DIM.weirT, bevelEnabled: false }), DIM.weirX + DIM.weirT / 2), m.int);
    weir.name = 'weir';
    const baffleMat = m.int.clone(); baffleMat.alphaMap = holesTexture(); baffleMat.alphaTest = 0.5; baffleMat.clippingPlanes = clip;
    const baffle = new THREE.Mesh(atX(new THREE.ShapeGeometry(segmentShape(RI - 0.005, DIM.baffleTop)), DIM.baffleX), baffleMat);
    baffle.name = 'calming baffle';
    const inlet = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 18, 1, true, 0, Math.PI), m.int);
    inlet.geometry.rotateX(Math.PI / 2); inlet.position.set(DIM.inletX + 0.05, R - 0.75, 0); inlet.name = 'inlet device';
    const padMat = m.int.clone(); padMat.map = meshTexture(); padMat.clippingPlanes = clip;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 1.9), padMat);
    pad.position.set(DIM.gasX, R - 0.58, 0); pad.name = 'mist extractor';
    int.add(weir, baffle, inlet, pad);
    for (const x of [DIM.waterX, DIM.oilX]) {
      for (const rot of [0, Math.PI / 2]) {
        const vb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.025), m.int);
        vb.rotation.y = rot; vb.position.set(x, -RI + 0.13, 0); int.add(vb);
      }
    }
    this.group.add(int);
    this.internals = int;

    // nozzles, flanges, pipes, saddles (never clipped)
    const nozzle = (x, up) => {
      const g = new THREE.Group();
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 18, 1, true), m.pipe);
      n.material.side = THREE.DoubleSide;
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.06, 20), m.pipe);
      n.position.y = up ? R + 0.1 : -R - 0.1; f.position.y = up ? R + 0.35 : -R - 0.35;
      g.add(n, f); g.position.x = x; return g;
    };
    this.group.add(nozzle(DIM.inletX, true), nozzle(DIM.gasX, true), nozzle(DIM.waterX, false), nozzle(DIM.oilX, false));
    const V = (x, y, z) => new THREE.Vector3(x, y, z), top = R + 1.7, low = DIM.ground + 0.55, pr = 0.15;
    this.pipes = {
      inlet: pipeAlong([V(DIM.inletX, top, -4), V(DIM.inletX, top, 0), V(DIM.inletX, R + 0.38, 0)], pr, m.pipe),
      gas: pipeAlong([V(DIM.gasX, R + 0.38, 0), V(DIM.gasX, top, 0), V(DIM.gasX, top, -4)], pr, m.pipe),
      water: pipeAlong([V(DIM.waterX, -R - 0.38, 0), V(DIM.waterX, low, 0), V(DIM.waterX, low, -4)], pr, m.pipe),
      oil: pipeAlong([V(DIM.oilX, -R - 0.38, 0), V(DIM.oilX, low, 0), V(DIM.oilX, low, -4)], pr, m.pipe),
    };
    for (const p of Object.values(this.pipes)) { p.castShadow = true; this.group.add(p); }
    this.anchors.gaugeInlet = V(DIM.inletX, (top + R) / 2 + 0.05, pr);
    this.anchors.gaugeGas = V(DIM.gasX, (top + R) / 2 + 0.05, pr);
    this.anchors.gaugeWater = V(DIM.waterX, (low - R) / 2 - 0.05, pr);
    this.anchors.gaugeOil = V(DIM.oilX, (low - R) / 2 - 0.05, pr);
    for (const x of DIM.saddleX) {
      const s = new THREE.Shape(), w = 1.25, h0 = DIM.ground;
      s.moveTo(-w, h0); s.lineTo(w, h0); s.lineTo(w, -Math.sqrt(R * R - w * w));
      for (let i = 1; i < 16; i++) { const z = w - (2 * w * i) / 16; s.lineTo(z, -Math.sqrt(R * R - z * z)); }
      s.lineTo(-w, -Math.sqrt(R * R - w * w)); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: false });
      g.translate(0, 0, -0.175); g.rotateY(-Math.PI / 2);
      const saddle = new THREE.Mesh(g, m.saddle); saddle.position.x = x; saddle.castShadow = saddle.receiveShadow = true;
      this.group.add(saddle);
    }

    // liquids: one rebuilt mesh per phase, plus GPU particles (droplets, bubbles, spray)
    this.U = {
      uTime: { value: 0 }, uLook: { value: 1 }, uStir: { value: 0 }, uCut: { value: BIG }, uGlass: { value: 0 },
      uIface: { value: 0 }, uSurf: { value: 0 }, uBucket: { value: 0 }, uEmul: { value: 0.1 }, uSize: { value: 1 },
    };
    this.particles = makeParticles(this.U);
    this.group.add(this.particles);
    this.liquids = {};
    for (const [k, col] of Object.entries(LIQUID)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 60000), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(3 * 60000), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: k === 'water' ? 0.25 : 0.35, metalness: 0, side: THREE.DoubleSide });
      liquidLook(mat, k, this.U);
      const mesh = new THREE.Mesh(geo, mat); mesh.name = k; mesh.frustumCulled = false;
      this.liquids[k] = mesh; this.group.add(mesh);
    }
    this.setCut({ style: 'section', amount: 0 });
  }

  setCut({ style = this.cut.style, amount = this.cut.amount } = {}) {
    this.cut = { style, amount };
    const e = amount * amount * (3 - 2 * amount);
    const sec = style === 'section', lift = style === 'lift', glass = style === 'glass';
    // where the solid is cut (z); BIG = not cut
    this.c = sec ? (R + 0.05) * (1 - e) : lift && amount > 0.001 ? 0 : BIG;
    this.cutPlane.constant = this.c;
    // rises, turns its inside to the viewer and settles behind and above
    this.front.position.set(0, lift ? 3.4 * e : 0, lift ? -2.2 * e : 0);
    this.front.rotation.set(lift ? 0.35 * e : 0, lift ? Math.PI * e : 0, 0);
    this.backCap.visible = this.frontCap.visible = lift && amount > 0.001;
    this.sweepCap.visible = sec && this.c < R;
    for (const mat of this.front.userData.mats) {
      mat.transparent = glass && amount > 0;
      mat.opacity = glass ? 1 - 0.88 * e : 1;
      mat.depthWrite = !(glass && amount > 0.5);
      mat.clippingPlanes = lift || glass ? [] : [this.cutPlane];
      mat.needsUpdate = true;
    }
    this.glass = glass && amount > 0;
  }

  update(dt = 0, stir = 0) {
    const U = this.U, lv = this.levels;
    U.uTime.value += dt; U.uStir.value = stir; U.uCut.value = this.c; U.uGlass.value = this.glass ? 1 : 0;
    U.uIface.value = lv.interface; U.uSurf.value = lv.surface; U.uBucket.value = lv.bucket; U.uEmul.value = lv.emulsion;
    this.particles.visible = U.uLook.value > 0.5 && (this.glass || this.c < R);
    if (this.sweepCap.visible && this.capC !== this.c) {
      this.sweepCap.geometry.dispose();
      this.sweepCap.geometry = capGeometry(this.c) ?? new THREE.BufferGeometry();
      this.capC = this.c;
    }
    this.buildLiquids();
  }

  // ---------------------------------------------------------------- liquids

  buildLiquids() {
    const lv = this.levels, c = this.c, front = this.glass;
    const wave = this.waves, rip = this.ripple, e2 = lv.emulsion / 2;
    const iface = (x) => lv.interface + 0.3 * wave(x);
    const surf = (x) => lv.surface + wave(x);
    const bottom = () => -BIG;
    const sepA = X0 - AI, sepB = DIM.weirX - DIM.weirT / 2, oilA = DIM.weirX + DIM.weirT / 2, oilB = X1 + AI;
    const out = this.soups ??= { water: new Soup(this.liquids.water), emulsion: new Soup(this.liquids.emulsion), oil: new Soup(this.liquids.oil) };
    for (const soup of Object.values(out)) soup.n = 0;
    const layer = (arr, x0, x1, n, lo, hi, top) => buildLayer(arr, x0, x1, n, lo, hi, top, c, front);
    layer(out.water, sepA, sepB, 170, bottom, (x) => iface(x) - e2, false);
    layer(out.emulsion, sepA, sepB, 170, (x) => iface(x) - e2, (x) => iface(x) + e2, false);
    layer(out.oil, sepA, sepB, 170, (x) => iface(x) + e2, surf, true);
    layer(out.oil, oilA, oilB, 50, bottom, (x) => lv.bucket + rip(x), true);
    if (this.overflow > 0.003) overflowSheet(out.oil, this.overflow, lv.bucket, c);
    for (const soup of Object.values(out)) soup.upload();
  }
}

// Flat-shaded triangle soup written straight into a mesh's buffers, one
// normal per quad: no garbage and no normal pass each frame
class Soup {
  constructor(mesh) {
    this.mesh = mesh; this.geo = mesh.geometry;
    this.p = this.geo.attributes.position.array; this.nr = this.geo.attributes.normal.array; this.n = 0;
  }
  quad(a, b, c, d) {
    if (this.n + 6 > this.p.length / 3) return;
    // normal from the diagonals, so degenerate edges still give a direction
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [a, b, c, a, c, d]) {
      const i = this.n++ * 3;
      this.p[i] = v[0]; this.p[i + 1] = v[1]; this.p[i + 2] = v[2];
      this.nr[i] = nx; this.nr[i + 1] = ny; this.nr[i + 2] = nz;
    }
  }
  upload() {
    const { position, normal } = this.geo.attributes;
    position.clearUpdateRanges(); normal.clearUpdateRanges();
    position.addUpdateRange(0, this.n * 3); normal.addUpdateRange(0, this.n * 3);
    position.needsUpdate = normal.needsUpdate = true;
    this.geo.setDrawRange(0, this.n);
    this.mesh.visible = this.n > 0;
  }
}

// One liquid layer between lo(x) and hi(x) over x0..x1, seen through a cut at
// z = c (or, when `front`, through a glass front: the curved wall at z > 0).
// Writes into a Soup.
function buildLayer(arr, x0, x1, n, lo, hi, top, c, front) {
  const cut = c < BIG / 2;
  const col = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(Math.PI * t) * 0.15 + (t - 0.5) * 0.85); // a little denser at the ends
    const r = rIn(x);
    const y0 = Math.max(lo(x), -r), y1 = Math.min(hi(x), r);
    col.push({ x, r, y0, y1: Math.max(y0, y1) });
  }
  const quad = (a, b, cc, d) => arr.quad(a, b, cc, d);
  for (let i = 0; i < n; i++) {
    const A = col[i], B = col[i + 1];
    if (A.y1 <= A.y0 && B.y1 <= B.y0) continue;
    if (cut) {
      // section face on the plane z = c, limited to the interior there
      const ya = Math.sqrt(Math.max(0, A.r * A.r - c * c)), yb = Math.sqrt(Math.max(0, B.r * B.r - c * c));
      if (ya > 0 || yb > 0) {
        const a0 = THREE.MathUtils.clamp(A.y0, -ya, ya), a1 = THREE.MathUtils.clamp(A.y1, -ya, ya);
        const b0 = THREE.MathUtils.clamp(B.y0, -yb, yb), b1 = THREE.MathUtils.clamp(B.y1, -yb, yb);
        if (a1 > a0 || b1 > b0) quad([A.x, a0, c], [B.x, b0, c], [B.x, b1, c], [A.x, a1, c]);
      }
    }
    if (top && A.y1 < A.r && B.y1 < B.r) {
      const wa = Math.sqrt(Math.max(0, A.r * A.r - A.y1 * A.y1)), wb = Math.sqrt(Math.max(0, B.r * B.r - B.y1 * B.y1));
      const fa = cut ? Math.min(c, wa) : wa, fb = cut ? Math.min(c, wb) : wb;
      if (fa > -wa || fb > -wb) quad([A.x, A.y1, -wa], [B.x, B.y1, -wb], [B.x, B.y1, Math.max(-wb, fb)], [A.x, A.y1, Math.max(-wa, fa)]);
    }
    if (front) {
      // curved wall behind the glass front half
      const K = 8;
      for (let k = 0; k < K; k++) {
        const ya0 = A.y0 + ((A.y1 - A.y0) * k) / K, ya1 = A.y0 + ((A.y1 - A.y0) * (k + 1)) / K;
        const yb0 = B.y0 + ((B.y1 - B.y0) * k) / K, yb1 = B.y0 + ((B.y1 - B.y0) * (k + 1)) / K;
        const z = (r, y) => Math.sqrt(Math.max(0, r * r - y * y)) * 0.995;
        quad([A.x, ya0, z(A.r, ya0)], [B.x, yb0, z(B.r, yb0)], [B.x, yb1, z(B.r, yb1)], [A.x, ya1, z(A.r, ya1)]);
      }
    }
  }
}

// Oil spilling over the weir crest: a falling sheet from the crest to the
// oil compartment's surface
function overflowSheet(arr, head, bucket, c) {
  const g = 9.81, x0 = DIM.weirX + DIM.weirT / 2, y0 = DIM.crest + head * 0.55;
  const vx = 1.1 * Math.sqrt(g * head), tf = Math.sqrt((2 * Math.max(0.05, y0 - bucket)) / g), n = 10;
  const thick = Math.max(0.025, head * 0.6);
  const zf = (y) => { const w = Math.sqrt(Math.max(0, RI * RI - y * y)) * 0.99; return [-w, Math.min(c, w)]; };
  for (let i = 0; i < n; i++) {
    const ta = (tf * i) / n, tb = (tf * (i + 1)) / n;
    const xa = x0 + vx * ta, ya = y0 - 0.5 * g * ta * ta, xb = x0 + vx * tb, yb = y0 - 0.5 * g * tb * tb;
    const [za0, za1] = zf(ya), [zb0, zb1] = zf(yb);
    if (za1 <= za0) continue;
    for (const dx of [0, thick]) {
      arr.quad([xa + dx, ya, za0], [xb + dx, yb, zb0], [xb + dx, yb, zb1], [xa + dx, ya, za1]);
    }
    // the face toward the cut
    arr.quad([xa, ya, za1], [xb, yb, zb1], [xb + thick, yb, zb1], [xa + thick, ya, za1]);
  }
}

// ---------------------------------------------------------------- liquid look

// Shared GLSL: value noise and the interior radius
const GLSL = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float rIn(float x) { float u = x < ${X0.toFixed(3)} ? (${X0.toFixed(3)} - x) / ${AI.toFixed(3)} : x > ${X1.toFixed(3)} ? (x - ${X1.toFixed(3)}) / ${AI.toFixed(3)} : 0.;
  return u >= 1. ? 0. : ${RI.toFixed(3)} * sqrt(1. - u * u); }
`;

// Flow streaks on the section faces, foam and glints on the surfaces, a
// swirling emulsion. uLook = 0 turns it all off (plain colours).
function liquidLook(mat, kind, U) {
  const flow = { water: 0.18, emulsion: 0.25, oil: 0.32 }[kind];
  mat.customProgramCacheKey = () => `liquid-${kind}`; // the hook's source is the same for every kind
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vP; varying vec3 vN; uniform float uTime, uLook, uStir;
${GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uLook > 0.5) {
  float t = uTime, side = abs(vN.z), up = abs(vN.y);
  float speed = ${flow.toFixed(2)} * (1. + 3. * uStir) * (0.4 + 0.4 * (vP.y + 1.5));
  ${kind === 'emulsion' ? `
  float sw = vnoise(vec2(vP.x * 3. - t * 0.4, vP.y * 26. + 2. * sin(vP.x * 2.3 + t * 0.7)));
  diffuseColor.rgb = mix(mix(vec3(${hex(LIQUID.water)}), vec3(${hex(LIQUID.oil)}), smoothstep(0.2, 0.8, sw)), vec3(0.92, 0.86, 0.7), 0.35 + 0.25 * vnoise(vP.xy * vec2(9., 40.)));` : ''}
  // streaks drifting from the inlet toward the weir on the section face
  float s = vnoise(vec2((vP.x - t * speed) * 1.3, vP.y * 16.)) * vnoise(vec2((vP.x - t * speed * 1.4) * 0.6, vP.y * 5.));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + 0.03, smoothstep(0.28, 0.6, s) * side * 0.55);
  ${kind === 'oil' ? `
  // foam: thick under the inlet, thinning downstream, more during a slug
  float reach = 1.4 + 3.5 * uStir;
  float fx = exp(-pow(max(0., vP.x - ${(DIM.inletX - 0.6).toFixed(2)}) / reach, 2.)) * step(vP.x, ${DIM.weirX.toFixed(2)});
  float fn = vnoise(vP.xz * 7. + vec2(-t * 1.3, t * 0.4)) * 0.6 + vnoise(vP.xz * 19. - t) * 0.4;
  float foam = smoothstep(0.75 - 0.5 * fx, 0.95 - 0.3 * fx, fn) * fx * up;
  // a foam band just under the surface on the section face too
  float fs = vnoise(vec2(vP.x * 9. - t * 1.5, vP.y * 30.)) * 0.6 + vnoise(vec2(vP.x * 23. + t, vP.y * 50.)) * 0.4;
  foam += side * fx * smoothstep(0.1 + 0.25 * uStir, 0., uSurfDepth(vP)) * smoothstep(0.45, 0.7, fs);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.9, 0.82), clamp(foam, 0., 0.9));` : ''}
  // moving glints on the free surface
  float g = vnoise(vec2(vP.x * 2.5 - t * 0.9, vP.z * 4. + t * 0.3));
  totalEmissiveRadiance += vec3(0.16) * smoothstep(0.72, 0.95, g) * up;
}`);
    if (kind === 'oil') sh.fragmentShader = sh.fragmentShader.replace('uniform float uTime, uLook, uStir;',
      'uniform float uTime, uLook, uStir, uSurf;\nfloat uSurfDepth(vec3 p) { return uSurf - p.y; }');
  };
}
function hex(c) { const col = new THREE.Color(c); return `${col.r.toFixed(3)}, ${col.g.toFixed(3)}, ${col.b.toFixed(3)}`; }

// Separation made visible: water droplets sinking through the oil, oil
// droplets rising through the water, gas bubbles rising out of the liquid,
// spray under the inlet device. All motion is computed in the vertex shader
// from a per-particle seed, so the CPU does nothing per frame. Drawn on the
// section plane (or behind the glass front), on top of the liquid faces.
function makeParticles(U, n = 1800) {
  const seed = new Float32Array(n * 4), kind = new Float32Array(n);
  const KINDS = [0.3, 0.25, 0.3, 0.15]; // shares: water drops, oil drops, gas bubbles, spray
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    let u = i / n, k = 0; while (k < 3 && u > KINDS[k]) { u -= KINDS[k]; k++; }
    kind[i] = k;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
attribute vec4 seed; attribute float kind;
uniform float uTime, uStir, uCut, uGlass, uIface, uSurf, uEmul, uSize;
varying vec3 vCol; varying float vA;
${GLSL}
void main() {
  float a = seed.x, b = seed.y, c = seed.z, d = seed.w, t = uTime;
  float x, y, size = 1., alpha = 1.;
  float top = uIface + uEmul * 0.5, bot = uIface - uEmul * 0.5;
  // how many of each kind show: a trickle normally, a swarm during a slug
  float share = kind < 0.5 ? 0.35 + 0.65 * uStir : kind < 1.5 ? 0.3 + 0.7 * uStir : kind < 2.5 ? 0.25 + 0.75 * uStir : 0.08 + 0.92 * uStir;
  if (kind < 0.5) { // water droplet sinking through the oil
    x = mix(${(X0 - 0.5).toFixed(2)}, ${(DIM.weirX - 0.15).toFixed(2)}, pow(a, 1.6));
    float p = fract(b + t * (0.05 + 0.08 * c) * (1. + uStir));
    y = mix(uSurf - 0.03, top, p); x += p * 0.6; vCol = vec3(0.35, 0.8, 0.85); size = 0.7 + 0.6 * c;
    alpha = smoothstep(0., 0.1, p) * smoothstep(1., 0.85, p);
  } else if (kind < 1.5) { // oil droplet rising through the water
    x = mix(${(X0 - 0.5).toFixed(2)}, ${(DIM.weirX - 0.15).toFixed(2)}, pow(a, 1.4));
    float p = fract(b + t * (0.05 + 0.07 * c) * (1. + uStir));
    float floor0 = -rIn(x) * 0.97;
    y = mix(floor0 + 0.04, bot, p); x += p * 0.5; vCol = vec3(0.95, 0.66, 0.25); size = 0.7 + 0.6 * c;
    alpha = smoothstep(0., 0.1, p) * smoothstep(1., 0.88, p);
  } else if (kind < 2.5) { // gas bubble rising out of the liquid, mostly near the inlet
    x = mix(${(X0 - 0.4).toFixed(2)}, ${(DIM.weirX - 0.2).toFixed(2)}, pow(a, 2.4));
    float p = fract(b + t * (0.25 + 0.3 * c) * (1. + 0.8 * uStir));
    float floor0 = -rIn(x) * 0.9;
    y = mix(floor0, uSurf + 0.01, p); x += 0.05 * sin(t * 6. + d * 40.);
    vCol = vec3(1.); size = 0.6 + 1.1 * c * (0.3 + p);
    alpha = 0.75 * smoothstep(0., 0.15, p) * step(p, 0.985);
  } else { // spray off the inlet device, falling toward the inlet head
    float p = fract(b + t * (0.7 + 0.6 * c));
    x = ${(DIM.inletX - 0.4).toFixed(2)} - p * (0.6 + 1.6 * a) * (0.6 + uStir);
    y = ${(R - 1.1).toFixed(2)} - 2.4 * p * p + 0.4 * p * (d - 0.3);
    vCol = vec3(0.95, 0.93, 0.85); size = 0.5 + 0.7 * c;
    alpha = step(uSurf, y) * smoothstep(1., 0.7, p);
  }
  float r = rIn(x);
  float w = sqrt(max(0., r * r - y * y));
  float z = uGlass > 0.5 ? w * 0.995 + 0.03 : min(uCut, w) + 0.02;
  if (abs(y) > r - 0.02 || (uGlass < 0.5 && uCut > w + 0.02) || d > share) alpha = 0.;
  vA = alpha;
  vec4 mv = modelViewMatrix * vec4(x, y, z, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * size * 34. / -mv.z;
}`,
    fragmentShader: /* glsl */ `
varying vec3 vCol; varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2. - 1.; float r2 = dot(q, q);
  if (r2 > 1. || vA < 0.01) discard;
  float rim = smoothstep(0.35, 1., r2);
  gl_FragColor = vec4(mix(vCol, vCol * 0.55, rim), vA * (1. - 0.4 * rim));
}`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.name = 'droplets'; pts.renderOrder = 2;
  return pts;
}

// ---------------------------------------------------------------- simulation

// A toy process model, good enough to show slugs and level control:
// inflow (with slugs) -> separation section (water and oil levels) -> weir
// overflow (Francis formula) -> oil compartment. Water and oil levels each
// have a PI level controller on their outlet; gas pressure is a first-order
// response to the gas surge behind a slug.
export class SeparatorSim {
  constructor() {
    this.base = { oil: 0.09, water: 0.06 }; // m3/s
    this.sp = { interface: -0.45, bucket: -0.75 };
    this.tune = { water: { kc: 0.5, ti: 40 }, oil: { kc: 0.8, ti: 30 } };
    this.hW = this.sp.interface; this.hL = DIM.crest + 0.066; this.hO = this.sp.bucket;
    this.iW = 0; this.iO = 0; this.P = 8; this.Tin = 66;
    this.qWout = this.base.water; this.qOout = this.base.oil; this.qOver = this.base.oil; this.qGas = 1;
    this.slugs = []; this.packets = []; this.t = 0; this.stir = 0; this.emulsion = 0.14;
    this.lsep = DIM.weirX - X0 + 0.5; this.loil = X1 + 0.5 - DIM.weirX;
  }
  slug(size = 1) { this.slugs.push({ t0: this.t, size, waved: false }); }
  waves(x) {
    let d = 0;
    for (const p of this.packets) { const u = x - p.x; d += p.a * Math.exp(-(u * u) / 1.6) * Math.cos(u * 2.2); }
    // continuous churn under the inlet
    d += 0.012 * Math.exp(-((x - DIM.inletX) ** 2) / 0.6) * Math.sin(7 * this.t + x * 5);
    return d;
  }
  ripple(x) { return Math.min(0.03, this.qOver * 0.05) * Math.exp(-((x - DIM.weirX - 0.4) ** 2) / 0.5) * Math.sin(9 * x - 8 * this.t); }
  step(dt) {
    this.t += dt;
    let liq = 0, gas = 0;
    for (const s of this.slugs) {
      const u = this.t - s.t0;
      liq += s.size * 14 * Math.exp(-(((u - 3) / 2.2) ** 2));
      gas += s.size * 2 * Math.exp(-(((u - 7.5) / 2.5) ** 2));
      if (!s.waved && u > 1.8) { s.waved = true; this.packets.push({ x: DIM.inletX, v: 3.6, a: 0.3 * s.size }); }
    }
    this.slugs = this.slugs.filter((s) => this.t - s.t0 < 20);
    const qWin = this.base.water * (1 + liq), qOin = this.base.oil * (1 + liq);
    // weir overflow from the surface just upstream of the weir
    const head = this.hL + this.waves(DIM.weirX - 0.15) - DIM.crest;
    this.head = Math.max(0, head);
    this.qOver = head > 0 ? 1.84 * chord(DIM.crest) * head ** 1.5 : 0;
    // PI level controllers (with simple anti-windup)
    const pi = (h, sp, base, tune, key, max) => {
      const e = h - sp, i = this[key] + (e * dt) / tune.ti, q = base + tune.kc * (e + i);
      if (q > 0 && q < max) this[key] = i;
      return THREE.MathUtils.clamp(q, 0, max);
    };
    this.qWout = pi(this.hW, this.sp.interface, this.base.water, this.tune.water, 'iW', 0.8);
    this.qOout = pi(this.hO, this.sp.bucket, this.base.oil, this.tune.oil, 'iO', 1.2);
    this.hW += ((qWin - this.qWout) / (chord(this.hW) * this.lsep)) * dt;
    this.hL += ((qWin - this.qWout + qOin - this.qOver) / (chord(this.hL) * this.lsep)) * dt;
    this.hO += ((this.qOver - this.qOout) / (chord(this.hO) * this.loil)) * dt;
    this.hW = THREE.MathUtils.clamp(this.hW, -RI + 0.05, RI - 0.3);
    this.hL = THREE.MathUtils.clamp(this.hL, this.hW + 0.15, RI - 0.1);
    this.hO = THREE.MathUtils.clamp(this.hO, -RI + 0.05, DIM.crest - 0.05);
    this.P += (8 + 1.4 * gas + 0.25 * liq / 9 - this.P) * Math.min(1, dt / 2.5);
    this.Tin += (66 - 0.35 * liq - this.Tin) * Math.min(1, dt / 4);
    this.qGas = 1 + 1.6 * gas;
    // how churned up the liquid is (foam, droplets, emulsion), 0..1
    this.stir += (Math.min(1, liq / 5) - this.stir) * Math.min(1, dt / (liq / 5 > this.stir ? 0.8 : 6));
    this.emulsion = 0.14 + 0.18 * this.stir;
    // wave packets: travel, reflect at the weir and the inlet head, lose energy at the baffle
    for (const p of this.packets) {
      const side = Math.sign(p.x - DIM.baffleX);
      p.x += p.v * dt;
      if (Math.sign(p.x - DIM.baffleX) !== side) p.a *= 0.6;
      if (p.v > 0 && p.x > DIM.weirX - 0.3) { p.v = -p.v; p.a *= 0.6; }
      if (p.v < 0 && p.x < X0 - 0.2) { p.v = -p.v; p.a *= 0.6; }
      p.a *= Math.exp(-dt / 9);
    }
    this.packets = this.packets.filter((p) => Math.abs(p.a) > 0.004);
  }
  apply(sep) {
    sep.levels.interface = this.hW; sep.levels.surface = this.hL; sep.levels.bucket = this.hO; sep.levels.emulsion = this.emulsion;
    sep.waves = (x) => this.waves(x); sep.ripple = (x) => this.ripple(x); sep.overflow = this.head;
  }
}
