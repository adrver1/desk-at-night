// Building the separator's digital twin (Adriaen, 2026-10-30), after the
// simulator chat (c.sim), like the CtrlBuddy build (workshop.js): two of the
// left desk's monitors. On one, VS Code, the CasADi model typed section by
// section (geometry, states, the weir, the valves, the mass balances, the
// integrator); on the other, the cut-open separator (separator.js) put
// together over its own blueprint, one part per section, while Ola looks on
// and CtrlBuddy hovers by the part being placed, beaming it in. When the
// integrator is typed the liquids fill and the twin runs (separatorSim.js).
//
// The code follows our own CasADi separator model (Adriaen, 2026-10-30), in
// generic form: no tags, no tuned numbers, none of its code (that stays private).
//
// After it, the chat about the real separator (c.sim2, Adriaen 2026-10-30)
// shows the same twin beside the chat ('twinFix') and corrects it as
// the chat goes: after the drawing from CDF the vessel takes its length (the
// main separation zone, 8 m to 7 m), then the water level valve (its datasheet) is swapped, the equal-percentage one
// it was modelled as lifted out and a linear one put in (Adriaen: the datasheet says linear), each with its valve curve beside it.
//
// State key (content.js): twin: true starts the build on entering the beat,
// 'fix' the corrections (story.json chats.sim2.set), null hides it.
// Screens: CODE_SCREEN shows 'twinCode', TWIN_SCREEN 'twin', and the chat's
// report screen 'twinFix'.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONTENT } from '../screens.js';
import { LIVE } from '../controlScene.js';
import { Separator, DIM } from '../separator.js';
import { makeSeparatorSim } from '../separatorSim.js';
import { Valve } from '../valve.js';
import { S } from './storyScreens.js';
import { CHATS } from './content.js';
import { loadModel } from './cast.js';
import { PRIVATE, OVERRIDES } from '../privateNames.js';
import { drawVSCode, VS_COL } from './vscode.js';
import { T } from './lang.js';

export const CODE_SCREEN = 'Desk0Mon0Screen', TWIN_SCREEN = 'Desk0Mon1Screen';
const DUR = 12;   // s, the whole build
const HOLD = new URLSearchParams(location.search).get('twinAt');   // ?twinAt=0..1 holds the build there (stills)
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const BLUE = 0x5fd6ff;
const SHORT = 1 / 8;   // the correction: 8 m to 7 m
const EQP = 30;        // rangeability of the equal-percentage curve
const FIX_WAIT = 1.8;  // s after its message before a correction starts (the camera's way back from the report)
const SWAP = 'water';  // the valve the correction swaps (its datasheet: the water outlet's level valve)

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

