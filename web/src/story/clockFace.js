// The rest corner's station clock, big over the picture during the rewind
// and the fast forward (Adriaen, 2026-10-25): a camera close in front of the
// clock on the nook's wall draws the room's own clock model (its baked dial
// and live hands, which follow the game's time) into a texture, shown as a
// disc in the middle of the screen while the hands race round.
import * as THREE from 'three';

const SIZE = 768;     // px of the texture
const RADIUS = 0.62;  // of half the screen's height
const FADE = 0.5;     // s in and out
const CULL = new URLSearchParams(location.search).get('cull') !== '0'; // ?cull=0 (docs/performance.md)

export class ClockFace {
  constructor(game) {
    this.game = game;
    this.k = 0;
    this.want = 0;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, colorSpace: THREE.LinearSRGBColorSpace });
    this.cam = new THREE.PerspectiveCamera(42, 1, 0.05, 5);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    this.scene = new THREE.Scene();
    this.scene.name = 'clock face';
    const mat = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, ...o });
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * 1.12, 64), mat({ color: 0x000000, opacity: 0.45 }));
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 96), mat({ map: this.target.texture }));
    this.shadow.position.set(0, -0.015, -1);
    this.disc.position.set(0, 0, -1);
    this.scene.add(this.shadow, this.disc);
    game.hooks.render.push((renderer) => this.draw(renderer));
  }

  show(on) { this.want = on ? 1 : 0; }

  draw(renderer) {
    const dt = Math.min(0.05, (performance.now() - (this.last ?? performance.now())) / 1000);
    this.last = performance.now();
    this.k = this.want ? Math.min(1, this.k + dt / FADE) : Math.max(0, this.k - dt / FADE);
    if (!this.k || this.game.hooks.hidden) return;
    // Aim at the dial once: the hands' origin is its centre, their front its normal
    if (!this.aimed) {
      const hand = this.game.room?.root.getObjectByName('WallClockHourHand');
      if (!hand) return;
      const c = hand.getWorldPosition(new THREE.Vector3());
      const front = new THREE.Vector3(0, 0, 1).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
      this.cam.position.copy(c).addScaledVector(front, 0.51);   // the aluminium rim just fills the disc
      this.cam.lookAt(c);
      this.aimed = true;
    }
    const { scene } = this.game;
    const before = renderer.getRenderTarget(), color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x101418, 1);
    renderer.clear();
    // The camera is a hand's width from the nook's wall: the sea's depth-only
    // surface (76k triangles, never culled) can't show
    const sea = CULL && this.game.outdoor3?.waterline, seaOn = sea?.visible;
    if (sea) sea.visible = false;
    renderer.render(scene, this.cam);
    if (sea) sea.visible = seaOn;
    renderer.setRenderTarget(before);
    renderer.setClearColor(color, alpha);
    // The disc over everything, at the screen's aspect
    const size = renderer.getSize(new THREE.Vector2()), a = size.x / size.y;
    this.ortho.left = -a; this.ortho.right = a;
    this.ortho.updateProjectionMatrix();
    const e = this.k * this.k * (3 - 2 * this.k);
    this.disc.material.opacity = e;
    this.shadow.material.opacity = 0.45 * e;
    this.scene.scale.setScalar(0.85 + 0.15 * e);
    renderer.clearDepth();
    renderer.render(this.scene, this.ortho);
  }
}
