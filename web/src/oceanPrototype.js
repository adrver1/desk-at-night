// PROTOTYPE (throwaway): which sea, sky and reflections should the game use?
// Today's outdoor.js next to three upgrades, around the platform and the
// supply vessel from the intro's models:
//   now  today's outdoor.js, untouched
//   a    shader polish: lit puffy clouds and cirrus, a sea from a wind wave
//        spectrum with whitecaps and rain rings; no extra render passes
//   b    a + the platform and vessel mirrored in the sea (one extra render
//        at quarter resolution, broken up by the waves)
//   c    b + waves that move the surface and raymarched 3D clouds
//
// The sea state follows the wind the way the real one does: wave height and
// period from a JONSWAP spectrum for the wind speed and the fetch (capped at
// a fully developed Pierson-Moskowitz sea), the waves travel downwind with a
// spread that widens for shorter waves, a separate swell comes from its own
// direction, and the whitecap cover follows Monahan's fit to measurements.
// URL: ocean-prototype.html?variant=c&view=low&time=11.5&weather=cloudy
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Outdoor, WEATHER, PLATFORM_HEADING } from './outdoor.js';
import { fpsCounter } from './fps.js';

fpsCounter();

const q = new URLSearchParams(location.search);
const B = (x, y, z) => new THREE.Vector3(x, z, -y); // Blender to three.js axes
const G = 9.81;
const FETCH = 250e3;     // m of open water upwind: the northern North Sea
const NW = 28;           // wave components: 24 wind sea + 4 swell
const NV = 14;           // how many of the longest move the surface (variant c)
const NF = 10;           // the dominant waves, whose breaking crests make whitecaps

// ---------------------------------------------------------------- sea state

const BEAUFORT = [[0.3, 'calm'], [1.6, 'light air'], [3.4, 'light breeze'], [5.5, 'gentle breeze'], [8, 'moderate breeze'],
  [10.8, 'fresh breeze'], [13.9, 'strong breeze'], [17.2, 'near gale'], [20.8, 'gale'], [24.5, 'strong gale'],
  [28.5, 'storm'], [32.7, 'violent storm'], [Infinity, 'hurricane force']];
const beaufort = (u) => { const i = BEAUFORT.findIndex(([v]) => u < v); return [i, BEAUFORT[i][1]]; };

// Whitecap cover, fraction of the sea surface (Monahan & O'Muircheartaigh 1980)
const whitecaps = (u) => Math.min(0.25, 3.84e-6 * Math.max(u, 0) ** 3.41);

// Significant wave height (m) and peak angular frequency for a wind of u m/s
// blowing over `fetch` m: JONSWAP growth, capped at a fully developed sea
function windSea(u, fetch = FETCH) {
  u = Math.max(u, 0.5);
  const X = (G * fetch) / (u * u);
  const hsJ = (0.0016 * Math.sqrt(X) * u * u) / G, hsPM = (0.21 * u * u) / G;
  const wpJ = 2 * Math.PI * 3.5 * (G / u) * X ** -0.33, wpPM = (0.877 * G) / u;
  return { hs: Math.min(hsJ, hsPM), wp: Math.max(wpJ, wpPM) };
}

// Unit vector, in the frame's xz, for a true bearing (deg) in a frame whose
// -z points at `heading` (deg), as outdoor.js's toward()
function bearingDir(bearing, heading) {
  const b = THREE.MathUtils.degToRad(bearing), h = THREE.MathUtils.degToRad(heading);
  const east = Math.sin(b), north = Math.cos(b), c = Math.cos(h), s = Math.sin(h);
  return new THREE.Vector2(east * c - north * s, -(north * c + east * s));
}

// The wave components as uniforms: (dir.x, dir.z, k, amplitude) and
// (choppiness, phase); plus the foam threshold that gives Monahan's cover
const waveU = Array.from({ length: NW }, () => new THREE.Vector4());
const waveQ = Array.from({ length: NW }, () => new THREE.Vector2());
const golden = (i) => (i * 0.6180339887) % 1;
function buildSea(p, heading) {
  const { hs, wp } = windSea(p.wind);
  const down = (p.windFrom + 180) % 360;   // wind waves run downwind
  // JONSWAP spectrum, sampled at 24 log-spaced frequencies from 0.7 to 9 wp
  const gamma = 3.3, n = 24, lo = Math.log(0.7 * wp), hi = Math.log(9 * wp);
  const S = [], ws = [];
  for (let i = 0; i < n; i++) {
    const w = Math.exp(lo + (hi - lo) * (i + 0.5 * golden(i + 3)) / n);
    const dw = w * (hi - lo) / n;
    const sigma = w <= wp ? 0.07 : 0.09;
    const r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
    S.push(w ** -5 * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r * dw);
    ws.push(w);
  }
  const total = S.reduce((a, b) => a + b, 0);
  const comps = [];
  for (let i = 0; i < n; i++) {
    const a = Math.sqrt(2 * S[i] / total) * hs / 4;   // sum of a²/2 = (Hs/4)²
    const spread = THREE.MathUtils.lerp(18, 65, i / (n - 1));   // shorter waves fan out wider
    const ang = down + spread * (2 * golden(i * 7 + 1) - 1);
    comps.push({ dir: bearingDir(ang, heading), k: ws[i] ** 2 / G, a });
  }
  // Swell from elsewhere: long, low, narrow in direction
  const ks = (2 * Math.PI / p.swellPeriod) ** 2 / G;
  for (let i = 0; i < 4; i++) {
    comps.push({ dir: bearingDir((p.swellFrom + 180) % 360 + [-6, 4, -2, 8][i], heading), k: ks * [1, 1.08, 0.93, 1.17][i], a: Math.sqrt([0.4, 0.3, 0.2, 0.1][i] * 2) * p.swellHs / 4 });
  }
  // Choppiness: crests sharpen with steepness, kept short of folding over
  const steep = comps.reduce((s, c) => s + c.k * c.a, 0);
  const chop = Math.min(1, 0.85 / Math.max(steep, 1e-6));
  comps.forEach((c, i) => { waveU[i].set(c.dir.x, c.dir.y, c.k, c.a); waveQ[i].set(chop, golden(i * 13 + 5) * 6.2832); });
  // Whitecaps where the dominant wind waves (the first NF, up to twice the
  // peak frequency) squeeze the surface most, the Gerstner Jacobian being
  // lowest: find the level that covers the measured whitecap fraction
  const W = whitecaps(p.wind), J = [];
  for (let s = 0; s < 3000; s++) {
    const x = (golden(s * 3 + 1) - 0.5) * 4000, z = (golden(s * 5 + 2) - 0.5) * 4000, t = golden(s * 11) * 100;
    let j = 1;
    comps.slice(0, NF).forEach((c, i) => { j -= chop * c.k * c.a * Math.sin(c.k * (c.dir.x * x + c.dir.y * z) - Math.sqrt(G * c.k) * t + waveQ[i].y); });
    J.push(j);
  }
  // Roughness the wave list can't draw: the measured mean square slope of
  // the sea (Cox & Munk 1954, clean surface) less what the list already has
  const mss = 0.003 + 0.00512 * p.wind;
  const listMss = comps.slice(0, n).reduce((s, c) => s + (c.k * c.a) ** 2 / 2, 0);
  J.sort((a, b) => a - b);
  // Waves break in groups and only along a short stretch of each crest, so
  // the shader keeps about a fifth of the candidate crest (patchy masks):
  // ask the Jacobian for five times the cover
  const foamJ = W > 1e-5 ? J[Math.min(J.length - 1, Math.floor(Math.min(5 * W, 0.7) * J.length))] : -10;
  const swell = { hs: p.swellHs, tp: p.swellPeriod };
  return { hs, tp: 2 * Math.PI / wp, lp: (2 * Math.PI * G) / (wp * wp), W, foamJ, swell, mss, ripple: Math.sqrt(Math.max(mss - listMss, 0.0005)) };
}

