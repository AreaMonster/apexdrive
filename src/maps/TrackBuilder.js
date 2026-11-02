import * as THREE from 'three';
import { Textures } from './textures.js';
import { makeNoise2D, smoothstep } from './noise.js';
import { islandHeight } from '../data/maps/shapes.js';
import { terrainMaterial, roadWear, groundVariation, waterMaterial } from './Nature.js';

export const KERB_W = 1.2;

const _p = { x: 0, y: 0, z: 0 };

/**
 * Ribbon along consecutive track samples. `cols(i)` returns [[lateral, dy], ...] with laterals in
 * ascending order (left → right), the same count for every row; triangles then face up.
 * Returns the render geometry plus raw arrays for a physics trimesh.
 */
export function ribbon(track, idx, cols, uv = (l, s) => [l / 6, s / 6]) {
  const rows = idx.length;
  const nc = cols(idx[0]).length;
  const positions = new Float32Array(rows * nc * 3);
  const uvs = new Float32Array(rows * nc * 2);
  let s = 0;
  for (let r = 0; r < rows; r++) {
    const i = idx[r];
    if (r > 0) s += track.step;
    const c = cols(i);
    for (let k = 0; k < nc; k++) {
      const [l, dy] = c[k];
      track.pointAt(i, l, _p);
      const o = r * nc + k;
      positions[o * 3] = _p.x;
      positions[o * 3 + 1] = _p.y + dy;
      positions[o * 3 + 2] = _p.z;
      const [u, v] = uv(l, s, k, nc);
      uvs[o * 2] = u;
      uvs[o * 2 + 1] = v;
    }
  }
  const index = new Uint32Array((rows - 1) * (nc - 1) * 6);
  let n = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < nc - 1; k++) {
      const a = r * nc + k;
      const b = a + 1;
      const c = a + nc;
      const d = c + 1;
      index.set([a, b, c, b, d, c], n);
      n += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  return { geometry, positions, index };
}

/** All sample indices in driving order (closed: repeats sample 0 at the end so UVs don't wrap). */
export function loopIdx(track) {
  const idx = Array.from({ length: track.count }, (_, i) => i);
  if (track.closed) idx.push(0);
  return idx;
}

/** Contiguous runs of set flags as index arrays (handles wrap-around on loops). */
export function runs(track, flags) {
  const N = track.count;
  const out = [];
  if (flags.every((f) => f)) return [loopIdx(track)];
  let start = 0;
  if (track.closed) while (flags[start]) start++; // begin outside a run so wrapped runs stay whole
  let cur = null;
  for (let k = 0; k < N; k++) {
    const i = (start + k) % N;
    if (flags[i]) (cur || (cur = [])).push(i);
    else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function dilate(track, flags, back, fwd) {
  const out = new Uint8Array(flags.length);
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i]) continue;
    for (let k = -back; k <= fwd; k++) out[track.wrap(i + k)] = 1;
  }
  return out;
}

function dropShort(track, flags, min) {
  for (const run of runs(track, flags)) if (run.length < min) for (const i of run) flags[i] = 0;
  return flags;
}

/** A range given as { f: [a, b] } (fractions of the track) or { from, to } (metres) → [s0, s1]. */
export function rangeS(track, r) {
  if (r.f) return [r.f[0] * track.length, r.f[1] * track.length];
  return [r.from, r.to];
}

function inRange(track, s, s0, s1) {
  if (!track.closed) return s >= s0 && s <= s1;
  const L = track.length;
  return (((s - s0) % L) + L) % L <= s1 - s0;
}

/** Barrier style for a side: def.track.barrier is a style name or { L, R }. */
function barrierStyle(t, side) {
  const b = t.barrier ?? 'concrete';
  return typeof b === 'string' ? b : b[side] ?? 'concrete';
}

/**
 * Per-sample layout: kerbs, gravel traps, barrier offsets and styles, pit lane, tunnels and
 * surface patches. Everything that later decides geometry and surfaces lives here.
 */
