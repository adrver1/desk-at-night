// The desk phones: live ones (blender/desk_phone.py) where the bake left
// them out (control_room.DESK_PHONES = "live"; meta.layout.phones gives
// each one's spot), with a live coiled cord (coilCord.js) between the base
// and the handset, so story mode's operator can pick one up.
//
// The room itself has no lights, so out of story mode the phones are drawn
// unlit, shaded by a fixed light from above and dimmed with the room's
// ceiling light (setLight). Story mode lights its cast and props itself and
// gives them back their own materials (lit()).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CoilCord } from './coilCord.js';

export const PHONE_LOOK = new URLSearchParams(location.search).get('phone') ?? 'office';   // rotary and pushbutton kept too
const SHADE = new THREE.Vector3(0.3, 1, 0.4).normalize();   // the fixed light for the unlit look
const AMBIENT = 0.45, GAIN = 0.75;

// Unlit copies of the phone's materials, with the shading baked into vertex colours
function unlit(mesh) {
  const g = mesh.geometry, n = g.attributes.normal;
  if (!n) return mesh.material;
  const c = new Float32Array(n.count * 3), v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    c.fill(AMBIENT + (1 - AMBIENT) * Math.max(0, v.dot(SHADE)), i * 3, i * 3 + 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const own = mesh.material;
  return new THREE.MeshBasicMaterial({ color: own.color?.clone() ?? new THREE.Color(1, 1, 1), map: own.map ?? null, vertexColors: true });
}

// spots: [[x, y, z, yaw], ...] in Blender's axes (the desk top under each phone's middle)
export async function loadDeskPhones(spots) {
  if (!spots?.length) return null;
  const gltf = await new GLTFLoader().loadAsync(`story/props/desk_phone_${PHONE_LOOK}.glb`);
  const root = new THREE.Group();
  root.name = 'DeskPhones';
  const phones = spots.map(([x, y, z, yaw], k) => {
    const src = gltf.scene.clone(true), nodes = {};
    src.traverse((o) => { nodes[o.name] = o; });
    const group = new THREE.Group();
    group.name = `S${k}LivePhone`;
    group.position.set(x, z, -y);
    group.rotation.y = yaw;
    const base = nodes.DeskPhone, handset = nodes.Handset;
    group.add(base, handset);
    const cord = new CoilCord({ color: base.userData.cordColor ?? '#1c1e20' });
    group.add(cord.mesh);
    root.add(group);
    const ph = { group, base, handset, socket: nodes.CordSocket, plug: nodes.CordPlug, cord, earOffset: handset.userData.earOffset ?? 0.08,
      rest: { pos: handset.position.clone(), quat: handset.quaternion.clone() }, a: new THREE.Vector3(), b: new THREE.Vector3(), meshes: [] };
    group.traverse((o) => {
      if (!o.isMesh || o === cord.mesh) return;
      o.frustumCulled = false;
      if (k) o.geometry = o.geometry.clone();   // own vertex colours
      o.userData.lit = o.material;
      o.material = o.userData.unlit = unlit(o);
      o.userData.colour = o.material.color.clone();
      ph.meshes.push(o);
    });
    const m = cord.mesh;
    m.userData.lit = m.material;
    m.material = m.userData.unlit = new THREE.MeshBasicMaterial({ color: m.material.color.clone().multiplyScalar(0.8) });
    m.userData.colour = m.material.color.clone();
    ph.meshes.push(m);
    return ph;
  });
  phones.forEach((ph) => stepCord(ph, 0, true));
  let isLit = false;
  return {
    root, phones,
    // story mode: lit by its own lights
    lit() {
      isLit = true;
      for (const ph of phones) for (const o of ph.meshes) o.material = o.userData.lit;
    },
    // how bright the room is, 0 to 1 and a bit (the ceiling light's weight plus the screens' share)
    setLight(k) {
      if (isLit) return;
      for (const ph of phones) for (const o of ph.meshes) if (o.userData.unlit) o.material.color.copy(o.userData.colour).multiplyScalar(GAIN * k);
    },
    update(dt) { for (const ph of phones) stepCord(ph, dt); },
  };
}

// The coiled cord between the base's socket and the handset's plug, in the phone's own space
export function stepCord(ph, dt, reset = false) {
  ph.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(ph.group.matrixWorld).invert();
  ph.a.setFromMatrixPosition(ph.socket.matrixWorld).applyMatrix4(inv);
  ph.b.setFromMatrixPosition(ph.plug.matrixWorld).applyMatrix4(inv);
  if (reset) ph.cord.reset?.();
  ph.cord.step(ph.a, ph.b, Math.min(dt, 1 / 30));
}
