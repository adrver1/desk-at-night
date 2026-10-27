// Control valve / choke with an electric actuator, cut open like the
// separator: 'glass' fades the near half of the body and bonnet, 'section'
// sweeps a cut plane through the valve's own mid-plane (local z = 0, which
// holds the flow axis and the stem). The actuator stays whole: only the flow
// path is of interest.
//
//   const lv = new Valve({ body: 'globe', actuator: 'box', r: 0.13, fluid: 'water' });
//   scene.add(lv.group); lv.set(0.42); ... lv.setCut({ style: 'glass', amount }); lv.update(dt)
//
// Local frame: flow along +x through the body centre at the origin, stem and
// actuator up +y. An 'angle' body (a choke) takes the flow in from -x and
// lets it out downwards (-y). Sizes scale with the pipe bore radius r.
// Cage-guided plug trim: the plug lifts inside a cage of holes, so the share
// of holes it uncovers is the opening.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FLUID = { water: 0x2f8fb0, oil: 0xb8742a, gas: 0xd8e4ea, well: 0x6b5a3c };
const PAINT = { box: 0x2f5d8c, multiturn: 0xa3262a, linear: 0xb7bec4 };
const ACTUATORS = ['box', 'multiturn', 'linear'];

// half (z >= 0 or z <= 0) of a surface of revolution; profile = [[along, radius], ...]
function halfLathe(profile, front, axis = 'y', seg = 4) {
  const g = new THREE.LatheGeometry(profile.map(([a, r]) => new THREE.Vector2(r, a)), seg, front ? -Math.PI / 2 : Math.PI / 2, Math.PI);
  if (axis === 'x') g.rotateZ(-Math.PI / 2); // lathe axis y -> x (z unchanged)
  return g;
}
const solid = (y0, y1, r) => [[y0, 0], [y0, r], [y1, r], [y1, 0]];
const prep = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; };
const merge = (list) => mergeGeometries(list.map(prep));

function cageTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#000'; g.beginPath(); g.arc(16, 16, 9, 0, 2 * Math.PI); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 4);
  return t;
}

