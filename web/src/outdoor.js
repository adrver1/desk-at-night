// The world outside the control room window: a sky and an ocean drawn live,
// for any time of day and any weather. Nothing here is baked. The sky's
// colours come from a small table indexed by the sun's elevation, and the
// same numbers tint the room's baked sky light map (see controlScene.js), so
// the daylight on the desks and the platform follows what is in the window.
//
// The sky and the sea are drawn first, by a camera of their own that reaches
// to the horizon; the room is drawn over them with its own near and far
// planes. A depth-only copy of the sea in the room pass hides the parts of
// the platform's legs that sit under the water.
import * as THREE from 'three';

// Where on Earth: the northern North Sea. +x is east, -z is north (Blender's
// +Y), so the control room window (-x) looks west, into the sunset.
const LATITUDE = 58.8;
const CLOUD_HEIGHT = 1500;  // m above the sea
const OCEAN_SIZE = 80000;   // m across; the horizon from 70 m up is ~30 km away

// Sky colours (linear radiance) by sun elevation in degrees. Zenith, horizon,
// and the sun's own colour as direct light: deep night, blue hour, sunset,
// low sun, high sun.
const KEYS = [
  [-90, [0.003, 0.0045, 0.01], [0.007, 0.009, 0.015], [0, 0, 0]],
  [-18, [0.003, 0.0045, 0.01], [0.007, 0.009, 0.015], [0, 0, 0]],
  [-10, [0.002, 0.004, 0.012], [0.006, 0.007, 0.014], [0, 0, 0]],
  [-4, [0.012, 0.025, 0.07], [0.08, 0.05, 0.07], [0, 0, 0]],
  [-1, [0.04, 0.08, 0.2], [0.45, 0.25, 0.16], [0, 0, 0]],
  [0, [0.06, 0.12, 0.3], [0.7, 0.38, 0.2], [0.5, 0.15, 0.04]],
  [4, [0.15, 0.3, 0.7], [1.1, 0.75, 0.5], [2.4, 1.2, 0.5]],
  [10, [0.3, 0.55, 1.2], [1.3, 1.2, 1.2], [4.5, 3.3, 2.3]],
  [25, [0.45, 0.8, 1.7], [1.5, 1.6, 1.8], [6, 5.4, 4.6]],
  [90, [0.5, 0.9, 1.9], [1.6, 1.75, 2.0], [6.5, 6.2, 5.8]],
];
const MOONLIGHT = [0.03, 0.038, 0.055];
// The moon's angle east of the sun: just past first quarter, so on an evening
// shift it hangs low in the west-south-west, in view of the window, and sets
// soon after midnight
const MOON_ELONGATION = THREE.MathUtils.degToRad(100);
const MOON_RADIUS = 0.009; // rad, a little larger than life so it reads on a phone
export const REAL_TIME = 1 / 3600;
const CCTV_GAIN = 8; // the cameras' most exposure gain: at night they see little

// Presets for the weather buttons: cloud cover, wind, fog, rain (all 0..1)
export const WEATHER = {
  clear: { clouds: 0.1, wind: 0.25, fog: 0.05, rain: 0 },
  cloudy: { clouds: 0.55, wind: 0.45, fog: 0.15, rain: 0 },
  overcast: { clouds: 0.95, wind: 0.5, fog: 0.3, rain: 0.15 },
  storm: { clouds: 1, wind: 1, fog: 0.45, rain: 0.85 },
  fog: { clouds: 0.8, wind: 0.15, fog: 1, rain: 0 },
};
const RAIN_DROPS = 6000;
// Where rain falls, in the room's frame: the air outside the window (-x)
const RAIN_BOX = { x: [-70, -5.8], y: [-25, 20], z: [-40, 40] };