export function computeLayout(track, def) {
  const t = def.track;
  const N = track.count;
  const L = track.length;
  const kerb = { L: new Uint8Array(N), R: new Uint8Array(N) };
  const gravel = { L: new Uint8Array(N), R: new Uint8Array(N) };
  const kerbsOn = t.kerbs !== false;
  for (let i = 0; i < N; i++) {
    const k = track.curv[i];
    const a = Math.abs(k);
    const inner = k > 0 ? 'R' : 'L';
    const outer = k > 0 ? 'L' : 'R';
    if (kerbsOn && a > 1 / 180) kerb[inner][i] = 1;
    if (kerbsOn && a > 1 / 70) kerb[outer][i] = 1;
    if (t.gravelRadius && a > 1 / t.gravelRadius) gravel[outer][i] = 1;
  }
  for (const side of ['L', 'R']) {
    kerb[side] = dropShort(track, dilate(track, kerb[side], 6, 6), 10);
    gravel[side] = dropShort(track, dilate(track, gravel[side], 6, 20), 12);
  }

  // pit lane: lateral centre per sample (0 = none) and a 0..1 blend from merge to full offset
  const pit = def.pit;
  const pitCenter = new Float32Array(N);
  const pitBlend = new Float32Array(N);
  if (pit) {
    const sign = pit.side === 'left' ? -1 : 1;
    const total = pit.to - pit.from + 2 * pit.taper;
    for (let i = 0; i < N; i++) {
      const rel = (((i * track.step - (pit.from - pit.taper)) % L) + L) % L;
      if (rel > total) continue;
      const blend = smoothstep(0, pit.taper, rel) * (1 - smoothstep(total - pit.taper, total, rel));
      const merge = track.half[i] - 2.5 + pit.width / 2;
      pitCenter[i] = sign * (merge + (pit.offset - merge) * blend);
      pitBlend[i] = blend;
      const side = sign < 0 ? 'L' : 'R';
      kerb[side][i] = 0;
      gravel[side][i] = 0;
    }
  }

  // tunnels
  const tunnel = new Uint8Array(N);
  for (const r of t.tunnels || []) {
    const [s0, s1] = rangeS(track, r);
    for (let i = 0; i < N; i++) if (inRange(track, i * track.step, s0, s1)) tunnel[i] = 1;
  }

  // barrier offsets: wide where there is gravel, pushed out around the pit lane, then smoothed
  // (running max, then average) so walls flow instead of zig-zagging
  const gravelW = t.gravelWidth ?? 15;
  const runoff = t.runoff ?? 8;
  const barrier = { L: new Float32Array(N), R: new Float32Array(N) };
  for (const side of ['L', 'R']) {
    const raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let b = track.half[i] + (kerb[side][i] ? KERB_W : 0) + runoff;
      if (gravel[side][i]) b = Math.max(b, track.half[i] + KERB_W + gravelW + 2);
      if (pitCenter[i] && (pitCenter[i] < 0) === (side === 'L')) b = Math.max(b, Math.abs(pitCenter[i]) + pit.width / 2 + 4);
      raw[i] = b;
    }
    const mx = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -12; k <= 12; k++) m = Math.max(m, raw[track.wrap(i + k)]);
      mx[i] = m;
    }
    const out = barrier[side];
    for (let i = 0; i < N; i++) {
      let sum = 0;
      for (let k = -12; k <= 12; k++) sum += mx[track.wrap(i + k)];
      let b = sum / 25;
      // on the inside of a bend the wall must stay well inside the radius or it folds over itself
      const k = track.curv[i];
      const isInner = (k > 0) === (side === 'R');
      if (isInner && Math.abs(k) > 1e-4) b = Math.min(b, Math.max(track.half[i] + 1.5, 0.6 / Math.abs(k)));
      out[i] = b;
    }
  }

  const patches = (t.patches || []).map((p) => {
    const [s0, s1] = rangeS(track, p);
    const [l0, l1] = p.lat || [-1, 1];
    return { s0, s1, l0, l1, surface: p.surface };
  });

  return {
    kerb,
    gravel,
    gravelW,
    barrier,
    style: { L: barrierStyle(t, 'L'), R: barrierStyle(t, 'R') },
    pitCenter,
    pitBlend,
    tunnel,
    patches,
    roadSurface: t.surface || 'asphalt',
    runoffSurface: t.runoffSurface || def.terrain?.surface || def.ground?.surface || 'grass',
    flat: def.ground?.type === 'flat',
  };
}

/** Surface at a point projected onto the track (q = track.nearest result). */
export function layoutSurface(track, layout, q) {
  const i = q.index;
  const h = track.half[i];
  const side = q.lateral < 0 ? 'L' : 'R';
  if (q.dist <= h) {
    for (const p of layout.patches) {
      const f = q.lateral / h;
      if (f >= p.l0 && f <= p.l1 && inRange(track, q.s, p.s0, p.s1)) return p.surface;
    }
    return layout.roadSurface;
  }
  if (layout.pitCenter[i] && Math.abs(q.lateral - layout.pitCenter[i]) < 5) return 'asphalt';
  if (layout.kerb[side][i] && q.dist <= h + KERB_W) return 'kerb';
  if (layout.gravel[side][i] && q.dist <= h + KERB_W + layout.gravelW + 0.4) return 'gravel';
  return layout.runoffSurface;
}

