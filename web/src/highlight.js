// Shows which thing the player is aiming at: a thin outline around it and a
// soft glow on its faces. Two extra draws while something is aimed at and
// none otherwise, so it costs phones next to nothing (no postprocessing pass).
//
// Screens are flat and joined into a few big meshes, so they get a bright
// frame around the picture instead.
//
// The outline is the inverted-hull trick: the object's back faces, pushed out
// along smoothed normals by a fixed number of pixels, so it stays the same
// width near and far.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const COLOR = new THREE.Color(1.0, 0.86, 0.55); // warm, like the desk lamps

const outlineMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  transparent: true,
  uniforms: { uColor: { value: COLOR }, uWidth: { value: 2.5 }, uResolution: { value: new THREE.Vector2(1, 1) }, uAlpha: { value: 1 } },
  vertexShader: /* glsl */ `
    uniform float uWidth;
    uniform vec2 uResolution;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      vec2 dir = (projectionMatrix * vec4(n, 0.0)).xy;
      dir = length(dir) > 1e-5 ? normalize(dir) : vec2(0.0);
      clip.xy += dir * uWidth * 2.0 / uResolution * clip.w;
      gl_Position = clip;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uAlpha;
    void main() { gl_FragColor = vec4(uColor, uAlpha); }`,
});

const glowMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthFunc: THREE.LessEqualDepth,
  blending: THREE.AdditiveBlending,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  uniforms: { uColor: { value: COLOR }, uStrength: { value: 0 } },
  vertexShader: /* glsl */ `
    varying float vRim;
    void main() {
      vec4 view = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      vRim = 1.0 - abs(dot(n, normalize(-view.xyz)));
      gl_Position = projectionMatrix * view;
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uStrength;
    varying float vRim;
    void main() { gl_FragColor = vec4(uColor * uStrength * (0.35 + 0.65 * vRim * vRim), 1.0); }`,
});

const frameMaterial = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, side: THREE.DoubleSide, depthWrite: false });

export class Highlight {
  // frameOf(name, from): a screen's centre, normal, up, width and height
  constructor(scene, renderer, { width = 2.5, frameOf } = {}) {
    this.renderer = renderer;
    this.width = width;
    this.frameOf = frameOf;
    this.screen = null; // { name, mesh }
    this.group = new THREE.Group();
    scene.add(this.group);
    this.parts = new Map(); // mesh -> { outline, glow }
    this.current = [];
    this.fade = 0;
    this.t = 0;
  }

  // The overlay meshes for one mesh, made the first time it is aimed at
  partsFor(mesh) {
    let p = this.parts.get(mesh);
    if (p) return p;
    // Outline: positions only, welded so hard edges share one averaged normal
    // and the hull has no cracks at the corners
    const hull = new THREE.BufferGeometry().setAttribute('position', mesh.geometry.getAttribute('position'));
    if (mesh.geometry.index) hull.setIndex(mesh.geometry.index);
    const welded = mergeVertices(hull, 1e-4);
    welded.computeVertexNormals();
    p = { outline: new THREE.Mesh(welded, outlineMaterial), glow: new THREE.Mesh(mesh.geometry, glowMaterial) };
    for (const m of [p.outline, p.glow]) { m.matrixAutoUpdate = false; m.frustumCulled = false; m.visible = false; this.group.add(m); }
    p.glow.renderOrder = 2;
    this.parts.set(mesh, p);
    return p;
  }

  // meshes: what to light up (empty or null for nothing)
  set(meshes) {
    meshes = meshes ?? [];
    if (meshes.length === this.current.length && meshes.every((m, i) => m === this.current[i])) return;
    for (const m of this.current) { const p = this.parts.get(m); p.outline.visible = p.glow.visible = false; }
    this.current = meshes;
    this.fade = 0;
  }

  // Frame the screen `name` (null for none), seen from `from`
  frame(name, from) {
    if (name === (this.screen?.name ?? null)) return;
    if (this.screen?.mesh) { this.group.remove(this.screen.mesh); this.screen.mesh.geometry.dispose(); }
    this.screen = null;
    this.fade = 0;
    const f = name && this.frameOf?.(name, from);
    if (!f) return;
    // A few pixels wide from where the player stands (wall displays are far)
    const t = Math.max(0.004, f.center.distanceTo(from) * 0.0035), gap = t * 1.5;
    const w = f.width / 2 + gap, h = f.height / 2 + gap;
    const shape = new THREE.Shape([new THREE.Vector2(-w - t, -h - t), new THREE.Vector2(w + t, -h - t), new THREE.Vector2(w + t, h + t), new THREE.Vector2(-w - t, h + t)]);
    shape.holes.push(new THREE.Path([new THREE.Vector2(-w, -h), new THREE.Vector2(-w, h), new THREE.Vector2(w, h), new THREE.Vector2(w, -h)]));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), frameMaterial);
    const right = new THREE.Vector3().crossVectors(f.up, f.normal);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeBasis(right, f.up, f.normal).setPosition(f.center.clone().addScaledVector(f.normal, 0.003));
    this.group.add(mesh);
    this.screen = { name, mesh };
  }

  update(dt) {
    if (!this.current.length && !this.screen) return;
    this.t += dt;
    this.fade = Math.min(1, this.fade + dt / 0.12);
    frameMaterial.opacity = this.fade * (0.75 + 0.15 * Math.sin(this.t * 4));
    this.renderer.getDrawingBufferSize(outlineMaterial.uniforms.uResolution.value);
    outlineMaterial.uniforms.uWidth.value = this.width * this.renderer.getPixelRatio();
    outlineMaterial.uniforms.uAlpha.value = 0.9 * this.fade;
    glowMaterial.uniforms.uStrength.value = this.fade * (0.16 + 0.06 * Math.sin(this.t * 4));
    for (const mesh of this.current) {
      const p = this.partsFor(mesh);
      // Follow the object (chairs spin, mugs get lifted)
      mesh.updateWorldMatrix(true, false);
      p.outline.matrix.copy(mesh.matrixWorld);
      p.glow.matrix.copy(mesh.matrixWorld);
      p.outline.visible = p.glow.visible = mesh.visible;
    }
  }
}
