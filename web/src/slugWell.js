// Cut-open gas-lifted platform well for the anti-slug story, drawn the way
// the separator is: back halves in steel, the near half as faint glass, the
// contents whole. Not to scale: ~2 km of well is squeezed into ~13 m and the
// pipes are many times too fat, so the slugs can be seen.
//
//   const well = new SlugWell(); scene.add(well.group);
//   each frame: well.update(dt, sim)   (sim: a SlugSim)
//
// Local frame: y up, the deck at y = 0, the reservoir at the bottom, the
// choke to +x, the lift gas coming in from -x. Built from a handful of
// merged meshes (about a dozen draws including the choke and the gauge).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Valve } from './valve.js';
import { Gauge } from './gauge.js';

export const WELL_DIM = {
  top: 0, inj: -9, packer: -9.45, bot: -12.2, res: [-13.6, -11.6], // depths (scene m)
  rc: 0.62, rt: 0.3, // casing and tubing radius
  tree: 1.6, wing: 1.05, // christmas tree height, wing outlet height
  chokeX: 1.15, flowY: 0.45, flowEnd: 2.6, gasX: -1.7, gasY: 0.55,
  gauge: new THREE.Vector3(-1.35, -10.9, 0.25),
};
const D = WELL_DIM;

const prep = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; };
const merge = (list) => mergeGeometries(list.map(prep));
// back half of a vertical tube (faces the viewer from behind), y0..y1
const backTube = (r, y0, y1, seg = 12) => { const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, true, Math.PI / 2, Math.PI); g.translate(0, (y0 + y1) / 2, 0); return g; };
const tube = (r, y0, y1, seg = 12, open = true) => { const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, open); g.translate(0, (y0 + y1) / 2, 0); return g; };
const hTube = (r, x0, x1, y, seg = 10, half = false) => {
  const g = half ? new THREE.CylinderGeometry(r, r, x1 - x0, seg, 1, true, Math.PI, Math.PI) : new THREE.CylinderGeometry(r, r, x1 - x0, seg, 1, true);
  g.rotateZ(-Math.PI / 2); g.translate((x0 + x1) / 2, y, 0); return g;
};

