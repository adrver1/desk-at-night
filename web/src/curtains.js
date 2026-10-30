// Curtains on the control room window (the offshore room in the reference
// video has blue ones), opened and closed from the desk touch panel. Live
// geometry, not in the bake: they move, so they are lit here the way the room
// is (ceiling weight and the live sky), with the daylight shining through the
// cloth when they are closed. The room's own shader is told how much of the
// window is still clear (setOpening), so the sun patch on the floor and the
// baked sky light follow them.
//
// Three looks, all kept (?curtains=a|b|c, 0 for none):
//   a  drapes: a pair of pleated panels on a motorised track, meeting in the middle
//   b  roller blinds: one per window bay, rolling up into a cassette at the top
//   c  vertical blinds: slats that turn edge-on to open
import * as THREE from 'three';

export const LOOKS = ['a', 'b', 'c'];
const CLOTH = new THREE.Color('#3f6386');   // blue-grey, like the reference
const RAIL = new THREE.Color('#d9dbdc');
const TRAVEL = 4.0;    // s from open to closed (motorised)
const THROUGH = 0.28;  // share of the daylight a closed curtain lets through

const vertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec4 local = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    n = mat3(instanceMatrix) * n;
    #endif
    vec4 world = modelMatrix * local;
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Lit from the room side by the ceiling (mostly from above) and the sky's
// light bouncing round the room; from behind, where the cloth is in front of
// the window, by the sky and sun shining through it
const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCeiling;   // the room's ceiling weight (setLights)
  uniform vec3 uSky, uSun, uSunDir;
  uniform vec3 uWindowLo, uWindowHi;
  uniform float uThrough;   // how much light this part lets through (0 for the rail)
  varying vec3 vNormal;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
    // the folds: faces turned away from the room catch less of it
    float fold = 0.35 + 0.65 * max(dot(n, normalize(vec3(1.0, 0.35, 0.45))), 0.0);
    vec3 front = (uCeiling * 0.42 + uSky * 0.3) * fold;
    // Daylight through the cloth, only where it hangs in front of the opening
    float inWindow = step(uWindowLo.z, vWorld.z) * step(vWorld.z, uWindowHi.z) * step(uWindowLo.y, vWorld.y) * step(vWorld.y, uWindowHi.y);
    // through the cloth: brightest where it faces the window square on
    vec3 back = (uSky * 1.1 + uSun * max(-uSunDir.x, 0.0) * 0.9) * uThrough * inWindow * (0.3 + 0.7 * n.x * n.x);
    gl_FragColor = vec4(uColor * (front + back), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function material(color, through, shared) {
  return new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide,
    uniforms: { ...shared, uColor: { value: color.clone() }, uThrough: { value: through } },
  });
}

const smooth = (k) => k * k * (3 - 2 * k);

// lo, hi: the window opening in three's axes (x is the wall, the room is at +x)
export function makeCurtains(lo, hi, look = 'a') {
  const shared = {
    uCeiling: { value: 1 }, uSky: { value: new THREE.Color() }, uSun: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uWindowLo: { value: lo.clone() }, uWindowHi: { value: hi.clone() },
  };
  const cloth = material(CLOTH, THROUGH, shared), rail = material(RAIL, 0, shared);
  const group = new THREE.Group();
  group.name = 'Curtains';
  const build = { a: drapes, b: rollers, c: verticals }[look] ?? drapes;
  const shape = build(group, lo, hi, cloth, rail);
  const state = { open: true, k: 0 };   // k: 0 open … 1 closed
  const opening = { lo: lo.clone(), hi: hi.clone(), sky: 1, sun: 1 };
  shape.pose(0, opening);

  return {
    group, look,
    meshes: group.children,
    get open() { return state.open; },
    get moving() { return state.k !== (state.open ? 0 : 1); },
    // How much of the window is clear: the rectangle the sun may come
    // through, the share of it that does (vertical blinds), and how much of
    // the baked sky light still reaches the room
    opening,
    set(open, now = false) {
      state.open = open;
      if (now) { state.k = open ? 0 : 1; shape.pose(smooth(state.k), opening); }
    },
    step(dt) {
      const goal = state.open ? 0 : 1;
      if (state.k === goal) return false;
      state.k = goal > state.k ? Math.min(goal, state.k + dt / TRAVEL) : Math.max(goal, state.k - dt / TRAVEL);
      shape.pose(smooth(state.k), opening);
      return true;
    },
    setLights(ceiling) { shared.uCeiling.value = ceiling; },
    setDaylight({ sky, sun, sunDir }) {
      shared.uSky.value.copy(sky);
      shared.uSun.value.copy(sun);
      shared.uSunDir.value.copy(sunDir);
    },
  };
}

// The track above the window, wider than it so the curtains can stack clear
function track(group, lo, hi, rail, over) {
  const len = hi.z - lo.z + 2 * over;
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, len), rail);
  bar.position.set(lo.x + 0.11, hi.y + 0.2, (lo.z + hi.z) / 2);
  group.add(bar);
  return hi.y + 0.18;   // where the cloth hangs from
}

