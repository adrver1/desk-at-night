// A video call (or phone call) window in the corner: the onshore person live
// in their own little 3D view, head and shoulders, talking while their line
// plays. It has its own small renderer, so it costs nothing when closed.
import * as THREE from 'three';
import { loadModel } from './cast.js';
import { SPEAKERS } from './content.js';

export class Call {
  constructor(el) {
    this.el = el;
    this.canvas = document.createElement('canvas');
    this.bar = document.createElement('div');
    this.bar.className = 'bar';
    el.append(this.canvas, this.bar);
    this.renderer = null;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x3a4350);
    this.scene.add(new THREE.HemisphereLight(0xfff3e0, 0x404858, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 3);
    this.scene.add(key);
    // A plain office wall and a shelf behind them, for depth
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshLambertMaterial({ color: 0x8c96a3 }));
    wall.position.set(0, 1.5, 1.2);
    wall.rotation.y = Math.PI;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.2), new THREE.MeshLambertMaterial({ color: 0x5b4a3a }));
    shelf.position.set(-0.55, 1.75, 1.05);
    this.scene.add(wall, shelf);
    this.camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.05, 20);
    this.models = {};
    this.who = null;
    this.mouth = null;
  }

  async person(who) {
    if (this.models[who]) return this.models[who];
    this.models[who] = (async () => {
      const gltf = await loadModel(SPEAKERS[who].model).catch(() => null);
      if (!gltf) return null;
      const p = gltf.scene;
      // Characters face -z, toward the camera here
      const mixer = new THREE.AnimationMixer(p);
      const clip = (n) => THREE.AnimationClip.findByName(gltf.animations, n);
      mixer.clipAction(clip('idle')).play();
      const talk = clip('talk') && mixer.clipAction(clip('talk'));
      talk?.play();
      talk?.setEffectiveWeight(0);
      const blink = clip('blink') && mixer.clipAction(clip('blink'));
      blink?.setLoop(THREE.LoopOnce);
      p.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      return { root: p, mixer, talk, blink, level: 0, blinkAt: 0 };
    })();
    return this.models[who];
  }

  async show(c) {
    this.who = c?.who ?? null;
    this.el.classList.toggle('on', Boolean(c));
    this.el.classList.toggle('phone', Boolean(c?.phone));
    if (!c) return;
    this.bar.innerHTML = `<span><span class="live"></span>${SPEAKERS[c.who]?.name ?? c.who}</span><small>${c.phone ? 'Phone' : 'Video link'}</small>`;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.AgXToneMapping;
    }
    const p = await this.person(c.who);
    if (this.who !== c.who) return;
    for (const m of Object.values(this.models)) { const r = await m; if (r && r !== p) this.scene.remove(r.root); }
    if (p) this.scene.add(p.root);
    this.current = p;
    // Head and shoulders of a 1.75 m person
    this.camera.position.set(0.0, 1.55, -1.25);
    this.camera.lookAt(0, 1.5, 0);
  }

  talk(who, mouth) { if (who === this.who) { this.mouth = mouth; this.mouthT = 0; } }
  quiet() { this.mouth = null; }

  update(dt, now) {
    const p = this.current;
    if (!this.who || !p || !this.renderer) return;
    let level = 0;
    if (this.mouth) {
      this.mouthT += dt;
      const i = Math.floor(this.mouthT * 30);
      if (i >= this.mouth.length) this.mouth = null; else level = Number(this.mouth[i]) / 3;
    }
    p.level += (level - p.level) * Math.min(1, dt * 18);
    p.talk?.setEffectiveWeight(Math.min(1, p.level * 1.6));
    this.el.classList.toggle('speaking', p.level > 0.15);
    if (p.blink && now > p.blinkAt) { p.blink.reset().play(); p.blinkAt = now + 2.5 + Math.random() * 4; }
    p.mixer.update(dt);
    const w = this.canvas.clientWidth, hh = this.canvas.clientHeight;
    if (w && (this.canvas.width !== w || this.canvas.height !== hh)) {
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
