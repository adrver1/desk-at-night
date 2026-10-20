// Loads the control room bake (blender/bake_control_room.py) for both the
// lighting viewer (control.js) and the walk-around game (play.js). Same
// lighting model as the desk: albedo × a weighted sum of baked irradiance,
// here with a ceiling map and a screens map. The glowing parts (screens,
// ceiling panels, clock, exit sign, platform lights) are not baked; they are
// drawn flat in their own colour, scaled by the same weights.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roomVertex } from './shaders.js';
import { drawSlots } from './screens.js';

const SCENE = 'control/';
// GitHub Pages lets browsers reuse files for ten minutes without asking. After
// a re-bake that can pair a new page with an old meta.json or atlas, so always
// revalidate (a 304 costs next to nothing when nothing changed).
const FRESH = { cache: 'no-cache' };
export const SKY = new THREE.Color(0.012, 0.02, 0.045); // Blender world colour (linear)
// The screens carry a pattern in Cycles but are drawn here in their average
// colour; at full strength that reads as a white slab, so draw them dimmer.
const DISPLAY = { screens: 0.32, ceiling: 1 };
// The screens show content from screens.js. Redrawing and re-uploading all of
// them a few times a second was too slow, so they are drawn once, as they
// look STATIC_T seconds into the shift (phones get a half-size atlas), and
// only the LIVE screens keep moving, each on its own small texture.
const LIVE = ['Desk0Mon5Screen']; // the operations assistant
const STATIC_T = 600, SCREEN_HZ = 4, SCREEN_GAIN = 1.4;
const FOCUS_SCALE = 2, FOCUS_HZ = 8; // the screen the player zooms in on
const SCREEN_SCALE = matchMedia('(pointer: coarse)').matches ? 0.5 : 1;

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
  uniform int uMode;     // 0 final, 1 albedo, 2 ceiling light, 3 screens light
  varying vec2 vUv;
  #ifdef BOARD
  uniform sampler2D uBoard;
  varying vec2 vUv1;
  #endif

  vec3 decode(sampler2D map, float scale) {
    vec3 c = texture2D(map, vUv).rgb;
    return c * c * c * scale;
  }

  void main() {
    #ifdef BOARD
    vec3 albedo = texture2D(uBoard, vUv1).rgb;  // whiteboards: their own sharp image, lit by the atlas
    #else
    vec3 albedo = texture2D(uAlbedo, vUv).rgb;
    #endif
    vec3 eCeiling = uCeiling * decode(uLightCeiling, uScaleCeiling);
    vec3 eScreens = uScreens * decode(uLightScreens, uScaleScreens);
    vec3 color = albedo * (eCeiling + eScreens);
    if (uMode == 2) color = eCeiling;
    if (uMode == 3) color = eScreens;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    if (uMode == 1) gl_FragColor = linearToOutputTexel(vec4(albedo, 1.0));
  }
`;

// Whiteboard surfaces: the room's vertex shader plus their second UV set
const boardVertex = roomVertex
  .replace('varying vec2 vUv;', 'varying vec2 vUv;\n  varying vec2 vUv1;')
  .replace('vUv = uv;', 'vUv = uv;\n    vUv1 = uv1;');

async function bytes(name) {
  const res = await fetch(SCENE + name, FRESH);
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}). Run blender/bake_control_room.py first.`);
  return res.arrayBuffer();
}

