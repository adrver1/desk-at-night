// Loads the control room bake (blender/bake_control_room.py) for both the
// lighting viewer (control.js) and the walk-around game (play.js). Same
// lighting model as the desk: albedo × a weighted sum of baked irradiance,
// here with a ceiling map and a screens map. The glowing parts (screens,
// ceiling panels, clock, exit sign, platform lights) are not baked; they are
// drawn flat in their own colour, scaled by the same weights.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { roomVertex } from './shaders.js';

const SCENE = 'control/';
// GitHub Pages lets browsers reuse files for ten minutes without asking. After
// a re-bake that can pair a new page with an old meta.json or atlas, so always
// revalidate (a 304 costs next to nothing when nothing changed).
const FRESH = { cache: 'no-cache' };
export const SKY = new THREE.Color(0.012, 0.02, 0.045); // Blender world colour (linear)
// The screens carry a pattern in Cycles but are drawn here in their average
// colour; at full strength that reads as a white slab, so draw them dimmer.
const DISPLAY = { screens: 0.32, ceiling: 1 };

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

  vec3 decode(sampler2D map, float scale) {
    vec3 c = texture2D(map, vUv).rgb;
    return c * c * c * scale;
  }

  void main() {
    vec3 albedo = texture2D(uAlbedo, vUv).rgb;
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
  const emitters = [];
  for (const [name, e] of Object.entries(meta.emitters)) {
    const mesh = gltf.scene.getObjectByName(name);
    if (!mesh) continue;
    mesh.material = new THREE.MeshBasicMaterial();
    emitters.push({ material: mesh.material, color: new THREE.Color(...e.color), strength: e.strength, group: e.group });
  }
  gltf.scene.updateMatrixWorld(true);

  return {
    meta,
    root: gltf.scene,
    cameras: gltf.cameras,
    sizes: { glb: glb.byteLength, maps: albedoBuf.byteLength + ceilBuf.byteLength + scrBuf.byteLength },
    // Set the light mix: weights for the two groups, and the debug view
    setLights(ceiling, screens, mode = 0) {
      const u = material.uniforms;
      u.uCeiling.value = ceiling;
      u.uScreens.value = screens;
      u.uMode.value = mode;
      for (const e of emitters) {
        const w = e.group === 'screens' ? screens : ceiling;
        e.material.color.copy(e.color).multiplyScalar(e.strength * DISPLAY[e.group] * (mode === 0 ? w : 0.02));
      }
    },
  };
}