// ---------------------------------------------------------------- noise

// A tileable fbm texture: clouds and fine ripples read it instead of
// computing noise per pixel, so even the raymarched clouds stay cheap
const noiseSlope = new THREE.Vector2(1, 1);
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period, seed) => {
    const g = new Float32Array(period * period);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 16807) % 2147483647; g[i] = s / 2147483647; }
    return (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => g[((j % period + period) % period) * period + ((i % period + period) % period)];
      return (at(x0, y0) * (1 - ux) + at(x0 + 1, y0) * ux) * (1 - uy) + (at(x0, y0 + 1) * (1 - ux) + at(x0 + 1, y0 + 1) * ux) * uy;
    };
  };
  const fbm = (seed) => {
    const octaves = [4, 8, 16, 32, 64].map((p, i) => [lattice(p, seed + i * 101), p]);
    return (u, v) => { let s = 0, a = 0.5, n = 0; for (const [f, p] of octaves) { s += a * f(u * p, v * p); n += a; a *= 0.5; } return s / n; };
  };
  const r = fbm(7), g = fbm(1234), b = fbm(999);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, u = x / size, v = y / size;
    data[i] = 255 * r(u, v); data[i + 1] = 255 * g(u, v); data[i + 2] = 255 * b(u, v); data[i + 3] = 255;
  }
  for (let c = 0; c < 3; c++) {   // stretch the contrast: fbm sits near 0.5
    let lo = 255, hi = 0;
    for (let i = c; i < data.length; i += 4) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
    for (let i = c; i < data.length; i += 4) data[i] = (255 * (data[i] - lo)) / (hi - lo);
  }
  // rms slope per texel of the g and b channels, to scale ripples to a slope
  const rms = [1, 2].map((c) => {
    let sum = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4 + c, dx = data[(y * size + (x + 1) % size) * 4 + c] - data[i], dy = data[(((y + 1) % size) * size + x) * 4 + c] - data[i];
      sum += (dx * dx + dy * dy) / (255 * 255);
    }
    return Math.sqrt(sum / (size * size));
  });
  noiseSlope.set(rms[0] * size, rms[1] * size);
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- shaders

const common = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunColor, uSunDir, uMoonDir, uMoonColor, uFogColor;
  uniform float uClouds, uFog, uStars, uTime, uMoonShow, uMoonPhase, uCamHeight, uRainRate, uWindSpeed;
  uniform float uCloudBase, uCloudTop, uStratus, uMss, uRipple;
  uniform vec2 uNoiseSlope, uFoamStyle;
  uniform vec2 uCloudShift, uWindDir;
  uniform sampler2D uNoise;
  uniform vec4 uWave[${NW}];
  uniform vec2 uWaveQ[${NW}];
  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec2 hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 tn(vec2 p) { return texture2D(uNoise, p).rgb; }
`;

// Clouds on one layer: cumulus that merge into a flat stratus deck as the
// cover closes, lit by how much cloud lies between each point and the sun
const clouds2d = /* glsl */ `
  float coverN(vec2 p) {
    vec2 w = tn(p / 23000.0).gb - 0.5;
    p += w * 2600.0;
    float cu = tn(p / 7000.0).r * 0.6 + tn(p / 1900.0).g * 0.28 + tn(p / 520.0).b * 0.12;
    float st = tn(p / 16000.0).r * 0.75 + tn(p / 4000.0).g * 0.25;   // stratus: broad, soft
    return mix(cu, st, uStratus);
  }
  // The same field without its finest octave, for the raymarch: its long
  // steps would alias that octave into streaks
  float coverN3(vec2 p) {
    vec2 w = tn(p / 23000.0).gb - 0.5;
    p += w * 2600.0;
    float cu = (tn(p / 7000.0).r * 0.6 + tn(p / 1900.0).g * 0.28) / 0.88 * 0.94 + 0.03;
    float st = tn(p / 16000.0).r * 0.75 + tn(p / 4000.0).g * 0.25;
    return mix(cu, st, uStratus);
  }
  float coverLo() { return 0.7 - 0.34 * uClouds; }
  float coverD(float n) {
    float soft = mix(0.1, 0.35, uStratus);
    return clamp(smoothstep(coverLo(), coverLo() + soft, n) + smoothstep(0.85, 1.0, uClouds) * 0.6, 0.0, 1.0);
  }
  vec3 cloudAmbient() {
    vec3 a = mix(uZenith, uHorizon, 0.45);
    return mix(a, vec3(lum(a)) * vec3(0.95, 0.98, 1.04), 0.55);
  }
  // rgb: radiance, a: cover
  vec4 clouds(vec3 v) {
    vec3 amb = cloudAmbient();
    vec3 flat_ = amb * mix(1.0, 0.6, uClouds) * (1.0 - 0.35 * uRainRate);
    if (v.y <= 0.0) return vec4(flat_, uClouds);
    vec2 p = v.xz / (v.y + 0.035) * uCloudBase + uCloudShift;
    float n = coverN(p), d = coverD(n);
    vec2 sdir = normalize(uSunDir.xz + 1e-4);
    float toward = max(dot(v, uSunDir), 0.0);
    float shadow = exp(-2.2 * coverD(coverN(p + sdir * 350.0)) - 1.4 * d * uClouds);
    float phase = 0.3 + 0.5 * pow(toward, 3.0) + 2.0 * pow(toward, 24.0) * (1.0 - d);  // bright rims toward the sun
    float sunUp = smoothstep(-0.08, 0.05, uSunDir.y);
    float thick = smoothstep(0.0, 0.16, n - coverLo());   // deep inside a cloud: its darker base
    float dark = mix(0.42, 0.3, uRainRate);               // rain clouds have the darkest bases
    vec3 col = amb * mix(1.25, dark, thick * (0.5 + 0.5 * uClouds))
             + uSunColor * sunUp * shadow * phase * 0.4 * mix(1.0, 0.35, thick)
             + uMoonColor * 0.5;
    // high cirrus, combed out along the wind, in clearer skies
    vec2 c = v.xz / (v.y + 0.02) * 9000.0 + uCloudShift * 0.3;
    vec2 a = vec2(dot(c, uWindDir), dot(c, vec2(-uWindDir.y, uWindDir.x)));
    float ci = smoothstep(0.55, 0.85, tn(a / vec2(40000.0, 6000.0)).b) * smoothstep(0.45, 0.75, tn(a / 15000.0).g);
    ci *= (1.0 - uClouds) * 0.55 * smoothstep(0.02, 0.2, v.y) * (1.0 - d);
    col = mix(col, amb * 1.3 + uSunColor * sunUp * 0.12, ci / max(d + ci, 1e-3) * step(0.0, ci - 0.001));
    d = max(d, ci);
    float far = smoothstep(0.18, 0.0, v.y);   // far away, the layer thins into a uniform band
    return vec4(mix(col, flat_, far * 0.7), mix(d, uClouds, far));
  }
