// Building the separator's digital twin (Adriaen, 2026-10-30), after the
// simulator chat (c.sim), like the CtrlBuddy build (workshop.js): two of the
// left desk's monitors. On one, VS Code, the CasADi model typed section by
// section (geometry, states, the weir, the valves, the mass balances, the
// integrator); on the other, the cut-open separator (separator.js) put
// together over its own blueprint, one part per section, while Ola looks on
// and CtrlBuddy hovers by the part being placed, beaming it in. When the
// integrator is typed the liquids fill and the twin runs (separatorSim.js).
//
// The code is generic textbook physics (ideal gas, mass balances, the Francis
// weir formula, an equal-percentage valve): no tags, no tuned numbers.
//
// State key (content.js): twin: true starts the build on entering the beat,
// null hides it. Screens: CODE_SCREEN shows 'twinCode', TWIN_SCREEN 'twin'.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONTENT } from '../screens.js';
import { LIVE } from '../controlScene.js';
import { Separator, DIM } from '../separator.js';
import { makeSeparatorSim } from '../separatorSim.js';
import { loadModel } from './cast.js';
import { drawVSCode, VS_COL } from './vscode.js';
import { T } from './lang.js';

export const CODE_SCREEN = 'Desk0Mon0Screen', TWIN_SCREEN = 'Desk0Mon1Screen';
const DUR = 12;   // s, the whole build
const HOLD = new URLSearchParams(location.search).get('twinAt');   // ?twinAt=0..1 holds the build there (stills)
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const BLUE = 0x5fd6ff;

