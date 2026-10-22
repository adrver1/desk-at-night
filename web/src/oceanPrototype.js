// PROTOTYPE (throwaway): which sea, sky and reflections should the game use?
// Today's outdoor.js next to three upgrades, around the platform and the
// supply vessel from the intro's models:
//   now  today's outdoor.js, untouched
//   a    shader polish: lit puffy clouds and cirrus, a richer wave spectrum
//        with sunlit crests and foam; no extra render passes
//   b    a + the platform and vessel mirrored in the sea (one extra render
//        at quarter resolution, broken up by the waves)
//   c    b + waves that move the surface and raymarched 3D clouds
// URL: ocean-prototype.html?variant=b&view=low&time=11.5&weather=cloudy
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Outdoor, WEATHER, PLATFORM_HEADING } from './outdoor.js';
import { fpsCounter } from './fps.js';

fpsCounter();

const q = new URLSearchParams(location.search);
const B = (x, y, z) => new THREE.Vector3(x, z, -y); // Blender to three.js axes
const CLOUD_HEIGHT = 1500;

// ---------------------------------------------------------------- noise

// A tileable fbm texture: clouds and fine ripples read it instead of
// computing noise per pixel, so even the raymarched clouds stay cheap
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
  // stretch the contrast: fbm sits near 0.5
  for (let c = 0; c < 3; c++) {
    let lo = 255, hi = 0;
    for (let i = c; i < data.length; i += 4) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
    for (let i = c; i < data.length; i += 4) data[i] = (255 * (data[i] - lo)) / (hi - lo);
  }
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
  uniform float uClouds, uFog, uStars, uTime, uMoonShow, uMoonPhase, uWind, uCamHeight;
  uniform vec2 uCloudShift, uWindDir;
  uniform sampler2D uNoise;
  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float hash3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 tn(vec2 p) { return texture2D(uNoise, p).rgb; }
`;

// Puffy clouds on one layer: warped, three octaves from the texture, and lit
// by how much cloud lies between each point and the sun
const clouds2d = /* glsl */ `
  float coverN(vec2 p) {
    vec2 w = tn(p / 23000.0).gb - 0.5;
    p += w * 2600.0;
    return tn(p / 7000.0).r * 0.6 + tn(p / 1900.0).g * 0.28 + tn(p / 520.0).b * 0.12;
  }
  float coverLo() { return 0.7 - 0.34 * uClouds; }
  float coverD(float n) { return clamp(smoothstep(coverLo(), coverLo() + 0.1, n) * mix(1.0, 0.93, 1.0 - uClouds) + smoothstep(0.85, 1.0, uClouds) * 0.6, 0.0, 1.0); }
  vec3 cloudAmbient() {
    vec3 a = mix(uZenith, uHorizon, 0.45);
    return mix(a, vec3(lum(a)) * vec3(0.95, 0.98, 1.04), 0.55);
  }
  // rgb: radiance, a: cover
  vec4 clouds(vec3 v) {
    vec3 amb = cloudAmbient();
    vec3 flat_ = amb * mix(1.0, 0.6, uClouds);
    if (v.y <= 0.0) return vec4(flat_, uClouds);
    vec2 p = v.xz / (v.y + 0.035) * ${CLOUD_HEIGHT.toFixed(1)} + uCloudShift;
    float n = coverN(p), d = coverD(n);
    vec2 sdir = normalize(uSunDir.xz + 1e-4);
    float toward = max(dot(v, uSunDir), 0.0);
    float shadow = exp(-2.2 * coverD(coverN(p + sdir * 350.0)) - 1.4 * d * uClouds);
    float phase = 0.3 + 0.5 * pow(toward, 3.0) + 2.0 * pow(toward, 24.0) * (1.0 - d);  // bright rims toward the sun
    float sunUp = smoothstep(-0.08, 0.05, uSunDir.y);
    float thick = smoothstep(0.0, 0.16, n - coverLo());   // deep inside a cloud: its darker base
    vec3 col = amb * mix(1.25, 0.42, thick * (0.5 + 0.5 * uClouds))
             + uSunColor * sunUp * shadow * phase * 0.4 * mix(1.0, 0.35, thick)
             + uMoonColor * 0.5;
    // high cirrus, combed out along the wind, in clearer skies
    vec2 c = v.xz / (v.y + 0.02) * 9000.0 + uCloudShift * 0.3;
    vec2 a = vec2(dot(c, uWindDir), dot(c, vec2(-uWindDir.y, uWindDir.x)));
    float ci = smoothstep(0.55, 0.85, tn(a / vec2(40000.0, 6000.0)).b) * smoothstep(0.45, 0.75, tn(a / 15000.0).g);
    ci *= (1.0 - uClouds) * 0.55 * smoothstep(0.02, 0.2, v.y) * (1.0 - d);
    col = mix(col, amb * 1.3 + uSunColor * sunUp * 0.12, ci / max(d + ci, 1e-3) * step(0.0, ci - 0.001));
    d = max(d, ci);
    // far away, the layer thins into a uniform band
    float far = smoothstep(0.18, 0.0, v.y);
    return vec4(mix(col, flat_, far * 0.7), mix(d, uClouds, far));
  }