const rainVertex = /* glsl */ `
  attribute vec4 seed;   // x, z, phase, and 0/1 for the streak's top/bottom
  uniform float uTime;
  uniform vec3 uFall;    // velocity, m/s
  varying float vFade;
  void main() {
    float h = ${(RAIN_BOX.y[1] - RAIN_BOX.y[0]).toFixed(1)};
    float t = mod(seed.z * h + uTime * -uFall.y, h);  // how far the drop has fallen
    vec3 p = vec3(seed.x, ${RAIN_BOX.y[1].toFixed(1)} - t, seed.y);
    // Blown sideways as it falls, but kept in the air outside the window
    vec2 lo = vec2(${RAIN_BOX.x[0].toFixed(1)}, ${RAIN_BOX.z[0].toFixed(1)}), size = vec2(${(RAIN_BOX.x[1] - RAIN_BOX.x[0]).toFixed(1)}, ${(RAIN_BOX.z[1] - RAIN_BOX.z[0]).toFixed(1)});
    p.xz = lo + mod(p.xz + uFall.xz * (t / -uFall.y) - lo, size);
    p -= uFall * 0.07 * seed.w;           // motion blur: the streak a drop draws while the eye looks
    p.x = min(p.x, ${RAIN_BOX.x[1].toFixed(1)});
    vFade = smoothstep(0.0, 3.0, t) * smoothstep(h, h - 3.0, t);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const rainFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.a = 0.55 * vFade;  // blended after tone mapping
  }
`;

