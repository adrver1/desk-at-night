// Live slides: the knowledge-graph part of the talk (deck slides 7 to 14),
// drawn live with the game's low-poly cast instead of one picture per click.
// A slide is a list of elements (text, people and robots, arrows, bubbles,
// pictures, graphs), each shown from one click on; every click animates.
//
// Two looks (?kglook=): 'c' the living slide (light, like the deck, figures
// drawn in 3D with a flat camera; default) and 'b' the diorama (dark, the
// slide stands as a hologram over a low-poly deck, a perspective camera that
// sways). ?kglook=deck shows the PowerPoint pictures again.
//
// Coordinates: the slide is 16 × 9 units, x -8..8 left to right, y -4.5..4.5
// bottom to top. Text blocks are placed by their top-left corner.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export const KG_LOOK = (() => {
  const v = new URLSearchParams(location.search).get('kglook');
  return v === 'b' || v === 'deck' ? v : 'c';
})();

export const COL = {
  ink: '#18202c', soft: '#5b6575', paper: '#f7f5f0', green: '#1a9f6e', magenta: '#d1345b',
  E: '#8a6ad8', P: '#3f7fd6', S: '#13a37a', R: '#d1345b', grey: '#9aa3ae', amber: '#d98a00',
};
// the diorama's brighter versions of the same colours, for a dark ground
const COL_B = { ink: '#e8edf2', soft: '#a9b4c2', green: '#3fcf8e', magenta: '#ff6f91', E: '#b9a2f0', P: '#7fb0ff', S: '#5fe0b7', R: '#ff5a4f', grey: '#7f8a96', amber: '#f2b25c' };
export const col = (k) => (KG_LOOK === 'b' ? COL_B[k] ?? COL[k] : COL[k] ?? k);

const now = () => performance.now() / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const back = (k) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);   // ease out with a little overshoot

// A tween of plain numbers: set() starts from wherever it is now
export class Tw {
  constructor(p) { this.from = { ...p }; this.to = { ...p }; this.t0 = -99; this.delay = 0; this.dur = 0.9; this.fn = ease; }
  set(p, t, delay = 0, dur = 0.9, fn = ease) { this.from = this.get(t); this.to = { ...p }; this.t0 = t; this.delay = delay; this.dur = dur; this.fn = fn; }
  jump(p) { this.from = { ...p }; this.to = { ...p }; this.t0 = -99; }
  get(t) {
    const k = this.fn(clamp((t - this.t0 - this.delay) / this.dur, 0, 1)), o = {};
    for (const key in this.to) { const f = this.from[key] ?? this.to[key]; o[key] = f + (this.to[key] - f) * k; }
    return o;
  }
}

// ------------------------------------------------------------ the models
const loader = new GLTFLoader();
const gltfs = {};
function loadGlb(base, name) {
  // a crew name, or a path under story/ for a prop (props/workstation.glb)
  const url = name.includes('/') ? base + name : `${base}chars/${name}.glb`;
  gltfs[name] ??= new Promise((ok) => loader.load(url, ok, undefined, () => ok(null)));
  return gltfs[name];
}

// One person or robot: the model on a holder, its clips, and a crossfade
// `cut`: shown only above that share of its height, a half portrait (place() moves the plane)
function makeFigure(g, { tint, cut } = {}) {
  const root = SkeletonUtils.clone(g.scene);
  const plane = cut ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) : null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    if (tint || plane) o.material = o.material.clone();
    if (tint) o.material.color.lerp(new THREE.Color(tint), 0.5);
    if (plane) o.material.clippingPlanes = [plane];
  });
  const holder = new THREE.Group();
  holder.add(root);
  const box = new THREE.Box3().setFromObject(root);
  root.position.y = -box.min.y;   // feet (or a hovering robot's tip) on y
  root.rotation.y = Math.PI;       // the crew look down their -Z; turn them to us
  const mixer = new THREE.AnimationMixer(root);
  const acts = Object.fromEntries(g.animations.map((a) => [a.name, mixer.clipAction(a)]));
  let cur = acts.idle;
  cur?.play();
  return {
    holder, mixer, plane, h0: box.max.y - box.min.y || 1.8,
    play(name) {
      const a = acts[name] || acts.idle;
      if (!a || a === cur) return;
      a.reset().play();
      if (cur) cur.crossFadeTo(a, 0.4, false);
      cur = a;
    },
  };
}

