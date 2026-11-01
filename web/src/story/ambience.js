// The control room's background life in story mode (mix B of the Sound Lab,
// Adriaen 2026-11-01): the generators' rumble under the aircon, sounds that
// follow what the people do (mouse clicks on the mouse idle, a recorded slurp
// and the cup going down on the sip idle, short typing bursts in the typing
// pose, a chair creak), and life off screen: SAS alarms the operator acks
// with a click, radio calls, now and then a yawn from someone out of shot.
// Nothing is downloaded but the CC0
// recordings in story/sfx/; the rest is made with Web Audio like sound.js.
// Each person does one thing at a time; the radio comes in at random over
// everything. It all dips under the spoken lines (duck()).
import * as THREE from 'three';
import { SPOTS } from './cast.js';

const SFX = 'story/sfx/';
const SLURPS = ['slurp-5.mp3', 'slurp-6.mp3', 'slurp-7.mp3'];
// Seconds between events (min, max)
const EVERY = { typing: [25, 60], sas: [40, 100], radio: [50, 120], yawn: [180, 360] };
const YAWNS = ['yawn-1.mp3', 'yawn-2.mp3'];
// The idle clips' own clocks (characters/_shared/anims.py, 24 fps): the mug
// leaves the desk at 20/24 s and is down again at 76/24 s; the hand is on the
// mouse from 12/24 s and strokes it until 76/24 s
const SIP = { slurp: 20 / 24 + 0.45, down: 76 / 24 };
const MOUSE = { on: 12 / 24, off: 76 / 24 };
const LEVEL = 0.8;   // the whole layer, under the story's voices (1)
const R = (a, b) => a + Math.random() * (b - a);

export class Ambience {
  constructor(sound, cast) {
    this.sound = sound;
    this.cast = cast;
    this.on = false;
    this.alarm = false;     // the scripted cascade alarm is on: no random SAS then
    this.seen = new Map();  // person -> the idle (fidget) we last made sounds for
    this.next = {};
    this.bufs = {};
    this.v = new THREE.Vector3();
  }

  get ctx() { return this.sound.ctx; }

  // Needs the story's audio context (Sound.start)
  start() {
    const ctx = this.ctx;
    if (!ctx || this.out) return;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(this.sound.out);
    this.fx = ctx.createGain();
    this.fx.connect(this.out);
    this.bed();
    for (const f of [...SLURPS, ...YAWNS, 'pour.mp3']) this.load(f);
    const now = ctx.currentTime;
    for (const [k, [a, b]] of Object.entries(EVERY)) this.next[k] = now + R(a, b) * 0.4;
  }