function mesh(geometry, material, { shadow = false, cast = false } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.receiveShadow = shadow;
  m.castShadow = cast;
  return m;
}

const overlay = (props) =>
  new THREE.MeshStandardMaterial({ polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, ...props });

// How each surface looks: texture, tint, roughness, texture scale (m per repeat).
const SURFACE_LOOK = {
  asphalt: { tex: 'asphalt', color: 0xffffff, rough: 0.88, tile: 6 },
  wet: { tex: 'wet', color: 0xffffff, rough: 0.15, tile: 6 },
  dirt: { tex: 'dirt', color: 0xffffff, rough: 1, tile: 5 },
  gravel: { tex: 'dirt', color: 0xd9cbb0, rough: 1, tile: 4 },
  mud: { tex: 'mud', color: 0xffffff, rough: 0.55, tile: 5 },
  sand: { tex: 'sand', color: 0xd8b48a, rough: 1, tile: 5 },
  snow: { tex: 'snow', color: 0xffffff, rough: 0.8, tile: 5 },
  ice: { tex: 'ice', color: 0xffffff, rough: 0.12, tile: 10 },
  lakeice: { tex: 'ice', color: 0xe8f2f8, rough: 0.2, tile: 10 },
  grass: { tex: 'detail', color: 0x6f9a48, rough: 0.95, tile: 8 },
  kerb: { tex: 'kerb', color: 0xffffff, rough: 0.6, tile: 2 },
};

/** Material for a surface; remembers its base colour/roughness so weather can modify it. */
const VARIED = new Set(['grass', 'dirt', 'gravel', 'sand', 'snow', 'mud']);

function surfaceMaterial(surface, extra = {}) {
  const look = SURFACE_LOOK[surface] || SURFACE_LOOK.asphalt;
  const mat = new THREE.MeshStandardMaterial({ map: Textures[look.tex](), color: look.color, roughness: look.rough, ...extra });
  mat.userData.base = { color: mat.color.clone(), roughness: mat.roughness };
  if (VARIED.has(surface)) groundVariation(mat, { amount: surface === 'grass' ? 1 : 0.6 });
  return mat;
}

/**
 * Builds road, run-off, kerbs, lines, barriers, pit lane, tunnels and (for flat maps) the ground.
 * Returns the materials weather should affect: { road: [], ground: [] }.
 */
