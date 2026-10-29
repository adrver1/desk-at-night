// One year ago, a call (Adriaen, 2026-10-29): the neighbouring platform rings
// the new operator about its separator. The same dark screen and round
// portraits as the thoughts (thoughts.js): the caller on the left, a speech
// bubble with the separator cut open in glass and slugging (../separator.js,
// its own little renderer), the operator on the right.
//
// State key (content.js): call: 'neighbour' shows it, null hides it. The
// caller's name comes from SPEAKERS (a stand-in in public; the private build
// has the real one) and the private build may swap the portrait
// (overrides.json `faces`: { neighbour: 'faces/<file>' }).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Separator, SeparatorSim } from '../separator.js';
import { PRIVATE, PRIVATE_BASE, OVERRIDES } from '../privateNames.js';
import { SPEAKERS } from './content.js';

const W = 960, H = 540;   // px of the bubble's picture
const CALLERS = { neighbour: 'story/faces/neighbour.svg' };

export class Caller {
  constructor() {
    const el = this.el = document.createElement('div');
    el.className = 'caller';
    el.innerHTML = `<figure class="who them"><img alt=""><figcaption></figcaption></figure>
      <div class="speech"><canvas width="${W}" height="${H}"></canvas><i class="tail"></i></div>
      <figure class="who me"><img src="story/faces/adriaen.png" alt=""></figure>`;
    (document.getElementById('game') ?? document.body).append(el);
    this.canvas = el.querySelector('canvas');
    this.who = null;
    this.on = false;
  }

  // who calls (null: no call), and how far the call has come: 'ring' (the
  // operator's portrait alone in the middle, the room showing through, where
  // he picks up), 'talk' (his portrait moves right, the caller's appears),
  // 'sep' (the separator in the speech bubble)
  set(who, stage = 'sep') {
    who = who || null;
    for (const k of ['ring', 'talk', 'sep']) this.el.classList.toggle(k, Boolean(who) && k === stage);
    if (who && who !== this.who) {
      const face = PRIVATE && OVERRIDES.faces?.[who] ? PRIVATE_BASE + OVERRIDES.faces[who] : CALLERS[who];
      this.el.querySelector('.them img').src = face ?? '';
      this.el.querySelector('.them figcaption').textContent = SPEAKERS[who]?.name ?? '';
      if (!this.built) this.build();
    }
    if (who && stage !== 'sep') this.reset();   // the slugs start when the bubble opens
    this.who = who;
    this.on = Boolean(who);
    this.el.classList.toggle('on', this.on);
  }

  // The scene is built the first time a call comes in
  build() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    r.localClippingEnabled = true;
    r.setClearColor(0x000000, 0);
    const scene = this.scene = new THREE.Scene();
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.6;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-6, 12, 9);
    scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.7));
    this.sep = new Separator({ inlet: 'vane', gas: 'cyclones' });
    this.sep.setCut({ style: 'glass', amount: 1 });
    scene.add(this.sep.group);
    // the vessel's length across the bubble, a little from above
    const cam = this.camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);
    const target = new THREE.Vector3(-0.3, -0.3, 0), t = Math.tan(THREE.MathUtils.degToRad(17));
    cam.position.set(1.5, 3.0, Math.max(3.4 / t, 6.6 / (t * cam.aspect)) + 0.5).add(target);
    cam.lookAt(target);
    this.built = true;
  }

  reset() {
    this.sim = new SeparatorSim();
    this.nextSlug = 0.6;
  }

  // Each frame (dt in s) while shown: big slugs, one after the other
  update(dt) {
    if (!this.on || !this.built) return;
    dt = Math.min(dt, 0.05);
    const p = this.sim;
    if (p.t > this.nextSlug) { p.slug(1.1 + 0.5 * Math.random()); this.nextSlug = p.t + 7 + 3 * Math.random(); }
    p.step(dt);
    p.apply(this.sep);
    this.sep.update(dt, p.stir);
    this.renderer.render(this.scene, this.camera);
  }
}
