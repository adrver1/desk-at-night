// Building CtrlBuddy (Adriaen, 2026-10-30), the beat before he first appears:
// two of the left desk's monitors. On one, VS Code, his agent file being
// written line by line; on the other, the same thing as a little 3D workshop
// where Ola fits him together part by part, with a spanner, sparks and a weld
// light, over a blueprint of the finished robot, and a progress ring.
// Ola faces him and works on the part being fitted, in one half-crouch
// throughout (Adriaen, 2026-10-30: no rising and sinking); his back, head and
// arms follow the part's height, with a spanner (round and round) or a hammer (up slowly, down hard),
// posed bone by bone over his idle clip (Adriaen, 2026-10-30: not one lifted hand).
// Adriaen picked the two monitors in the room (A) over a full-screen split (B)
// and the workshop full screen (C), 2026-10-30.
//
// The code and the robot go together: each section of the file is one part of
// him (his hover base, body, arms, head), fitted while that section is typed.
// A part is a bone scaled up from nothing; the parts come in order, so the
// later ones (children of the earlier) stay hidden until their turn.
// The workshop is drawn every frame into a render target that its screen shows
// as a live feed under its 2D picture (like buddy.js); the code screen is 2D
// (vscode.js drawVSCode).
//
// State key (content.js): build: true starts the build on entering the beat,
// null hides it. Screens: CODE_SCREEN shows 'buildCode', SHOP_SCREEN 'workshop'.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { CONTENT } from '../screens.js';
import { LIVE } from '../controlScene.js';
import { loadModel } from './cast.js';
import { drawVSCode } from './vscode.js';
import { T } from './lang.js';

export const CODE_SCREEN = 'Desk0Mon0Screen', SHOP_SCREEN = 'Desk0Mon1Screen';
const DUR = 8;   // s, the whole build (Adriaen, 2026-10-30: twice as fast)
const HOLD = new URLSearchParams(location.search).get('buildAt');   // ?buildAt=0..1 holds the build there (stills)
const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// The tool Ola works each part with
const WORK = [{ tool: 'wrench' }, { tool: 'hammer' }, { tool: 'wrench' }, { tool: 'hammer' }, { tool: 'wrench' }];
const CROUCH = 0.08;   // m his hips sit lower than standing, the whole build
const UP = new THREE.Vector3(0, 1, 0);

// Turn a bone so its length (+Y) points along a world direction, blended by w
// from where the clip has it (as buddy.js aim)
function aim(bone, want, w = 1) {
  if (!bone || w <= 0) return;
  bone.updateMatrixWorld(true);
  const qb = bone.getWorldQuaternion(new THREE.Quaternion());
  const now = new THREE.Vector3(0, 1, 0).applyQuaternion(qb);
  const dir = now.clone().lerp(want, w).normalize();
  const world = new THREE.Quaternion().setFromUnitVectors(now, dir).multiply(qb);
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  bone.updateMatrixWorld(true);
}

// The agent file, one section per part of him. Lines are coloured runs
// [text, colour key] (vscode.js VS_COL)
const SECTIONS = [
  { bones: ['hips'], lines: [[['---', 'com']], [['name: ', 'key'], ['CtrlBuddy', 'text']], [['model: ', 'key'], ['Claude', 'text']], [['---', 'com']]] },
  { bones: ['spine'], lines: [[], [['# CtrlBuddy', 'head']], [['You are an experienced automation engineer', 'text']], [['on an offshore platform. Explain every step.', 'text']]] },
  { bones: ['upper_arm.L'], lines: [[], [['## Tools', 'head']], [['- ', 'text'], ['cdf', 'key'], [': time series, assets, events', 'text']]] },
  { bones: ['upper_arm.R'], lines: [[['- ', 'text'], ['loopinsight', 'key'], [': control loop reports', 'text']]] },
  { bones: ['head'], lines: [[], [['## Knowledge', 'head']], [['- governing documents', 'text']], [['- P&IDs, cause and effect', 'text']], [], [['## Rules', 'head']], [['- never touch the ESD', 'text']]] },
];
const len = (line) => line.reduce((n, [t]) => n + t.length, 0) + 1;   // +1: an empty line takes a moment too
const CHARS = SECTIONS.map((s) => s.lines.reduce((n, l) => n + len(l), 0));
const TOTAL = CHARS.reduce((a, b) => a + b, 0);
const TYPE = 0.9;   // share of the build spent typing; the rest, the last weld and the finished robot

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
// How far each part is fitted (0..1) at progress p
function parts(p) {
  const chars = smooth(p / TYPE) * TOTAL;
  let at = 0;
  return CHARS.map((n) => { const k = (chars - at) / n; at += n; return Math.max(0, Math.min(1, k)); });
}