`;

// Raymarched clouds in a slab whose height and depth follow the weather:
// fair-weather cumulus 1.1-2.5 km, a low thin stratus deck, a deep storm
// cloud. Steps jittered with interleaved gradient noise, which reads as fine
// grain rather than blotches.
const clouds3d = /* glsl */ `
  float dens(vec3 p) {
    float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
    float n = coverN3(p.xz + uWindDir * h * 150.0) - h * h * 0.08 * (1.0 - uStratus);   // narrower toward the top
    float profile = smoothstep(0.0, 0.12, h) * smoothstep(1.0, mix(0.35, 0.8, uStratus), h);
    float d = n - coverLo() - (1.0 - profile) * 0.18;
    return clamp(d * mix(9.0, 4.0, uStratus) + smoothstep(0.85, 1.0, uClouds) * profile * 0.5, 0.0, 1.0);
  }
  vec4 clouds3(vec3 v, vec2 frag) {
    if (v.y < 0.03) return clouds(v);
    vec3 amb = cloudAmbient();
    float t0 = (uCloudBase - uCamHeight) / v.y, t1 = min((uCloudTop - uCamHeight) / v.y, t0 + 7000.0);
    const int N = 32;
    float dt = (t1 - t0) / float(N);
    float ign = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
    float t = t0 + dt * ign;
    float T = 1.0; vec3 L = vec3(0.0);
    float toward = dot(v, uSunDir);
    float phase = 0.6 * (1.0 - 0.36) / pow(1.0 + 0.36 - 1.2 * toward, 1.5) + 0.4 * (1.0 - 0.04) / pow(1.04 + 0.4 * toward, 1.5);
    float sunUp = smoothstep(-0.08, 0.05, uSunDir.y);
    for (int i = 0; i < N; i++) {
      vec3 p = vec3(v.x * t + uCloudShift.x, uCamHeight + v.y * t, v.z * t + uCloudShift.y);
      float d = dens(p);
      if (d > 0.01) {
        float h = (p.y - uCloudBase) / (uCloudTop - uCloudBase);
        float toSun = dens(p + uSunDir * 260.0) + 0.5 * dens(p + uSunDir * 700.0);
        float sigma = d * 0.02;
        vec3 S = uSunColor * sunUp * exp(-toSun * 3.0) * phase * 0.35 * (1.0 - exp(-d * 4.0))   // powder: dark where thin and lit
               + amb * mix(0.45, 1.3, h) * (1.0 - 0.4 * uRainRate) + uMoonColor * 0.5;
        float tr = exp(-sigma * dt);
        L += T * S * (1.0 - tr);
        T *= tr;
        if (T < 0.03) break;
      }
      t += dt;
    }
    vec4 c = vec4(L / max(1.0 - T, 1e-3), 1.0 - T);
    vec4 f = clouds(v);   // blend into the flat layer toward the horizon
    return mix(c, f, smoothstep(0.3, 0.06, v.y));
  }
`;

// The sky behind the clouds: today's gradient, glows, stars, sun and moon
const skyBase = /* glsl */ `
  vec3 skyBase(vec3 v, float stars, float disc) {
    float h = max(v.y, 0.0);
    vec3 horizon = uHorizon;
    vec2 across = normalize(v.xz + 1e-5), sunFlat = normalize(uSunDir.xz + 1e-5);
    float side = max(dot(across, sunFlat), 0.0);
    float low = smoothstep(0.5, 0.0, uSunDir.y) * smoothstep(-0.25, 0.0, uSunDir.y);
    horizon *= 1.0 + 1.6 * low * pow(side, 3.0);
    vec3 col = mix(uZenith, horizon, exp(-h * 5.0));
    float toSun = max(dot(v, uSunDir), 0.0);
    col += uSunColor * (0.03 * pow(toSun, 6.0) + 0.25 * pow(toSun, 120.0));
    float toMoon = max(dot(v, uMoonDir), 0.0);
    col += uMoonColor * (0.6 * pow(toMoon, 60.0) + 6.0 * pow(toMoon, 2000.0));
    col = mix(col, vec3(0.92, 0.96, 1.05) * lum(col) * 0.5, 0.85 * uClouds * uClouds);
    if (stars > 0.0 && v.y > 0.0) {
      vec3 cell = floor(v * 260.0);
      float r = hash3(cell);
      if (r > 0.99) {
        vec3 c = (cell + 0.5) / 260.0;
        float m = (r - 0.99) / 0.01;
        float b = smoothstep(0.0012 + 0.0016 * m, 0.0, length(v - normalize(c)));
        b *= smoothstep(0.0, 0.25, v.y);
        col += vec3(0.85, 0.88, 1.0) * b * (0.08 + 1.2 * m * m * m) * stars;
      }
    }
    if (toSun > 0.99996) col += uSunColor * 30.0 * disc;
    vec3 off = (v - uMoonDir) / 0.009;
    float rr = dot(off, off);
    if (uMoonShow > 0.0 && rr < 1.2) {
      vec3 sx = normalize(uSunDir - uMoonDir * dot(uSunDir, uMoonDir));
      float x = dot(off, sx), y2 = max(rr - x * x, 0.0);
      float lit = smoothstep(-0.08, 0.08, x - uMoonPhase * sqrt(max(1.0 - y2, 0.0)));
      col += vec3(1.0, 0.98, 0.92) * (1.0 - smoothstep(0.92, 1.0, sqrt(rr))) * mix(0.012, 2.5, lit) * uMoonShow * disc;
    }
    return col;
  }
  vec3 skyBase(vec3 v, float stars) { return skyBase(v, stars, 1.0); }
  vec3 haze(vec3 col, vec3 v) {
    float h = max(v.y, 0.0);
    float k = exp(-h * mix(40.0, 3.0, uFog)) * mix(0.25, 1.0, uFog);
    return mix(col, uFogColor, clamp(k, 0.0, 1.0));
  }
  vec3 sky(vec3 v, float stars) {
    vec4 c = clouds(v);
    return haze(mix(skyBase(v, stars), c.rgb, c.a), v);
  }