// Rain on the window: beads that land, sit and dry, and drops that run down.
// Only the window's own pixels pay for it, and only while it rains.
const glassVertex = /* glsl */ `
  varying vec2 vPos;  // metres across the glass: along the wall, up
  void main() {
    vPos = vec2(position.x, position.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const glassFragment = /* glsl */ `
  varying vec2 vPos;
  uniform float uTime, uRain, uWet;
  uniform vec3 uZenith, uHorizon;
  vec2 hash2(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }
  // One layer of beads on a grid of cells, cell metres across: x is how much
  // of a drop covers the point, y how bright (its lens shows the sky upside down)
  vec2 beads(vec2 p, float cell, float t, float seed) {
    vec2 c = floor(p / cell), f = fract(p / cell);
    vec2 a = hash2(c + seed), b = hash2(c + seed + 17.0);
    if (b.x > uRain) return vec2(0.0);           // fewer cells hold a drop in light rain
    float life = fract(t * (0.04 + 0.08 * a.y) + a.x);  // lands at 0, dries by 1
    vec2 o = 0.25 + 0.5 * b;
    float rad = (0.2 + 0.22 * a.x) * (1.0 - 0.6 * life);
    float d = length((f - o) * vec2(1.0, 1.15)) / rad;
    float m = (1.0 - smoothstep(0.75, 1.0, d)) * smoothstep(1.0, 0.85, life);
    // Bright low in the drop, a dark rim, a glint at the top
    float lens = mix(0.2, 1.7, smoothstep(0.2, -0.6, (f.y - o.y) / rad)) * mix(1.0, 0.15, smoothstep(0.5, 0.95, d));
    lens += 2.0 * smoothstep(0.3, 0.0, length(f - o - vec2(-0.25, 0.35) * rad) / rad);
    return vec2(m, lens);
  }
  // Drops that grow too heavy and run down, leaving a wet trail
  vec2 runs(vec2 p, float t) {
    float w = 0.06;
    float col = floor(p.x / w);
    vec2 a = hash2(vec2(col, 3.0)), b = hash2(vec2(col, 9.0));
    if (a.x > uRain * 0.6) return vec2(0.0);
    float period = 3.0 + 6.0 * a.y;
    float k = (t + b.x * period) / period;
    float head = 2.5 - fract(k) * 1.8;                     // height of the running drop, m
    float x = (fract(p.x / w) - 0.5) * w + 0.006 * sin(p.y * 40.0 + floor(k) * 7.0); // it wanders
    float drop = 1.0 - smoothstep(0.0025, 0.0045, length(vec2(x, (p.y - head) * 0.8)));
    float trail = (1.0 - smoothstep(0.0006, 0.0016, abs(x))) * step(head, p.y) * exp(-(p.y - head) * 3.0) * 0.5;
    return vec2(max(drop, trail), mix(0.5, 1.6, drop));
  }
  void main() {
    float t = uTime;
    vec2 a = beads(vPos, 0.022, t, 0.0), b = beads(vPos + 0.011, 0.045, t, 5.0), r = runs(vPos, t);
    float cover = max(max(a.x, b.x), r.x);
    float lens = (a.x * a.y + b.x * b.y + r.x * r.y) / max(a.x + b.x + r.x, 1e-3);
    vec3 sky = mix(uHorizon, uZenith, 0.3) * 1.2 + 0.006;  // what the drops refract: the sky, and a little of the room
    gl_FragColor = vec4(sky * lens, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.a = cover * 0.85 * uWet;
  }
`;

const skyChunk = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunColor, uSunDir, uMoonDir, uMoonColor, uFogColor;
  uniform float uClouds, uFog, uStars, uTime, uMoonShow, uMoonPhase;
  uniform vec2 uCloudShift;

  // Hashes without sin(): phone GPUs lose sin()'s precision for the large
  // arguments a sea in metres gives it, and the noise broke into blocks
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float hash3(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // How much cloud covers direction v (0..1), and the clouds' own colour
  float cloudDensity(vec3 v) {
    if (v.y <= 0.0) return uClouds;
    vec2 p = v.xz / (v.y + 0.04) * ${CLOUD_HEIGHT.toFixed(1)} + uCloudShift;
    float n = fbm(p / 2600.0) * 0.75 + fbm(p / 650.0) * 0.25;
    float d = smoothstep(0.62 - 0.55 * uClouds, 0.82 - 0.4 * uClouds, n);
    // Far away the layer thins into a uniform grey band
    return mix(d, uClouds, smoothstep(0.25, 0.0, v.y));
  }
  vec3 cloudColor(vec3 v, float d) {
    vec3 ambient = mix(uZenith, uHorizon, 0.5);
    float grey = lum(ambient);
    vec3 base = mix(ambient, vec3(0.92, 0.96, 1.05) * grey, 0.6) * mix(1.0, 0.4, d * uClouds);
    float toward = max(dot(v, uSunDir), 0.0);
    return base + uSunColor * (0.05 + 0.25 * pow(toward, 6.0)) * (1.0 - 0.7 * d) + uMoonColor * 0.4;
  }

  // Radiance seen in direction v (unit). Stars only for the sky itself.
  vec3 sky(vec3 v, float stars) {
    float h = max(v.y, 0.0);
    vec3 horizon = uHorizon;
    // The horizon glows toward the sun at sunrise and sunset
    vec2 across = normalize(v.xz + 1e-5), sunFlat = normalize(uSunDir.xz + 1e-5);
    float side = max(dot(across, sunFlat), 0.0);
    float low = smoothstep(0.5, 0.0, uSunDir.y) * smoothstep(-0.25, 0.0, uSunDir.y);
    horizon *= 1.0 + 1.6 * low * pow(side, 3.0);
    vec3 col = mix(uZenith, horizon, exp(-h * 5.0));
    // Glow around the sun and moon
    float toSun = max(dot(v, uSunDir), 0.0);
    col += uSunColor * (0.02 * pow(toSun, 8.0) + 0.25 * pow(toSun, 120.0));
    float toMoon = max(dot(v, uMoonDir), 0.0);
    col += uMoonColor * (0.6 * pow(toMoon, 60.0) + 6.0 * pow(toMoon, 2000.0));
    // Overcast flattens the gradient toward grey
    col = mix(col, vec3(0.92, 0.96, 1.05) * lum(col) * 0.5, 0.85 * uClouds * uClouds);
    // Stars, then the discs, then the clouds over them
    if (stars > 0.0 && v.y > 0.0) {
      vec3 cell = floor(v * 260.0);
      float r = hash3(cell);
      if (r > 0.99) {
        vec3 c = (cell + 0.5) / 260.0;
        float m = (r - 0.99) / 0.01;  // magnitude: many faint stars, a few bright ones
        float b = smoothstep(0.0012 + 0.0016 * m, 0.0, length(v - normalize(c)));
        b *= 0.7 + 0.3 * sin(uTime * (2.0 + r * 40.0) + r * 900.0);  // twinkle
        // Fewer stars near the horizon, where the air is thick
        b *= smoothstep(0.0, 0.25, v.y);
        col += mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), fract(r * 731.0)) * b * (0.08 + 1.2 * m * m * m) * stars;
      }
    }
    if (toSun > 0.99996) col += uSunColor * 30.0;
    // The moon's disc, lit on the side toward the sun: x runs toward the sun
    // across the disc, and a point is lit where x > cos(elongation) * sqrt(1 - y^2)
    vec3 off = (v - uMoonDir) / ${MOON_RADIUS.toFixed(4)};
    float rr = dot(off, off);
    if (uMoonShow > 0.0 && rr < 1.2) {
      vec3 sx = normalize(uSunDir - uMoonDir * dot(uSunDir, uMoonDir));
      float x = dot(off, sx), y2 = max(rr - x * x, 0.0);
      float lit = smoothstep(-0.08, 0.08, x - uMoonPhase * sqrt(max(1.0 - y2, 0.0)));
      float disc = 1.0 - smoothstep(0.92, 1.0, sqrt(rr));
      // A few darker seas on its face
      float maria = 0.8 + 0.2 * sin(off.x * 5.0 + 1.0) * sin(off.y * 4.0 - off.z * 3.0);
      col += vec3(1.0, 0.98, 0.92) * disc * mix(0.012, 2.5 * maria, lit) * uMoonShow;
    }
    float d = cloudDensity(v);
    col = mix(col, cloudColor(v, d), d);
    // Fog and haze close the horizon
    float haze = exp(-h * mix(40.0, 3.0, uFog)) * mix(0.25, 1.0, uFog);
    col = mix(col, uFogColor, clamp(haze, 0.0, 1.0));
    return col;
  }
`;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const skyFragment = /* glsl */ `
  varying vec3 vDir;
  ${skyChunk}
  void main() {
    gl_FragColor = vec4(sky(normalize(vDir), uStars), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const oceanVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const oceanFragment = /* glsl */ `
  varying vec3 vWorld;
  uniform float uWind;
  uniform vec2 uWindDir;
  ${skyChunk}

  // Slopes of a sum of travelling waves (deep-water dispersion): a few long
  // swells near the wind's direction, then shorter, steeper chop from all
  // around it, then fine noise. Waves too short for the pixel fade out and
  // their slope goes into roughness instead, so the sea doesn't shimmer.
  vec3 waves(vec2 p, float footprint, out float rough) {
    vec2 g = vec2(0.0);
    rough = 0.0;
    float windAng = atan(uWindDir.y, uWindDir.x);
    float longest = mix(60.0, 180.0, uWind);
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      bool swell = i < 3;
      float spread = swell ? 1.3 : 2.6;
      vec2 dir = vec2(cos(windAng + (hash(vec2(fi, 3.1)) - 0.5) * spread), sin(windAng + (hash(vec2(fi, 3.1)) - 0.5) * spread));
      float lambda = longest * pow(0.66, fi) * (0.8 + 0.4 * hash(vec2(fi, 5.3)));
      float k = 6.2831853 / lambda;
      float w = sqrt(9.81 * k);
      float s = swell ? mix(0.02, 0.045, uWind) : mix(0.035, 0.13, uWind);
      float fade = 1.0 - smoothstep(lambda * 0.06, lambda * 0.3, footprint);
      g += s * fade * dir * cos(k * dot(dir, p) - w * uTime + hash(vec2(fi, 7.7)) * 6.28);
      rough += s * s * (1.0 - fade) * 0.5;
    }
    // Fine ripples: the slope of moving noise
    float fine = 1.0 - smoothstep(0.08, 0.6, footprint);
    if (fine > 0.0) {
      vec2 q = p / 1.3 + uWindDir * uTime * 0.6;
      float e = 0.15, n0 = noise(q);
      g += fine * mix(0.05, 0.15, uWind) * vec2(noise(q + vec2(e, 0.0)) - n0, noise(q + vec2(0.0, e)) - n0) / e * 0.35;
    }
    rough += (1.0 - fine) * mix(0.0006, 0.004, uWind);
    return normalize(vec3(-g.x, 1.0, -g.y));
  }

  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 v = toEye / dist;
    float footprint = length(fwidth(vWorld.xz));
    float rough;
    vec3 n = waves(vWorld.xz, footprint, rough);
    if (dot(n, v) < 0.05) n = normalize(n + v * (0.05 - dot(n, v)));
    vec3 r = reflect(-v, n);
    r.y = abs(r.y);
    float f = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 refl = mix(sky(r, uStars * 0.4), sky(normalize(vec3(r.x, r.y + 0.25, r.z)), 0.0), clamp(rough * 40.0, 0.0, 0.6));
    vec3 ambient = mix(uZenith, uHorizon, 0.5);
    vec3 body = vec3(0.004, 0.02, 0.024) * (lum(ambient) * 0.8 + uSunColor * max(uSunDir.y, 0.0) * 0.08);
    vec3 col = mix(body, refl, f);
    // The sun's and moon's glitter, wider when the sea is rough
    float r2 = 0.0015 + rough + uWind * 0.006;
    float clear = 1.0 - cloudDensity(uSunDir) * 0.95;
    col += uSunColor * clear * exp((dot(r, uSunDir) - 1.0) / r2) * 0.05 / r2;
    // The moon's is a narrower path: a small, dim light catches only the steeper slopes
    float m2 = 0.0003 + 0.3 * rough + uWind * 0.0015;
    col += uMoonColor * 1.5 * (1.0 - cloudDensity(uMoonDir) * 0.95) * exp((dot(r, uMoonDir) - 1.0) / m2) * 0.05 / m2;
    // Whitecaps in strong wind
    float foamAmount = smoothstep(0.45, 1.0, uWind);
    if (foamAmount > 0.0) {
      float fade = 1.0 - smoothstep(2.0, 12.0, footprint);
      float foam = smoothstep(0.66, 0.78, fbm(vWorld.xz / 7.0 + uWindDir * uTime * 0.4)) * foamAmount * fade;
      col = mix(col, ambient * 0.8 + uSunColor * max(uSunDir.y, 0.0) * 0.15, foam * 0.7);
    }
    // Distance fog, toward the same colour as the sky's horizon
    float visibility = mix(60000.0, 350.0, pow(uFog, 0.6));
    col = mix(col, uFogColor, 1.0 - exp(-dist / visibility));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function interp(e, slot) {
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i][0] < e) i++;
  const [e0, ...a] = KEYS[i - 1], [e1, ...b] = KEYS[i];
  const t = THREE.MathUtils.clamp((e - e0) / (e1 - e0), 0, 1);
  return new THREE.Color(...a[slot - 1].map((x, k) => x + (b[slot - 1][k] - x) * t));
}

