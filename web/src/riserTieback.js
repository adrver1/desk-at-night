// Subsea tie-back for the anti-slug story, in world coordinates of the
// anti-slug scene (deck top at y = 0): a subsea well with a wet tree on the
// seabed, a flowline that runs downhill along the seabed to a low point at
// the riser base, the riser up through the jacket, and the topside choke on
// the deck. Contents are drawn whole, like the cut-open well: liquid blocks
// the low point, the riser fills, gas pushes through and blows it out.
// Not to scale: ~4 km of flowline is squeezed into ~20 m.
//
//   const tb = new RiserTieback({ wellX, riserX, chokeX, topY, seabedY, resY });
//   scene.add(tb.group); each frame: tb.update(dt, sim)   (sim: a RiserSim)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Valve } from './valve.js';
import { Gauge } from './gauge.js';
import { pipeRun, signalLine, contentsMaterial } from './slugWell.js';

const prep = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; };
const merge = (list) => mergeGeometries(list.map(prep));
const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g; };
const cyl = (r, y0, y1, x, seg = 10, open = false) => { const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, open); g.translate(x, (y0 + y1) / 2, 0); return g; };

export class RiserTieback {
  /**
   * wellX: subsea well; riserX: riser (inside the jacket); chokeX, topY: the
   * topside choke; seabedY(x): seabed height; resY: reservoir top.
   */
  constructor({ wellX, riserX, chokeX, topY, seabedY, resY }) {
    this.group = new THREE.Group(); this.group.name = 'riser tie-back';
    const steel = new THREE.MeshStandardMaterial({ color: 0x7b858b, metalness: 0.45, roughness: 0.5, side: THREE.DoubleSide });
    const paint = new THREE.MeshStandardMaterial({ color: 0xb02a22, metalness: 0.2, roughness: 0.55 });
    const yW = seabedY(wellX), yR = seabedY(riserX) + 0.18; // seabed at the well, flowline height at the riser base
    const treeTop = yW + 1.5, inY = yW + 0.75; // wet tree; its flowline outlet

    // subsea well: casing back half from the reservoir to the seabed, tubing contents
    this.group.add(new THREE.Mesh(merge([
      (() => { const g = new THREE.CylinderGeometry(0.55, 0.55, yW - resY + 0.6, 12, 1, true, Math.PI / 2, Math.PI); g.translate(wellX, (yW + resY - 0.6) / 2, 0); return g; })(),
    ]), steel));
    const wl = yW - resY;
    this.tubing = new THREE.Mesh(cyl(0.26, resY, yW + 0.3, wellX, 12, true), contentsMaterial({ len: wl, inj: -0.001, wrap: 6 }));
    this.group.add(this.tubing);
    // wet tree: guide base on the seabed, valve block with the wing to the
    // flowline, cap; a small frame round it (paint and steel, two meshes)
    const tg = [box(1.5, 0.2, 1.3, wellX, yW + 0.1, -0.2), box(0.7, 0.9, 0.7, wellX, yW + 0.65, 0), box(0.5, 0.25, 0.5, wellX, treeTop - 0.12, 0), box(0.5, 0.32, 0.36, wellX + 0.55, inY, 0)];
    const fg = [];
    for (const [dx, dz] of [[-0.7, -0.8], [0.7, -0.8], [-0.7, 0.4], [0.7, 0.4]]) fg.push(cyl(0.05, yW + 0.2, treeTop + 0.1, wellX + dx, 6).translate(0, 0, dz));
    fg.push(box(1.5, 0.08, 0.08, wellX, treeTop + 0.1, -0.8), box(1.5, 0.08, 0.08, wellX, treeTop + 0.1, 0.4));
    this.group.add(new THREE.Mesh(merge(tg), paint), new THREE.Mesh(merge(fg), steel));

    // flowline: from the wet tree down onto the seabed, downhill to the low
    // point and into the riser base. Built from the low point out, so its
    // contents fill from there (uv.y 0 at the riser base)
    const pts = [];
    pts.push(new THREE.Vector3(riserX, yR, 0), new THREE.Vector3(riserX - 1.6, yR, 0));
    for (let x = riserX - 4; x > wellX + 2; x -= 3) pts.push(new THREE.Vector3(x, seabedY(x) + 0.18, 0));
    pts.push(new THREE.Vector3(wellX + 1.6, yW + 0.18, 0), new THREE.Vector3(wellX + 1.1, inY, 0), new THREE.Vector3(wellX + 0.8, inY, 0));
    const fl = pipeRun(pts, 0.22);
    this.flowline = fl.contents; this.group.add(fl.contents, fl.sleeve);
    // riser: up the jacket and through the wellbay, then the short top section to the choke
    const rs = pipeRun([new THREE.Vector3(riserX, yR, 0), new THREE.Vector3(riserX, topY, 0), new THREE.Vector3(chokeX - 0.3, topY, 0)], 0.28);
    this.riser = rs.contents; this.group.add(rs.contents, rs.sleeve);
    this.riserH = (topY - yR) / rs.length; // share of the riser run that is vertical
    this.riser.material.uniforms.uInj.value = -0.001;

    // topside choke: the same angle valve as on the platform well (drawn at
    // half size and scaled up, as there); flow in from -x, out downwards
    this.chokeGroup = new THREE.Group(); this.chokeGroup.position.set(chokeX, topY, 0); this.chokeGroup.scale.setScalar(2);
    this.choke = new Valve({ body: 'angle', actuator: 'box', r: 0.13, fluid: 'well', name: 'topside choke', speed: 1.5 });
    this.choke.setCut({ style: 'glass', amount: 1 });
    this.chokeGroup.add(this.choke.group); this.group.add(this.chokeGroup);
    this.chokeOut = new THREE.Vector3(chokeX, topY - 2 * 3.4 * 0.13, 0);

    // inlet pressure at the wellhead (the controlled variable, ~BHP minus the
    // well's own column), signal up the umbilical to the controller on deck
    this.gauge = new Gauge({ tag: 'PT · inlet', unit: 'bar', min: 50, max: 90, major: 10, size: 0.95, damping: 0.25 });
    const gp = new THREE.Vector3(wellX + 2.9, yW + 2.4, 0.5);
    this.gauge.group.position.copy(gp); this.gauge.group.scale.setScalar(2);
    this.group.add(this.gauge.group);
    const lead = new THREE.Mesh(cyl(0.05, inY, gp.y - 0.95, wellX + 1.3, 5), steel);
    this.group.add(lead);
    const pic = new THREE.Vector3(chokeX - 2.4, topY + 2.6, 0.2);
    const sig = signalLine([gp.clone().add(new THREE.Vector3(1.0, 0, -0.3)), new THREE.Vector3(gp.x + 1.0, pic.y, 0.2), pic, new THREE.Vector3(chokeX, pic.y, 0.2), new THREE.Vector3(chokeX, topY + 1.0, 0.2)]);
    this.signalMat = sig.material; this.group.add(sig);
    this.picMat = new THREE.MeshStandardMaterial({ color: 0x2a3136, emissive: 0xf2b544, emissiveIntensity: 0, roughness: 0.6 });
    this.group.add(new THREE.Mesh(box(1.24, 0.84, 0.4, pic.x, pic.y, pic.z), this.picMat));

    // label anchors (world)
    const lowX = riserX - 1.2;
    this.anchors = {
      well: new THREE.Vector3(wellX + 1.1, (yW + resY) / 2, 0), tree: new THREE.Vector3(wellX - 0.4, treeTop + 0.5, 0),
      flowline: new THREE.Vector3((wellX + riserX) / 2, seabedY((wellX + riserX) / 2) + 0.9, 0),
      low: new THREE.Vector3(lowX, yR - 0.7, 0.4), riser: new THREE.Vector3(riserX + 0.9, (yR + topY) / 2 - 1, 0),
      choke: new THREE.Vector3(chokeX + 1.2, topY + 0.4, 0), pic: pic.clone().add(new THREE.Vector3(0, 0.75, 0)),
      gauge: gp.clone().add(new THREE.Vector3(0, -1.5, 0)), res: new THREE.Vector3(wellX + 3, resY - 1, 0),
    };
    this.t = 0;
  }