export class Valve {
  constructor({ body = 'globe', actuator = 'box', r = 0.13, fluid = 'water', name = 'valve', speed = 0.25 } = {}) {
    this.body = body; this.r = r; this.speed = speed; // speed: stroke fraction per second (electric actuators are slow)
    this.target = 0.5; this.opening = 0.5; this.flowing = 1; this.time = 0;
    this.group = new THREE.Group(); this.group.name = name;
    this.localPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), BIG);
    this.cutPlane = new THREE.Plane(); this.clip = [this.cutPlane];
    this.cut = { style: 'glass', amount: 0 }; this.matKey = null;

    const clip = this.clip;
    const mat = (o) => new THREE.MeshStandardMaterial({ clippingPlanes: clip, ...o });
    this.m = {
      steel: mat({ color: 0x7b858b, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide }),
      trim: mat({ color: 0xd08a2e, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }), // plug + stem in brass, to stand out against the cage
      cage: mat({ color: 0xb8bbb6, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide, alphaMap: cageTexture(), alphaTest: 0.5 }),
    };
    this.m.steelFront = this.m.steel.clone(); this.m.steelFront.clippingPlanes = clip;
    this.fluidMat = this.makeFluid(FLUID[fluid] ?? FLUID.water, fluid === 'gas');

    // body + bonnet, in halves so the near one can fade or be cut
    const R = r, bonnetTop = 3.25 * R, steel = { back: [], front: [] }, fluidGeo = [];
    for (const front of [false, true]) {
      const list = front ? steel.front : steel.back;
      if (body === 'angle') {
        list.push(halfLathe([[-3.4, 1], [-2.6, 1], [-2.6, 1.7], [-2.35, 1.7], [-2.35, 1.1], [-1.5, 1.5], [-0.6, 1.9], [0.6, 1.9], [1.2, 1.6], [1.6, 1.25]].map(([a, b]) => [a * R, b * R]), front, 'y', 5));
        list.push(halfLathe([[-3.4, 1], [-2.6, 1], [-2.6, 1.7], [-2.35, 1.7], [-2.35, 1.1], [-1.5, 1.2]].map(([a, b]) => [a * R, b * R]), front, 'x', 5));
      } else {
        list.push(halfLathe([[-3.4, 1], [-2.6, 1], [-2.6, 1.7], [-2.35, 1.7], [-2.35, 1.1], [-1.7, 1.3], [-1, 1.85], [0, 2], [1, 1.85], [1.7, 1.3], [2.35, 1.1], [2.35, 1.7], [2.6, 1.7], [2.6, 1], [3.4, 1]].map(([a, b]) => [a * R, b * R]), front, 'x', 5));
      }
      list.push(halfLathe([[1.5, 1.2], [2.3, 0.85], [2.9, 0.85], [2.9, 1.3], [bonnetTop / R, 1.3], [bonnetTop / R, 0.4]].map(([a, b]) => [a * R, b * R]), front, 'y', 5));
    }
    // fluid inside the body (whole: it is clipped in section, seen through the glass)
    if (body === 'angle') {
      fluidGeo.push(new THREE.LatheGeometry([[-3.4, 0.9], [-2.35, 0.95], [-1.5, 1.35], [-0.6, 1.75], [0.6, 1.75], [1.2, 1.4], [1.5, 0]].map(([a, b]) => new THREE.Vector2(b * R, a * R)), 8));
      const side = new THREE.CylinderGeometry(0.9 * R, 0.9 * R, 2.2 * R, 8, 1, true); side.rotateZ(Math.PI / 2); side.translate(-2.3 * R, 0, 0); fluidGeo.push(side);
    } else {
      const lg = new THREE.LatheGeometry([[-3.4, 0], [-3.4, 0.9], [-1.7, 1.15], [-1, 1.7], [0, 1.85], [1, 1.7], [1.7, 1.15], [3.4, 0.9], [3.4, 0]].map(([a, b]) => new THREE.Vector2(b * R, a * R)), 8);
      lg.rotateZ(-Math.PI / 2); fluidGeo.push(lg);
    }
    this.fluid = new THREE.Mesh(merge(fluidGeo), this.fluidMat); this.fluid.name = 'fluid'; this.fluid.renderOrder = 1;

    // inner walls: a seat deck with the seat bore, so the only way through is
    // the seat. Globe: an S-shaped bridge (deck + a wall up on the inlet side
    // and down on the outlet side): in under the deck, up through the seat into
    // the cage, out through its uncovered holes, over to the outlet. Angle: in
    // from the side above the deck, through the cage holes, down the seat.
    const ys = body === 'angle' ? -1.2 * R : -0.3 * R, walls = [];
    const bore = new THREE.Path().absarc(0, 0, 0.8 * R, 0, 2 * Math.PI, true);
    let deck;
    if (body === 'angle') {
      deck = new THREE.Shape().absarc(0, 0, 1.55 * R, 0, 2 * Math.PI, false);
    } else {
      deck = new THREE.Shape(); const w = 0.95 * R, d = 1.78 * R;
      deck.moveTo(-w, -d); deck.lineTo(w, -d); deck.lineTo(w, d); deck.lineTo(-w, d); deck.closePath();
      // side walls: circle segments (radius rw) above the deck on the inlet side, below it on the outlet side
      const rw = 1.82 * R;
      for (const [x, up] of [[-w, true], [w, false]]) {
        const a0 = Math.asin(ys / rw), sh = new THREE.Shape(), n = 8;
        for (let i = 0; i <= n; i++) {
          const a = up ? a0 + ((Math.PI - 2 * a0) * i) / n : Math.PI - a0 + ((Math.PI + 2 * a0) * i) / n;
          const v = [rw * Math.cos(a), rw * Math.sin(a)]; i ? sh.lineTo(...v) : sh.moveTo(...v);
        }
        sh.closePath();
        const g = new THREE.ShapeGeometry(sh); g.rotateY(Math.PI / 2); g.translate(x, 0, 0); walls.push(g);
      }
    }
    deck.holes.push(bore);
    const deckGeo = new THREE.ShapeGeometry(deck, 12); deckGeo.rotateX(-Math.PI / 2); deckGeo.translate(0, ys, 0); walls.push(deckGeo);
    // trim: seat ring + cage (static), plug + stem (moving)
    const seat = new THREE.CylinderGeometry(0.86 * R, 0.86 * R, 0.14 * R, 12, 1, true); seat.translate(0, ys, 0);
    this.cageMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.78 * R, 0.78 * R, 1.4 * R, 10, 1, true), this.m.cage);
    this.cageMesh.position.y = ys + 0.7 * R; this.cageMesh.name = 'cage';
    const yokeTop = 4.8 * R, posts = [];
    for (const sx of [-1, 1]) { const p = new THREE.BoxGeometry(0.22 * R, yokeTop - bonnetTop, 0.3 * R); p.translate(sx * 0.75 * R, (yokeTop + bonnetTop) / 2, 0); posts.push(p); }
    const yokePlate = new THREE.BoxGeometry(1.9 * R, 0.12 * R, 0.7 * R); yokePlate.translate(0, yokeTop, 0); posts.push(yokePlate);
    this.travel = 1.0 * R; // plug lift from closed to open
    this.plugY = ys + 0.9 * R; // plug top when closed: its bottom then sits on the seat
    const plug = new THREE.CylinderGeometry(0.76 * R, 0.76 * R, 0.9 * R, 10); plug.translate(0, -0.45 * R, 0);
    const stem = new THREE.CylinderGeometry(0.11 * R, 0.11 * R, yokeTop, 6); stem.translate(0, yokeTop / 2, 0);
    const pointer = new THREE.BoxGeometry(0.5 * R, 0.06 * R, 0.06 * R); pointer.translate(0.3 * R, 3.6 * R - this.plugY, 0); // position indicator on the stem
    this.plug = new THREE.Mesh(merge([plug, stem, pointer]), this.m.trim); this.plug.name = 'plug and stem';

    // actuator: one solid painted housing (looks are variants)
    const s = THREE.MathUtils.clamp(R * 2.4, 0.26, 0.6), base = yokeTop + 0.06 * R;
    this.actuators = {};
    for (const kind of ACTUATORS) this.actuators[kind] = this.makeActuator(kind, s, base);

    this.backSteel = new THREE.Mesh(merge([...steel.back, seat, ...walls, ...posts]), this.m.steel); this.backSteel.name = 'body back half';
    this.frontSteel = new THREE.Mesh(merge(steel.front), this.m.steelFront); this.frontSteel.name = 'body front half';
    this.group.add(this.backSteel, this.frontSteel, this.cageMesh, this.plug, this.fluid);
    for (const a of Object.values(this.actuators)) this.group.add(a.group);
    this.setActuator(actuator);
    this.update(0);
  }

  setActuator(kind) {
    this.actuator = kind;
    for (const [k, a] of Object.entries(this.actuators)) a.group.visible = k === kind;
  }

  makeActuator(kind, s, y0) {
    // solid and never cut: only the flow path matters, so no motor internals
    const paint = new THREE.MeshStandardMaterial({ color: PAINT[kind], metalness: 0.25, roughness: 0.45 });
    const parts = [], solidParts = [];
    const box = (w, h, d, x, y, z = 0) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); parts.push(b); };
    const cylY = (y0, y1, r, x = 0, seg = 10) => { const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg); g.translate(x, (y0 + y1) / 2, 0); parts.push(g); };
    const cylX = (x0, x1, r, y, seg = 10) => { const g = new THREE.CylinderGeometry(r, r, x1 - x0, seg); g.rotateZ(Math.PI / 2); g.translate((x0 + x1) / 2, y, 0); parts.push(g); };
    const wheel = (r, x, y, z, axis) => {
      const t = new THREE.TorusGeometry(r, r * 0.09, 4, 12);
      if (axis === 'x') t.rotateY(Math.PI / 2); else if (axis === 'y') t.rotateX(Math.PI / 2);
      t.translate(x, y, z); solidParts.push(t);
      for (let i = 0; i < 3; i++) { const sp = new THREE.BoxGeometry(r * 2, r * 0.08, r * 0.08); sp.rotateZ((i * Math.PI) / 3); if (axis === 'x') sp.rotateY(Math.PI / 2); else if (axis === 'y') sp.rotateX(Math.PI / 2); sp.translate(x, y, z); solidParts.push(sp); }
    };
    let display; // where the % display sits: [x, y, z, w]
    if (kind === 'box') {
      // compact square housing, motor out to one side, handwheel on the other
      const h = 0.75 * s;
      box(s, h, s, 0, y0 + h / 2);
      cylY(y0 + h, y0 + h + 0.1 * s, 0.36 * s);
      cylX(-s / 2 - 0.45 * s, -s / 2, 0.22 * s, y0 + 0.4 * h);
      wheel(0.3 * s, s / 2 + 0.08 * s, y0 + 0.5 * h, 0, 'x');
      display = [0.12 * s, y0 + 0.62 * h, s / 2 + 0.003, 0.42 * s];
      this.actTop = y0 + h + 0.1 * s;
    } else if (kind === 'multiturn') {
      // round gearbox drum, finned motor sideways, control box with display on top, big handwheel behind
      const h = 0.6 * s;
      cylY(y0, y0 + h, 0.48 * s, 0, 6);
      cylX(0.4 * s, 1.05 * s, 0.26 * s, y0 + 0.45 * h, 6);
      for (let i = 0; i < 4; i++) { const f = new THREE.TorusGeometry(0.27 * s, 0.02 * s, 3, 10); f.rotateY(Math.PI / 2); f.translate(0.55 * s + i * 0.13 * s, y0 + 0.45 * h, 0); solidParts.push(f); }
      box(0.7 * s, 0.38 * s, 0.6 * s, -0.05 * s, y0 + h + 0.19 * s);
      wheel(0.42 * s, 0, y0 + 0.5 * h, -0.62 * s, 'z');
      display = [-0.05 * s, y0 + h + 0.19 * s, 0.3 * s + 0.003, 0.4 * s];
      this.actTop = y0 + h + 0.38 * s;
    } else {
      // linear: a tall can with a domed cap and a display window, small override knob
      const h = 1.25 * s;
      cylY(y0, y0 + h, 0.34 * s, 0, 6);
      parts.push(new THREE.LatheGeometry([[0.34, 0], [0.28, 0.12], [0.15, 0.18], [0, 0.2]].map(([rr, yy]) => new THREE.Vector2(rr * s, y0 + h + yy * s)), 10));
      wheel(0.12 * s, 0.36 * s, y0 + 0.3 * h, 0, 'x');
      display = [0, y0 + 0.72 * h, 0.34 * s + 0.004, 0.34 * s];
      this.actTop = y0 + h + 0.2 * s;
    }
    const g = new THREE.Group(); g.name = `actuator (${kind})`;
    const housing = new THREE.Mesh(merge([...parts, ...solidParts]), paint); housing.name = 'actuator housing';
    // local display: % open, redrawn only when the shown number changes
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const dispMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const [dx, dy, dz, dw] = display;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(dw, dw / 2), dispMat); disp.position.set(dx, dy, dz);
    g.add(housing, disp);
    return { group: g, canvas: c, tex, shown: null };
  }

  makeFluid(color, gas) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.3, transparent: true, opacity: gas ? 0.22 : 0.55, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: this.clip });
    this.U = { uTime: { value: 0 }, uFlow: { value: 1 } };
    const U = this.U, angle = this.body === 'angle';
    m.customProgramCacheKey = () => `valve-fluid-${angle}`;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vL;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvL = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vL; uniform float uTime, uFlow;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  // streaks running along the flow path, faster with more flow
  float along = ${angle ? 'max(-vL.x, 0.) - min(vL.y, 0.)' : 'vL.x'} * ${(1 / this.r).toFixed(3)};
  float st = fract(along * 0.6 - uTime + 0.35 * sin(vL.y * ${(9 / this.r).toFixed(3)} + vL.z * ${(7 / this.r).toFixed(3)}));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.), smoothstep(0.75, 1., st) * 0.45 * step(0.02, uFlow));
  diffuseColor.a *= 0.75 + 0.25 * uFlow;`);
    };
    return m;
  }

  /** Target opening 0..1; the stem travels there at the actuator's speed. */
  set(u) { this.target = THREE.MathUtils.clamp(u, 0, 1); }

  setCut({ style = this.cut.style, amount = this.cut.amount } = {}) {
    this.cut = { style, amount };
    const e = amount * amount * (3 - 2 * amount), glass = style === 'glass';
    this.localPlane.constant = glass ? BIG : 2.2 * this.r * (1 - e) + 0.001; // the actuator above is never cut
    const m = this.m.steelFront, key = `${style}|${amount > 0}|${amount > 0.5}`;
    if (key !== this.matKey) { m.transparent = glass && amount > 0; m.depthWrite = !(glass && amount > 0.5); m.needsUpdate = true; }
    m.opacity = glass ? 1 - 0.85 * e : 1;
    this.matKey = key;
  }

  update(dt) {
    const step = this.speed * dt;
    this.opening += THREE.MathUtils.clamp(this.target - this.opening, -step, step);
    this.plug.position.y = this.plugY + this.opening * this.travel;
    this.time += dt * (0.3 + 1.7 * this.opening);
    this.U.uTime.value = this.time; this.U.uFlow.value = this.opening;
    // world cut plane from the local mid-plane
    this.group.updateWorldMatrix(true, false);
    this.cutPlane.copy(this.localPlane).applyMatrix4(this.group.matrixWorld);
    const a = this.actuators[this.actuator], pct = Math.round(this.opening * 100);
    if (a.shown !== pct) {
      a.shown = pct;
      const g = a.canvas.getContext('2d');
      g.fillStyle = '#0e1a14'; g.fillRect(0, 0, 128, 64);
      g.fillStyle = '#7dffa8'; g.font = '600 34px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`${pct}%`, 64, 36);
      a.tex.needsUpdate = true;
    }
  }
}
const BIG = 1e4;
