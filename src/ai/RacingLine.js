// Racing line and speed profile for AI drivers.
//
// The line is a lateral offset per track sample. It is found by relaxation: every point is pulled
// along the road's normal toward the midpoint of its neighbours k samples either side, clamped to
// the usable road width. Pulling toward neighbour midpoints straightens the path, which is the
// same as reducing curvature: the car swings wide on entry, clips the apex, and runs out wide.
// Working from coarse (k = 24) to fine (k = 3) gets the long-range shape first, then the detail.

const G = 9.81;

export class RacingLine {
  constructor(track, { margin = 1.3 } = {}) {
    this.track = track;
    const N = track.count;
    const t = track;
    this.limit = new Float32Array(N);
    for (let i = 0; i < N; i++) this.limit[i] = Math.max(0, t.half[i] - margin);
    const off = (this.offset = new Float32Array(N));
    const px = new Float32Array(N);
    const pz = new Float32Array(N);
    const place = (i) => {
      px[i] = t.pos[i * 3] - t.tan[i * 2 + 1] * off[i];
      pz[i] = t.pos[i * 3 + 2] + t.tan[i * 2] * off[i];
    };
    for (let i = 0; i < N; i++) place(i);
    for (const k of [24, 12, 6, 3]) {
      for (let it = 0; it < 50; it++) {
        for (let i = 0; i < N; i++) {
          if (!t.closed && (i < k || i >= N - k)) continue; // stage ends stay on the centreline
          const a = t.wrap(i - k);
          const b = t.wrap(i + k);
          const mx = (px[a] + px[b]) / 2;
          const mz = (pz[a] + pz[b]) / 2;
          // component of (midpoint − point) along the road normal (right = (−tz, tx))
          const d = (mx - px[i]) * -t.tan[i * 2 + 1] + (mz - pz[i]) * t.tan[i * 2];
          off[i] = Math.max(-this.limit[i], Math.min(this.limit[i], off[i] + d * 0.6));
          place(i);
        }
      }
    }

    // curvature and segment lengths of the line itself
    this.ds = new Float32Array(N);
    this.curv = new Float32Array(N);
    const yaw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const j = t.wrap(i + 1);
      const dx = px[j] - px[i];
      const dz = pz[j] - pz[i];
      this.ds[i] = Math.max(0.2, Math.hypot(dx, dz));
      yaw[i] = Math.atan2(-dx, -dz);
    }
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = yaw[t.wrap(i - 2)];
      const b = yaw[t.wrap(i + 2)];
      let span = 0;
      for (let k = -2; k < 2; k++) span += this.ds[t.wrap(i + k)];
      raw[i] = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) / span;
    }
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -3; k <= 3; k++) s += raw[t.wrap(i + k)];
      this.curv[i] = s / 7;
    }
  }

  /**
   * Fastest speed at every sample for a car with grip mu(i) (friction coefficient, may vary with
   * surface) and braking at `brakeUse` of that grip:
   *   v ≤ √(μ·g / κ)                      cornering limit on the line's curvature
   *   v[i] ≤ √(v[i+1]² + 2·a_brake·ds)    braking backward from every slow point
   * a_brake is the lesser of the tyres' grip and what the car's brakes can deliver (maxDecel).
   */
  speedProfile(mu, { vmax, brakeUse = 0.9, gripUse = 1, maxDecel = Infinity }) {
    const t = this.track;
    const N = t.count;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = Math.max(this.curv[i], 1e-5);
      const v0 = Math.sqrt((mu(i) * gripUse * G) / k);
      // fast sweepers: tyre load sensitivity costs grip and there's no time to correct a slide,
      // so keep up to 10% in hand above ~90 km/h
      const derate = 1 - 0.1 * Math.min(1, Math.max(0, (v0 - 25) / 30));
      v[i] = Math.min(vmax, Math.sqrt((mu(i) * gripUse * derate * G) / k));
    }
    const passes = t.closed ? 2 : 1;
    for (let p = 0; p < passes; p++) {
      for (let i = N - 1; i >= 0; i--) {
        if (!t.closed && i === N - 1) continue;
        const j = t.wrap(i + 1);
        const decel = Math.min(mu(i) * G * brakeUse, maxDecel);
        const lim = Math.sqrt(v[j] * v[j] + 2 * decel * this.ds[i]);
        if (lim < v[i]) v[i] = lim;
      }
    }
    return v;
  }
}