`;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = (projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0)).xyww;
  }
`;
const skyFragment = (volumetric) => /* glsl */ `
  varying vec3 vDir;
  ${common}${clouds2d}${volumetric ? clouds3d : ''}${skyBase}
  void main() {
    vec3 v = normalize(vDir);
    ${volumetric
    ? 'vec4 c = clouds3(v, gl_FragCoord.xy); vec3 col = haze(mix(skyBase(v, uStars, pow(1.0 - c.a, 3.0)), c.rgb, c.a), v);'
    : 'vec3 col = sky(v, uStars);'}
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Gerstner waves (GPU Gems 1, ch. 1): height A sin(th), points pushed
// toward the crests by Q A cos(th), th = k dir.x - w t + phase, w² = g k
const oceanVertex = (displace) => /* glsl */ `
  ${common}
  varying vec3 vWorld;
  varying vec2 vFlat;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vFlat = w.xz;
    ${displace ? `
    // Only waves several grid cells long move the surface: the rings
    // spread out away from the camera (4.5% of the radius apart)
    float cell = max(length(position.xz) * 0.045, 0.3);
    vec3 d = vec3(0.0);
    for (int i = 0; i < ${NV}; i++) {
      vec4 c = uWave[i];
      float lambda = 6.2831853 / c.z;
      float fade = smoothstep(3.0, 8.0, lambda / cell);
      float th = c.z * dot(c.xy, w.xz) - sqrt(9.81 * c.z) * uTime + uWaveQ[i].y;
      d.xz += c.xy * uWaveQ[i].x * c.w * cos(th) * fade;
      d.y += c.w * sin(th) * fade;
    }
    for (int i = ${NW - 4}; i < ${NW}; i++) {   // the swell
      vec4 c = uWave[i];
      float th = c.z * dot(c.xy, w.xz) - sqrt(9.81 * c.z) * uTime + uWaveQ[i].y;
      float fade = smoothstep(3.0, 8.0, 6.2831853 / c.z / cell);
      d.xz += c.xy * uWaveQ[i].x * c.w * cos(th) * fade;
      d.y += c.w * sin(th) * fade;
    }
    w.xyz += d;` : ''}
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const oceanFragment = (reflect) => /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vFlat;
  uniform float uSeaLevel, uMirrorOn, uFoamJ, uWhitecaps;
  uniform sampler2D uMirror;
  uniform mat4 uMirrorMatrix;
  ${common}${clouds2d}${skyBase}

  // Rain on the sea: each drop leaves a ring that spreads and fades. Cells
  // 0.3 m across, a drop in each now and then (more often in harder rain)
  vec2 rainRings(vec2 p, float t, float cellSize, float seed) {
    vec2 c = floor(p / cellSize), f = fract(p / cellSize);
    vec2 h = hash2(c + seed);
    float life = fract(t * (0.6 + 0.8 * h.y) + h.x);
    if (hash(c + seed + floor(t * (0.6 + 0.8 * h.y) + h.x)) > uRainRate) return vec2(0.0);
    vec2 o = 0.25 + 0.5 * hash2(c + seed + 3.7);
    vec2 dv = f - o;
    float r = length(dv);
    float ring = r - life * 0.5;
    float wave = sin(ring * 45.0) * exp(-ring * ring * 250.0) * (1.0 - life) * (1.0 - life);
    return dv / max(r, 1e-3) * wave * 0.6;
  }

  // Slopes from the wave list, filtered by the pixel's footprint; out: how
  // squeezed the surface is (the Jacobian; whitecaps where it is lowest)
  vec3 waves(vec2 p, float footprint, out float rough, out float jac, out float crest) {
    vec3 nrm = vec3(0.0, 1.0, 0.0);
    rough = 0.0; jac = 1.0; crest = 0.0;
    float amp = 0.0;
    for (int i = 0; i < ${NW}; i++) {
      vec4 c = uWave[i];
      float lambda = 6.2831853 / c.z;
      float fade = 1.0 - smoothstep(lambda * 0.06, lambda * 0.3, footprint);
      float th = c.z * dot(c.xy, p) - sqrt(9.81 * c.z) * uTime + uWaveQ[i].y;
      float wa = c.z * c.w, s = sin(th), co = cos(th);
      nrm.xz -= c.xy * wa * co * fade;
      nrm.y -= uWaveQ[i].x * wa * s * fade;
      if (i < ${NF}) jac -= uWaveQ[i].x * wa * s;
      crest += c.w * s * fade; amp += c.w;
      rough += wa * wa * (1.0 - fade) * 0.5;
    }
    crest /= max(amp, 1e-3);
    // Ripples shorter than the list: from the texture, scaled so that with
    // the list they reach the measured slope for this wind (uRipple, rms),
    // and beaten down by heavy rain
    float ripple = uRipple * (1.0 - 0.5 * uRainRate);
    float fine = 1.0 - smoothstep(0.1, 0.8, footprint);
    if (fine > 0.0) {
      vec2 q1 = p / 9.0 + uWindDir * uTime * 0.05, q2 = p / 3.7 - uWindDir.yx * uTime * 0.09;
      float e = 1.0 / 256.0;
      float a0 = tn(q1).g, b0 = tn(q2).b;
      vec2 s1 = vec2(tn(q1 + vec2(e, 0.0)).g - a0, tn(q1 + vec2(0.0, e)).g - a0) / uNoiseSlope.x;
      vec2 s2 = vec2(tn(q2 + vec2(e, 0.0)).b - b0, tn(q2 + vec2(0.0, e)).b - b0) / uNoiseSlope.y;
      nrm.xz -= fine * ripple * (s1 * 0.8 + s2 * 0.6);
    }
    rough += (1.0 - fine) * ripple * ripple;
    // Rain rings, where a pixel is small enough to see them
    float near = 1.0 - smoothstep(0.02, 0.12, footprint);
    if (uRainRate > 0.0 && near > 0.0) {
      nrm.xz -= near * (rainRings(p, uTime, 0.45, 0.0) + rainRings(p + 0.2, uTime * 1.13, 0.32, 9.0));
    }
    rough += uRainRate * 0.0015 * (1.0 - near);   // further off, rain only roughens it: a matt, grey sheen
    return normalize(nrm);
  }

  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 v = toEye / dist;
    float footprint = length(fwidth(vFlat));
    float rough, jac, crest;
    vec3 n = waves(vFlat, footprint, rough, jac, crest);
    if (dot(n, v) < 0.05) n = normalize(n + v * (0.05 - dot(n, v)));
    vec3 r = reflect(-v, n);
    r.y = abs(r.y);
    float f = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 refl = mix(sky(r, uStars * 0.4), sky(normalize(vec3(r.x, r.y + 0.25, r.z)), 0.0), clamp(rough * 40.0, 0.0, 0.6));
    ${reflect ? `
    // The platform and vessel, mirrored: a picture taken from under the sea,
    // looked up where the flat sea would reflect, nudged by the waves
    if (uMirrorOn > 0.5) {
      vec4 mc = uMirrorMatrix * vec4(vFlat.x, uSeaLevel, vFlat.y, 1.0);
      vec2 muv = mc.xy / mc.w + n.xz * 0.06;
      vec4 m = texture2D(uMirror, muv);
      refl = mix(refl, m.rgb, m.a * exp(-uMss * 25.0));   // a rough sea breaks the image up
    }` : ''}
    vec3 amb = mix(uZenith, uHorizon, 0.5);
    float sunUp = max(uSunDir.y, 0.0);
    // Deep water: very dark blue; light through the crests: green-blue,
    // strongest looking toward the sun
    vec3 deep = vec3(0.0035, 0.016, 0.024) * (lum(amb) * 0.8 + uSunColor * sunUp * 0.06);
    vec2 vf = normalize(-v.xz + 1e-5), sf = normalize(uSunDir.xz + 1e-5);
    float sss = clamp(crest * 0.5 + 0.5, 0.0, 1.0);
    sss = sss * sss * (0.25 + 1.5 * pow(max(dot(vf, sf), 0.0), 3.0)) * smoothstep(1.0, 0.85, v.y);
    vec3 body = deep + vec3(0.006, 0.04, 0.035) * (uSunColor * sunUp * 0.25 + amb * 0.5) * sss * smoothstep(1.0, 8.0, uWindSpeed);
    vec3 col = mix(body, refl, f);
    float r2 = 0.0004 + 2.0 * rough;   // the reflected ray spreads twice the slope
    float clearSun = 1.0 - coverD(coverN(uSunDir.xz / (uSunDir.y + 0.035) * uCloudBase + uCloudShift)) * 0.95 * step(0.0, uSunDir.y);
    col += uSunColor * clearSun * exp((dot(r, uSunDir) - 1.0) / r2) * 0.05 / r2;
    float m2 = 0.0002 + 1.2 * rough;
    col += uMoonColor * 1.5 * (1.0 - uClouds * 0.9) * exp((dot(r, uMoonDir) - 1.0) / m2) * 0.05 / m2;
    // Whitecaps where the waves squeeze and break: the threshold uFoamJ is
    // set so they cover Monahan's measured fraction for this wind; broken
    // up by a texture, and from Beaufort 7 blown into streaks along the wind
    vec3 foamColor = (amb * 0.75 + uSunColor * sunUp * 0.14);
    vec2 aw = vec2(dot(vFlat, uWindDir), dot(vFlat, vec2(-uWindDir.y, uWindDir.x)));
    float breakup = tn(vFlat / 7.0 + uWindDir * uTime * 0.02).r;
    float groups = smoothstep(0.42, 0.62, tn(vFlat / 90.0 - uWindDir * uTime * 0.004).g);   // where waves break together
    // A crest breaks over a few metres to a few tens, not along its whole
    // length: a mask fine across the wind (along the crest) cuts it short
    // uFoamStyle.x: how far a break runs along the crest (0 short, 1 long)
    float pieces = smoothstep(mix(0.5, 0.4, uFoamStyle.x), 0.68, tn(aw / vec2(45.0, mix(11.0, 40.0, uFoamStyle.x)) + vec2(uTime * 0.01, 0.0)).b);
    float cap = smoothstep(uFoamJ + 0.06, uFoamJ - 0.1, jac + (breakup - 0.5) * 0.3) * groups * pieces;
    vec2 aww = aw + (tn(aw / 260.0).rg - 0.5) * vec2(40.0, 14.0);   // streaks wander
    float streak = uFoamStyle.y * mix(0.2, 0.5, smoothstep(17.0, 25.0, uWindSpeed)) * smoothstep(13.0, 18.0, uWindSpeed)
                 * smoothstep(0.58, 0.8, tn(aww / vec2(220.0, 14.0)).g * 0.75 + tn(aww / vec2(60.0, 5.0)).b * 0.25);
    float near = 1.0 - smoothstep(2.0, 15.0, footprint);
    float foam = max(cap, streak) * near * (0.75 + 0.25 * tn(vFlat / 1.7).b);
    // Too far to see single caps: the average cover whitens the sea
    foam = mix(min(1.5 * uWhitecaps + 0.25 * smoothstep(13.0, 22.0, uWindSpeed), 0.5), foam, near);
    col = mix(col, foamColor, clamp(foam, 0.0, 1.0) * 0.85);
    float visibility = mix(60000.0, 350.0, pow(uFog, 0.6));
    col = mix(col, uFogColor, 1.0 - exp(-dist / visibility));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// A disc of rings round the camera, fine near it and coarse far out, for
