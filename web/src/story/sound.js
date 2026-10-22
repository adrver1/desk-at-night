// Story mode's sound: the spoken lines (mp3s from voices.py), and effects made
// on the spot with Web Audio so they cost no downloads: the two-tone process
// alarm that builds through the Act 1 cascade, radio squelch, a desk phone
// ringing, and the soft chime of an agent's notification.
const VOICE = 'story/voice/';

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.index = {};
    this.live = new Set();   // sources playing now, so a cut can stop them all
    this.alarm = null;
  }

  // Needs a click or key first (browsers' autoplay rule); `ctx` may be shared
  // with the room tone (roomControls.js)
  start(ctx) {
    this.ctx = ctx ?? this.ctx ?? new (window.AudioContext || window.webkitAudioContext)();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    this.ctx.resume?.();
  }

  async loadIndex() {
    this.index = await fetch(`${VOICE}voice.json`).then((r) => r.json()).catch(() => ({}));
  }

  async buffer(id) {
    if (this.buffers[id]) return this.buffers[id];
    const p = fetch(`${VOICE}${id}.mp3`).then((r) => { if (!r.ok) throw new Error(id); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b)).catch(() => null);
    this.buffers[id] = p;
    return p;
  }
  preload(ids) { if (this.ctx) for (const id of ids) this.buffer(id); }

  // Play a line; resolves when it ends (or at once if it has no audio, after
  // a reading time so its subtitle still shows)
  async line(id, { gain = 1 } = {}) {
    const dur = this.index[id]?.dur;
    const buf = this.ctx ? await this.buffer(id) : null;
    if (!buf) { await new Promise((r) => setTimeout(r, (dur ?? 3) * 1000)); return; }
    this.duck(true);
    await this.play(buf, gain);
    this.duck(false);
  }

  play(buf, gain = 1) {
    return new Promise((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.out);
      src.onended = () => { this.live.delete(src); resolve(); };
      this.live.add(src);
      src.start();
    });
  }

  // A beep envelope on a node, for the effects below
  env(node, t0, dur, level) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.01);
    g.gain.setValueAtTime(level, t0 + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    node.connect(g);
    return g;
  }

  tone(freq, t0, dur, level, type = 'sine', dest = this.out) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this.env(o, t0, dur, level).connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    this.live.add(o);
    o.onended = () => this.live.delete(o);
  }

  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(880, t, 0.18, 0.05);
    this.tone(1318.5, t + 0.12, 0.3, 0.04);
  }

  // A desk phone: two rings of 440 + 480 Hz
  ring(times = 2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < times; k++) for (const f of [440, 480]) this.tone(f, t + k * 1.2, 0.8, 0.035);
  }

  // The process alarm: a two-tone horn every 1.1 s, louder over `build`
  // seconds, with a layer of radio squelch and hum. stop() or cut() ends it.
  startAlarm(build = 15, peak = 0.12) {
    if (!this.ctx || this.alarm) return;
    const ctx = this.ctx, bus = ctx.createGain();
    bus.gain.setValueAtTime(0.02, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(peak, ctx.currentTime + build);
    bus.connect(this.out);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 2600;
    filt.connect(bus);
    let next = ctx.currentTime + 0.05, n = 0;
    const timer = setInterval(() => {
      while (next < ctx.currentTime + 0.5) {
        this.tone(988, next, 0.15, 0.5, 'square', filt);
        this.tone(784, next + 0.18, 0.15, 0.5, 'square', filt);
        // More horns join as the flood grows: a second, higher alarm
        if (n > 4) this.tone(1175, next + 0.55, 0.12, 0.3, 'square', filt);
        if (n % 3 === 2) this.squelch(next + 0.4, bus);
        next += 1.1; n++;
      }
    }, 120);
    this.alarm = { bus, timer };
  }

  squelch(t0, dest) {
    const n = Math.floor(this.ctx.sampleRate * 0.25), buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    src.connect(bp);
    this.env(bp, t0, 0.25, 0.4).connect(dest);
    src.start(t0);
    this.live.add(src);
    src.onended = () => this.live.delete(src);
  }

  stopAlarm() {
    if (!this.alarm) return;
    clearInterval(this.alarm.timer);
    this.alarm.bus.disconnect();
    this.alarm = null;
  }

  // A helicopter's rotors: low noise beating at the blade pass rate. Heard
  // from outside it thumps; inside the cabin it is a duller drone with the
  // turbines' whine on top. Fades to `level` over `fade` s; 0 stops it
  rotor(level, fade = 1.5, tone = 'outside') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.rot && level > 0) {
      const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      const beat = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      beat.gain.value = 0.55; lfo.frequency.value = 22;   // 5 blades at ~265 rpm
      lfo.connect(depth).connect(beat.gain);
      const whine = ctx.createOscillator(), whineGain = ctx.createGain();
      whine.frequency.value = 1180; whineGain.gain.value = 0;
      whine.connect(whineGain);
      const bus = ctx.createGain();
      bus.gain.value = 0;
      src.connect(lp).connect(beat).connect(bus);
      whineGain.connect(bus);
      bus.connect(this.out);
      src.start(); lfo.start(); whine.start();
      this.rot = { src, lfo, whine, lp, depth, whineGain, bus };
    }
    if (!this.rot) return;
    const r = this.rot, ramp = (param, v) => { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + fade); };
    const inside = tone === 'inside';
    ramp(r.lp.frequency, inside ? 340 : 900);
    ramp(r.depth.gain, inside ? 0.2 : 0.5);
    ramp(r.whineGain.gain, inside ? 0.012 : 0.004);
    ramp(r.bus.gain, level);
    if (level <= 0) {
      this.rot = null;
      setTimeout(() => { try { r.src.stop(); r.lfo.stop(); r.whine.stop(); } catch { /* gone */ } r.bus.disconnect(); }, fade * 1000 + 100);
    }
  }

  // Music under a scene (the flight's): a file that may not be there yet,
  // in which case nothing plays. Ducks under the spoken lines (line())
  async music(url, level = 0.35) {
    if (!this.ctx) return;
    this.stopMusic();
    const my = this.musicToken = (this.musicToken ?? 0) + 1;
    const buf = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => b && this.ctx.decodeAudioData(b)).catch(() => null);
    if (!buf || my !== this.musicToken) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(level, this.ctx.currentTime + 2);
    src.connect(g).connect(this.out);
    src.start();
    this.mus = { src, g, level };
  }

  duck(on) {
    if (!this.mus) return;
    const t = this.ctx.currentTime, gn = this.mus.g.gain;
    gn.cancelScheduledValues(t);
    gn.setValueAtTime(gn.value, t);
    gn.linearRampToValueAtTime(this.mus.level * (on ? 0.35 : 1), t + 0.4);
  }

  stopMusic(fade = 1.5) {
    this.musicToken = (this.musicToken ?? 0) + 1;
    const m = this.mus;
    if (!m) return;
    this.mus = null;
    const t = this.ctx.currentTime;
    m.g.gain.cancelScheduledValues(t);
    m.g.gain.setValueAtTime(m.g.gain.value, t);
    m.g.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { try { m.src.stop(); } catch { /* gone */ } }, fade * 1000 + 100);
  }

  // Everything off at once: the hard cut to silence, or leaving a beat
  cut() {
    this.stopAlarm();
    for (const s of this.live) { try { s.stop(); } catch { /* already stopped */ } }
    this.live.clear();
  }
}
