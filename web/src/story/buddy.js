// CtrlBuddy's first appearance (Adriaen, 2026-10-29): one year ago, the
// operator at his desk with the learning curve beside him, then CtrlBuddy on
// his screen, waving, and a big pixelated mouse pointer that clicks him, which
// opens the chat of the next beat.
//
// CtrlBuddy is the 3D robot (characters/control_buddy, copied to
// public/story/chars/) in a little scene of his own, drawn every frame into a
// render target that his screen shows as a live feed under its 2D picture
// (storyScreens.js buddyScreen draws the window around him, BUDDY_LOOKS says
// where he stands). The pointer is a flat sprite lying on the screen's glass,
// so it moves smoothly whatever rate the screen's picture redraws at.
//
// State keys (content.js beats): buddy: 'splash' (Adriaen's pick, 2026-10-29)
// | 'popup' | 'chat' shows him in that look on the chat screen while it shows
// 'buddy'; curve: 'axes' | 'plot' shows the learning curve's axes, then the
// curve too (two clicks); buddyWho: 'scholar' puts his team-mate there instead
// (kept as an option). The step { buddy: 'click' } moves the
// pointer to him and clicks, in a beat whose state has buddyPointer: true.
import * as THREE from 'three';
import { loadModel } from './cast.js';
import { S, BUDDY_LOOKS, BUDDY_WHO } from './storyScreens.js';
import { T } from './lang.js';

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const POINTER_FROM = [0.12, 0.92];   // where the pointer comes in, as shares of the screen
const MOVE = 1.3, PRESS = 0.18;      // s: the move to him, the button held down
const LOOK = new URLSearchParams(location.search).get('buddylook');   // try another look (BUDDY_LOOKS)

// The classic arrow, one character a pixel: # black edge, o white fill
const ARROW = [
  '#',
  '##',
  '#o#',
  '#oo#',
  '#ooo#',
  '#oooo#',
  '#ooooo#',
  '#oooooo#',
  '#ooooooo#',
  '#oooooooo#',
  '#ooooo#####',
  '#oo#oo#',
  '#o# #oo#',
  '##  #oo#',
  '#    #oo#',
  '     #oo#',
  '      ##',
];

