import * as THREE from 'three';
import { CameraRig } from './CameraRig.js';

// Cinematic replay cameras.
//   tv       trackside cameras placed along the circuit; they pan with the car and zoom so it
//            stays the same size on screen, cutting to the next camera as it drives past
//   heli     a slow orbit high above the car
//   chase / hood / bumper   the in-game rigs, on the replayed car
//   auto     a director that mixes the above
export const REPLAY_CAMERAS = ['auto', 'tv', 'heli', 'chase', 'hood', 'bumper'];
const LABELS = { auto: 'Director', tv: 'Trackside', heli: 'Helicopter', chase: 'Chase', hood: 'Hood', bumper: 'Bumper' };

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class ReplayCamera {
  constructor(camera, map, physics) {
    this.camera = camera;
    this.mode = 'auto';
    this.rig = new CameraRig(camera, 'chase');
    this.spots = map.track && physics ? placeSpots(map.track, physics) : [];
    this.spot = null;
    this.shot = 'tv';
    this.shotT = 0;
    this.orbit = Math.random() * Math.PI * 2;
    this.look = new THREE.Vector3();
    this.fov = 40;
    this.cut = true;
    this._near = {};
    this._hint = -1;
    this.track = map.track ?? null;
  }

  get label() {
    return LABELS[this.mode];
  }

  next() {
    this.mode = REPLAY_CAMERAS[(REPLAY_CAMERAS.indexOf(this.mode) + 1) % REPLAY_CAMERAS.length];
    this.cut = true;
    return this.mode;
  }

  /** Jumping in time or switching cars: re-pick shots instead of panning across the map. */
  reset() {
    this.cut = true;
    this.spot = null;
  }

  update(dt, car) {
    let shot = this.mode;
    if (shot === 'auto') shot = this._direct(dt, car);
    if (shot === 'tv' && !this.spots.length) shot = 'heli';
    if (shot !== this.shot) {
      this.shot = shot;
      this.cut = true;
    }
    const cam = this.camera;
    if (shot === 'chase' || shot === 'hood' || shot === 'bumper') {
      this.rig.mode = shot;
      if (this.cut) this.rig.snap = true;
      this.rig.update(dt, car.rs, car);
      this.cut = false;
      return;
    }
    const p = car.pos;
    let fovTarget;
    if (shot === 'heli') {
      this.orbit += dt * 0.12;
      const r = 38;
      _v.set(p.x + Math.cos(this.orbit) * r, p.y + 24, p.z + Math.sin(this.orbit) * r);
      if (this.cut) cam.position.copy(_v);
      else cam.position.lerp(_v, 1 - Math.exp(-dt * 2));
      fovTarget = 42;
    } else {
      const spot = this._pickSpot(car);
      cam.position.copy(spot.pos);
      // zoom so the car fills a similar share of the frame at any distance
      const dist = cam.position.distanceTo(p);
      fovTarget = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(7.5 / dist)), 7, 55);
    }
    // aim slightly ahead of the car, like a camera operator leading the shot
    _d.copy(car.vel).multiplyScalar(0.12);
    _v.copy(p).add(_d);
    if (this.cut) {
      this.look.copy(_v);
      this.fov = fovTarget;
    } else {
      this.look.lerp(_v, 1 - Math.exp(-dt * 6));
      this.fov += (fovTarget - this.fov) * (1 - Math.exp(-dt * 4));
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.cut = false;
  }

  /** Director: mostly trackside, broken up with chase, helicopter and bumper shots. */
  _direct(dt, car) {
    this.shotT -= dt;
    if (this.shotT > 0 && !this.cut) return this.shot;
    const r = Math.random();
    let shot = 'tv';
    if (this.shot === 'tv' || !this.spots.length) {
      if (r < 0.35) shot = 'chase';
      else if (r < 0.6) shot = 'heli';
      else if (r < 0.75) shot = 'bumper';
    }
    if (!this.spots.length && shot === 'tv') shot = 'chase';
    this.shotT = shot === 'tv' ? 9 + Math.random() * 7 : 4 + Math.random() * 3;
    if (shot !== this.shot) this.spot = null;
    return shot;
  }

  _pickSpot(car) {
    const t = this.track;
    const q = t.nearest(car.pos.x, car.pos.z, this._hint, this._near);
    this._hint = q.index;
    const s = q.s;
    const cur = this.spot;
    if (cur && !this.cut) {
      // hold the camera until the car is well past it (or it has lost sight of it)
      const ahead = t.delta(s, cur.s);
      const dist = cur.pos.distanceTo(car.pos);
      if (ahead > -45 && dist < 170) return cur;
    }
    // next camera up the road from the car
    let best = null;
    let bestAhead = Infinity;
    for (const sp of this.spots) {
      const ahead = t.delta(s, sp.s);
      if (ahead > 10 && ahead < bestAhead) {
        bestAhead = ahead;
        best = sp;
      }
    }
    if (!best || bestAhead > 220) {
      // nothing sensible ahead (open stage end): nearest camera instead
      best = this.spots.reduce((a, b) => (a.pos.distanceToSquared(car.pos) < b.pos.distanceToSquared(car.pos) ? a : b));
    }
    if (best !== this.spot) this.cut = true;
    this.spot = best;
    return best;
  }
}

/**
 * Camera positions every ~110 m, on the outside of the bend where possible, raised a few metres
 * and checked with ray casts so they're not buried in a hill and can see the road either side.
 */
function placeSpots(track, physics) {
  const spots = [];
  const step = 110;
  const down = new THREE.Vector3(0, -1, 0);
  const o = new THREE.Vector3();
  const p = { x: 0, y: 0, z: 0 };
  const dir = new THREE.Vector3();
  const n = Math.floor(track.length / step);
  for (let k = 0; k < n; k++) {
    const s = (k + 0.5) * step;
    const i = track.indexAtS(s);
    // outside of the bend coming up (curv + = right-hander → outside is the left, l < 0)
    const ahead = track.indexAtS(s + 50);
    const c = track.curv[ahead] + track.curv[i];
    const sides = Math.abs(c) > 0.002 ? [c > 0 ? -1 : 1, c > 0 ? 1 : -1] : k % 2 ? [1, -1] : [-1, 1];
    let placed = null;
    for (const side of sides) {
      for (const extra of [9, 16]) {
        track.pointAt(i, side * (track.half[i] + extra), p);
        // sit on whatever ground is there, then raise
        o.set(p.x, p.y + 60, p.z);
        const hit = physics.raycast(o, down, 120);
        const ground = hit ? o.y - hit.dist : p.y;
        const pos = new THREE.Vector3(p.x, Math.max(ground, p.y) + 3.5 + (k % 3), p.z);
        // must see the road 40 m before and after the camera
        let clear = 0;
        for (const ds of [-40, 0, 40]) {
          track.pointAt(track.indexAtS(s + ds), 0, p);
          dir.set(p.x - pos.x, p.y + 1 - pos.y, p.z - pos.z);
          const len = dir.length();
          dir.divideScalar(len);
          const h = physics.raycast(pos, dir, len - 1.5);
          if (!h) clear++;
        }
        if (clear >= 2) {
          placed = pos;
          break;
        }
      }
      if (placed) break;
    }
    if (placed) spots.push({ s, pos: placed });
  }
  return spots;
}