// a: two pleated panels. The cloth keeps its width; drawn together, the
// pleats get deeper. Outer edges are fixed past the window's ends.
function drapes(group, lo, hi, cloth, rail) {
  const OVER = 0.42, STACK = 0.46, PLEATS = 16, COLS = PLEATS * 6;
  const top = track(group, lo, hi, rail, OVER), bottom = lo.y - 0.08;
  const z0 = lo.z - OVER, z1 = hi.z + OVER, mid = (lo.z + hi.z) / 2;
  const fabric = (mid - z0 + 0.05) * 1.25;   // cloth width per panel, a little fuller than closed
  const panels = [-1, 1].map((side) => {
    const pos = new Float32Array((COLS + 1) * 2 * 3), idx = [];
    for (let i = 0; i < COLS; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, cloth);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { side, geo, pos };
  });
  return {
    pose(k, opening) {
      const width = STACK + (mid - z0 + 0.05 - STACK) * k;   // across the window, per panel
      const half = Math.min(width, fabric) / (2 * PLEATS), l = fabric / (2 * PLEATS);
      const depth = Math.min(0.085, Math.sqrt(Math.max(l * l - half * half, 0)) * 0.7) + 0.012;
      for (const p of panels) {
        const edge = p.side < 0 ? z0 : z1;
        for (let i = 0; i <= COLS; i++) {
          const u = i / COLS, z = edge - p.side * u * width;
          const x = lo.x + 0.07 + depth * (0.5 - 0.5 * Math.cos(2 * Math.PI * PLEATS * u));
          for (let j = 0; j < 2; j++) {
            const o = (i * 2 + j) * 3;
            p.pos[o] = x + (j ? 0 : 0.02 * Math.sin(u * 7.0 + p.side));   // the hem swings a touch
            p.pos[o + 1] = j ? top : bottom;
            p.pos[o + 2] = z;
          }
        }
        p.geo.attributes.position.needsUpdate = true;
        p.geo.computeVertexNormals();
      }
      opening.lo.z = Math.max(lo.z, z0 + width);
      opening.hi.z = Math.min(hi.z, z1 - width);
      opening.sky = clear(opening, lo, hi);
      opening.sun = 1;
    },
  };
}

// b: a roller blind in each of the window's four bays, coming down from a
// cassette at the top
function rollers(group, lo, hi, cloth, rail) {
  const BAYS = 4, bay = (hi.z - lo.z) / BAYS, top = hi.y + 0.06, drop = top - lo.y + 0.02;
  const blinds = [];
  for (let i = 0; i < BAYS; i++) {
    const zc = lo.z + bay * (i + 0.5), w = bay - 0.07;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, w + 0.04), rail);
    box.position.set(lo.x + 0.1, top + 0.045, zc);
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, 1).translate(0, -0.5, 0).rotateY(Math.PI / 2), cloth);
    sheet.position.set(lo.x + 0.1, top, zc);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.03, w), rail);
    group.add(box, sheet, bar);
    blinds.push({ sheet, bar });
  }
  return {
    pose(k, opening) {
      const h = Math.max(0.001, 0.04 + (drop - 0.04) * k);
      for (const b of blinds) {
        b.sheet.scale.y = h;
        b.sheet.visible = k > 0.002;
        b.bar.position.set(lo.x + 0.1, top - h, b.sheet.position.z);
      }
      opening.hi.y = Math.min(hi.y, top - h);
      opening.sky = clear(opening, lo, hi);
      opening.sun = 1;
    },
  };
}

// c: vertical blinds: slats on a track, turned edge-on (open) or flat and
// overlapping (closed). One instanced mesh, so one draw.
function verticals(group, lo, hi, cloth, rail) {
  const OVER = 0.12, PITCH = 0.085, SLAT = 0.1;
  const top = track(group, lo, hi, rail, OVER), bottom = lo.y - 0.05;
  const z0 = lo.z - OVER, n = Math.round((hi.z - lo.z + 2 * OVER) / PITCH);
  const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, top - bottom, SLAT), cloth, n);
  slats.frustumCulled = false;
  group.add(slats);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  return {
    pose(k, opening) {
      const angle = THREE.MathUtils.degToRad(90 - 78 * k);   // from the wall's plane: 90 edge-on, 12 closed
      q.setFromAxisAngle(Y, angle);
      for (let i = 0; i < n; i++) {
        p.set(lo.x + 0.11, (top + bottom) / 2, z0 + PITCH * (i + 0.5));
        slats.setMatrixAt(i, m.compose(p, q, s));
      }
      slats.instanceMatrix.needsUpdate = true;
      opening.sun = Math.max(0, 1 - SLAT * Math.cos(angle) / PITCH);
      opening.sky = opening.sun + (1 - opening.sun) * THROUGH;
    },
  };
}

// The baked sky light still reaching the room: the clear part of the window
// in full, the covered part through the cloth
function clear(opening, lo, hi) {
  const all = (hi.z - lo.z) * (hi.y - lo.y);
  const open = Math.max(0, opening.hi.z - opening.lo.z) * Math.max(0, opening.hi.y - opening.lo.y);
  const f = open / all;
  return f + (1 - f) * THROUGH;
}