// The model, one section per part of the twin. The same physics as our own
// CasADi separator model (4 mass states, ideal-gas pressure, weir
// equalisation, ISA valves, one RK4 step), written out generically here; the
// private build (?private=1) types the model's own lines instead
// (overrides.json twinCode: { tab, sections: [{ part, lines }] }).
const PUBLIC = [
  { part: 'shell', lines: [
    'import casadi as ca',
    '',
    '# Horizontal vessel: liquid area at height h',
    'def seg_area(h, r):',
    '    th = ca.acos((r - h) / r)',
    '    return 0.5*r*r*(2*th - ca.sin(2*th))',
    '',
    '# States: gas, oil, water, oil-zone mass, kg',
    "x = ca.SX.sym('x', 4)",
    "u = ca.SX.sym('u', 3)    # gas, oil, water"] },
  { part: 'inlet', lines: [
    '',
    '# Inlet split into gas, oil and water',
    'w_g, w_o, w_w = w_in*f_g, w_in*f_o, w_in*f_w'] },
  { part: 'internals', lines: [
    '',
    '# Weir: the levels over the crest equalise',
    'dh = h_main_over - h_zone_over',
    'w_weir = rho_o * c_weir * L_weir * dh'] },
  { part: 'valves', lines: [
    '',
    '# Valves (ISA Cv) at actuator position z',
    'w_g_out = Cv_g*z_g*ca.sqrt(rho_g*(P - P_g))',
    'dp_o = P + rho_o*g*h_zone - P_o',
    'w_o_out = K*Cv_o*z_o*ca.sqrt(rho_o*dp_o)'] },
  { part: 'liquids', lines: [
    '',
    '# Ideal gas pressure, mass balances',
    'P = m_g * R_spec * T / V_gas',
    'ode = ca.vertcat(',
    '    w_g - w_g_out,',
    '    w_o - w_weir,',
    '    w_w - w_w_out,',
    '    w_weir - w_o_out)'] },
  { part: 'run', lines: [
    '',
    '# One RK4 step as a CasADi function',
    "f = ca.Function('f', [x, u, p], [ode])",
    'k1 = f(x, u, p)',
    'k2 = f(x + dt/2*k1, u, p)',
    'k3 = f(x + dt/2*k2, u, p)',
    'k4 = f(x + dt*k3, u, p)',
    'xf = x + dt/6*(k1 + 2*k2 + 2*k3 + k4)'] },
];
const OWN = PRIVATE && OVERRIDES.twinCode;
const TAB = OWN?.tab ?? 'separator.py';
const SECTIONS = (OWN?.sections ?? PUBLIC).map((s) => ({ ...s, lines: s.lines.map(py) }));
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
    this.home = { pos: this.camera.position.clone(), target: this.target.clone() };
    this.rt = new THREE.WebGLRenderTarget(640, 384, { samples: 4 });
    this.rt.texture.userData.raw = true;
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.at = new THREE.Vector3();   // the part being placed
    this.build();
    game.hooks.render.push((renderer) => {
      if (!this.on || !this.ready) return;
      // Only while its monitor is in view (once first, so it never shows black), at 30 fps
      const seen = this.game.room?.feedsShown(this.game.camera);
      if (this.shot && seen && !['twin', 'twinFix'].some((id) => seen.has(id))) return;
      if (this.shot && (this.skip = !this.skip)) return;
      this.shot = true;
      const prev = renderer.getRenderTarget(), clip = renderer.localClippingEnabled;
      renderer.localClippingEnabled = true;
      renderer.setRenderTarget(this.rt);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(prev);
      renderer.localClippingEnabled = clip;
    });
    CONTENT.twinCode = ['VS Code', (ctx, w, h) => this.drawCode(ctx, w, h)];
    CONTENT.twin = ['Digital twin', (ctx, w, h) => this.drawRing(ctx, w, h)];
    CONTENT.twinFix = ['Digital twin', (ctx, w, h) => this.drawFix(ctx, w, h)];
    for (const id of ['twinCode', 'twin', 'twinFix']) if (!LIVE.includes(id)) LIVE.push(id);
    this.fix = { len: 0, valve: 0 };
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
    // the linear level valve the correction puts in (another actuator, so it reads as a new valve)
    const old = sep.valves[SWAP];
    this.newValve = new Valve({ body: 'globe', actuator: 'linear', r: DIM.liquidR * 0.85, fluid: SWAP, name: `LV ${SWAP} (linear)`, side: old.side });
    this.newValve.group.position.copy(old.group.position);
    this.newValve.group.rotation.copy(old.group.rotation);
    this.newValve.group.userData.home = old.group.position.clone();
    this.newValve.setCut({ style: 'glass', amount: 1 });
    this.newValve.group.visible = false;
    sep.group.add(this.newValve.group);
    // CtrlBuddy's beam: a cone of light from him to the part
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1, 24, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: BLUE, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    sc.add(this.beam);
  }

  async load() {
    // Its lighting environment now, while the room loads: made on the first
    // frame it showed, it stalled that frame by over a second (headless bench)
    this.scene.environment ??= new THREE.PMREMGenerator(this.game.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
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
    const mode = on === 'fix' ? 'fix' : on ? 'build' : null;
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    this.on = Boolean(mode);
    this.fix = { len: 0, valve: 0 };
    this.marked = {};
    this.game.room?.setFeeds({ twin: this.rt.texture, twinFix: this.rt.texture });
    if (mode && !was) {
      this.t = mode === 'fix' ? DUR : 0;   // its own clock: a jump between beats runs the story clock on fast
      this.p = mode === 'fix' ? 1 : 0;
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
    const p = this.p = this.mode === 'fix' ? 1 : HOLD != null ? +HOLD : Math.min(1, this.t / DUR);
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
    this.correct(dt);
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
    if (this.t < DUR + 1 || this.mode === 'fix') this.game.room?.redraw?.(CODE_SCREEN, TWIN_SCREEN);   // the typing and the ring while it builds (only these two: redrawNow redrew every live screen each frame)
  }

  // The corrections, as far as the chat has come: the messages marked twin: 'len' and 'valve' (story.json chats.sim2)
  correct(dt) {
    const f = this.fix, nv = this.newValve, oldG = this.sep.valves[SWAP].group;
    const shown = this.mode === 'fix' ? (CHATS.sim2?.messages ?? []).slice(0, S.chats.sim2 ?? 0) : [];
    // each change waits until the camera is back from the report before it (Adriaen, 2026-10-30)
    const since = (this.marked ??= {});
    const has = (k) => {
      if (!shown.some(([, , m]) => m?.twin === k)) { delete since[k]; return false; }
      since[k] ??= this.t;
      return this.t - since[k] > FIX_WAIT;
    };
    const toward = (v, to) => (to > v ? Math.min(to, v + dt * 0.6) : Math.max(to, v - dt * 0.6));
    f.len = toward(f.len, has('len') ? 1 : 0);
    f.valve = toward(f.valve, has('valve') ? 1 : 0);
    this.sep.group.scale.x = 1 - SHORT * smooth(f.len);
    // the equal-percentage valve lifts out and hangs to the side; the new one drops into its place
    const out = smooth(f.valve * 1.6);
    oldG.position.copy(oldG.userData.home).add(new THREE.Vector3(-0.6 * out, 1.4 * out, -1.6 * out));
    // the valves sit behind the vessel: the camera swings round to them for the swap
    const swing = smooth(f.valve * 2.5), v = this.sep.group.localToWorld(oldG.userData.home.clone());
    const target = this.home.target.clone().lerp(v.clone().add(new THREE.Vector3(-0.3, 0.6, -0.8)), swing);
    // round the vessel's end, not through it: angle, radius and height eased separately
    const back = v.clone().add(new THREE.Vector3(4.5, 3.0, -10)), from = this.home.pos;
    const a0 = Math.atan2(from.x, from.z), a1 = Math.atan2(back.x, back.z), r0 = Math.hypot(from.x, from.z), r1 = Math.hypot(back.x, back.z);
    const ang = a0 + (a1 - a0) * swing, rad = r0 + (r1 - r0) * swing;
    this.camera.position.set(Math.sin(ang) * rad, from.y + (back.y - from.y) * swing, Math.cos(ang) * rad);
    this.camera.lookAt(target);
    const inn = smooth((f.valve - 0.35) / 0.65);
    nv.group.visible = f.valve > 0.35;
    nv.group.position.copy(nv.group.userData.home);
    nv.group.position.y += (1 - inn) * 2.5;
    nv.set(this.sim.z?.[SWAP] ?? this.sim.u?.[SWAP] ?? 0.5);
    nv.update(dt);
  }

  // The twin beside the chat about the real separator, with the corrections pointed out;
  // the report the chat hands over at the end (the tuning tool) takes the screen
  drawFix(ctx, w, h) {
    const n = S.chats.sim2 ?? 0, last = CHATS.sim2?.messages[n - 1];
    if (last?.[0] === 'show') { CONTENT['report:sim2']?.[1](ctx, w, h); return; }
    const s = w / 640, f = this.fix;
    const at = (v) => { const p = v.clone().project(this.camera); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h]; };
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.font = `600 ${15 * s}px system-ui, sans-serif`;
    ctx.fillText(T('Digital tvilling · sekundær innløpsseparator', 'Digital twin · secondary inlet separator'), 20 * s, 34 * s);
    // the length, as a dimension line under the vessel
    if (f.len > 0 && f.valve < 0.3) {
      const g = this.sep.group, half = DIM.L / 2 + DIM.R / 2, y = DIM.ground + 0.2, z = 2.2;
      const [x0, y0] = at(g.localToWorld(new THREE.Vector3(-half, y, z))), [x1, y1] = at(g.localToWorld(new THREE.Vector3(half, y, z)));
      ctx.globalAlpha = Math.min(1, f.len * 3, (0.3 - f.valve) * 6);
      ctx.strokeStyle = '#ffd27a'; ctx.fillStyle = '#ffd27a'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      for (const [x, yy] of [[x0, y0], [x1, y1]]) { ctx.moveTo(x, yy - 8 * s); ctx.lineTo(x, yy + 8 * s); }
      ctx.stroke();
      const m = 8 - smooth(f.len);
      ctx.font = `700 ${16 * s}px system-ui, sans-serif`; ctx.textAlign = 'center';
      const label = `${T('Hovedseparasjonssone', 'Main separation zone')}: ${f.len < 1 ? m.toFixed(1).replace('.', T(',', '.')) : '7'} m`;
      const tw = ctx.measureText(label).width + 14 * s;
      ctx.fillStyle = '#0b141c'; ctx.fillRect((x0 + x1) / 2 - tw / 2, (y0 + y1) / 2 - 12 * s, tw, 22 * s);
      ctx.fillStyle = '#ffd27a'; ctx.textBaseline = 'middle'; ctx.fillText(label, (x0 + x1) / 2, (y0 + y1) / 2);
      ctx.globalAlpha = 1;
    }
    // each valve with its curve
    if (f.valve > 0) {
      const old = at(this.sep.valves[SWAP].group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)));
      const neu = at(this.newValve.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)));
      ctx.globalAlpha = Math.min(1, f.valve * 3);
      this.curveCard(ctx, s, old, [old[0] - 150 * s, old[1] - 110 * s], T('Likeprosentlig', 'Equal percentage'), '#ff7a7a', (z) => (EQP ** (z - 1) - 1 / EQP) / (1 - 1 / EQP), true);
      if (f.valve > 0.5) {
        ctx.globalAlpha = Math.min(1, (f.valve - 0.5) * 4);
        this.curveCard(ctx, s, neu, [neu[0] + 50 * s, neu[1] - 30 * s], T('Lineær', 'Linear'), '#7fdc9a', (z) => z, false);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // A small valve-curve card (flow against opening) at [x, y], with a leader to the valve at `to`
  curveCard(ctx, s, to, [x, y], title, colour, curve, crossed) {
    const cw = 112 * s, ch = 80 * s, pad = 8 * s;
    x = Math.max(4 * s, Math.min(ctx.canvas.width - cw - 4 * s, x));
    y = Math.max(46 * s, y);   // under the title
    ctx.strokeStyle = colour; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(x + cw / 2, y + ch); ctx.lineTo(to[0], to[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(to[0], to[1], 3.5 * s, 0, 7); ctx.fillStyle = colour; ctx.fill();
    ctx.fillStyle = '#0b141ce6'; ctx.fillRect(x, y, cw, ch);
    ctx.strokeRect(x, y, cw, ch);
    ctx.fillStyle = colour; ctx.font = `700 ${12 * s}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(title, x + pad, y + 7 * s);
    const px = x + pad + 4 * s, py = y + 26 * s, pw = cw - 2 * pad - 4 * s, ph = ch - 26 * s - pad;
    ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + ph); ctx.lineTo(px + pw, py + ph); ctx.stroke();
    ctx.strokeStyle = colour; ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const z = i / 24, cx = px + z * pw, cy = py + ph * (1 - curve(z)); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); }
    ctx.stroke();
    ctx.fillStyle = '#ffffff99'; ctx.font = `${9 * s}px system-ui, sans-serif`;
    ctx.fillText(T('åpning →', 'opening →'), px + pw - 44 * s, py + ph + 1 * s);
    if (crossed) {
      ctx.strokeStyle = '#ff7a7a'; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(x + cw - 26 * s, y + 6 * s); ctx.lineTo(x + cw - 10 * s, y + 22 * s); ctx.moveTo(x + cw - 10 * s, y + 6 * s); ctx.lineTo(x + cw - 26 * s, y + 22 * s); ctx.stroke();
    }
  }

  // VS Code with the model as far as it is typed (the last rows, as it scrolls), and the chat that asked for it
  drawCode(ctx, w, h) {
    const p = this.on ? this.p : 1;
    const chat = [{ t: T('Bygg en generisk separatormodell i CasADi fra referansematerialet.', 'Build a generic separator model in CasADi from the reference material.'), me: true }];
    if (p > 0.04) chat.push({ t: T('Henter de fysikalske likningene: geometri, massebalanser, overløp og ventiler …', 'Gathering the physical equations: geometry, mass balances, weir and valves …') });
    if (p >= 1) chat.push({ t: T('Ferdig. Tvillingen kjører.', 'Done. The twin is running.') });
    const fs = w / 64, rows = Math.max(4, Math.floor((h / fs - 4.2) / 1.4));
    const lines = typed(p);
    drawVSCode(ctx, {
      title: 'separator-twin — Visual Studio Code', tab: TAB,
      tree: [{ t: '▾ SEPARATOR-TWIN' }, { t: '▾ model', lvl: 1 }, { t: TAB, lvl: 2, hl: true }, { t: 'valves.py', lvl: 2 }, { t: '▾ data', lvl: 1 }, { t: 'drawing.pdf', lvl: 2 }, { t: 'timeseries.csv', lvl: 2 }, { t: '▸ tuning', lvl: 1 }],
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
