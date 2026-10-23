// Shadows from the sun (or the moon) for the control room and the platform
// outside its window. Two small depth maps, one fitted tight around the room
// for the patch of sun through the window, one around the platform. They are
// rendered again only when the sun moves, and the room's a few times a second
// so a chair that turns moves its shadow. Everything else stays baked.
import * as THREE from 'three';

const COARSE = matchMedia('(pointer: coarse)').matches;
const ROOM_SIZE = COARSE ? 1024 : 2048;  // ~1 cm texels over the room
const PLATFORM_SIZE = 1024;              // ~20 cm over the platform
const ROOM_HZ = 5;
const REACH = 250;  // m toward the sun beyond the room: the platform shadows it too

const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, name: 'sun shadow depth' });
const _corner = new THREE.Vector3();

class ShadowView {
  constructor(size, reach = 0, name = 'sun shadow') {
    this.size = size;
    this.reach = reach;
    this.target = new THREE.WebGLRenderTarget(size, size, { depthTexture: new THREE.DepthTexture(size, size) });
    this.target.texture.name = name;   // names the pass in the perf overlay
    this.camera = new THREE.OrthographicCamera();
    this.box = null;
    this.uniforms = {
      uShadowMap: { value: this.target.depthTexture },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 0.01 },
    };
  }

  fit(box) { this.box = box; }

  // Look down `dir` (toward the light) at the box, framing it tightly
  aim(dir) {
    const c = this.box.getCenter(new THREE.Vector3());
    const r = this.box.getSize(new THREE.Vector3()).length();
    const cam = this.camera;
    cam.position.copy(c).addScaledVector(dir, r);
    cam.up.set(Math.abs(dir.y) > 0.99 ? 1 : 0, Math.abs(dir.y) > 0.99 ? 0 : 1, 0);
    cam.lookAt(c);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = lo.clone().negate();
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? this.box.max.x : this.box.min.x, i & 2 ? this.box.max.y : this.box.min.y, i & 4 ? this.box.max.z : this.box.min.z);
      _corner.applyMatrix4(inv);
      lo.min(_corner);
      hi.max(_corner);
    }
    cam.left = lo.x; cam.right = hi.x; cam.bottom = lo.y; cam.top = hi.y;
    cam.near = -hi.z - this.reach;  // an orthographic camera may start behind itself
    cam.far = -lo.z;
    cam.updateProjectionMatrix();
    this.uniforms.uShadowMatrix.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.uniforms.uShadowTexel.value = Math.max(hi.x - lo.x, hi.y - lo.y) / this.size;
  }

  render(renderer, scene) {
    const prev = renderer.getRenderTarget(), clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearAlpha(clearAlpha);
  }
}

export class SunShadow {
  constructor(renderer) {
    this.renderer = renderer;
    this.room = new ShadowView(ROOM_SIZE, REACH, 'sun shadow room');
    this.platform = new ShadowView(PLATFORM_SIZE, 0, 'sun shadow platform');
    this.dir = new THREE.Vector3();
    this.roomAt = -Infinity;
  }

  // Re-render what is out of date for the light coming from `dir`. `casters`
  // are the meshes that cast; everything else in `scene` is hidden meanwhile.
  update(dir, casters, scene, t) {
    const moved = this.dir.dot(dir) < 0.999999;
    const roomDue = moved || t - this.roomAt >= 1 / ROOM_HZ;
    const platformDue = moved && this.platform.box;
    if (!roomDue && !platformDue) return;
    this.dir.copy(dir);
    // `scene` is the glTF's group, not a Scene, so no overrideMaterial: swap
    // the casters' materials for a depth-only one, hide the rest
    const hidden = scene.children.filter((o) => o.visible && !casters.includes(o));
    for (const o of hidden) o.visible = false;
    const materials = casters.map((m) => m.material);
    for (const m of casters) m.material = depthOnly;
    if (roomDue && this.room.box) { this.room.aim(dir); this.room.render(this.renderer, scene); this.roomAt = t; }
    if (platformDue) { this.platform.aim(dir); this.platform.render(this.renderer, scene); }
    casters.forEach((m, i) => { m.material = materials[i]; });
    for (const o of hidden) o.visible = true;
  }
}
