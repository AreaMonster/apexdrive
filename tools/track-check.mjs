// Geometry sanity check for spline tracks: length, tightest corner, banking, elevation and grade,
// and the closest approach between parts of the track that are far apart along it (barriers
// overlap if this gets below ~2× the barrier offset). `--plot` draws each layout as ASCII.
import { TrackSpline } from '../src/maps/TrackSpline.js';
import { MAPS } from '../src/data/maps/index.js';

const plot = process.argv.includes('--plot');
const only = process.argv.find((a) => a.startsWith('--map='))?.slice(6);

function ascii(t) {
  const W = 90;
  const H = 36;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < t.count; i++) {
    minX = Math.min(minX, t.pos[i * 3]);
    maxX = Math.max(maxX, t.pos[i * 3]);
    minZ = Math.min(minZ, t.pos[i * 3 + 2]);
    maxZ = Math.max(maxZ, t.pos[i * 3 + 2]);
  }
  const g = Array.from({ length: H }, () => Array(W).fill(' '));
  for (let i = 0; i < t.count; i++) {
    const c = Math.round(((t.pos[i * 3] - minX) / (maxX - minX || 1)) * (W - 1));
    const r = Math.round(((t.pos[i * 3 + 2] - minZ) / (maxZ - minZ || 1)) * (H - 1));
    const k = Math.abs(t.curv[i]);
    g[r][c] = i < 5 ? 'S' : i > t.count - 5 && !t.closed ? 'F' : k > 1 / 40 ? '#' : k > 1 / 100 ? '+' : '.';
  }
  return g.map((row) => row.join('')).join('\n');
}

let failed = false;
for (const m of MAPS.filter((m) => m.track && (!only || m.id === only))) {
  const t = new TrackSpline(m.track);
  let maxK = 0;
  let maxKs = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxBank = 0;
  let maxGrade = 0;
  for (let i = 0; i < t.count; i++) {
    if (Math.abs(t.curv[i]) > maxK) {
      maxK = Math.abs(t.curv[i]);
      maxKs = i * t.step;
    }
    minY = Math.min(minY, t.pos[i * 3 + 1]);
    maxY = Math.max(maxY, t.pos[i * 3 + 1]);
    maxBank = Math.max(maxBank, Math.abs(t.bank[i]));
    maxGrade = Math.max(maxGrade, Math.abs(t.grade[i]));
  }
  // closest approach between samples more than 150 m apart along the track
  let close = Infinity;
  let at = null;
  for (let i = 0; i < t.count; i += 2) {
    for (let j = i + 2; j < t.count; j += 2) {
      if (Math.abs(t.delta(i * t.step, j * t.step)) < 150) continue;
      const d = Math.hypot(t.pos[i * 3] - t.pos[j * 3], t.pos[i * 3 + 2] - t.pos[j * 3 + 2]);
      if (d < close) {
        close = d;
        at = [Math.round(i * t.step), Math.round(j * t.step)];
      }
    }
  }
  const half = (m.track.width ?? 10) / 2 + (m.track.runoff ?? 8);
  const ok = close > 2 * half + 6;
  if (!ok) failed = true;
  console.log(m.id.padEnd(16), {
    closed: t.closed,
    lengthM: Math.round(t.length),
    tightestRadiusM: Math.round(1 / maxK),
    atS: Math.round(maxKs),
    elevation: [minY.toFixed(1), maxY.toFixed(1)],
    maxBankDeg: ((maxBank * 180) / Math.PI).toFixed(1),
    maxGradePct: (maxGrade * 100).toFixed(1),
    closestApproachM: Math.round(close),
    between: at,
    ok,
  });
  if (plot) console.log(ascii(t) + '\n');
}
process.exitCode = failed ? 1 : 0;