`;

// Raymarched cumulus in a slab 1.1-2.5 km up: a few steps along the view ray,
// one step toward the sun at each for the light
const clouds3d = /* glsl */ `
  const float BASE = 1100.0, TOP = 2500.0;
  float dens(vec3 p) {
    float h = (p.y - BASE) / (TOP - BASE);
    float n = coverN(p.xz);
    float profile = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.35, h);
    float d = n - coverLo() - (1.0 - profile) * 0.18;
    d -= (tn(p.xz / 300.0 + h * 0.37).b - 0.5) * 0.08;   // ragged edges
    return clamp(d * 9.0, 0.0, 1.0);
  }
  vec4 clouds3(vec3 v, vec2 frag) {
    if (v.y < 0.03) return clouds(v);
    vec3 amb = cloudAmbient();
    float t0 = (BASE - uCamHeight) / v.y, t1 = min((TOP - uCamHeight) / v.y, t0 + 14000.0);
    const int N = 22;
    float dt = (t1 - t0) / float(N);
    float t = t0 + dt * hash(frag);
    float T = 1.0; vec3 L = vec3(0.0);
    float toward = dot(v, uSunDir);
    float phase = 0.6 * (1.0 - 0.36) / pow(1.0 + 0.36 - 1.2 * toward, 1.5) + 0.4 * (1.0 - 0.04) / pow(1.04 + 0.4 * toward, 1.5);
    float sunUp = smoothstep(-0.08, 0.05, uSunDir.y);
    for (int i = 0; i < N; i++) {
      vec3 p = vec3(v.x * t + uCloudShift.x, uCamHeight + v.y * t, v.z * t + uCloudShift.y);
      float d = dens(p);
      if (d > 0.01) {
        float h = (p.y - BASE) / (TOP - BASE);
        float toSun = dens(p + uSunDir * 260.0) + 0.5 * dens(p + uSunDir * 700.0);
        float sigma = d * 0.02;
        vec3 S = uSunColor * sunUp * exp(-toSun * 3.0) * phase * 0.35 * (1.0 - exp(-d * 4.0))   // powder: dark where thin and lit
               + amb * mix(0.5, 1.3, h) + uMoonColor * 0.5;
        float tr = exp(-sigma * dt);
        L += T * S * (1.0 - tr);
        T *= tr;
        if (T < 0.03) break;
      }
      t += dt;
    }
    vec4 c = vec4(L / max(1.0 - T, 1e-3), 1.0 - T);
    // blend into the flat layer toward the horizon, where the march gives out
    vec4 f = clouds(v);
    return mix(c, f, smoothstep(0.22, 0.04, v.y));
  }
