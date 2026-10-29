// The world outside the control room window: a sky and an ocean drawn live,
// for any time of day and any weather. Nothing here is baked. The sky's
// colours come from a small table indexed by the sun's elevation, and the
// same numbers tint the room's baked sky light map (see controlScene.js), so
// the daylight on the desks and the platform follows what is in the window.
//
// The sky and the sea are drawn first, by a camera of their own that reaches
// to the horizon; the room is drawn over them with its own near and far
// planes. In the main view they are drawn at half the screen's resolution
// and scaled up under the sharp room (smoother, and a quarter of the
// pixels). A depth-only copy of the sea surface in the room's pass hides
// whatever sits under the water: the platform's legs, the vessel's hull.
//
// The sea follows the wind the way the real one does: wave height and period
// from a JONSWAP spectrum for the wind speed and the fetch (capped at a fully
// developed Pierson-Moskowitz sea), waves running downwind with a spread
// that widens for shorter waves, a swell from its own direction, roughness
// from Cox and Munk's measured slopes and whitecap cover from Monahan's fit.
// Two looks (see Outdoor.quality): C moves the surface with Gerstner waves
// and mirrors the platform and vessel in it; B is the fallback, the same sea
// and mirror on a flat surface. A slow GPU steps C down to B by itself.
import * as THREE from 'three';
import { Neighbour, LOOKS } from './neighbour.js';

// Where on Earth: the northern North Sea. Which way is north depends on the
// frame a page draws in: `heading` (new Outdoor) is the true bearing of its
// -z axis. The platform's long axis runs 060°-240° (flare end to the
// north-east, helideck end to the south-west) and its crane side faces 330°:
// in the control room's frame -z points along the platform to the flare,
// 060° (ROOM_HEADING), so the window (-x) looks out north-north-west; in the
// platform's own frame (Blender's axes) -z is its +Y, 150° (PLATFORM_HEADING).
const LATITUDE = 58.8;
export const ROOM_HEADING = 60;
export const PLATFORM_HEADING = 150;

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
// shift it hangs low in the west-south-west (to the left of the control
// room's north-north-west window) and sets soon after midnight
const MOON_ELONGATION = THREE.MathUtils.degToRad(100);
const MOON_RADIUS = 0.009; // rad, a little larger than life so it reads on a phone
export const REAL_TIME = 1 / 3600;
const CCTV_GAIN = 8; // the cameras' most exposure gain: at night they see little

// Presets for the weather buttons: cloud cover, wind, fog, rain (all 0..1;
// wind is 3 + 22 w m/s) and the swell's height in metres. The North Sea's
// swell mostly runs in from the Norwegian Sea, north-west.
export const WEATHER = {
  clear: { clouds: 0.1, wind: 0.25, fog: 0.05, rain: 0, swellHs: 0.8 },
  cloudy: { clouds: 0.55, wind: 0.45, fog: 0.15, rain: 0, swellHs: 1.0 },
  overcast: { clouds: 0.95, wind: 0.5, fog: 0.3, rain: 0.15, swellHs: 1.2 },
  storm: { clouds: 1, wind: 1, fog: 0.45, rain: 0.85, swellHs: 2.5 },
  fog: { clouds: 0.8, wind: 0.15, fog: 1, rain: 0, swellHs: 0.6 },
};
export const windSpeed = (w) => 3 + 22 * w;   // m/s for the 0..1 wind setting

// Rain round the camera, wherever it is: drops anchored to the world (the
// box only decides which are drawn, so they don't slide as the view turns)
const RAIN_DROPS = 8000;
const RAIN_SIZE = [90, 50, 90];

// ---------------------------------------------------------------- sea state

const G = 9.81;
const FETCH = 250e3;     // m of open water upwind: the northern North Sea
const NW = 28;           // wave components: 24 wind sea + 4 swell
const NV = 14;           // how many of the longest wind waves move the surface (C)
const NF = 10;           // the dominant waves, whose breaking crests make whitecaps
// Objects on this layer are drawn in the sea's mirror (reflectable())
export const MIRROR_LAYER = 7;

const BEAUFORT = [[0.3, 'calm'], [1.6, 'light air'], [3.4, 'light breeze'], [5.5, 'gentle breeze'], [8, 'moderate breeze'],
  [10.8, 'fresh breeze'], [13.9, 'strong breeze'], [17.2, 'near gale'], [20.8, 'gale'], [24.5, 'strong gale'],
  [28.5, 'storm'], [32.7, 'violent storm'], [Infinity, 'hurricane force']];
// Beaufort force and name for a wind of u m/s
export const beaufort = (u) => { const i = BEAUFORT.findIndex(([v]) => u < v); return [i, BEAUFORT[i][1]]; };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (d) => COMPASS[Math.round(d / 45) % 8];

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
// -z points at `heading` (rad), as toward() below
function bearingDir(bearing, heading) {
  const b = THREE.MathUtils.degToRad(bearing);
  const east = Math.sin(b), north = Math.cos(b), c = Math.cos(heading), s = Math.sin(heading);
  return new THREE.Vector2(east * c - north * s, -(north * c + east * s));
}

