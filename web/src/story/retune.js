// Today, after the step test and the separator model (Adriaen, 2026-10-30):
// the re-tuning outcome. The sim lab's comparison (separatorCompare.js) full
// screen: the cut-open separator live on the left, the trends of both tunings
// on the right (dashed = old, solid = new) for pressure, the oil compartment
// level with the gap bands, the oil valve and oil in water. Both run the new
// model on the slugging well at 5x. S swaps which tuning the vessel shows.
// No end card: the presenter moves on when the point is made.
//
// State key (content.js): retune: true shows it, null hides it. It has its
// own renderer, made the first time it shows, and runs only while shown.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { perfWatch } from '../perf.js';
import { Separator, DIM } from '../separator.js';
import { SeparatorCompare, drawTrend } from '../separatorCompare.js';
import { T } from './lang.js';

const SPEED = 5;
const NAMES = { a: T('Gammel innstilling', 'Old tuning'), b: T('Ny innstilling', 'New tuning') };
const TITLES = [T('Trykk, barg', 'Pressure, barg'), T('Nivå i oljekammeret, %', 'Oil compartment level, %'),
  T('Oljeventil, åpning %', 'Oil valve position, %'), T('Olje i vann, ppm', 'Oil in water, ppm')];

export class Retune {
  constructor() {
    const el = this.el = document.createElement('div');
    el.className = 'retune';
    el.innerHTML = `<div class="view"><canvas></canvas><div class="tag"></div></div><div class="trends"><div class="legend"></div></div>`;
    (document.getElementById('game') ?? document.body).append(el);
    this.canvas = el.querySelector('canvas');
    this.tag = el.querySelector('.tag');
    this.legend = el.querySelector('.legend');
    this.trendCanvases = TITLES.map(() => { const c = document.createElement('canvas'); el.querySelector('.trends').append(c); return c; });
    this.on = false;
    this.show = 'b';
    this.renderer = null;
    addEventListener('keydown', (e) => {
      if (!this.on || e.code !== 'KeyS' || e.metaKey || e.ctrlKey) return;
      this.show = this.show === 'a' ? 'b' : 'a';
      this.label();
    });
  }

  build() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.toneMapping = THREE.AgXToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.localClippingEnabled = true;
    perfWatch(r, 'retune');
    const scene = this.scene = new THREE.Scene();
    scene.name = 'retune';
    scene.background = new THREE.Color(0x1a2329);
    scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(-6, 12, 9);
    scene.add(sun, new THREE.HemisphereLight(0xcfe3ff, 0x30302c, 0.6));
    scene.fog = new THREE.Fog(0x1a2329, 18, 32);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshLambertMaterial({ color: 0x3a4246 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = DIM.ground;
    const grid = new THREE.GridHelper(24, 24, 0x55626a, 0x465157);
    grid.position.y = DIM.ground + 0.005;
    scene.add(floor, grid);
    this.sep = new Separator();
    scene.add(this.sep.group);
    this.sep.setCut({ style: 'glass', amount: 1 });
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.target = new THREE.Vector3(-0.3, 0.2, 0);
  }

  // A fresh run each time it shows: both tunings from the same start
  set(on) {
    on = Boolean(on);
    if (on === this.on) return;
    this.on = on;
    this.el.classList.toggle('on', on);
    if (!on) return;
    if (!this.renderer) this.build();
    this.cmp = new SeparatorCompare('tuning');
    this.cmp.slugging = true;
    this.cmp.trends.forEach((tr, i) => { tr.title = TITLES[i]; });
    this.show = 'b';
    this.legend.innerHTML = `<span><i class="b"></i>${NAMES.b}</span><span><i class="a"></i>${NAMES.a}</span>`;
    this.label();
    this.size = null;
  }

  label() {
    this.tag.innerHTML = `${NAMES[this.show]} <small>${T('Sluggende brønn · 5x tid', 'Slugging well · 5x time')}</small>`;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const key = `${w}x${h}`;
    if (!w || key === this.size) return;
    this.size = key;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    const halfW = 6.2, halfH = 3.8, t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.max(halfH / t, halfW / (t * cam.aspect)) + 2;
    cam.position.set(1.0, 2.2, dist).add(this.target);
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    for (const c of this.trendCanvases) { const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio; }
  }

  update(dt) {
    if (!this.on || !this.renderer) return;
    dt = Math.min(dt, 0.05);
    for (let i = 0; i < SPEED; i++) this.cmp.step(dt);
    const s = this.cmp[this.show];
    s.apply(this.sep);
    this.sep.update(dt * SPEED, s.stir);
    this.resize();
    this.renderer.render(this.scene, this.camera);
    this.cmp.trends.forEach((tr, i) => drawTrend(this.trendCanvases[i], this.cmp, tr));
  }
}