// Unit vector toward a body at the given declination and hour angle (radians)
// seen from LATITUDE, in three's axes (x east, y up, -z north)
function toward(decl, hourAngle) {
  const lat = THREE.MathUtils.degToRad(LATITUDE);
  const east = -Math.cos(decl) * Math.sin(hourAngle);
  const north = Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(hourAngle);
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  return new THREE.Vector3(east, up, -north).normalize();
}

export class Outdoor {
  // seaLevel: the sea's height in the room's coordinates (m, negative)
  constructor(seaLevel) {
    this.seaLevel = seaLevel;
    // time in hours (local solar time), day of year, weather 0..1
    // speed: hours per second; the clock runs in real time unless sped up
    this.state = { time: 22.5, day: 294, clouds: 0.3, wind: 0.35, fog: 0.1, rain: 0, speed: REAL_TIME };
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uMoonColor: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uClouds: { value: 0 }, uFog: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 }, uMoonShow: { value: 0 }, uMoonPhase: { value: 0 },
      uCloudShift: { value: new THREE.Vector2() },
      uWind: { value: 0 }, uWindDir: { value: new THREE.Vector2(0.8, -0.6).normalize() },
    };
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, OCEAN_SIZE);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.ocean = new THREE.Mesh(new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ vertexShader: oceanVertex, fragmentShader: oceanFragment, uniforms: this.uniforms }));
    this.ocean.frustumCulled = false;
    this.scene.add(this.sky, this.ocean);
    // In the room's own pass: the sea surface as depth only, so the platform's
    // legs end at the waterline
    this.waterline = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.waterline.position.y = seaLevel;
    this.waterline.renderOrder = -1;
    // Rain, also in the room's pass so the walls hide it: streaks falling
    // in the air outside the window
    const seeds = new Float32Array(RAIN_DROPS * 8);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = THREE.MathUtils.lerp(...RAIN_BOX.x, Math.random() ** 1.6), z = THREE.MathUtils.lerp(...RAIN_BOX.z, Math.random()), ph = Math.random();
      seeds.set([x, z, ph, 0, x, z, ph, 1], i * 8);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_DROPS * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.ShaderMaterial({
      vertexShader: rainVertex, fragmentShader: rainFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: this.uniforms.uTime, uFall: { value: new THREE.Vector3(0, -9, 0) }, uColor: { value: new THREE.Color() } },
    }));
    this.rain.frustumCulled = false;
    this.room = new THREE.Group();
    this.room.add(this.waterline, this.rain);
    this.wet = 0;  // how wet the window is: it dries slowly after the rain
    // What the room reads back each frame
    this.light = {
      sky: new THREE.Color(),     // average sky radiance over the upper hemisphere
      sun: new THREE.Color(),     // direct light from the sun (or moon), after the clouds
      sunDir: new THREE.Vector3(0, 1, 0),
      fog: new THREE.Color(),     // fog colour, and the distance it hides half of what is behind
      fogDistance: 1e5,
      exposure: 1,                // suggested exposure for this light level
    };
    this.elapsed = 0;
    this.update(0);
  }

  set(changes) { Object.assign(this.state, changes); }

  // Rain on the window glass, given the opening (lo, hi: room coordinates,
  // the wall at x). The drops sit just outside the mullions.
  setWindow(lo, hi) {
    const w = hi.z - lo.z, h = hi.y - lo.y;
    const geometry = new THREE.PlaneGeometry(w, h).translate(-(lo.z + w / 2), lo.y + h / 2, 0);
    this.glass = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      vertexShader: glassVertex, fragmentShader: glassFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: this.uniforms.uTime, uRain: { value: 0 }, uWet: { value: 0 }, uZenith: this.uniforms.uZenith, uHorizon: this.uniforms.uHorizon },
    }));
    // Turned to face into the room (+x): the plane's x runs along -z
    this.glass.rotation.y = Math.PI / 2;
    this.glass.position.x = lo.x - 0.05;
    this.glass.visible = false;
    this.room.add(this.glass);
  }

  // Advance the waves and clouds by dt seconds, and the clock by `speed`
  // hours per second, then recompute the light
  update(dt) {
    const s = this.state, u = this.uniforms;
    this.elapsed += dt;
    if (s.speed) s.time = (s.time + s.speed * dt + 24) % 24;
    const decl = THREE.MathUtils.degToRad(-23.44 * Math.cos((2 * Math.PI / 365) * (s.day + 10)));
    const hour = THREE.MathUtils.degToRad(15 * (s.time - 12));
    const sun = toward(decl, hour);
    const moon = toward(-decl * Math.cos(MOON_ELONGATION), hour - MOON_ELONGATION);
    const e = THREE.MathUtils.radToDeg(Math.asin(sun.y));
    const c = s.clouds;

    // Thick cloud and rain darken the whole sky
    const gloom = 1 - 0.25 * c * c - 0.4 * s.rain;
    u.uZenith.value.copy(interp(e, 1)).multiplyScalar(gloom);
    u.uHorizon.value.copy(interp(e, 2)).multiplyScalar(gloom);
    const sunColor = interp(e, 3);
    u.uSunColor.value.copy(sunColor);
    u.uSunDir.value.copy(sun);
    u.uMoonDir.value.copy(moon);
    const night = THREE.MathUtils.smoothstep(-e, 2, 12);
    const moonUp = THREE.MathUtils.smoothstep(moon.y, -0.02, 0.1);
    u.uMoonColor.value.setRGB(...MOONLIGHT).multiplyScalar(night * moonUp * (1 - Math.cos(MOON_ELONGATION)) / 2);
    u.uMoonShow.value = THREE.MathUtils.smoothstep(-e, -8, 6) * moonUp;
    u.uMoonPhase.value = Math.cos(MOON_ELONGATION);
    u.uStars.value = THREE.MathUtils.smoothstep(-e, 4, 14) * (1 - c);
    u.uClouds.value = c;
    u.uFog.value = Math.min(1, s.fog + 0.35 * s.rain);
    u.uWind.value = s.wind;
    u.uTime.value = this.elapsed;
    const windSpeed = 3 + s.wind * 22; // m/s
    u.uCloudShift.value.addScaledVector(u.uWindDir.value, windSpeed * dt * 2);
    // Fog takes the horizon's colour, greyed and dimmed by the cloud
    const horizon = u.uHorizon.value.clone().lerp(u.uZenith.value, 0.2);
    const grey = horizon.r * 0.2126 + horizon.g * 0.7152 + horizon.b * 0.0722;
    u.uFogColor.value.copy(horizon).lerp(new THREE.Color(0.92 * grey, 0.96 * grey, 1.05 * grey).multiplyScalar(0.6), 0.4 + 0.5 * c);

    // Light for the room and the platform. The sky's average radiance: half
    // zenith, half horizon, flattened and dimmed by cloud.
    // Rain: how many drops, how they slant in the wind, and how bright
    this.rain.visible = s.rain > 0.01;
    // The glass gets wet at once and dries over a minute or two
    this.wet = s.rain > 0.01 ? Math.min(1, this.wet + dt / 3) : Math.max(0, this.wet - dt / 90);
    if (this.glass) {
      this.glass.visible = this.wet > 0.001;
      const g = this.glass.material.uniforms;
      g.uRain.value = Math.max(s.rain, 0.25 * this.wet);
      g.uWet.value = this.wet;
    }
    this.rain.geometry.setDrawRange(0, 2 * Math.round(RAIN_DROPS * s.rain));
    const ru = this.rain.material.uniforms;
    ru.uFall.value.set(u.uWindDir.value.x * windSpeed * 0.5, -9, u.uWindDir.value.y * windSpeed * 0.5);
    const L = this.light;
    L.fog.copy(u.uFogColor.value);
    L.fogDistance = THREE.MathUtils.lerp(60000, 350, u.uFog.value ** 0.6) * Math.LN2;
    L.sky.copy(u.uZenith.value).lerp(u.uHorizon.value, 0.5);
    const lsky = L.sky.r * 0.2126 + L.sky.g * 0.7152 + L.sky.b * 0.0722;
    L.sky.lerp(new THREE.Color(0.92 * lsky, 0.96 * lsky, 1.05 * lsky).multiplyScalar(0.55), 0.85 * c * c);
    L.sky.add(u.uMoonColor.value.clone().multiplyScalar(0.3));
    const through = 1 - 0.92 * THREE.MathUtils.smoothstep(c, 0.35, 0.95);
    if (sun.y > -0.02) { L.sun.copy(sunColor).multiplyScalar(through); L.sunDir.copy(sun); }
    else { L.sun.copy(u.uMoonColor.value).multiplyScalar(through); L.sunDir.copy(moon); }
    const adapt = lsky + 0.05 * (L.sun.r * 0.2126 + L.sun.g * 0.7152 + L.sun.b * 0.0722);
    // Eyes adapt to the room as much as to the window: only part of the way
    L.exposure = 0.8 / (0.3 * adapt + 0.8);
    ru.uColor.value.copy(L.sky).multiplyScalar(1.4).addScalar(0.004);

    // For the CCTV pictures on the wall screens (screens.js): the same sky
    // and sea as CSS colours, as an auto-exposing camera would see them
    const k = Math.min(CCTV_GAIN, 0.8 / (lsky + 0.01));
    const css = (col, gain = 1) => [col.r, col.g, col.b].map((x) => Math.round(255 * ((x * k * gain) / (1 + x * k * gain)) ** (1 / 2.2)));
    const cloud = u.uZenith.value.clone().lerp(u.uHorizon.value, 0.5);
    const cl = cloud.r * 0.2126 + cloud.g * 0.7152 + cloud.b * 0.0722;
    cloud.lerp(new THREE.Color(cl, cl, cl), 0.7).multiplyScalar(1 - 0.5 * c).add(sunColor.clone().multiplyScalar(0.08));
    this.cctv = {
      time: s.time, wind: s.wind, clouds: c, fog: u.uFog.value, rain: s.rain,
      day: THREE.MathUtils.smoothstep(e, -6, 6),
      skyTop: css(u.uZenith.value), skyLow: css(u.uHorizon.value.clone().lerp(u.uFogColor.value, 0.5)),
      cloud: css(cloud), fogColor: css(u.uFogColor.value),
      seaFar: css(u.uHorizon.value.clone().lerp(u.uZenith.value, 0.5), 0.45), seaNear: css(u.uZenith.value, 0.25),
      glint: css(sunColor.clone().multiplyScalar(through).add(u.uMoonColor.value.clone().multiplyScalar(20)), 0.3),
    };
  }

  // Draw the sky and sea for `camera`, then leave the depth buffer clear for
  // the room. The renderer must have autoClear off.
  render(renderer, camera) {
    this.camera.position.copy(camera.position);
    this.camera.quaternion.copy(camera.quaternion);
    camera.getWorldPosition(this.camera.position);
    camera.getWorldQuaternion(this.camera.quaternion);
    this.camera.fov = camera.fov;
    this.camera.aspect = camera.aspect;
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
    this.ocean.position.set(this.camera.position.x, this.seaLevel, this.camera.position.z);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.clearDepth();
  }
}

// Clock text for a time in hours
export function clock(h) {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
