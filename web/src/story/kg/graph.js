// A knowledge graph on a live slide: nodes and links with a place, size and
// colour per click, tweened between clicks. The living slide draws it flat
// (rings and lines on the 2D canvas); the diorama builds it from low-poly
// gems and rods that float in front of the slide.
import * as THREE from 'three';
import { Tw, KG_LOOK, col } from './engine.js';

const mixHex = (a, b, k) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();

export class Graph {
  // nodes: { id, label?, c (colour key), c2?, hub?, small? }
  // edges: [a, b, { c?, from?, dash? }]
  // target(node, build) -> { x, y, a, s, alt, red }  (alt mixes c toward c2)
  // edgeOn(edge, build) -> 0..1, on top of both ends being shown
  constructor({ nodes, edges, target, edgeOn = () => 1, hot = () => 0, r = 0.11, hubR = 0.2, labels = true, extra }) {
    Object.assign(this, { nodes, edges, target, edgeOn, hot, r, hubR, labels, extra });
    this.byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    this.tw = Object.fromEntries(nodes.map((n) => [n.id, new Tw({ x: 0, y: 0, a: 0, s: 0, alt: 0, red: 0 })]));
    this.edgeTw = edges.map(() => new Tw({ a: 0 }));
    this.born = {};
    this.build = 0;
  }

  init(slide) {
    this.slide = slide;
    this.lbl = {};
    for (const n of this.nodes) {
      if (!this.labels || !n.label) continue;
      const d = document.createElement('div');
      d.className = `kg-node ${n.hub ? 'hub' : ''}`;
      d.textContent = n.label;
      slide.html.append(d);
      this.lbl[n.id] = d;
    }
    if (KG_LOOK === 'b') this.make3D(slide.scene);
  }