`;

// The sky behind the clouds: today's gradient, glows, stars, sun and moon
const skyBase = /* glsl */ `
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
    if (toSun > 0.99996) col += uSunColor * 30.0;
    vec3 off = (v - uMoonDir) / 0.009;
    float rr = dot(off, off);
    if (uMoonShow > 0.0 && rr < 1.2) {
      vec3 sx = normalize(uSunDir - uMoonDir * dot(uSunDir, uMoonDir));
      float x = dot(off, sx), y2 = max(rr - x * x, 0.0);
      float lit = smoothstep(-0.08, 0.08, x - uMoonPhase * sqrt(max(1.0 - y2, 0.0)));
      float disc = 1.0 - smoothstep(0.92, 1.0, sqrt(rr));
      col += vec3(1.0, 0.98, 0.92) * disc * mix(0.012, 2.5, lit) * uMoonShow;
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
const skyFragment = (volumetric) => /* glsl */ `
  varying vec3 vDir;
  ${common}${clouds2d}${volumetric ? clouds3d : ''}${skyBase}
  void main() {
    vec3 v = normalize(vDir);
    ${volumetric
    ? 'vec4 c = clouds3(v, gl_FragCoord.xy); vec3 col = haze(mix(skyBase(v, uStars), c.rgb, c.a), v);'
    : 'vec3 col = sky(v, uStars);'}
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Waves: one table for the surface's shape (vertex, variant c) and its
// slopes (fragment). Longest swell first, each next one ~0.72 as long.
const waveTable = /* glsl */ `
  const int NW = 20;
  void wave(int i, out vec2 dir, out float k, out float w, out float s, out float ph) {
    float fi = float(i);
    float windAng = atan(uWindDir.y, uWindDir.x);
    bool swell = i < 3;
    float a = windAng + (hash(vec2(fi, 3.1)) - 0.5) * (swell ? 0.8 : 3.2);
    dir = vec2(cos(a), sin(a));
    float lambda = mix(80.0, 220.0, uWind) * pow(0.72, fi) * (0.85 + 0.3 * hash(vec2(fi, 5.3)));
    k = 6.2831853 / lambda;
    w = sqrt(9.81 * k);
    s = swell ? mix(0.015, 0.035, uWind) : mix(0.03, 0.1, uWind) * (fi < 8.0 ? 0.8 : 1.0);
    ph = hash(vec2(fi, 7.7)) * 6.28;
  }
`;

const oceanVertex = (displace) => /* glsl */ `
  ${common}${waveTable}
  varying vec3 vWorld;
  varying vec2 vFlat;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vFlat = w.xz;
    ${displace ? `
    // Gerstner: points travel in small circles, crests sharpen; only the
    // longer waves, and only where the grid is fine enough to show them
    float fade = 1.0 - smoothstep(600.0, 4000.0, length(position.xz));
    vec3 d = vec3(0.0);
    for (int i = 0; i < 9; i++) {
      vec2 dir; float k, om, s, ph;
      wave(i, dir, k, om, s, ph);
      float th = k * dot(dir, w.xz) - om * uTime + ph;
      float a = s / k;
      d.xz -= dir * a * 0.7 * sin(th);
      d.y += a * cos(th);
    }
    w.xyz += d * fade;` : ''}
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const oceanFragment = (reflect) => /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vFlat;
  uniform float uSeaLevel, uMirrorOn;
  uniform sampler2D uMirror;
  uniform mat4 uMirrorMatrix;
  ${common}${clouds2d}${skyBase}${waveTable}

  vec3 waves(vec2 p, float footprint, out float rough, out float crest) {
    vec2 g = vec2(0.0);
    rough = 0.0; crest = 0.0;
    float amp = 0.0;
    for (int i = 0; i < NW; i++) {
      vec2 dir; float k, w, s, ph;
      wave(i, dir, k, w, s, ph);
      float lambda = 6.2831853 / k;
      float fade = 1.0 - smoothstep(lambda * 0.06, lambda * 0.3, footprint);
      float th = k * dot(dir, p) - w * uTime + ph;
      g += s * fade * dir * cos(th);
      if (i < 8) { crest += (s / k) * sin(th) * fade; amp += s / k; }
      rough += s * s * (1.0 - fade) * 0.5;
    }
    crest /= max(amp, 1e-3);
    // Medium-scale texture slopes break up the sum's regular pattern
    {
      vec2 q1 = p / 140.0 + uWindDir * uTime * 0.012, q2 = p / 47.0 - vec2(uWindDir.y, -uWindDir.x) * uTime * 0.03;
      float e = 1.0 / 128.0;
      float a0 = tn(q1).r, b0 = tn(q2).g;
      vec2 s1 = vec2(tn(q1 + vec2(e, 0.0)).r - a0, tn(q1 + vec2(0.0, e)).r - a0) / (e * 140.0);
      vec2 s2 = vec2(tn(q2 + vec2(e, 0.0)).g - b0, tn(q2 + vec2(0.0, e)).g - b0) / (e * 47.0);
      g += mix(0.6, 1.4, uWind) * (s1 * 9.0 + s2 * 4.0);
    }
    // fine ripples from the texture, two layers drifting with the wind
    float fine = 1.0 - smoothstep(0.1, 0.8, footprint);
    if (fine > 0.0) {
      vec2 q1 = p / 9.0 + uWindDir * uTime * 0.05, q2 = p / 3.7 - uWindDir.yx * uTime * 0.09;
      float e = 1.0 / 256.0;
      float a0 = tn(q1).g, b0 = tn(q2).b;
      vec2 s1 = vec2(tn(q1 + vec2(e, 0.0)).g - a0, tn(q1 + vec2(0.0, e)).g - a0) / (e * 9.0);
      vec2 s2 = vec2(tn(q2 + vec2(e, 0.0)).b - b0, tn(q2 + vec2(0.0, e)).b - b0) / (e * 3.7);
      g += fine * mix(0.15, 0.4, uWind) * (s1 * 1.6 + s2 * 0.6) * 0.5;
    }
    rough += (1.0 - fine) * mix(0.0008, 0.005, uWind);
    return normalize(vec3(-g.x, 1.0, -g.y));
  }

  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 v = toEye / dist;
    float footprint = length(fwidth(vFlat));
    float rough, crest;
    vec3 n = waves(vFlat, footprint, rough, crest);
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
      vec2 muv = mc.xy / mc.w + n.xz * mix(0.035, 0.09, uWind);
      vec4 m = texture2D(uMirror, muv);
      refl = mix(refl, m.rgb, m.a * (1.0 - clamp(rough * 25.0, 0.0, 0.75)));
    }` : ''}
    vec3 amb = mix(uZenith, uHorizon, 0.5);
    float sunUp = max(uSunDir.y, 0.0);
    // Deep water: very dark blue; light through the crests: green-blue,
    // strongest looking toward the sun
    vec3 deep = vec3(0.0035, 0.016, 0.024) * (lum(amb) * 0.8 + uSunColor * sunUp * 0.06);
    vec2 vf = normalize(-v.xz + 1e-5), sf = normalize(uSunDir.xz + 1e-5);
    float sss = clamp(crest * 0.5 + 0.5, 0.0, 1.0);
    sss = sss * sss * (0.25 + 1.5 * pow(max(dot(vf, sf), 0.0), 3.0)) * smoothstep(1.0, 0.85, v.y);
    vec3 body = deep + vec3(0.006, 0.04, 0.035) * (uSunColor * sunUp * 0.25 + amb * 0.5) * sss * (0.6 + uWind);
    vec3 col = mix(body, refl, f);
    float r2 = 0.0015 + rough + uWind * 0.006;
    float clearSun = 1.0 - coverD(coverN(uSunDir.xz / (uSunDir.y + 0.035) * ${CLOUD_HEIGHT.toFixed(1)} + uCloudShift)) * 0.95 * step(0.0, uSunDir.y);
    col += uSunColor * clearSun * exp((dot(r, uSunDir) - 1.0) / r2) * 0.05 / r2;
    float m2 = 0.0003 + 0.3 * rough + uWind * 0.0015;
    col += uMoonColor * 1.5 * (1.0 - uClouds * 0.9) * exp((dot(r, uMoonDir) - 1.0) / m2) * 0.05 / m2;
    // Foam: on the crests in a fresh wind, streaked along it
    float foamAmount = smoothstep(0.3, 1.0, uWind);
    if (foamAmount > 0.0) {
      float fade = 1.0 - smoothstep(3.0, 20.0, footprint);
      vec2 a = vec2(dot(vFlat, uWindDir), dot(vFlat, vec2(-uWindDir.y, uWindDir.x)));
      float tex = tn(a / vec2(60.0, 22.0) - vec2(uTime * 0.01, 0.0)).r * 0.6 + tn(vFlat / 9.0).g * 0.4;
      float foam = smoothstep(0.62, 0.9, crest * 0.5 + tex * 0.7 + foamAmount * 0.15 - 0.2) * foamAmount * fade;
      col = mix(col, (amb * 0.7 + uSunColor * sunUp * 0.12) * (0.6 + 0.4 * tn(vFlat / 2.3).b), foam * 0.6);
    }
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
  a: { label: 'A · Polish', cost: 'no extra passes · ~same cost' },
  b: { label: 'B · Reflections', cost: '+1 quarter-res render of platform + vessel' },
  c: { label: 'C · Cinematic', cost: 'B + moving surface + 3D clouds · heavy' },
};
// Cameras in the platform's Blender frame: [eye, target]
const VIEWS = {
  window: { label: 'Control room window', eye: [40, -32, 40], at: [-60, -400, 14] },
  approach: { label: 'Helicopter approach', eye: [-490, 300, 220], at: [30, 0, 15] },
  sun: { label: 'Into the sun', eye: [-170, -400, 60], at: [30, 10, 10] },
  low: { label: 'Low, by the vessel', eye: [-110, -170, 7], at: [20, -30, 14] },
};
const TIMES = { '07:30': 7.5, '11:30': 11.5, '15:45': 15.75, '16:45': 16.75, '22:30': 22.5 };

const state = {
  variant: VARIANTS[q.get('variant')] ? q.get('variant') : 'b',
  view: VIEWS[q.get('view')] ? q.get('view') : 'low',
  time: Number(q.get('time') ?? 11.5),
  weather: WEATHER[q.get('weather')] ? q.get('weather') : 'cloudy',
  frozen: q.has('t'),
};

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
});
const stock = { sky: outdoor.sky.material, ocean: outdoor.ocean.material, geometry: outdoor.ocean.geometry };
const mat = (vertexShader, fragmentShader, extra = {}) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: U, ...extra });
const skyOpts = { side: THREE.BackSide, depthWrite: false, depthTest: false };
const MATERIALS = {
  a: { sky: mat(skyVertex, skyFragment(false), skyOpts), ocean: mat(oceanVertex(false), oceanFragment(false)) },
  b: { sky: null, ocean: mat(oceanVertex(false), oceanFragment(true)) },
  c: { sky: mat(skyVertex, skyFragment(true), skyOpts), ocean: mat(oceanVertex(true), oceanFragment(true), { side: THREE.DoubleSide }) },
};
MATERIALS.b.sky = MATERIALS.a.sky;
const rings = ringGrid();

function applyVariant() {
  const v = state.variant;
  outdoor.sky.material = v === 'now' ? stock.sky : MATERIALS[v].sky;
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
  const old = renderer.getClearAlpha(), oldTone = renderer.toneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.clippingPlanes = [above];
  renderer.setRenderTarget(mirrorTarget);
  renderer.clear();
  renderer.render(scene, mirrorCam);
  renderer.setRenderTarget(null);
  renderer.clippingPlanes = [];
  renderer.setClearColor(0x000000, old);
  renderer.toneMapping = oldTone;
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
function group(name, options, key, parse = (x) => x) {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = `<span class="lab">${name}</span>`;
  for (const [k, label] of options) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { state[key] = parse(k); refresh(); };
    b.dataset.key = key; b.dataset.value = k;
    row.appendChild(b);
  }
  ui.appendChild(row);
}
group('Look', Object.entries(VARIANTS).map(([k, v]) => [k, v.label]), 'variant');
group('View', Object.entries(VIEWS).map(([k, v]) => [k, v.label]), 'view');
group('Time', Object.keys(TIMES).map((k) => [k, k]), 'time', (k) => TIMES[k]);
group('Weather', Object.keys(WEATHER).map((k) => [k, k]), 'weather');
const note = document.querySelector('#note');
let yaw = 0, pitch = 0;
function refresh() {
  for (const b of ui.querySelectorAll('button')) {
    const v = state[b.dataset.key], k = b.dataset.value;
    b.classList.toggle('on', b.dataset.key === 'time' ? TIMES[k] === v : v === k);
  }
  note.textContent = VARIANTS[state.variant].cost;
  outdoor.set({ ...WEATHER[state.weather], time: state.time, speed: 0 });
  applyVariant();
  const view = VIEWS[state.view];
  camera.position.copy(B(...view.eye));
  camera.lookAt(B(...view.at));
  base.copy(camera.quaternion);
  yaw = pitch = 0;
}
const base = new THREE.Quaternion();
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

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 70 : 55;
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  mirrorTarget.setSize(Math.ceil(w * pr / 4), Math.ceil(h * pr / 4));   // quarter resolution
}
addEventListener('resize', resize);
resize();

const clockStart = performance.now();
let last = performance.now();
function frame(now) {
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
  if (U.uMirrorOn.value) renderMirror();
  outdoor.render(renderer, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.querySelector('#status').hidden = true;
window.prototypeReady = clockStart;