export function buildTrackSurfaces(track, def, layout, physics, group, startIndex, finishIndex) {
  const lay = layout;
  const t = def.track;
  const full = loopIdx(track);
  const mats = { road: [], ground: [] };
  const lift = lay.flat ? 0.03 : 0;

  // road: one collider; if there are patches the surface is resolved per point
  const roadLook = SURFACE_LOOK[lay.roadSurface] || SURFACE_LOOK.asphalt;
  const ROAD_COLS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  const road = ribbon(
    track,
    full,
    (i) => ROAD_COLS.map((f) => [f * track.half[i], lift]),
    (l, s) => [l / roadLook.tile, s / roadLook.tile],
  );
  const latAttr = new Float32Array(road.positions.length / 3);
  for (let v = 0; v < latAttr.length; v++) latAttr[v] = ROAD_COLS[v % ROAD_COLS.length];
  road.geometry.setAttribute('lat', new THREE.BufferAttribute(latAttr, 1));
  const roadMat = surfaceMaterial(lay.roadSurface, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  if (lay.roadSurface === 'asphalt' || lay.roadSurface === 'wet') roadWear(roadMat, track.closed && t.kerbs !== false ? 'circuit' : 'road');
  mats.road.push(roadMat);
  group.add(mesh(road.geometry, roadMat, { shadow: true }));
  physics.addTrimesh(road.positions, road.index, { surface: lay.patches.length ? 'auto' : lay.roadSurface });

  // surface patches (snow, mud …) painted over the road
  for (const p of lay.patches) {
    const flags = new Uint8Array(track.count);
    for (let i = 0; i < track.count; i++) if (inRange(track, i * track.step, p.s0, p.s1)) flags[i] = 1;
    const look = SURFACE_LOOK[p.surface] || SURFACE_LOOK.asphalt;
    const pmat = surfaceMaterial(p.surface, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
    mats.ground.push(pmat);
    for (const run of runs(track, flags)) {
      if (run.length < 2) continue;
      const g = ribbon(
        track,
        run,
        (i) => [[p.l0 * track.half[i], lift + 0.008], [p.l1 * track.half[i], lift + 0.008]],
        (l, s) => [l / look.tile, s / look.tile],
      );
      group.add(mesh(g.geometry, pmat, { shadow: true }));
    }
  }

  // run-off aprons from the road edge to just past the barrier (surface resolved per point)
  if (!lay.flat) {
    const apronMat = surfaceMaterial(lay.runoffSurface);
    mats.ground.push(apronMat);
    const tile = (SURFACE_LOOK[lay.runoffSurface] || SURFACE_LOOK.grass).tile;
    for (const side of ['L', 'R']) {
      const sg = side === 'L' ? -1 : 1;
      const open = lay.style[side] === 'none';
      const apron = ribbon(
        track,
        full,
        (i) => {
          const h = track.half[i];
          const b = lay.barrier[side][i] + (open ? 0 : 3);
          const c = [[sg * h, 0], [sg * (h + b) / 2, 0], [sg * b, 0], [sg * (b + 1.5), open ? -0.12 : -0.6]];
          return sg < 0 ? c.reverse() : c;
        },
        (l, s) => [l / tile, s / tile],
      );
      group.add(mesh(apron.geometry, apronMat, { shadow: true }));
      physics.addTrimesh(apron.positions, apron.index, { surface: 'auto' });
    }
  }

  // gravel traps (visual; the surface comes from surfaceAt)
  const gravelMat = overlay({ map: Textures.dirt(), roughness: 1, color: 0xd9cbb0 });
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? -1 : 1;
    for (const run of runs(track, lay.gravel[side])) {
      const g = ribbon(
        track,
        run,
        (i) => {
          const h = track.half[i] + 0.4;
          const c = [[sg * h, 0.01], [sg * (h + KERB_W + lay.gravelW), 0.01]];
          return sg < 0 ? c.reverse() : c;
        },
        (l, s) => [l / 4, s / 4],
      );
      group.add(mesh(g.geometry, gravelMat, { shadow: true }));
    }
  }

  // kerbs: slightly humped strips with their own collider
  const kerbMat = overlay({ map: Textures.kerb(), roughness: 0.6 });
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? -1 : 1;
    for (const run of runs(track, lay.kerb[side])) {
      if (run.length < 2) continue;
      const k = ribbon(
        track,
        run,
        (i) => {
          const h = track.half[i];
          const c = [[sg * (h - 0.15), lift + 0.005], [sg * (h + 0.45), lift + 0.04], [sg * (h + KERB_W), lift + 0.01]];
          return sg < 0 ? c.reverse() : c;
        },
        (l, s) => [0.5, s / 2],
      );
      group.add(mesh(k.geometry, kerbMat, { shadow: true }));
      physics.addTrimesh(k.positions, k.index, { surface: 'kerb' });
    }
  }

  buildLines(track, t.lines ?? 'edge', lift, group, full);

  // start (and, on point-to-point stages, finish) line
  const checker = overlay({ map: Textures.checker(), roughness: 0.7, polygonOffsetFactor: -3, polygonOffsetUnits: -4 });
  for (const i of finishIndex !== startIndex ? [startIndex, finishIndex] : [startIndex]) {
    const line = ribbon(track, [track.wrap(i - 1), i], (j) => [[-track.half[j], lift + 0.012], [track.half[j], lift + 0.012]], (l, s, k) => [k * 8, s / 2]);
    group.add(mesh(line.geometry, checker));
  }

  buildBarriers(track, lay, physics, group, full, mats);
  if (def.pit) buildPit(track, def, lay, physics, group);
  buildTunnels(track, lay, group);

  if (lay.flat) {
    const g = def.ground;
    const look = SURFACE_LOOK[g.surface] || SURFACE_LOOK.asphalt;
    const size = g.size ?? 3000;
    const tex = Textures[g.texture || look.tex]().clone();
    tex.userData.shared = false;
    tex.repeat.set(size / (g.tile ?? 10), size / (g.tile ?? 10));
    tex.needsUpdate = true;
    const gm = new THREE.MeshStandardMaterial({ map: tex, color: g.color ?? look.color, roughness: g.roughness ?? look.rough });
    gm.userData.base = { color: gm.color.clone(), roughness: gm.roughness };
    mats.ground.push(gm);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), gm);
    plane.rotation.x = -Math.PI / 2;
    const c = g.center || [0, 0];
    plane.position.set(c[0], 0, c[1]);
    plane.receiveShadow = true;
    group.add(plane);
    physics.addBox({ x: c[0], y: -1, z: c[1] }, { x: size / 2, y: 1, z: size / 2 }, { surface: 'auto' });
  }
  return mats;
}

