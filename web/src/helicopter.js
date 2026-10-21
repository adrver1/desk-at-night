// The parked helicopter's moving parts (blender/helicopter.py): rotors that
// spool up and down, and landing gear that retracts. At speed the blades
// fade into see-through blur discs with the blade tip colours as rings,
// which reads better than turning the blades fast: at 290 rpm they would
// strobe, worst of all on a CCTV picture taken a few times a second.
import * as THREE from 'three';

const MAIN_RPM = 290, TAIL_RATIO = 5.4;
const SPOOL = 9;    // seconds from stopped to flight speed
const GEAR_TIME = 4; // seconds for the gear to travel
const PARTS = ['MainRotor', 'TailRotor', 'MainDisc', 'TailDisc', 'NoseGear', 'MainGearL', 'MainGearR'];

// Radial streak texture: rings of [inner, outer, colour, alpha] as fractions of the radius
function discTexture(bands) {
  const n = 256, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d'), c = n / 2;
  for (const [r0, r1, col, a] of bands) {
    g.beginPath();
    g.arc(c, c, r1 * c, 0, Math.PI * 2);
    g.arc(c, c, r0 * c, 0, Math.PI * 2, true);
    g.fillStyle = col;
    g.globalAlpha = a;
    g.fill('evenodd');
  }
  // Thin gaps so the disc shimmers as it drifts round
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 90; i++) {
    const t = Math.random() * Math.PI * 2;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, t, t + 0.004 + Math.random() * 0.01);
    g.closePath();
    g.fillStyle = `rgba(0,0,0,${0.5 * Math.random()})`;
    g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const MAIN_DISC = [[0.07, 0.94, '#2a2c30', 0.17], [0.94, 1.0, '#d9a514', 0.45]];
const TAIL_DISC = [[0.10, 0.41, '#eceeee', 0.2], [0.41, 0.62, '#d8261c', 0.26], [0.62, 0.79, '#eceeee', 0.22], [0.79, 1.0, '#d8261c', 0.3]];

export class Helicopter {
  // root: the glTF node holding the Heli* parts (the scene, or any parent)
  constructor(root, { running = false, gearDown = true } = {}) {
    this.parts = {};
    root.traverse((o) => {
      for (const k of PARTS) if (o.name.startsWith('Heli' + k)) this.parts[k] ??= o;
    });
    this.ok = PARTS.every((k) => this.parts[k]);
    if (!this.ok) return;
    // The rotors share materials with the body in the file; give them their own to fade
    for (const k of ['MainRotor', 'TailRotor']) {
      this.parts[k].traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    }
    for (const [k, bands] of [['MainDisc', MAIN_DISC], ['TailDisc', TAIL_DISC]]) {
      const mat = new THREE.MeshBasicMaterial({ map: discTexture(bands), transparent: true, depthWrite: false,
        side: THREE.DoubleSide, opacity: 0, fog: true });
      this.parts[k].traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.renderOrder = 2; } });
    }
    this.running = running;
    this.speed = running ? 1 : 0;  // 0 stopped .. 1 flight rpm
    this.gearTarget = this.gear = gearDown ? 1 : 0;
    this.angle = 0;
    this.update(0);
  }

  start() { this.running = true; }
  stop() { this.running = false; }
  setGear(down) { this.gearTarget = down ? 1 : 0; }

  get rpm() { return smooth(this.speed) * MAIN_RPM; }

  update(dt) {
    if (!this.ok) return;
    const p = this.parts;
    this.speed = THREE.MathUtils.clamp(this.speed + (this.running ? dt : -0.6 * dt) / SPOOL, 0, 1);
    this.gear += THREE.MathUtils.clamp(this.gearTarget - this.gear, -dt / GEAR_TIME, dt / GEAR_TIME);
    this.angle += (this.rpm / 60) * Math.PI * 2 * dt;
    // glTF is y-up: Blender's Z is three's y and Blender's Y is three's -z
    p.MainRotor.rotation.y = this.angle;
    p.TailRotor.rotation.z = -this.angle * TAIL_RATIO;
    p.MainDisc.rotation.y = this.angle * 0.013;
    p.TailDisc.rotation.z = -this.angle * TAIL_RATIO * 0.013;
    for (const k of ['NoseGear', 'MainGearL', 'MainGearR']) p[k].rotation.z = (1 - smooth(this.gear)) * Math.PI / 2;
    const blur = THREE.MathUtils.smoothstep(this.speed, 0.25, 0.7);
    fade(p.MainRotor, 1 - blur * 0.92);
    fade(p.TailRotor, 1 - blur * 0.95);
    fade(p.MainDisc, blur);
    fade(p.TailDisc, blur);
  }
}

const smooth = (x) => x * x * (3 - 2 * x);

function fade(obj, a) {
  obj.visible = a > 0.01;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material, solid = a >= 0.999 && !m.map; // the discs stay see-through
    if (m.transparent === solid) { m.transparent = !solid; m.needsUpdate = true; }
    m.opacity = a;
    m.depthWrite = solid;
    if (!m.map) o.castShadow = a > 0.6;
  });
}
