// Story mode's sound: the spoken lines (mp3s from voices.py), and effects made
// on the spot with Web Audio so they cost no downloads: the two-tone process
// alarm that builds through the Act 1 cascade, radio squelch, a desk phone
// ringing, and the soft chime of an agent's notification.
import { PRIVATE, PRIVATE_BASE } from '../privateNames.js';
const VOICE = 'story/voice/';
// The private build's own takes of the lines that say a real name
// (voices.py --private), over the public ones with the stand-ins
const PRIVATE_VOICE = PRIVATE ? `${PRIVATE_BASE}voice/` : null;

// The rotor's two mixes, tuned by ear in a Web Audio test page (the Rotor Sound Lab):
// blade passes in Hz (5 blades), beat depth, blade slap (harmonics), air
// noise tone and level, low thump, tail rotor pitch and level, turbine whine
const ROTOR = {
  inside: { rate: 22, depth: 0.35, sharp: 3, cutoff: 420, noise: 0.9, thump: 0.35, tailHz: 105, tail: 0.02, whineHz: 1350, whine: 0.005 },
  outside: { rate: 22, depth: 0.85, sharp: 8, cutoff: 1500, noise: 0.8, thump: 0.6, tailHz: 105, tail: 0.05, whineHz: 1350, whine: 0.006 },
};

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
    this.own = PRIVATE_VOICE ? await fetch(`${PRIVATE_VOICE}voice.json`).then((r) => r.json()).catch(() => ({})) : {};
    Object.assign(this.index, this.own);
  }

  async buffer(id) {
    if (this.buffers[id]) return this.buffers[id];
    const p = fetch(`${this.own?.[id] ? PRIVATE_VOICE : VOICE}${id}.mp3`).then((r) => { if (!r.ok) throw new Error(id); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b)).catch(() => null);
    this.buffers[id] = p;
    return p;
  }
  preload(ids) { if (this.ctx) for (const id of ids) this.buffer(id); }

  // Play a line; resolves when it ends (or at once if it has no audio, after
  // a reading time so its subtitle still shows). A suspended audio context
  // (a phone may suspend it) never fires 'ended', so the line's own length,
  // plus a little, ends it too: a silent line must not stall the beat.
  async line(id, { gain = 1 } = {}) {
    const dur = this.index[id]?.dur;
    if (this.ctx?.state === 'suspended') this.ctx.resume?.();
    const buf = this.ctx ? await this.buffer(id) : null;
    if (!buf) { await new Promise((r) => setTimeout(r, (dur ?? 3) * 1000)); return; }
    this.duck(true);
    await Promise.race([this.play(buf, gain), new Promise((r) => setTimeout(r, (buf.duration + 0.5) * 1000))]);
    this.duck(false);
  }

  // On a click or key (the browser lets audio start only then): wake the context if it slept
  wake() { if (this.ctx?.state !== 'running') this.ctx?.resume?.(); }

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

  // A helicopter's rotors: air noise beating at the blade pass rate with a
  // pulse (equal harmonics, so each blade slaps), a low thump on the same
  // beat, the tail rotor's buzz and the turbines' whine. Two mixes, tuned by
  // Adriaen in the Rotor Sound Lab: the cabin's duller drone and the
  // outside's sharp slap. Fades to `level` over `fade` s; 0 stops it
  rotor(level, fade = 1.5, tone = 'outside') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.rot && level > 0) {
      const n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const lp = ctx.createBiquadFilter(), air = ctx.createGain();
      lp.type = 'lowpass';
      const beat = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
      beat.gain.value = 0.55;
      lfo.connect(depth).connect(beat.gain);
      const thumpOsc = ctx.createOscillator(), thumpLp = ctx.createBiquadFilter(), thump = ctx.createGain();
      thumpLp.type = 'lowpass'; thumpLp.frequency.value = 140; thump.gain.value = 0;
      const tailOsc = ctx.createOscillator(), tailLp = ctx.createBiquadFilter(), tail = ctx.createGain();
      tailOsc.type = 'sawtooth'; tailLp.type = 'lowpass'; tailLp.frequency.value = 700; tail.gain.value = 0;
      const whine = ctx.createOscillator(), whineGain = ctx.createGain();
      whineGain.gain.value = 0;
      const bus = ctx.createGain();
      bus.gain.value = 0;
      src.connect(lp).connect(air).connect(beat).connect(bus);
      thumpOsc.connect(thumpLp).connect(thump).connect(bus);
      tailOsc.connect(tailLp).connect(tail).connect(bus);
      whine.connect(whineGain).connect(bus);
      bus.connect(this.out);
      for (const o of [src, lfo, thumpOsc, tailOsc, whine]) o.start();
      this.rot = { src, lp, air, lfo, depth, thumpOsc, thump, tailOsc, tail, whine, whineGain, bus, sharp: 0 };
    }
    if (!this.rot) return;
    const r = this.rot, ramp = (param, v) => { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + fade); };
    const m = ROTOR[tone] ?? ROTOR.outside;
    if (r.sharp !== m.sharp) {
      // A pulse train: cosines of equal height all peak once per blade
      const re = new Float32Array(m.sharp + 1).fill(1);
      re[0] = 0;
      const wave = ctx.createPeriodicWave(re, new Float32Array(m.sharp + 1));
      r.lfo.setPeriodicWave(wave);
      r.thumpOsc.setPeriodicWave(wave);
      r.sharp = m.sharp;
    }
    ramp(r.lfo.frequency, m.rate); ramp(r.thumpOsc.frequency, m.rate);
    ramp(r.depth.gain, m.depth * 0.5);
    ramp(r.lp.frequency, m.cutoff); ramp(r.air.gain, m.noise);
    ramp(r.thump.gain, m.thump * 0.5);
    ramp(r.tailOsc.frequency, m.tailHz); ramp(r.tail.gain, m.tail);
    ramp(r.whine.frequency, m.whineHz); ramp(r.whineGain.gain, m.whine);
    ramp(r.bus.gain, level);
    if (level <= 0) {
      this.rot = null;
      setTimeout(() => { try { for (const o of [r.src, r.lfo, r.thumpOsc, r.tailOsc, r.whine]) o.stop(); } catch { /* gone */ } r.bus.disconnect(); }, fade * 1000 + 100);
    }
  }

  // Music under a scene (the flight's): a file that may not be there yet,
  // in which case nothing plays. Ducks under the spoken lines (line())
  async music(url, level = 0.35, offset = 0) {   // offset: s into the track
    if (!this.ctx || this.musicUrl === url) return;   // already playing (or loading): carry on
    this.stopMusic();
    this.musicUrl = url;
    const my = this.musicToken = (this.musicToken ?? 0) + 1;
    const buf = await fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => b && this.ctx.decodeAudioData(b)).catch(() => null);
    if (!buf || my !== this.musicToken) return;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(0, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(level, this.ctx.currentTime + 2);
    src.connect(g).connect(this.out);
    src.start(0, offset % buf.duration);
    src.onended = () => { if (this.mus?.src === src) { this.mus = null; this.musicUrl = null; } };
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
    this.musicUrl = null;
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