function buildLines(track, style, lift, group, full) {
  if (style === 'none') return;
  const white = overlay({ color: 0xe9e9e2, roughness: 0.7 });
  if (style === 'edge' || style === 'highway') {
    for (const sg of [-1, 1]) {
      const line = ribbon(track, full, (i) => {
        const h = track.half[i];
        const c = [[sg * (h - 0.55), lift + 0.004], [sg * (h - 0.3), lift + 0.004]];
        return sg < 0 ? c.reverse() : c;
      });
      group.add(mesh(line.geometry, white, { shadow: true }));
    }
  }
  if (style === 'highway' || style === 'centre') {
    // dashed centre line: 6 m paint, 6 m gap
    const flags = new Uint8Array(track.count);
    for (let i = 0; i < track.count; i++) flags[i] = Math.floor((i * track.step) / 6) % 2 === 0 ? 1 : 0;
    const mat = style === 'centre' ? overlay({ color: 0xf2c230, roughness: 0.7 }) : white;
    for (const run of runs(track, flags)) {
      if (run.length < 2) continue;
      const d = ribbon(track, run, () => [[-0.08, lift + 0.004], [0.08, lift + 0.004]]);
      group.add(mesh(d.geometry, mat, { shadow: true }));
    }
  }
}

// Barrier cross-sections (lateral offset from the barrier line, height). Listed for the right side;
// the left side is mirrored.
const BARRIER = {
  concrete: { cols: [[0, -0.4], [0, 1.05], [0.5, 1.05], [0.5, -0.4]], uv: [0, 0.55, 0.62, 1] },
  snowbank: { cols: [[-0.4, -0.25], [-0.1, 0.4], [0.4, 0.75], [0.9, 0.5], [1.3, -0.25]] },
  // armco collides like a thin wall; its visible rail and posts are separate
  armco: { cols: [[0, -0.3], [0, 0.85], [0.15, 0.85], [0.15, -0.3]], invisible: true },
};

function buildBarriers(track, lay, physics, group, full, mats) {
  const wallMat = new THREE.MeshStandardMaterial({ map: Textures.wall(), roughness: 0.8 });
  const snowMat = new THREE.MeshStandardMaterial({ map: Textures.snow(), color: 0xf4f7fb, roughness: 0.85 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc4cad0, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide });
  for (const side of ['L', 'R']) {
    const style = lay.style[side];
    if (style === 'none' || !BARRIER[style]) continue;
    const sg = side === 'L' ? -1 : 1;
    const spec = BARRIER[style];
    const n = spec.cols.length;
    const wall = ribbon(
      track,
      full,
      (i) => {
        const b = lay.barrier[side][i];
        const c = spec.cols.map(([dl, dy]) => [sg * (b + dl), dy]);
        return sg < 0 ? c.reverse() : c;
      },
      (l, s, k) => [s / 6, spec.uv ? spec.uv[sg < 0 ? n - 1 - k : k] : k / (n - 1)],
    );
    physics.addTrimesh(wall.positions, wall.index, { surface: style === 'snowbank' ? 'snow' : 'asphalt', friction: style === 'snowbank' ? 0.6 : 0.25 });
    if (!spec.invisible) {
      group.add(mesh(wall.geometry, style === 'snowbank' ? snowMat : wallMat, { shadow: true, cast: true }));
      continue;
    }
    // armco: a W-beam rail on posts every 4 m
    wall.geometry.dispose();
    const rail = ribbon(track, full, (i) => {
      const b = lay.barrier[side][i];
      const c = [[sg * b, 0.42], [sg * (b - 0.05), 0.6], [sg * b, 0.78]];
      return sg < 0 ? c.reverse() : c;
    });
    group.add(mesh(rail.geometry, railMat, { shadow: true, cast: true }));
    const posts = [];
    for (let i = 0; i < track.count; i += 2) posts.push(i);
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.9, 0.12).translate(0, 0.35, 0), railMat, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((i, k) => {
      track.pointAt(i, sg * (lay.barrier[side][i] + 0.12), _p);
      m.makeTranslation(_p.x, _p.y, _p.z);
      inst.setMatrixAt(k, m);
    });
    inst.castShadow = true;
    group.add(inst);
  }
  mats.ground.push(snowMat);
  snowMat.userData.base = { color: snowMat.color.clone(), roughness: snowMat.roughness };
}