// the moving surface (variant c)
function ringGrid(rings = 240, segments = 160, inner = 1, outer = 40000) {
  const pos = [], idx = [];
  const ratio = Math.pow(outer / inner, 1 / (rings - 1));
  pos.push(0, 0, 0);
  for (let i = 0; i < rings; i++) {
    const r = inner * ratio ** i;
    for (let j = 0; j < segments; j++) { const a = (j / segments) * Math.PI * 2; pos.push(r * Math.cos(a), 0, r * Math.sin(a)); }
  }
  for (let j = 0; j < segments; j++) idx.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segments; j++) {
    const a = 1 + i * segments + j, b = 1 + i * segments + ((j + 1) % segments), c = a + segments, d = b + segments;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- page

const VARIANTS = {
  now: { label: 'Today', cost: 'what the game draws now' },
  a: { label: 'A · Polish', cost: 'no extra passes' },
  b: { label: 'B · Reflections', cost: '+1 quarter-res render' },
  c: { label: 'C · Cinematic', cost: 'B + moving sea surface' },
};
// Cameras in the platform's Blender frame: [eye, target]
const VIEWS = {
  window: { label: 'Control room window', eye: [40, -32, 40], at: [-60, -400, 14] },
  approach: { label: 'Helicopter approach', eye: [-490, 300, 220], at: [30, 0, 15] },
  sun: { label: 'Into the sun', eye: [-170, -400, 60], at: [30, 10, 10] },
  low: { label: 'Low, by the vessel', eye: [-110, -170, 7], at: [20, -30, 14] },
  surface: { label: 'Close to the water', eye: [-60, -120, 3], at: [-20, -160, 0] },
};
// Weather presets in real units. Wind as outdoor.js maps them (3 + 22 w m/s);
// the North Sea's swell mostly runs in from the Norwegian Sea, north-west.
const PRESETS = {
  clear: { wind: 8.5, clouds: 0.1, fog: 0.05, rain: 0, swellHs: 0.8 },
  cloudy: { wind: 12.9, clouds: 0.55, fog: 0.15, rain: 0, swellHs: 1.0 },
  overcast: { wind: 14, clouds: 0.95, fog: 0.3, rain: 0.15, swellHs: 1.2 },
  storm: { wind: 25, clouds: 1, fog: 0.45, rain: 0.85, swellHs: 2.5 },
  fog: { wind: 6.3, clouds: 0.8, fog: 1, rain: 0, swellHs: 0.6 },
};
const SLIDERS = [
  ['wind', 'Wind', 0, 30, 0.5, (v) => `${v.toFixed(1)} m/s`],
  ['windFrom', 'Wind from', 0, 359, 1, (v) => `${Math.round(v)}° ${compass(v)}`],
  ['swellHs', 'Swell', 0, 4, 0.1, (v) => `${v.toFixed(1)} m`],
  ['swellFrom', 'Swell from', 0, 359, 1, (v) => `${Math.round(v)}° ${compass(v)}`],
  ['clouds', 'Clouds', 0, 1, 0.01, (v) => `${Math.round(v * 8)}/8`],
  ['fog', 'Haze, fog', 0, 1, 0.01, (v) => `${((60000 + (350 - 60000) * v ** 0.6) / 1000).toFixed(1)} km`],
  ['rain', 'Rain', 0, 1, 0.01, (v) => `${(v * 20).toFixed(0)} mm/h`],
  ['time', 'Time', 0, 23.99, 0.05, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`],
];
const compass = (d) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(d / 45) % 8];

const preset = PRESETS[q.get('weather')] ? q.get('weather') : 'cloudy';
const state = {
  variant: VARIANTS[q.get('variant')] ? q.get('variant') : 'c',
  view: VIEWS[q.get('view')] ? q.get('view') : 'low',
  preset,
  time: Number(q.get('time') ?? 11.5),
  windFrom: Number(q.get('windFrom') ?? 225), swellFrom: Number(q.get('swellFrom') ?? 330), swellPeriod: 10,
  ...PRESETS[preset],
  frozen: q.has('t'),
  foam: q.get('foam') ?? 'crests',
};
for (const k of ['wind', 'clouds', 'fog', 'rain', 'swellHs']) if (q.has(k)) state[k] = Number(q.get(k));

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const coarse = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0);
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 80000);
const outdoor = new Outdoor(0, { heading: PLATFORM_HEADING });
scene.add(outdoor.room);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
scene.add(hemi, sun, sun.target);

// The upgraded materials share the Outdoor's uniforms, plus a few of their own
const U = outdoor.uniforms;
Object.assign(U, {
  uNoise: { value: noiseTexture() }, uCamHeight: { value: 0 }, uSeaLevel: { value: 0 },
  uMirror: { value: null }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 },
  uWave: { value: waveU }, uWaveQ: { value: waveQ }, uFoamJ: { value: -10 }, uWhitecaps: { value: 0 },
  uFoamStyle: { value: new THREE.Vector2(1, 0.35) },
  uMss: { value: 0.05 }, uRipple: { value: 0.1 }, uNoiseSlope: { value: noiseSlope },
  uRainRate: { value: 0 }, uWindSpeed: { value: 10 }, uCloudBase: { value: 1500 }, uCloudTop: { value: 2500 }, uStratus: { value: 0 },
});
const stock = { sky: outdoor.sky.material, ocean: outdoor.ocean.material, geometry: outdoor.ocean.geometry };
const mat = (vertexShader, fragmentShader, extra = {}) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: U, ...extra });
const skyOpts = { side: THREE.BackSide, depthWrite: false, depthTest: false };
const MATERIALS = {
  a: { sky: mat(skyVertex, skyFragment(false), skyOpts), ocean: mat(oceanVertex(false), oceanFragment(false)) },
  b: { sky: null, ocean: mat(oceanVertex(false), oceanFragment(true)) },
  c: { sky: null, ocean: mat(oceanVertex(true), oceanFragment(true), { side: THREE.DoubleSide }) },
};
// Adriaen preferred B's clouds to the raymarched 3D ones (2026-10-22): C is
// now B's sky over C's moving sea. The 3D clouds stay here, unused, with
// their half-resolution drawing (clouds3d, drawClouds) in case they return.
const clouds3dSky = mat(skyVertex, skyFragment(true), skyOpts);
MATERIALS.b.sky = MATERIALS.c.sky = MATERIALS.a.sky;
const rings = ringGrid();

// Rain round the camera, wherever it is: outdoor.js fills a fixed box
// outside the control room window. The drops are anchored to the world
// (the box only decides which ones are drawn), so they don't slide when the
// view moves; the control room can still clip its box to the outside.
const RAIN_SIZE = [90, 50, 90];
{
  const n = outdoor.rain.geometry.getAttribute('seed').count / 2, seeds = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    const x = Math.random(), z = Math.random(), y = Math.random();
    seeds.set([x, z, y, 0, x, z, y, 1], i * 8);
  }
  outdoor.rain.geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const ru = outdoor.rain.material.uniforms;
  outdoor.rain.material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 seed;   // x, z, height (0..1), and 0/1 for the streak's top/bottom
      uniform float uTime;
      uniform vec3 uFall, uCenter;
      varying float vFade;
      const vec3 SIZE = vec3(${RAIN_SIZE.map((v) => v.toFixed(1)).join(', ')});
      void main() {
        vec3 lo = uCenter - SIZE * 0.5;
        // where this drop is now: falling and blown, wrapped into the box
        vec3 p = vec3(seed.x, seed.z, seed.y) * SIZE * 7.31 + uFall * uTime;
        p = lo + mod(p - lo, SIZE);
        p -= uFall * 0.07 * seed.w;   // the streak the eye sees while it falls
        vec3 d = abs(p - uCenter) / (SIZE * 0.5);
        vFade = 1.0 - smoothstep(0.7, 1.0, max(d.x, max(d.y, d.z)));
        vFade *= smoothstep(1.0, 4.0, length(p - uCenter));   // not right in the eye
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: outdoor.rain.material.fragmentShader,
    uniforms: { ...ru, uCenter: { value: new THREE.Vector3() } },
    transparent: true, depthWrite: false,
  });
}

let sea = null;
function applyWeather() {
  const s = state;
  sea = buildSea(s, PLATFORM_HEADING);
  // Today's outdoor.js takes wind as 0..1 (3 + 22 w m/s) in its own fixed
  // direction; the upgrades take metres per second and a true bearing
  outdoor.set({ wind: THREE.MathUtils.clamp((s.wind - 3) / 22, 0, 1), clouds: s.clouds, fog: s.fog, rain: s.rain, time: s.time, speed: 0 });
  if (s.variant !== 'now') U.uWindDir.value.copy(bearingDir((s.windFrom + 180) % 360, PLATFORM_HEADING));
  else U.uWindDir.value.set(0.8, -0.6).normalize();
  U.uWindSpeed.value = s.wind;
  U.uFoamStyle.value.set(...FOAM[s.foam]);
  U.uFoamJ.value = sea.foamJ;
  U.uWhitecaps.value = sea.W;
  U.uMss.value = sea.mss;
  U.uRipple.value = sea.ripple;
  U.uRainRate.value = s.rain;
  // Cloud type by cover and rain: fair-weather cumulus, a low stratus deck,
  // a deep dark storm cloud (nimbostratus)
  const st = THREE.MathUtils.smoothstep(s.clouds, 0.7, 1);
  U.uStratus.value = st;
  U.uCloudBase.value = THREE.MathUtils.lerp(1100, 600, st) - 250 * s.rain;
  U.uCloudTop.value = U.uCloudBase.value + THREE.MathUtils.lerp(1400, 500, st) + 2500 * s.rain;
}
// The 3D clouds cost the most and change slowly: they're drawn into a
// smaller target (half the screen's resolution or less), every other frame
// unless the view turns, and the sky shows that picture scaled up
const cloudTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const skyComposite = new THREE.ShaderMaterial({
  vertexShader: skyVertex,
  fragmentShader: /* glsl */ `
    uniform sampler2D uSkyTex;
    uniform vec2 uScreen;
    void main() {
      gl_FragColor = vec4(texture2D(uSkyTex, gl_FragCoord.xy / uScreen).rgb, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  uniforms: { uSkyTex: { value: cloudTarget.texture }, uScreen: { value: new THREE.Vector2(1, 1) } },
  ...skyOpts,
});

// Quality steps for C on a slow or hot GPU, tried in order (see govern())
const LEVELS = [
  { name: 'C', variant: 'c', clouds: 0, res: 1 },
  { name: 'C, screen ¾', variant: 'c', clouds: 0, res: 0.75 },
  { name: 'B, screen ¾', variant: 'b', clouds: 0, res: 0.75 },
];
const quality = { level: 0, auto: true };
const level = () => (state.variant === 'c' ? LEVELS[quality.level] : { variant: state.variant, clouds: 0, res: 1 });

function applyVariant() {
  const v = level().variant;
  outdoor.sky.material = v === 'now' ? stock.sky : v === 'c' && level().clouds ? skyComposite : MATERIALS[v].sky;
  outdoor.ocean.material = v === 'now' ? stock.ocean : MATERIALS[v].ocean;
  outdoor.ocean.geometry = v === 'c' ? rings : stock.geometry;
  U.uMirrorOn.value = v === 'b' || v === 'c' ? 1 : 0;
}

// The mirror: the scene drawn from a camera under the sea, into a small
// half-float target, with everything below the waterline clipped away
const mirrorTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
U.uMirror.value = mirrorTarget.texture;
const mirrorCam = new THREE.PerspectiveCamera();
const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
function renderMirror() {
  const flip = (p) => p.set(p.x, -p.y, p.z);   // sea level 0
  mirrorCam.position.copy(camera.position); flip(mirrorCam.position);
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position); flip(look);
  mirrorCam.up.set(0, 1, 0).applyQuaternion(camera.quaternion); mirrorCam.up.y *= -1;
  mirrorCam.lookAt(look);
  mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
  mirrorCam.updateMatrixWorld();
  U.uMirrorMatrix.value.copy(bias).multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
  outdoor.room.visible = false;
  const old = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.clippingPlanes = [above];
  renderer.setRenderTarget(mirrorTarget);
  renderer.clear();
  renderer.render(scene, mirrorCam);
  renderer.setRenderTarget(null);
  renderer.clippingPlanes = [];
  renderer.setClearColor(0x000000, old);
  outdoor.room.visible = true;
}

// ---------------------------------------------------------------- models

const loader = new GLTFLoader();
function load(name) {
  const inline = window.INTRO_MODELS?.[name];
  if (!inline) return loader.loadAsync('intro/' + name);
  const bin = atob(inline), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return loader.parseAsync(buf.buffer, '');
}
const [platform, vessel] = await Promise.all([load('platform.glb'), load('vessel.glb').catch(() => null)]);
scene.add(platform.scene);
platform.scene.traverse((o) => {
  if (o.isMesh && o.material.name === 'PlatGlass') { o.material.transparent = true; o.material.opacity = 0.5; }
});
if (vessel) {
  vessel.scene.position.copy(B(12, -45, 0));   // at its berth, crane side
  scene.add(vessel.scene);
}

// ---------------------------------------------------------------- controls

const ui = document.querySelector('#ui');
function group(name, options, key, onPick) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="lab">${name}</span>`;
  for (const [k, label] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { onPick ? onPick(k) : (state[key] = k); refresh(); };
    b.dataset.key = key; b.dataset.value = k;
    row.appendChild(b);
  }
  ui.appendChild(row);
  return row;
}
group('Look', Object.entries(VARIANTS).map(([k, v]) => [k, v.label]), 'variant');
group('View', Object.entries(VIEWS).map(([k, v]) => [k, v.label]), 'view', (k) => { state.view = k; placeCamera(); });
// Which white lines dominate a storm: long crest foam across the wind with
// faint streaks (crests), crest foam only (plain), or short crest patches
// with the Beaufort scale's streaks along the wind (streaks)
const FOAM = { crests: [1, 0.35], plain: [1, 0], streaks: [0, 1] };
group('Foam', [['crests', 'Crests, faint streaks'], ['plain', 'Crests only'], ['streaks', 'Streaks along wind']], 'foam');
const weatherRow = group('Weather', Object.keys(PRESETS).map((k) => [k, k]), 'preset', (k) => { state.preset = k; Object.assign(state, PRESETS[k]); });
const toggle = document.createElement('button');
toggle.textContent = 'Sliders';
toggle.className = 'toggle';
weatherRow.appendChild(toggle);
const panel = document.querySelector('#sliders');
toggle.onclick = () => { panel.hidden = !panel.hidden; toggle.classList.toggle('on', !panel.hidden); };
const inputs = {};
for (const [key, label, min, max, step, fmt] of SLIDERS) {
  const row = document.createElement('label');
  row.className = 'slider';
  row.innerHTML = `<span class="lab">${label}</span><input id="s-${key}" type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
  const input = row.querySelector('input'), out = row.querySelector('output');
  input.oninput = () => { state[key] = Number(input.value); if (key !== 'time') state.preset = null; refresh(); };
  inputs[key] = { input, out, fmt };
  panel.appendChild(row);
}
const note = document.querySelector('#note');
let yaw = 0, pitch = 0;
const base = new THREE.Quaternion();
function placeCamera() {
  const view = VIEWS[state.view];
  camera.position.copy(B(...view.eye));
  camera.lookAt(B(...view.at));
  base.copy(camera.quaternion);
  yaw = pitch = 0;
}
function refresh() {
  for (const b of ui.querySelectorAll('button[data-key]')) b.classList.toggle('on', state[b.dataset.key] === b.dataset.value);
  for (const [key, { input, out, fmt }] of Object.entries(inputs)) { input.value = state[key]; out.textContent = fmt(state[key]); }
  applyWeather();
  applyVariant();
  const [bf, name] = beaufort(state.wind);
  const sw = state.swellHs > 0.05 ? ` · swell ${state.swellHs.toFixed(1)} m from ${compass(state.swellFrom)}` : '';
  note.innerHTML = `<b>Beaufort ${bf}, ${name}</b> · wind sea H<sub>s</sub> ${sea.hs.toFixed(1)} m, T<sub>p</sub> ${sea.tp.toFixed(1)} s, ${Math.round(sea.lp)} m long${sw} · whitecaps ${(sea.W * 100).toFixed(sea.W < 0.01 ? 2 : 1)}%`
    + `<span class="cost">${VARIANTS[state.variant].label}: ${VARIANTS[state.variant].cost}</span>`;
}
placeCamera();
refresh();

// Drag to look round
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, yaw, pitch]; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  yaw = drag[2] + (e.clientX - drag[0]) * 0.004;
  pitch = THREE.MathUtils.clamp(drag[3] + (e.clientY - drag[1]) * 0.004, -1.2, 1.2);
});
canvas.addEventListener('pointerup', () => { drag = null; });

