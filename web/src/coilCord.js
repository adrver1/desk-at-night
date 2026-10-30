// A coiled telephone cord between a desk phone's base and its handset
// (blender/desk_phone.py: the CordSocket and CordPlug nodes).
//
// The cord is a short chain of points (Verlet: gravity, damping, a soft
// spring above its rest length and a firm one when squashed) pinned at both
// ends, with a floor under it so it lies on the desk. It is drawn as a helix
// wound along a smooth curve through the chain, so the coils spread out as
// the handset is pulled away. One mesh of about 4,500 triangles, rewritten
// in place every frame; nothing is allocated per frame.
//
//   const cord = new CoilCord({ color: base.userData.cordColor });
//   parent.add(cord.mesh);
//   // each frame, with both ends in the parent's space:
//   cord.step(socketPos, plugPos, dt);
//   // after a jump (a new shot), lay it out again: cord.reset()
import * as THREE from 'three';

const DEFAULTS = {
  nodes: 16,        // chain points
  rest: 0.30,       // metres of coiled cord between the ends when relaxed
  turns: 70,        // coils along the whole cord
  coilR: 0.0058,    // coil radius
  wireR: 0.0014,    // wire radius
  samples: 560,     // points along the centre line
  sides: 4,         // wire cross-section
  // the lowest the cord's centre may go at (x, z) in the parent's space:
  // a number, or a function (x, z, y) => height
  floor: 0,
};

export class CoilCord {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    const { samples: P, sides: S, nodes: N } = this.o;
    this.p = Array.from({ length: N }, () => new THREE.Vector3());
    this.q = this.p.map((v) => v.clone());
    this.curve = new THREE.CatmullRomCurve3(this.p.map((v) => v.clone()), false, 'centripetal');
    this.c = Array.from({ length: P + 1 }, () => new THREE.Vector3());
    this.pts = Array.from({ length: P + 1 }, () => new THREE.Vector3());
    this.rad = Array.from({ length: P + 1 }, () => new THREE.Vector3());
    this.pos = new Float32Array((P + 1) * S * 3);
    const idx = [];
    for (let i = 0; i < P; i++) {
      for (let k = 0; k < S; k++) {
        const a = i * S + k, b = i * S + ((k + 1) % S), c = a + S, d = b + S;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: options.color ?? 0x17181a, roughness: 0.45 }));
    this.mesh.name = 'CoilCord';
    this.mesh.frustumCulled = false;
    this.fresh = true;
    this.v = new THREE.Vector3();
    this.w = new THREE.Vector3();
  }

  reset() { this.fresh = true; }

  floorAt(v) {
    const f = this.o.floor;
    return (typeof f === 'function' ? f(v.x, v.z, v.y) : f) + this.o.coilR;
  }

  // a, b: the socket and the plug in the mesh's parent's space; dt in seconds
  step(a, b, dt) {
    const { nodes: N, rest } = this.o, seg = rest / (N - 1), p = this.p, q = this.q, tmp = this.v, vel = this.w;
    if (this.fresh) {   // laid out between the ends, sagging a little
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        p[i].lerpVectors(a, b, t);
        p[i].y -= Math.sin(Math.PI * t) * 0.06;
        q[i].copy(p[i]);
      }
      this.fresh = false;
    }
    const sub = 3, h = Math.min(Math.max(dt, 0), 1 / 30) / sub, g = -9.8 * h * h;
    for (let s = 0; s < sub; s++) {
      for (let i = 1; i < N - 1; i++) {
        vel.subVectors(p[i], q[i]).multiplyScalar(0.96);
        q[i].copy(p[i]);
        p[i].add(vel);
        p[i].y += g;
      }
      p[0].copy(a);
      p[N - 1].copy(b);
      for (let it = 0; it < 8; it++) {
        for (let i = 0; i < N - 1; i++) {   // stretchy above the rest length, firm when squashed below 60 %
          tmp.subVectors(p[i + 1], p[i]);
          const d = tmp.length() || 1e-6;
          const want = d > seg ? seg : d < seg * 0.6 ? seg * 0.6 : d, k = d > seg ? 0.35 : 0.5;
          tmp.multiplyScalar(((d - want) / d) * k * 0.5);
          if (i > 0) p[i].add(tmp);
          if (i + 1 < N - 1) p[i + 1].sub(tmp);
        }
        for (let i = 1; i < N - 1; i++) {   // resting on the floor, with friction
          const v = p[i], y = this.floorAt(v);
          if (v.y < y) {
            v.y = y;
            q[i].x += (v.x - q[i].x) * 0.3;
            q[i].z += (v.z - q[i].z) * 0.3;
          }
        }
      }
    }
    this.draw();
  }

  draw() {
    const { samples: P, sides: S, turns, coilR, wireR } = this.o, c = this.c, pts = this.pts, rad = this.rad, pos = this.pos;
    this.curve.points.forEach((v, i) => v.copy(this.p[i]));
    for (let i = 0; i <= P; i++) this.curve.getPoint(i / P, c[i]);
    // a frame carried along the centre line, the helix wound round it, then a thin tube round the helix
    const T = this.v, N = this.w, B = _b, r = _r, t2 = _t2, b2 = _b2, cur = _cur;
    T.subVectors(c[1], c[0]).normalize();
    N.set(0, 1, 0).cross(T);
    if (N.lengthSq() < 1e-6) N.set(1, 0, 0).cross(T);
    N.normalize();
    for (let i = 0; i <= P; i++) {
      T.subVectors(c[Math.min(i + 1, P)], c[Math.max(i - 1, 0)]).normalize();
      N.addScaledVector(T, -N.dot(T)).normalize();
      B.crossVectors(T, N);
      const a = (2 * Math.PI * turns * i) / P, end = Math.min(1, i / 12, (P - i) / 12);   // straight wire at the ends
      r.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      rad[i].copy(r);
      pts[i].copy(c[i]).addScaledVector(r, coilR * end);
    }
    for (let i = 0; i <= P; i++) {
      t2.subVectors(pts[Math.min(i + 1, P)], pts[Math.max(i - 1, 0)]).normalize();
      r.copy(rad[i]).addScaledVector(t2, -rad[i].dot(t2)).normalize();
      b2.crossVectors(t2, r);
      for (let k = 0; k < S; k++) {
        const a = (2 * Math.PI * k) / S, o = (i * S + k) * 3;
        cur.copy(pts[i]).addScaledVector(r, Math.cos(a) * wireR).addScaledVector(b2, Math.sin(a) * wireR);
        pos[o] = cur.x; pos[o + 1] = cur.y; pos[o + 2] = cur.z;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const _b = new THREE.Vector3(), _r = new THREE.Vector3(), _t2 = new THREE.Vector3(), _b2 = new THREE.Vector3(),
  _cur = new THREE.Vector3();
