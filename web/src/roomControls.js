// The room's building controls, as an operator would find them on the desk
// touch panel: ceiling lights (scene and brightness), sound (the room tone of
// ventilation and equipment hum) and temperature. The wall panel by the door
// only steps through the light scenes.
import * as THREE from 'three';

export const SCENES = { full: 100, night: 25, off: 0 };
const NAMES = { full: 'Full', night: 'Night', off: 'Off' };
const ORDER = ['full', 'night', 'off'];
const TEMP_TAU = 90; // s for the room to settle on a new setpoint

export class RoomControls {
  constructor(ui) {
    this.ui = ui;
    this.light = SCENES.night; // %
    this.volume = 40;          // %
    this.setpoint = 21.5;      // °C
    this.temp = 22.6;          // °C, drifts toward the setpoint
    this.ceiling = this.light / 100; // what the renderer uses, eased
    this.audio = null;
    this.dirty = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 384;
    this.canvas.height = 240;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.bind();
    this.sync();
  }

  get scene() {
    return ORDER.find((k) => SCENES[k] === this.light) ?? null;
  }

  setLight(pct) { this.light = Math.round(Math.max(0, Math.min(100, pct))); this.sync(); }
  setScene(name) { this.setLight(SCENES[name]); }
  nextScene() {
    const i = ORDER.indexOf(this.scene);
    const next = ORDER[(i + 1) % ORDER.length];
    this.setScene(next);
    return NAMES[next];
  }
  nextSceneName() { return NAMES[ORDER[(ORDER.indexOf(this.scene) + 1) % ORDER.length]]; }
  setVolume(pct) { this.volume = Math.round(Math.max(0, Math.min(100, pct))); this.sync(); }
  nudgeSetpoint(d) { this.setpoint = Math.max(17, Math.min(26, this.setpoint + d)); this.sync(); }

  // Wire up the on-screen panel (play.html)
  bind() {
    const u = this.ui;
    u.scenes.forEach((b) => b.addEventListener('click', () => this.setScene(b.dataset.scene)));
    u.light.addEventListener('input', () => this.setLight(Number(u.light.value)));
    u.volume.addEventListener('input', () => this.setVolume(Number(u.volume.value)));
    u.warmer.addEventListener('click', () => this.nudgeSetpoint(0.5));
    u.cooler.addEventListener('click', () => this.nudgeSetpoint(-0.5));
  }

  sync() {
    const u = this.ui;
    u.scenes.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scene === this.scene)));
    u.light.value = this.light;
    u.lightOut.textContent = `${this.light}%`;
    u.volume.value = this.volume;
    u.volumeOut.textContent = this.volume ? `${this.volume}%` : 'Muted';
    u.setpoint.textContent = this.setpoint.toFixed(1);
    u.temp.textContent = this.status();
    this.dirty = true;
  }

  // Room tone: filtered noise for the ventilation plus a faint mains hum.
  // Browsers only allow sound after a click, so this starts with the game.
  startAudio() {
    if (this.audio) return this.audio.ctx.resume();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; } // brown noise
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 420;
    const fans = ctx.createGain();
    noise.connect(low).connect(fans).connect(master);
    noise.start();
    const hum = ctx.createGain();
    hum.gain.value = 0.025;
    hum.connect(master);
    for (const f of [50, 100]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(hum);
      o.start();
    }
    this.audio = { ctx, master, fans };
  }

  // Ease the lights, let the room temperature drift, follow the sound level
  step(dt) {
    const target = this.light / 100;
    this.ceiling += (target - this.ceiling) * (1 - Math.exp(-dt / 0.35));
    const before = this.temp.toFixed(1);
    this.temp += (this.setpoint - this.temp) * (1 - Math.exp(-dt / TEMP_TAU));
    if (this.temp.toFixed(1) !== before) { this.ui.temp.textContent = this.status(); this.dirty = true; }
    if (this.audio) {
      const working = Math.min(Math.abs(this.setpoint - this.temp) / 1.0, 1); // fans run harder while it adjusts
      const t = this.audio.ctx.currentTime;
      this.audio.fans.gain.setTargetAtTime(0.55 + 0.45 * working, t, 0.5);
      this.audio.master.gain.setTargetAtTime(0.5 * (this.volume / 100) ** 2, t, 0.1);
    }
    if (this.dirty) this.draw();
  }

  status() {
    const diff = this.setpoint - this.temp;
    const doing = Math.abs(diff) < 0.15 ? 'holding' : diff < 0 ? 'cooling' : 'heating';
    return `Room now ${this.temp.toFixed(1)} °C · ${doing}`;
  }

  summary() {
    return `Lights ${this.light}% · ${this.temp.toFixed(1)} °C · sound ${this.volume}%`;
  }

  // The little screen on each desk panel
  draw() {
    this.dirty = false;
    const g = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#0b1220';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#8d95a8';
    g.font = '500 18px ui-monospace, Menlo, monospace';
    g.fillText('ROOM CONTROL', 20, 34);
    const rows = [
      ['Lights', `${this.light}%`, this.light / 100, '#f2a646'],
      ['Temp', `${this.setpoint.toFixed(1)} °C`, (this.setpoint - 17) / 9, '#7fd1b9'],
      ['Sound', `${this.volume}%`, this.volume / 100, '#a8bcff'],
    ];
    rows.forEach(([label, value, frac, color], i) => {
      const y = 80 + i * 56;
      g.fillStyle = '#e8e2d2';
      g.font = '600 22px system-ui, sans-serif';
      g.fillText(label, 20, y);
      g.textAlign = 'right';
      g.fillText(value, W - 20, y);
      g.textAlign = 'left';
      g.fillStyle = '#253049';
      g.fillRect(20, y + 12, W - 40, 8);
      g.fillStyle = color;
      g.fillRect(20, y + 12, (W - 40) * Math.max(0, Math.min(1, frac)), 8);
    });
    this.texture.needsUpdate = true;
  }
}
