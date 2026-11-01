// Loads the control room bake (blender/bake_control_room.py) for both the
// lighting viewer (control.js) and the walk-around game (play.js). Same
// lighting model as the desk: albedo × a weighted sum of baked irradiance,
// here with a ceiling map, a screens map and a sky map that outdoor.js tints
// with the live sky. The glowing parts (screens, ceiling panels, clock, exit
// sign, platform lights) are not baked; they are drawn flat in their own
// colour, scaled by the same weights. The platform outside the window also
// gets the sun live, from its normals (no shadows).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roomVertex } from './shaders.js';
import { drawSlots, assign, contentOf, setOutside, setFeeds, isFeed } from './screens.js';
import { SunShadow } from './sunShadow.js';
import { clock } from './outdoor.js';
import { OVERRIDES, PRIVATE_BASE } from './privateNames.js';
import { loadDeskPhones } from './deskPhones.js';
import { makeCurtains, LOOKS as CURTAIN_LOOKS } from './curtains.js';

const SCENE = 'control/';
// GitHub Pages lets browsers reuse files for ten minutes without asking. After
// a re-bake that can pair a new page with an old meta.json or atlas, so always
// revalidate (a 304 costs next to nothing when nothing changed).
const FRESH = { cache: 'no-cache' };
// The screens carry a pattern in Cycles but are drawn here in their average
// colour; at full strength that reads as a white slab, so draw them dimmer.
const DISPLAY = { screens: 0.32, ceiling: 1, floorlamp: 0.6 };
// A lamp that is off: its shade lit like the room around it (by the ceiling
// lights; the emitters are not in the bake), not black
const LAMP_OFF = new THREE.Color(0.8, 0.76, 0.7).multiplyScalar(0.025);
const lampOff = new THREE.Color();
// The screens show content from screens.js. Redrawing and re-uploading all of
// them a few times a second was too slow, so they are drawn once, as they
// look STATIC_T seconds into the shift (phones get a half-size atlas), and
// only screens showing LIVE content keep moving, each on its own small texture.
export const LIVE = ['assistant', 'deckCam', 'flareCam', 'craneCam', 'boomCam', 'weather']; // content that keeps moving wherever it is shown (the cameras and weather follow outdoor.js)
const isLive = (name) => LIVE.includes(contentOf(name));
const STATIC_T = 600, SCREEN_HZ = 4, SCREEN_GAIN = 1.4;
const ATLAS_EVERY = 3; // s between redraws of the static screens for the clock
// Static screens on their own overlays after load, so a clock redraw never
// re-uploads the atlas (?ownscreens=0: the old way, for A/B)
const OWN_STATIC = new URLSearchParams(location.search).get('ownscreens') !== '0';
const FOCUS_SCALE = 2, FOCUS_HZ = 8; // the screen the player zooms in on
const BUSY_HZ = 20, BUSY_FOR = 0.25; // screens asked for with redraw() (typing, a ring filling): their rate, and how long they count as busy
// ?cull=0: the room's sun shadow drawn all day and every camera picture taken (docs/performance.md)
const CULL = new URLSearchParams(location.search).get('cull') !== '0';
const viewFrustum = new THREE.Frustum(), viewMatrix = new THREE.Matrix4();
// How many pixels across a screen overlay shows as, in a picture `width`
// pixels wide seen by `camera` (its face found once; screens don't move)
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3();
function shownWidth(o, camera, width) {
  o.frame ??= faceFrame(o.mesh, null);   // as sharpen() caches it
  if (!o.frame) return 0;
  _fa.copy(o.frame.at(0, 0.5)).project(camera);
  _fb.copy(o.frame.at(1, 0.5)).project(camera);
  if (_fa.z > 1 || _fb.z > 1) return width;   // reaching behind the camera: big
  return Math.hypot(_fb.x - _fa.x, (_fb.y - _fa.y) / camera.aspect) / 2 * width;
}
const SCREEN_SCALE = matchMedia('(pointer: coarse)').matches ? 0.5 : 1;
// Screens drawn at the size they show at: a screen in view gets its own
// texture with as many texels as it covers canvas pixels (in steps of half
// the slot, up to SHARP_MAX times it and SHARP_TEXELS wide), and live
// screens out of view are not redrawn. Off unless ?sharp=1: on an Intel Arc
// laptop the big canvas uploads took the story's GPU time from 16 to 134 ms a
// frame (story.html?bench=quick, 2026-10-31). Without it, live screens are
// drawn at their slot's size and the rest come from the atlas
// (docs/performance.md)
const SHARP = new URLSearchParams(location.search).get('sharp') === '1';
const SHARP_MAX = 4, SHARP_STEP = 0.5, SHARP_TEXELS = 2048;
const _q0 = new THREE.Vector3(), _q1 = new THREE.Vector3(), _q2 = new THREE.Vector3();

