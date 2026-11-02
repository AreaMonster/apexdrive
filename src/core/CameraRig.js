import * as THREE from 'three';

export const CAMERA_MODES = ['chase', 'far', 'hood', 'bumper'];
const CAMERA_LABELS = { chase: 'Chase camera', far: 'Far chase camera', hood: 'Hood camera', bumper: 'Bumper camera' };

const fwd = new THREE.Vector3();
const offset = new THREE.Vector3();
const look = new THREE.Vector3();

const dampAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class CameraRig {
  constructor(camera, mode = 'chase') {
    this.camera = camera;
    this.mode = CAMERA_MODES.includes(mode) ? mode : 'chase';
    this.yaw = 0;
    this.height = 0;
    this.accelLag = 0;
    this.fov = 62;
    this.snap = true;
    this.shakeAmt = 0; // decaying impact shake
    this.rumble = 0; // steady vibration from rough ground, set each frame
    this._t = 0;
  }

  shake(amount) {
    this.shakeAmt = Math.min(1, this.shakeAmt + amount);
  }

  _applyShake(dt, scale) {
    this._t += dt;
    this.shakeAmt *= Math.exp(-dt * 5);
    const a = (this.shakeAmt * 0.35 + this.rumble * 0.025) * scale;
    if (a < 0.0005) return;
    const t = this._t;
    // a few incommensurate sines: random-looking but smooth, no per-frame jitter
    this.camera.position.x += a * (Math.sin(t * 41.3) + 0.5 * Math.sin(t * 97.1));
    this.camera.position.y += a * (Math.sin(t * 53.7 + 1) + 0.5 * Math.sin(t * 83.3));
    this.camera.position.z += a * Math.sin(t * 47.9 + 2);
  }

  get label() {
    return CAMERA_LABELS[this.mode];
  }

  next() {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.snap = true;
    return this.mode;
  }

  update(dt, rs, vehicle) {
    const cam = this.camera;
    const spec = vehicle.spec;
    const speed = vehicle.speed;
    fwd.set(0, 0, -1).applyQuaternion(rs.quaternion);

    if (this.mode === 'hood' || this.mode === 'bumper') {
      // body frame: forward is -Z, y measured from the anchor plane
      if (this.mode === 'hood') offset.set(0, spec.cameraHeight, -(spec.shape.xWs + 0.1));
      else offset.set(0, 0.5 - spec.anchorHeight, -(spec.shape.front + 0.05));
      offset.applyQuaternion(rs.quaternion);
      cam.position.copy(rs.position).add(offset);
      cam.quaternion.copy(rs.quaternion);
      this._fov(dt, 72 + Math.min(speed * 0.12, 12));
      this._applyShake(dt, 0.5);
      this.snap = true;
      return;
    }

    const far = this.mode === 'far';
    const headingYaw = Math.atan2(-fwd.x, -fwd.z);
    let targetYaw = headingYaw;
    if (speed > 4 && vehicle.vLong > 0) {
      // lean the camera toward the direction of travel so drifts read as drifts
      const velYaw = Math.atan2(-vehicle.vel.x, -vehicle.vel.z);
      targetYaw = dampAngle(headingYaw, velYaw, 0.45);
    }
    if (this.snap) {
      this.yaw = targetYaw;
      this.height = rs.position.y;
      this.snap = false;
    }
    this.yaw = dampAngle(this.yaw, targetYaw, 1 - Math.exp(-dt * 5));
    this.height += (rs.position.y - this.height) * (1 - Math.exp(-dt * 7));
    // pull back a little under acceleration, push in under braking
    this.accelLag += (vehicle.longG - this.accelLag) * (1 - Math.exp(-dt * 3));

    const dist = (far ? 9.5 : 6.2) + Math.min(speed * 0.015, 1.2) + this.accelLag * 0.6;
    const h = far ? 3.1 : 1.95;
    cam.position.set(
      rs.position.x + Math.sin(this.yaw) * dist,
      this.height + h,
      rs.position.z + Math.cos(this.yaw) * dist,
    );
    // never dip below the car's ground plane
    const groundY = rs.position.y - spec.anchorHeight;
    if (cam.position.y < groundY + 0.6) cam.position.y = groundY + 0.6;
    look.set(rs.position.x - Math.sin(this.yaw) * 2.5, this.height + 0.75, rs.position.z - Math.cos(this.yaw) * 2.5);
    cam.lookAt(look);
    this._applyShake(dt, 1);
    this._fov(dt, 60 + Math.min(speed * 0.2, 20));
  }

  _fov(dt, target) {
    this.fov += (target - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