// The wave components for a weather state s (wind 0..1, windFrom, swellHs,
// swellFrom, swellPeriod), written into the uniform arrays waveU (dir.x,
// dir.z, k, amplitude) and waveQ (choppiness, phase). Returns the numbers
// the shaders and the screens need.
const golden = (i) => (i * 0.6180339887) % 1;
function buildSea(s, heading, waveU, waveQ) {
  const u = windSpeed(s.wind);
  const { hs, wp } = windSea(u);
  const down = (s.windFrom + 180) % 360;   // wind waves run downwind
  // JONSWAP spectrum, sampled at 24 log-spaced frequencies from 0.7 to 9 wp
  const gamma = 3.3, n = NW - 4, lo = Math.log(0.7 * wp), hi = Math.log(9 * wp);
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
  const ks = (2 * Math.PI / s.swellPeriod) ** 2 / G;
  for (let i = 0; i < 4; i++) {
    comps.push({ dir: bearingDir((s.swellFrom + 180) % 360 + [-6, 4, -2, 8][i], heading), k: ks * [1, 1.08, 0.93, 1.17][i], a: Math.sqrt([0.4, 0.3, 0.2, 0.1][i] * 2) * s.swellHs / 4 });
  }
  // Choppiness: crests sharpen with steepness, kept short of folding over
  const steep = comps.reduce((sum, c) => sum + c.k * c.a, 0);
  const chop = Math.min(1, 0.85 / Math.max(steep, 1e-6));
  comps.forEach((c, i) => {
    c.q = chop; c.phase = golden(i * 13 + 5) * 6.2832; c.w = Math.sqrt(G * c.k);
    waveU[i].set(c.dir.x, c.dir.y, c.k, c.a); waveQ[i].set(chop, c.phase);
  });
  // Whitecaps where the dominant wind waves squeeze the surface most, the
  // Gerstner Jacobian being lowest: find the level that covers the measured
  // whitecap fraction. Waves break in groups and only along a short stretch
  // of each crest, so the shader keeps about a fifth of the candidate crest:
  // ask the Jacobian for five times the cover.
  const W = whitecaps(u), J = [];
  for (let k = 0; k < 3000; k++) {
    const x = (golden(k * 3 + 1) - 0.5) * 4000, z = (golden(k * 5 + 2) - 0.5) * 4000, t = golden(k * 11) * 100;
    let j = 1;
    for (const c of comps.slice(0, NF)) j -= chop * c.k * c.a * Math.sin(c.k * (c.dir.x * x + c.dir.y * z) - c.w * t + c.phase);
    J.push(j);
  }
  J.sort((a, b) => a - b);
  const foamJ = W > 1e-5 ? J[Math.min(J.length - 1, Math.floor(Math.min(5 * W, 0.7) * J.length))] : -10;
  // Roughness the wave list can't draw: the measured mean square slope of
  // the sea (Cox & Munk 1954, clean surface) less what the list already has
  const mss = 0.003 + 0.00512 * u;
  const listMss = comps.slice(0, n).reduce((sum, c) => sum + (c.k * c.a) ** 2 / 2, 0);
  // The waves that move the surface, for heightAt()
  const moving = comps.filter((c, i) => i < NV || i >= n);
  return { hs, tp: 2 * Math.PI / wp, W, foamJ, mss, ripple: Math.sqrt(Math.max(mss - listMss, 0.0005)), moving };
}

// ---------------------------------------------------------------- noise

// A tileable fbm texture, one field in each channel: clouds and the finest
// ripples read it instead of computing noise per pixel. Made once.
let noise = null;
function noiseTexture(size = 256) {
  if (noise) return noise;
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
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  noise = { texture, slope: new THREE.Vector2(rms[0] * size, rms[1] * size) };
  return noise;
}

// A disc of rings round the camera, fine near it and coarse far out, for
// the moving surface: rings 4.5% of their radius apart, out to 40 km
let rings = null;
function ringGrid(count = 240, segments = 160, inner = 1, outer = 40000) {
  if (rings) return rings;
  const pos = [], idx = [];
  const ratio = Math.pow(outer / inner, 1 / (count - 1));
  pos.push(0, 0, 0);
  for (let i = 0; i < count; i++) {
    const r = inner * ratio ** i;
    for (let j = 0; j < segments; j++) { const a = (j / segments) * Math.PI * 2; pos.push(r * Math.cos(a), 0, r * Math.sin(a)); }
  }
  for (let j = 0; j < segments; j++) idx.push(0, 1 + ((j + 1) % segments), 1 + j);
  for (let i = 0; i < count - 1; i++) for (let j = 0; j < segments; j++) {
    const a = 1 + i * segments + j, b = 1 + i * segments + ((j + 1) % segments), c = a + segments, d = b + segments;
    idx.push(a, b, c, b, d, c);
  }
  rings = new THREE.BufferGeometry();
  rings.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rings.setIndex(idx);
  return rings;
}

// ---------------------------------------------------------------- shaders

// The moving surface, for any shader that has to sit on it (the sea, its
// depth-only copy, a ship's wake): Gerstner waves (GPU Gems 1, ch. 1),
// height A sin(th), points pushed toward the crests by Q A cos(th),
// th = k dir.x - w t + phase, w² = g k. Only waves several grid cells long
// move it (`cell`: the sea grid's spacing there, 4.5% of the distance from
// the camera), and nothing moves while uDisplace is off (look B).
export const SEA_SURFACE = /* glsl */ `
  uniform vec4 uWave[${NW}];
  uniform vec2 uWaveQ[${NW}];
  uniform float uSeaTime, uDisplace;
  vec3 seaDisplace(vec2 p, float cell) {
    vec3 d = vec3(0.0);
    if (uDisplace < 0.5) return d;
    for (int i = 0; i < ${NW}; i++) {
      if (i >= ${NV} && i < ${NW - 4}) continue;   // the short wind waves only roughen it
      vec4 c = uWave[i];
      float fade = smoothstep(3.0, 8.0, 6.2831853 / c.z / cell);
      float th = c.z * dot(c.xy, p) - sqrt(9.81 * c.z) * uSeaTime + uWaveQ[i].y;
      d.xz += c.xy * uWaveQ[i].x * c.w * cos(th) * fade;
      d.y += c.w * sin(th) * fade;
    }
    return d;
  }
  float seaCell(vec2 p) { return max(length(p - cameraPosition.xz) * 0.045, 0.3); }
`;