function buildPit(track, def, lay, physics, group) {
  const wallMat = new THREE.MeshStandardMaterial({ map: Textures.wall(), roughness: 0.8 });
  const wallUV = (l, s, k) => [s / 6, [0, 0.55, 0.62, 1][k]];
  const pitFlags = lay.pitCenter.map((c) => (c !== 0 ? 1 : 0));
  const pw = def.pit.width / 2;
  for (const run of runs(track, pitFlags)) {
    const lane = ribbon(track, run, (i) => {
      const c = lay.pitCenter[i];
      return [[c - pw, 0.015], [c, 0.015], [c + pw, 0.015]];
    });
    group.add(mesh(lane.geometry, overlay({ map: Textures.asphalt(), roughness: 0.85, color: 0xcfcfcf }), { shadow: true }));
    physics.addTrimesh(lane.positions, lane.index, { surface: 'asphalt' });
  }
  const wallFlags = lay.pitBlend.map((b) => (b > 0.97 ? 1 : 0));
  for (const run of runs(track, wallFlags)) {
    const sg = def.pit.side === 'left' ? -1 : 1;
    const w = ribbon(
      track,
      run,
      (i) => {
        const m = (track.half[i] + Math.abs(lay.pitCenter[i]) - pw) / 2;
        const c = [[sg * (m - 0.3), -0.3], [sg * (m - 0.3), 1.0], [sg * (m + 0.3), 1.0], [sg * (m + 0.3), -0.3]];
        return sg < 0 ? c.reverse() : c;
      },
      sg < 0 ? (l, s, k) => wallUV(l, s, 3 - k) : wallUV,
    );
    group.add(mesh(w.geometry, wallMat, { shadow: true, cast: true }));
    physics.addTrimesh(w.positions, w.index, { surface: 'asphalt', friction: 0.25 });
  }
}

/**
 * Tunnels: a concrete tube inside, a rock mass over the top and a portal face at each end that
 * closes the gap between them. The walls themselves are the barriers.
 */
function buildTunnels(track, lay, group) {
  const runsT = runs(track, lay.tunnel);
  if (!runsT.length) return;
  const tubeMat = new THREE.MeshStandardMaterial({ map: Textures.concrete(), color: 0xb0aca4, roughness: 0.9, side: THREE.DoubleSide });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffe2a0, emissiveIntensity: 1.6, side: THREE.DoubleSide });
  const inner = (i) => {
    const bl = lay.barrier.L[i];
    const br = lay.barrier.R[i];
    return [[-bl, -0.3], [-bl, 4.5], [-bl * 0.55, 6.6], [0, 7.2], [br * 0.55, 6.6], [br, 4.5], [br, -0.3]];
  };
  const outer = (i) => {
    const bl = lay.barrier.L[i];
    const br = lay.barrier.R[i];
    return [[-(bl + 30), -2], [-(bl + 12), 8], [-bl * 0.5, 13], [0, 14], [br * 0.5, 13], [br + 12, 8], [br + 30, -2]];
  };
  for (const run of runsT) {
    if (run.length < 3) continue;
    const tube = ribbon(track, run, inner, (l, s, k) => [s / 6, k / 6]);
    group.add(mesh(tube.geometry, tubeMat, { shadow: true, cast: true }));
    const rock = ribbon(track, run, outer, (l, s) => [l / 10, s / 10]);
    group.add(mesh(rock.geometry, rockMat, { shadow: true, cast: true }));
    const strip = ribbon(track, run, () => [[-0.25, 7.1], [0.25, 7.1]]);
    group.add(mesh(strip.geometry, lampMat));
    // portals: the ring between the rock profile and the tube profile, at both ends
    for (const i of [run[0], run[run.length - 1]]) {
      const shape = new THREE.Shape(outer(i).map(([x, y]) => new THREE.Vector2(x, y)));
      shape.holes.push(new THREE.Path(inner(i).map(([x, y]) => new THREE.Vector2(x, y))));
      const geo = new THREE.ShapeGeometry(shape);
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        track.pointAt(i, pos.getX(v), _p);
        pos.setXYZ(v, _p.x, _p.y + pos.getY(v), _p.z);
      }
      geo.computeVertexNormals();
      group.add(mesh(geo, rockMat, { shadow: true, cast: true }));
    }
  }
}

// Terrain colour palettes (vertex colours over a neutral detail texture).
const PALETTES = {
  grass: { low: 0x6f9a48, alt: 0x93984f, slope: 0x7a6a52, rock: 0x8f8a82, verge: 0x8a6c4c, dry: 0xa89a5a },
  forest: { low: 0x4f7438, alt: 0x6b6f3c, slope: 0x5e4e3a, rock: 0x7d776e, verge: 0x6e5438, dry: 0x7d7a48, dryAmount: 0.25 },
  alpine: { low: 0x6d9450, alt: 0x8f9a5c, slope: 0x7d7a74, snow: 0xf2f5f9, rock: 0x8c8984, verge: 0x7a6a58, dry: 0x9c9a62 },
  desert: { low: 0xd9a46a, alt: 0xc98850, slope: 0x9c5236, rock: 0xa0583a, verge: 0xb07a4e, dry: 0xe6bc84, dryAmount: 0.35, vergeAmount: 0.35 },
  coast: { low: 0x6e9a4c, alt: 0x9a9a58, slope: 0x857c70, beach: 0xe2cfa0, rock: 0x8a8276, verge: 0x9c8460, dry: 0xb2a468 },
  island: { low: 0x5f9a42, alt: 0x86a050, slope: 0x7f7464, beach: 0xeedcae, rock: 0x857a6a, verge: 0xb09a6e, dry: 0xa8a860 },
  snow: { low: 0xf0f3f8, alt: 0xe2e8f0, slope: 0xa8adb6, rock: 0x9aa0a8, verge: 0xc8d0da, dry: 0xe8ecf2, dryAmount: 0, vergeAmount: 0.3 },
};