// Sit a figure down at a control-room workstation (blender/story_props_export.py:
// the room's monitor and chair, chair 0.75 m behind the screen). It hangs off
// the figure's own root, in metres, so it scales and turns with the person; a
// birch desk top like the room's goes under the monitor. Play 'typing' or
// 'seated_idle' on the figure.
const SEAT = { chair: 0.75, ahead: 0.06, desk: 0.74 };
function seat(fig, g) {
  const root = fig.holder.children[0];
  const ws = g.scene.clone();
  ws.position.z = SEAT.ahead - SEAT.chair;          // the chair just behind the hips, the screen ahead
  ws.getObjectByName('Monitor').position.y += SEAT.desk;
  for (const n of ['MonitorFoot', 'MonitorNeck', 'MonitorMount']) ws.getObjectByName(n).position.y += SEAT.desk;
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.75), mat('#b08a5c'));
  top.position.set(0, SEAT.desk - 0.02, 0.05);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.26, SEAT.desk - 0.04, 0.05), mat('#202225'));
  body.position.set(0, (SEAT.desk - 0.04) / 2, -0.28);
  ws.add(top, body);
  ws.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  root.add(ws);
}

// Low-poly props built from boxes: a stack of books (the knowledge base),
// a desk with a monitor, a globe with a W on it
const mat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8, emissive: c, emissiveIntensity: e });
const BOOK_COLS = ['#c94f4f', '#3f7fd6', '#e0b43a', '#13a37a', '#8a6ad8', '#e07a3a', '#5b6575'];
export function books(n = 5) {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.16 + ((i * 37) % 5) * 0.015, w = 0.95 - ((i * 13) % 4) * 0.06;
    const cover = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.7), mat(BOOK_COLS[i % BOOK_COLS.length]));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, h - 0.05, 0.68), mat('#f3efe4'));
    pages.position.x = 0.04;
    const b = new THREE.Group();
    b.add(cover, pages);
    b.position.set(((i * 29) % 7 - 3) * 0.025, y + h / 2, 0);
    b.rotation.y = ((i * 53) % 9 - 4) * 0.06;
    g.add(b);
    y += h;
  }
  g.userData.h = y;
  return g;
}
export function desk() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.7), mat('#8a6a48'));
  top.position.y = 0.72;
  for (const x of [-0.68, 0.68]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.6), mat('#5b6575')); leg.position.set(x, 0.36, 0); g.add(leg); }
  const mon = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.05), mat('#1d2433'));
  mon.position.set(0, 1.12, -0.15);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.42), new THREE.MeshBasicMaterial({ color: '#7fd8ff' }));
  scr.position.set(0, 1.12, -0.12);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.05), mat('#1d2433'));
  stand.position.set(0, 0.86, -0.17);
  g.add(top, mon, scr, stand);
  g.userData.h = 1.4;
  return g;
}
// The agents' table on the conclusion slide (deck slide 15): a dark wooden
// top tipped towards us, the laptop they crowd round, books, two mugs, a notepad
export function table() {
  const g = new THREE.Group(), t = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.22, 2.2), mat('#5a4330'));
  const front = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.1, 0.1), mat('#3e2e22'));
  front.position.set(0, -0.65, 1.05);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.42), mat('#2b3038'));
  base.position.set(0, 0.16, 0.2);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.04), mat('#2b3038'));
  lid.position.set(0, 0.36, -0.02); lid.rotation.x = -0.25;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshBasicMaterial({ color: '#9fd8ff' }));
  glow.position.set(0, 0.36, 0.0); glow.rotation.x = -0.25;
  const lap = new THREE.Group(); lap.add(base, lid, glow); lap.scale.setScalar(1.6); lap.position.set(0, 0, 0.2);
  const bk = books(4); bk.scale.setScalar(1.05); bk.position.set(-2.4, 0.11, 0.3); bk.rotation.y = 0.3;
  const mug = (c, x, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.36, 10), mat(c)); m.position.set(x, 0.29, z); return m; };
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.5), mat('#f3efe4'));
  pad.position.set(1.25, 0.13, 0.45); pad.rotation.y = -0.2;
  t.add(top, front, lap, bk, mug('#e9e6df', -1.35, 0.6), mug('#e9e6df', 2.2, 0.55), pad);
  t.rotation.x = 0.32;   // tipped towards us, so the top shows to the flat camera
  g.add(t);
  g.userData.h = 1;
  return g;
}
export function globe() {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), mat('#e9e6df'));
  const lines = new THREE.LineSegments(new THREE.EdgesGeometry(s.geometry), new THREE.LineBasicMaterial({ color: '#9aa3ae' }));
  g.add(s, lines);
  g.userData.h = 1.4;
  g.userData.spin = 0.4;
  return g;
}