const common = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunColor, uSunDir, uMoonDir, uMoonColor, uFogColor;
  uniform float uClouds, uFog, uStars, uMoonShow, uMoonPhase, uRainRate, uWindSpeed;
  uniform float uCloudBase, uStratus, uMss, uRipple;
  uniform vec2 uNoiseSlope, uCloudShift, uWindDir;
  uniform sampler2D uNoise;
  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  vec2 hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
  float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 tn(vec2 p) { return texture2D(uNoise, p).rgb; }
`;

// Clouds on one layer: cumulus that merge into a flat stratus deck as the
// cover closes, lit by how much cloud lies between each point and the sun,
// and high cirrus combed out along the wind in clearer skies
const clouds = /* glsl */ `
  float coverN(vec2 p) {
    vec2 w = tn(p / 23000.0).gb - 0.5;
    p += w * 2600.0;
    float cu = tn(p / 7000.0).r * 0.6 + tn(p / 1900.0).g * 0.28 + tn(p / 520.0).b * 0.12;
    float st = tn(p / 16000.0).r * 0.75 + tn(p / 4000.0).g * 0.25;   // stratus: broad, soft
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

// The sky behind the clouds: a gradient that glows toward a low sun, the
// sun and moon and their halos, stars; then the clouds, then the haze
const sky = /* glsl */ `
  vec3 skyBase(vec3 v, float stars) {
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
    // Overcast flattens the gradient toward grey
    col = mix(col, vec3(0.92, 0.96, 1.05) * lum(col) * 0.5, 0.85 * uClouds * uClouds);
    if (stars > 0.0 && v.y > 0.0) {
      vec3 cell = floor(v * 260.0);
      float r = hash3(cell);
      if (r > 0.99) {
        vec3 c = (cell + 0.5) / 260.0;
        float m = (r - 0.99) / 0.01;  // magnitude: many faint stars, a few bright ones
        float b = smoothstep(0.0012 + 0.0016 * m, 0.0, length(v - normalize(c)));
        b *= 0.7 + 0.3 * sin(uTime * (2.0 + r * 40.0) + r * 900.0);  // twinkle
        b *= smoothstep(0.0, 0.25, v.y);   // fewer near the horizon, where the air is thick
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
      float maria = 0.8 + 0.2 * sin(off.x * 5.0 + 1.0) * sin(off.y * 4.0 - off.z * 3.0);
      col += vec3(1.0, 0.98, 0.92) * (1.0 - smoothstep(0.92, 1.0, sqrt(rr))) * mix(0.012, 2.5 * maria, lit) * uMoonShow;
    }
    return col;
  }
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
const skyFragment = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  ${common}${clouds}${sky}
  void main() {
    gl_FragColor = vec4(sky(normalize(vDir), uStars), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const oceanVertex = /* glsl */ `
  ${SEA_SURFACE}
  varying vec3 vWorld;
  varying vec2 vFlat;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vFlat = w.xz;
    w.xyz += seaDisplace(w.xz, max(length(position.xz) * 0.045, 0.3));
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const oceanFragment = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vFlat;
  uniform vec4 uWave[${NW}];
  uniform vec2 uWaveQ[${NW}];
  uniform float uTime, uSeaLevel, uMirrorOn, uFoamJ, uWhitecaps;
  uniform sampler2D uMirror;
  uniform mat4 uMirrorMatrix;
  ${common}${clouds}${sky}

  // Rain on the sea: each drop leaves a ring that spreads and fades
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

  // The normal from the wave list, filtered by the pixel's footprint (waves
  // too short for it fade out and their slope goes into roughness, so the sea
  // doesn't shimmer); out: how squeezed the surface is (the Jacobian;
  // whitecaps where it is lowest) and how high on a crest the point is
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
      vec2 q1 = p / 9.0 - uWindDir * uTime * 0.05, q2 = p / 3.7 - uWindDir.yx * uTime * 0.09;
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
    // The platform and vessel, mirrored: a picture taken from under the sea,
    // looked up where the flat sea would reflect, nudged by the waves
    if (uMirrorOn > 0.5) {
      vec4 mc = uMirrorMatrix * vec4(vFlat.x, uSeaLevel, vFlat.y, 1.0);
      vec4 m = texture2D(uMirror, mc.xy / mc.w + n.xz * 0.06);
      refl = mix(refl, m.rgb, m.a * exp(-uMss * 25.0));   // a rough sea breaks the image up
    }
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
    // The sun's and moon's glitter, wider when the sea is rough
    float r2 = 0.0004 + 2.0 * rough;   // the reflected ray spreads twice the slope
    float clearSun = 1.0 - coverD(coverN(uSunDir.xz / (uSunDir.y + 0.035) * uCloudBase + uCloudShift)) * 0.95 * step(0.0, uSunDir.y);
    col += uSunColor * clearSun * exp((dot(r, uSunDir) - 1.0) / r2) * 0.05 / r2;
    float m2 = 0.0002 + 1.2 * rough;
    col += uMoonColor * 1.5 * (1.0 - uClouds * 0.9) * exp((dot(r, uMoonDir) - 1.0) / m2) * 0.05 / m2;
    // Whitecaps where the waves squeeze and break: the threshold uFoamJ is
    // set so they cover Monahan's measured fraction for this wind. Waves
    // break together in groups, and a crest breaks over a few metres to a
    // few tens, not along its whole length: masks cut the caps short.
    // Crest foam only, no streaks down the wind (Adriaen's pick).
    vec3 foamColor = amb * 0.75 + uSunColor * sunUp * 0.14;
    vec2 aw = vec2(dot(vFlat, uWindDir), dot(vFlat, vec2(-uWindDir.y, uWindDir.x)));
    float breakup = tn(vFlat / 7.0 - uWindDir * uTime * 0.02).r;
    float groups = smoothstep(0.42, 0.62, tn(vFlat / 90.0 - uWindDir * uTime * 0.004).g);
    float pieces = smoothstep(0.4, 0.68, tn(aw / vec2(45.0, 40.0) - vec2(uTime * 0.01, 0.0)).b);
    float cap = smoothstep(uFoamJ + 0.06, uFoamJ - 0.1, jac + (breakup - 0.5) * 0.3) * groups * pieces;
    float near = 1.0 - smoothstep(2.0, 15.0, footprint);
    float foam = cap * near * (0.75 + 0.25 * tn(vFlat / 1.7).b);
    // Too far to see single caps: the average cover whitens the sea
    foam = mix(min(1.5 * uWhitecaps + 0.25 * smoothstep(13.0, 22.0, uWindSpeed), 0.5), foam, near);
    col = mix(col, foamColor, clamp(foam, 0.0, 1.0) * 0.85);
    // Distance fog, toward the same colour as the sky's horizon
    float visibility = mix(60000.0, 350.0, pow(uFog, 0.6));
    col = mix(col, uFogColor, 1.0 - exp(-dist / visibility));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The sea surface as depth only, in the room's (or scene's) own pass