// Probe for the 60-to-30 fps drop on phones: draw at a lower resolution, or
// not at all, to tell a GPU that ran out of time (fps comes back) from the
// system capping the page (it doesn't: Low Power Mode, heat, an idle iframe)
const probe = { scale: 1, seaHalf: true, paused: false, start: performance.now(), drops: [], frames: [], work: [], low: 0 };
const basePixelRatio = renderer.getPixelRatio();
const setPixelRatio = () => { renderer.setPixelRatio(basePixelRatio * probe.scale * level().res); resize(); };
const probeRow = group('Probe', [['auto', 'Auto quality'], ['sea', 'Sea at ½ res'], ['1', 'Full res'], ['0.5', 'Half res'], ['0.25', 'Quarter res'], ['pause', 'Pause drawing']], 'probe', (k) => {
  if (k === 'pause') probe.paused = !probe.paused;
  else if (k === 'sea') probe.seaHalf = !probe.seaHalf;
  else if (k === 'auto') { quality.auto = !quality.auto; if (!quality.auto) setLevel(0, performance.now()); }
  else { probe.scale = Number(k); setPixelRatio(); }
});

// The fallback switch. Frames that stay slow for two seconds step quality
// down one level; if that doesn't speed them up, it wasn't the GPU but a
// frame cap (Low Power Mode, a throttled page), so it steps back and leaves
// quality alone for a while. After 20 s of smooth frames it tries one level
// up again, waiting twice as long each time that fails.
const gov = { pending: null, holdUntil: 0, upAfter: 20000, upAt: 0, steppedUpAt: -1e9, changedAt: 0 };
function setLevel(i, now) {
  if (i === quality.level) return;
  quality.level = i;
  gov.changedAt = now;
  probe.frames.length = probe.work.length = 0;   // measure afresh
  applyVariant();
  setPixelRatio();
}
function govern(now, span) {
  if (!quality.auto || state.variant !== 'c' || probe.paused || document.hidden) return;
  if (gov.pending) {
    if (now - gov.pending.at < 2500) return;
    if (span > gov.pending.span * 0.85) {   // no faster: a cap, not the GPU
      setLevel(gov.pending.from, now);
      gov.holdUntil = now + 30000;
      probe.drops.push(`${mmss(now - probe.start)} capped, not GPU`);
    }
    gov.pending = null;
    return;
  }
  if (now < gov.holdUntil || now - gov.changedAt < 2000) return;
  if (span > 20 && quality.level < LEVELS.length - 1) {
    if (now - gov.steppedUpAt < 6000) gov.upAfter *= 2;   // the last step up didn't hold
    gov.pending = { from: quality.level, at: now, span };
    setLevel(quality.level + 1, now);
  } else if (span < 17.5 && quality.level > 0 && now - gov.changedAt > gov.upAfter) {
    gov.steppedUpAt = now;
    setLevel(quality.level - 1, now);
  }
}
const probeLine = document.createElement('div');
probeLine.id = 'probe';
document.querySelector('#dock').appendChild(probeLine);
const mmss = (ms) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
document.addEventListener('visibilitychange', () => probe.drops.push(`${mmss(performance.now() - probe.start)} ${document.visibilityState}`));
function probeTick(now, work) {
  probe.frames.push(now); probe.work.push(work);
  while (probe.frames.length > 60) { probe.frames.shift(); probe.work.shift(); }
  if (probe.frames.length < 60) return;
  const span = (probe.frames[59] - probe.frames[0]) / 59, fps = 1000 / span;
  // A drop: under 45 fps for a full second; noted once with what was on
  probe.low = fps < 45 ? probe.low + 1 : 0;
  if (probe.low === 60) probe.drops.push(`${mmss(now - probe.start)} drop: ${state.variant}, ${state.view}, ${state.preset ?? 'sliders'}, ${probe.paused ? 'paused' : `res ×${probe.scale}`}`);
  govern(now, span);
  if (probe.frames.length < 60) return;
  const sorted = [...probe.work].sort((a, b) => a - b);
  for (const b of probeRow.querySelectorAll('button')) {
    const k = b.dataset.value;
    b.classList.toggle('on', k === 'pause' ? probe.paused : k === 'auto' ? quality.auto : k === 'sea' ? probe.seaHalf : Number(k) === probe.scale);
  }
  const lv = state.variant === 'c' ? `${LEVELS[quality.level].name}${quality.auto ? ' (auto)' : ''} · ` : '';
  probeLine.textContent = `${lv}${span.toFixed(1)} ms/frame · page work ${sorted[30].toFixed(1)} ms (worst ${sorted[59].toFixed(1)}) · ${renderer.info.render.calls} draws · up ${mmss(now - probe.start)}`
    + (probe.drops.length ? ` · ${probe.drops.slice(-3).join(' · ')}` : '');
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 55;
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  mirrorTarget.setSize(Math.ceil(w * pr / 4), Math.ceil(h * pr / 4));   // quarter resolution
  const k = Math.max(level().clouds, 0.1);
  cloudTarget.setSize(Math.ceil(w * pr * k), Math.ceil(h * pr * k));
  skyComposite.uniforms.uScreen.value.set(w * pr, h * pr);
}
addEventListener('resize', resize);
resize();

