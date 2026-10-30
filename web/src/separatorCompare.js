// Two separator simulations run side by side on the same well stream, with
// trend history and a trend painter for any 2D canvas. Used by the sim lab and
// the re-tuning beat in story mode.
//
//   const cmp = new SeparatorCompare('tuning');   // a = old tuning, b = new tuning
//   cmp.slugging = true;  cmp.step(dt);            // each frame (call more times for 3x)
//   cmp.b.apply(sep);                              // drive the 3D vessel with either side
//   drawTrend(canvas, cmp, cmp.trends[0]);         // or loop over cmp.trends
//
// 'model' compares the simple level-only sim (a) with the mass-balance one (b).
import { makeSeparatorSim, slugFeed } from './separatorSim.js';

export const COMPARE = {
  tuning: { a: 'Old tuning', b: 'New tuning' },
  model: { a: 'Old model', b: 'New model' },
};
const COL = { a: '#9fb3ba', b: '#f2b544', act: '#7dffa8', sp: 'rgba(238,243,244,0.45)', band: 'rgba(242,181,68,0.14)', bandA: 'rgba(159,179,186,0.7)', grid: 'rgba(238,243,244,0.1)' };

export class SeparatorCompare {
  constructor(kind = 'tuning', { span = 240, rate = 4 } = {}) {
    this.kind = kind; this.span = span; this.rate = rate;
    this.names = COMPARE[kind];
    if (kind === 'model') { this.a = makeSeparatorSim('simple'); this.b = makeSeparatorSim('mass'); }
    else { this.a = makeSeparatorSim('mass'); this.b = makeSeparatorSim('mass'); this.a.oilControl('gap-old'); this.b.oilControl('gap'); }
    this.slugging = false; this.period = 80; this.hist = []; this.sampleT = 0; this.surge = false;
    const ref = this.b; // the mass sim knows the instrument ranges
    const pct = (s) => ref.pct(s.hO, ref.range.oil);
    this.trends = [
      { title: 'Pressure, barg', lo: 6, hi: 11, key: 'P', sp: () => ref.sp.P },
      { title: 'Oil compartment level, %', lo: 0, hi: 100, key: 'oil', sp: () => ref.spPct('oil'), bands: true },
      { title: 'Oil valve position, %', lo: 0, hi: 100, key: kind === 'model' ? 'u' : 'z', actual: kind === 'model' ? 'z' : null },
      { title: 'Oil in water, ppm', lo: 0, hi: 1500, key: 'oiw' },
    ];
    this.sample = (s) => ({ P: s.P, oil: pct(s), u: s.u.oil * 100, z: s.z ? s.z.oil * 100 : null, oiw: s.oiw ?? null });
  }
  sims() { return [this.a, this.b]; }
  slug(size) { for (const s of this.sims()) s.slug(size); }
  step(dt) {
    if (!(dt > 0)) return;
    if (this.slugging) {
      const f = slugFeed(this.b.t, this.period), surge = f > 1.2;
      for (const s of this.sims()) {
        s.feed = f;
        if (surge && !this.surge) s.packets.push({ x: s.source, v: 3.2, a: 0.16 }); // a wave at each surge front
      }
      this.surge = surge;
    } else if (this.a.feed !== 1) for (const s of this.sims()) s.feed = 1;
    for (const s of this.sims()) s.step(dt);
    if ((this.sampleT += dt) >= 1 / this.rate) {
      this.sampleT = 0;
      this.hist.push({ a: this.sample(this.a), b: this.sample(this.b) });
      if (this.hist.length > this.span * this.rate) this.hist.shift();
    }
  }
}

/** Paint one trend of `cmp` on a 2D canvas (sized in device pixels): a dashed, b solid. */
export function drawTrend(canvas, cmp, tr, d = globalThis.devicePixelRatio ?? 1) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, top = 16 * d, bot = H - 4 * d;
  g.clearRect(0, 0, W, H);
  const y = (v) => Math.max(top, Math.min(bot, bot - ((v - tr.lo) / (tr.hi - tr.lo)) * (bot - top)));
  const x = (i) => (i / (cmp.span * cmp.rate - 1)) * W;
  g.fillStyle = COL.grid; for (let k = 0; k <= 4; k++) g.fillRect(0, top + ((bot - top) * k) / 4, W, d);
  if (tr.bands) {
    const sp = tr.sp();
    const band = (s) => s.ctl?.oil?.gap;
    const gb = band(cmp.b), ga = band(cmp.a);
    if (gb) { g.fillStyle = COL.band; g.fillRect(0, y(sp + gb.width), W, y(sp - gb.width) - y(sp + gb.width)); }
    if (ga && cmp.kind === 'tuning') {
      g.strokeStyle = COL.bandA; g.lineWidth = d; g.setLineDash([2 * d, 3 * d]);
      for (const v of [sp + ga.width, sp - ga.width]) { g.beginPath(); g.moveTo(0, y(v)); g.lineTo(W, y(v)); g.stroke(); }
      g.setLineDash([]);
    }
  }
  if (tr.sp) { g.fillStyle = COL.sp; g.fillRect(0, y(tr.sp()), W, d); }
  const line = (side, key, col, dash, width) => {
    g.strokeStyle = col; g.lineWidth = width * d; g.setLineDash(dash ? [4 * d, 3 * d] : []);
    g.beginPath(); let on = false;
    cmp.hist.forEach((h, i) => { const v = h[side][key]; if (v == null) { on = false; return; } on ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); on = true; });
    g.stroke();
  };
  line('a', tr.key, COL.a, true, 1.6);
  if (tr.actual) { line('b', tr.key, COL.b, false, 1); line('b', tr.actual, COL.act, false, 1.6); }
  else line('b', tr.key, COL.b, false, 1.8);
  g.setLineDash([]);
  g.fillStyle = '#eef3f4'; g.font = `500 ${10.5 * d}px Instrument Sans, system-ui, sans-serif`; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(tr.title, 0, 2 * d);
  const range = `${tr.lo}–${tr.hi}`;
  g.fillStyle = '#9fb3ba'; g.textAlign = 'right';
  if (g.measureText(tr.title).width + g.measureText(range).width + 12 * d < W) g.fillText(range, W, 2 * d);
  g.textAlign = 'left';
}
