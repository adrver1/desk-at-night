// A ship's wake on the sea: the Kelvin V (two lines of feathered waves
// spreading at 19.5° either side of the track, with transverse crests
// between them) and the white propeller wash down the middle.
//
// The wake follows the track the ship actually sailed, so it bends with the
// turns: a ribbon through the bow positions of the last few hundred metres.
// Everything is in the platform's frame (metres, z up, sea at z = 0); put the
// mesh under a group whose matrix maps that frame into the scene.
import * as THREE from 'three';

const KELVIN = Math.tan(THREE.MathUtils.degToRad(19.47));
const STEP = 4;        // metres sailed between track points
const POINTS = 110;    // so about 440 m of wake
const FADE = 150;      // seconds for an old wake to settle
const FULL_SPEED = 3;  // m/s for the full wake (about 6 knots)

const vertex = /* glsl */ `
  attribute vec3 track;   // metres behind the bow, metres off the track, speed 0..1
  attribute float age;
  varying vec3 vTrack;
  varying float vAge;
  varying float vDepth;
  void main() {
    vTrack = track;
    vAge = age;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragment = /* glsl */ `
  uniform float uKelvin;
  uniform float uLength;   // ship length: the wash starts at the stern
  uniform float uTime;
  uniform vec3 uFoam;
  uniform float uFogDensity;
  varying vec3 vTrack;
  varying float vAge;
  varying float vDepth;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    float d = vTrack.x, v = abs(vTrack.y), speed = vTrack.z;
    if (d < 0.0) discard;
    float edge = d * uKelvin;              // where the V's arms are
    float settle = exp(-vAge / ${FADE.toFixed(1)});
    float far = exp(-d / 320.0);

    // The arms: a band of short diverging crests just inside the cusp line,
    // each crest slanting back from the line, widening as it spreads
    float width = 1.5 + 0.04 * d;
    float inArm = exp(-pow((v - edge + width * 0.6) / width, 2.0));
    float crest = 0.5 + 0.5 * sin((d * 0.94 - v * 1.6) * 0.55 - uTime * 0.6);
    float arms = inArm * pow(crest, 3.0) * (0.55 + 0.45 * noise(vec2(d * 0.15, v * 0.3)));

    // Transverse crests across the track between the arms, faint
    float inside = smoothstep(edge, edge * 0.7, v) * smoothstep(0.0, 20.0, d);
    float lambda = 6.0 + 12.0 * speed;     // 2 pi U^2 / g
    float trans = inside * pow(0.5 + 0.5 * sin(6.2832 * (d + v * v / max(edge, 1.0) * 0.5) / lambda), 4.0) * 0.25;

    // The wash: churned white water behind the stern, spreading and breaking up
    float behind = d - uLength;
    float washW = 6.0 + 0.05 * max(behind, 0.0);
    float wash = smoothstep(-4.0, 4.0, behind) * exp(-pow(v / washW, 2.0)) * exp(-max(behind, 0.0) / 220.0);
    wash *= 0.6 + 0.6 * noise(vec2(d * 0.25 - uTime * 0.4, vTrack.y * 0.35));
    wash = min(wash * 1.3, 1.0);

    // Bow wave along the hull sides
    // (hugging the hull as it widens from the stem)
    float hull = min(1.0 + d * 0.6, 10.0) + d * 0.05;
    float bow = smoothstep(0.0, 3.0, d) * (1.0 - smoothstep(0.0, uLength, d)) * exp(-pow((v - hull) / (1.0 + d * 0.03), 2.0)) * 0.8;

    float strength = smoothstep(0.03, 0.5, speed);
    float a = max(max(arms * 0.9, wash), max(trans, bow)) * far * strength * settle;
    gl_FragColor = vec4(uFoam, a * exp(-uFogDensity * vDepth));
    #include <colorspace_fragment>
  }
`;

export class Wake {
  // fog: {color, density: {value}} shared with whatever else uses that fog
  constructor({ length = 88, fog } = {}) {
    this.length = length;
    this.track = [];   // {x, y, s (speed 0..1), t (time laid)}
    this.time = 0;
    const n = POINTS;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('track', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('age', new THREE.BufferAttribute(new Float32Array(n * 2), 1).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(index);
    g.setDrawRange(0, 0);
    this.fog = fog ?? { color: new THREE.Color(), density: { value: 0 } };
    this.uniforms = {
      uKelvin: { value: KELVIN }, uLength: { value: length }, uTime: { value: 0 },
      uFoam: { value: new THREE.Color(0.85, 0.9, 0.92) },
      uFogDensity: this.fog.density,
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  // The ship's pose (platform metres, yaw radians from +X) and speed in m/s
  update(dt, x, y, yaw, speed) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    const bx = x + Math.cos(yaw) * this.length / 2, by = y + Math.sin(yaw) * this.length / 2;
    const s = THREE.MathUtils.clamp(speed / FULL_SPEED, 0, 1);
    const T = this.track;
    if (T.length && Math.hypot(bx - T[0].x, by - T[0].y) > 200) T.length = 0; // jumped: start over
    // Lay a new point once the bow has moved a step on from the last one
    if (T.length < 2 || Math.hypot(bx - T[1].x, by - T[1].y) >= STEP) {
      T.unshift({});
      if (T.length > POINTS) T.length = POINTS;
    }
    // The head rides with the bow
    Object.assign(T[0], { x: bx, y: by, s, t: this.time });
    this.build();
  }

  // Lay a whole track at once, newest first: [{x, y, yaw, speed, age}]
  // (when the ship first shows up, or the clock jumps)
  seed(list) {
    this.track = list.slice(0, POINTS).map((p) => ({
      x: p.x + Math.cos(p.yaw) * this.length / 2, y: p.y + Math.sin(p.yaw) * this.length / 2,
      s: THREE.MathUtils.clamp(p.speed / FULL_SPEED, 0, 1), t: this.time - p.age,
    }));
    this.build();
  }

  clear() { this.track.length = 0; this.mesh.geometry.setDrawRange(0, 0); }

  build() {
    const T = this.track, g = this.mesh.geometry;
    const pos = g.attributes.position.array, tr = g.attributes.track.array, age = g.attributes.age.array;
    let d = 0;
    for (let i = 0; i < T.length; i++) {
      const p = T[i];
      if (i) d += Math.hypot(p.x - T[i - 1].x, p.y - T[i - 1].y);
      // Across the track: from the neighbours, so the ribbon bends smoothly
      const a = T[Math.max(0, i - 1)], b = T[Math.min(T.length - 1, i + 1)];
      let tx = a.x - b.x, ty = a.y - b.y;
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const half = d * KELVIN * 1.25 + 14;
      for (const side of [0, 1]) {
        const k = side ? -half : half, j = i * 2 + side;
        pos.set([p.x - ty * k, p.y + tx * k, 0.3], j * 3);
        tr.set([d, k, p.s], j * 3);
        age[j] = this.time - p.t;
      }
    }
    g.attributes.position.needsUpdate = g.attributes.track.needsUpdate = g.attributes.age.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, T.length - 1) * 6);
  }
}