// A wind arrow, turned to the view: up the screen is straight ahead
const windArrow = document.createElement('div');
windArrow.id = 'wind';
windArrow.innerHTML = '<svg viewBox="-20 -20 40 40" width="44" height="44" aria-hidden="true"><circle r="18" /><path d="M0 -13 L6 3 L1.5 1 L1.5 13 L-1.5 13 L-1.5 1 L-6 3 Z" /></svg><span></span>';
document.body.appendChild(windArrow);
function pointWind() {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const ahead = Math.atan2(f.x, -f.z), wind = Math.atan2(U.uWindDir.value.x, -U.uWindDir.value.y);
  windArrow.querySelector('svg').style.transform = `rotate(${THREE.MathUtils.radToDeg(wind - ahead)}deg)`;
  windArrow.querySelector('span').textContent = `wind ${state.wind.toFixed(0)} m/s`;
}

let last = performance.now(), frameNo = 0;
const lastLook = new THREE.Quaternion();
function drawClouds() {
  // Every other frame, or at once when the view turns
  const turned = lastLook.angleTo(camera.quaternion) > 1e-4;
  if (frameNo % 2 && !turned) return;
  lastLook.copy(camera.quaternion);
  outdoor.sky.material = clouds3dSky;
  outdoor.ocean.visible = false;
  renderer.setRenderTarget(cloudTarget);
  outdoor.render(renderer, camera);
  renderer.setRenderTarget(null);
  outdoor.ocean.visible = true;
  outdoor.sky.material = skyComposite;
}
// The sea and sky at half the screen's resolution, scaled up under the
// sharp platform: Adriaen found the sea smoother this way, and it costs a
// quarter of the pixels. Drawn linear into a half-float target, tone mapped
// on the way to the screen.
const seaTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const blitGeometry = new THREE.BufferGeometry();
blitGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const blit = new THREE.Mesh(blitGeometry, new THREE.ShaderMaterial({
  vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D uTex;
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  uniforms: { uTex: { value: seaTarget.texture } }, depthTest: false, depthWrite: false,
}));
blit.frustumCulled = false;
const blitScene = new THREE.Scene().add(blit), blitCamera = new THREE.Camera();
function drawSea() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(0.5).ceil();
  if (seaTarget.width !== size.x || seaTarget.height !== size.y) seaTarget.setSize(size.x, size.y);
  renderer.setRenderTarget(seaTarget);
  outdoor.render(renderer, camera);
  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(blitScene, blitCamera);
  renderer.clearDepth();
}

