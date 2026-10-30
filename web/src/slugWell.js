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
  chokeX: 1.15, flowY: 0.45, flowEnd: 2.6, gasX: -2.6, gasY: -0.2,
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
export function contentsMaterial({ liq = 0x9a6424, gas = 0xbcd3dc, len = 12, inj = 0, wrap = 6 } = {}) {
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

// Gas in the annulus: brighter and denser the higher its pressure, chevrons
// running down toward the gas-lift valve (fast while gas goes in); liquid
// below the packer.
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
        // downward chevrons: lift gas heading for the gas-lift valve
        float ch = fract(vUv.y * 34.0 + uScroll * 0.6 + (0.5 - abs(fract(vUv.x * 3.0) - 0.5)) * 0.9);
        col = mix(col, vec3(0.75, 0.97, 1.0) * 1.3, (1.0 - smoothstep(0.0, 0.16, ch)) * (0.45 + 0.55 * uFlow));
        if (vUv.y < uPacker) col = vec3(0.34, 0.22, 0.10) * (0.85 + 0.15 * n);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Lift gas line: pale chevrons running along the pipe (uv.y) toward the well.
function gasLineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScroll: { value: 0 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uScroll; varying vec2 vUv;
      void main() {
        float ch = fract(vUv.y * 9.0 - uScroll + abs(fract(vUv.x * 2.0) - 0.5) * 0.7);
        vec3 col = mix(vec3(0.32, 0.45, 0.52), vec3(0.88, 0.97, 1.0), 1.0 - smoothstep(0.0, 0.18, ch));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
// Perforation tunnels: oil streaks running from the rock (uv.y 0) into the
// casing (uv.y 1), faster and brighter the more the well draws.
function perforationMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uScroll: { value: 0 }, uOn: { value: 0.5 } }, side: THREE.DoubleSide,
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uScroll, uOn; varying vec2 vUv;
      void main() {
        float st = fract(vUv.y * 4.0 - uScroll + fract(vUv.x * 3.0) * 0.5);
        vec3 col = mix(vec3(0.16, 0.11, 0.06), vec3(0.95, 0.62, 0.2), (1.0 - smoothstep(0.0, 0.35, st)) * uOn);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class SlugWell {
  constructor({ name = 'well', actuator = 'box', glass = true, flowline = true } = {}) {
    this.group = new THREE.Group(); this.group.name = name;
    const steel = new THREE.MeshStandardMaterial({ color: 0x7b858b, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide });
    const paint = new THREE.MeshStandardMaterial({ color: 0xb02a22, metalness: 0.2, roughness: 0.55 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.8 });
    this.mats = { steel, paint, rubber };

    // steel: casing and tubing back halves, gas line, flowline back half, separator stub
    const sg = [backTube(D.rc, D.bot - 0.4, D.top - 0.4), backTube(D.rt, D.bot, D.top), backTube(D.rc + 0.06, D.top - 0.4, D.top, 14)]; // casing, tubing, casing head
    if (flowline) { // a short flowline to a stub (scenes with a separator lay their own with pipeRun)
      sg.push(hTube(0.17, D.chokeX + 0.05, D.flowEnd, D.flowY, 10, true));
      const end = new THREE.SphereGeometry(0.5, 12, 8, Math.PI, Math.PI, 0, Math.PI); end.scale(0.5, 1, 1); end.translate(D.flowEnd + 0.05, D.flowY + 0.1, 0); sg.push(end);
    }
    // side-pocket mandrel: a bulge in the tubing that carries the gas-lift valve
    { const m = new THREE.CylinderGeometry(D.rt + 0.08, D.rt + 0.08, 0.9, 12, 1, true, Math.PI / 2, Math.PI); m.translate(0, D.inj + 0.1, 0); sg.push(m);
      for (const [y, rTop, rBot] of [[D.inj - 0.4, D.rt + 0.08, D.rt], [D.inj + 0.6, D.rt, D.rt + 0.08]]) { const c = new THREE.CylinderGeometry(rTop, rBot, 0.1, 12, 1, true, Math.PI / 2, Math.PI); c.translate(0, y, 0); sg.push(c); } } // tapered ends
    this.group.add(new THREE.Mesh(merge(sg), steel));

    // christmas tree, bottom up: wellhead spool, lower and upper master
    // valves, the cross with the wing valve toward the choke, swab valve and
    // tree cap. Gate valves are blocks with a bonnet and a handwheel facing
    // the viewer; flanges as thin discs (paint, one mesh; wheels in steel)
    const tg = [], wheels = [];
    const flange = (y, r = 0.3) => tg.push(tube(r, y - 0.035, y + 0.035, 12, false));
    const gate = (y, h = 0.34) => {
      const b = new THREE.BoxGeometry(0.4, h, 0.36); b.translate(0, y, 0); tg.push(b);
      const bon = new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8); bon.rotateX(Math.PI / 2); bon.translate(0, y, 0.28); tg.push(bon);
      const w = new THREE.TorusGeometry(0.15, 0.022, 4, 12); w.translate(0, y, 0.42); wheels.push(w);
      const sp = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 4); sp.rotateZ(Math.PI / 2); sp.translate(0, y, 0.42); wheels.push(sp);
    };
    tg.push(tube(0.42, D.top, 0.22, 12, false)); flange(0.22, 0.46); // wellhead spool on the casing head
    tg.push(tube(0.17, 0.22, 1.62, 10, true)); // through-bore between the valves
    flange(0.27); gate(0.46); flange(0.65); gate(0.84); flange(1.03, 0.28);
    { const x = new THREE.BoxGeometry(0.36, 0.3, 0.36); x.translate(0, D.wing, 0); tg.push(x); } // cross
    flange(1.22, 0.28); gate(1.4, 0.3); flange(1.58, 0.26);
    tg.push(tube(0.2, 1.58, D.tree, 10, false)); // tree cap
    // wing: flange, gate valve on its side, spool to the choke inlet
    { const w = new THREE.CylinderGeometry(0.11, 0.11, D.chokeX - 0.42, 8); w.rotateZ(Math.PI / 2); w.translate((D.chokeX - 0.42) / 2, D.wing, 0); tg.push(w); }
    { const b = new THREE.BoxGeometry(0.3, 0.32, 0.32); b.translate(0.42, D.wing, 0); tg.push(b);
      const bon = new THREE.CylinderGeometry(0.06, 0.08, 0.2, 8); bon.translate(0.42, D.wing + 0.26, 0); tg.push(bon);
      const w = new THREE.TorusGeometry(0.13, 0.02, 4, 12); w.rotateX(Math.PI / 2); w.translate(0.42, D.wing + 0.38, 0); wheels.push(w); }
    this.group.add(new THREE.Mesh(merge(tg), paint), new THREE.Mesh(merge(wheels), steel));
    // packer between tubing and casing, gas-lift valve on the tubing
    const pk = new THREE.CylinderGeometry(D.rc - 0.02, D.rc - 0.02, 0.28, 14, 1, false, Math.PI / 2, Math.PI); pk.translate(0, D.packer, 0);
    this.group.add(new THREE.Mesh(pk, rubber));
    // gas-lift valve in the mandrel's pocket, on the annulus side: a brass
    // body with a nose and a port into the tubing; it glows while gas goes in
    { const body = new THREE.CylinderGeometry(0.075, 0.075, 0.55, 10); body.translate(-D.rt - 0.13, D.inj + 0.15, 0.04);
      const nose = new THREE.ConeGeometry(0.075, 0.14, 10); nose.rotateX(Math.PI); nose.translate(-D.rt - 0.13, D.inj - 0.19, 0.04);
      const port = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6); port.rotateZ(Math.PI / 2); port.translate(-D.rt - 0.02, D.inj - 0.05, 0.04);
      this.glvMat = new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.6, roughness: 0.35, emissive: 0x7fd8ff, emissiveIntensity: 0 });
      this.group.add(new THREE.Mesh(merge([body, nose, port]), this.glvMat)); }
    // lift gas line into the casing head, with a small control valve on it
    this.gasLine = new THREE.Mesh(hTube(0.09, D.gasX, -D.rc, D.gasY, 10), gasLineMaterial());
    this.gasValve = new Valve({ body: 'globe', actuator: 'linear', r: 0.1, fluid: 'gas', name: 'lift gas valve', speed: 1 });
    this.gasValve.group.position.set(D.gasX + 0.6, D.gasY, 0); this.gasValve.set(0.5); this.gasValve.setCut({ style: 'glass', amount: 1 });
    this.group.add(this.gasLine, this.gasValve.group);
    // perforations: tapered tunnels through the casing into the reservoir,
    // oil streaming in along them
    { const tun = [];
      for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) {
        const t = new THREE.CylinderGeometry(0.08, 0.025, 0.7, 6, 1, true); // top (uv.y 1) = casing end
        t.rotateZ(sx < 0 ? -Math.PI / 2 : Math.PI / 2); t.translate(sx * (D.rc + 0.33), -11.9 - i * 0.24, 0.02); tun.push(t);
      }
      this.perfs = new THREE.Mesh(merge(tun), perforationMaterial()); this.group.add(this.perfs); }

    // contents
    const len = D.top - D.bot;
    this.tubing = new THREE.Mesh(tube(D.rt - 0.02, D.bot, D.top, 14), contentsMaterial({ len, inj: (D.inj - D.bot) / len, wrap: 6 }));
    this.annulus = new THREE.Mesh(backTube(D.rc - 0.03, D.bot - 0.4, D.top, 14), annulusMaterial((D.packer - (D.bot - 0.4)) / (D.top - D.bot + 0.4)));
    this.group.add(this.tubing, this.annulus);
    if (flowline) {
      this.flowline = pipeRun([new THREE.Vector3(D.chokeX, D.flowY, 0), new THREE.Vector3(D.flowEnd, D.flowY, 0)], 0.15).contents;
      this.group.add(this.flowline);
    }

    if (glass) { // faint near half of the casing
      const gm = new THREE.MeshStandardMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false });
      const front = new THREE.CylinderGeometry(D.rc + 0.01, D.rc + 0.01, D.top - D.bot + 0.4, 14, 1, true, -Math.PI / 2, Math.PI);
      front.translate(0, (D.top + D.bot - 0.4) / 2, 0);
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
      tree: new THREE.Vector3(-0.75, 1.2, 0), gasIn: new THREE.Vector3(D.gasX + 0.05, D.gasY - 0.3, 0),
      glv: new THREE.Vector3(-1.15, D.inj + 0.15, 0), gasValve: new THREE.Vector3(D.gasX + 0.6, D.gasY + 0.45, 0), packer: new THREE.Vector3(1.05, D.packer - 0.15, 0),
      tubing: new THREE.Vector3(0, -4.5, D.rt + 0.05), annulus: new THREE.Vector3(-D.rc - 0.6, -4.5, 0),
      res: new THREE.Vector3(1.6, -12.6, 0), toSep: new THREE.Vector3(D.flowEnd, D.flowY + 0.75, 0),
      gauge: D.gauge.clone().add(new THREE.Vector3(0, -0.75, 0)),
    };
    this.t = 0;
  }

  update(dt, sim) {
    this.t += dt;
    const tu = this.tubing.material.uniforms, fu = this.flowline?.material.uniforms, au = this.annulus.material.uniforms;
    // gas into the tubing breaks the column up; blocked, the liquid settles
    const mixTarget = THREE.MathUtils.smoothstep(sim.wiv, 0.02, 0.25);
    tu.uMix.value += (mixTarget - tu.uMix.value) * Math.min(1, dt * 3);
    tu.uHold.value = THREE.MathUtils.clamp(sim.holdup, 0.02, 0.98);
    const v = 0.15 + 0.12 * sim.wpc; // visual speed of the mixture (scene m/s)
    tu.uScroll.value += dt * v * (0.4 + 2.2 * tu.uMix.value);
    if (fu) flowUpdate(fu, dt, sim);
    au.uP.value = THREE.MathUtils.clamp((sim.pab - 90) / 80, 0, 1);
    au.uFlow.value = THREE.MathUtils.smoothstep(sim.wiv, 0, 0.6);
    au.uScroll.value += dt * (0.25 + 2.5 * au.uFlow.value);
    this.gasLine.material.uniforms.uScroll.value += dt * 1.2 * sim.p.wGc / 0.35; // lift gas rate is fixed
    this.gasValve.update(dt);
    this.glvMat.emissiveIntensity = 1.6 * au.uFlow.value;
    const pu = this.perfs.material.uniforms, draw = sim.wro / 15;
    pu.uOn.value = THREE.MathUtils.clamp(0.25 + 0.75 * draw, 0, 1);
    pu.uScroll.value += dt * (0.2 + 1.4 * draw);
    this.choke.set(sim.uOut); this.choke.update(dt);
    this.gauge.set(sim.pbh); this.gauge.update(dt);
    const on = sim.auto ? 1 : 0;
    this.signalMat.uniforms.uOn.value += (on - this.signalMat.uniforms.uOn.value) * Math.min(1, dt * 4);
    this.signalMat.uniforms.uT.value = this.t;
    this.picMat.emissiveIntensity = 0.6 * this.signalMat.uniforms.uOn.value;
  }
}

