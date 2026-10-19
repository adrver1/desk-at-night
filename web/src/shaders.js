// The whole lighting model lives here. Blender did the expensive part
// (global illumination); the GPU only does three texture lookups and a sum.

export const roomVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const roomFragment = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uLightMoon;
  uniform sampler2D uLightLamp;
  uniform float uScaleMoon;
  uniform float uScaleLamp;
  uniform float uMoon;   // weight of the moon + sky bake
  uniform float uLamp;   // weight of the desk-lamp bake (0..1, animated)
  uniform int uMode;     // 0 final, 1 albedo, 2 moon light, 3 lamp light
  varying vec2 vUv;

  // Stored as (L / scale)^(1/3) in 8 bits; see blender/build.py save_light()
  vec3 decode(sampler2D map, float scale) {
    vec3 c = texture2D(map, vUv).rgb;
    return c * c * c * scale;
  }

  void main() {
    vec3 albedo = texture2D(uAlbedo, vUv).rgb;   // sRGB texture, sampled as linear
    vec3 eMoon = decode(uLightMoon, uScaleMoon);
    vec3 eLamp = decode(uLightLamp, uScaleLamp);

    vec3 color = albedo * (uMoon * eMoon + uLamp * eLamp);
    if (uMode == 2) color = uMoon * eMoon;
    if (uMode == 3) color = uLamp * eLamp;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // Albedo is shown as-is, without exposure or tone mapping
    if (uMode == 1) gl_FragColor = linearToOutputTexel(vec4(albedo, 1.0));
  }
`;

// Night sky seen through the window. Matches the Blender world colour, so the
// window looks the same as in the Cycles reference, plus a few faint stars.
export const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyFragment = /* glsl */ `
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    vec3 world = vec3(0.03, 0.045, 0.10);
    vec3 color = world * mix(1.25, 0.8, clamp(d.y, 0.0, 1.0));
    vec3 cell = floor(d * 220.0);
    float star = step(0.9975, hash(cell)) * smoothstep(0.0, 0.25, d.y);
    color += vec3(star) * 0.6;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