async function texture(renderer, buffer, srgb) {
  const bitmap = await createImageBitmap(new Blob([buffer]), { imageOrientation: 'none', colorSpaceConversion: 'none' });
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

export async function loadControlRoom(renderer) {
  const [meta, glb, albedoBuf, ceilBuf, scrBuf] = await Promise.all([
    fetch(SCENE + 'meta.json', FRESH).then((r) => { if (!r.ok) throw new Error('Could not load meta.json. Run blender/bake_control_room.py first.'); return r.json(); }),
    bytes('scene.glb'), bytes('albedo.png'), bytes('light_ceiling.png'), bytes('light_screens.png'),
  ]);
  const [albedo, lightCeiling, lightScreens] = await Promise.all([
    texture(renderer, albedoBuf, true), texture(renderer, ceilBuf, false), texture(renderer, scrBuf, false),
  ]);
  const gltf = await new GLTFLoader().parseAsync(glb, '');

  const material = new THREE.ShaderMaterial({
    vertexShader: roomVertex,
    fragmentShader: roomFragment,
    uniforms: {
      uAlbedo: { value: albedo }, uLightCeiling: { value: lightCeiling }, uLightScreens: { value: lightScreens },
      uScaleCeiling: { value: meta.scaleCeiling }, uScaleScreens: { value: meta.scaleScreens },
      uCeiling: { value: 1 }, uScreens: { value: 1 }, uMode: { value: 0 },
    },
  });
  // The movable things (chairs, mugs, coffee) share the room's atlas
  for (const name of ['Room', ...(meta.movable ?? [])]) {
    const mesh = gltf.scene.getObjectByName(name);
    if (mesh) mesh.material = material;
  }
  // Whiteboards share its light too, with their own image as albedo. Drawn
  // once at bake time, so they cost one texture each and nothing per frame.
  const boards = Object.entries(meta.boards ?? {});
  const boardBufs = await Promise.all(boards.map(([, png]) => bytes(png)));
  for (const [i, [name]] of boards.entries()) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    const board = material.clone();
    board.vertexShader = boardVertex;
    board.defines = { BOARD: '', USE_UV1: '' };
    board.uniforms = { ...material.uniforms, uBoard: { value: await texture(renderer, boardBufs[i], true) } };
    mesh.material = board;
  }
  // Every screen is drawn once into a static atlas. A screen that moves (the
  // LIVE ones, and the one the player zooms in on) gets its own texture on a
  // copy of its faces, laid just over the atlas.
  let screens = null;
  if (meta.screens) {
    const { canvas: size, slots } = meta.screens;
    const atlas = canvasTexture(renderer, size * SCREEN_SCALE, size * SCREEN_SCALE);
    drawSlots(atlas.image.getContext('2d'), slots, STATIC_T, SCREEN_SCALE);
    screens = { atlas, meshes: [], overlays: new Map(), focus: null, drawn: -Infinity, focusDrawn: -Infinity };
  }
  const emitters = [];
  for (const [name, e] of Object.entries(meta.emitters)) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    const textured = screens && name.startsWith('EmitScreen');
    mesh.material = new THREE.MeshBasicMaterial(textured ? { map: screens.atlas } : {});
    emitters.push({ material: mesh.material, color: new THREE.Color(...e.color), strength: e.strength, group: e.group, textured });
    if (textured) screens.meshes.push(mesh);
  }
  // The overlay for one screen, made the first time it is needed; `scale`
  // times the atlas slot's resolution
  function overlay(name, scale) {
    let o = screens.overlays.get(name);
    if (o && o.scale >= scale) return o;
    const slot = slots[name];
    if (!slot) return null;
    if (!o) {
      for (const mesh of screens.meshes) {
        const geometry = sliceSlot(mesh.geometry, slot, meta.screens.canvas);
        if (!geometry) continue;
        const mat = new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
        o = { name, slot, mesh: new THREE.Mesh(geometry, mat), scale: 0, tex: null };
        o.mesh.visible = false; // until it has a texture and is wanted
        mesh.add(o.mesh);
        emitters.push({ material: mat, group: 'screens', textured: true });
        screens.overlays.set(name, o);
        break;
      }
      if (!o) return null;
    }
    if (scale <= o.scale) return o;
    o.tex?.dispose();
    o.tex = canvasTexture(renderer, slot[2] * scale, slot[3] * scale);
    o.scale = scale;
    o.mesh.material.map = o.tex;
    o.mesh.material.needsUpdate = true;
    draw(o, 0);
    return o;
  }
  function draw(o, t) {
    drawSlots(o.tex.image.getContext('2d'), { [o.name]: [0, 0, o.slot[2], o.slot[3]] }, STATIC_T + t, o.scale);
    o.tex.needsUpdate = true;
  }
  const slots = meta.screens?.slots ?? {};
  if (screens) for (const name of LIVE) { const o = overlay(name, 1); if (o) o.mesh.visible = true; }
  gltf.scene.updateMatrixWorld(true);

  return {
    meta,
    root: gltf.scene,
    cameras: gltf.cameras,
    sizes: { glb: glb.byteLength, maps: [albedoBuf, ceilBuf, scrBuf, ...boardBufs].reduce((n, b) => n + b.byteLength, 0) },
    // Set the light mix: weights for the two groups, and the debug view
    setLights(ceiling, screens, mode = 0) {
      const u = material.uniforms;
      u.uCeiling.value = ceiling;
      u.uScreens.value = screens;
      u.uMode.value = mode;
      for (const e of emitters) {
        const w = e.group === 'screens' ? screens : ceiling;
        if (e.textured) e.material.color.setScalar(SCREEN_GAIN * (mode === 0 ? w : 0.02));
        else e.material.color.copy(e.color).multiplyScalar(e.strength * DISPLAY[e.group] * (mode === 0 ? w : 0.02));
      }
    },
    // Redraw the live screens for time t (seconds), at most SCREEN_HZ times a
    // second; the focused one at FOCUS_HZ
    updateScreens(t) {
      if (!screens) return;
      const f = screens.focus;
      if (f && t - screens.focusDrawn >= 1 / FOCUS_HZ) { screens.focusDrawn = t; draw(f, t); }
      if (t - screens.drawn < 1 / SCREEN_HZ) return;
      screens.drawn = t;
      for (const name of LIVE) {
        const o = screens.overlays.get(name);
        if (o && o !== f) draw(o, t);
      }
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
    // Show one screen sharp and fully live (null for none)
    setFocus(name) {
      if (!screens) return;
      const prev = screens.focus;
      screens.focus = name ? overlay(name, FOCUS_SCALE) : null;
      if (prev && prev !== screens.focus && !LIVE.includes(prev.name)) prev.mesh.visible = false;
      if (screens.focus) { screens.focus.mesh.visible = true; screens.focusDrawn = -Infinity; }
    },
  };
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
  return { center, normal, up: V.clone().normalize().negate(), width: U.length(), height: V.length() };
}
