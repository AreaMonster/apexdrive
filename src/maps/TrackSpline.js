import * as THREE from 'three';

const STEP = 2; // metres between samples
const CELL = 30; // spatial hash cell size (m)

/**
 * A track centreline sampled at uniform arc length. Each sample carries position, horizontal
 * tangent/right vectors, signed curvature, banking and road half-width. Lateral offsets are
 * measured along the horizontal `right` vector (+ = right of the driving direction).
 *
 * def: { points: [[x, z, y, { width?, bank? }?], ...], width, closed = true,
 *        bankGain (rad per 1/m of curvature), maxBank (rad) }
 */
export class TrackSpline {
  constructor(def) {
    this.closed = def.closed !== false;
    const ctrl = def.points.map(([x, z, y]) => new THREE.Vector3(x, y ?? 0, z));
    const curve = new THREE.CatmullRomCurve3(ctrl, this.closed, 'centripetal');
    curve.arcLengthDivisions = Math.max(2000, ctrl.length * 200);
    this.curve = curve;
    this.length = curve.getLength();
    const n = Math.max(8, Math.round(this.length / STEP));
    this.count = this.closed ? n : n + 1;
    this.step = this.length / n;

    const N = this.count;
    this.pos = new Float32Array(N * 3);
    this.tan = new Float32Array(N * 2); // horizontal unit tangent (x, z)
    this.yaw = new Float32Array(N);
    this.curv = new Float32Array(N); // signed curvature, + = turning right
    this.bank = new Float32Array(N); // rad, + = right side lower (banked for a right-hander)
    this.half = new Float32Array(N); // road half-width
    this.grade = new Float32Array(N); // dy/ds

    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const u = this.closed ? i / n : Math.min(i / n, 1);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      this.pos.set([p.x, p.y, p.z], i * 3);
      const h = Math.hypot(t.x, t.z) || 1;
      this.tan[i * 2] = t.x / h;
      this.tan[i * 2 + 1] = t.z / h;
      this.yaw[i] = Math.atan2(-t.x, -t.z);
      this.grade[i] = t.y / h;
    }

