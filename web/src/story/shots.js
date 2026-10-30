// Story mode's camera: mostly first person from your chair at the left desk,
// the head turning to whoever speaks, plus set shots (the red clock, the band,
// out of the window to the boat, a monitor up close, the meeting table).
// Moves between shots glide; jumps cut.
import * as THREE from 'three';

const EASE = 1.3;   // s for a glide between shots
const ease = (t) => t * t * (3 - 2 * t);

export class Shots {
  constructor(game) {
    this.game = game;
    this.cast = null;           // cast.js, for heads to look at
    this.custom = null;         // a function returning a pose (the epilogue's flight)
    this.name = 'desk';
    this.from = null;
    this.k = 1;
    this.pose = null;
    this.held = true;
    this.t = 0;
    const c = game.chairs[0].obj;
    const f = new THREE.Vector3(-Math.sin(c.rotation.y), 0, -Math.cos(c.rotation.y));
    this.seat = new THREE.Vector3(c.position.x + f.x * 0.2, 1.2, c.position.z + f.z * 0.2);   // a little forward, clear of the headrest when we turn
    this.clock = game.room.root.getObjectByName('EmitClock')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(3.1, 2.7, -3.96);
  }

  go(name, instant) {
    if (!name) return;
    this.held = true;
    if (name === this.name && this.pose) return;
    this.name = name;
    if (instant || !this.pose) { this.k = 1; this.from = null; return; }
    this.from = { pos: this.pose.pos.clone(), quat: this.pose.quat.clone(), fov: this.pose.fov };
    this.k = 0;
  }

  // Free mode takes the camera back
  release() {
    this.held = false;
    this.game.chairs[0].obj.visible = true;
    this.game.camera.fov = 70;
    this.game.camera.updateProjectionMatrix();
  }

  speaker() { /* the shots that follow a speaker name them; nothing to do here */ }

  look(pos, at, fov) {
    const m = new THREE.Matrix4().lookAt(pos, at, new THREE.Vector3(0, 1, 0));
    return { pos: pos.clone(), quat: new THREE.Quaternion().setFromRotationMatrix(m), fov };
  }

  vesselWorld() {
    const v = this.game.vessel?.copies?.[0]?.root;
    if (!v) return null;
    return new THREE.Vector3().setFromMatrixPosition(v.matrixWorld).add(new THREE.Vector3(0, 9, 0));
  }