// Seven-segment style digits: the unlit segments faintly, the time bright.
// White on black: the material's colour makes it red.
function drawWallClock(c, text) {
  if (c.shown === text) return;
  c.shown = text;
  const canvas = c.tex.image, ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `bold ${canvas.height * 0.86}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#121212';
  ctx.fillText('88:88', canvas.width / 2, canvas.height * 0.54);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.54);
  c.tex.needsUpdate = true;
}

// The emergency exit sign over the door: a white running figure heading
// into a doorway, on green (the ISO 7010 escape-route style), filling the
// canvas; the figure's right is the viewer's right
function drawExitSign(canvas) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, u = h / 100;
  ctx.fillStyle = '#00a651';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ctx.fillStyle = '#fff';
  ctx.lineCap = ctx.lineJoin = 'round';
  // The doorway: a white frame, open, with the floor line running out of it
  const dx = w / 2 + 18 * u;
  ctx.lineWidth = 6 * u;
  ctx.strokeRect(dx, 14 * u, 34 * u, 72 * u);
  ctx.beginPath(); ctx.moveTo(w / 2 - 50 * u, 86 * u); ctx.lineTo(dx, 86 * u); ctx.stroke();
  // The running figure, mid-stride toward the door
  const x = w / 2 - 12 * u, limb = (pts) => { ctx.beginPath(); ctx.moveTo(...pts[0]); for (const p of pts.slice(1)) ctx.lineTo(...p); ctx.stroke(); };
  ctx.beginPath(); ctx.arc(x + 10 * u, 18 * u, 8 * u, 0, 2 * Math.PI); ctx.fill();
  ctx.lineWidth = 11 * u;
  limb([[x + 6 * u, 32 * u], [x - 2 * u, 54 * u]]);                          // torso, leaning forward
  ctx.lineWidth = 7 * u;
  limb([[x + 5 * u, 34 * u], [x + 18 * u, 40 * u], [x + 26 * u, 32 * u]]);    // front arm
  limb([[x + 4 * u, 34 * u], [x - 10 * u, 42 * u], [x - 18 * u, 36 * u]]);    // back arm
  limb([[x - 2 * u, 54 * u], [x + 12 * u, 64 * u], [x + 8 * u, 80 * u]]);     // front leg
  limb([[x - 2 * u, 54 * u], [x - 14 * u, 66 * u], [x - 28 * u, 70 * u]]);    // back leg
}

function canvasTexture(renderer, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// The faces of a joined screen mesh whose UVs fall in one atlas slot, with
// their UVs stretched to cover a texture of their own
function sliceSlot(geometry, [x, y, w, h], size) {
  const pos = geometry.attributes.position, uv = geometry.attributes.uv, index = geometry.index;
  if (!uv) return null;
  const inside = (i) => {
    const u = uv.getX(i) * size, v = uv.getY(i) * size;
    return u >= x - 0.5 && u <= x + w + 0.5 && v >= y - 0.5 && v <= y + h + 0.5;
  };
  const verts = [], uvs = [];
  const n = index ? index.count : pos.count;
  for (let f = 0; f < n; f += 3) {
    const ids = [0, 1, 2].map((k) => (index ? index.getX(f + k) : f + k));
    if (!ids.every(inside)) continue;
    // Not the thin sides of a box screen, nor a neighbour's edge on the slot border
    const cu = ids.reduce((a, i) => a + uv.getX(i), 0) / 3 * size, cv = ids.reduce((a, i) => a + uv.getY(i), 0) / 3 * size;
    if (cu < x + 1 || cu > x + w - 1 || cv < y + 1 || cv > y + h - 1) continue;
    for (const i of ids) {
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      uvs.push((uv.getX(i) * size - x) / w, (uv.getY(i) * size - y) / h);
    }
  }
  if (!verts.length) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}

const roomFragment = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uLightCeiling;
  uniform sampler2D uLightScreens;
  uniform float uScaleCeiling;
  uniform float uScaleScreens;
  uniform float uCeiling;
  uniform float uScreens;
  uniform sampler2D uLightSky;
  uniform float uScaleSky;
  uniform vec3 uSky;     // the live sky's average radiance (the bake used 1)
  uniform int uMode;     // 0 final, 1 albedo, 2 ceiling light, 3 screens light, 4 sky light
  // The rest corner's lamps (meta.lamps, up to two), switched one by one
  uniform sampler2D uLightLamp0, uLightLamp1;
  uniform float uScaleLamp0, uScaleLamp1;
  uniform float uLamp0, uLamp1;
  varying vec2 vUv;
  // The sun (or moon) as direct light, live, with a shadow map (sunShadow.js)
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowTexel;  // one texel of the map, in metres
  uniform vec3 uWindowLo, uWindowHi; // the window opening (x is the wall), for the sun inside
  uniform vec3 uOpenLo, uOpenHi;     // the part of it the curtains leave clear (curtains.js)
  uniform float uSunPass, uSkyPass;  // and how much of the sun and the baked sky light gets in
  varying vec3 vNormal;
  varying vec3 vWorld;
  #ifdef OUTSIDE
  uniform vec3 uFogColor;
  uniform float uFogDistance;
  #endif
  #ifdef BOARD
  uniform sampler2D uBoard;
  varying vec2 vUv1;
  #endif

  vec3 decode(sampler2D map, float scale) {
    vec3 c = texture2D(map, vUv).rgb;
    return c * c * c * scale;
  }

  // Share of the sun reaching this point: 0 in shadow, 1 in full sun. The
  // point is pushed out along its normal by a couple of texels so a surface
  // never shadows itself. Four taps a texel and a half apart, and the darkest
  // wins: that closes hairline gaps between walls and ceiling, which would
  // otherwise let thin lines of sun through.
  float sunlit(vec3 n) {
    #ifndef OUTSIDE
    // Inside, the sun only comes in through the window: follow the ray from
    // here to the sun to the window's wall and check it lands in the opening.
    // This also stops it leaking through hairline gaps between walls.
    if (uSunDir.x >= -1e-4) return 0.0;
    float k = (uWindowLo.x - vWorld.x) / uSunDir.x;
    vec3 at = vWorld + uSunDir * k;
    if (k < 0.0 || at.y < uOpenLo.y || at.y > uOpenHi.y || at.z < uOpenLo.z || at.z > uOpenHi.z) return 0.0;
    #endif
    vec4 p = uShadowMatrix * vec4(vWorld + n * uShadowTexel * 2.0, 1.0);
    vec3 c = p.xyz / p.w * 0.5 + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    vec2 d = vec2(1.5 / float(textureSize(uShadowMap, 0).x));
    float lit = 1.0;
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(i == 1 || i == 3 ? 1.0 : -1.0, i >= 2 ? 1.0 : -1.0) * d;
      lit = min(lit, step(c.z, texture2D(uShadowMap, c.xy + o).r + 1e-4));
    }
    return lit;
  }

  void main() {
    #ifdef BOARD
    vec3 albedo = texture2D(uBoard, vUv1).rgb;  // whiteboards: their own sharp image, lit by the atlas
    #else
    vec3 albedo = texture2D(uAlbedo, vUv).rgb;
    #endif
    vec3 eCeiling = uCeiling * decode(uLightCeiling, uScaleCeiling);
    vec3 eScreens = uScreens * decode(uLightScreens, uScaleScreens);
    vec3 eSky = uSky * decode(uLightSky, uScaleSky);
    #ifndef OUTSIDE
    eSky *= uSkyPass;
    #endif
    vec3 eLamps = uLamp0 * decode(uLightLamp0, uScaleLamp0) + uLamp1 * decode(uLightLamp1, uScaleLamp1);
    vec3 n = normalize(vNormal);
    float facing = dot(n, uSunDir);
    #ifdef OUTSIDE
    float sunPass = 1.0;
    #else
    float sunPass = uSunPass;
    #endif
    if (facing > 0.0 && dot(uSun, uSun) > 1e-8 && sunPass > 0.0) eSky += uSun * facing * sunPass * sunlit(n);
    vec3 color = albedo * (eCeiling + eScreens + eSky + eLamps);
    if (uMode == 2) color = eCeiling;
    if (uMode == 3) color = eScreens;
    if (uMode == 4) color = eSky;
    #ifdef OUTSIDE
    if (uMode == 0) color = mix(color, uFogColor, 1.0 - exp2(-distance(vWorld, cameraPosition) / uFogDistance));
    #endif
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    if (uMode == 1) gl_FragColor = linearToOutputTexel(vec4(albedo, 1.0));
  }
`;

// The room's vertex shader plus normals, for the sun
const sunVertex = roomVertex
  .replace('varying vec2 vUv;', 'varying vec2 vUv;\n  varying vec3 vNormal;')
  .replace('vUv = uv;', 'vUv = uv;\n    vNormal = normalize(mat3(modelMatrix) * normal);');

// Whiteboard surfaces: plus their second UV set
const boardVertex = sunVertex
  .replace('varying vec2 vUv;', 'varying vec2 vUv;\n  varying vec2 vUv1;')
  .replace('vUv = uv;', 'vUv = uv;\n    vUv1 = uv1;');

// A black 1×1 light map, for a bake from before the sky map existed
function blackMap() {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  tex.needsUpdate = true;
  return tex;
}

async function bytes(name) {
  const res = await fetch(SCENE + name, FRESH);
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}). Run blender/bake_control_room.py first.`);
  return res.arrayBuffer();
}

// Anisotropic filtering: each tap of it costs on every pixel of the room, and
// the light maps are smooth, so they go without; the albedo and whiteboards
// get a little, which keeps the floor and desks sharp at a glance.
// ?aniso=old gives every map the GPU's most (16 on most), as before 2026-10-26
const ANISO_OLD = new URLSearchParams(location.search).get('aniso') === 'old';
const ANISO_COLOUR = 4;

async function texture(renderer, buffer, srgb) {
  const bitmap = await createImageBitmap(new Blob([buffer]), { imageOrientation: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const most = renderer.capabilities.getMaxAnisotropy();
  tex.anisotropy = ANISO_OLD ? most : srgb ? Math.min(most, ANISO_COLOUR) : 1;
  tex.needsUpdate = true;
  return tex;
}

export async function loadControlRoom(renderer) {
  const meta = await fetch(SCENE + 'meta.json', FRESH).then((r) => { if (!r.ok) throw new Error('Could not load meta.json. Run blender/bake_control_room.py first.'); return r.json(); });
  const lamps = Object.entries(meta.lamps ?? {}).slice(0, 2); // [name, { map, scale }]
  const [glb, albedoBuf, ceilBuf, scrBuf, skyBuf, ...lampBufs] = await Promise.all([
    bytes('scene.glb'), bytes('albedo.png'), bytes('light_ceiling.png'), bytes('light_screens.png'),
    meta.scaleSky ? bytes('light_sky.png') : null, ...lamps.map(([, l]) => bytes(l.map)),
  ]);
  const [albedo, lightCeiling, lightScreens, lightSky, ...lampMaps] = await Promise.all([
    texture(renderer, albedoBuf, true), texture(renderer, ceilBuf, false), texture(renderer, scrBuf, false),
    skyBuf ? texture(renderer, skyBuf, false) : blackMap(),
    ...lampBufs.map((buf) => texture(renderer, buf, false)),
  ]);
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  // The desk phones, live where the bake left them out (deskPhones.js)
  const phones = await loadDeskPhones(meta.layout?.phones).catch((e) => { console.warn('desk phones', e); return null; });
  if (phones) gltf.scene.add(phones.root);

  const shadows = new SunShadow(renderer);
  // The window, in three's axes (Blender y is -z); defaults match control_room.py
  const [wx, wy0, wy1, wz0, wz1] = meta.layout?.window ?? [-5.4, -2.4, 2.6, 0.85, 2.45];
  const windowLo = [wx, wz0, -wy1], windowHi = [wx, wz1, -wy0];
  const material = new THREE.ShaderMaterial({
    vertexShader: sunVertex,
    fragmentShader: roomFragment,
    uniforms: {
      uAlbedo: { value: albedo }, uLightCeiling: { value: lightCeiling }, uLightScreens: { value: lightScreens },
      uScaleCeiling: { value: meta.scaleCeiling }, uScaleScreens: { value: meta.scaleScreens },
      uCeiling: { value: 1 }, uScreens: { value: 1 }, uMode: { value: 0 },
      uLightSky: { value: lightSky }, uScaleSky: { value: meta.scaleSky ?? 0 }, uSky: { value: new THREE.Color(0, 0, 0) },
      uSun: { value: new THREE.Color(0, 0, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      ...shadows.room.uniforms,
      uLightLamp0: { value: lampMaps[0] ?? blackMap() }, uLightLamp1: { value: lampMaps[1] ?? blackMap() },
      uScaleLamp0: { value: lamps[0]?.[1].scale ?? 0 }, uScaleLamp1: { value: lamps[1]?.[1].scale ?? 0 },
      uLamp0: { value: 1 }, uLamp1: { value: 1 },
      uWindowLo: { value: new THREE.Vector3(...windowLo) }, uWindowHi: { value: new THREE.Vector3(...windowHi) },
      uOpenLo: { value: new THREE.Vector3(...windowLo) }, uOpenHi: { value: new THREE.Vector3(...windowHi) },
      uSunPass: { value: 1 }, uSkyPass: { value: 1 },
    },
  });
  // Curtains on the window (?curtains=a|b|c, 0 for none), open to start with
  const curtainLook = new URLSearchParams(location.search).get('curtains') ?? 'a';
  const curtains = CURTAIN_LOOKS.includes(curtainLook)
    ? makeCurtains(new THREE.Vector3(...windowLo), new THREE.Vector3(...windowHi), curtainLook) : null;
  const letIn = () => {
    const o = curtains.opening, u = material.uniforms;
    u.uOpenLo.value.copy(o.lo);
    u.uOpenHi.value.copy(o.hi);
    u.uSunPass.value = o.sun;
    u.uSkyPass.value = o.sky;
  };
  if (curtains) { gltf.scene.add(curtains.group); letIn(); }
  // The platform outside the window: the same atlas, plus the sun
  const outsideMesh = gltf.scene.getObjectByName('Outside');
  let outside = null;
  if (outsideMesh) {
    outside = material.clone();
    outside.defines = { OUTSIDE: '' };
    outside.uniforms = { ...material.uniforms, ...shadows.platform.uniforms, uFogColor: { value: new THREE.Color() }, uFogDistance: { value: 1e5 } };
    outsideMesh.material = outside;
  }
  // The movable things (chairs, mugs, coffee) share the room's atlas
  for (const name of ['Room', ...(meta.movable ?? [])]) {
    const mesh = gltf.scene.getObjectByName(name);
    if (mesh) mesh.material = material;
  }
  // The rest corner's wall clock: its hands are split out of the bake,
  // pointing at 12, each turning about the dial's axis (local +Z, the
  // dial's front) to follow the game's clock
  const hands = [];
  for (const name of meta.movable ?? []) {
    const kind = { HourHand: 12, MinuteHand: 1, SecondHand: 1 / 60 }[name.match(/(Hour|Minute|Second)Hand$/)?.[0]];
    const obj = kind && gltf.scene.getObjectByName(name);
    if (obj) hands.push({ obj, hours: kind, rest: obj.quaternion.clone() });
  }
  const handTurn = new THREE.Quaternion(), dialAxis = new THREE.Vector3(0, 0, 1);
  // Whiteboards share its light too, with their own image as albedo. Drawn
  // once at bake time, so they cost one texture each and nothing per frame.
  const boards = Object.entries(meta.boards ?? {});
  // The private build (?private=1) swaps in its own pictures for the boards
  // overrides.json `boards` lists (the desk photo frames' portraits)
  const own = (png) => fetch(`${PRIVATE_BASE}control/${png}`).then((r) => (r.ok ? r.arrayBuffer() : bytes(png)));
  const boardBufs = await Promise.all(boards.map(([, png]) => (OVERRIDES.boards?.includes(png) ? own(png) : bytes(png))));
  for (const [i, [name]] of boards.entries()) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    const board = material.clone();
    board.vertexShader = boardVertex;
    board.defines = { BOARD: '', USE_UV1: '' };
    board.uniforms = { ...material.uniforms, uBoard: { value: await texture(renderer, boardBufs[i], true) } };
    mesh.material = board;
    renderer.initTexture(board.uniforms.uBoard.value);   // uploaded now, not on the frame a board first comes into view
  }
  // Every screen is drawn once into a static atlas. A screen that moves (the
  // LIVE ones, and the one the player zooms in on) gets its own texture on a
  // copy of its faces, laid just over the atlas.
  let screens = null;
  if (meta.screens) {
    const { canvas: size, slots } = meta.screens;
    const atlas = canvasTexture(renderer, size * SCREEN_SCALE, size * SCREEN_SCALE);
    drawSlots(atlas.image.getContext('2d'), slots, STATIC_T, SCREEN_SCALE);
    screens = { atlas, meshes: [], overlays: new Map(), focus: null, drawn: -Infinity, focusDrawn: -Infinity, atlasTime: -1, atlasDrawn: -Infinity, t: 0, busy: new Map(), covered: new Set() };
  }
  const emitters = [];
  for (const [name, e] of Object.entries(meta.emitters)) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    const textured = screens && name.startsWith('EmitScreen');
    mesh.material = new THREE.MeshBasicMaterial(textured ? { map: screens.atlas } : {});
    emitters.push({ material: mesh.material, color: new THREE.Color(...e.color), strength: e.strength, group: e.group, textured,
      lamp: lamps.findIndex(([n]) => n === e.group), mesh });
    if (textured) screens.meshes.push(mesh);
  }
  // The red wall clock: its digits on a face in front of the glowing box,
  // lit with the same colour and strength, showing the time outside
  const clockMesh = gltf.scene.getObjectByName('EmitClock');
  let wallClock = null;
  if (clockMesh && meta.emitters.EmitClock) {
    const box = new THREE.Box3().setFromObject(clockMesh), size = box.getSize(new THREE.Vector3());
    const tex = canvasTexture(renderer, 320, 80);
    tex.flipY = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), mat);
    face.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z + 0.001);
    gltf.scene.add(face);
    clockMesh.visible = false;   // the box's edges showed as a bright line round the digits; it only lights the bake
    const e = meta.emitters.EmitClock;
    emitters.push({ material: mat, color: new THREE.Color(...e.color), strength: e.strength, group: e.group });
    wallClock = { tex, shown: '' };
    drawWallClock(wallClock, '--:--');
  }
  // The exit sign: its pictogram on a face over the glowing box, toward the
  // room (-X), lit with the box's strength
  const exitMesh = gltf.scene.getObjectByName('EmitExitSign');
  if (exitMesh && meta.emitters.EmitExitSign) {
    const box = new THREE.Box3().setFromObject(exitMesh), size = box.getSize(new THREE.Vector3());
    const tex = canvasTexture(renderer, 340 * 2, 120 * 2);
    tex.flipY = true;
    drawExitSign(tex.image);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(size.z, size.y), mat);
    face.rotation.y = -Math.PI / 2; // its front toward -X; its +X along +Z, the viewer's right
    face.position.set(box.min.x - 0.002, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
    gltf.scene.add(face);
    const e = meta.emitters.EmitExitSign;
    emitters.push({ material: mat, color: new THREE.Color(1, 1, 1), strength: e.strength, group: e.group });
  }
  // The overlay for one screen, made the first time it is needed; `scale`
  // times the atlas slot's resolution
  function overlay(name, scale, exact = false) {
    let o = screens.overlays.get(name);
    if (o && (exact ? o.scale === scale : o.scale >= scale)) return o;
    const slot = slots[name];
    if (!slot) return null;
    if (!o) {
      for (const mesh of screens.meshes) {
        const geometry = sliceSlot(mesh.geometry, slot, meta.screens.canvas);
        if (!geometry) continue;
        // lift it 2 mm off the glass: the polygon offset alone lost to the
        // screen underneath close up, a triangle at a time (the camera's
        // full zoom on a chat showed the atlas's older picture through half the quad)
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        const pos = geometry.attributes.position, nrm = geometry.attributes.normal;
        for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + nrm.getX(i) * 0.002, pos.getY(i) + nrm.getY(i) * 0.002, pos.getZ(i) + nrm.getZ(i) * 0.002);
        const mat = overlayMaterial(feedGain);
        o = { name, slot, mesh: new THREE.Mesh(geometry, mat), scale: 0, tex: null };
        o.mesh.visible = false; // until it has a texture and is wanted
        mesh.add(o.mesh);
        emitters.push({ material: mat, group: 'screens', textured: true });
        screens.overlays.set(name, o);
        break;
      }
      if (!o) return null;
    }
    if (exact ? scale === o.scale || scale <= 0 : scale <= o.scale) return o;
    o.tex?.dispose();
    o.tex = canvasTexture(renderer, slot[2] * scale, slot[3] * scale);
    o.scale = scale;
    o.mesh.material.uniforms.uOver.value = o.tex;
    showFeed(o);
    draw(o, 0);
    return o;
  }
  function draw(o, t) {
    drawSlots(o.tex.image.getContext('2d'), { [o.name]: [0, 0, o.slot[2], o.slot[3]] }, STATIC_T + t, o.scale, undefined, true);
    o.tex.needsUpdate = true;
  }
  // A static screen at the room's clock (as the atlas has it)
  function drawStatic(o) {
    const out = screens.outside;
    if (out) setOutside(out, STATIC_T);
    draw(o, 0);
    if (out) setOutside(out, STATIC_T + screens.t);
  }
  // Put a live camera's picture under the overlay when the screen shows one
  const feeds = {}, feedGain = { value: 1 };
  let gainSource = feedGain;
  function showFeed(o) {
    const m = o.mesh.material, id = contentOf(o.name), feed = isFeed(id) ? feeds[id] : null;
    m.uniforms.uFeed.value = feed;
    const raw = Boolean(feed?.userData.raw);
    if (Boolean(m.defines.FEED) !== Boolean(feed) || Boolean(m.defines.FEED_RAW) !== raw) {
      if (feed) m.defines.FEED = ''; else delete m.defines.FEED;
      if (raw) m.defines.FEED_RAW = ''; else delete m.defines.FEED_RAW;
      m.needsUpdate = true;
    }
  }
  const slots = meta.screens?.slots ?? {};
  // SHARP: the scale a screen needs from this view, 0 when out of it
  // The texels per slot unit it takes for the screen to look sharp: the most
  // canvas pixels one unit covers, sampled on a 3×3 grid over its face,
  // counting only points in front of the camera and on the canvas (so a
  // screen reaching past the edge or behind the camera isn't overdone)
  function wanted(o, width, height) {
    if (!viewFrustum.intersectsObject(o.mesh)) return 0;
    o.frame ??= faceFrame(o.mesh, null);
    if (!o.frame) return 1;
    let need = 0;
    const d = 0.02;
    for (const u of [0.1, 0.5, 0.9]) for (const v of [0.1, 0.5, 0.9]) {
      if (!onCanvas(o.frame.at(u, v), _q0) || Math.abs(_q0.x) > 1 || Math.abs(_q0.y) > 1) continue;
      if (!onCanvas(o.frame.at(u + d, v), _q1) || !onCanvas(o.frame.at(u, v + d), _q2)) continue;
      const across = Math.hypot((_q1.x - _q0.x) * width / 2, (_q1.y - _q0.y) * height / 2) / d;
      const down = Math.hypot((_q2.x - _q0.x) * width / 2, (_q2.y - _q0.y) * height / 2) / d;
      need = Math.max(need, across / o.slot[2], down / o.slot[3]);
    }
    const most = Math.min(SHARP_MAX, Math.floor(SHARP_TEXELS / Math.max(o.slot[2], o.slot[3]) / SHARP_STEP) * SHARP_STEP);
    return Math.min(most, Math.max(1, Math.ceil(need / SHARP_STEP - 0.15) * SHARP_STEP));
  }
  // A world point in clip space; false when it is behind the camera
  function onCanvas(p, out) {
    out.copy(p).applyMatrix4(sharpCam.matrixWorldInverse);
    if (out.z > -sharpCam.near) return false;
    out.applyMatrix4(sharpCam.projectionMatrix);
    return true;
  }
  let sharpCam = null;
  function sharpen(camera, width, height) {
    sharpCam = camera;
    camera.updateMatrixWorld();
    viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    for (const name of Object.keys(slots)) {
      const o = overlay(name, 0);
      if (!o) continue;
      const live = isLive(name), focus = o === screens.focus;
      const want = wanted(o, width, height), was = o.seen;
      o.seen = want > 0;
      // live ones always have a texture; static ones only when the atlas is too coarse
      let target = live || o.own ? Math.max(1, want) : want > 1 ? want : 0;
      if (focus) target = Math.max(target, FOCUS_SCALE);
      if (!o.seen && !focus) target = live || o.own ? 1 : 0;   // out of view: back to the slot's size
      // grow at once; shrink only well below, so a slow dolly doesn't redraw every step
      if (target > o.scale || (target > 0 && target <= o.scale / 2)) {
        overlay(name, target, true);
        if (live) draw(o, screens.time);
      } else if (live && o.seen && !was) draw(o, screens.time);   // stale from its time out of view
      if (!live && !focus && !o.own) {
        const show = target > 0 && o.scale > 1;
        if (show && !o.mesh.visible) draw(o, 0);
        o.mesh.visible = show;
      }
    }
  }
  if (screens) for (const name of Object.keys(slots)) if (isLive(name)) { const o = overlay(name, 1); if (o) o.mesh.visible = true; }
  gltf.scene.updateMatrixWorld(true);
  // What the sun's shadow maps cover: the room (with a margin for the walls)
  // and the platform
  const [rx0, ry0, rx1, ry1] = meta.layout?.room ?? [-6, -4, 6, 5];
  shadows.room.fit(new THREE.Box3(new THREE.Vector3(rx0 - 0.6, -0.3, -ry1 - 0.6), new THREE.Vector3(rx1 + 0.6, 3.5, -ry0 + 0.6)));
  if (outsideMesh) shadows.platform.fit(new THREE.Box3().setFromObject(outsideMesh));
  const casters = gltf.scene.children.filter((o) => o.isMesh && !o.name.startsWith('Emit'));

  return {
    meta,
    root: gltf.scene,
    phones,
    cameras: gltf.cameras,
    sizes: { glb: glb.byteLength, maps: [albedoBuf, ceilBuf, scrBuf, skyBuf, ...boardBufs].reduce((n, b) => n + (b?.byteLength ?? 0), 0) },
    seaLevel: meta.seaLevel ?? -69.2,
    window: { lo: new THREE.Vector3(...windowLo), hi: new THREE.Vector3(...windowHi) },
    // The window's curtains: set(open, now) and step(dt) every frame; null
    // with ?curtains=0
    curtains: curtains && {
      look: curtains.look,
      meshes: curtains.meshes,
      get open() { return curtains.open; },
      set(open, now = false) { curtains.set(open, now); letIn(); },
      step(dt) { if (curtains.step(dt)) letIn(); },
    },
    // Daylight from outdoor.js: the sky's average radiance, and the sun (or
    // moon) for the platform
    // and the shadows it casts (re-rendered when the sun moves, and now and
    // then for the things that move in the room)
    setDaylight({ sky, sun, sunDir, fog, fogDistance }, t = 0) {
      const u = material.uniforms;
      u.uSky.value.copy(sky);
      u.uSun.value.copy(sun);
      u.uSunDir.value.copy(sunDir);
      // The sun gets in only through the window, from its side (sunlit() in
      // roomFragment) and past the curtains
      if (sun.r + sun.g + sun.b > 1e-5) shadows.update(sunDir, casters, gltf.scene, t, !CULL || (sunDir.x < -1e-4 && u.uSunPass.value > 0));
      curtains?.setDaylight({ sky, sun, sunDir });
      if (!outside) return;
      outside.uniforms.uFogColor.value.copy(fog);
      outside.uniforms.uFogDistance.value = fogDistance;
    },
    // Set the light mix: weights for the two groups, and the debug view
    setLights(ceiling, screens, mode = 0) {
      const u = material.uniforms;
      u.uCeiling.value = ceiling;
      u.uScreens.value = screens;
      u.uMode.value = mode;
      curtains?.setLights(ceiling);
      lampOff.copy(LAMP_OFF).multiplyScalar(ceiling);
      phones?.setLight(ceiling + 0.25 * screens);
      for (const e of emitters) {
        if (e.lamp >= 0) continue; // see setLamp
        const w = e.group === 'screens' ? screens : ceiling;
        if (e.textured) e.material.color.setScalar(SCREEN_GAIN * (mode === 0 ? w : 0.02));
        else e.material.color.copy(e.color).multiplyScalar(e.strength * DISPLAY[e.group] * (mode === 0 ? w : 0.02));
      }
    },
    // The rest corner's lamps: their names (meta.lamps), and how bright one
    // is, 0 (off) to 1
    lamps: lamps.map(([name]) => name),
    // A lamp's glowing parts, for aiming at it
    lampMeshes(name) {
      const i = lamps.findIndex(([n]) => n === name);
      return emitters.filter((e) => i >= 0 && e.lamp === i).map((e) => e.mesh);
    },
    setLamp(name, w) {
      const i = lamps.findIndex(([n]) => n === name);
      if (i < 0) return;
      material.uniforms[`uLamp${i}`].value = w;
      for (const e of emitters) {
        if (e.lamp !== i) continue;
        e.material.color.copy(e.color).multiplyScalar(e.strength * DISPLAY[e.group] * w).lerp(lampOff, Math.max(0, 1 - 4 * w));
      }
    },
    // Redraw the live screens for time t (seconds), at most SCREEN_HZ times a
    // second; the focused one at FOCUS_HZ
    // `outside` is outdoor.js's cctv summary, for the camera and weather screens
    // Set the wall clock's hands to a time of day in hours (outdoor.js's
    // state.time); each hand goes round once per `hours`
    setClock(time) {
      for (const h of hands) {
        handTurn.setFromAxisAngle(dialAxis, -2 * Math.PI * ((time % h.hours) / h.hours)); // clockwise, seen from the front
        h.obj.quaternion.copy(h.rest).multiply(handTurn);
      }
    },
    // With `view` ({ camera, width, height }, canvas pixels), the screens in
    // it drawn at the size they show at and live ones out of it left alone
    updateScreens(t, outside, view = null) {
      feedGain.value = gainSource.value;
      const sharp = SHARP && view && screens;
      if (sharp) { screens.time = t; sharpen(view.camera, view.width, view.height); }
      if (wallClock && outside) drawWallClock(wallClock, clock(outside.time));
      if (!screens) return;
      if (outside) {
        setOutside(outside, STATIC_T + t);
        // The static screens show the clock too: redraw them when it has
        // moved on a minute (or the time was changed), at most every few seconds
        // The first time (at load) the whole atlas goes up, and every static
        // screen gets its own small overlay. After that only the overlays are
        // redrawn, each when it is in view: uploading the 2048² atlas again
        // took ~150 ms on the Arc laptop, on every jump in the story's time.
        if (Math.abs(outside.time - screens.atlasTime) >= 1 / 60 && t - screens.atlasDrawn >= ATLAS_EVERY) {
          const first = screens.atlasTime < 0;
          screens.atlasTime = outside.time;
          screens.atlasDrawn = t;
          setOutside(outside, STATIC_T);
          drawSlots(screens.atlas.image.getContext('2d'), slots, STATIC_T, SCREEN_SCALE);   // the canvas kept in step
          if (first) {
            screens.atlas.needsUpdate = true;
            if (OWN_STATIC) for (const name of Object.keys(slots)) { const o = overlay(name, 1); if (o) { o.own = true; o.mesh.visible = true; } }
          }
          for (const [name, o] of screens.overlays) if (!isLive(name) && o.mesh.visible && o !== screens.focus) { if (first) draw(o, 0); else o.stale = true; }
          if (!first && !OWN_STATIC) screens.atlas.needsUpdate = true;
          setOutside(outside, STATIC_T + t);
        }
      }
      screens.t = t;
      screens.outside = outside;
      const f = screens.focus, covered = screens.covered;
      // static screens behind on the clock: redrawn once in view, two a frame
      if (view?.camera) {
        view.camera.updateMatrixWorld();
        viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(view.camera.projectionMatrix, view.camera.matrixWorldInverse));
      }
      let n = 0;
      for (const o of screens.overlays.values()) {
        if (!o.stale || n >= 2 || covered.has(o.name) || (view?.camera && !viewFrustum.intersectsObject(o.mesh))) continue;
        o.stale = false; n++;
        drawStatic(o);
      }
      if (f && t - screens.focusDrawn >= 1 / FOCUS_HZ) { screens.focusDrawn = t; draw(f, t); }
      // busy screens (redraw()) at their own rate, unless a page canvas covers them
      for (const [name, at] of screens.busy) {
        const o = screens.overlays.get(name);
        if (!o?.tex || o === f || covered.has(name) || at > t || t - (o.drawnAt ?? -Infinity) < 1 / BUSY_HZ) continue;
        o.drawnAt = t; draw(o, t);
        if (t - at > BUSY_FOR) screens.busy.delete(name);
      }
      if (t - screens.drawn < 1 / SCREEN_HZ) return;
      screens.drawn = t;
      for (const [name, o] of screens.overlays) if (o !== f && isLive(name) && (!sharp || o.seen) && !covered.has(name)) draw(o, t);
    },
    // The meshes the screens are drawn on, for raycasting
    screenMeshes: screens?.meshes ?? [],
    // Which screen a raycast hit on one of screenMeshes landed on
    screenAt(hit) {
      if (!hit?.uv) return null;
      const u = hit.uv.x * meta.screens.canvas, v = hit.uv.y * meta.screens.canvas;
      return Object.keys(slots).find((n) => { const [x, y, w, h] = slots[n]; return u >= x && u <= x + w && v >= y && v <= y + h; }) ?? null;
    },
    // A screen's face in world space: its centre, its outward normal (toward
    // `from`), the unit vector pointing up the picture, and its size in metres
    screenFrame(name, from) {
      const o = overlay(name, 0);
      if (!o) return null;
      return faceFrame(o.mesh, from);
    },
    // Change what a screen shows (an id from screens.js CONTENT). The new
    // picture goes on the screen's own small overlay (`own`), not into the
    // atlas: uploading the 2048² atlas stalled the frame on every story beat
    // that changed a screen. The atlas canvas is kept in step, and goes up
    // with its next clock redraw.
    setContent(name, id) {
      if (!screens || !slots[name]) return;
      assign(name, id);
      drawSlots(screens.atlas.image.getContext('2d'), { [name]: slots[name] }, STATIC_T, SCREEN_SCALE);
      const o = overlay(name, 1);
      if (o) { o.own = true; showFeed(o); draw(o, 0); o.mesh.visible = true; }
      else screens.atlas.needsUpdate = true;
    },
    // Live camera pictures from cctv.js (id -> texture) and the cameras' gain:
    // those screens show the picture with only rain, noise and caption drawn.
    // A texture with userData.raw is shown as it is, without the cameras' gain
    // (story mode's CtrlBuddy, drawn in 3D under his screen's picture)
    setFeeds(textures, gain) {
      Object.assign(feeds, textures);
      if (gain) gainSource = gain;
      setFeeds(Object.keys(feeds));
      if (!screens) return;
      // only the screens showing one of these cameras (each redraw is an upload)
      for (const o of screens.overlays.values()) if (contentOf(o.name) in textures) { showFeed(o); if (o.tex) draw(o, 0); }
    },
    // Which camera pictures some screen shows right now (to skip the others)
    // With `camera`, only the screens in its view: a camera picture nobody
    // sees isn't taken (cctv.js still takes each one once, so a screen that
    // turns into view never starts out black). Then also how wide each
    // picture shows, in pixels of a picture `width` across (the widest
    // screen showing it), for cctv.js to take it at that size
    feedsShown(camera = null, width = 0) {
      const shown = new Map();
      if (camera) {
        camera.updateMatrixWorld();
        viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      }
      if (screens) for (const o of screens.overlays.values()) {
        if (!o.mesh.visible || !o.mesh.material.uniforms.uFeed.value) continue;
        if (camera && !viewFrustum.intersectsObject(o.mesh)) continue;
        const id = contentOf(o.name);
        shown.set(id, Math.max(shown.get(id) ?? 0, camera && width ? shownWidth(o, camera, width) : 0));
      }
      return shown;
    },
    // The camera on the screen shown sharp, if it shows one (for cctv.js)
    // Redraw the live screens on the next frame, whatever their rate: what
    // they show has just changed (a chat's messages), so the old picture
    // mustn't stay up for a quarter of a second
    redrawNow() {
      if (screens) screens.drawn = screens.focusDrawn = -Infinity;
    },
    // Keep redrawing these screens at BUSY_HZ for a moment (call it every
    // frame while they change, e.g. code being typed): only them, not every
    // live screen in the room as redrawNow does
    redraw(...names) {
      if (!screens) return;
      for (const n of names) screens.busy.set(n, screens.t);
    },
    // Whether redraw() asked for this screen just now (story/closeups.js
    // draws such a screen's page canvas faster)
    busy(name) {
      const at = screens?.busy.get(name);
      return at !== undefined && screens.t - at <= BUSY_FOR;
    },
    // The screens a page canvas covers right now (story/closeups.js): their
    // WebGL picture isn't seen, so it isn't redrawn; drawn again when uncovered
    cover(names) {
      if (!screens) return;
      for (const n of screens.covered) if (!names.includes(n)) { const o = screens.overlays.get(n); if (o?.tex) { if (isLive(n)) draw(o, screens.t); else drawStatic(o); o.stale = false; } }
      screens.covered = new Set(names);
    },
    // ... or only the screen zoomed in on (letters typed into a chat)
    redrawFocus() {
      if (screens) screens.focusDrawn = -Infinity;
    },
    focusedFeed() {
      const id = screens?.focus && contentOf(screens.focus.name);
      return id && isFeed(id) ? id : null;
    },
    // Show one screen sharp and fully live (null for none)
    setFocus(name) {
      if (!screens) return;
      const prev = screens.focus;
      screens.focus = name ? overlay(name, FOCUS_SCALE) : null;
      if (prev && prev !== screens.focus && !isLive(prev.name) && !prev.own) prev.mesh.visible = false;
      if (screens.focus) { screens.focus.mesh.visible = true; screens.focusDrawn = -Infinity; }
    },
  };
}

// A screen's own texture: its canvas, or for a live camera (cctv.js) the
// camera's picture with the canvas drawn over it. The picture is linear and
// unbounded; the camera's gain and a soft shoulder bring it into 0..1 like a
// real camera's output, before the screen's own brightness and tone mapping.
function overlayMaterial(feedGain) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uOver: { value: null }, uFeed: { value: null }, uColor: { value: new THREE.Color(1, 1, 1) }, uFeedGain: feedGain },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uOver, uFeed;
      uniform vec3 uColor;
      uniform float uFeedGain;
      varying vec2 vUv;
      void main() {
        vec4 over = texture2D(uOver, vUv);
        vec3 col = over.rgb;
        #ifdef FEED
          vec3 pic = texture2D(uFeed, vec2(vUv.x, 1.0 - vUv.y)).rgb;  // render targets run bottom up
          #ifndef FEED_RAW
            pic *= uFeedGain;   // a camera's picture: its exposure, and a soft shoulder
            pic = pic / (1.0 + pic);
          #endif
          col = mix(pic, over.rgb, over.a);
        #endif
        gl_FragColor = vec4(col * uColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
  m.color = m.uniforms.uColor.value; // so setLights can set it like a basic material's
  return m;
}

// Fit P(u, v) = O + u·U + v·V to the biggest front-facing triangle of a
// screen overlay (its UVs run 0..1 across the picture, v downwards)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
function faceFrame(mesh, from) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv;
  let best = null;
  for (let i = 0; i < pos.count; i += 3) {
    _a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    _b.fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    _c.fromBufferAttribute(pos, i + 2).applyMatrix4(mesh.matrixWorld);
    _n.subVectors(_b, _a).cross(_c.clone().sub(_a));
    const area = _n.length();
    // UV area tells a screen face from the thin sides of a box screen
    const du1 = uv.getX(i + 1) - uv.getX(i), dv1 = uv.getY(i + 1) - uv.getY(i);
    const du2 = uv.getX(i + 2) - uv.getX(i), dv2 = uv.getY(i + 2) - uv.getY(i);
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 0.1 || (best && area <= best.area)) continue;
    if (from && _n.dot(from.clone().sub(_a)) < 0) continue;
    // Solve (B - A) = du1·U + dv1·V and (C - A) = du2·U + dv2·V
    const e1 = _b.clone().sub(_a), e2 = _c.clone().sub(_a);
    const U = e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det);
    const V = e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det);
    const O = _a.clone().addScaledVector(U, -uv.getX(i)).addScaledVector(V, -uv.getY(i));
    best = { area, O, U, V };
  }
  if (!best) return null;
  const { O, U, V } = best;
  const center = O.clone().addScaledVector(U, 0.5).addScaledVector(V, 0.5);
  const normal = new THREE.Vector3().crossVectors(U, V).normalize();
  if (from && normal.dot(from.clone().sub(center)) < 0) normal.negate();
  return { center, normal, up: V.clone().normalize().negate(), width: U.length(), height: V.length(), at: (u, v) => O.clone().addScaledVector(U, u).addScaledVector(V, v) };
}
