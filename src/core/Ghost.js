import * as THREE from 'three';

// Ghost laps: the car's pose is sampled at a fixed rate during each lap; the personal-best lap is
// kept and replayed in sync with the current lap time. Frames are stored as delta-encoded
// integers (cm and 1/10000 quaternion units), which keeps a 90 s lap around 20 KB of JSON.

const RATE = 15; // samples per second
const STRIDE = 8; // t(ms), x, y, z (cm), qx, qy, qz, qw (×10⁴)

export class GhostRecorder {
  constructor() {
    this.frames = [];
    this.timer = 0;
  }

  reset() {
    this.frames = [];
    this.timer = 0;
  }

  update(dt, lapTime, pos, quat, progress) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer += 1 / RATE;
    this.frames.push([lapTime, pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, progress]);
  }

  /** Close the lap with an exact final frame and return it as a playable ghost. */
  finish(lapTime, pos, quat, progress) {
    this.frames.push([lapTime, pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, progress]);
    const lap = this.frames;
    this.frames = [];
    return lap;
  }
}

export function encodeGhost(frames, meta) {
  const out = [];
  const prev = new Array(STRIDE).fill(0);
  const dist = [];
  let prevD = 0;
  for (const f of frames) {
    const q = [Math.round(f[0] * 1000), Math.round(f[1] * 100), Math.round(f[2] * 100), Math.round(f[3] * 100)];
    for (let k = 4; k < 8; k++) q.push(Math.round(f[k] * 10000));
    for (let k = 0; k < STRIDE; k++) {
      out.push(q[k] - prev[k]);
      prev[k] = q[k];
    }
    const d = Math.round(f[8] * 10);
    dist.push(d - prevD);
    prevD = d;
  }
  return { v: 1, ...meta, date: Date.now(), d: out, p: dist };
}

export function decodeGhost(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.d)) return null;
  const frames = [];
  const acc = new Array(STRIDE).fill(0);
  let d = 0;
  for (let i = 0, f = 0; i + STRIDE <= data.d.length; i += STRIDE, f++) {
    for (let k = 0; k < STRIDE; k++) acc[k] += data.d[i + k];
    d += data.p?.[f] ?? 0;
    frames.push([acc[0] / 1000, acc[1] / 100, acc[2] / 100, acc[3] / 100, acc[4] / 1e4, acc[5] / 1e4, acc[6] / 1e4, acc[7] / 1e4, d / 10]);
  }
  return frames.length > 1 ? frames : null;
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/** Plays a recorded lap; also answers "what was the best lap's time at this distance?". */
export class GhostPlayer {
  constructor(frames) {
    this.frames = frames;
    this.duration = frames[frames.length - 1][0];
    this._i = 0;
  }

  /** Interpolated pose at lap time t. Returns false once the ghost has finished. */
  sample(t, outPos, outQuat) {
    const f = this.frames;
    if (t >= this.duration) return false;
    let i = this._i;
    if (i >= f.length - 1 || f[i][0] > t) i = 0;
    while (i < f.length - 2 && f[i + 1][0] <= t) i++;
    this._i = i;
    const a = f[i];
    const b = f[i + 1];
    const k = Math.max(0, Math.min(1, (t - a[0]) / Math.max(b[0] - a[0], 1e-6)));
    outPos.set(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
    qa.set(a[4], a[5], a[6], a[7]).normalize();
    qb.set(b[4], b[5], b[6], b[7]).normalize();
    outQuat.slerpQuaternions(qa, qb, k);
    return true;
  }

  /** Best lap's elapsed time when it had covered `progress` metres (for the live delta). */
  timeAtProgress(progress) {
    const f = this.frames;
    let lo = 0;
    let hi = f.length - 1;
    if (progress <= f[0][8]) return f[0][0];
    if (progress >= f[hi][8]) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid][8] <= progress) lo = mid;
      else hi = mid;
    }
    const a = f[lo];
    const b = f[hi];
    const k = (progress - a[8]) / Math.max(b[8] - a[8], 1e-6);
    return a[0] + (b[0] - a[0]) * k;
  }
}
