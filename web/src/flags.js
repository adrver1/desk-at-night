// Flags that move in the wind, cheaply: a small grid of vertices per flag,
// moved in the vertex shader, every flag of a kind in one instanced draw.
// Wind speed and direction come from the weather (outdoor.js windSpeed,
// windFrom), so nothing here needs a bake in Blender.
//
// Two kinds of flag:
//   banner  hangs from an arm at the top of the mast and is held along the
//           mast too (the Aker BP banners at Føniks, preview_trondheim.py
//           flag_mast): only the bottom and the far edge move
//   pole    a classic flag on a halyard, held along the pole only: it turns
//           to fly downwind and hangs down when the wind drops
//
// Three ways to move them (all kept, pick with `variant`):
//   a  sway    one travelling sine wave, weighted from 0 at the held edges
//              to full at the free corner; normals from the same sine
//   b  ripple  three waves at different lengths and angles, a gusty
//              envelope, a fast flutter along the free edges, a lean away
//              from the wind, normals by finite differences, light shining
//              through the cloth when the sun is behind it
//   c  cloth   a real cloth simulation (Verlet) run once at load for three
//              wind speeds, a 2 s seamless loop of each stored in a float
//              texture; the shader plays it back and blends between the two
//              nearest wind speeds (a "vertex animation texture")
//
// Far away a flag drops to a coarse grid (every 4th vertex), the same
// material and, for c, the same texture.
import * as THREE from 'three';

export const KINDS = {
  banner: { w: 1.0, h: 2.6, nu: 9, nv: 21, stride: 4 },    // 160 quads near, 10 far
  pole: { w: 1.5, h: 1.0, nu: 17, nv: 13, stride: 4 },     // 192 quads near, 12 far
};

const LOGO = [   // characters/_shared/outfits.py LOGO with the palette.py colours
  ['#c42a72', [[0.12, 0.95], [0.33, 1.0], [0.30, 0.83], [0.55, 0.70], [0.55, 0.53], [0.02, 0.51], [0.05, 0.67], [0.18, 0.80]]],
  ['#ec8a3c', [[0.36, 0.56], [0.56, 0.67], [1.0, 0.73], [1.0, 0.46], [0.86, 0.40], [0.46, 0.30], [0.22, 0.34]]],
  ['#2e9a52', [[0.0, 0.31], [0.40, 0.39], [0.72, 0.41], [0.62, 0.23], [0.32, 0.14], [0.47, 0.0], [0.12, 0.02], [0.0, 0.11]]],
];