function frame(now) {
  frameNo++;
  if (Math.abs(renderer.getPixelRatio() - basePixelRatio * probe.scale * level().res) > 1e-3) setPixelRatio();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  camera.quaternion.copy(base)
    .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch));
  camera.updateMatrixWorld();
  outdoor.update(state.frozen ? 0 : dt);
  if (state.frozen) U.uTime.value = Number(q.get('t'));
  const L = outdoor.light;
  renderer.toneMappingExposure = L.exposure;
  hemi.color.copy(L.sky).multiplyScalar(Math.PI);
  hemi.groundColor.copy(L.sky).multiplyScalar(0.3);
  sun.color.copy(L.sun);
  sun.position.copy(L.sunDir).multiplyScalar(100);
  scene.fog.color.copy(L.fog);
  scene.fog.density = Math.LN2 / L.fogDistance;
  U.uCamHeight.value = camera.position.y;
  outdoor.rain.material.uniforms.uCenter.value.copy(camera.position);
  pointWind();
  if (!probe.paused) {
    if (U.uMirrorOn.value) renderMirror();
    if (level().variant === 'c' && level().clouds) drawClouds();
    if (probe.seaHalf) drawSea();
    else outdoor.render(renderer, camera);
    renderer.render(scene, camera);
  }
  probeTick(now, performance.now() - now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.querySelector('#status').hidden = true;
window.prototypeReady = true;
