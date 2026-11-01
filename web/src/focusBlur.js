// Background blur for close-ups of screens (Adriaen 2026-11-01, "blur the
// background when we are zoomed in on one or two screens"). Story mode's
// closeups.js says which screens fill the picture (hooks.focus); this pass
// blurs the finished frame around them and leaves them and their bezels sharp.
// Cheap by design: the blur runs at a quarter and an eighth of the picture's
// size, and only one pass at full size lays it back over the sharp frame.
// Styles (?blur=):
//   a  "cut-out": the screens sharp, everything else equally soft
//   b  "falloff": sharp at the screens, softer the further from them in the picture
//   c  "depth":   a lens focused on the screen; the desk next to it stays near
//                 sharp, the far wall goes soft. Takes the room's depth in an
//                 extra half-size draw (the characters' own pass isn't in it)
//   0  off
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// Four bilinear taps one source texel off the middle: a 4x4 box from the size above
const DOWN = /* glsl */`uniform sampler2D src; uniform vec2 texel; varying vec2 vUv;
void main() {
  gl_FragColor = 0.25 * (texture2D(src, vUv + texel * vec2(-1., -1.)) + texture2D(src, vUv + texel * vec2(1., -1.))
    + texture2D(src, vUv + texel * vec2(-1., 1.)) + texture2D(src, vUv + texel * vec2(1., 1.)));
}`;
// A 9-tap Gaussian along one axis (dir = one texel across or down)
const BLUR = /* glsl */`uniform sampler2D src; uniform vec2 dir; varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv) * 0.2270270;
  c += (texture2D(src, vUv + dir * 1.3846154) + texture2D(src, vUv - dir * 1.3846154)) * 0.3162162;
  c += (texture2D(src, vUv + dir * 3.2307692) + texture2D(src, vUv - dir * 3.2307692)) * 0.0702703;
  gl_FragColor = c;
}`;
// Lays the blur over the frame. t, how soft a pixel is (0 sharp, 1 softest):
// the quarter-size blur up to t = 0.5, the eighth-size one beyond
const LAY = /* glsl */`uniform sampler2D soft, softer, depth; uniform vec2 px; uniform vec4 q[8]; uniform int n, style;
uniform float amount, feather, reach, focus, near, far, lens;
varying vec2 vUv;
// How far (px, negative inside) p is from quad k: its corners q[2k] (xy, zw) and q[2k+1], counter-clockwise
float edge(vec2 p, vec2 a, vec2 b) { vec2 e = b - a; return dot(p - a, normalize(vec2(e.y, -e.x))); }
float quad(vec2 p, int k) {
  vec2 a = q[2 * k].xy, b = q[2 * k].zw, c = q[2 * k + 1].xy, d = q[2 * k + 1].zw;
  return max(max(edge(p, a, b), edge(p, b, c)), max(edge(p, c, d), edge(p, d, a)));
}
void main() {
  vec2 p = vUv * px;
  float d = 1e6;
  for (int k = 0; k < 2; k++) if (k < n) d = min(d, quad(p, k));
  float out_ = smoothstep(0.0, feather, d);   // 0 on the screens, 1 a little off them
  float t;
  if (style == 0) t = out_;
  else if (style == 1) t = out_ * smoothstep(-0.15, 1.0, d / reach);
  else {
    float z = texture2D(depth, vUv).x;
    float view = near * far / (far - z * (far - near));   // metres from the camera
    t = out_ * clamp(abs(view - focus) / view * lens, 0.0, 1.0);
  }
  t *= amount;
  vec3 c = mix(texture2D(soft, vUv).rgb, texture2D(softer, vUv).rgb, clamp(t * 2.0 - 1.0, 0.0, 1.0));
  gl_FragColor = vec4(c, clamp(t * 2.0, 0.0, 1.0));
}`;

const STYLES = { a: 0, b: 1, c: 2 };
const IN = 2.5, OUT = 8;   // fade rates (1/s): in over ~0.4 s, out quickly so a wide shot after a cut isn't left soft

