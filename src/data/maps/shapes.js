// Helpers for writing track centrelines as data.

const DEG = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Turtle-graphics track: drive commands from a start pose and drop a control point every few
 * metres. Heading 0 = -Z (the game's "north"); positive turns are to the left.
 *   ['s', length, dy]                     straight, climbing dy metres
 *   ['r' | 'l', degrees, radius, dy]      constant-radius bend
 *   ['crest', length, height, dy]         straight with a smooth hump (rally jumps)
 *   ['mark', name]                        remember the distance travelled so far
 * Returns { points: [[x, z, y], …], length, marks: { name: metres } }.
 */
export function turtle(start, cmds, { step = 15 } = {}) {
  let x = start.x ?? 0;
  let z = start.z ?? 0;
  let y = start.y ?? 0;
  let yaw = (start.heading ?? 0) * DEG;
  let dist = 0;
  const points = [[r1(x), r1(z), r1(y)]];
  const marks = {};
  for (const c of cmds) {
    const [op] = c;
    if (op === 'mark') {
      marks[c[1]] = dist;
    } else if (op === 's' || op === 'crest') {
      const len = c[1];
      const crest = op === 'crest';
      const dy = (crest ? c[3] : c[2]) ?? 0;
      const h = crest ? c[2] : 0;
      // crests need fine sampling so the spline keeps their shape
      const n = Math.max(1, Math.round(len / (crest ? 5 : step)));
      const y0 = y;
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        x -= (Math.sin(yaw) * len) / n;
        z -= (Math.cos(yaw) * len) / n;
        // raised-cosine hump: level at both ends (no kink to drive into), steepest mid-flank
        points.push([r1(x), r1(z), r1(y0 + dy * f + (h * (1 - Math.cos(2 * Math.PI * f))) / 2)]);
      }
      y = y0 + dy;
      dist += len;
    } else {
      const dir = op === 'l' ? 1 : -1;
      const angle = c[1] * DEG;
      const radius = c[2];
      const dy = c[3] ?? 0;
      const arc = angle * radius;
      const n = Math.max(2, Math.ceil(arc / Math.min(step, radius * 0.6)));
      const da = angle / n;
      const chord = 2 * radius * Math.sin(da / 2);
      for (let k = 1; k <= n; k++) {
        const mid = yaw + (dir * da) / 2;
        x -= Math.sin(mid) * chord;
        z -= Math.cos(mid) * chord;
        yaw += dir * da;
        y += dy / n;
        points.push([r1(x), r1(z), r1(y)]);
      }
      dist += arc;
    }
  }
  return { points, length: dist, marks };
}

/**
 * Closed loop through polygon corners, each rounded with three control points (in, apex, out),
 * so the spline makes a tight corner of roughly `radius` instead of a lazy curve.
 * The start line is the middle of the first edge, driving toward corners[1].
 * corners: [[x, z, y?], …]
 */
export function roundedLoop(corners, radius) {
  const n = corners.length;
  const P = corners.map(([x, z, y = 0]) => ({ x, z, y }));
  const unit = (a, b) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    return { x: dx / l, z: dz / l, len: l };
  };
  const out = [];
  const a = P[0];
  const b = P[1];
  out.push([r1((a.x + b.x) / 2), r1((a.z + b.z) / 2), r1((a.y + b.y) / 2)]);
  for (let k = 1; k <= n; k++) {
    const p = P[k % n];
    const din = unit(P[k - 1], p);
    const dout = unit(p, P[(k + 1) % n]);
    const r = Math.min(radius, din.len * 0.4, dout.len * 0.4);
    out.push([r1(p.x - din.x * r), r1(p.z - din.z * r), r1(p.y)]);
    out.push([r1(p.x + (dout.x - din.x) * r * 0.3), r1(p.z + (dout.z - din.z) * r * 0.3), r1(p.y)]);
    out.push([r1(p.x + dout.x * r), r1(p.z + dout.z * r), r1(p.y)]);
    if (k === n) break;
    // mid-edge point keeps long straights straight
    const q = P[(k + 1) % n];
    if (dout.len > radius * 3) out.push([r1((p.x + q.x) / 2), r1((p.z + q.z) / 2), r1((p.y + q.y) / 2)]);
  }
  return out;
}

/** Island landform shared by the terrain builder and maps that place things on it. */
export function islandHeight(x, z, { radius, height, center = [0, 0] }) {
  const r = Math.hypot(x - center[0], z - center[1]);
  const ss = (a, b, v) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // plateau in the middle, beaches at the rim, sea floor beyond
  return height * Math.pow(1 - ss(radius * 0.15, radius, r), 1.3) - 22 * ss(radius * 0.92, radius * 1.25, r) + 1.5;
}

/** Deterministic pseudo-random generator for data files. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A continuous wall of container stacks around a rectangle (props for data/maps). */
export function containerRing(x0, x1, z0, z1, stack = 2) {
  const props = [];
  const len = 12.4;
  const row = (ax, az, bx, bz, yaw) => {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / (len * 4)); // rows overlap slightly so the wall has no gaps
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      props.push({ type: 'containers', x: ax + (bx - ax) * f, z: az + (bz - az) * f, yaw, count: 4, stack });
    }
  };
  row(x0, z0, x1, z0, 0);
  row(x0, z1, x1, z1, 0);
  row(x0, z0, x0, z1, Math.PI / 2);
  row(x1, z0, x1, z1, Math.PI / 2);
  return props;
}
