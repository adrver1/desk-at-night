// Mass-balance separator model, a drop-in for SeparatorSim (same API, same
// visuals: slugs, wave packets, weir ripple, stirring all come from there).
//
//   const sim = makeSeparatorSim('mass' | 'simple');
//   sim.step(dt); sim.apply(sep);
//
// What it adds over the simple model (textbook equations, generic numbers):
//   - four volume/mass states: water and oil in the separation section, oil in
//     the oil compartment, gas mass in the shared gas space
//   - pressure from the ideal gas law: liquid rising in the vessel squeezes the
//     gas, so a slug lifts the pressure until the gas valve catches up
//   - valves sized like control valves (ISA): flow ~ Cv · f(opening) · sqrt(dP),
//     dP = vessel pressure + liquid head - downstream pressure
//   - valve stroke time: the controller commands, the actuator follows at a
//     fixed travel speed (sim.u = command, sim.z = actual position)
//   - ISA PIDF controllers (filtered D, back-calculation anti-windup, output
//     rate limit, bumpless manual/auto) on pressure, interface and oil level
//   - a gap controller for the oil level: low gain inside a band around the
//     set point, high gain outside it (averaging level control that rides out
//     slugs and still pulls hard on big excursions)
//   - quality estimates: oil in water (ppm) and water in oil (%) from Stokes
//     settling against residence time, liquid carry-over in the gas from the
//     Souders-Brown velocity
//
// The process runs on game time (a slug passes in seconds), so stroke times and
// controller tunings are compressed to match; the ratios are what matter.
import * as THREE from 'three';
import { SeparatorSim, DIM, chord } from './separator.js';

const RI = DIM.R - DIM.T, G = 9.81, R_GAS = 8.314, ATM = 1.013e5, BAR = 1e5;
const K_ISA = 2.4023e-5; // W[kg/s] = K · Cv[USgpm/sqrt(psi)] · sqrt(rho[kg/m3] · dP[Pa])
const clamp = THREE.MathUtils.clamp;
const abs = (barg) => barg * BAR + ATM, barg = (pa) => (pa - ATM) / BAR;

/** Wetted cross-section below height y (y = 0 on the axis) in the vessel. */
export function segArea(y) {
  const h = clamp(y + RI, 0, 2 * RI), th = Math.acos(clamp((RI - h) / RI, -1, 1));
  return RI * RI * (th - Math.sin(th) * Math.cos(th));
}
/** Height whose wetted cross-section is `a` (Newton from a guess, a few steps). */
export function heightOf(a, guess = 0) {
  a = clamp(a, 0, Math.PI * RI * RI);
  let y = clamp(guess, -RI + 1e-3, RI - 1e-3);
  for (let i = 0; i < 6; i++) {
    const err = segArea(y) - a;
    if (Math.abs(err) < 1e-7) break;
    y = clamp(y - err / chord(y), -RI + 1e-4, RI - 1e-4);
  }
  return y;
}

/**
 * ISA PIDF on percent signals: pv, sp and the output all in 0..100.
 * Direct acting (error = pv - sp: a rising level or pressure opens its valve).
 * gap: { width, blend, kpOut } turns it into a gap controller (kp inside the
 * band |e| <= width, kpOut beyond width + blend, linear in between).
 */
export class PIDF {
  constructor({ kp = 1, ti = 60, td = 0, tf = 2, roc = 0, gap = null } = {}) {
    Object.assign(this, { kp, ti, td, tf, roc, gap });
    this.I = 50; this.ePrev = null; this.dF = 0; this.out = 50; this.zone = 'inside';
  }
  gain(e) {
    const g = this.gap;
    if (!g) return this.kp;
    const a = Math.abs(e);
    if (a <= g.width) { this.zone = 'inside'; return this.kp; }
    if (a >= g.width + g.blend) { this.zone = 'outside'; return g.kpOut; }
    this.zone = 'blend';
    return this.kp + ((a - g.width) / Math.max(g.blend, 1e-9)) * (g.kpOut - this.kp);
  }
  step(pv, sp, dt) {
    const e = pv - sp, kp = this.gain(e);
    const dRaw = this.ePrev == null ? 0 : (e - this.ePrev) / dt;
    this.dF += (dRaw - this.dF) * (this.tf > 0 ? dt / (this.tf + dt) : 1);
    this.ePrev = e;
    const raw = kp * e + this.I + kp * this.td * this.dF;
    let out = clamp(raw, 0, 100);
    if (this.roc > 0) out = clamp(out, this.out - this.roc * dt, this.out + this.roc * dt);
    // integral in output units, with back-calculation when the output is clamped
    const tt = Math.sqrt(this.ti * Math.max(this.td, this.tf, 1));
    if (this.ti > 0) this.I += dt * ((kp * e) / this.ti + (out - raw) / tt);
    this.out = out;
    return out;
  }
  /** Manual mode: follow the operator's output so the switch back to auto is bumpless. */
  track(out, pv, sp) {
    const e = pv - sp;
    this.I = out - this.gain(e) * e; this.ePrev = e; this.dF = 0; this.out = out;
  }
}

