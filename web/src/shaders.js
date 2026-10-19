// The whole lighting model lives here. Blender did the expensive part
// (global illumination); the GPU only does three texture lookups and a sum.

export const roomVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Shadows of the swinging balls. Each light renders a depth map of the balls
// alone, so the room can never shadow itself and needs no depth bias. A point
// is in shadow when a ball sits between it and the light.
const shadowChunk = /* glsl */ `
  float ballShadow(sampler2D map, mat4 lightMatrix, vec3 world, float texel, float spread) {
    vec4 p = lightMatrix * vec4(world, 1.0);
    p.xyz /= p.w;
    vec3 c = p.xyz * 0.5 + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float lit = 0.0;
    for (int x = -2; x <= 2; x++)
      for (int y = -2; y <= 2; y++)
        lit += step(c.z, texture2D(map, c.xy + vec2(x, y) * texel * spread).r + 1e-4);
    return lit / 25.0;
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
  uniform sampler2D uShadowLamp;
  uniform sampler2D uShadowMoon;
  uniform mat4 uLampMatrix;
  uniform mat4 uMoonMatrix;
  uniform float uShadowTexel;
  varying vec2 vUv;
  varying vec3 vWorld;
  ${shadowChunk}

  // Stored as (L / scale)^(1/3) in 8 bits; see blender/build.py save_light()
  vec3 decode(sampler2D map, float scale) {
    vec3 c = texture2D(map, vUv).rgb;
    return c * c * c * scale;
  }

  void main() {
    vec3 albedo = texture2D(uAlbedo, vUv).rgb;   // sRGB texture, sampled as linear
    // The bake has no balls in it, so take out the light they block. The E
    // terms hold bounce light too, which a ball barely blocks, so a shadow
    // keeps a share of it instead of going black.
    float sMoon = ballShadow(uShadowMoon, uMoonMatrix, vWorld, uShadowTexel, 1.5);
    float sLamp = ballShadow(uShadowLamp, uLampMatrix, vWorld, uShadowTexel, 2.5);
    vec3 eMoon = decode(uLightMoon, uScaleMoon) * mix(0.12, 1.0, sMoon);
    vec3 eLamp = decode(uLightLamp, uScaleLamp) * mix(0.12, 1.0, sLamp);

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

// The chrome balls of the desk toy. They move, so nothing about them is
// baked; instead they mirror two panoramas of the room seen from the middle
// of the toy (moon only and lamp only, mixed with the same weights as the
// room), plus a live highlight for the bulb, which the panoramas leave out.
export const ballVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const ballFragment = /* glsl */ `
  uniform sampler2D uEnvMoon;
  uniform sampler2D uEnvLamp;
  uniform float uScaleEnvMoon;
  uniform float uScaleEnvLamp;
  uniform float uMoon;
  uniform float uLamp;
  uniform vec3 uLampPos;
  uniform vec3 uEnvCenter;
  varying vec3 vWorld;
  varying vec3 vNormal;

  const float PI = 3.14159265;

  // Inverse of the Blender equirectangular camera in blender/build.py
  // bake_env(). glTF (x, y, z) is Blender (x, -z, y).
  vec2 envUv(vec3 d) {
    float u = 0.5 - atan(-d.z, d.x) / (2.0 * PI);
    float v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
  }

  vec3 decodeEnv(sampler2D map, float scale, vec2 uv) {
    vec3 c = texture2D(map, uv).rgb;
    return c * c * c * scale;
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vWorld - cameraPosition);
    vec3 r = reflect(v, n);
    // The panorama was taken from the toy's centre: aim the lookup at where
    // the reflected ray meets a room about half a metre away (cheap parallax).
    vec3 hit = vWorld + r * 0.5 - uEnvCenter;
    vec2 uv = envUv(normalize(hit));
    vec3 env = uMoon * decodeEnv(uEnvMoon, uScaleEnvMoon, uv) + uLamp * decodeEnv(uEnvLamp, uScaleEnvLamp, uv);

    float f0 = 0.8;  // polished chrome
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
    vec3 l = normalize(uLampPos - vWorld);
    float bulb = pow(max(dot(r, l), 0.0), 3000.0) * 60.0 * uLamp;
    vec3 color = fresnel * env + bulb * vec3(1.0, 0.8, 0.55);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
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