// Python colours on top of the shared VS Code look
Object.assign(VS_COL, { kw: '#c586c0', str: '#ce9178', num: '#b5cea8', fn: '#dcdcaa' });
const KW = /^(import|as|def|return)$/;
function py(line) {
  const out = [];
  const c = line.indexOf('#');
  const code = c < 0 ? line : line.slice(0, c);
  for (const m of code.matchAll(/('[^']*'|\d+\.?\d*|[A-Za-z_]\w*|\s+|.)/g)) {
    const t = m[0], k = t[0] === "'" ? 'str' : /^\d/.test(t) ? 'num' : KW.test(t) ? 'kw' : /^[A-Za-z_]/.test(t) && code[m.index + t.length] === '(' ? 'fn' : 'text';
    if (out.length && out[out.length - 1][1] === k) out[out.length - 1][0] += t; else out.push([t, k]);
  }
  if (c >= 0) out.push([line.slice(c), 'com']);
  return out;
}

// The model, one section per part of the twin
const SECTIONS = [
  { part: 'shell', lines: [
    'import casadi as ca',
    '',
    '# Geometry (from the vendor drawing)',
    'L, D = 7.0, 3.0        # m, tan-tan, inner dia.',
    'r = D / 2',
    'def area(h):           # liquid cross-section',
    '    return (r**2 * ca.acos((r - h) / r)',
    '            - (r - h) * ca.sqrt(2*r*h - h**2))'] },
  { part: 'inlet', lines: [
    '',
    '# States: gas, oil, water, oil compartment',
    "x = ca.SX.sym('x', 4)          # kg",
    'm_g, m_o, m_w, m_b = ca.vertsplit(x)',
    "w_in = ca.SX.sym('w_in', 3)    # well, kg/s"] },
  { part: 'internals', lines: [
    '',
    '# Weir: Francis formula over the crest',
    'h_o = level(m_o, m_w)',
    'q_weir = 1.84 * L_w * ca.fmax(',
    '    h_o - h_crest, 0)**1.5'] },
  { part: 'valves', lines: [
    '',
    '# Valves: equal percentage (time series)',
    "u = ca.SX.sym('u', 3)          # openings",
    'def valve(z, Cv, dp, rho):',
    '    return Cv * R_v**(z - 1) * ca.sqrt(',
    '        ca.fmax(dp, 0) / rho)'] },
  { part: 'liquids', lines: [
    '',
    '# Ideal gas pressure, mass balances',
    'P = m_g * R * T / (M_g * (V - V_liq))',
    'ode = ca.vertcat(',
    '    w_in[0] - w_gas(u[0], P),',
    '    w_in[1] - rho_o * q_weir,',
    '    w_in[2] - w_water(u[2], P, h_w),',
    '    rho_o * q_weir - w_oil(u[1], P, h_b))'] },
  { part: 'run', lines: [
    '',
    '# Integrator',
    "dae = {'x': x, 'p': ca.vertcat(u, w_in),",
    "       'ode': ode}",
    "F = ca.integrator('F', 'cvodes', dae, 0, 0.1)"] },
].map((s) => ({ ...s, lines: s.lines.map(py) }));
const len = (line) => line.reduce((n, [t]) => n + t.length, 0) + 1;   // +1: an empty line takes a moment too
const CHARS = SECTIONS.map((s) => s.lines.reduce((n, l) => n + len(l), 0));
const TOTAL = CHARS.reduce((a, b) => a + b, 0);
const TYPE = 0.85;   // share of the build spent typing; the rest, the twin running

// The file as typed by progress p (0..1): its lines, the last one cut short
function typed(p) {
  let left = Math.floor(smooth(p / TYPE) * TOTAL);
  const out = [];
  for (const s of SECTIONS) for (const l of s.lines) {
    if (left <= 0) return out;
    const n = len(l);
    if (left >= n) { out.push(l); left -= n; continue; }
    const cut = [];
    for (const [t, k] of l) { if (left <= 0) break; cut.push([t.slice(0, left), k]); left -= t.length; }
    out.push(cut);
    return out;
  }
  return out;
}
// How far each part is in (0..1) at progress p
function parts(p) {
  const chars = smooth(p / TYPE) * TOTAL;
  let at = 0;
  return CHARS.map((n) => { const k = (chars - at) / n; at += n; return Math.max(0, Math.min(1, k)); });
}

export class Twin {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.t = 0;
    this.p = 0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1c28);
    this.scene.fog = new THREE.Fog(0x0f1c28, 16, 30);
    this.camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 80);
    this.target = new THREE.Vector3(0.5, 0.15, 0.6);
    this.camera.position.set(2.2, 1.9, 17);
    this.camera.lookAt(this.target);
    this.rt = new THREE.WebGLRenderTarget(640, 384, { samples: 4 });
    this.rt.texture.userData.raw = true;
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.at = new THREE.Vector3();   // the part being placed
    this.build();
    game.hooks.render.push((renderer) => {
      if (!this.on || !this.ready) return;
      if (!this.scene.environment) this.scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
      const prev = renderer.getRenderTarget(), clip = renderer.localClippingEnabled;
      renderer.localClippingEnabled = true;
      renderer.setRenderTarget(this.rt);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(prev);
      renderer.localClippingEnabled = clip;
    });
    CONTENT.twinCode = ['VS Code', (ctx, w, h) => this.drawCode(ctx, w, h)];
    CONTENT.twin = ['Digital twin', (ctx, w, h) => this.drawRing(ctx, w, h)];
    for (const id of ['twinCode', 'twin']) if (!LIVE.includes(id)) LIVE.push(id);
  }

  // The blueprint floor, the separator (glass cut, as in the re-tuning beat), the beam
  build() {
    const sc = this.scene;
    sc.environmentIntensity = 0.55;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-6, 12, 9);
    sc.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.6));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x12283a }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = DIM.ground;
    const grid = new THREE.GridHelper(40, 80, 0x2f6f96, 0x1d4560);
    grid.position.y = DIM.ground + 0.005;
    sc.add(floor, grid);
    const sep = this.sep = new Separator();
    sc.add(sep.group);
    sep.setCut({ style: 'glass', amount: 1 });
    this.sim = makeSeparatorSim('mass');
    const named = (n) => sep.group.children.find((o) => o.name === n);
    this.groups = {
      shell: [sep.back, sep.front, named('skid and saddles')],
      inlet: [sep.inlets[sep.inlet], sep.pipework],
      internals: [sep.internals],
      valves: Object.values(sep.valves).map((v) => v.group),
      liquids: [], run: [],
    };
    // the blueprint: a faint wireframe of every finished part, where it will go
    const wire = new THREE.MeshBasicMaterial({ color: BLUE, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false, fog: false });
    this.ghost = new THREE.Group();
    for (const o of Object.values(this.groups).flat()) {
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        if (!m.isMesh || !m.visible || m.material?.isShaderMaterial) return;
        const g = new THREE.Mesh(m.geometry, wire);
        g.matrixAutoUpdate = false;
        g.matrix.copy(m.matrixWorld);
        this.ghost.add(g);
      });
    }
    sc.add(this.ghost);
    for (const o of Object.values(this.groups).flat()) o.userData.home = o.position.clone();
    // CtrlBuddy's beam: a cone of light from him to the part
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    sc.add(this.beam);
  }

  async load() {
    const [op, bud] = await Promise.all(['bearded_operator', 'control_buddy'].map((m) => loadModel(m).catch((e) => { console.warn('twin', m, e); return null; })));
    const clip = (g, n) => THREE.AnimationClip.findByName(g.animations, n);
    const bones = (root) => { const b = {}; root.traverse((o) => { if (o.isBone) b[o.name] = o; }); return b; };
    this.mixers = [];
    if (op) {
      // Ola in front of it, at the near end, watching (the crew look down their -Z)
      this.op = op.scene;
      this.op.position.set(-3.4, DIM.ground, 2.6);
      this.op.rotation.y = 0.35;
      const mix = new THREE.AnimationMixer(this.op);
      const idle = clip(op, 'idle');
      if (idle) mix.clipAction(idle).play();
      this.mixers.push(mix);
      this.opHead = bones(this.op).head;
      this.scene.add(this.op);
    }
    if (bud) {
      this.bud = bud.scene;
      const mix = new THREE.AnimationMixer(this.bud);
      const idle = clip(bud, 'idle');
      if (idle) mix.clipAction(idle).play();
      this.mixers.push(mix);
      this.budAt = new THREE.Vector3(-1, 0, 3);
      this.bud.position.copy(this.budAt);
      this.scene.add(this.bud);
    }
    for (const o of [this.op, this.bud]) o?.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    this.ready = true;
  }

  // The story's state: twin or not (restarts on entering the beat)
  set(on) {
    on = Boolean(on);
    if (on === this.on) return;
    this.on = on;
    this.t = 0;   // its own clock: a jump between beats runs the story clock on fast
    this.p = 0;
    this.game.room?.setFeeds({ twin: this.rt.texture });
    if (on) {
      this.sim = makeSeparatorSim('mass');
      const f = this.game.room?.screenFrame(TWIN_SCREEN, this.game.camera.position);
      if (f) {
        const w = 640, h = Math.round(640 * f.height / f.width);
        if (h !== this.rt.height) this.rt.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  update(dt) {
    if (!this.on || !this.ready) return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const p = this.p = HOLD != null ? +HOLD : Math.min(1, this.t / DUR);
    const k = parts(p), keys = SECTIONS.map((s) => s.part);
    // each part drops in from above as its section is typed
    let placing = -1;
    keys.forEach((key, i) => {
      if (placing < 0 && k[i] < 1) placing = i;
      for (const o of this.groups[key]) {
        o.visible = k[i] > 0;
        const e = smooth(k[i] * 1.3);
        o.position.copy(o.userData.home);
        o.position.y += (1 - e) * 2.5;
      }
    });
    const key = placing >= 0 ? keys[placing] : null;
    const first = key && this.groups[key][0];
    if (first) { first.updateMatrixWorld(true); new THREE.Box3().setFromObject(first).getCenter(this.at); }
    else if (key === 'liquids') this.at.set(0, -0.9, 0);
    else this.at.set(0.5, 0, 0);
    // the sim runs from the start, its liquids rising as the balances are typed
    this.sim.step(dt);
    this.sim.apply(this.sep);
    const fill = smooth(k[keys.indexOf('liquids')]), lo = -DIM.R + 0.06, lv = this.sep.levels;
    for (const n of ['interface', 'surface', 'bucket']) lv[n] = lo + (lv[n] - lo) * fill;
    lv.emulsion *= fill;
    this.sep.update(dt, this.sim.stir ?? 0);
    for (const m of Object.values(this.sep.liquids)) m.visible = fill > 0.02;
    this.sep.particles.visible &&= k[keys.indexOf('run')] > 0;
    this.ghost.visible = p < TYPE;
    // CtrlBuddy hovers in front of the part being placed, beaming it in
    if (this.bud) {
      // beside it, a little in front, so we see him three-quarter on
      const want = new THREE.Vector3(Math.min(3.6, this.at.x + 1.6), Math.max(-1.6, this.at.y - 0.3), 2.6);
      if (!key || key === 'run') want.set(2.4, -1.6, 2.8);
      this.budAt.lerp(want, Math.min(1, dt * 2.5));
      this.bud.position.copy(this.budAt);
      this.bud.position.y += Math.sin(this.t * 2) * 0.06;
      // turned half way between the part and us (the crew look down their -Z)
      const look = this.at.clone().sub(this.budAt).setY(0).normalize().add(this.camera.position.clone().sub(this.budAt).setY(0).normalize());
      this.bud.rotation.y = Math.atan2(-look.x, -look.z);
      const from = this.bud.position.clone().add(new THREE.Vector3(0, 1.05, 0));
      const busy = key && key !== 'run' && k[placing] > 0;
      this.beam.visible = Boolean(busy);
      if (busy) {
        this.beam.position.copy(from);
        this.beam.lookAt(this.at);
        this.beam.scale.set(1, 1, from.distanceTo(this.at));
        this.beam.material.opacity = 0.22 + 0.08 * Math.sin(this.t * 13);
      }
    }
    for (const m of this.mixers) m.update(dt);
    // Ola's head follows the part
    if (this.opHead) {
      this.opHead.updateMatrixWorld(true);
      const hp = this.opHead.getWorldPosition(new THREE.Vector3()), dir = this.at.clone().sub(hp).normalize();
      const qb = this.opHead.getWorldQuaternion(new THREE.Quaternion()), now = new THREE.Vector3(0, 1, 0).applyQuaternion(qb);
      const want = now.clone().lerp(new THREE.Vector3(0, 1, 0).add(dir.multiplyScalar(0.8)).normalize(), 0.6).normalize();
      const world = new THREE.Quaternion().setFromUnitVectors(now, want).multiply(qb);
      this.opHead.quaternion.copy(this.opHead.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    }
    if (this.t < DUR + 1) this.game.room?.redrawNow?.();   // the typing and the ring, every frame while it builds
  }

  // VS Code with the model as far as it is typed (the last rows, as it scrolls), and the chat that asked for it
  drawCode(ctx, w, h) {
    const p = this.on ? this.p : 1;
    const chat = [{ t: T('Bygg en digital tvilling av innløpsseparatoren i CasADi, fra tegningen og tidsseriene i CDF.', 'Build a digital twin of the inlet separator in CasADi, from the drawing and the time series in CDF.'), me: true }];
    if (p > 0.04) chat.push({ t: T('Setter opp geometri, massebalanser, overløp og ventiler …', 'Setting up the geometry, mass balances, weir and valves …') });
    if (p >= 1) chat.push({ t: T('Ferdig. Tvillingen kjører.', 'Done. The twin is running.') });
    const fs = w / 64, rows = Math.max(4, Math.floor((h / fs - 4.2) / 1.4));
    const lines = typed(p);
    drawVSCode(ctx, {
      title: 'separator-twin — Visual Studio Code', tab: 'separator.py',
      tree: [{ t: '▾ SEPARATOR-TWIN' }, { t: '▾ model', lvl: 1 }, { t: 'separator.py', lvl: 2, hl: true }, { t: 'valves.py', lvl: 2 }, { t: '▾ data', lvl: 1 }, { t: 'drawing.pdf', lvl: 2 }, { t: 'timeseries.csv', lvl: 2 }, { t: '▸ tuning', lvl: 1 }],
      lines: lines.slice(-rows), caret: p < TYPE, chat, pick: 'CtrlBuddy',
    }, 0, 0, w, h);
  }

  // The twin's own picture over the feed: the progress ring, top right
  drawRing(ctx, w, h) {
    const p = this.on ? this.p : 1, s = w / 640, r = 34 * s, x = w - r - 20 * s, y = r + 20 * s;
    ctx.fillStyle = '#0009';
    ctx.beginPath(); ctx.arc(x, y, r + 8 * s, 0, 7); ctx.fill();
    ctx.lineWidth = 7 * s;
    ctx.strokeStyle = '#ffffff22';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = p >= 1 ? '#7fdc9a' : '#5fd6ff';
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * p); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${18 * s}px system-ui, sans-serif`;
    ctx.fillText(p >= 1 ? '✓' : `${Math.round(p * 100)}%`, x, y + 1 * s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${15 * s}px system-ui, sans-serif`;
    ctx.fillText(p >= 1 ? T('Digital tvilling klar', 'Digital twin ready') : T('Bygger digital tvilling …', 'Building the digital twin …'), 20 * s, 34 * s);
  }
}