/**
 * Oil level controller settings (gains %/%, times in game seconds).
 * 'gap' is the re-tuned gap controller: a wide band that lets the level use the
 * compartment as a buffer so the outflow stays nearly constant, with enough gain
 * inside the band to keep authority. 'gap-old' is the tuning it replaces: a
 * narrow band with a weak gain inside, hard switch at its edges; under sustained
 * slugging the level rides the band edges and the gain flips back and forth
 * (saw-tooth level, jumpy outflow).
 */
export const OIL_TUNINGS = {
  gap: { kp: 0.6, ti: 300, gap: { width: 20, blend: 6, kpOut: 2.5 } },
  'gap-old': { kp: 0.5, ti: 300, gap: { width: 5, blend: 0, kpOut: 2.5 } },
  tight: { kp: 4, ti: 30, gap: null },
  averaging: { kp: 0.6, ti: 90, gap: null },
};

/**
 * Sustained slugging, as a well-stream multiplier for sim.feed: liquid surges of
 * `high` x normal for 35 % of each period, a lean stream in between, mean 1.
 */
export function slugFeed(t, period = 80, high = 1.8) {
  const on = 0.35 * period, low = (1 - 0.35 * high) / 0.65, u = ((t % period) + period) % period;
  const s = (x) => 1 / (1 + Math.exp(-x)), edge = 0.75; // ~3 s ramps
  return low + (high - low) * (s((u - 1.5) / edge) - s((u - on) / edge));
}

export class SeparatorSimMass extends SeparatorSim {
  constructor() {
    super();
    this.model = 'mass';
    // fluids (generic light crude, produced water, lean gas)
    this.rho = { oil: 850, water: 1025 };
    this.mu = { oil: 5e-3, water: 0.45e-3 }; // Pa·s at ~66 °C
    this.Mgas = 0.021; this.Tgas = 273.15 + 66; // kg/mol, K
    this.baseGas = 7; // kg/s normal gas in the well stream
    this.drop = { oil: 180e-6, water: 600e-6 }; // droplet sizes leaving the inlet device, m
    this.inletQ = { oiw: 1500, wio: 12 }; // ppm oil in the water, % water in the oil at the inlet
    this.ksb = 0.12; // Souders-Brown K, m/s
    // set points and instrument ranges
    this.sp.P = 8; // barg
    this.range = { P: [0, 16], water: [-1.4, -0.1], oil: [-1.4, DIM.crest - 0.05] };
    this.down = { gas: abs(5.5), oil: abs(3), water: abs(1) }; // pressure after each valve
    this.stroke = { gas: 6, oil: 8, water: 8 }; // s for full travel
    // controllers (gains in %/%, times in s)
    this.ctl = {
      gas: new PIDF({ kp: 4, ti: 20 }),
      water: new PIDF({ kp: 3, ti: 25 }),
      oil: new PIDF(OIL_TUNINGS.gap),
    };
    this.manualOut.gas = null;
    // states, from the levels the simple model starts at and the set pressure
    this.Vw = segArea(this.hW) * this.lsep;
    this.Vo = (segArea(this.hL) - segArea(this.hW)) * this.lsep;
    this.Vb = segArea(this.hO) * this.loil;
    this.Vtot = Math.PI * RI * RI * (this.lsep + this.loil);
    this.mg = this.gasMass(abs(this.sp.P));
    this.P = this.sp.P;
    // size the valves like the simple model: full open passes qmax at the normal dP,
    // so normal flow sits near 25 % open and a big slug saturates them
    const p0 = abs(this.sp.P), rg0 = this.mg / this.gasVolume();
    this.cv = {
      water: this.qmax.water / (K_ISA * Math.sqrt(this.dpWater(p0) / this.rho.water)),
      oil: this.qmax.oil / (K_ISA * Math.sqrt(this.dpOil(p0) / this.rho.oil)),
      gas: (this.baseGas / 0.4) / Math.sqrt(rg0 * (p0 - this.down.gas)), // m², normal near 40 % open
    };
    this.u.gas = 0.4;
    this.z = { ...this.u };
    this.wGas = this.baseGas; this.qWover = 0;
    this.oiw = 0; this.wio = 0; this.carry = 0; this.sbRatio = 0; this.tau = { water: 0, oil: 0 };
    for (const k of ['gas', 'water', 'oil']) this.ctl[k].track(this.u[k] * 100, this.pv(k), this.spPct(k));
    this.oilMode = 'gap';
    this.quality(1e3, this.base.water, this.base.oil); // start at the steady-state quality
  }