  // Where the vessel label goes on screen, in CSS px, if it is in view
  vesselPoint() {
    const p = this.vesselWorld();
    if (!p) return null;
    const cam = this.game.camera;
    const v = p.clone().project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    const r = this.game.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  target(name) {
    const headOf = (who) => this.cast?.head(who);
    switch (name) {
      case 'desk': return this.look(this.seat, new THREE.Vector3(-0.85, 1.32, -3.6), 70);
      case 'roomBand': return this.look(new THREE.Vector3(0.5, 1.55, 0.2), new THREE.Vector3(-0.9, 1.6, -3.2), 62);   // the band and the left desk with the operator at it, from behind
      case 'band': return this.look(new THREE.Vector3(-0.4, 1.38, -0.4), new THREE.Vector3(0, 1.8, -4), 62);
      case 'clock': return this.look(this.seat, this.clock, 26);
      case 'boat': {
        const v = this.vesselWorld() ?? new THREE.Vector3(-60, -10, -5);
        return this.look(new THREE.Vector3(-5.1, 1.8, -0.4), v.clone().add(new THREE.Vector3(0, -4, 0)), 50);   // up at the glass: the boat is 50 m below
      }
      case 'table': return this.look(new THREE.Vector3(-0.35, 1.62, 0.15), new THREE.Vector3(2.0, 1.3, 2.3), 62);
      case 'epilogue': return this.custom?.() ?? this.target('desk');
      // Tomorrow's room: the whole room from the back corner; over the supervisor's
      // shoulder at the band; the supervisor from the band side; over Adriaen's
      // shoulder at his monitors; Adriaen side on
      case 'wideRoom': return this.look(new THREE.Vector3(3.3, 2.15, 2.6), new THREE.Vector3(-0.6, 1.2, -2.6), 68);
      case 'planBand': return this.look(new THREE.Vector3(2.8, 1.7, 2.6), new THREE.Vector3(-0.2, 1.6, -4), 45);
      case 'supervisor': {
        const head = headOf('supervisor');
        if (head) return this.look(new THREE.Vector3(0.15, 1.5, -2.4), head.clone().add(new THREE.Vector3(0, -0.15, 0)), 50);   // from the gap between the desks, his face lit by the band
        return this.target('planBand');
      }
      // The morning: both desks from behind (the chitchat), and close on the supervisor's mug for the pour
      case 'pair': return this.look(new THREE.Vector3(2.3, 1.65, 0.7), new THREE.Vector3(-0.1, 1.0, -1.5), 55);
      case 'pour': return this.look(new THREE.Vector3(0.3, 1.65, -2.5), new THREE.Vector3(-0.55, 1.12, -1.65), 62);
      case 'adriaenDesk': return this.look(new THREE.Vector3(0.3, 1.8, -0.8), new THREE.Vector3(1.9, 1.0, -2.2), 45);
      // one year ago: the operator at the left desk and the screen CtrlBuddy will appear on, both in the left half (the learning curve takes the right)
      case 'buddyDesk': return this.look(new THREE.Vector3(-0.2, 1.75, -1.1), new THREE.Vector3(-2.15, 1.0, -2.0), 42);
      // the same, mirrored: whoever sits at the right desk and his screens
      case 'buddyDesk_right': return this.look(new THREE.Vector3(0.2, 1.75, -1.1), new THREE.Vector3(2.15, 1.0, -2.0), 42);
      // the learning curve beside the operator: turned a little right, so he sits further left and the graph has room
      case 'phoneDesk': return this.look(new THREE.Vector3(-2.5, 1.75, 0.55), new THREE.Vector3(-0.45, 0.9, -1.6), 58);   // the call: the left desk with its phone, left of the portrait
      case 'curveDesk': return this.look(new THREE.Vector3(-0.2, 1.75, -1.1), new THREE.Vector3(-1.9, 1.0, -2.45), 42);
      case 'adriaen': return this.look(new THREE.Vector3(2.5, 1.45, -0.35), new THREE.Vector3(1.45, 1.1, -1.95), 55);   // his profile, the monitors beyond
      default: break;
    }
    // a screen filling the view (monitor:), or halfway there (half:, its neighbours and the desk around it),
    // or straight on in the left half of the view (side:, room for a panel on the right: explain.js)
    if (name.startsWith('side:')) {
      const f = this.game.room.screenFrame(name.slice(5), this.seat);
      if (!f) return this.target('desk');
      const fov = 50, t = Math.tan(THREE.MathUtils.degToRad(fov) / 2) / 1.04;
      const d = Math.max(f.height / 2 / t, f.width / 2 / (t * this.game.camera.aspect)) * 1.7;
      const right = new THREE.Vector3().crossVectors(f.up, f.normal).multiplyScalar(0.5 * d * t * this.game.camera.aspect);
      const pos = f.center.clone().addScaledVector(f.normal, d).add(right);
      const m = new THREE.Matrix4().lookAt(pos, f.center.clone().add(right), f.up);
      return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m), fov };
    }
    if (name.startsWith('monitor:') || name.startsWith('half:')) {
      const half = name.startsWith('half:');
      const f = this.game.room.screenFrame(name.slice(name.indexOf(':') + 1), this.seat);
      if (!f) return this.target('desk');
      const fov = 50, t = Math.tan(THREE.MathUtils.degToRad(fov) / 2) / 1.04;
      const d = Math.max(f.height / 2 / t, f.width / 2 / (t * this.game.camera.aspect)) * (half ? 2.2 : 1);
      const pos = f.center.clone().addScaledVector(f.normal, d);
      // halfway: from a little to the screen's left, clear of whoever sits at it
      if (half) pos.addScaledVector(new THREE.Vector3().crossVectors(f.up, f.normal), 0.4 * d);
      const m = new THREE.Matrix4().lookAt(pos, f.center, f.up);
      return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m), fov };
    }
    // A person: from our chair, turned to their face
    const who = { supervisor: 'supervisor', operator: 'operator', operatorClose: 'operator', oim: 'oim' }[name];
    const head = who && headOf(who);
    if (head) return this.look(this.seat, head.clone().add(new THREE.Vector3(0, -0.12, 0)), name === 'operatorClose' ? 58 : 55);
    return this.target('desk');
  }

  update(dt) {
    if (!this.held) return;
    this.t += dt;
    const tgt = this.target(this.name);
    if (this.from && this.k < 1) {
      this.k = Math.min(1, this.k + dt / EASE);
      const k = ease(this.k);
      this.pose = { pos: this.from.pos.clone().lerp(tgt.pos, k), quat: this.from.quat.clone().slerp(tgt.quat, k), fov: THREE.MathUtils.lerp(this.from.fov, tgt.fov, k) };
    } else this.pose = tgt;
    const cam = this.game.camera;
    cam.position.copy(this.pose.pos);
    cam.quaternion.copy(this.pose.quat);
    // A breath of life: the head never holds perfectly still
    if (this.name !== 'epilogue' && !this.name.startsWith('monitor:') && !this.name.startsWith('half:') && !this.name.startsWith('side:')) {
      cam.rotateY(0.004 * Math.sin(this.t * 0.37));
      cam.rotateX(0.003 * Math.sin(this.t * 0.51 + 1));
    }
    // Our own chair is behind our head: from the seat it only blocks the view back into the room
    this.game.chairs[0].obj.visible = cam.position.distanceTo(this.seat) > 0.6;
    if (cam.fov !== this.pose.fov) { cam.fov = this.pose.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }
}
