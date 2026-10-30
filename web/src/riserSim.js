// Low-order model of severe slugging in a subsea flowline and riser, after
// the four-state model of Jahanshahi & Skogestad (2014, SPE-172998-PA): gas
// and liquid in the flowline, gas and liquid in the riser. Liquid collects in
// the low point at the riser base and blocks the gas, the flowline pressure
// builds until gas blows through, the riser empties in a burst and the cycle
// starts over. A PI loop on the flowline inlet pressure (the well's bottom-
// hole pressure, give or take) that moves the topside choke a little, fast,
// holds the riser still with the choke far more open than would otherwise
// be safe.
//
//   const sim = new RiserSim(); sim.u = 0.5; sim.auto = true; sim.step(dt)
//   sim.pin (bar), sim.uOut (actual choke opening), sim.wOil (kg/s)
//
// Numbers are the published OLGA test case from the paper (4.3 km flowline
// with a 1 degree dip, 300 m riser) with a straight-line inflow from a
// 100 bar reservoir. With these the riser is stable up to about 17 % choke
// (inlet ~71 bar) and slugs beyond that (inlet swinging ~63-74 bar, a cycle
// of ~10 min); with the PI holding 68 bar it sits still at ~40 % open and
// produces ~11 % more. Same interface as SlugSim, so the scene and the trends
// don't care which one runs; `pbh` is an alias for `pin`.

const g = 9.81, R = 8.314;

export const RISER = {
  rhoL: 832.2, M: 0.02, muL: 1.43e-4, muG: 1.39e-5, eps: 2.8e-5,
  Tp: 337, Dp: 0.12, Lp: 4300, theta: 1, // flowline: temperature (K), bore (m), length (m), dip (deg)
  Tr: 298.3, Dr: 0.1, Lr: 300, Lh: 100, // riser: temperature, bore, height, horizontal top section
  Ps: 50.1e5, Pnom: 74e5, wL: 8.64, wG: 0.36, // separator, nominal inlet pressure and inflows
  Kh: 0.7, Kg: 3.87e-2, Kl: 1.64e-1, Cv: 5e-3, // low-point level, riser-base gas/liquid and choke coefficients
  Pres: 100e5, PI: 3.4615e-6, // reservoir pressure (Pa) and inflow (kg/s per Pa)
};