  load(f) {
    return (this.bufs[f] ??= fetch(SFX + f).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => b && this.ctx.decodeAudioData(b)).catch(() => null));
  }

  // On while the room is on screen and the beat isn't a hard silence
  set(on, alarm = false) {
    this.alarm = alarm;
    if (on === this.on || !this.out) { this.on = on; return; }
    this.on = on;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(on ? LEVEL * (this.ducked ? 0.5 : 1) : 0, t + (on ? 1.5 : 0.3));
  }

  // Under a spoken line: everything here at half
  duck(on) {
    this.ducked = on;
    if (!this.out || !this.on) return;
    const t = this.ctx.currentTime, g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(LEVEL * (on ? 0.5 : 1), t + 0.4);
  }

  // ------------------------------------------------------------ every frame
  update(dt, camera) {
    if (!this.out || !this.on || !this.cast) return;
    const now = this.ctx.currentTime;
    this.camera = camera;
    const people = Object.values(this.cast.people ?? {}).filter((p) => p.root.visible);
    const seated = people.filter((p) => SPOTS[p.at]?.chair !== undefined);
    for (const p of people) this.follow(p, now);
    if (now > this.next.typing) {
      this.next.typing = now + R(...EVERY.typing);
      const ready = seated.filter((p) => p.pose === 'typing' && this.idle(p, now));
      if (ready.length) this.typing(ready[Math.floor(Math.random() * ready.length)], now);
    }
    if (now > this.next.sas) {
      this.next.sas = now + R(...EVERY.sas);
      if (!this.alarm && seated.length) this.sasBurst(seated.find((p) => SPOTS[p.at].chair === 0) ?? seated[0], now);
    }
    if (now > this.next.radio) {
      this.next.radio = now + R(...EVERY.radio);
      this.radio(now, seated);
    }
    // A yawn now and then, only from someone the camera doesn't see (there
    // is no yawn clip yet), and never from someone busy
    if (now > this.next.yawn) {
      this.next.yawn = now + R(...EVERY.yawn);
      const unseen = people.filter((p) => !this.onScreen(p) && !p.mouth && !p.fidget && !p.call);
      if (unseen.length) this.yawn(now, unseen[Math.floor(Math.random() * unseen.length)]);
    }
    // The pour (cast.js tips the jug; its stream shows while coffee runs)
    const pouring = Boolean(this.cast.stream?.visible);
    if (pouring && !this.pouring) this.pour(now);
    if (!pouring && this.pouring) this.pourEnd(now);
    this.pouring = pouring;
  }

  // Free for a typing burst or an ack: not in an idle, not talking, not moving
  idle(p, now) { return !p.fidget && !p.call && !p.mouth && !p.task && !p.queue?.length && now >= (p.busyTill ?? 0); }

  // Sounds for the idle clip someone is playing, on the clip's own clock
  follow(p, now) {
    const f = p.fidget;
    let s = this.seen.get(p);
    if (f && s?.f !== f) {
      s = { f, done: {} };
      this.seen.set(p, s);
      p.typingBus?.gain.setTargetAtTime(0, now, 0.05);   // hands off the keyboard
      if (Math.random() < 0.2) this.creak(now, p);
      if (p.ackWanted && f.name.startsWith('mouse')) { s.ack = true; p.ackWanted = false; }   // this one acks the alarms
      // a radio reply he makes unprompted (cast.js, 1 in 8 idles): give it its sound too
      if (f.radio && !f.radio.opts?.onKey) f.radio.opts = { ...f.radio.opts, ...this.replyHooks(p) };
    }
    if (!f || !s || s.f !== f) return;
    const at = (k, t, fn) => { if (!s.done[k] && f.t >= t) { s.done[k] = true; fn(); } };
    if (f.name.startsWith('sip')) {
      at('slurp', SIP.slurp, () => this.slurp(now, p));
      at('down', SIP.down, () => this.cupDown(now, p));
    } else if (f.name.startsWith('mouse')) {
      at('on', MOUSE.on, () => this.mouse(now, p, MOUSE.off - MOUSE.on, s.ack));
    }
    // An alarm waiting to be acked: the next mouse idle is the ack
    if (p.ackWanted && !p.fidget) { p.forceIdle = 'mouse'; p.fidgetAt = 0; }
  }

  // ------------------------------------------------------------ where a sound is
  // Left/right and distance from the camera: a sip across the room is quieter
  place(p, fixedPan = 0) {
    const ctx = this.ctx, g = ctx.createGain(), pan = ctx.createStereoPanner?.();
    let level = 1, x = fixedPan;
    if (p?.root && this.camera) {
      const v = p.root.getWorldPosition(this.v).applyMatrix4(this.camera.matrixWorldInverse);
      const d = Math.hypot(v.x, v.y, v.z);
      x = Math.max(-0.8, Math.min(0.8, v.x / (Math.abs(v.x) + Math.max(0.5, -v.z))));
      level = Math.min(1.2, 2.2 / (1 + d));
    }
    g.gain.value = level;
    if (pan) { pan.pan.value = x; g.connect(pan).connect(this.fx); } else g.connect(this.fx);
    return g;
  }

  onScreen(p) {
    const v = p.root.getWorldPosition(this.v).project(this.camera);
    return v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
  }

  // ------------------------------------------------------------ building blocks
  noise(sec = 2, brown = false) {
    const key = `${brown}${sec}`;
    this.noiseBufs ??= {};
    if (this.noiseBufs[key]) return this.noiseBufs[key];
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let w = 0;
    for (let i = 0; i < n; i++) { const r = Math.random() * 2 - 1; if (brown) { w = (w + 0.02 * r) / 1.02; d[i] = w * 3.5; } else d[i] = r; }
    return (this.noiseBufs[key] = b);
  }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  // A short knock of filtered noise (sound.js's tick, to our own output)
  tick(t, f, level, len, q, dest) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * len), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
    const s = ctx.createBufferSource(); s.buffer = b;
    s.connect(this.filt('bandpass', f, q)).connect(this.gain(level)).connect(dest);
    s.start(t);
  }
  tone(t, f, dur, level, type, dest) {
    const o = this.ctx.createOscillator(), g = this.gain(0);
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.setValueAtTime(level, t + dur - 0.015); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.1);
  }
  hiss(t, dur, f, q, level, dest, brown = false) {
    const s = this.ctx.createBufferSource(), g = this.gain(0);
    s.buffer = this.noise(2, brown); s.loop = true;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + Math.min(0.02, dur / 3));
    g.gain.setValueAtTime(level, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(this.filt('bandpass', f, q)).connect(g).connect(dest);
    s.start(t); s.stop(t + dur + 0.05);
  }
  async file(f, t, dest, level) {
    const b = await this.load(f);
    if (!b) return null;
    const s = this.ctx.createBufferSource(), g = this.gain(level);
    s.buffer = b; s.connect(g).connect(dest); s.start(Math.max(t, this.ctx.currentTime));
    return { s, g };
  }

  // ------------------------------------------------------------ the sounds
  // The generators below deck: a low rumble that breathes slowly, under the
  // aircon of roomControls.js; the turbine whine kept very faint (Adriaen)
  bed() {
    const ctx = this.ctx, r = ctx.createBufferSource(), rg = this.gain(0.9), wob = ctx.createOscillator(), wg = this.gain(0.25);
    r.buffer = this.noise(4, true); r.loop = true;
    wob.frequency.value = 0.11; wob.connect(wg).connect(rg.gain);
    r.connect(this.filt('lowpass', 75)).connect(rg).connect(this.out);
    const tone = ctx.createOscillator(), whine = ctx.createOscillator();
    tone.frequency.value = 31; tone.connect(this.gain(0.012)).connect(this.out);
    whine.frequency.value = 3020; whine.connect(this.gain(0.0002)).connect(this.out);
    for (const o of [r, wob, tone, whine]) o.start();
  }

  // The mouse idle: the hand slides the mouse about, a click or two, sometimes the wheel.
  // With `ack`, the click acknowledges the SAS alarms: the station's blip answers it.
  mouse(t, p, dur, ack) {
    const d = this.place(p);
    this.hiss(t, dur, 2600, 0.6, 0.012, d);
    const clicks = ack ? 1 : Math.random() < 0.3 ? 2 : 1;
    for (let k = 0; k < clicks; k++) {
      const c = t + R(0.4, 0.9) + k * R(0.5, 1.2);
      this.tick(c, 3200, 0.35, 0.025, 1.6, d); this.tick(c + 0.07, 2600, 0.2, 0.02, 1.6, d);
      if (ack) this.tone(c + 0.12, 880, 0.06, 0.02, 'sine', d);
    }
    if (!ack && Math.random() < 0.35) {
      const w = t + R(1.2, 2), n = Math.floor(R(5, 11));
      for (let k = 0; k < n; k++) this.tick(w + k * R(0.03, 0.05), 4200, 0.09, 0.008, 3, d);
    }
  }

  // One of Adriaen's recorded slurps, while the mug is at the mouth
  slurp(t, p) { this.file(SLURPS[Math.floor(Math.random() * SLURPS.length)], t, this.place(p), 0.5); }
  // A yawn (CC0 recordings, Adriaen), quiet: someone off screen
  yawn(t, p) { this.file(YAWNS[Math.floor(Math.random() * YAWNS.length)], t, this.place(p), 0.3); }
  // The mug back on the desk: a dull ceramic knock, no ring
  cupDown(t, p) { const d = this.place(p); this.tick(t, 220, 0.5, 0.07, 1, d); this.tick(t + 0.004, 900, 0.08, 0.02, 1.5, d); }

  creak(t, p) {
    const o = this.ctx.createOscillator(), g = this.gain(0), d = this.place(p);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(R(85, 110), t); o.frequency.linearRampToValueAtTime(R(130, 170), t + 0.28);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.05); g.gain.linearRampToValueAtTime(0, t + 0.32);
    o.connect(this.filt('bandpass', 750, 6)).connect(g).connect(d); o.start(t); o.stop(t + 0.4);
  }

  // A short burst of typing with pauses; an idle starting cuts it (follow())
  typing(p, t) {
    const secs = R(1.5, 4.5), bus = this.gain(1), d = this.place(p);
    bus.connect(d);
    p.typingBus = bus;
    p.busyTill = t + secs;
    let x = t + 0.05;
    while (x < t + secs) {
      const space = Math.random() < 0.15;
      this.tick(x, space ? 900 : 1700 + Math.random() * 900, space ? 0.22 : 0.11 + Math.random() * 0.07, space ? 0.045 : 0.025, 1.6, bus);
      x += 0.07 + Math.random() * 0.09 + (Math.random() < 0.08 ? R(0.25, 0.6) : 0);
    }
  }

  // SAS: 1 to 4 new alarms a few seconds apart on the operator's station
  // (three short beeps each); he acks them with his next free mouse idle
  sasBurst(p, t) {
    const d = this.place(p), lp = this.filt('lowpass', 3000);
    lp.connect(d);
    let x = t + 0.05;
    for (let k = 0, n = 1 + Math.floor(Math.random() * 4); k < n; k++) {
      for (let b = 0; b < 3; b++) this.tone(x + b * 0.2, 1250, 0.09, 0.03, 'square', lp);
      x += R(0.9, 4);
    }
    // after the last one, he's wanted at the mouse (follow()); given up after 15 s
    setTimeout(() => { p.ackWanted = true; setTimeout(() => { p.ackWanted = false; }, 15000); }, (x - t + R(1.5, 4)) * 1000);
  }

  // A radio call: squelch opens, someone talks (muffled), the tail. Half the
  // time the operator answers: with the radio reply clip (cast.radioReply) when
  // the cast has it, else just his voice over the radio
  radio(t, seated) {
    const d = this.place(null, 0.35), up = this.gain(1.5);
    up.connect(d);
    const len = R(1.4, 3.2);
    this.transmit(t + 0.05, len, up, R(105, 150));
    if (Math.random() < 0.5) return;
    const start = Math.max(0, t + len + R(0.8, 1.6) - this.ctx.currentTime) * 1000;
    setTimeout(() => {
      // whoever sits at a desk with a mic answers (the operator's chair first)
      const first = (p) => (SPOTS[p.at]?.chair === 0 ? 0 : 1), order = [...seated].sort((a, b) => first(a) - first(b));
      const names = order.map((op) => Object.keys(this.cast.people).find((k) => this.cast.people[k] === op));
      if (!names.some((who) => who && this.cast.radioReply?.(who, this.replyHooks(this.cast.people[who])))) {
        this.transmit(this.ctx.currentTime, R(0.8, 1.6), up, R(100, 140));   // someone off screen
      }
    }, start);
  }
  // His side of the radio while the reply clip plays (cast.js radioing):
  // the button's squelch, the same muffled blabla as the calls (Adriaen: no
  // real lines unless a story beat needs one), the tail as he lets go
  replyHooks(p) {
    const d = this.place(p), up = this.gain(1.5), now = () => this.ctx.currentTime;
    up.connect(d);
    return {
      onKey: () => this.squelch(now(), up, 0.06),
      onTalk: (secs) => this.transmit(now(), secs, up, R(100, 140), { open: false, tail: false }),
      onDone: () => this.squelch(now(), up, 0.08, 0.18),
    };
  }
  squelch(t, dest, level, dur = 0.07) { this.hiss(t, dur, 1800, 0.8, level, dest); }
  transmit(t, len, dest, f0, { open = true, tail = true } = {}) {
    if (open) this.squelch(t, dest, 0.07);
    this.hiss(t + 0.05, len + 0.1, 1800, 0.5, 0.012, dest);
    this.mumble(t + 0.1, len, this.radioChain(dest, 0.05), f0);
    if (tail) this.squelch(t + len + 0.15, dest, 0.09, 0.2);
  }
  radioChain(dest, level) {
    const hp = this.filt('highpass', 380), ws = this.ctx.createWaveShaper();
    const c = new Float32Array(256);
    for (let i = 0; i < 256; i++) c[i] = Math.tanh((i / 128 - 1) * 3);
    ws.curve = c;
    hp.connect(ws).connect(this.filt('lowpass', 2700)).connect(this.gain(level)).connect(dest);
    return hp;
  }
  // A muffled voice: a buzz through two formants that jump each syllable
  mumble(t, dur, dest, f0) {
    const o = this.ctx.createOscillator(), f1 = this.filt('bandpass', 500, 5), f2 = this.filt('bandpass', 1500, 7), env = this.gain(0);
    o.type = 'sawtooth';
    o.connect(f1).connect(this.gain(1)).connect(env); o.connect(f2).connect(this.gain(0.6)).connect(env); env.connect(dest);
    o.frequency.setValueAtTime(f0, t);
    for (let x = t; x < t + dur;) {
      const syl = R(0.09, 0.22), lvl = Math.random() < 0.12 ? 0 : R(0.5, 1);
      o.frequency.setTargetAtTime(f0 * R(0.85, 1.25), x, 0.03);
      f1.frequency.setTargetAtTime(R(300, 850), x, 0.02); f2.frequency.setTargetAtTime(R(900, 2300), x, 0.02);
      env.gain.setTargetAtTime(lvl, x, 0.015); env.gain.setTargetAtTime(lvl * 0.3, x + syl * 0.7, 0.02);
      x += syl + (Math.random() < 0.1 ? R(0.1, 0.3) : 0);
    }
    env.gain.setTargetAtTime(0, t + dur, 0.02);
    o.start(t); o.stop(t + dur + 0.2);
  }

  // Coffee from the jug into the mug (Adriaen's CC0 recording), for as long as it runs
  async pour(t) {
    const p = Object.values(this.cast.people).find((x) => x.carry === 'jug') ?? null;
    this.pourSrc = await this.file('pour.mp3', t, this.place(p, 0.2), 0.35);
  }
  pourEnd(t) {
    const s = this.pourSrc;
    this.pourSrc = null;
    if (!s) return;
    s.g.gain.setTargetAtTime(0, t + 0.15, 0.15);
    s.s.stop(t + 1.2);
  }
}
