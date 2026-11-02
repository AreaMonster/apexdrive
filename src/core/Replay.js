import * as THREE from 'three';
import { SURFACES } from '../data/surfaces.js';

// Session replays: every car's state sampled at a fixed rate into growable Float32 buffers, and a
// player that rebuilds Vehicle-shaped "proxies" from them (interpolated), so the normal car
// models, audio voices and cameras work on replays unchanged.

export const REPLAY_HZ = 20;
const MAX_SECONDS = 20 * 60;
const SURF = Object.keys(SURFACES);
const SURF_INDEX = Object.fromEntries(SURF.map((k, i) => [k, i + 1]));

// frame layout per car
const F_POS = 0; // x y z
const F_QUAT = 3; // x y z w
const F_VEL = 7; // x y z
const F_RPM = 10;
const F_THR = 11;
const F_GEAR = 12;
const F_BRAKE = 13;
const F_LIMIT = 14;
const F_SHIFT = 15;
const F_WHEEL = 16; // 4 × (compression, steer, rotation, skid, surface code: 0 = airborne)
const W = 5;
const STRIDE = F_WHEEL + 4 * W;

class Track {
  constructor(key, def, vehicle, extra) {
    this.key = key;
    this.def = def;
    this.spec = vehicle.spec;
    this.anchors = vehicle.wheels.map((w) => w.anchor.clone());
    this.colorIndex = extra.colorIndex ?? 0;
    this.name = extra.name ?? '';
    this.model = extra.model ?? null;
    this.data = new Float32Array(STRIDE * REPLAY_HZ * 60);
    this.frames = 0;
  }

  push(v) {
    if ((this.frames + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    const d = this.data;
    const o = this.frames * STRIDE;
    d[o + F_POS] = v.curPos.x;
    d[o + F_POS + 1] = v.curPos.y;
    d[o + F_POS + 2] = v.curPos.z;
    d[o + F_QUAT] = v.curQuat.x;
    d[o + F_QUAT + 1] = v.curQuat.y;
    d[o + F_QUAT + 2] = v.curQuat.z;
    d[o + F_QUAT + 3] = v.curQuat.w;
    d[o + F_VEL] = v.vel.x;
    d[o + F_VEL + 1] = v.vel.y;
    d[o + F_VEL + 2] = v.vel.z;
    const dt = v.drivetrain;
    d[o + F_RPM] = dt.rpm;
    d[o + F_THR] = dt.throttle;
    d[o + F_GEAR] = dt.gear;
    d[o + F_BRAKE] = v.locked ? 0 : v.brake;
    d[o + F_LIMIT] = dt.limiterTimer > 0 ? 1 : 0;
    d[o + F_SHIFT] = dt.shiftTimer > 0 ? 1 : 0;
    for (let i = 0; i < 4; i++) {
      const w = v.wheels[i];
      const k = o + F_WHEEL + i * W;
      d[k] = w.compression;
      d[k + 1] = w.steer;
      d[k + 2] = w.rotation;
      d[k + 3] = w.skid;
      d[k + 4] = w.contact ? SURF_INDEX[w.surface] || 1 : 0;
    }
    this.frames++;
  }
}

/** Records the cars of one session. */
export class ReplayRecorder {
  constructor() {
    this.tracks = [];
    this.acc = 0;
    this.time = 0;
    this.full = false;
  }

  /** extra: { colorIndex, name } */
  add(key, def, vehicle, extra = {}) {
    const t = new Track(key, def, vehicle, extra);
    t.vehicle = vehicle;
    this.tracks.push(t);
    return t;
  }

  update(dt) {
    if (this.full || !this.tracks.length) return;
    this.acc += dt;
    const step = 1 / REPLAY_HZ;
    while (this.acc >= step) {
      this.acc -= step;
      for (const t of this.tracks) t.push(t.vehicle);
      this.time += step;
      if (this.time >= MAX_SECONDS) this.full = true;
    }
  }

  /** Freeze into a replay (drops the live vehicle references). */
  finish() {
    const frames = Math.min(...this.tracks.map((t) => t.frames));
    if (!this.tracks.length || frames < REPLAY_HZ * 2) return null;
    for (const t of this.tracks) {
      t.vehicle = null;
      t.frames = frames;
    }
    return { tracks: this.tracks, frames, duration: (frames - 1) / REPLAY_HZ };
  }
}

/** A Vehicle-shaped view of one replay track at the current playback time. */
export class ReplayProxy {
  constructor(track) {
    this.track = track;
    this.key = track.key;
    this.def = track.def;
    this.spec = track.spec;
    this.pos = new THREE.Vector3();
    this.curPos = this.pos;
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.speed = 0;
    this.vLong = 0;
    this.longG = 0;
    this.brake = 0;
    this.locked = false;
    this.grounded = 4;
    this.drivetrain = { rpm: 0, throttle: 0, gear: 1, limiterTimer: 0, shiftTimer: 0 };
    this.wheels = track.anchors.map((a) => ({ anchor: a, compression: 0, steer: 0, rotation: 0, skid: 0, surface: 'asphalt', contact: true, point: new THREE.Vector3() }));
    this.rs = { position: this.pos, quaternion: this.quat };
    this._q = new THREE.Quaternion();
  }

  /** Sample at frame index f (fractional). */
  sample(f) {
    const t = this.track;
    const d = t.data;
    const i0 = Math.max(0, Math.min(t.frames - 1, Math.floor(f)));
    const i1 = Math.min(t.frames - 1, i0 + 1);
    const a = f - i0;
    const o0 = i0 * STRIDE;
    const o1 = i1 * STRIDE;
    const L = (k) => d[o0 + k] + (d[o1 + k] - d[o0 + k]) * a;
    this.pos.set(L(F_POS), L(F_POS + 1), L(F_POS + 2));
    this.quat.set(d[o0 + F_QUAT], d[o0 + F_QUAT + 1], d[o0 + F_QUAT + 2], d[o0 + F_QUAT + 3]);
    this._q.set(d[o1 + F_QUAT], d[o1 + F_QUAT + 1], d[o1 + F_QUAT + 2], d[o1 + F_QUAT + 3]);
    this.quat.slerp(this._q, a);
    this.vel.set(L(F_VEL), L(F_VEL + 1), L(F_VEL + 2));
    this.speed = this.vel.length();
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.vLong = this.vel.dot(this.fwd);
    const near = a < 0.5 ? o0 : o1;
    const dtr = this.drivetrain;
    dtr.rpm = L(F_RPM);
    dtr.throttle = L(F_THR);
    dtr.gear = d[near + F_GEAR];
    dtr.limiterTimer = d[near + F_LIMIT];
    dtr.shiftTimer = d[near + F_SHIFT];
    this.brake = L(F_BRAKE);
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const k = F_WHEEL + i * W;
      w.compression = L(k);
      w.steer = L(k + 1);
      w.rotation = L(k + 2);
      w.skid = L(k + 3);
      const code = d[near + k + 4];
      w.contact = code > 0;
      if (w.contact) {
        grounded++;
        w.surface = SURF[code - 1];
      }
    }
    this.grounded = grounded;
    return this;
  }
}
