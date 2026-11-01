// A soft shadow under each mug on the desks, drawn live because the mugs get
// lifted and moved: a baked one stays behind as a black ring on the desk
// (bake_control_room.py leaves it out). It follows the mug over the desk and
// fades as the mug rises. One small transparent quad per mug.
import * as THREE from 'three';

const SIZE = 0.15;     // m across
const STRENGTH = 0.8;  // darkness under the middle of the mug
const FADE = 0.2;      // m above the desk where it has gone

function softDisc() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.5, 'rgba(0,0,0,1)');
  g.addColorStop(0.75, 'rgba(0,0,0,.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// mugs: the mug objects, standing on the desk. Returns a function for each frame.
export function addMugShadows(root, mugs) {
  const map = softDisc(), geometry = new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2);
  const shadows = mugs.map((mug) => {
    const material = new THREE.MeshBasicMaterial({ map, color: 0, transparent: true, depthWrite: false, opacity: STRENGTH, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${mug.name}Shadow`;
    mesh.position.copy(mug.position);
    mesh.position.y += 0.0005;
    mesh.raycast = () => {};   // not something to point at
    root.add(mesh);
    return { mug, mesh, y: mesh.position.y };
  });
  return () => {
    for (const { mug, mesh, y } of shadows) {
      const k = 1 - (mug.position.y - y) / FADE;
      mesh.visible = mug.visible && k > 0.01;
      if (!mesh.visible) continue;
      mesh.position.x = mug.position.x;
      mesh.position.z = mug.position.z;
      mesh.material.opacity = STRENGTH * Math.min(k, 1);
    }
  };
}