const surfaceFragment = /* glsl */ 'void main() { gl_FragColor = vec4(0.0); }';

const rainVertex = /* glsl */ `
  attribute vec4 seed;   // x, z, height (0..1), and 0/1 for the streak's top/bottom
  uniform float uTime, uMaxX;
  uniform vec3 uFall, uCenter;
  varying float vFade;
  const vec3 SIZE = vec3(${RAIN_SIZE.map((v) => v.toFixed(1)).join(', ')});
  void main() {
    vec3 lo = uCenter - SIZE * 0.5;
    // Where this drop is now: falling and blown, wrapped into the box
    vec3 p = vec3(seed.x, seed.z, seed.y) * SIZE * 7.31 + uFall * uTime;
    p = lo + mod(p - lo, SIZE);
    p -= uFall * 0.07 * seed.w;   // motion blur: the streak a drop draws while the eye looks
    vec3 d = abs(p - uCenter) / (SIZE * 0.5);
    vFade = 1.0 - smoothstep(0.7, 1.0, max(d.x, max(d.y, d.z)));
    vFade *= smoothstep(1.0, 4.0, length(p - uCenter));   // not right in the eye
    vFade *= step(p.x, uMaxX);                            // the control room: only outside its window
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const rainFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    if (vFade <= 0.0) discard;
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

function interp(e, slot) {
  let i = 1;
  while (i < KEYS.length - 1 && KEYS[i][0] < e) i++;
  const [e0, ...a] = KEYS[i - 1], [e1, ...b] = KEYS[i];
  const t = THREE.MathUtils.clamp((e - e0) / (e1 - e0), 0, 1);
  return new THREE.Color(...a[slot - 1].map((x, k) => x + (b[slot - 1][k] - x) * t));
}

// Unit vector toward a body at the given declination and hour angle (radians)
// seen from LATITUDE, in three's axes with -z at true bearing `heading` (rad)
function toward(decl, hourAngle, heading = 0) {
  const lat = THREE.MathUtils.degToRad(LATITUDE);
  const east = -Math.cos(decl) * Math.sin(hourAngle);
  const north = Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(hourAngle);
  const up = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const c = Math.cos(heading), s = Math.sin(heading);
  return new THREE.Vector3(east * c - north * s, up, -(north * c + east * s)).normalize();
}


// Let an object (and everything under it, lights included) show in the
// sea's mirror: pass its scene to render() as `reflect`
export function reflectable(...objects) {
  for (const o of objects) o.traverse((c) => c.layers.enable(MIRROR_LAYER));
}

// The two looks, best first; the governor in render() steps down a level
// when frames stay slow, and back up when they've been smooth for a while
const LEVELS = ['c', 'b'];
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
// From inside the room the sky and sea only show through the window, so the
// main view draws them (and the mirror) only in the window's box on screen,
// and not at all while the window is out of view; ?seaclip=0 draws them full
// screen, as before
const SEA_CLIP = new URLSearchParams(location.search).get('seaclip') !== '0';
const MIRROR_NUDGE = 0.06;   // how far the waves move a mirror lookup (oceanFragment), in texture widths

// The part of a convex polygon (world points) in front of a camera, in the
// camera's view space (Sutherland-Hodgman against a plane just ahead of it;
// not the near plane, as what is nearer still shows sky through it)
function inFront(points, camera) {
  const v = points.map((p) => p.clone().applyMatrix4(camera.matrixWorldInverse));
  const z = -1e-3, out = [];
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length], ina = a.z <= z, inb = b.z <= z;
    if (ina) out.push(a);
    if (ina !== inb) out.push(a.clone().lerp(b, (z - a.z) / (b.z - a.z)));
  }
  return out;
}

// The box in pixels (x, y from the bottom left, w, h) that view-space points
// cover in a w×h picture, grown by `margin` pixels and kept inside it; null
// when it misses the picture
function screenBox(view, camera, w, h, margin) {
  if (view.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of view) {
    p.applyMatrix4(camera.projectionMatrix);   // view space to normalised device coordinates
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const ax = Math.max(0, Math.floor((x0 * 0.5 + 0.5) * w - margin)), bx = Math.min(w, Math.ceil((x1 * 0.5 + 0.5) * w + margin));
  const ay = Math.max(0, Math.floor((y0 * 0.5 + 0.5) * h - margin)), by = Math.min(h, Math.ceil((y1 * 0.5 + 0.5) * h + margin));
  return bx > ax && by > ay ? new THREE.Vector4(ax, ay, bx - ax, by - ay) : null;
}

export class Outdoor {
  // seaLevel: the sea's height in the frame (m); heading: the true bearing of
  // the frame's -z axis in degrees (ROOM_HEADING, PLATFORM_HEADING); origin:
  // where our platform's origin is in the frame (x, z), for the neighbour
  // platform on the horizon
  constructor(seaLevel, { heading = 0, origin = [0, 0] } = {}) {
    this.seaLevel = seaLevel;
    this.heading = THREE.MathUtils.degToRad(heading);
    // time in hours (local solar time), day of year, weather (0..1, wind as
    // 3 + 22 w m/s), where the wind and swell come from (true bearings) and
    // the swell's height (m) and period (s); speed: hours per second, the
    // clock runs in real time unless sped up
    this.state = {
      time: 22.5, day: 294, clouds: 0.3, wind: 0.35, fog: 0.1, rain: 0, speed: REAL_TIME,
      windFrom: 225, swellHs: 0.9, swellFrom: 330, swellPeriod: 10,
    };
    const tex = noiseTexture();
    this.waveU = Array.from({ length: NW }, () => new THREE.Vector4());
    this.waveQ = Array.from({ length: NW }, () => new THREE.Vector2());
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() }, uMoonColor: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uClouds: { value: 0 }, uFog: { value: 0 }, uStars: { value: 0 }, uTime: { value: 0 }, uMoonShow: { value: 0 }, uMoonPhase: { value: 0 },
      uCloudShift: { value: new THREE.Vector2() }, uCloudBase: { value: 1100 }, uStratus: { value: 0 },
      uWindDir: { value: new THREE.Vector2(0, 1) }, uWindSpeed: { value: 10 }, uRainRate: { value: 0 },
      uNoise: { value: tex.texture }, uNoiseSlope: { value: tex.slope },
      uWave: { value: this.waveU }, uWaveQ: { value: this.waveQ }, uDisplace: { value: 1 },
      uFoamJ: { value: -10 }, uWhitecaps: { value: 0 }, uMss: { value: 0.05 }, uRipple: { value: 0.1 },
      uSeaLevel: { value: seaLevel }, uMirror: { value: null }, uMirrorMatrix: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 },
    };
    // What a shader needs to sit on the moving surface (SEA_SURFACE)
    const u = this.uniforms;
    u.uSeaTime = u.uTime;
    this.surfaceUniforms = { uWave: u.uWave, uWaveQ: u.uWaveQ, uSeaTime: u.uTime, uDisplace: u.uDisplace };
    this.scene = new THREE.Scene();
    this.scene.name = 'sky + sea';   // pass names for the perf overlay (perf.js)
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 80000);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: u, side: THREE.BackSide, depthWrite: false, depthTest: false }));
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.ocean = new THREE.Mesh(ringGrid(),
      new THREE.ShaderMaterial({ vertexShader: oceanVertex, fragmentShader: oceanFragment, uniforms: u, side: THREE.DoubleSide }));
    this.ocean.frustumCulled = false;
    this.scene.add(this.sky, this.ocean);
    // The neighbour platform on the horizon, in a pass of its own at full
    // resolution (it is only a few pixels wide); ?neighbour=a|b|c picks the
    // look, 0 hides it
    const look = new URLSearchParams(location.search).get('neighbour') ?? 'b';
    this.far = new THREE.Scene();
    this.far.name = 'neighbour';
    if (LOOKS[look]) {
      this.neighbour = new Neighbour(look);
      this.neighbour.place(this.heading, new THREE.Vector3(origin[0], seaLevel, origin[1]));
      this.far.add(this.neighbour.group);
    }
    // In the room's own pass: the sea surface as depth only, so the platform's
    // legs and the vessel's hull end at the waterline. surface() makes more
    // for other scenes (the CCTV's); render() keeps them all under its camera.
    this.surfaces = [];
    this.waterline = this.surface();
    // Rain, also in the room's pass so the walls hide it: streaks falling
    // in the air round the camera
    const seeds = new Float32Array(RAIN_DROPS * 8);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = Math.random(), z = Math.random(), y = Math.random();
      seeds.set([x, z, y, 0, x, z, y, 1], i * 8);
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_DROPS * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.ShaderMaterial({
      vertexShader: rainVertex, fragmentShader: rainFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: u.uTime, uFall: { value: new THREE.Vector3(0, -9, 0) }, uColor: { value: new THREE.Color() }, uCenter: { value: new THREE.Vector3() }, uMaxX: { value: 1e9 } },
    }));
    this.rain.frustumCulled = false;
    this.room = new THREE.Group();
    this.room.add(this.waterline, this.rain);
    this.wet = 0;  // how wet the window is: it dries slowly after the rain

    // The mirror: the scene drawn from a camera under the sea into a small
    // half-float target, everything below the waterline clipped away
    this.mirrorCam = new THREE.PerspectiveCamera();
    this.mirrorCam.layers.set(MIRROR_LAYER);
    this.mirrorTargets = new Map();
    this.waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -seaLevel);
    // The half-resolution picture of the sky and sea, and the triangle that
    // scales it up to the screen (tone mapped on the way)
    this.half = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.half.texture.name = 'half-res';
    const blit = new THREE.BufferGeometry();
    blit.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.blit = new THREE.Mesh(blit, new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      uniforms: { uTex: { value: this.half.texture } }, depthTest: false, depthWrite: false,
    }));
    this.blit.frustumCulled = false;
    this.blitScene = new THREE.Scene().add(this.blit);
    this.blitScene.name = 'sea upscale';
    Object.assign(this.sky, { name: 'sky' }); Object.assign(this.ocean, { name: 'ocean' }); Object.assign(this.rain, { name: 'rain' }); Object.assign(this.blit, { name: 'upscale' });
    this.blitCamera = new THREE.Camera();

    // Which look: 'c' or 'b', stepped by the governor unless ?sea=c|b fixes it
    const forced = new URLSearchParams(location.search).get('sea');
    this.quality = { level: LEVELS.includes(forced) ? forced : 'c', auto: !LEVELS.includes(forced) };
    this.gov = { frames: [], last: 0, pending: null, holdUntil: 0, upAfter: 20000, steppedUpAt: -1e9, changedAt: 0 };

    // What the room reads back each frame
    this.light = {
      sky: new THREE.Color(),     // average sky radiance over the upper hemisphere
      sun: new THREE.Color(),     // direct light from the sun (or moon), after the clouds
      sunDir: new THREE.Vector3(0, 1, 0),
      fog: new THREE.Color(),     // fog colour, and the distance it hides half of what is behind
      fogDistance: 1e5,
      exposure: 1,                // suggested exposure for this light level
    };
    this.seaKey = '';
    this.elapsed = 0;
    this.update(0);
  }

  set(changes) { Object.assign(this.state, changes); }

  // A depth-only copy of the sea surface for a scene of its own
  surface() {
    const mesh = new THREE.Mesh(ringGrid(), new THREE.ShaderMaterial({
      vertexShader: oceanVertex, fragmentShader: surfaceFragment, uniforms: this.surfaceUniforms,
      colorWrite: false, side: THREE.DoubleSide,
    }));
    mesh.position.y = this.seaLevel;
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    mesh.name = 'sea surface (depth)';
    this.surfaces.push(mesh);
    return mesh;
  }

  // The moving surface's height above sea level (m) at x, z in the frame,
  // as look C draws it: the Gerstner waves moved the point that ends up
  // here, so step back from it twice to find where it started
  heightAt(x, z) {
    const t = this.elapsed;
    let px = x, pz = z, h = 0;
    for (let pass = 0; pass < 3; pass++) {
      let dx = 0, dz = 0;
      h = 0;
      for (const c of this.sea.moving) {
        const th = c.k * (c.dir.x * px + c.dir.y * pz) - c.w * t + c.phase;
        const co = Math.cos(th) * c.q * c.a;
        dx += c.dir.x * co; dz += c.dir.y * co;
        h += c.a * Math.sin(th);
      }
      px = x - dx; pz = z - dz;
    }
    return h;
  }

  // Rain on the window glass, given the opening (lo, hi: room coordinates,
  // the wall at x). The drops sit just outside the mullions; the rain in
  // the air stays outside the wall.
  setWindow(lo, hi) {
    const w = hi.z - lo.z, h = hi.y - lo.y;
    const geometry = new THREE.PlaneGeometry(w, h).translate(-(lo.z + w / 2), lo.y + h / 2, 0);
    this.glass = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      vertexShader: glassVertex, fragmentShader: glassFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: this.uniforms.uTime, uRain: { value: 0 }, uWet: { value: 0 }, uZenith: this.uniforms.uZenith, uHorizon: this.uniforms.uHorizon },
    }));
    // Turned to face into the room (+x): the plane's x runs along -z
    this.glass.name = 'window glass';
    this.glass.rotation.y = Math.PI / 2;
    this.glass.position.x = lo.x - 0.05;
    this.glass.visible = false;
    this.room.add(this.glass);
    // The opening's corners, for drawing only what shows through it (render())
    this.clip = SEA_CLIP;
    this.window = { x: lo.x, corners: [[lo.y, lo.z], [lo.y, hi.z], [hi.y, hi.z], [hi.y, lo.z]].map(([y, z]) => new THREE.Vector3(lo.x, y, z)) };
    this.rain.material.uniforms.uMaxX.value = lo.x - 0.4;
  }

  // Advance the waves and clouds by dt seconds, and the clock by `speed`
  // hours per second, then recompute the light
  update(dt) {
    const s = this.state, u = this.uniforms;
    this.elapsed += dt;
    if (s.speed) s.time = (s.time + s.speed * dt + 24) % 24;
    const decl = THREE.MathUtils.degToRad(-23.44 * Math.cos((2 * Math.PI / 365) * (s.day + 10)));
    const hour = THREE.MathUtils.degToRad(15 * (s.time - 12));
    const sun = toward(decl, hour, this.heading);
    const moon = toward(-decl * Math.cos(MOON_ELONGATION), hour - MOON_ELONGATION, this.heading);
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
    u.uTime.value = this.elapsed;
    u.uRainRate.value = s.rain;
    // Cloud type by cover and rain: fair-weather cumulus, a low stratus
    // deck, a lower, dark rain cloud
    const st = THREE.MathUtils.smoothstep(c, 0.7, 1);
    u.uStratus.value = st;
    u.uCloudBase.value = THREE.MathUtils.lerp(1100, 600, st) - 250 * s.rain;

    // The sea, rebuilt when the wind or swell change
    const key = [s.wind, s.windFrom, s.swellHs, s.swellFrom, s.swellPeriod].join();
    if (key !== this.seaKey) {
      this.seaKey = key;
      this.sea = buildSea(s, this.heading, this.waveU, this.waveQ);
      u.uFoamJ.value = this.sea.foamJ;
      u.uWhitecaps.value = this.sea.W;
      u.uMss.value = this.sea.mss;
      u.uRipple.value = this.sea.ripple;
      u.uWindDir.value.copy(bearingDir((s.windFrom + 180) % 360, this.heading));   // downwind
    }
    const wind = windSpeed(s.wind); // m/s
    u.uWindSpeed.value = wind;
    u.uCloudShift.value.addScaledVector(u.uWindDir.value, -wind * dt * 2);   // the clouds drift downwind
    // Fog takes the horizon's colour, greyed and dimmed by the cloud
    const horizon = u.uHorizon.value.clone().lerp(u.uZenith.value, 0.2);
    const grey = horizon.r * 0.2126 + horizon.g * 0.7152 + horizon.b * 0.0722;
    u.uFogColor.value.copy(horizon).lerp(new THREE.Color(0.92 * grey, 0.96 * grey, 1.05 * grey).multiplyScalar(0.6), 0.4 + 0.5 * c);

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
    ru.uFall.value.set(u.uWindDir.value.x * wind * 0.5, -9, u.uWindDir.value.y * wind * 0.5);

    // Light for the room and the platform. The sky's average radiance: half
    // zenith, half horizon, flattened and dimmed by cloud.
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
    // and sea as CSS colours, as an auto-exposing camera would see them, and
    // the sea state for the weather screen
    const k = Math.min(CCTV_GAIN, 0.8 / (lsky + 0.01));
    const css = (col, gain = 1) => [col.r, col.g, col.b].map((x) => Math.round(255 * ((x * k * gain) / (1 + x * k * gain)) ** (1 / 2.2)));
    const cloud = u.uZenith.value.clone().lerp(u.uHorizon.value, 0.5);
    const cl = cloud.r * 0.2126 + cloud.g * 0.7152 + cloud.b * 0.0722;
    cloud.lerp(new THREE.Color(cl, cl, cl), 0.7).multiplyScalar(1 - 0.5 * c).add(sunColor.clone().multiplyScalar(0.08));
    this.cctv = {
      time: s.time, wind: s.wind, clouds: c, fog: u.uFog.value, rain: s.rain,
      windSpeed: wind, windFrom: s.windFrom,
      waveHeight: Math.hypot(this.sea.hs, s.swellHs), wavePeriod: this.sea.tp,   // significant height of wind sea and swell together
      day: THREE.MathUtils.smoothstep(e, -6, 6),
      skyTop: css(u.uZenith.value), skyLow: css(u.uHorizon.value.clone().lerp(u.uFogColor.value, 0.5)),
      cloud: css(cloud), fogColor: css(u.uFogColor.value),
      seaFar: css(u.uHorizon.value.clone().lerp(u.uZenith.value, 0.5), 0.45), seaNear: css(u.uZenith.value, 0.25),
      glint: css(sunColor.clone().multiplyScalar(through).add(u.uMoonColor.value.clone().multiplyScalar(20)), 0.3),
    };
  }

  // Draw the sky and sea for `camera`, then leave the depth buffer clear for
  // the scene. The renderer must have autoClear off. To the screen they are
  // drawn at half resolution in the current look (C or B); into a render
  // target (the CCTV pictures) at full resolution in B. `reflect`: a scene
  // (or a list of scenes) whose reflectable() objects the sea mirrors.
  render(renderer, camera, { reflect = null } = {}) {
    const out = renderer.getRenderTarget(), main = out === null;
    if (main) this.govern(performance.now());
    const u = this.uniforms;
    u.uDisplace.value = main && this.quality.level === 'c' ? 1 : 0;
    camera.getWorldPosition(this.camera.position);
    camera.getWorldQuaternion(this.camera.quaternion);
    this.camera.fov = camera.fov;
    this.camera.aspect = camera.aspect;
    this.camera.updateProjectionMatrix();
    const at = this.camera.position;
    this.sky.position.copy(at);
    this.ocean.position.set(at.x, this.seaLevel, at.z);
    for (const s of this.surfaces) s.position.set(at.x, this.seaLevel, at.z);
    this.rain.material.uniforms.uCenter.value.copy(at);
    // Seen from inside, only the part through the window (see SEA_CLIP)
    const through = main ? this.throughWindow(renderer) : undefined;
    this.waterline.visible = through !== null;
    if (through === null) {   // the window is out of view: no sky or sea at all
      renderer.clear();
      return;
    }
    u.uMirrorOn.value = reflect ? 1 : 0;
    if (reflect) this.renderMirror(renderer, reflect, camera, out, through?.mirror);
    if (main) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(0.5).ceil();
      if (this.half.width !== size.x || this.half.height !== size.y) this.half.setSize(size.x, size.y);
      // The box at half resolution, a texel wider all round for the upscale's filtering
      const b = through?.screen, x = b && Math.max(0, Math.floor(b.x / 2) - 1), y = b && Math.max(0, Math.floor(b.y / 2) - 1);
      const box = b && new THREE.Vector4(x, y, Math.min(size.x, Math.ceil((b.x + b.z) / 2) + 1) - x, Math.min(size.y, Math.ceil((b.y + b.w) / 2) + 1) - y);
      if (box) this.half.scissor.copy(box);
      this.half.scissorTest = Boolean(box);
      renderer.setRenderTarget(this.half);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(null);
      renderer.clear();
      if (through) {
        const k = renderer.getPixelRatio(), b = through.screen;   // setScissor takes CSS pixels
        renderer.setScissor(b.x / k, b.y / k, b.z / k, b.w / k);
        renderer.setScissorTest(true);
      }
      renderer.render(this.blitScene, this.blitCamera);
      this.renderFar(renderer);
      if (through) renderer.setScissorTest(false);
    } else {
      renderer.clear();
      renderer.render(this.scene, this.camera);
      this.renderFar(renderer);
    }
    renderer.clearDepth();
  }

  // The neighbour platform over the sky and sea, without their depth: at
  // 9 km the waves round its legs are smaller than a pixel
  renderFar(renderer) {
    if (!this.neighbour) return;
    this.neighbour.update(this, this.camera);
    renderer.clearDepth();
    renderer.render(this.far, this.camera);
  }

  // Where the window shows on screen, for the main view (render()):
  // undefined to draw everything (seen from outside, no window, ?seaclip=0,
  // or the caller already scissors, like play.js warming up into one
  // pixel), null when the window is out of view, else { screen, mirror }:
  // the boxes in the drawing buffer and the mirror picture (a quarter of
  // it), as Vector4 (x, y from the bottom left, width, height)
  throughWindow(renderer) {
    const win = this.window, cam = this.camera;
    if (!this.clip || !win || cam.position.x < win.x || renderer.getScissorTest()) return undefined;
    cam.updateMatrixWorld();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const front = inFront(win.corners, cam);
    const screen = screenBox(front.map((p) => p.clone()), cam, size.x, size.y, 2);
    if (!screen) return null;
    // The sea seen through the window is mirrored where the window's mirror
    // image shows to the mirror camera, give or take the waves' nudge
    const m = this.mirrorView(cam), w = Math.ceil(size.x / 4), h = Math.ceil(size.y / 4), y = this.seaLevel;
    const world = front.map((p) => p.clone().applyMatrix4(cam.matrixWorld)).map((p) => { p.y = 2 * y - p.y; return p; });
    const mirror = screenBox(inFront(world, m), m, w, h, MIRROR_NUDGE * Math.max(w, h) + 2);
    return { screen, mirror: mirror ?? new THREE.Vector4(0, 0, 1, 1) };
  }

  // The mirror camera for `camera` (this.camera, already placed): the same
  // camera reflected in the flat sea
  mirrorView(camera) {
    const m = this.mirrorCam, y = this.seaLevel, flip = (p) => { p.y = 2 * y - p.y; return p; };
    m.position.copy(flip(camera.position.clone()));
    const look = flip(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position));
    m.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    m.up.y *= -1;
    m.lookAt(look);
    m.updateMatrixWorld();
    m.projectionMatrix.copy(camera.projectionMatrix);
    m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    return m;
  }

  // The mirror picture: `scene` seen from under the sea, at a quarter of the
  // screen's resolution (half of a render target's); only inside `box` if given
  renderMirror(renderer, scene, camera, out, box = null) {
    const size = out ? new THREE.Vector2(out.width, out.height).multiplyScalar(0.5) : renderer.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(0.25);
    size.ceil();
    const id = out ? out.width : 0;
    let target = this.mirrorTargets.get(id);
    if (!target) {
      this.mirrorTargets.set(id, target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
      target.texture.name = out ? 'cctv mirror' : 'mirror';
    }
    if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y);
    if (box) target.scissor.copy(box);
    target.scissorTest = Boolean(box);
    this.uniforms.uMirror.value = target.texture;
    const m = this.mirrorView(this.camera);
    m.projectionMatrix.copy(camera.projectionMatrix);
    m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.uniforms.uMirrorMatrix.value.copy(BIAS).multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
    const planes = renderer.clippingPlanes, shadows = renderer.shadowMap.autoUpdate;
    renderer.setClearColor(0x000000, 0);
    renderer.clippingPlanes = [this.waterPlane];
    renderer.shadowMap.autoUpdate = false;   // the main pass's shadows do
    renderer.setRenderTarget(target);
    renderer.clear();
    for (const sc of [].concat(scene)) renderer.render(sc, m);   // one scene, or several (story mode's epilogue adds its own)
    renderer.setRenderTarget(out);
    renderer.clippingPlanes = planes;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.setClearColor(clearColor, clearAlpha);
  }

  // The fallback switch, fed with the time between frames. Frames that stay
  // slow for two seconds step C down to B; if that doesn't speed them up it
  // wasn't the GPU but a frame cap (Low Power Mode, a throttled page), so it
  // steps back and leaves quality alone for a while. After 20 s of smooth
  // frames it tries C again, waiting twice as long each time that fails.
  govern(now) {
    const g = this.gov, gap = now - g.last;
    g.last = now;
    if (gap > 250 || document.hidden) { g.frames.length = 0; return; }
    g.frames.push(gap);
    if (g.frames.length > 60) g.frames.shift();
    if (!this.quality.auto || g.frames.length < 60) return;
    const span = g.frames.reduce((a, b) => a + b, 0) / g.frames.length;
    const i = LEVELS.indexOf(this.quality.level);
    const setLevel = (j) => { this.quality.level = LEVELS[j]; g.changedAt = now; g.frames.length = 0; };
    if (g.pending) {
      if (now - g.pending.at < 2500) return;
      if (span > g.pending.span * 0.85) { setLevel(g.pending.from); g.holdUntil = now + 30000; }   // no faster: a cap
      g.pending = null;
      return;
    }
    if (now < g.holdUntil || now - g.changedAt < 2000) return;
    if (span > 20 && i < LEVELS.length - 1) {
      if (now - g.steppedUpAt < 6000) g.upAfter *= 2;   // the last step up didn't hold
      g.pending = { from: i, at: now, span };
      setLevel(i + 1);
    } else if (span < 17.5 && i > 0 && now - g.changedAt > g.upAfter) {
      g.steppedUpAt = now;
      setLevel(i - 1);
    }
  }
}

// Clock text for a time in hours
export function clock(h) {
  const m = Math.round(h * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