  update(dt, sim) {
    this.t += dt;
    const P = sim.p;
    // gas through the low point breaks the liquid up; blocked, it settles
    const gas = THREE.MathUtils.smoothstep(sim.wGrb, 0.02, 0.4);
    // riser: liquid fraction as a column (blocked) or slugs (gas through)
    const ru = this.riser.material.uniforms;
    ru.uMix.value += (gas - ru.uMix.value) * Math.min(1, dt * 3);
    ru.uHold.value = THREE.MathUtils.clamp(sim.aLr * this.riserH, 0.02, 0.98);
    ru.uScroll.value += dt * (0.2 + 0.12 * sim.wOut) * (0.4 + 2 * ru.uMix.value);
    // flowline: liquid backs up from the low point while gas is blocked
    const fu = this.flowline.material.uniforms, back = THREE.MathUtils.clamp(sim.h / P.hD / 8.5, 0, 1);
    fu.uMix.value += (gas - fu.uMix.value) * Math.min(1, dt * 3);
    fu.uHold.value = THREE.MathUtils.lerp(0.05 + 0.45 * back, 0.35, fu.uMix.value);
    fu.uScroll.value -= dt * (0.3 + 0.9 * sim.wGrb) * (0.3 + fu.uMix.value); // runs toward the riser (uv.y 0)
    // the well itself flows steadily, faster the lower the inlet pressure
    const tu = this.tubing.material.uniforms;
    tu.uMix.value = 1; tu.uHold.value = 0.75; tu.uScroll.value += dt * (0.15 + 0.06 * sim.wIn);
    this.choke.set(sim.uOut); this.choke.update(dt);
    this.gauge.set(sim.pin); this.gauge.update(dt);
    const on = sim.auto ? 1 : 0, su = this.signalMat.uniforms;
    su.uOn.value += (on - su.uOn.value) * Math.min(1, dt * 4); su.uT.value = this.t;
    this.picMat.emissiveIntensity = 0.6 * su.uOn.value;
  }
}
