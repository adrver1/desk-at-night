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
  // Every screen is drawn once into a static atlas; the LIVE ones get their
  // own small texture on a copy of their faces, laid just over the atlas.
  let screens = null;
  if (meta.screens) {
    const { canvas: size, slots } = meta.screens;
    const atlas = canvasTexture(renderer, size * SCREEN_SCALE, size * SCREEN_SCALE);
    drawSlots(atlas.image.getContext('2d'), slots, STATIC_T, SCREEN_SCALE);
    screens = { atlas, live: [], drawn: -Infinity };
  }
  const emitters = [];
  for (const [name, e] of Object.entries(meta.emitters)) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    const textured = screens && name.startsWith('EmitScreen');
    mesh.material = new THREE.MeshBasicMaterial(textured ? { map: screens.atlas } : {});
    emitters.push({ material: mesh.material, color: new THREE.Color(...e.color), strength: e.strength, group: e.group, textured });
    if (!textured) continue;
    for (const screen of LIVE) {
      const slot = meta.screens.slots[screen];
      const geometry = slot && sliceSlot(mesh.geometry, slot, meta.screens.canvas);
      if (!geometry) continue;
      const tex = canvasTexture(renderer, slot[2], slot[3]);
      const material = new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      mesh.add(new THREE.Mesh(geometry, material));
      screens.live.push({ name: screen, tex, slot });
      emitters.push({ material, group: e.group, textured });
    }
  }
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
    // Redraw the live screens for time t (seconds), at most SCREEN_HZ times a second
    updateScreens(t) {
      if (!screens || t - screens.drawn < 1 / SCREEN_HZ) return;
      screens.drawn = t;
      for (const { name, tex, slot } of screens.live) {
        drawSlots(tex.image.getContext('2d'), { [name]: [0, 0, slot[2], slot[3]] }, STATIC_T + t);
        tex.needsUpdate = true;
      }
    },
  };
}