  make3D(scene) {
    this.group = new THREE.Group();
    this.mesh = {};
    for (const n of this.nodes) {
      const geo = n.hub ? new THREE.OctahedronGeometry(this.hubR * 1.6, 0) : new THREE.IcosahedronGeometry(this.r * (n.small ? 1.2 : 1.7), 0);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ flatShading: true, transparent: true, roughness: 0.6 }));
      this.group.add(m);
      this.mesh[n.id] = m;
    }
    const rod = new THREE.CylinderGeometry(0.018, 0.018, 1, 5);
    rod.translate(0, 0.5, 0);
    rod.rotateX(Math.PI / 2);
    this.rods = this.edges.map(() => {
      const m = new THREE.Mesh(rod, new THREE.MeshBasicMaterial({ transparent: true }));
      this.group.add(m);
      return m;
    });
    scene.add(this.group);
    // so hide() takes it away with the slide's other objects
    this.slide.extraObjs = [...(this.slide.extraObjs ?? []), this.group];
  }

  goTo(b, t, fwd) {
    this.build = b;
    this.nodes.forEach((n, i) => {
      const tgt = { x: 0, y: 0, a: 1, s: 1, alt: 0, red: 0, ...this.target(n, b) };
      const cur = this.tw[n.id].get(performance.now() / 1000);
      if (fwd && tgt.a > 0.5 && cur.a < 0.5) this.born[n.id] = performance.now() / 1000 + 0.3 + (i % 12) * 0.03;
      this.tw[n.id].set(tgt, t, fwd ? (tgt.delay ?? (i % 12) * 0.03) : 0, tgt.dur ?? 0.9);
    });
    this.edges.forEach((e, i) => this.edgeTw[i].set({ a: this.edgeOn(e, b) }, t, fwd ? 0.35 : 0, 0.7));
  }

  state(t) {
    const S = {};
    for (const n of this.nodes) S[n.id] = this.tw[n.id].get(t);
    return S;
  }

  colour(n, s) {
    let c = col(n.c);
    if (n.c2) c = mixHex(c, col(n.c2), s.alt);
    if (s.red > 0.01) c = mixHex(c, col('R'), s.red);
    return c;
  }

  draw(ctx, item) {
    const { t } = ctx, sl = this.slide, S = this.state(t), A = item.a;
    const B = KG_LOOK === 'b';
    if (B) this.draw3D(ctx, S, A);
    else this.draw2D(ctx, S, A);
    // labels
    for (const n of this.nodes) {
      const d = this.lbl[n.id];
      if (!d) continue;
      const s = S[n.id];
      const [x, y] = sl.P(s.x, s.y - (n.hub ? this.hubR : this.r) - 0.06, B ? 0.2 : 0);
      const a = s.a * A * (n.hideLabel?.(this.build) ? 0 : 1);
      d.style.opacity = a.toFixed(3);
      d.style.visibility = a < 0.02 ? 'hidden' : '';
      d.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)${B ? ` scale(${sl.bScale.toFixed(3)})` : ''}`;
    }
    this.extra?.(ctx, S, A, this);
  }

  draw2D(ctx, S, A) {
    const c = ctx.under, sl = this.slide, t = ctx.t;
    c.lineCap = 'round';
    this.edges.forEach(([a, b, o = {}], i) => {
      const sa = S[a], sb = S[b];
      const al = Math.min(sa.a, sb.a) * this.edgeTw[i].get(t).a * A;
      if (al < 0.02) return;
      const hot = Math.max(this.hot(a, t) * this.hot(b, t));
      const red = Math.max(sa.red, sb.red);
      const [x0, y0] = sl.P(sa.x, sa.y), [x1, y1] = sl.P(sb.x, sb.y);
      c.globalAlpha = al * (hot ? 1 : o.c ? 0.9 : 0.5);
      c.strokeStyle = red > 0.1 ? col('R') : hot ? col('ink') : col(o.c ?? (this.byId[a].c === 'E' || this.byId[b].c === 'E' ? 'E' : this.byId[a].c));
      c.lineWidth = sl.U(hot ? 0.05 : o.c ? 0.035 : 0.022);
      if (o.dash) { c.setLineDash([sl.U(0.1), sl.U(0.08)]); c.lineDashOffset = -t * sl.U(0.4); }
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.setLineDash([]);
    });
    for (const n of this.nodes) {
      const s = S[n.id];
      if (s.a * A < 0.02) continue;
      const colr = this.colour(n, s), [x, y] = sl.P(s.x, s.y);
      const fresh = this.born[n.id] ? Math.max(0, 1 - (t - this.born[n.id]) / 1.8) : 0;
      const hot = this.hot(n.id, t);
      const r = sl.U(n.hub ? this.hubR : n.small ? this.r * 0.6 : this.r) * Math.max(0.001, s.s) * (1 + 0.4 * hot);
      c.globalAlpha = s.a * A;
      if (fresh > 0 || hot > 0) {
        c.fillStyle = colr + '40';
        c.beginPath(); c.arc(x, y, r * (1.5 + fresh * 1.8 + hot * 0.7), 0, 7); c.fill();
      }
      c.fillStyle = n.hub || n.small ? colr : '#ffffff';
      c.strokeStyle = colr;
      c.lineWidth = sl.U(0.035);
      c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      if (!n.small) c.stroke();
    }
    c.globalAlpha = 1;
  }

  draw3D(ctx, S, A) {
    const t = ctx.t;
    for (const n of this.nodes) {
      const s = S[n.id], m = this.mesh[n.id];
      const fresh = this.born[n.id] ? Math.max(0, 1 - (t - this.born[n.id]) / 1.8) : 0;
      const hot = this.hot(n.id, t);
      m.position.set(s.x, s.y + Math.sin(t * 1.3 + s.x * 2) * 0.03, (n.hub ? 0.25 : 0.1) + Math.sin(s.x * 3 + s.y * 2) * 0.15);
      m.scale.setScalar(Math.max(0.001, s.s * (1 + hot * 0.5 + fresh * 0.5 * Math.abs(Math.sin((t - (this.born[n.id] ?? 0)) * 6)))));
      m.rotation.set(t * 0.3, t * 0.6 + s.x, 0);
      const c = new THREE.Color(this.colour(n, s));
      m.material.color.copy(c);
      m.material.emissive.copy(c);
      m.material.emissiveIntensity = 0.45 + hot * 1.2 + fresh;
      m.material.opacity = s.a * A;
      m.visible = s.a * A > 0.02;
    }
    this.edges.forEach(([a, b, o = {}], i) => {
      const m = this.rods[i], ma = this.mesh[a], mb = this.mesh[b];
      const al = Math.min(S[a].a, S[b].a) * this.edgeTw[i].get(t).a * A;
      m.visible = al > 0.02;
      if (!m.visible) return;
      const hot = this.hot(a, t) * this.hot(b, t);
      m.position.copy(ma.position);
      m.lookAt(mb.position);
      m.scale.set(1, 1, ma.position.distanceTo(mb.position));
      m.material.color.set(Math.max(S[a].red, S[b].red) > 0.1 ? col('R') : hot ? '#ffffff' : o.c ? col(o.c) : '#9fb4c8');
      m.material.opacity = al * (hot ? 1 : o.c ? 0.9 : 0.5);
    });
  }
}
