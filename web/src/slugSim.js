// Low-order model of a slugging gas-lifted well (casing heading), after the
// three-state model of Eikrem, Aamo & Foss (2008): gas in the annulus, gas
// in the tubing and liquid in the tubing. Lift gas fills the annulus until
// it pushes through the injection valve, the column lightens, more gas goes
// in, the well blows out, the annulus empties and liquid builds up again.
// With the production choke wide open that cycle never settles; a PI loop
// on bottom-hole pressure that moves the choke a little, fast, holds it.
//
//   const sim = new SlugSim(); sim.u = 0.7; sim.auto = true; sim.step(dt)
//   sim.pbh (bar), sim.uOut (actual choke opening), sim.wOil (kg/s)
//
// Generic round numbers, not any real well. With these the well is stable
// up to about 30 % choke (BHP ~135 bar) and heads beyond that (BHP swinging
// ~100-150 bar, a cycle of ~25 min); with the PI on BHP at 110 bar it sits
// still at ~80 % open and produces ~40 % more. One sim second is one second;
// callers speed it up.

const g = 9.81, R = 8.314, M = 0.0195, T = 310, RHO_L = 760;

export const WELL = {
  La: 1500, Va: 30, // annulus length (m) and volume (m3)
  Lt: 1500, At: 0.0121, // tubing above the injection point: length (m), area (m2)
  Lr: 500, // liquid-filled tubing below the injection point (m)
  wGc: 0.35, // lift gas into the annulus (kg/s); low enough that the well heads
  Civ: 1.6e-4, Cpc: 1.1e-3, Cr: 2.4e-4, // injection valve, choke, inflow coefficients
  Pr: 160e5, Ps: 12e5, // reservoir and separator pressure (Pa)
};

export class SlugSim {
  constructor(p = {}) {
    this.p = { ...WELL, ...p };
    this.Vt = this.p.Lt * this.p.At;
    this.x = [4500, 900, 7000]; // m_ga, m_gt, m_lt (kg)
    this.u = 0.7; // manual choke opening 0..1
    this.uOut = this.u; // what the choke actually does (manual or PI)
    this.auto = false;
    this.sp = 110; // BHP setpoint (bar)
    this.kc = 0.1; this.ti = 150; // PI: opening per bar, integral time (s)
    this.iTerm = this.u;
    this.t = 0;
    this.flows(this.x, this.uOut);
  }
  flows(x, u) {
    const p = this.p, [mga, mgt, mlt] = x;
    const Pat = (R * T * mga) / (M * p.Va);
    const Pab = Pat + (mga * g * p.La) / p.Va;
    const rhoA = (M * Pab) / (R * T);
    const Vg = Math.max(this.Vt - mlt / RHO_L, 0.05 * this.Vt);
    const Ptt = (R * T * mgt) / (M * Vg);
    const rhoM = (mgt + mlt) / this.Vt;
    const Ptb = Ptt + rhoM * g * p.Lt;
    const Pbh = Ptb + RHO_L * g * p.Lr;
    const wiv = p.Civ * Math.sqrt(rhoA * Math.max(0, Pab - Ptb));
    const wpc = p.Cpc * u * Math.sqrt(rhoM * Math.max(0, Ptt - p.Ps));
    const fl = mlt / (mgt + mlt);
    const wro = p.Cr * Math.sqrt(RHO_L * Math.max(0, p.Pr - Pbh));
    Object.assign(this, { pat: Pat / 1e5, pab: Pab / 1e5, ptt: Ptt / 1e5, ptb: Ptb / 1e5, pbh: Pbh / 1e5, wiv, wpc, wOil: wpc * fl, wro });
    return [p.wGc - wiv, wiv - wpc * (1 - fl), wro - wpc * fl];
  }
  step(dt) {
    // fixed 0.5 s RK4 substeps; the controller samples once per substep
    const h = 0.5;
    for (let n = Math.max(1, Math.round(dt / h)); n--; ) {
      if (this.auto) {
        const e = this.pbh - this.sp; // BHP above setpoint: open up
        this.iTerm = Math.min(1, Math.max(0.05, this.iTerm + (this.kc * h * e) / this.ti));
        this.uOut = Math.min(1, Math.max(0.05, this.iTerm + this.kc * e));
      } else { this.uOut = this.u; this.iTerm = this.u; }
      const x = this.x, u = this.uOut, add = (a, k, s) => a.map((v, i) => Math.max(1, v + s * k[i]));
      const k1 = this.flows(x, u), k2 = this.flows(add(x, k1, h / 2), u), k3 = this.flows(add(x, k2, h / 2), u), k4 = this.flows(add(x, k3, h), u);
      this.x = x.map((v, i) => Math.max(1, v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])));
      this.t += h;
    }
    this.flows(this.x, this.uOut);
    // what the picture needs: liquid fraction in the tubing (0..1)
    this.holdup = this.x[2] / (RHO_L * this.Vt);
  }
}