// Contents of a pipe: uv.y runs along it (0 = inlet end, 1 = outlet end).
// Below uInj it is all liquid; above it the liquid is either a column at the
// bottom (uMix 0, gas blocked) or broken into slugs and bubbles that ride
// up with the flow (uMix 1). uHold is the liquid fraction above uInj.
const NOISE = /* glsl */`
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }`;
function contentsMaterial({ liq = 0x9a6424, gas = 0xbcd3dc, len = 12, inj = 0, wrap = 6 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uHold: { value: 0.5 }, uMix: { value: 0 }, uScroll: { value: 0 }, uInj: { value: inj }, uLen: { value: len }, uWrap: { value: wrap },
      uLiq: { value: new THREE.Color(liq) }, uGas: { value: new THREE.Color(gas) } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float uHold, uMix, uScroll, uInj, uLen, uWrap; uniform vec3 uLiq, uGas;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main() {
        float s = (vUv.y - uInj) / (1.0 - uInj);
        float liquid = 1.0;
        if (s > 0.0) {
          float sep = 1.0 - smoothstep(uHold - 0.004, uHold + 0.004, s);
          // slugs: bands along the pipe, broken up by bubbles round the wall
          float m = vUv.y * uLen - uScroll;
          float n = 0.65 * noise(vec2(vUv.x * uWrap, m * 1.3)) + 0.35 * noise(vec2(vUv.x * uWrap * 2.5, m * 4.0));
          float disp = smoothstep(1.0 - uHold - 0.05, 1.0 - uHold + 0.05, n);
          liquid = mix(sep, disp, uMix);
        }
        float facing = abs(dot(normalize(vN), normalize(vV)));
        vec3 col = mix(uGas * (0.55 + 0.25 * facing), uLiq * (0.55 + 0.5 * facing), liquid);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Gas in the annulus: brighter and denser the higher its pressure, drifting
// down toward the injection valve while gas goes in; liquid below the packer.
function annulusMaterial(packerV) {
  return new THREE.ShaderMaterial({
    uniforms: { uP: { value: 0.5 }, uScroll: { value: 0 }, uPacker: { value: packerV }, uFlow: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uP, uScroll, uPacker, uFlow; varying vec2 vUv;
      ${NOISE}
      void main() {
        vec3 lo = vec3(0.10, 0.16, 0.20), hi = vec3(0.55, 0.78, 0.88);
        float n = noise(vec2(vUv.x * 6.0, vUv.y * 40.0 + uScroll));
        vec3 col = mix(lo, hi, uP) * (0.8 + 0.35 * n * (0.3 + uFlow));
        if (vUv.y < uPacker) col = vec3(0.34, 0.22, 0.10) * (0.85 + 0.15 * n);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class SlugWell {
  constructor({ name = 'well', actuator = 'box', glass = true } = {}) {
    this.group = new THREE.Group(); this.group.name = name;
    const steel = new THREE.MeshStandardMaterial({ color: 0x7b858b, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide });
    const paint = new THREE.MeshStandardMaterial({ color: 0xb02a22, metalness: 0.2, roughness: 0.55 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.8 });
    this.mats = { steel, paint, rubber };

    // steel: casing and tubing back halves, gas line, flowline back half, separator stub
    const sg = [backTube(D.rc, D.bot - 0.4, D.top + 0.6), backTube(D.rt, D.bot, D.top), backTube(D.rc + 0.06, D.top - 0.2, D.top + 0.6, 14)];
    sg.push(hTube(0.09, D.gasX, -D.rc, D.gasY, 8)); // lift gas into the casing head
    sg.push(hTube(0.17, D.chokeX + 0.05, D.flowEnd, D.flowY, 10, true)); // flowline (back half)
    { const end = new THREE.SphereGeometry(0.5, 12, 8, Math.PI, Math.PI, 0, Math.PI); end.scale(0.5, 1, 1); end.translate(D.flowEnd + 0.05, D.flowY + 0.1, 0); sg.push(end); }
    // perforations: short stubs through the casing into the reservoir
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) { const p = hTube(0.035, 0, 0.45, 0, 5); p.translate(sx > 0 ? D.rc : -D.rc - 0.45, -11.95 - i * 0.22, -0.05); sg.push(p); }
    this.group.add(new THREE.Mesh(merge(sg), steel));

    // christmas tree: master valves, cross, swab cap, wing to the choke (paint)
    const tg = [tube(0.36, 0.0, 0.5, 10, false), tube(0.36, 0.62, 1.3, 10, false), tube(0.26, 1.3, D.tree, 10, false)];
    { const w = new THREE.CylinderGeometry(0.13, 0.13, D.chokeX - 0.4, 8); w.rotateZ(Math.PI / 2); w.translate((D.chokeX - 0.4) / 2, D.wing, 0); tg.push(w); }
    for (const y of [0.25, 0.95]) { const hw = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8); hw.rotateX(Math.PI / 2); hw.translate(0, y, 0.42); tg.push(hw); }
    this.group.add(new THREE.Mesh(merge(tg), paint));
    // packer between tubing and casing, gas-lift valve on the tubing
    const pk = new THREE.CylinderGeometry(D.rc - 0.02, D.rc - 0.02, 0.28, 14, 1, false, Math.PI / 2, Math.PI); pk.translate(0, D.packer, 0);
    const glv = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6); glv.translate(D.rt + 0.07, D.inj + 0.1, 0);
    this.group.add(new THREE.Mesh(merge([pk, glv]), rubber));

    // contents
    const len = D.top - D.bot;
    this.tubing = new THREE.Mesh(tube(D.rt - 0.02, D.bot, D.top, 14), contentsMaterial({ len, inj: (D.inj - D.bot) / len, wrap: 6 }));
    this.annulus = new THREE.Mesh(backTube(D.rc - 0.03, D.bot - 0.4, D.top, 14), annulusMaterial((D.packer - (D.bot - 0.4)) / (D.top - D.bot + 0.4)));
    const fl = new THREE.CylinderGeometry(0.15, 0.15, D.flowEnd - D.chokeX, 10, 1, true); fl.rotateZ(Math.PI / 2); fl.translate((D.chokeX + D.flowEnd) / 2, D.flowY, 0);
    this.flowline = new THREE.Mesh(fl, contentsMaterial({ len: D.flowEnd - D.chokeX, inj: -0.001, wrap: 5 }));
    // uv.y on the rotated cylinder runs from +x to -x: flip so it scrolls downstream
    this.flowline.material.uniforms.uLen.value *= -1;
    this.group.add(this.tubing, this.annulus, this.flowline);

    if (glass) { // faint near half of the casing
      const gm = new THREE.MeshStandardMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false });
      const front = new THREE.CylinderGeometry(D.rc + 0.01, D.rc + 0.01, D.top + 0.6 - D.bot + 0.4, 14, 1, true, -Math.PI / 2, Math.PI);
      front.translate(0, (D.top + 0.6 + D.bot - 0.4) / 2, 0);
      const g = new THREE.Mesh(front, gm); g.renderOrder = 2; this.group.add(g);
    }

    // production choke (shared model from the separator scene): flow in
    // from the wing (-x), out downwards into the flowline
    this.choke = new Valve({ body: 'angle', actuator, r: 0.13, fluid: 'well', name: 'production choke', speed: 1.5 });
    this.choke.group.position.set(D.chokeX, D.wing, 0);
    this.choke.setCut({ style: 'glass', amount: 1 });
    this.group.add(this.choke.group);

    // downhole pressure, shown as a big dial next to the well with a lead to the tubing
    this.gauge = new Gauge({ tag: 'PT · BHP', unit: 'bar', min: 60, max: 180, major: 20, size: 0.95, damping: 0.25 });
    this.gauge.group.position.copy(D.gauge);
    this.group.add(this.gauge.group);
    const lead = new THREE.Mesh(hTube(0.03, D.gauge.x + 0.3, -D.rt, D.gauge.y, 5), steel);
    this.group.add(lead);

    // signal: gauge -> controller (PIC) -> choke actuator. A dashed line whose
    // dashes run toward the choke while the loop is on
    const pic = new THREE.Vector3(D.chokeX - 0.95, 2.75, 0.1);
    const pts = [D.gauge.clone().add(new THREE.Vector3(-0.6, 0, 0)), new THREE.Vector3(D.gauge.x - 0.6, pic.y, 0.1), pic, new THREE.Vector3(D.chokeX, pic.y, 0.1), new THREE.Vector3(D.chokeX, 2.2, 0.1)];
    let dist = 0; const pos = [], dd = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z); dd.push(dist, dist + a.distanceTo(b)); dist += a.distanceTo(b);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); lg.setAttribute('d', new THREE.Float32BufferAttribute(dd, 1));
    this.signalMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uOn: { value: 0 } }, transparent: true, depthWrite: false,
      vertexShader: 'attribute float d; varying float vD; void main() { vD = d; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uT, uOn; varying float vD;
        void main() { float dash = step(0.5, fract(vD * 2.5 - uT * 1.5)); vec3 c = mix(vec3(0.45, 0.5, 0.53), vec3(1.0, 0.72, 0.2), uOn);
          gl_FragColor = vec4(c, dash * mix(0.35, 1.0, uOn)); }`,
    });
    this.group.add(new THREE.LineSegments(lg, this.signalMat));
    const box = new THREE.BoxGeometry(0.62, 0.42, 0.2); box.translate(pic.x, pic.y, pic.z);
    this.picMat = new THREE.MeshStandardMaterial({ color: 0x2a3136, emissive: 0xf2b544, emissiveIntensity: 0, roughness: 0.6 });
    this.group.add(new THREE.Mesh(box, this.picMat));

    // label anchors (local)
    this.anchors = {
      pic: pic.clone().add(new THREE.Vector3(0, 0.45, 0)), choke: new THREE.Vector3(D.chokeX + 0.7, D.wing + 0.2, 0),
      tree: new THREE.Vector3(-0.75, 1.2, 0), gasIn: new THREE.Vector3(D.gasX + 0.1, D.gasY + 0.35, 0),
      glv: new THREE.Vector3(0.95, D.inj + 0.1, 0), packer: new THREE.Vector3(1.05, D.packer - 0.15, 0),
      tubing: new THREE.Vector3(0, -4.5, D.rt + 0.05), annulus: new THREE.Vector3(-D.rc - 0.6, -4.5, 0),
      res: new THREE.Vector3(1.6, -12.6, 0), toSep: new THREE.Vector3(D.flowEnd, D.flowY + 0.75, 0),
      gauge: D.gauge.clone().add(new THREE.Vector3(0, -0.75, 0)),
    };
    this.t = 0;
  }

  update(dt, sim) {
    this.t += dt;
    const tu = this.tubing.material.uniforms, fu = this.flowline.material.uniforms, au = this.annulus.material.uniforms;
    // gas into the tubing breaks the column up; blocked, the liquid settles
    const mixTarget = THREE.MathUtils.smoothstep(sim.wiv, 0.02, 0.25);
    tu.uMix.value += (mixTarget - tu.uMix.value) * Math.min(1, dt * 3);
    tu.uHold.value = THREE.MathUtils.clamp(sim.holdup, 0.02, 0.98);
    const v = 0.15 + 0.12 * sim.wpc; // visual speed of the mixture (scene m/s)
    tu.uScroll.value += dt * v * (0.4 + 2.2 * tu.uMix.value);
    const fl = sim.wpc > 1e-3 ? sim.wOil / sim.wpc : 1;
    fu.uHold.value = THREE.MathUtils.clamp(fl, 0.05, 0.95); fu.uMix.value = 1;
    fu.uScroll.value += dt * (0.2 + 0.15 * sim.wpc);
    au.uP.value = THREE.MathUtils.clamp((sim.pab - 90) / 80, 0, 1);
    au.uFlow.value = THREE.MathUtils.smoothstep(sim.wiv, 0, 0.6);
    au.uScroll.value += dt * (0.1 + 3 * au.uFlow.value);
    this.choke.set(sim.uOut); this.choke.update(dt);
    this.gauge.set(sim.pbh); this.gauge.update(dt);
    const on = sim.auto ? 1 : 0;
    this.signalMat.uniforms.uOn.value += (on - this.signalMat.uniforms.uOn.value) * Math.min(1, dt * 4);
    this.signalMat.uniforms.uT.value = this.t;
    this.picMat.emissiveIntensity = 0.6 * this.signalMat.uniforms.uOn.value;
  }
}