export class Workshop {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.t = 0;
    this.p = 0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1f27);
    this.scene.fog = new THREE.Fog(0x1a1f27, 6, 12);
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 50);
    this.camera.position.set(0.5, 1.4, 3.2);
    this.camera.lookAt(-0.05, 1.02, 0);
    this.rt = new THREE.WebGLRenderTarget(640, 384, { samples: 4 });
    this.rt.texture.userData.raw = true;
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.weldAt = new THREE.Vector3();
    this.build();
    game.hooks.render.push((renderer) => {
      if (!this.on || !this.ready) return;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.rt);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(prev);
    });
    CONTENT.buildCode = ['VS Code', (ctx, w, h) => this.drawCode(ctx, w, h)];
    CONTENT.workshop = ['Building CtrlBuddy', (ctx, w, h) => this.drawRing(ctx, w, h)];
    for (const id of ['buildCode', 'workshop']) if (!LIVE.includes(id)) LIVE.push(id);
  }

  // The bench, its loose parts, the spanner, the sparks and the weld light
  build() {
    const sc = this.scene;
    sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    sc.add(key);
    const mat = (c, m = 0.2) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: m, flatShading: true });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    sc.add(floor);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.6), mat(0x8a6a48));
    bench.position.set(-1.0, 0.86, -0.7);
    sc.add(bench);
    for (const [x, z] of [[-1.6, -0.95], [-0.4, -0.95], [-1.6, -0.45], [-0.4, -0.45]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.86, 0.06), mat(0x5a4632));
      l.position.set(x, 0.43, z);
      sc.add(l);
    }
    for (let i = 0; i < 6; i++) {
      const g = i % 3 === 0 ? new THREE.CylinderGeometry(0.05, 0.05, 0.22, 8) : i % 3 === 1 ? new THREE.BoxGeometry(0.16, 0.1, 0.12) : new THREE.SphereGeometry(0.08, 8, 6);
      const p = new THREE.Mesh(g, mat(i % 2 ? 0xc9ccd1 : 0x7d8590, 0.6));
      p.position.set(-1.5 + i * 0.2, 0.96, -0.7 + (i % 2) * 0.12);
      p.rotation.z = i;
      sc.add(p);
    }
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 16), mat(0x3a414c, 0.5));
    stand.position.set(0.4, 0.06, 0);
    sc.add(stand);
    this.spanner = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.01), mat(0xb8bec7, 0.8));
    const jaw = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 4, 8, Math.PI * 1.5), mat(0xb8bec7, 0.8));
    jaw.position.y = 0.11;
    this.spanner.add(shaft, jaw);
    this.hammer = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.24, 0.022), mat(0x8a6a48));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.045), mat(0x5d636c, 0.8));
    head.position.y = 0.12;
    this.hammer.add(handle, head);
    const N = 120;
    this.sparks = { pos: new Float32Array(N * 3), vel: Array.from({ length: N }, () => new THREE.Vector3()), life: new Float32Array(N) };
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparks.pos, 3));
    sc.add(new THREE.Points(this.sparkGeo, new THREE.PointsMaterial({ color: 0xffd27a, size: 0.025, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    this.weld = new THREE.PointLight(0x9fd2ff, 0, 2.5);
    sc.add(this.weld);
  }

  async load() {
    const [op, bud] = await Promise.all(['bearded_operator', 'control_buddy'].map((m) => loadModel(m).catch((e) => { console.warn('workshop', m, e); return null; })));
    if (!op || !bud) return;
    const clip = (g, n) => THREE.AnimationClip.findByName(g.animations, n);
    const bones = (root) => { const b = {}; root.traverse((o) => { if (o.isBone) b[o.name] = o; }); return b; };
    // Ola beside him, facing him (the crew look down their -Z), turned a little to us
    this.op = op.scene;
    this.op.position.set(-0.3, 0, -0.1);
    this.op.rotation.y = Math.atan2(-0.7, -0.1);
    this.opMix = new THREE.AnimationMixer(this.op);
    const idleOp = clip(op, 'idle');
    if (idleOp) this.opMix.clipAction(idleOp).play();
    const ob = bones(this.op), b = (n) => ob[n.replace('.', '')] ?? ob[n];
    this.ob = Object.fromEntries(['hips', 'spine', 'upper_arm.L', 'forearm.L', 'hand.L', 'upper_arm.R', 'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R'].map((n) => [n, b(n)]));
    for (const tool of [this.spanner, this.hammer]) { this.ob['hand.R']?.add(tool); tool.position.set(0, 0.08, 0.02); }
    // his leg, to bend the knees so the hips sit CROUCH lower with the feet where they were
    this.opMix.update(0);
    this.op.updateMatrixWorld(true);
    const at = (n) => this.ob[n]?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    const thigh = at('thigh.R').distanceTo(at('shin.R')), shin = at('shin.R').distanceTo(at('foot.R'));
    this.knee = Math.acos(Math.min(1, (thigh + shin - CROUCH) / (thigh + shin)));
    this.reach = 0;
    this.aimAt = new THREE.Vector3(0.4, 1.0, 0);
    this.ob.head = b('head'); this.ob.neck = b('neck');
    // him on his stand, and his blueprint: a wireframe of the finished robot the parts fill in
    this.bud = bud.scene;
    this.bud.position.set(0.4, -0.3, 0);
    this.bud.rotation.y = Math.PI - 0.45;
    this.ghost = cloneSkinned(this.bud);
    this.ghost.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x5fd6ff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false }); });
    const idle = clip(bud, 'idle');
    this.budMix = new THREE.AnimationMixer(this.bud);
    this.ghostMix = new THREE.AnimationMixer(this.ghost);
    if (idle) { this.budMix.clipAction(idle).play(); this.ghostMix.clipAction(idle).play(); }
    for (const o of [this.op, this.bud, this.ghost]) o.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    this.scene.add(this.op, this.bud, this.ghost);
    const bb = bones(this.bud), bone = (n) => bb[n] ?? bb[n.replace('.', '')];   // the loader drops the dots
    this.parts = SECTIONS.map((s) => s.bones.map(bone).filter(Boolean));
    this.ready = true;
  }

  // The story's state: build or not (restarts on entering the beat)
  set(on) {
    on = Boolean(on);
    if (on === this.on) return;
    this.on = on;
    this.t = 0;   // its own clock: a jump between beats runs the story clock on fast
    this.p = 0;
    this.game.room?.setFeeds({ workshop: this.rt.texture });
    if (on) {
      const f = this.game.room?.screenFrame(SHOP_SCREEN, this.game.camera.position);
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
    this.t += dt;
    const p = this.p = HOLD != null ? +HOLD : Math.min(1, this.t / DUR);
    const k = parts(p);
    let fitting = -1;
    this.parts.forEach((bs, i) => {
      for (const b of bs) b.scale.setScalar(Math.max(1e-4, smooth(k[i] * 1.25 - 0.25)));
      if (fitting < 0 && k[i] < 1) fitting = i;
    });
    const busy = fitting >= 0 && k[fitting] > 0;
    if (fitting >= 0) this.parts[fitting][0]?.getWorldPosition(this.weldAt);
    this.ghost.visible = p < 1;
    // sparks at the part being fitted
    const { pos, vel, life } = this.sparks;
    for (let i = 0; i < life.length; i++) {
      life[i] -= dt;
      if (life[i] <= 0 && busy && Math.random() < 0.3) {
        life[i] = 0.4 + Math.random() * 0.5;
        pos.set([this.weldAt.x, this.weldAt.y, this.weldAt.z], i * 3);
        vel[i].set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2);
      }
      if (life[i] > 0) { vel[i].y -= 6 * dt; pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt; } else pos[i * 3 + 1] = -10;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.weld.position.copy(this.weldAt);
    this.weld.intensity = busy ? 2 + Math.random() * 6 : 0;
    this.opMix.update(dt); this.budMix.update(dt); this.ghostMix.update(dt);
    this.work(fitting >= 0 ? WORK[fitting] : null, dt);
    if (this.t < DUR + 1) this.game.room?.redrawNow?.();   // the typing and the ring, every frame while it builds
  }

  // Ola at work on the part being fitted (null: done, he stands back)
  work(job, dt) {
    const B = this.ob, ease = (v, to, rate) => v + (to - v) * Math.min(1, dt * rate);
    this.reach = ease(this.reach, job ? 1 : 0, 6);
    this.spanner.visible = job?.tool !== 'hammer';
    this.hammer.visible = job?.tool === 'hammer';
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.op.quaternion), side = new THREE.Vector3().crossVectors(fwd, UP);
    // where he works, eased so a new part doesn't jerk him round
    this.aimAt.lerp(this.weldAt, Math.min(1, dt * 4));
    // the half-crouch: knees forward, shins back to the feet, the same all the way through
    const c = Math.cos(this.knee), sn = Math.sin(this.knee);
    this.op.position.y = -CROUCH;
    for (const s of ['L', 'R']) {
      aim(B[`thigh.${s}`], UP.clone().multiplyScalar(-c).addScaledVector(fwd, sn).normalize());
      aim(B[`shin.${s}`], UP.clone().multiplyScalar(-c).addScaledVector(fwd, -sn).normalize());
      aim(B[`foot.${s}`], fwd);
    }
    // bent over as far as the part is low: none at chest height, a deep bow at his knees
    const chest = B['upper_arm.R']?.getWorldPosition(new THREE.Vector3()).y ?? 1.3;
    const bow = THREE.MathUtils.clamp((chest - 0.1 - this.aimAt.y) / 0.8, 0, 1) * smooth(this.reach);
    aim(B['spine'], UP.clone().addScaledVector(fwd, 1.1 * bow).normalize());
    // and his head turned to it
    const head = B.head;
    if (head) aim(head, UP.clone().add(this.aimAt.clone().sub(head.getWorldPosition(new THREE.Vector3())).normalize().multiplyScalar(0.8)).normalize(), 0.7 * smooth(this.reach));
    // both hands to the part: the left holds it, the right works the tool
    const w = smooth(this.reach), t = this.t;
    if (w < 0.001) return;
    const to = (bone) => this.aimAt.clone().sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    if (B['upper_arm.L']) {
      aim(B['upper_arm.L'], to(B['upper_arm.L']).addScaledVector(UP, -0.5).addScaledVector(side, -0.2).normalize(), w);
      aim(B['forearm.L'], to(B['forearm.L']).addScaledVector(side, -0.15).normalize(), w);
    }
    if (!B['upper_arm.R']) return;
    aim(B['upper_arm.R'], to(B['upper_arm.R']).addScaledVector(UP, -0.6).addScaledVector(side, 0.3).normalize(), w);
    let d = to(B['forearm.R']);
    if (job?.tool === 'hammer') {
      // up slowly, down hard: a beat of 0.55 s
      const ph = (t / 0.55) % 1, a = ph < 0.75 ? 0.7 * smooth(ph / 0.75) : 0.7 * (1 - (ph - 0.75) / 0.25);
      d = d.multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)).normalize();
    } else {
      // round and round with the spanner
      d = d.addScaledVector(side, 0.35 * Math.cos(t * 7)).addScaledVector(UP, 0.35 * Math.sin(t * 7)).normalize();
    }
    aim(B['forearm.R'], d, w);
    aim(B['hand.R'], d, w);
  }

  // VS Code with the file as far as it is typed, and the chat that asked for it
  drawCode(ctx, w, h) {
    const p = this.on ? this.p : 1;
    const chat = [{ t: T('Bygg en agent som jobber som en erfaren automasjonsingeniør.', 'Build me an agent that works like an experienced automation engineer.'), me: true }];
    if (p > 0.04) chat.push({ t: T('Skriver instruksjoner, verktøy og kunnskapsbase …', 'Writing the instructions, tools and knowledge base …') });
    if (p >= 1) chat.push({ t: T('Ferdig. CtrlBuddy er klar.', 'Done. CtrlBuddy is ready.') });
    drawVSCode(ctx, {
      title: 'ctrlbuddy — Visual Studio Code', tab: 'ctrlbuddy.agent.md',
      tree: [{ t: '▾ CTRLBUDDY' }, { t: '▾ .github', lvl: 1 }, { t: '▾ agents', lvl: 2 }, { t: 'ctrlbuddy.agent.md', lvl: 3, hl: true }, { t: '▾ tools', lvl: 1 }, { t: 'cdf.py', lvl: 2 }, { t: 'loopinsight.py', lvl: 2 }, { t: '▸ knowledge', lvl: 1 }],
      lines: typed(p), caret: p < TYPE, chat, pick: 'Agent',
    }, 0, 0, w, h);
  }

  // The workshop's own picture over the feed: the progress ring, top right
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
    ctx.fillText(p >= 1 ? T('CtrlBuddy er klar', 'CtrlBuddy is ready') : T('Bygger CtrlBuddy …', 'Building CtrlBuddy …'), 20 * s, 34 * s);
  }
}