/** Animate a flowline's contents from the well sim: liquid share and speed. */
export function flowUpdate(fu, dt, sim) {
  const fl = sim.wpc > 1e-3 ? sim.wOil / sim.wpc : 1;
  // the stream is mostly liquid by mass but mostly gas by volume: show ~half
  fu.uHold.value = THREE.MathUtils.clamp(0.25 + 0.35 * fl * Math.min(1, sim.wpc / 15), 0.08, 0.9); fu.uMix.value = 1;
  fu.uScroll.value += dt * (0.3 + 0.25 * sim.wpc);
}

/**
 * Contents of a pipe along a polyline (each bend a hard corner), with the
 * pattern running continuously from the first point to the last. Returns the
 * contents mesh and a faint glass sleeve around it (two draws).
 */
export function pipeRun(points, r, { seg = 10 } = {}) {
  const parts = [], sleeves = [];
  let total = 0; const lens = [];
  for (let i = 0; i < points.length - 1; i++) { lens.push(points[i].distanceTo(points[i + 1])); total += lens[i]; }
  let s0 = 0;
  const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), dir = new THREE.Vector3();
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1], len = lens[i];
    for (const [list, rr] of [[parts, r], [sleeves, r * 1.12]]) {
      const g = new THREE.CylinderGeometry(rr, rr, len + (list === parts ? rr * 0.9 : rr * 2), seg, 1, true).toNonIndexed();
      // cylinder uv.y: 1 at +y; map it to the distance along the whole run
      const uv = g.attributes.uv, pos = g.attributes.position;
      for (let k = 0; k < uv.count; k++) uv.setY(k, (s0 + len / 2 + pos.getY(k)) / total);
      q.setFromUnitVectors(up, dir.subVectors(b, a).normalize());
      g.applyQuaternion(q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      list.push(g);
    }
    s0 += len;
  }
  const contents = new THREE.Mesh(merge(parts), contentsMaterial({ len: total, inj: -0.001, wrap: 5 }));
  const sleeve = new THREE.Mesh(merge(sleeves), new THREE.MeshStandardMaterial({ color: 0xcfe6ee, transparent: true, opacity: 0.12, roughness: 0.1, depthWrite: false }));
  sleeve.renderOrder = 2;
  return { contents, sleeve, length: total };
}