    // curvature = -d(yaw)/ds (yaw grows when turning left), smoothed over ±6 samples
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.yaw[this._wrap(i - 1)];
      const b = this.yaw[this._wrap(i + 1)];
      raw[i] = -Math.atan2(Math.sin(b - a), Math.cos(b - a)) / (2 * this.step);
    }
    this._smooth(raw, this.curv, 6);
    this._buildHash();

    // per-control-point overrides (width, extra bank) are interpolated by arc position
    const hasOverrides = def.points.some((pt) => pt[3]);
    const ctrlS = hasOverrides ? ctrl.map((c) => this.nearest(c.x, c.z).s) : null;
    const override = (key, fallback) =>
      def.points.map((pt) => (pt[3] && pt[3][key] !== undefined ? pt[3][key] : fallback));
    const widthAt = hasOverrides ? this._ctrlInterpolator(ctrlS, override('width', def.width)) : () => def.width;
    const bankAt = hasOverrides ? this._ctrlInterpolator(ctrlS, override('bank', 0)) : () => 0;
    const baseHalf = new Float32Array(N);
    const extraBank = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      baseHalf[i] = widthAt(i * this.step) / 2;
      extraBank[i] = bankAt(i * this.step);
    }
    this._smooth(baseHalf, this.half, 10);
    const gain = def.bankGain ?? 0;
    const maxBank = def.maxBank ?? 0.12;
    for (let i = 0; i < N; i++) {
      const b = this.curv[i] * gain + extraBank[i];
      raw[i] = Math.max(-maxBank, Math.min(maxBank, b));
    }
    this._smooth(raw, this.bank, 12);
  }

  _wrap(i) {
    const N = this.count;
    if (this.closed) return ((i % N) + N) % N;
    return Math.max(0, Math.min(N - 1, i));
  }

  _smooth(src, dst, radius) {
    const N = this.count;
    for (let i = 0; i < N; i++) {
      let sum = 0;
      let w = 0;
      for (let k = -radius; k <= radius; k++) {
        const wk = radius + 1 - Math.abs(k);
        sum += src[this._wrap(i + k)] * wk;
        w += wk;
      }
      dst[i] = sum / w;
    }
  }

  // piecewise-linear interpolation of control-point values by arc position (wraps on loops)
  _ctrlInterpolator(ctrlS, values) {
    const order = ctrlS.map((v, i) => [v, values[i]]).sort((a, b) => a[0] - b[0]);
    const L = this.length;
    if (this.closed) order.push([order[0][0] + L, order[0][1]]);
    return (s) => {
      if (this.closed && s < order[0][0]) s += L;
      if (s <= order[0][0]) return order[0][1];
      for (let i = 0; i < order.length - 1; i++) {
        const [s0, v0] = order[i];
        const [s1, v1] = order[i + 1];
        if (s <= s1) return v0 + ((v1 - v0) * (s - s0)) / Math.max(s1 - s0, 1e-6);
      }
      return order[order.length - 1][1];
    };
  }

  _buildHash() {
    this.hash = new Map();
    for (let i = 0; i < this.count; i++) {
      const k = this._key(Math.floor(this.pos[i * 3] / CELL), Math.floor(this.pos[i * 3 + 2] / CELL));
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(i);
    }
  }

  _key(cx, cz) {
    return cx * 73856093 + cz * 19349663;
  }

  /** Signed shortest along-track distance from s0 to s1 (wraps on loops). */
  delta(s0, s1) {
    let d = s1 - s0;
    if (this.closed) {
      const L = this.length;
      d = ((((d + L / 2) % L) + L) % L) - L / 2;
    }
    return d;
  }

  /**
   * Nearest point on the centreline. Pass the previous result's index as `hint` to search
   * locally (fast, and never jumps to a different part of the track that happens to be close).
   * Returns a shared object: { index, s, lateral, dist, y, found }.
   */
  nearest(x, z, hint = -1, out = this._near || (this._near = {}), maxRing = 3) {
    let best = -1;
    let bestD = Infinity;
    const test = (i) => {
      const dx = x - this.pos[i * 3];
      const dz = z - this.pos[i * 3 + 2];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (hint >= 0) {
      for (let k = -40; k <= 40; k++) test(this._wrap(hint + k));
    }
    if (best < 0 || bestD > 50 * 50) {
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      // expand square rings of cells until nothing in the next ring could be closer
      for (let r = 0; r <= maxRing; r++) {
        for (let i = -r; i <= r; i++) {
          for (let j = -r; j <= r; j++) {
            if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
            const cell = this.hash.get(this._key(cx + i, cz + j));
            if (cell) for (const idx of cell) test(idx);
          }
        }
        if (best >= 0 && bestD <= (r * CELL) ** 2) break;
      }
    }
    out.found = best >= 0;
    if (best < 0) {
      out.index = 0;
      out.s = 0;
      out.lateral = 0;
      out.dist = Infinity;
      out.y = 0;
      return out;
    }
    // refine: project onto the segment toward the closer neighbour
    const i0 = best;
    const tx = this.tan[i0 * 2];
    const tz = this.tan[i0 * 2 + 1];
    const dx = x - this.pos[i0 * 3];
    const dz = z - this.pos[i0 * 3 + 2];
    let along = dx * tx + dz * tz;
    along = Math.max(-this.step, Math.min(this.step, along));
    const lateral = dx * -tz + dz * tx; // right = (-tz, tx) in x/z (tangent × up)
    out.index = i0;
    out.s = ((i0 * this.step + along) % this.length + this.length) % this.length;
    out.lateral = lateral;
    out.dist = Math.abs(lateral);
    const j = this._wrap(i0 + (along >= 0 ? 1 : -1));
    const f = Math.abs(along) / this.step;
    out.y = this.pos[i0 * 3 + 1] * (1 - f) + this.pos[j * 3 + 1] * f;
    return out;
  }

  /** Height of the "formation" (road surface, continued flat past the edges) at sample i. */
  heightAt(i, lateral) {
    const h = this.half[i];
    const l = Math.max(-h, Math.min(h, lateral));
    return this.pos[i * 3 + 1] - l * Math.sin(this.bank[i]);
  }

  /** World x/z of the point at sample i, lateral offset l. */
  pointAt(i, l, out) {
    const tx = this.tan[i * 2];
    const tz = this.tan[i * 2 + 1];
    out.x = this.pos[i * 3] - tz * l;
    out.z = this.pos[i * 3 + 2] + tx * l;
    out.y = this.heightAt(i, l);
    return out;
  }

  indexAtS(s) {
    const L = this.length;
    const ss = this.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
    return this._wrap(Math.round(ss / this.step));
  }

  wrap(i) {
    return this._wrap(i);
  }
}
