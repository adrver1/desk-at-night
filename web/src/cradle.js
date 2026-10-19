// Newton's cradle physics: five pendulums in one plane that collide only with
// their neighbours. Angles are in radians, positive toward the toy's +X.
//
// Each ball is an ideal pendulum (θ'' = -g/L sin θ, plus a little air drag).
// When two neighbours touch and are closing, they exchange momentum as two
// equal masses with restitution E: at E = 1 they simply swap velocities,
// which is what sends a lifted ball's swing through the row to the far end.
// E < 1 slowly bleeds the motion into the whole row swinging together, the
// way a real cradle settles.

const G = 9.81;
const DRAG = 0.12; // 1/s
const E = 0.985;
const STEP = 1 / 1000; // s; collisions need small steps
const MAX_ANGLE = 1.2;

export class Cradle {
  constructor(count, length, radius, pitch) {
    this.n = count;
    this.L = length;
    this.r = radius;
    this.pitch = pitch;
    this.theta = new Float64Array(count);
    this.omega = new Float64Array(count);
    this.held = -1; // index of the ball being dragged
    this.lead = 0; // the held ball's angle
    this.acc = 0;
  }

  reset() {
    this.theta.fill(0);
    this.omega.fill(0);
    this.held = -1;
  }

  get moving() {
    return this.held >= 0 || this.theta.some((t, i) => Math.abs(t) > 1e-4 || Math.abs(this.omega[i]) > 1e-3);
  }

  // Grab ball i and hold it at angle a. Balls on the side it moves toward
  // are pushed along with it, as they would be by a finger.
  hold(i, a) {
    this.held = i;
    this.lead = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, a));
    this.applyHold();
  }

  release(omega = 0) {
    if (this.held < 0) return;
    for (const j of this.group()) this.omega[j] = omega;
    this.held = -1;
  }

  group() {
    const i = this.held, a = this.lead, out = [i];
    if (a < 0) for (let j = i - 1; j >= 0 && this.theta[j] >= a - 1e-9; j--) out.push(j);
    if (a > 0) for (let j = i + 1; j < this.n && this.theta[j] <= a + 1e-9; j++) out.push(j);
    return out;
  }

  applyHold() {
    const i = this.held, a = this.lead;
    this.theta[i] = a;
    this.omega[i] = 0;
    // Push neighbours out of the way rather than through each other
    if (a < 0) for (let j = i - 1; j >= 0; j--) if (this.theta[j] > a) { this.theta[j] = a; this.omega[j] = 0; }
    if (a > 0) for (let j = i + 1; j < this.n; j++) if (this.theta[j] < a) { this.theta[j] = a; this.omega[j] = 0; }
  }

  step(dt) {
    this.acc += Math.min(dt, 0.05);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.tick(STEP);
    }
  }

  tick(h) {
    const k = G / this.L;
    for (let i = 0; i < this.n; i++) {
      this.omega[i] += (-k * Math.sin(this.theta[i]) - DRAG * this.omega[i]) * h;
      this.theta[i] += this.omega[i] * h;
    }
    if (this.held >= 0) this.applyHold();
    // A few sweeps let an impact travel down the whole row in one step
    for (let pass = 0; pass < this.n; pass++) {
      let hit = false;
      for (let i = 0; i < this.n - 1; i++) {
        const j = i + 1;
        const xi = i * this.pitch + this.L * Math.sin(this.theta[i]);
        const xj = j * this.pitch + this.L * Math.sin(this.theta[j]);
        if (xj - xi > 2 * this.r) continue;
        const vi = this.omega[i], vj = this.omega[j];
        if (vi <= vj) continue; // touching but not closing
        const iFixed = this.isHeld(i), jFixed = this.isHeld(j);
        if (iFixed && jFixed) continue;
        if (iFixed) this.omega[j] = vi * (1 + E) - vj * E; // bounce off a held ball
        else if (jFixed) this.omega[i] = vj * (1 + E) - vi * E;
        else {
          this.omega[i] = ((1 - E) * vi + (1 + E) * vj) / 2;
          this.omega[j] = ((1 + E) * vi + (1 - E) * vj) / 2;
        }
        hit = true;
      }
      if (!hit) break;
    }
  }

  isHeld(i) {
    return this.held >= 0 && this.group().includes(i);
  }
}
