// Dial gauge (manometer style): a round face with a scale, a needle driven
// from code, a bezel and a glass. One type for pressure, temperature or flow.
//
//   const pi = new Gauge({ tag: 'PI 2001', unit: 'barg', min: 0, max: 16, red: [13, 16] });
//   scene.add(pi.group); pi.set(8.2); ... pi.update(dt) every frame
//
// The gauge faces +z, centred on its group's origin. `size` is the face
// diameter in metres (real ones are 0.1 to 0.15 m; scenes may exaggerate).
import * as THREE from 'three';

const SWEEP = (270 * Math.PI) / 180; // min at lower left, max at lower right

export class Gauge {
  constructor({ tag = '', unit = '', min = 0, max = 100, red = null, major = null, minor = 5, size = 0.5, damping = 0.35 } = {}) {
    Object.assign(this, { tag, unit, min, max, red, size, damping });
    this.major = major ?? niceStep((max - min) / 8);
    this.minor = minor;
    this.value = min; this.shown = min; this.speed = 0;
    const r = size / 2;
    this.group = new THREE.Group();
    this.group.name = `gauge ${tag}`;

    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f33, metalness: 0.7, roughness: 0.35 });
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.12, r * 1.12, r * 0.32, 40), steel);
    bezel.rotation.x = Math.PI / 2; bezel.position.z = -r * 0.16;
    this.texture = new THREE.CanvasTexture(this.drawFace());
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const face = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.6 }));
    face.position.z = 0.002;
    // needle: a long thin triangle with a short tail, pointing +y at angle 0
    const s = new THREE.Shape();
    s.moveTo(-r * 0.035, -r * 0.18); s.lineTo(0, r * 0.84); s.lineTo(r * 0.035, -r * 0.18); s.closePath();
    this.needle = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.5 }));
    this.needle.position.z = 0.012;
    const hub = new THREE.Mesh(new THREE.CircleGeometry(r * 0.07, 20), steel);
    hub.position.z = 0.016;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * 1.02, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, depthWrite: false }));
    glass.position.z = 0.03;
    this.group.add(bezel, face, this.needle, hub, glass);
    this.update(1);
  }

  /** Target value; the needle follows with a little damped overshoot. */
  set(v) { this.value = v; }

  angle(v) { return SWEEP / 2 - SWEEP * THREE.MathUtils.clamp((v - this.min) / (this.max - this.min), -0.02, 1.02); }

  update(dt) {
    // critically-ish damped spring, like a glycerine-filled gauge
    const k = 1 / Math.max(0.05, this.damping);
    const a = k * k * (this.value - this.shown) - 2 * 0.8 * k * this.speed;
    this.speed += a * Math.min(dt, 0.05);
    this.shown += this.speed * Math.min(dt, 0.05);
    this.needle.rotation.z = this.angle(this.shown);
  }

  drawFace() {
    const N = 512, c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), m = N / 2, R = N / 2 - 6;
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(m, m, R, 0, 2 * Math.PI); g.fill();
    const pos = (v, rr) => { const a = this.angle(v) + Math.PI / 2; return [m + rr * Math.cos(a), m - rr * Math.sin(a)]; };
    const arc = (v0, v1, rr, w, col) => {
      g.strokeStyle = col; g.lineWidth = w; g.beginPath();
      // canvas angles run clockwise from +x; our angle(v) runs counter-clockwise from +y
      const a0 = -(this.angle(v0) + Math.PI / 2), a1 = -(this.angle(v1) + Math.PI / 2);
      g.arc(m, m, rr, a0, a1, false); g.stroke();
    };
    if (this.red) arc(this.red[0], this.red[1], R * 0.8, R * 0.09, '#d23a2c');
    g.strokeStyle = '#1b1b1b'; g.lineCap = 'butt';
    const step = this.major / this.minor;
    for (let v = this.min, i = 0; v <= this.max + 1e-6; v = this.min + ++i * step) {
      const big = i % this.minor === 0;
      const [x0, y0] = pos(v, R * (big ? 0.72 : 0.78)), [x1, y1] = pos(v, R * 0.86);
      g.lineWidth = big ? 5 : 2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (big) {
        const [tx, ty] = pos(v, R * 0.58);
        g.fillStyle = '#1b1b1b'; g.font = `600 ${Math.round(N * 0.065)}px system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(formatTick(v), tx, ty);
      }
    }
    g.fillStyle = '#1b1b1b'; g.textAlign = 'center';
    g.font = `500 ${Math.round(N * 0.06)}px system-ui, sans-serif`; g.fillText(this.unit, m, m + R * 0.32);
    g.font = `700 ${Math.round(N * 0.065)}px system-ui, sans-serif`; g.fillText(this.tag, m, m + R * 0.62);
    return c;
  }
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x)), f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}
function formatTick(v) { return Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`; }