/**
 * Landscape around the track. Near the track the ground follows the road formation (sunk a
 * little under the run-off aprons); further away it blends into the map's landform:
 *   base 'idw'    smooth surface through the track's own heights (mountain roads, valleys)
 *   base 'mean'   gentle hills around the track's average height
 *   base 'island' a central island falling to the sea
 * plus fractal noise, optional per-side shaping (canyon walls, cliffs) and a sea plane.
 * Returns { heightAt(x, z), bounds, baseY, seaLevel, setSnow(f) }.
 */
export function buildTerrain(track, def, layout, physics, group) {
  const tdef = def.terrain || {};
  const noise = makeNoise2D(tdef.seed ?? 1);
  const amp = tdef.amplitude ?? 20;
  const sc = tdef.scale ?? 0.003;
  const margin = tdef.margin ?? 400;
  const blend = tdef.blend ?? 70;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumY = 0;
  for (let i = 0; i < track.count; i++) {
    minX = Math.min(minX, track.pos[i * 3]);
    maxX = Math.max(maxX, track.pos[i * 3]);
    minZ = Math.min(minZ, track.pos[i * 3 + 2]);
    maxZ = Math.max(maxZ, track.pos[i * 3 + 2]);
    sumY += track.pos[i * 3 + 1];
  }
  const baseY = sumY / track.count;
  const bounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
  if (tdef.island) {
    const r = tdef.island.radius * 1.35;
    const [cx, cz] = tdef.island.center || [0, 0];
    bounds.minX = Math.min(bounds.minX, cx - r);
    bounds.maxX = Math.max(bounds.maxX, cx + r);
    bounds.minZ = Math.min(bounds.minZ, cz - r);
    bounds.maxZ = Math.max(bounds.maxZ, cz + r);
  }
  const seaLevel = tdef.sea ?? null;
  const base = makeBase(track, tdef, bounds, baseY);
  const near = {};

  const natural = (x, z) => base(x, z) + amp * (noise.fbm(x * sc, z * sc, 5) + 0.25) + 0.25 * amp * noise(x * 0.02, z * 0.02);
  let edgeDist = Infinity; // distance from the road edge of the last heightAt() point
  const heightAt = (x, z) => {
    let nat = natural(x, z);
    const q = track.nearest(x, z, -1, near, 6);
    edgeDist = q.found ? q.dist - track.half[q.index] : Infinity;
    if (!q.found) return nat;
    const side = q.lateral < 0 ? 'L' : 'R';
    const shape = tdef.sides?.[side];
    if (shape) nat += shape.height * smoothstep(shape.start, shape.start + shape.width, q.dist);
    const open = layout.style[side] === 'none';
    const flat = layout.barrier[side][q.index] + (open ? 1.5 : 4);
    // under the run-off apron the ground sits 25 cm low; just outside an open edge only a little
    const sink = q.dist < layout.barrier[side][q.index] + (open ? 0 : 3) ? 0.25 : 0.06;
    const yFlat = track.heightAt(q.index, q.lateral) - sink;
    const t = smoothstep(flat, flat + blend, q.dist);
    return yFlat + (nat - yFlat) * t;
  };

  // grid spacing grows with the area so big maps stay around 90k vertices
  const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ);
  const spacing = Math.max(6, Math.sqrt(area / 90000));
  const nx = Math.ceil((bounds.maxX - bounds.minX) / spacing) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / spacing) + 1;
  const positions = new Float32Array(nx * nz * 3);
  const uvs = new Float32Array(nx * nz * 2);
  const edges = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = bounds.minX + i * spacing;
      const z = bounds.minZ + j * spacing;
      const o = j * nx + i;
      positions[o * 3] = x;
      positions[o * 3 + 1] = heightAt(x, z);
      positions[o * 3 + 2] = z;
      edges[o] = 1 - smoothstep(0, spacing + 5, edgeDist);
      uvs[o * 2] = x / 8;
      uvs[o * 2 + 1] = z / 8;
    }
  }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index.set([a, c, b, b, c, d], n);
      n += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('edge', new THREE.BufferAttribute(edges, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();

  // colours: palette by height/slope/noise, plus a snow-covered variant for winter weather
  const pal = PALETTES[tdef.palette || 'grass'];
  const C = (h) => new THREE.Color(h);
  const low = C(pal.low);
  const alt = C(pal.alt);
  const slope = C(pal.slope);
  const snow = C(pal.snow ?? 0xf2f5f9);
  const beach = pal.beach !== undefined ? C(pal.beach) : null;
  const nrm = geo.attributes.normal;
  const baseCol = new Float32Array(nx * nz * 3);
  const snowCol = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  const cs = new THREE.Color();
  for (let o = 0; o < nx * nz; o++) {
    const x = positions[o * 3];
    const y = positions[o * 3 + 1];
    const z = positions[o * 3 + 2];
    const ny = nrm.getY(o);
    c.copy(low).lerp(alt, smoothstep(-0.2, 0.5, noise(x * 0.008 + 50, z * 0.008)));
    c.lerp(slope, smoothstep(0.93, 0.78, ny));
    if (beach && seaLevel !== null) c.lerp(beach, smoothstep(seaLevel + 4, seaLevel + 1, y));
    if (tdef.snowLine !== undefined) c.lerp(snow, smoothstep(tdef.snowLine, tdef.snowLine + 25, y) * smoothstep(0.55, 0.75, ny));
    baseCol.set([c.r, c.g, c.b], o * 3);
    cs.copy(c).lerp(snow, 0.85 * smoothstep(0.6, 0.8, ny));
    snowCol.set([cs.r, cs.g, cs.b], o * 3);
  }
  const colorAttr = new THREE.BufferAttribute(baseCol.slice(), 3);
  geo.setAttribute('color', colorAttr);
  const material = terrainMaterial({ rock: pal.rock, verge: pal.verge, dry: pal.dry, dryAmount: pal.dryAmount, vergeAmount: pal.vergeAmount, seaLevel });
  group.add(mesh(geo, material, { shadow: true }));
  physics.addTrimesh(positions, index, { surface: tdef.surface || 'grass' });

  if (seaLevel !== null) buildSea(group, seaLevel, bounds);

  const setSnow = (f) => {
    const a = colorAttr.array;
    for (let k = 0; k < a.length; k++) a[k] = baseCol[k] + (snowCol[k] - baseCol[k]) * f;
    colorAttr.needsUpdate = true;
  };
  return { heightAt, bounds, baseY, seaLevel, setSnow, material };
}

/** Landform before noise: see buildTerrain. */
function makeBase(track, tdef, bounds, baseY) {
  const kind = tdef.base || (tdef.island ? 'island' : 'idw');
  if (kind === 'mean') return () => baseY - 2;
  if (kind === 'island') return (x, z) => islandHeight(x, z, tdef.island);
  // 'idw': inverse-distance-weighted surface through track heights, precomputed on a coarse grid
  // and sampled bilinearly. Between switchbacks this produces the mountainside they climb.
  const pts = [];
  const stride = Math.max(1, Math.round(20 / track.step));
  for (let i = 0; i < track.count; i += stride) pts.push([track.pos[i * 3], track.pos[i * 3 + 2], track.pos[i * 3 + 1]]);
  const cell = 40;
  const gx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 2;
  const gz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 2;
  const grid = new Float32Array(gx * gz);
  for (let j = 0; j < gz; j++) {
    for (let i = 0; i < gx; i++) {
      const x = bounds.minX + i * cell;
      const z = bounds.minZ + j * cell;
      let ws = 0;
      let hs = 0;
      for (const [px, pz, py] of pts) {
        const d2 = (x - px) ** 2 + (z - pz) ** 2 + 900;
        const w = 1 / (d2 * d2); // power 4: dominated by the nearest stretch of road
        ws += w;
        hs += w * py;
      }
      grid[j * gx + i] = hs / ws - 2;
    }
  }
  return (x, z) => {
    const fx = Math.min(gx - 1.001, Math.max(0, (x - bounds.minX) / cell));
    const fz = Math.min(gz - 1.001, Math.max(0, (z - bounds.minZ) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = grid[j * gx + i];
    const b = grid[j * gx + i + 1];
    const c = grid[(j + 1) * gx + i];
    const d = grid[(j + 1) * gx + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  };
}

function buildSea(group, level, bounds) {
  const size = 14000;
  const mat = waterMaterial(0x1d5a7a);
  mat.normalMap.repeat.set(650, 650);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set((bounds.minX + bounds.maxX) / 2, level, (bounds.minZ + bounds.maxZ) / 2);
  sea.receiveShadow = true;
  group.add(sea);
}