export class RiserSim {
  constructor(p = {}) {
    const P = (this.p = { ...RISER, ...p });
    // geometry and the nominal flowline holdup the low-point level is measured from
    P.th = (P.theta * Math.PI) / 180;
    P.Ap = (Math.PI / 4) * P.Dp ** 2; P.Ar = (Math.PI / 4) * P.Dr ** 2;
    P.Vp = P.Ap * P.Lp; P.Vr = P.Ar * (P.Lr + P.Lh); P.hD = P.Dp / Math.cos(P.th);
    const rhoG = (P.Pnom * P.M) / (R * P.Tp);
    P.aL = (rhoG * P.wL) / (rhoG * P.wL + P.rhoL * P.wG);
    P.mLbar = P.rhoL * P.aL * P.Vp;
    P.hBar = P.Kh * P.hD * P.aL;
    const usl = P.wL / (P.rhoL * P.Ap), um = usl + P.wG / (rhoG * P.Ap);
    const rhoM = P.aL * P.rhoL + (1 - P.aL) * rhoG, muM = P.aL * P.muL + (1 - P.aL) * P.muG;
    const lam = 0.0056 + 0.5 * ((rhoM * um * P.Dp) / muM) ** -0.32; // Drew et al.
    P.dpFp = (lam * P.rhoL * usl * usl * P.Lp) / (2 * P.Dp);
    P.fG = P.wG / (P.wG + P.wL);

    this.x = [850, 24500, 25, 1800]; // m_Gp, m_Lp, m_Gr, m_Lr (kg)
    this.u = 0.5;
    this.uOut = this.u;
    this.auto = false;
    this.sp = 68; // inlet pressure setpoint (bar)
    this.kc = 0.2; this.ti = 60; // PI: opening per bar, integral time (s)
    this.iTerm = this.u;
    this.t = 0;
    this.flows(this.x, this.uOut);
  }
  flows(x, u) {
    const P = this.p;
    const mGp = Math.max(x[0], 0.01), mLp = Math.max(x[1], 0.01), mGr = Math.max(x[2], 0.001), mLr = Math.max(x[3], 0.001);
    // flowline gas pressure and the liquid level at the low point
    const rhoGp = mGp / Math.max(P.Vp - mLp / P.rhoL, 0.001);
    const Pin = (rhoGp * R * P.Tp) / P.M;
    const h = Math.max(0, P.hBar + ((mLp - P.mLbar) * Math.sin(P.th)) / (P.Ap * (1 - P.aL) * P.rhoL));
    const r = Math.max(0, (P.hD - h) / P.hD);
    const AG = h < P.hD ? P.Ap * r * r : 0, AL = P.Ap - AG;
    // riser
    const rhoGr = mGr / Math.max(P.Vr - mLr / P.rhoL, 0.001);
    const Prt = (rhoGr * R * P.Tr) / P.M;
    const rhoMr = (mGr + mLr) / P.Vr, aLr = mLr / (P.Vr * P.rhoL);
    const um = P.wL / (P.rhoL * P.Ar) + P.wG / (Math.max(rhoGr, 0.1) * P.Ar);
    const muM = Math.max(aLr, 0) * P.muL + Math.max(1 - aLr, 0) * P.muG;
    const Re = Math.max((rhoMr * um * P.Dr) / Math.max(muM, 1e-8), 100);
    const s = -1.8 * Math.log10(Math.max((P.eps / (3.7 * P.Dr)) ** 1.11 + 6.9 / Re, 1e-12)); // Haaland
    const dpFr = (rhoMr * um * um * (P.Lr + P.Lh)) / (s * s * 2 * P.Dr);
    // what pushes gas and liquid through the riser base
    const back = P.dpFp + Prt + rhoMr * g * P.Lr + dpFr;
    const dpG = Pin - back, dpL = Pin + P.rhoL * g * h - back;
    const wGrb = h < P.hD && dpG > 0 ? P.Kg * AG * Math.sqrt(dpG * Math.max(rhoGp, 0.1)) : 0;
    const wLrb = dpL > 0 ? P.Kl * AL * Math.sqrt(dpL * P.rhoL) : 0;
    // what reaches the choke: liquid fraction at the riser top
    const aLrb = AL / P.Ap;
    const aLrt = Math.min(1, Math.max(0, aLr <= aLrb ? aLr : 2 * aLr - aLrb));
    const rhoRt = aLrt * P.rhoL + (1 - aLrt) * rhoGr;
    const wOut = Prt > P.Ps ? P.Cv * u * Math.sqrt((Prt - P.Ps) * Math.max(rhoRt, 0.01)) : 0;
    const fl = aLrt > 0 ? (aLrt * P.rhoL) / (aLrt * P.rhoL + (1 - aLrt) * Math.max(rhoGr, 0.1)) : 0;
    const wIn = P.PI * Math.max(P.Pres - Pin, 0);
    Object.assign(this, {
      pin: Pin / 1e5, pbh: Pin / 1e5, prt: Prt / 1e5, h, aLr, aLrt,
      wGrb, wLrb, wOut, wpc: wOut, wOil: fl * wOut, wIn, wro: wIn,
    });
    return [P.fG * wIn - wGrb, (1 - P.fG) * wIn - wLrb, wGrb - (1 - fl) * wOut, wLrb - fl * wOut];
  }
  step(dt) {
    const h = 0.5;
    for (let n = Math.max(1, Math.round(dt / h)); n--; ) {
      if (this.auto) {
        const e = this.pin - this.sp; // inlet pressure above setpoint: open up
        this.iTerm = Math.min(1, Math.max(0.02, this.iTerm + (this.kc * h * e) / this.ti));
        this.uOut = Math.min(1, Math.max(0.02, this.iTerm + this.kc * e));
      } else { this.uOut = this.u; this.iTerm = this.u; }
      const x = this.x, u = this.uOut, add = (a, k, s) => a.map((v, i) => Math.max(0.001, v + s * k[i]));
      const k1 = this.flows(x, u), k2 = this.flows(add(x, k1, h / 2), u), k3 = this.flows(add(x, k2, h / 2), u), k4 = this.flows(add(x, k3, h), u);
      this.x = x.map((v, i) => Math.max(0.001, v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])));
      this.t += h;
    }
    this.flows(this.x, this.uOut);
    this.holdup = this.aLr; // liquid fraction in the riser (0..1)
  }
}