export function focusBlur(renderer, style) {
  let s = STYLES[style] ?? -1;
  const rt = (opts) => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, ...opts });
  const q4a = rt(), q4b = rt(), q8a = rt(), q8b = rt();
  const pass = (frag, uniforms, name, extra = {}) => {
    const fsq = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, ...extra }));
    fsq._mesh.name = name;   // the perf panel's pass name
    return fsq;
  };
  const down = pass(DOWN, { src: { value: null }, texel: { value: new THREE.Vector2() } }, 'blur down');
  const blur = pass(BLUR, { src: { value: null }, dir: { value: new THREE.Vector2() } }, 'blur');
  const quads = Array.from({ length: 8 }, () => new THREE.Vector4());
  const lay = pass(LAY, {
    soft: { value: q4a.texture }, softer: { value: q8a.texture }, depth: { value: null },
    px: { value: new THREE.Vector2() }, q: { value: quads }, n: { value: 0 }, style: { value: Math.max(0, s) },
    amount: { value: 0 }, feather: { value: 1 }, reach: { value: 1 },
    focus: { value: 1 }, near: { value: 0.1 }, far: { value: 100 }, lens: { value: 1.2 },
  }, 'focus blur', { transparent: true, blending: THREE.NormalBlending });
  // style c: the room's depth, drawn at half size
  let deep = null;
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const size = new THREE.Vector2();
  let own = null, amount = 0, last = [];
  const run = (fsq, src, target) => { fsq.material.uniforms.src.value = src; renderer.setRenderTarget(target); fsq.render(renderer); };
  const smear = (a, b, w, h) => {
    blur.material.uniforms.dir.value.set(1 / w, 0); run(blur, a.texture, b);
    blur.material.uniforms.dir.value.set(0, 1 / h); run(blur, b.texture, a);
  };

  return {
    get style() { return Object.keys(STYLES).find((k) => STYLES[k] === s) ?? '0'; },
    set style(v) { s = STYLES[v] ?? -1; lay.material.uniforms.style.value = Math.max(0, s); },   // switchable while running, for screenshots
    // focus: hooks.focus ({ quads: [[x, y] x4 in CSS px], dist: m } or null);
    // frame: the finished frame as a texture if there is one (FXAA's copy), else it is copied here
    render(dt, focus, frame, { scene, camera, warm } = {}) {
      if (s < 0) { amount = 0; return; }
      const want = focus?.quads?.length ? 1 : 0;
      amount = this.fade === false ? want : amount + (want - amount) * Math.min(1, dt * (want ? IN : OUT));   // fade false: no easing (screenshots)
      if (want) last = focus;
      if (amount < 0.01 && !want && !warm) { amount = 0; return; }
      renderer.getDrawingBufferSize(size);
      const W = size.x, H = size.y;
      if (!frame) {
        if (!own || own.image.width !== W || own.image.height !== H) { own?.dispose(); own = new THREE.FramebufferTexture(W, H); own.minFilter = own.magFilter = THREE.LinearFilter; }
        renderer.copyFramebufferToTexture(own);
        frame = own;
      }
      const w4 = Math.max(1, W >> 2), h4 = Math.max(1, H >> 2), w8 = Math.max(1, W >> 3), h8 = Math.max(1, H >> 3);
      if (q4a.width !== w4 || q4a.height !== h4) { q4a.setSize(w4, h4); q4b.setSize(w4, h4); q8a.setSize(w8, h8); q8b.setSize(w8, h8); }
      const target = renderer.getRenderTarget();
      if (s === 2 && !deep) {
        deep = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1) });
        lay.material.uniforms.depth.value = deep.depthTexture;
      }
      if (s === 2 && scene && camera) {
        const dw = Math.max(1, W >> 1), dh = Math.max(1, H >> 1);
        if (deep.width !== dw || deep.height !== dh) deep.setSize(dw, dh);
        const before = scene.overrideMaterial, bg = scene.background;
        scene.overrideMaterial = depthOnly; scene.background = null;
        renderer.setRenderTarget(deep);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        scene.overrideMaterial = before; scene.background = bg;
        lay.material.uniforms.near.value = camera.near; lay.material.uniforms.far.value = camera.far;
      }
      down.material.uniforms.texel.value.set(1 / W, 1 / H); run(down, frame, q4a);
      smear(q4a, q4b, w4, h4);
      down.material.uniforms.texel.value.set(1 / w4, 1 / h4); run(down, q4a.texture, q8a);
      smear(q8a, q8b, w8, h8);
      // The screens, in drawing-buffer pixels from the bottom left, counter-clockwise
      const u = lay.material.uniforms, k = W / renderer.domElement.clientWidth;
      const list = (last?.quads ?? []).slice(0, 2);
      list.forEach((p, i) => {
        let c = p.map(([x, y]) => [x * k, H - y * k]);
        const a2 = c.reduce((sum, [x, y], j) => { const [x2, y2] = c[(j + 1) % 4]; return sum + x * y2 - x2 * y; }, 0);
        if (a2 < 0) c = c.reverse();
        quads[2 * i].set(c[0][0], c[0][1], c[1][0], c[1][1]);
        quads[2 * i + 1].set(c[2][0], c[2][1], c[3][0], c[3][1]);
      });
      u.n.value = list.length;
      u.px.value.set(W, H);
      u.amount.value = warm ? 0 : amount;
      u.feather.value = 0.025 * H;
      u.reach.value = 0.45 * H;
      u.focus.value = last?.dist ?? 1;
      renderer.setRenderTarget(target);
      lay.render(renderer);
    },
  };
}