export class Buddy {
  constructor(game, screen) {
    this.game = game;
    this.home = screen;   // his screen unless the state says another (buddyAt)
    this.screen = screen;
    this.look = null;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.2, 2.5, 3);
    this.scene.add(key);
    this.camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 50);
    this.rt = new THREE.WebGLRenderTarget(640, 360, { samples: 4 });
    this.rt.texture.userData.raw = true;
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    // the pointer: a flat sprite on the screen's glass, in a pass of its own over the room
    this.pointerScene = new THREE.Scene();
    this.pointer = this.makePointer();
    this.pointerScene.add(this.pointer);
    this.click = null;   // { t0, done } while the pointer is on its way
    game.hooks.render.push((renderer, camera) => {
      if (!this.look) return;
      this.draw(renderer);
      if (this.pointer.visible) renderer.render(this.pointerScene, camera);
    });
    this.curveEl = this.makeCurve();
  }

  async load() {
    this.agents = {};
    await Promise.all(Object.entries(BUDDY_WHO).map(async ([who, { model }]) => {
      const gltf = await loadModel(model).catch((e) => { console.warn('buddy', model, e); return null; });
      if (!gltf) return;
      const p = gltf.scene;
      p.rotation.y = Math.PI;   // the crew look down their -Z; he faces our camera on +Z
      p.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      p.visible = false;
      this.scene.add(p);
      const mixer = new THREE.AnimationMixer(p);
      const clip = THREE.AnimationClip.findByName(gltf.animations, 'idle');
      if (clip) mixer.clipAction(clip).play();
      const bones = {};
      p.traverse((o) => { if (o.isBone) bones[o.name] = o; });
      p.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(p);
      this.agents[who] = { model: p, mixer, bones, size: box.getSize(new THREE.Vector3()), mid: box.getCenter(new THREE.Vector3()) };
    }));
  }

  // The agent on screen now (BUDDY_WHO): CtrlBuddy, or a team-mate
  get agent() { return this.agents?.[S.buddy.who]; }

  // The story's state: his look on screen (or null), and the learning curve
  set(s) {
    const want = LOOK ?? s.buddy;
    S.buddy.who = BUDDY_WHO[s.buddyWho] ? s.buddyWho : 'buddy';
    for (const [who, a] of Object.entries(this.agents ?? {})) a.model.visible = who === S.buddy.who;
    const screen = s.buddyAt ?? this.home;
    if (screen !== this.screen) { this.screen = screen; this.look = null; }
    const look = want && BUDDY_LOOKS[want] && s.screens?.[this.screen] === 'buddy' ? want : null;   // only while his screen shows him
    if (look !== this.look) {
      this.look = look;
      if (look) {
        S.buddy.look = look;
        this.game.room?.setFeeds({ buddy: this.rt.texture });
        // the screens face their desk's chair: the chair nearest the screen
        const at = this.game.room?.screenFrame(this.screen, this.game.camera.position)?.center;
        const chairs = (this.game.chairs ?? []).map((c) => c.obj.getWorldPosition(new THREE.Vector3()));
        const chair = (at ? chairs.sort((a, b) => a.distanceTo(at) - b.distanceTo(at))[0] : chairs[0])?.clone() ?? this.game.camera.position.clone();
        this.frame = this.game.room?.screenFrame(this.screen, chair.setY(1.2));
        if (this.frame) {
          const w = 640, h = Math.round(640 * this.frame.height / this.frame.width);
          if (h !== this.rt.height) this.rt.setSize(w, h);
          this.camera.aspect = w / h;
        }
        this.scene.background = new THREE.Color(BUDDY_LOOKS[look].bg);
      }
    }
    // the pointer only in the beat that clicks him (state buddyPointer; Adriaen, 2026-10-29: not while he waves)
    if (!look || !s.buddyPointer) { this.pointer.visible = false; this.click = null; S.buddy.clickAt = -99; }
    this.curve(s.curve);
    this.curveEl.classList.toggle('late', Boolean(s.curveLate));
  }

  // The pointer comes in, goes to him and clicks; resolves once he has been clicked
  clickHim(onClick) {
    if (!this.look || !this.frame) return Promise.resolve();
    return new Promise((done) => { this.click = { t: 0, onClick, done }; this.pointer.visible = true; this.placePointer(...POINTER_FROM); });
  }

  // The click jumps to its end: the pointer on him, him clicked (for a beat entered directly)
  clicked() {
    if (!this.look || !this.frame) return;
    const L = BUDDY_LOOKS[this.look];
    this.click = null;
    this.pointer.visible = true;
    this.placePointer(L.x + 0.02, L.y - 0.02);
    this.pointer.scale.setScalar(this.pointerSize);
    S.buddy.clickAt = S.now - 10;
  }

  update(dt, now) {
    if (!this.look) return;
    const a = this.agent;
    if (a) {
      a.mixer.update(dt);
      // a little bob, a hop when he is clicked, and the wave until then
      const since = now - S.buddy.clickAt;
      a.model.position.y = 0.02 * Math.sin(now * 2.1) + (since < 0.7 ? 0.12 * Math.sin(Math.PI * since / 0.7) : 0);
      if (since > 0.7) this.wave(a, now);
    }
    const c = this.click;
    if (c) {
      c.t += dt;
      const L = BUDDY_LOOKS[this.look], k = smooth(c.t / MOVE);
      const [x0, y0] = POINTER_FROM, x1 = L.x + 0.02, y1 = L.y - 0.02;
      // a gentle arc, like a hand on a mouse
      this.placePointer(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - 0.08 * Math.sin(Math.PI * k));
      const down = c.t > MOVE + 0.15 && c.t < MOVE + 0.15 + PRESS;
      this.pointer.scale.setScalar(this.pointerSize * (down ? 0.88 : 1));
      if (c.t > MOVE + 0.15 && !c.clicked) { c.clicked = true; S.buddy.clickAt = now; c.onClick?.(); }
      if (c.t > MOVE + 0.9) { this.click = null; c.done(); }
    }
  }

  // Right arm up and out, the forearm swinging side to side
  wave({ model, bones: b }, now) {
    const up = b.upper_armR ?? b['upper_arm.R'], fore = b.forearmR ?? b['forearm.R'], hand = b.handR ?? b['hand.R'];   // the loader drops the dots
    if (!up || !fore) return;
    model.updateMatrixWorld(true);
    const x = Math.sign(up.getWorldPosition(new THREE.Vector3()).x - model.position.x) || -1;   // his right, seen from the front
    const a = 0.45 * Math.sin(now * 8);
    aim(up, new THREE.Vector3(0.75 * x, 0.45, 0.25).normalize());
    aim(fore, new THREE.Vector3((Math.sin(a) + 0.1) * x, Math.cos(a), 0.15).normalize());
    if (hand) aim(hand, new THREE.Vector3((Math.sin(a * 1.3) + 0.1) * x, Math.cos(a * 1.3), 0.15).normalize());
  }

  // Draw him into his screen's feed, framed where his look puts him
  draw(renderer) {
    const a = this.agent;
    if (!a || !this.frame) return;
    const L = BUDDY_LOOKS[this.look], cam = this.camera, w = this.rt.width, h = this.rt.height;
    const fov = THREE.MathUtils.degToRad(cam.fov);
    const d = a.size.y / L.h / (2 * Math.tan(fov / 2));
    cam.position.set(a.mid.x, a.mid.y, a.mid.z + d);
    cam.lookAt(a.mid);
    cam.setViewOffset(w, h, (0.5 - L.x) * w, (0.5 - L.y) * h, w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prev);
  }

  makePointer() {
    const px = 18, c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    ARROW.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      g.fillStyle = ch === '#' ? '#000' : '#fff';
      g.fillRect(x, y, 1, 1);
    }));
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5, -0.5, 0);   // the tip at the origin
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, toneMapped: false, depthTest: false }));
    m.visible = false;
    m.renderOrder = 10;
    return m;
  }

  // The pointer's tip at (u, v) on the screen, as shares of its width and height (v down)
  placePointer(u, v) {
    const f = this.frame, size = 0.3 * f.height;   // big: near a third of the screen's height
    this.pointer.position.copy(f.at(u, v)).addScaledVector(f.normal, 0.004);
    const right = new THREE.Vector3().crossVectors(f.up, f.normal);
    this.pointer.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, f.up, f.normal));
    if (this.pointerSize !== size) this.pointer.scale.setScalar(size);
    this.pointerSize = size;
  }

  // ---------------------------------------------------------------- the learning curve

  makeCurve() {
    const el = document.createElement('div');
    el.className = 'learning';
    // a first-order response: steep at first, then levelling off. The second (Adriaen, 2026-10-30:
    // him with CtrlBuddy) rises faster and levels off higher: together they get further, sooner
    const pts = (tau, top) => Array.from({ length: 61 }, (_, i) => {
      const t = i / 60, y = top * (1 - Math.exp(-t / tau));
      return `${(60 + t * 320).toFixed(1)},${(250 - y * 200).toFixed(1)}`;
    }).join(' ');
    el.innerHTML = `<svg viewBox="0 0 420 300" aria-hidden="true">
      <path class="axis" d="M60 30 V250 H400" />
      <path class="arrow" d="M54 40 L60 28 L66 40 M390 244 L402 250 L390 256" />
      <polyline class="plot" points="${pts(0.18, 0.72)}" />
      <polyline class="plot2" points="${pts(0.08, 1.04)}" />
      <defs><clipPath id="learnerClip"><circle r="24" /></clipPath></defs>
      <g class="learner"><circle class="ring" r="27" /><image href="story/faces/adriaen.png" x="-24" y="-24" width="48" height="48" clip-path="url(#learnerClip)" /></g>
      <g class="learner2"><rect class="ring" x="-51" y="-27" width="102" height="54" rx="27" />
        <g transform="translate(-24 0)"><image href="story/faces/adriaen.png" x="-24" y="-24" width="48" height="48" clip-path="url(#learnerClip)" /></g>
        <g transform="translate(24 0)"><image href="story/faces/ctrlbuddy.png" x="-24" y="-24" width="48" height="48" clip-path="url(#learnerClip)" /></g></g>
      <text x="230" y="285" text-anchor="middle">${T('Tid', 'Time')}</text>
      <text x="0" y="0" transform="translate(36 140) rotate(-90)" text-anchor="middle">${T('Læring', 'Learning')}</text>
    </svg>`;
    (document.getElementById('game') ?? document.body).append(el);
    // (Adriaen, 2026-10-29) his portrait rides the tip of the curve as it draws: he is the one learning
    const ride = (plot, learner, shown) => {
      const len = plot.getTotalLength();
      const drawn = Math.min(len, Math.max(0, 700 - parseFloat(getComputedStyle(plot).strokeDashoffset)));
      // the curve gone (it snaps back undrawn): the portrait goes at once, where it is
      const on = shown && drawn > 1;
      learner.style.transition = on ? '' : 'none';
      learner.style.opacity = on ? 1 : 0;
      if (on) { const p = plot.getPointAtLength(drawn); learner.setAttribute('transform', `translate(${p.x} ${p.y})`); }
    };
    const follow = () => {
      const both = el.classList.contains('both');
      ride(el.querySelector('.plot'), el.querySelector('.learner'), el.classList.contains('plot') || both);
      ride(el.querySelector('.plot2'), el.querySelector('.learner2'), both);
      if (el.classList.contains('on')) requestAnimationFrame(follow); else this.following = false;
    };
    this.followCurve = () => { if (!this.following) { this.following = true; requestAnimationFrame(follow); } };
    return el;
  }

  // 'axes' shows the panel and its axes (state curveLate: a moment later, after the thoughts), 'plot' draws the curve in as well, 'both' shows that one
  // drawn and draws the second (with CtrlBuddy) over it
  curve(step) {
    this.curveEl.classList.toggle('on', Boolean(step));
    this.curveEl.classList.toggle('plot', step === 'plot');
    this.curveEl.classList.toggle('both', step === 'both');
    if (step) this.followCurve();
  }
}

// Turn a bone so its length (+Y) points along a direction in the buddy's
// scene (as cast.js aim, without the blend)
function aim(bone, want) {
  bone.updateMatrixWorld(true);
  const qb = bone.getWorldQuaternion(new THREE.Quaternion());
  const now = new THREE.Vector3(0, 1, 0).applyQuaternion(qb);
  const world = new THREE.Quaternion().setFromUnitVectors(now, want).multiply(qb);
  const qp = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(qp.multiply(world));
  bone.updateMatrixWorld(true);
}
