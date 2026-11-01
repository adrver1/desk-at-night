// Today, after the step test and the separator model (Adriaen, 2026-10-30):
// the re-tuning outcome. The sim lab's comparison (separatorCompare.js) full
// screen: the cut-open separator live on the left, the trends of both tunings
// on the right (dashed = old, solid = new) for pressure, the oil compartment
// level with the gap bands, the oil valve and oil in water. Both run the new
// model on the slugging well at 5x. S swaps which tuning the vessel shows.
// No end card: the presenter moves on when the point is made.
//
// State key (content.js): retune: true shows it full screen, 'screen' on a
// room monitor instead (screen content 'retune', Adriaen 2026-11-01), null
// hides it. It has its own renderer, made the first time it shows, and runs
// only while shown.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { perfWatch } from '../perf.js';
import { Separator, DIM } from '../separator.js';
import { SeparatorCompare, drawTrend } from '../separatorCompare.js';
import { T } from './lang.js';
import { CONTENT } from '../screens.js';
import { LIVE } from '../controlScene.js';
import { SANS, MONO } from '../fonts.js';

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
    this.mode = null;   // 'full' (the overlay) or 'screen' (a room monitor)
    this.screen = null;   // the monitor picture's size, [view width, height]
    this.show = 'b';
    this.renderer = null;
    addEventListener('keydown', (e) => {
      if (!this.on || e.code !== 'KeyS' || e.metaKey || e.ctrlKey) return;
      this.show = this.show === 'a' ? 'b' : 'a';
      this.label();
    });
    CONTENT.retune = ['Re-tuning', (ctx, w, h) => this.drawScreen(ctx, w, h)];
    if (!LIVE.includes('retune')) LIVE.push('retune');
  }

  build() {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true });   // kept, for the monitor to copy
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
    const mode = on === 'screen' ? 'screen' : on ? 'full' : null, was = this.mode;
    if (mode === was) return;
    this.mode = mode;
    this.on = Boolean(mode);
    this.el.classList.toggle('on', mode === 'full');
    this.size = null;
    if (!mode) return;
    if (!this.renderer) this.build();
    if (was) return;   // from the monitor to full screen or back: the same run goes on
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
    const [w, h] = this.mode === 'screen' ? this.screen ?? [0, 0] : [this.canvas.clientWidth, this.canvas.clientHeight];
    const key = `${w}x${h}`;
    if (!w || key === this.size) return;
    this.size = key;
    this.renderer.setPixelRatio(this.mode === 'screen' ? 1 : Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    const halfW = 6.2, halfH = 3.8, t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.max(halfH / t, halfW / (t * cam.aspect)) + 2;
    cam.position.set(1.0, 2.2, dist).add(this.target);
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    if (this.mode === 'full') for (const c of this.trendCanvases) { const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio; }
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
    this.cmp.trends.forEach((tr, i) => drawTrend(this.trendCanvases[i], this.cmp, tr, this.mode === 'screen' ? this.trendD : undefined));
  }

  // On a room monitor: the separator on the left, the four trends on the
  // right, as the overlay lays them out
  drawScreen(ctx, w, h) {
    ctx.fillStyle = '#0b1216';
    ctx.fillRect(0, 0, w, h);
    if (this.mode !== 'screen') return;
    const u = h / 100, vw = Math.round(w * 0.62), tw = w - vw, pad = 3 * u;
    const top = 9 * u, th = (h - top - pad) / 4 - 1.6 * u;
    if (this.screen?.[0] !== vw || this.screen?.[1] !== h) {
      this.screen = [vw, h];
      this.size = null;
      this.trendD = u / 4;
      for (const c of this.trendCanvases) { c.width = Math.round(tw - 2 * pad); c.height = Math.round(th); }
    }
    ctx.drawImage(this.canvas, 0, 0, vw, h);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.shadowColor = '#000'; ctx.shadowBlur = u * 0.6;
    ctx.fillStyle = '#eef3f4'; ctx.font = `600 ${4.6 * u}px ${SANS}`;
    ctx.fillText(NAMES[this.show], 3 * u, 3 * u);
    ctx.fillStyle = '#9fb3ba'; ctx.font = `500 ${2.5 * u}px ${MONO}`;
    ctx.fillText(T('Sluggende brønn · 5x tid', 'Slugging well · 5x time'), 3 * u, 8.6 * u);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(6, 14, 18, 0.9)';
    ctx.fillRect(vw, 0, tw, h);
    // the legend: new solid, old dashed
    ctx.font = `500 ${2.6 * u}px ${SANS}`; ctx.textBaseline = 'middle';
    let x = vw + pad;
    for (const [k, dash] of [['b', []], ['a', [u, u * 0.8]]]) {
      ctx.strokeStyle = k === 'b' ? '#f2b544' : '#9fb3ba'; ctx.lineWidth = 0.45 * u; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x, top / 2 + u); ctx.lineTo(x + 5 * u, top / 2 + u); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#eef3f4'; ctx.fillText(NAMES[k], x + 6.4 * u, top / 2 + u);
      x += 6.4 * u + ctx.measureText(NAMES[k]).width + 4 * u;
    }
    this.trendCanvases.forEach((c, i) => ctx.drawImage(c, vw + pad, top + i * (th + 1.6 * u)));
  }
}