  gasVolume() { return Math.max(0.5, this.Vtot - this.Vw - this.Vo - this.Vb); }
  gasMass(pAbs) { return (pAbs * this.Mgas * this.gasVolume()) / (R_GAS * this.Tgas); }
  dpWater(pAbs) { return pAbs + this.rho.water * G * (this.hW + RI) - this.down.water; }
  dpOil(pAbs) { return pAbs + this.rho.oil * G * (this.hO + RI) - this.down.oil; }
  char(u) { return this.valve === 'eqp' ? (u > 0 ? 30 ** (u - 1) : 0) : u; }
  pct(v, [lo, hi]) { return (100 * (v - lo)) / (hi - lo); }
  pv(loop) { return loop === 'gas' ? this.pct(this.P, this.range.P) : this.pct(loop === 'water' ? this.hW : this.hO, this.range[loop]); }
  spPct(loop) { return loop === 'gas' ? this.pct(this.sp.P, this.range.P) : this.pct(loop === 'water' ? this.sp.interface : this.sp.bucket, this.range[loop]); }

  /** Oil level control, one of OIL_TUNINGS: 'gap' (default), 'gap-old', 'tight' or 'averaging'. */
  oilControl(kind) {
    const c = this.ctl.oil;
    Object.assign(c, OIL_TUNINGS[kind] ?? OIL_TUNINGS.gap);
    c.track(c.out, this.pv('oil'), this.spPct('oil'));
    this.oilMode = kind;
  }
  /** Loop 'gas', 'water' or 'oil' to manual, valve commanded to `opening` (0..1). */
  manual(loop, opening = this.u[loop]) { this.manualOut[loop] = clamp(opening, 0, 1); }
  /** Back to automatic; bumpless because the controller tracked the manual output. */
  auto(loop) { this.manualOut[loop] = null; }

  step(dt) {
    if (!(dt > 0)) return;
    this.t += dt;
    let liq = 0, gas = 0;
    for (const s of this.slugs) {
      const u = this.t - s.t0;
      liq += s.size * 9 * Math.exp(-(((u - 3) / 2.2) ** 2));
      gas += s.size * 2 * Math.exp(-(((u - 7.5) / 2.5) ** 2));
      if (!s.waved && u > 1.8) { s.waved = true; this.packets.push({ x: this.source, v: 3.2, a: 0.22 * s.size }); }
    }
    this.slugs = this.slugs.filter((s) => this.t - s.t0 < 20);
    const well = (this.choke / 0.6) * this.feed;
    const qWin = this.base.water * (1 + liq) * well, qOin = this.base.oil * (1 + liq) * well;
    const wGin = this.baseGas * (1 + 0.8 * gas) * well;
    this.inflow = (1 + liq) * well;
    this.qGasIn = wGin;

    const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h, qWin, qOin, wGin);