// The flag's face: white with the logo, as on the Blender banners (logo 0.8
// of the width, centred 0.42 of the height down) or centred on a pole flag
export function flagTexture(kind, px = 256) {
  const k = KINDS[kind], c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round(px * k.h / k.w);
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f1';
  g.fillRect(0, 0, c.width, c.height);
  const lw = kind === 'banner' ? 0.8 * c.width : 0.42 * c.width;
  const lh = lw * 0.95 / 0.8;
  const cx = c.width / 2, cy = kind === 'banner' ? 0.42 * c.height : c.height / 2;
  for (const [col, pts] of LOGO) {
    g.fillStyle = col;
    g.beginPath();
    pts.forEach(([u, v], i) => g[i ? 'lineTo' : 'moveTo'](cx + (u - 0.5) * lw, cy - (v - 0.5) * lh));
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A grid in the flag's own frame: x from the mast (0) to the fly (w), y from
// the top (0) down to -h, facing +z. aVid is the vertex's index in the full
// grid, so the coarse grid can read the same cloth texture.
export function flagGeometry(kind, far = false) {
  const k = KINDS[kind], s = far ? k.stride : 1;
  const nu = (k.nu - 1) / s + 1, nv = (k.nv - 1) / s + 1;
  const pos = [], uv = [], vid = [], idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u = i / (nu - 1), v = 1 - j / (nv - 1);
    pos.push(u * k.w, (v - 1) * k.h, 0);
    uv.push(u, v);
    vid.push(j * s * k.nu + i * s);
  }
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aVid', new THREE.Float32BufferAttribute(vid, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -k.h / 2, 0), Math.max(k.w, k.h) * 1.5);
  return g;
}

// ---------------------------------------------------------------- cloth bake (c)

export const BAKE = { speeds: [1.5, 8, 20], frames: 60, fps: 30 };

// Simulate the flag in its own frame with the wind blowing along +x (pole:
// it flies downwind) or slantwise into the cloth (banner: held on two
// edges, the wind presses it out and runs along it). Returns the positions
// and normals of a seamless 2 s loop for each wind speed.
export function bakeCloth(kind) {
  const k = KINDS[kind], n = k.nu * k.nv, { speeds, frames, fps } = BAKE;
  const blend = 15, sub = 6, iters = 8, dt = 1 / (fps * sub);
  const pos = new Float32Array(n * 4 * frames * speeds.length), nrm = new Float32Array(pos.length);
  const rest = flagGeometry(kind).attributes.position.array;
  const mass = 0.25 * k.w * k.h / n, area = k.w * k.h / n;
  const free = new Float32Array(n);
  for (let j = 0; j < k.nv; j++) for (let i = 0; i < k.nu; i++) free[j * k.nu + i] = i === 0 || (kind === 'banner' && j === 0) ? 0 : 1;
  // stretch, shear and bend links, as flat arrays (this loop runs ~10^7 times)
  const L = [];
  const add = (a, b, stiff) => { if (free[a] + free[b]) L.push(a, b, Math.hypot(rest[3 * a] - rest[3 * b], rest[3 * a + 1] - rest[3 * b + 1]), stiff); };
  for (let j = 0; j < k.nv; j++) for (let i = 0; i < k.nu; i++) {
    const a = j * k.nu + i;
    if (i + 1 < k.nu) add(a, a + 1, 1);
    if (j + 1 < k.nv) add(a, a + k.nu, 1);
    if (i + 1 < k.nu && j + 1 < k.nv) { add(a, a + k.nu + 1, 0.5); add(a + 1, a + k.nu, 0.5); }
    if (i + 2 < k.nu) add(a, a + 2, 0.12);
    if (j + 2 < k.nv) add(a, a + 2 * k.nu, 0.12);
  }
  const links = Float32Array.from(L), nl = links.length;
  const tris = [];
  for (let j = 0; j < k.nv - 1; j++) for (let i = 0; i < k.nu - 1; i++) {
    const a = j * k.nu + i;
    tris.push(a, a + k.nu, a + 1, a + 1, a + k.nu, a + k.nu + 1);
  }
  const T = Int32Array.from(tris), N = new Float32Array(n * 3);
  function normals(p) {
    N.fill(0);
    for (let t = 0; t < T.length; t += 3) {
      const x = 3 * T[t], y = 3 * T[t + 1], z = 3 * T[t + 2];
      const ux = p[y] - p[x], uy = p[y + 1] - p[x + 1], uz = p[y + 2] - p[x + 2];
      const vx = p[z] - p[x], vy = p[z + 1] - p[x + 1], vz = p[z + 2] - p[x + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      N[x] += cx; N[x + 1] += cy; N[x + 2] += cz;
      N[y] += cx; N[y + 1] += cy; N[y + 2] += cz;
      N[z] += cx; N[z + 1] += cy; N[z + 2] += cz;
    }
    for (let q = 0; q < 3 * n; q += 3) {
      const l = Math.sqrt(N[q] * N[q] + N[q + 1] * N[q + 1] + N[q + 2] * N[q + 2]) || 1;
      N[q] /= l; N[q + 1] /= l; N[q + 2] /= l;
    }
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  speeds.forEach((speed, si) => {
    const p = Float32Array.from(rest), o = Float32Array.from(rest);
    const dx0 = kind === 'banner' ? 0.55 : 1, dz0 = kind === 'banner' ? 0.84 : 0;
    // gusts: a few slow sines, and turbulence that differs along the cloth
    const gp = [rnd() * 6, rnd() * 6, rnd() * 6];
    const rec = [], total = frames + blend, warm = 2 * fps, dt2 = dt * dt, fn0 = 0.6 * 1.2 * area / mass, ft0 = 0.02 * 1.2 * area / mass;
    for (let f = 0; f < warm + total; f++) {
      for (let s = 0; s < sub; s++) {
        const t = (f * sub + s) * dt;
        const gust = speed * (1 + 0.18 * Math.sin(0.9 * t + gp[0]) + 0.1 * Math.sin(2.3 * t + gp[1]));
        normals(p);
        for (let q = 0, i = 0; q < n; q++, i += 3) {
          if (!free[q]) continue;
          const turb = 0.25 * Math.sin(5.1 * t - 3.0 * p[i] + gp[2]) * Math.sin(3.7 * t + 2.1 * p[i + 1]);
          const vx = gust * (dx0 + turb * 0.4) - (p[i] - o[i]) / dt, vy = gust * turb * 0.5 - (p[i + 1] - o[i + 1]) / dt, vz = gust * (dz0 + turb) - (p[i + 2] - o[i + 2]) / dt;
          const nx = N[i], ny = N[i + 1], nz = N[i + 2], vn = vx * nx + vy * ny + vz * nz;
          // pressure on the cloth (drag across it) and a little skin friction along it
          const fn = fn0 * vn * Math.abs(vn), ft = ft0 * Math.sqrt(vx * vx + vy * vy + vz * vz);
          const ax = fn * nx + ft * (vx - vn * nx), ay = fn * ny + ft * (vy - vn * ny) - 9.81, az = fn * nz + ft * (vz - vn * nz);
          const px = p[i], py = p[i + 1], pz = p[i + 2];
          p[i] = px + (px - o[i]) * 0.995 + ax * dt2;
          p[i + 1] = py + (py - o[i + 1]) * 0.995 + ay * dt2;
          p[i + 2] = pz + (pz - o[i + 2]) * 0.995 + az * dt2;
          o[i] = px; o[i + 1] = py; o[i + 2] = pz;
        }
        for (let it = 0; it < iters; it++) for (let l = 0; l < nl; l += 4) {
          const a = links[l], b = links[l + 1], ia = 3 * a, ib = 3 * b;
          const ex = p[ib] - p[ia], ey = p[ib + 1] - p[ia + 1], ez = p[ib + 2] - p[ia + 2];
          const d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1e-6, wa = free[a], wb = free[b];
          const corr = links[l + 3] * (d - links[l + 2]) / d / (wa + wb);
          p[ia] += ex * corr * wa; p[ia + 1] += ey * corr * wa; p[ia + 2] += ez * corr * wa;
          p[ib] -= ex * corr * wb; p[ib + 1] -= ey * corr * wb; p[ib + 2] -= ez * corr * wb;
        }
      }
      if (f >= warm) rec.push(Float32Array.from(p));
    }
    // a seamless loop: the last `blend` frames fade into the ones before the first
    for (let f = 0; f < frames; f++) {
      const cur = rec[f + blend], t = f >= frames - blend ? (f - (frames - blend) + 1) / (blend + 1) : 0;
      const prev = rec[f + blend - frames] ?? cur;
      const fr = Float32Array.from(cur, (x, i) => x + (prev[i] - x) * t);
      normals(fr);
      const base = (si * frames + f) * n * 4;
      for (let q = 0; q < n; q++) {
        pos.set([fr[3 * q], fr[3 * q + 1], fr[3 * q + 2], 1], base + 4 * q);
        nrm.set([N[3 * q], N[3 * q + 1], N[3 * q + 2], 0], base + 4 * q);
      }
    }
  });
  const tex = (data) => {
    const t = new THREE.DataTexture(data, n, frames * speeds.length, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
  };
  return { pos: tex(pos), nrm: tex(nrm), bytes: pos.byteLength * 2 };
}

// ---------------------------------------------------------------- material

const SHARED = /* glsl */`
uniform float uTime, uWindSpeed;
uniform vec3 uWindDir;     // downwind, world, horizontal
uniform vec2 uSize;        // flag width, height (m)
attribute float aVid;
#ifdef USE_INSTANCING
attribute float aPhase;
#else
const float aPhase = 0.0;
#endif
varying float vFold;
#ifdef FLAG_CLOTH
uniform sampler2D uPos, uNrm;
uniform float uFrames, uVerts;
uniform vec3 uSpeeds;
vec4 vat(sampler2D t, float row) { return texelFetch(t, ivec2(int(aVid), int(row)), 0); }
#endif

// the wind in this flag's own frame (instances are only turned and moved)
vec3 localWind() {
#ifdef USE_INSTANCING
  return transpose(mat3(instanceMatrix)) * uWindDir;
#else
  return uWindDir;
#endif
}

// how far a point may move: 0 where the cloth is held, 1 at the free corner
float hold(vec2 uv) {
#ifdef FLAG_POLE
  return pow(uv.x, 1.15);
#else
  return pow(uv.x, 0.7) * pow(1.0 - uv.y, 1.2);
#endif
}

// a 0..1 ramp from a light breeze to a gale
float strength() { return smoothstep(1.0, 16.0, uWindSpeed); }

// out of the cloth's plane, for the flag point at (x, y) in metres
float wave(vec2 p, float t, float flow) {
  vec2 uv = vec2(p.x / uSize.x, 1.0 + p.y / uSize.y);
  float w = hold(uv), s = strength(), ph = aPhase * 6.2831;
  float L = uSize.x;
  float c = 0.8 + 0.45 * uWindSpeed;       // how fast the folds run off the fly
  float k = 6.2831 / (0.85 * L);
#ifdef FLAG_RIPPLE
  float gust = 0.75 + 0.25 * sin(0.8 * t + ph) * sin(0.31 * t + 2.0 * ph);
  float x = flow * p.x;
  float z = 0.55 * sin(k * (x - c * t) + 0.9 * p.y + ph)
          + 0.30 * sin(1.9 * k * (x - 1.15 * c * t) - 1.7 * p.y + 1.3 * ph)
          + 0.45 * sin(0.45 * k * (x - 0.6 * c * t) + 0.4 * p.y + 2.1 * ph);
  z += 0.25 * w * sin(4.3 * k * (x - 1.3 * c * t) + 3.1 * p.y) * s;   // the fly flutters
  return z * w * gust * (0.04 + 0.11 * s) * L;
#else
  return sin(k * (flow * p.x - c * t) + ph) * w * (0.03 + 0.09 * s) * L;
#endif
}

// the flag point after the wind, and its normal, in the flag's frame
void flagMove(vec3 p0, out vec3 p, out vec3 n) {
  vec3 wl = localWind();
  float t = uTime;
  vec2 uv = vec2(p0.x / uSize.x, 1.0 + p0.y / uSize.y);
#ifdef FLAG_CLOTH
  // cloth texture: which loop frame, which two wind speeds
  float sp = clamp(uWindSpeed, uSpeeds.x, uSpeeds.z);
  float band = sp < uSpeeds.y ? (sp - uSpeeds.x) / (uSpeeds.y - uSpeeds.x) : 1.0 + (sp - uSpeeds.y) / (uSpeeds.z - uSpeeds.y);
  float b0 = min(floor(band), 1.0), bt = band - b0;
  float fr = mod(t * 30.0 + aPhase * uFrames, uFrames);
  float f0 = floor(fr), f1 = mod(f0 + 1.0, uFrames), ft = fr - f0;
  p = mix(mix(vat(uPos, b0 * uFrames + f0).xyz, vat(uPos, b0 * uFrames + f1).xyz, ft),
          mix(vat(uPos, (b0 + 1.0) * uFrames + f0).xyz, vat(uPos, (b0 + 1.0) * uFrames + f1).xyz, ft), bt);
  n = normalize(mix(mix(vat(uNrm, b0 * uFrames + f0).xyz, vat(uNrm, b0 * uFrames + f1).xyz, ft),
                    mix(vat(uNrm, (b0 + 1.0) * uFrames + f0).xyz, vat(uNrm, (b0 + 1.0) * uFrames + f1).xyz, ft), bt));
  vFold = 0.0;
  #ifdef FLAG_POLE
  // baked flying along +x: turn it downwind
  vec2 d = normalize(wl.xz + vec2(1e-4, 0.0));
  p.xz = vec2(p.x * d.x - p.z * d.y, p.x * d.y + p.z * d.x);
  n.xz = vec2(n.x * d.x - n.z * d.y, n.x * d.y + n.z * d.x);
  #else
  // baked with the wind slantwise into the front: mirror for the other sides
  if (wl.z < 0.0) { p.z = -p.z; n.z = -n.z; }
  if (wl.x < -0.3) { p.z *= 0.8; }
  #endif
#else
  #ifdef FLAG_POLE
  float flow = 1.0;
  #else
  float flow = wl.x < -0.2 ? -1.0 : 1.0;   // folds run with the wind along the banner
  #endif
  float e = 0.02;
  float z = wave(p0.xy, t, flow);
  float dzx = (wave(p0.xy + vec2(e, 0.0), t, flow) - z) / e;
  float dzy = (wave(p0.xy + vec2(0.0, e), t, flow) - z) / e;
  vFold = clamp(dzx * 0.6, -1.0, 1.0);
  p = vec3(p0.x, p0.y, z);
  n = normalize(vec3(-dzx, -dzy, 1.0));
  #ifdef FLAG_POLE
  // a slack flag hangs down along the pole; the cloth folds up (it never stretches)
  float droop = 1.0 - smoothstep(1.0, 9.0, uWindSpeed);
  float a = droop * 1.35 * smoothstep(0.0, 0.7, uv.x);
  p.y = p0.y - p0.x * sin(a);
  p.x = p0.x * cos(a);
  p.z += droop * 0.12 * uSize.x * sin(9.0 * uv.x + 2.0 * t + aPhase * 6.0) * uv.x;
  vec2 d = normalize(wl.xz + vec2(1e-4, 0.0));
  p.xz = vec2(p.x * d.x - p.z * d.y, p.x * d.y + p.z * d.x);
  n.xz = vec2(n.x * d.x - n.z * d.y, n.x * d.y + n.z * d.x);
  #else
    #ifdef FLAG_RIPPLE
  // the wind across the banner presses it out, most at the bottom and the fly
  float lean = wl.z * smoothstep(0.0, 20.0, uWindSpeed);
  p.z += lean * 0.35 * uSize.y * pow(1.0 - uv.y, 2.0) * (0.35 + 0.65 * uv.x);
  p.y += abs(lean) * 0.08 * uSize.y * pow(1.0 - uv.y, 2.0);   // so it doesn't stretch
  n = normalize(n + vec3(0.0, lean * 0.7 * (1.0 - uv.y) * (0.35 + 0.65 * uv.x), 0.0));
    #endif
  #endif
#endif
}
`;

// Light through the cloth when the sun is behind it (b and c), a darker
// fold where the cloth turns away (b)
const FRAG = /* glsl */`
uniform vec3 uSunView, uSunColor;
uniform float uTranslucent;
uniform vec3 uTint;
varying float vFold;
`;

let programs = 0;
export function flagMaterial(kind, variant, { map = flagTexture(kind), cloth = null, tint = null } = {}) {
  const k = KINDS[kind];
  const m = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  m.name = `flag ${kind} ${variant}`;
  const uniforms = {
    uTime: { value: 0 }, uWindSpeed: { value: 8 }, uWindDir: { value: new THREE.Vector3(1, 0, 0) },
    uSize: { value: new THREE.Vector2(k.w, k.h) },
    uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
    uTranslucent: { value: variant === 'a' ? 0 : 0.35 },
    uTint: { value: new THREE.Color(tint ?? 0xffffff) },
  };
  if (variant === 'c') Object.assign(uniforms, {
    uPos: { value: cloth.pos }, uNrm: { value: cloth.nrm },
    uFrames: { value: BAKE.frames }, uVerts: { value: k.nu * k.nv }, uSpeeds: { value: new THREE.Vector3(...BAKE.speeds) },
  });
  m.userData.uniforms = uniforms;
  m.defines = { [kind === 'pole' ? 'FLAG_POLE' : 'FLAG_BANNER']: '', ...(variant === 'b' ? { FLAG_RIPPLE: '' } : {}), ...(variant === 'c' ? { FLAG_CLOTH: '' } : {}) };
  m.onBeforeCompile = (sh) => {
    programs++;
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${SHARED}`)
      .replace('#include <beginnormal_vertex>', 'vec3 flagP, objectNormal;\nflagMove(position, flagP, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = flagP;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG}`)
      // the logo reads the right way round from behind too
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        vec2 fuv = gl_FrontFacing ? vMapUv : vec2(1.0 - vMapUv.x, vMapUv.y);
        diffuseColor *= texture2D(map, fuv);
        #endif
        diffuseColor.rgb *= uTint;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uSunColor * uTranslucent * max(0.0, -dot(normal, uSunView));
        diffuseColor.rgb *= 1.0 - 0.12 * max(0.0, vFold);`);
  };
  m.customProgramCacheKey = () => `flag-${kind}-${variant}`;
  return m;
}

// ---------------------------------------------------------------- a field of flags

const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);

// All the flags of one kind: two instanced meshes (near and far grid), one
// material each. poses: [{ position, yaw }] where the flag hangs from (the
// top of the mast; the flag's +x runs out from the mast, yaw turns it).
export class FlagField extends THREE.Group {
  constructor(kind, variant, poses, { lodDistance = 30, cloth = null, tintLod = false } = {}) {
    super();
    this.kind = kind;
    this.variant = variant;
    this.poses = poses;
    this.lodDistance = lodDistance;
    this.phases = poses.map((_, i) => ((i * 0.618034) % 1));
    if (variant === 'c' && !cloth) cloth = bakeCloth(kind);
    this.cloth = cloth;
    const map = flagTexture(kind);
    this.meshes = [false, true].map((far) => {
      const g = flagGeometry(kind, far);
      g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(poses.length), 1));
      const mat = flagMaterial(kind, variant, { map, cloth, tint: far && tintLod ? 0xffc8c8 : null });
      const mesh = new THREE.InstancedMesh(g, mat, poses.length);
      mesh.frustumCulled = false;
      mesh.name = `flags ${kind} ${variant}${far ? ' far' : ''}`;
      this.add(mesh);
      return mesh;
    });
  }

  get triangles() {
    return this.meshes.reduce((s, m) => s + m.count * m.geometry.index.count / 3, 0);
  }

  // wind: speed m/s and downwind direction (world, horizontal unit vector);
  // sun: direction towards the sun (world) and colour, for light through the cloth
  update(t, camera, { speed, dir, sunDir, sunColor }) {
    const counts = [0, 0];
    camera.updateMatrixWorld();
    this.poses.forEach((p, i) => {
      _v.copy(p.position).applyMatrix4(this.matrixWorld);
      const far = _v.distanceTo(camera.position) > this.lodDistance ? 1 : 0;
      const mesh = this.meshes[far], j = counts[far]++;
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw ?? 0);
      mesh.setMatrixAt(j, _m.compose(p.position, _q, _s));
      mesh.geometry.attributes.aPhase.array[j] = this.phases[i];
    });
    this.meshes.forEach((m, far) => {
      m.count = counts[far];
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aPhase.needsUpdate = true;
      const u = m.material.userData.uniforms;
      u.uTime.value = t;
      u.uWindSpeed.value = speed;
      u.uWindDir.value.copy(dir);
      if (sunDir) u.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      if (sunColor) u.uSunColor.value.copy(sunColor);
    });
  }

  dispose() {
    for (const m of this.meshes) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }
    this.cloth?.pos.dispose();
    this.cloth?.nrm.dispose();
  }
}

export const flagPrograms = () => programs;