// ------------------------------------------------------------ the slide

export class LiveSlide {
  constructor(host, { publicBase }) {
    this.base = publicBase;
    this.el = document.createElement('div');
    this.el.className = `kg kg-${KG_LOOK}`;
    this.under = document.createElement('canvas');
    this.gl = document.createElement('canvas');
    this.over = document.createElement('canvas');
    this.html = document.createElement('div');
    this.html.className = 'kg-html';
    // arrows and rings go over the cards and pictures
    this.el.append(...(KG_LOOK === 'b' ? [this.gl, this.under] : [this.under, this.gl]), this.html, this.over);
    host.append(this.el);
    this.uc = this.under.getContext('2d');
    this.oc = this.over.getContext('2d');
    this.def = null;
    this.running = false;
    this.W = this.H = 0;
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  // three, made on first use
  initGL() {
    if (this.renderer) return;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.gl, antialias: true, alpha: true });
    r.localClippingEnabled = true;   // half-portrait figures (makeFigure cut)
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const dl = new THREE.DirectionalLight(0xffffff, 2.2);
    dl.position.set(-4, 6, 10);
    this.scene.add(dl);
    this.ortho = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, -50, 50);
    this.ortho.position.z = 20;
    this.persp = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
    this.camTw = new Tw({ x: 0, y: 0, z: 0 });
    if (KG_LOOK === 'b') this.diorama();
    this.resize();
  }

  // The diorama's world: dark sky, a low-poly hex deck the slide stands on,
  // legs down to the sea
  diorama() {
    const s = this.scene;
    s.background = new THREE.Color('#0c1520');
    s.fog = new THREE.Fog('#0c1520', 20, 46);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.6, 0.6, 6), mat('#4c5560'));
    slab.position.set(0, -5.2, 3);
    slab.rotation.y = Math.PI / 6;
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(12.02, 12.02, 0.08, 6, 1, true), new THREE.MeshBasicMaterial({ color: '#e0b43a', side: THREE.DoubleSide }));
    edge.position.set(0, -4.89, 3);
    edge.rotation.y = Math.PI / 6;
    const grid = new THREE.GridHelper(21, 42, '#69737e', '#59626c');
    grid.position.set(0, -4.89, 3);
    const sea = new THREE.Mesh(new THREE.CircleGeometry(90, 7), mat('#173149'));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -14;
    s.add(slab, edge, grid, sea);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9.5, 6), mat('#c9a83c'));
      const a = Math.PI / 4 + i * Math.PI / 2;
      leg.position.set(Math.cos(a) * 7, -9.95, 3 + Math.sin(a) * 7);
      s.add(leg);
    }
    // the hologram frame the slide stands in
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(16.2, 9.1)), new THREE.LineBasicMaterial({ color: '#5fe0b7', transparent: true, opacity: 0.35 }));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(16.2, 9.1), new THREE.MeshBasicMaterial({ color: '#5fe0b7', transparent: true, opacity: 0.04, depthWrite: false }));
    frame.position.z = glass.position.z = -0.6;
    s.add(frame, glass);
  }

  resize() {
    // the layout size, not the box on screen: on a room screen (main.js screenSlide) the slide is transformed
    const r = { width: this.el.clientWidth, height: this.el.clientHeight };
    if (!r.width) return;
    this.W = r.width; this.H = r.height;
    const dpr = this.dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.under, this.over]) { c.width = Math.round(this.W * dpr); c.height = Math.round(this.H * dpr); }
    this.el.style.setProperty('--sw', this.W / 100 + 'px');
    if (this.renderer) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(this.W, this.H, false);
      this.persp.aspect = this.W / this.H;
      this.persp.updateProjectionMatrix();
    }
  }

  // slide units to pixels (the flat look), or through the camera (the diorama)
  P(x, y, z = 0) {
    if (KG_LOOK !== 'b') return [(x + 8) / 16 * this.W, (4.5 - y) / 9 * this.H];
    const p = new THREE.Vector3(x, y, z).project(this.persp);
    return [(p.x + 1) / 2 * this.W, (1 - p.y) / 2 * this.H];
  }
  // a length in pixels at the slide plane
  U(u) { return u / 16 * this.W * (KG_LOOK === 'b' ? this.bScale ?? 1 : 1); }

  async show(def, fromEnd) {
    // where the figures on screen stand now, so a slide with glideIn can
    // slide the same models over from there instead of popping them in
    const t0 = now(), was = {};
    for (const it of this.items ?? []) {
      if (!it.fig || !it.obj.visible) continue;
      const s = it.tw.get(t0);
      was[it.e.glb] ??= { x: s.x ?? it.e.x, y: s.y ?? it.e.y, h: it.e.h * s.s, rot: s.rot ?? it.e.rot ?? 0 };
    }
    this.hide();
    this.initGL();
    this.def = def;
    this.build = fromEnd ? def.builds : 0;
    this.items = [];
    const token = this.token = {};
    this.html.innerHTML = '';
    this.el.dataset.slide = def.id;
    // load the figures first, then build the elements
    const names = [...new Set(def.elements.filter((e) => e.kind === 'figure').flatMap((e) => [e.glb, e.seat].filter(Boolean)))];
    const loaded = await Promise.all(names.map((n) => loadGlb(this.base, n)));
    if (token !== this.token) return;
    const G = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
    this.items = def.elements.map((e) => this.make(e, G));
    this.build = fromEnd ? def.builds : 0;
    this.goTo(this.build, true);
    if (def.glideIn && !fromEnd) this.glide(was);
    this.running = true;
    this.last = now();
    const loop = () => { if (!this.running || token !== this.token) return; this.frame(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // start the figures that were on the last slide where they stood, then
  // tween them to their places here
  glide(was) {
    const t = now(), b = this.build;
    for (const it of this.items) {
      const e = it.e, w = it.fig && this.shown(e, b) && was[e.glb];
      if (!w) continue;
      it.tw.jump({ a: 1, s: w.h / e.h, x: w.x, y: w.y, rot: w.rot });
      it.tw.set({ a: 1, s: 1, x: e.x, y: e.y, rot: e.rot ?? 0, ...(e.at ? e.at(b) : {}) }, t, 0, 1.4);
    }
  }

  hide() {
    this.running = false;
    this.token = null;
    for (const it of this.items ?? []) if (it.obj) this.scene.remove(it.obj);
    for (const o of this.extraObjs ?? []) this.scene.remove(o);
    this.items = [];
    this.extraObjs = [];
    this.def = null;
  }

  // Space and ←: the next or previous click, false at either end
  step(dir) {
    if (!this.def) return false;
    const b = this.build + dir;
    if (b < 0 || b > this.def.builds) return false;
    this.goTo(b);
    return true;
  }

  shown(e, b) { return b >= (e.from ?? 0) && (e.until === undefined || b < e.until); }

  make(e, G) {
    const it = { e, tw: new Tw({ a: 0, s: 0 }) };
    if (e.kind === 'figure' && G[e.glb]) {
      it.fig = makeFigure(G[e.glb], e);
      if (e.seat && G[e.seat]) seat(it.fig, G[e.seat]);
      it.obj = it.fig.holder;
      this.scene.add(it.obj);
    }
    if (e.kind === 'prop') { it.obj = e.make(); this.scene.add(it.obj); }
    if (e.kind === 'graph') { it.g = e.graph; it.g.init?.(this); }
    if (['text', 'bubble', 'tag', 'img', 'card', 'title'].includes(e.kind)) {
      const d = it.dom = document.createElement(e.kind === 'img' ? 'img' : 'div');
      d.className = `kg-${e.kind} ${e.cls ?? ''}`;
      if (e.kind === 'img') d.src = this.base + e.src;
      else d.innerHTML = e.html;
      if (e.w) d.style.width = `calc(var(--sw) * ${e.w / 16 * 100})`;
      if (e.h) d.style.height = `calc(var(--sw) * ${e.h / 16 * 100})`;
      this.html.append(d);
    }
    return it;
  }

  goTo(b, instant = false) {
    const fwd = b > this.build;
    this.build = b;
    const t = instant ? -99 : now();
    this.enteredAt = now();
    let order = 0;
    for (const it of this.items) {
      const e = it.e, on = this.shown(e, b);
      const fresh = fwd && on && (e.from ?? 0) === b;
      const delay = fresh ? (e.delay ?? 0.08 * order++) : 0;
      const tgt = { a: 1, s: 1, ...(e.at ? e.at(b) : {}) };
      if (!on) { tgt.a = 0; tgt.s = 0; }
      it.tw.set(tgt, t, delay, e.dur ?? 0.8, e.kind === 'figure' && fresh ? back : ease);
      if (it.fig) it.fig.play(e.act ? e.act(b) : 'idle');
      it.g?.goTo?.(b, t, fwd);
    }
    this.def.onBuild?.(b, this);
  }

  frame() {
    const t = now(), dt = Math.min(0.05, t - this.last);
    this.last = t;
    const b = this.build, W = this.W, H = this.H, B = KG_LOOK === 'b';
    if (!W) { this.resize(); return; }
    // the camera first: the diorama sways, and leans toward what is new
    if (B) {
      const f = this.def.focus?.(b) ?? [0, 0, 0];
      if (this.camFocus !== b) { this.camFocus = b; this.camTw.set({ x: f[0], y: f[1], z: f[2] }, t, 0, 1.6); }
      const c = this.camTw.get(t), sway = Math.sin(t * 0.23);
      this.persp.position.set(c.x * 0.25 + sway * 0.6, 0.9 + c.y * 0.15, 17.6 - c.z * 0.5);
      this.persp.lookAt(c.x * 0.3, c.y * 0.2 - 0.2, 0);
      this.persp.updateMatrixWorld();
      // how big one unit at the plane is, against the flat look
      const [x0] = this.P(-1, 0), [x1] = this.P(1, 0);
      this.bScale = (x1 - x0) / 2 / (W / 16);
    }
    const uc = this.uc, oc = this.oc, d = this.dpr;
    uc.setTransform(d, 0, 0, d, 0, 0); oc.setTransform(d, 0, 0, d, 0, 0);
    uc.clearRect(0, 0, W, H); oc.clearRect(0, 0, W, H);
    if (!B) { uc.fillStyle = COL.paper; uc.fillRect(0, 0, W, H); }
    const ctx = { t, b, since: t - this.enteredAt, slide: this, under: uc, over: oc };
    this.def.draw?.(ctx);
    for (const it of this.items) {
      const e = it.e, s = it.tw.get(t);
      if (it.fig || it.obj) this.place(it, s, t, dt);
      if (it.g) it.g.draw(ctx, s);
      if (it.dom) this.placeDom(it, s);
      if (e.kind === 'arrow' && s.a > 0.01) this.arrow(e, s, ctx);
      if (e.kind === 'draw' && s.a > 0.01) e.draw(ctx, s);
    }
    this.renderer.render(this.scene, B ? this.persp : this.ortho);
  }

  place(it, s, t, dt) {
    const e = it.e, o = it.obj, sc = Math.max(0.001, s.s);
    const x = s.x ?? e.x, y = s.y ?? e.y;
    if (it.fig) {
      it.fig.mixer.update(dt);
      o.scale.setScalar(e.h / it.fig.h0 * sc);
    } else o.scale.setScalar((e.scale ?? 1) * sc);
    o.position.set(x, y + (1 - sc) * 0.5, e.z ?? (KG_LOOK === 'b' ? 0.6 : 0));
    if (it.fig?.plane) it.fig.plane.constant = -(o.position.y + e.cut * e.h * sc);
    o.rotation.y = (s.rot ?? e.rot ?? 0) + (o.userData.spin ? t * o.userData.spin : 0);
    o.visible = s.s > 0.01;
    // the name over the head, when it has one
    if (e.tag) {
      if (!it.tagEl) { it.tagEl = document.createElement('div'); it.tagEl.className = 'kg-tag'; it.tagEl.innerHTML = e.tag; this.html.append(it.tagEl); }
      const [px, py] = this.P(x + (e.tagDx ?? 0), y + e.h * (it.fig ? 1 : 0) + (e.tagDy ?? 0.25));
      it.tagEl.style.opacity = clamp(s.a, 0, 1).toFixed(3);
      it.tagEl.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
    }
  }

  placeDom(it, s) {
    const e = it.e, d = it.dom;
    const x = s.x ?? e.x, y = s.y ?? e.y;
    const [px, py] = this.P(x, y);
    const ax = e.anchor?.[0] ?? 0, ay = e.anchor?.[1] ?? 0;
    const lift = (1 - s.a) * (e.kind === 'bubble' ? 10 : 6);
    d.style.opacity = clamp(s.a, 0, 1).toFixed(3);
    d.style.visibility = s.a < 0.01 ? 'hidden' : '';
    const z = s.zoom ? ` scale(${s.zoom})` : '';
    d.style.transform = `translate(${px}px, ${py + lift}px) translate(${-ax * 100}%, ${-ay * 100}%)${z}${KG_LOOK === 'b' ? ` scale(${this.bScale.toFixed(3)})` : ''}`;
    d.style.transformOrigin = `${ax * 100}% ${ay * 100}%`;
  }

  // a curved arrow from e.p0 to e.p1 (slide units) that draws itself in
  // A chunky arrow, as in the deck (Adriaen, 2026-11-01): a filled band that
  // follows the curve, with a broad head (two with `both`), drawn as far as k
  chunky(e, k, q, colr, c) {
    const w = this.U(e.cw ?? 0.3), hl = w * 1.5, hw = w * 1.15, N = 40;
    const pts = [], len = [0];
    for (let i = 0; i <= N; i++) pts.push(q((i / N) * k));
    for (let i = 1; i <= N; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = len[N];
    if (L < hl * 1.2) return;
    const at = (d) => {   // the point and direction at arc length d
      let i = 1; while (i < N && len[i] < d) i++;
      const f = (d - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]);
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = Math.hypot(x1 - x0, y1 - y0) || 1;
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, (x1 - x0) / l, (y1 - y0) / l];
    };
    const d0 = e.both ? hl : 0, d1 = L - hl, M = 24, left = [], right = [];
    for (let i = 0; i <= M; i++) {
      const [x, y, dx, dy] = at(d0 + ((d1 - d0) * i) / M);
      left.push([x - dy * w / 2, y + dx * w / 2]); right.push([x + dy * w / 2, y - dx * w / 2]);
    }
    c.beginPath();
    [...left, ...right.reverse()].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath(); c.fill();
    const head = (base, tip) => {
      const [x, y, dx, dy] = at(base), [tx, ty] = at(tip);
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(x - dy * hw, y + dx * hw); c.lineTo(x + dy * hw, y - dx * hw); c.closePath(); c.fill();
    };
    head(d1 - 0.5, L);
    if (e.both) head(d0 + 0.5, 0);
  }

  arrow(e, s, { over: c, t }) {
    const p0 = typeof e.p0 === 'function' ? e.p0(t) : e.p0, p1 = typeof e.p1 === 'function' ? e.p1(t) : e.p1;
    const [ax, ay] = this.P(...p0), [bx, by] = this.P(...p1);
    const bend = e.bend ?? 0.2;
    const mx = (ax + bx) / 2 - (by - ay) * bend, my = (ay + by) / 2 + (bx - ax) * bend;
    const lw = this.U(e.lw ?? 0.075), colr = col(e.col ?? 'green');
    const k = clamp(s.a, 0, 1);
    const q = (u) => [(1 - u) ** 2 * ax + 2 * (1 - u) * u * mx + u * u * bx, (1 - u) ** 2 * ay + 2 * (1 - u) * u * my + u * u * by];
    c.save();
    c.strokeStyle = colr; c.fillStyle = colr; c.lineWidth = lw; c.lineCap = 'round';
    c.globalAlpha = Math.min(1, k * 2) * (s.fade ?? 1);
    if (e.chunky) { this.chunky(e, k, q, colr, c); } else {
    c.beginPath();
    for (let i = 0; i <= 24; i++) { const [x, y] = q((i / 24) * k); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    }
    const head = (u, dir) => {
      if (e.chunky) return;
      const [x, y] = q(u), [x2, y2] = q(u - dir * 0.04), ang = Math.atan2(y - y2, x - x2), hs = lw * 2.6;
      c.beginPath(); c.moveTo(x + Math.cos(ang) * hs * 0.5, y + Math.sin(ang) * hs * 0.5);
      c.lineTo(x - Math.cos(ang - 0.55) * hs, y - Math.sin(ang - 0.55) * hs); c.lineTo(x - Math.cos(ang + 0.55) * hs, y - Math.sin(ang + 0.55) * hs); c.fill();
    };
    if (k > 0.2) head(k, 1);
    if (e.both && k > 0.98) head(0.02, -1);
    if (e.label) {
      const [lx, ly] = q(0.5);
      c.font = `600 ${Math.max(10, this.U((e.size ?? 0.42) * (KG_LOOK === 'b' ? 0.72 : 0.8)))}px "Instrument Sans", system-ui, sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.globalAlpha = clamp((k - 0.5) * 2, 0, 1) * (s.fade ?? 1);
      const off = e.labelOff ?? [0, -0.3];
      const [ox, oy] = [this.U(off[0]), -this.U(off[1])];
      c.save(); c.translate(lx + ox, ly + oy);
      if (e.labelRot) c.rotate(e.labelRot);
      c.fillText(e.label, 0, 0); c.restore();
    }
    c.restore();
  }
}