    this.Tin += (66 - 0.35 * liq - this.Tin) * Math.min(1, dt / 4);
    this.qGas = this.wGas / this.baseGas;
    this.stir += (Math.min(1, liq / 5) - this.stir) * Math.min(1, dt / (liq / 5 > this.stir ? 0.8 : 6));
    this.emulsion = 0.14 + 0.18 * this.stir;
    this.quality(dt, qWin, qOin);
    for (const p of this.packets) {
      const side = Math.sign(p.x - DIM.baffleX);
      p.x += p.v * dt;
      if (DIM.baffleX != null && Math.sign(p.x - DIM.baffleX) !== side) p.a *= 0.6;
      if (p.v > 0 && p.x > DIM.weirX - 0.3) { p.v = -p.v; p.a *= 0.6; }
      if (p.v < 0 && p.x < -DIM.L / 2 - 0.2) { p.v = -p.v; p.a *= 0.6; }
      p.a *= Math.exp(-dt / 9);
    }
    this.packets = this.packets.filter((p) => Math.abs(p.a) > 0.004);
  }

  substep(dt, qWin, qOin, wGin) {
    // levels and pressure from the states
    this.hW = heightOf(this.Vw / this.lsep, this.hW);
    this.hL = heightOf((this.Vw + this.Vo) / this.lsep, this.hL);
    this.hO = heightOf(this.Vb / this.loil, this.hO);
    const Vg = this.gasVolume(), pAbs = (this.mg * R_GAS * this.Tgas) / (this.Mgas * Vg);
    this.P = barg(pAbs); this.rhoGas = this.mg / Vg;

    // controllers -> commands -> actuators (stroke time)
    for (const k of ['gas', 'water', 'oil']) {
      const c = this.ctl[k], pv = this.pv(k), sp = this.spPct(k), man = this.manualOut[k];
      if (man != null) { this.u[k] = man; c.track(man * 100, pv, sp); } else this.u[k] = c.step(pv, sp, dt) / 100;
      this.z[k] += clamp(this.u[k] - this.z[k], -dt / this.stroke[k], dt / this.stroke[k]);
    }

    // flows
    const head = this.hL + this.waves(DIM.weirX - 0.15) - DIM.crest;
    this.head = Math.max(0, head);
    const crestW = chord(DIM.crest);
    this.qOver = head > 0 ? 1.84 * crestW * head ** 1.5 : 0;
    // water carry-over: only when the interface climbs over the crest (abnormal)
    this.qWover = this.hW > DIM.crest ? 1.84 * crestW * (this.hW - DIM.crest) ** 1.5 : 0;
    if (this.hO > DIM.crest - 0.03) this.qOver = Math.min(this.qOver, this.qOout ?? 0); // compartment full: the weir drowns
    this.qWout = this.z.water > 0 ? K_ISA * this.cv.water * this.char(this.z.water) * Math.sqrt(Math.max(0, this.dpWater(pAbs)) / this.rho.water) : 0;
    this.qOout = this.z.oil > 0 ? K_ISA * this.cv.oil * this.char(this.z.oil) * Math.sqrt(Math.max(0, this.dpOil(pAbs)) / this.rho.oil) : 0;
    this.wGas = this.cv.gas * this.z.gas * Math.sqrt(Math.max(0, this.rhoGas * (pAbs - this.down.gas)));

    // balances (an empty compartment can't pass more than it gets)
    const wMin = segArea(-RI + 0.05);
    this.Vw += (qWin - this.qWout - this.qWover) * dt;
    this.Vo += (qOin - this.qOver) * dt;
    this.Vb += (this.qOver + this.qWover - this.qOout) * dt;
    this.mg += (wGin - this.wGas) * dt;
    this.Vw = clamp(this.Vw, wMin * this.lsep, segArea(RI - 0.3) * this.lsep);
    this.Vo = clamp(this.Vo, (segArea(this.hW + 0.05) - segArea(this.hW)) * this.lsep, segArea(RI - 0.1) * this.lsep - this.Vw);
    this.Vb = clamp(this.Vb, wMin * this.loil, segArea(DIM.crest - 0.02) * this.loil);
    this.mg = Math.max(this.mg, 1);
  }

  quality(dt, qWin, qOin) {
    const dRho = this.rho.water - this.rho.oil;
    const vOil = (this.drop.oil ** 2 * dRho * G) / (18 * this.mu.water); // oil drops rising through the water
    const vWat = (this.drop.water ** 2 * dRho * G) / (18 * this.mu.oil); // water drops sinking through the oil
    const hw = Math.max(0.05, this.hW + RI), ho = Math.max(0.03, this.hL - this.hW);
    this.tau = { water: this.Vw / Math.max(qWin, 1e-4), oil: this.Vo / Math.max(qOin, 1e-4) };
    // fraction separated: settling distance in the residence time against the layer depth
    const effO = 1 - Math.exp(-(vOil * this.tau.water) / hw), effW = 1 - Math.exp(-(vWat * this.tau.oil) / ho);
    const wioOver = this.inletQ.wio * (1 - effW);
    const wio = (100 * this.qWover + wioOver * this.qOver) / Math.max(this.qWover + this.qOver, 1e-4);
    // what leaves the outlets lags what happens at the interface
    const k = Math.min(1, dt / 3);
    if (this.rhoGas == null) this.rhoGas = this.mg / this.gasVolume();
    this.oiw += (this.inletQ.oiw * (1 - effO) - this.oiw) * k;
    this.wio += (wio - this.wio) * k;
    // Souders-Brown: gas velocity along the vessel against the critical velocity
    const aGas = Math.max(0.05, Math.PI * RI * RI - segArea(this.hL));
    const vGas = this.wGas / Math.max(this.rhoGas, 0.1) / aGas;
    const vCrit = this.ksb * Math.sqrt(Math.max(0, (this.rho.oil - this.rhoGas) / this.rhoGas));
    this.sbRatio = vGas / vCrit;
    this.carry += (clamp((this.sbRatio - 1) * 0.5, 0, 0.05) - this.carry) * k;
  }

  apply(sep) {
    super.apply(sep);
    const v = sep.valves;
    for (const k of ['gas', 'water', 'oil']) { v[k].speed = 1e3; v[k].set(this.z[k]); } // the actuator lag is in the sim
  }
}

/** 'mass' (default): SeparatorSimMass; 'simple': the original level-only SeparatorSim. */
export function makeSeparatorSim(model = 'mass') {
  return model === 'simple' ? new SeparatorSim() : new SeparatorSimMass();
}
