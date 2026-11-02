import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { Textures, SPONSORS, NEON, labelTexture, neonTexture } from './textures.js';
import { ribbon } from './TrackBuilder.js';
import { mulberry32, makeNoise2D } from './noise.js';
import { RAPIER } from '../physics/PhysicsWorld.js';

const DENSITY = { low: 0.35, medium: 0.7, high: 1 };
const UP = new THREE.Vector3(0, 1, 0);
const _p = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Indices of samples within `length` metres centred on arc position s. */
function rangeIdx(track, s, length) {
  const n = Math.max(2, Math.round(length / track.step));
  const i0 = track.indexAtS(s - length / 2);
  return Array.from({ length: n }, (_, k) => track.wrap(i0 + k));
}

function sideCols(sign, cols) {
  const c = cols.map(([l, dy]) => [sign * l, dy]);
  return sign < 0 ? c.reverse() : c;
}

/** Material whose base colour is remembered so weather (snow) can tint it. */
function weatherMat(params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.base = { color: m.color.clone(), roughness: m.roughness };
  return m;
}

/**
 * Random placement around the track, rejecting points too close to any part of it.
 * mode 'corridor': within `spread` m of the road (good for long stages); 'area': anywhere in bounds.
 * clear: minimum distance from the road edge. Returns () → [x, y, z] | null.
 */
function placer(track, layout, terrain, { mode, clear, spread = 140, seed = 3, minY = -Infinity, clumps = true }) {
  const rand = mulberry32(seed);
  const clump = makeNoise2D(seed + 11);
  const b = terrain.bounds;
  const near = {};
  return () => {
    for (let tries = 0; tries < 30; tries++) {
      let x;
      let z;
      if (mode === 'corridor') {
        const i = Math.floor(rand() * track.count);
        const sg = rand() < 0.5 ? -1 : 1;
        track.pointAt(i, sg * (track.half[i] + clear + Math.pow(rand(), 1.6) * spread), _p);
        x = _p.x;
        z = _p.z;
      } else {
        x = b.minX + rand() * (b.maxX - b.minX);
        z = b.minZ + rand() * (b.maxZ - b.minZ);
      }
      if (clumps && clump(x * 0.006, z * 0.006) < -0.2) continue; // clearings between woods
      const q = track.nearest(x, z, -1, near, 6);
      if (q.found) {
        const side = q.lateral < 0 ? 'L' : 'R';
        const wall = layout.style[side] === 'none' ? 0 : layout.barrier[side][q.index] - track.half[q.index];
        if (q.dist < track.half[q.index] + Math.max(clear, wall + 2)) continue;
      }
      const y = terrain.heightAt(x, z);
      if (y < minY) continue;
      return [x, y, z, rand(), rand()];
    }
    return null;
  };
}

// --------------------------------------------------------------------------------- trees

/** Displace vertices a little (same displacement for the same position, so seams stay closed). */
function jitter(geo, amount, seed = 1) {
  const pos = geo.attributes.position;
  const h = (x, y, z, k) => {
    const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k * 11.3 + seed) * 43758.5453;
    return v - Math.floor(v) - 0.5;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i) * 100) / 100;
    const y = Math.round(pos.getY(i) * 100) / 100;
    const z = Math.round(pos.getZ(i) * 100) / 100;
    pos.setXYZ(i, x + h(x, y, z, 1) * amount, y + h(x, y, z, 2) * amount * 0.6, z + h(x, y, z, 3) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Tiered conifer: stacked cones, each a little offset, narrowing to the top. */
function conifer(tiers, base, top, width, seed) {
  const parts = [];
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const r = width * (1 - f * 0.72);
    const h = (top - base) / tiers * 1.9;
    const y = base + (top - base) * f * 0.92 + h / 2;
    const g = new THREE.ConeGeometry(r, h, 8, 1).translate(Math.sin(k * 2.1 + seed) * 0.12, y, Math.cos(k * 1.7 + seed) * 0.12);
    parts.push(jitter(g.toNonIndexed(), r * 0.18, seed + k));
  }
  return mergeGeometries(parts);
}

/** Broadleaf crown: a cluster of lumpy blobs. */
function crown(blobs, radius, height, seed) {
  const parts = [];
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + seed;
    const r = radius * (0.55 + ((k * 37) % 10) / 22);
    const off = k === 0 ? 0 : radius * 0.55;
    const g = new THREE.IcosahedronGeometry(r, 1).translate(Math.cos(a) * off, height + (k === 0 ? radius * 0.35 : ((k * 13) % 7) / 7 - 0.3), Math.sin(a) * off);
    parts.push(jitter(g, r * 0.22, seed + k));
  }
  return mergeGeometries(parts);
}

function treeKinds() {
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, 3.4, 6).translate(0, 1.7, 0);
  const tallTrunk = new THREE.CylinderGeometry(0.12, 0.3, 6, 6).translate(0, 3, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4331, roughness: 0.9 });
  const birchMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.8 });
  const fronds = [];
  for (let k = 0; k < 8; k++) {
    // drooping frond: two segments, the outer one bent down
    const inner = new THREE.BoxGeometry(0.75, 0.04, 1.9).translate(0, 0, 0.95).rotateX(-0.25);
    const outer = new THREE.BoxGeometry(0.6, 0.04, 1.8).translate(0, 0, 0.9).rotateX(0.55).translate(0, -0.45, 1.75);
    const g = mergeGeometries([inner, outer]).rotateY((k / 8) * Math.PI * 2 + (k % 2) * 0.2).translate(0.35, 7.5, 0);
    fronds.push(g);
  }
  const palmTrunk = mergeGeometries([0, 1, 2, 3].map((k) => new THREE.CylinderGeometry(0.2 - k * 0.015, 0.25 - k * 0.015, 1.95, 7).translate(k * 0.1, 1 + k * 1.9, 0)));
  const cactus = mergeGeometries([
    new THREE.CylinderGeometry(0.32, 0.36, 4.2, 8).translate(0, 2.1, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 0.9, 7).rotateZ(Math.PI / 2).translate(0.55, 1.9, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 1.4, 7).translate(0.95, 2.55, 0),
    new THREE.CylinderGeometry(0.18, 0.18, 0.7, 7).rotateZ(Math.PI / 2).translate(-0.45, 2.6, 0),
    new THREE.CylinderGeometry(0.18, 0.18, 1.1, 7).translate(-0.75, 3.1, 0),
  ]);
  const dead = mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.25, 5, 6).translate(0, 2.5, 0),
    new THREE.CylinderGeometry(0.05, 0.1, 2.2, 5).rotateZ(0.9).translate(0.7, 3.6, 0),
    new THREE.CylinderGeometry(0.05, 0.1, 1.8, 5).rotateZ(-0.8).translate(-0.6, 3.1, 0.1),
    new THREE.CylinderGeometry(0.04, 0.08, 1.6, 5).rotateX(0.8).translate(0, 4.2, 0.5),
  ]);
  const flat = (color) => weatherMat({ color, roughness: 0.85, flatShading: true });
  const pineGeo = conifer(5, 1.6, 10.5, 2.7, 1);
  const cedarGeo = conifer(6, 2.5, 13.5, 2.0, 5);
  // snow caps: the upper faces of slightly smaller, flattened tiers
  const caps = conifer(5, 1.75, 10.6, 2.45, 1).scale(1, 0.98, 1);
  const pineMat = flat(0x2c5530);
  return {
    pine: { parts: [[trunk, trunkMat], [pineGeo, pineMat, true]], r: 0.3 },
    snowpine: { parts: [[trunk, trunkMat], [pineGeo, flat(0x2a4a33), true], [caps.translate(0, 0.35, 0), flat(0xe9eef2)]], r: 0.3 },
    cedar: { parts: [[tallTrunk, trunkMat], [cedarGeo, flat(0x24432a), true]], r: 0.3 },
    broad: { parts: [[trunk, trunkMat], [crown(5, 2.1, 5, 2), flat(0x4f7a34), true]], r: 0.3 },
    birch: { parts: [[tallTrunk, birchMat], [crown(4, 1.6, 6.2, 7), flat(0x7da048), true]], r: 0.22 },
    bush: { parts: [[crown(3, 1.1, 0.7, 9), flat(0x4a6e30), true]], r: 0 },
    palm: { parts: [[palmTrunk, new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.9 })], [mergeGeometries(fronds), flat(0x4f8a34), true]], r: 0.25 },
    cactus: { parts: [[cactus, flat(0x4f7d3a), true]], r: 0.35 },
    dead: { parts: [[dead, new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.95 })]], r: 0.25 },
  };
}

/**
 * scenery.trees: { count, kinds: { pine: 3, broad: 1, … } (weights), clear (m from road edge),
 *                  mode, spread, colliders }   — or a plain count (mixed pine/broad).
 * Returns the foliage materials (for snow tinting).
 */
export function buildTrees(track, layout, terrain, group, def, quality, physics) {
  const cfg = typeof def.scenery?.trees === 'number' ? { count: def.scenery.trees } : def.scenery?.trees || { count: 0 };
  const count = Math.round((cfg.count ?? 0) * (DENSITY[quality] ?? 0.7));
  if (!count) return [];
  const kinds = treeKinds();
  const weights = Object.entries(cfg.kinds || { pine: 3, broad: 2 });
  const total = weights.reduce((a, [, w]) => a + w, 0);
  const pick = (r) => {
    let acc = 0;
    for (const [k, w] of weights) if ((acc += w / total) >= r) return k;
    return weights[weights.length - 1][0];
  };
  const place = placer(track, layout, terrain, {
    mode: cfg.mode || (track.closed ? 'area' : 'corridor'),
    clear: cfg.clear ?? 14,
    spread: cfg.spread ?? 160,
    seed: def.terrain?.seed ?? 3,
    minY: terrain.seaLevel !== null ? terrain.seaLevel + 1 : -Infinity,
  });
  const lists = Object.fromEntries(weights.map(([k]) => [k, []]));
  for (let n = 0; n < count; n++) {
    const s = place();
    if (s) lists[pick(s[3])].push(s);
  }
  const foliage = [];
  for (const [kind, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const spec = kinds[kind];
    for (const [geo, mat, varied] of spec.parts) {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, y, z, r1, r2], i) => {
        const sc = 0.75 + r2 * 0.8;
        _q.setFromAxisAngle(UP, r1 * Math.PI * 20);
        _m.compose(new THREE.Vector3(x, y - 0.2, z), _q, new THREE.Vector3(sc, sc * (0.85 + r1 * 0.3), sc));
        inst.setMatrixAt(i, _m);
      });
      if (varied) {
        // no two trees quite the same green: hue, saturation and brightness drift per instance
        // (instance colour multiplies the material colour, so divide that back out)
        const hsl = {};
        mat.color.getHSL(hsl);
        list.forEach(([, , , r1, r2], i) => {
          const c2 = new THREE.Color().setHSL(hsl.h + ((r1 * 7.3) % 1 - 0.5) * 0.05, hsl.s * (0.8 + ((r2 * 3.7) % 1) * 0.45), hsl.l * (0.78 + ((r2 * 5.1) % 1) * 0.5));
          inst.setColorAt(i, c2.multiply(new THREE.Color(1 / mat.color.r, 1 / mat.color.g, 1 / mat.color.b)));
        });
        inst.instanceColor.needsUpdate = true;
      }
      inst.castShadow = quality !== 'low';
      group.add(inst);
      if (mat.userData.base) foliage.push(mat);
    }
    if (cfg.colliders && physics && spec.r > 0) {
      for (const [x, y, z, , r2] of list) {
        const sc = 0.75 + r2 * 0.8;
        physics.addCylinder({ x, y: y + 1.5 * sc, z }, 1.5 * sc, spec.r * sc, { surface: 'grass' });
      }
    }
  }
  return foliage;
}

/** scenery.rocks: { count, color, size: [min, max], clear, colliders } */
export function buildRocks(track, layout, terrain, group, def, quality, physics) {
  const cfg = def.scenery?.rocks;
  if (!cfg) return;
  const count = Math.round(cfg.count * (DENSITY[quality] ?? 0.7));
  const place = placer(track, layout, terrain, {
    mode: track.closed ? 'area' : 'corridor',
    clear: cfg.clear ?? 6,
    spread: cfg.spread ?? 120,
    seed: (def.terrain?.seed ?? 3) + 77,
    clumps: false,
  });
  const [smin, smax] = cfg.size || [0.8, 4];
  const geo = jitter(new THREE.IcosahedronGeometry(1, 1), 0.28, 4);
  const inst = new THREE.InstancedMesh(geo, weatherMat({ color: new THREE.Color(cfg.color ?? 0x8a8278).multiplyScalar(1.9), map: Textures.rock(), roughness: 0.95, flatShading: true }), count);
  let n = 0;
  for (let k = 0; k < count; k++) {
    const s = place();
    if (!s) continue;
    const [x, y, z, r1, r2] = s;
    const size = smin + (smax - smin) * Math.pow(r2, 2.2);
    _q.setFromEuler(new THREE.Euler(r1 * 6, r2 * 6, r1 * r2 * 6));
    _m.compose(new THREE.Vector3(x, y + size * 0.2, z), _q, new THREE.Vector3(size * (0.8 + r1 * 0.6), size * (0.5 + r2 * 0.5), size));
    inst.setMatrixAt(n++, _m);
    if (cfg.colliders && physics && size > 1.2) {
      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + size * 0.2, z));
      physics.world.createCollider(RAPIER.ColliderDesc.ball(size * 0.6).setFriction(0.6), body);
    }
  }
  inst.count = n;
  inst.castShadow = inst.receiveShadow = true;
  group.add(inst);
  return inst.material;
}

// --------------------------------------------------------------------------------- circuit dressing

export function buildGrandstands(track, layout, def, group) {
  const crowdMat = new THREE.MeshStandardMaterial({ map: Textures.crowd(), roughness: 0.9 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8d949e, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  const ctrlS = (k) => {
    const [x, z] = def.track.points[k];
    return track.nearest(x, z).s;
  };
  for (const st of def.scenery?.grandstands || []) {
    const sg = st.side === 'left' ? -1 : 1;
    const side = sg < 0 ? 'L' : 'R';
    const idx = rangeIdx(track, ctrlS(st.at), st.length);
    // stepped seating rising away from the track
    const stand = ribbon(
      track,
      idx,
      (i) => {
        const b0 = layout.barrier[side][i] + 4;
        const cols = [[b0, -0.5], [b0, 1.6]];
        for (let k = 1; k <= 10; k++) cols.push([b0 + k * 0.9, 1.6 + k * 0.55]);
        cols.push([b0 + 10.5, 7.2], [b0 + 10.5, -0.5]);
        return sideCols(sg, cols);
      },
      (l, s, k, n) => [s / 10, k / n],
    );
    const m = new THREE.Mesh(stand.geometry, crowdMat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    const roof = ribbon(track, idx, (i) => {
      const b0 = layout.barrier[side][i] + 4;
      return sideCols(sg, [[b0 + 0.5, 10.5], [b0 + 11, 11.5]]);
    });
    const r = new THREE.Mesh(roof.geometry, steelMat);
    r.castShadow = true;
    group.add(r);
  }
}

export function buildPitBuilding(track, layout, def, group) {
  if (!def.pit) return;
  const sg = def.pit.side === 'left' ? -1 : 1;
  const idx = [];
  for (let i = 0; i < track.count; i++) if (layout.pitBlend[i] > 0.97) idx.push(i);
  if (idx.length < 2) return;
  // keep the run contiguous on loops (the pit range may wrap past index 0)
  const gap = idx.findIndex((v, k) => k > 0 && v !== idx[k - 1] + 1);
  const ordered = gap > 0 ? [...idx.slice(gap), ...idx.slice(0, gap)] : idx;
  const pw = def.pit.width / 2;
  const front = (i) => Math.abs(layout.pitCenter[i]) + pw + 4.2;
  const building = ribbon(
    track,
    ordered,
    (i) => sideCols(sg, [[front(i), -0.5], [front(i), 6.5], [front(i) + 14, 7.5], [front(i) + 14, -0.5]]),
    (l, s, k) => [s / 7, [0, 1, 1, 0][k]],
  );
  const m = new THREE.Mesh(building.geometry, new THREE.MeshStandardMaterial({ map: Textures.garage(), roughness: 0.7 }));
  m.castShadow = m.receiveShadow = true;
  group.add(m);
}

/**
 * Gantry over the road at sample i with a sign and (optionally) five countdown lights.
 * Returns setLights(n) (n lit red, -1 = all green), a no-op without lights.
 */
export function buildGantry(track, i, label, group, { lights = true, color = '#14161b' } = {}) {
  const h = track.half[i];
  const g = new THREE.Group();
  track.pointAt(i, 0, _p);
  g.position.set(_p.x, _p.y, _p.z);
  g.rotation.y = track.yaw[i];
  const steel = new THREE.MeshStandardMaterial({ color: 0x30343b, roughness: 0.5, metalness: 0.5 });
  const span = h + 2.2;
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), steel);
    post.position.set(s * span, 4, 0);
    post.castShadow = true;
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.6, 1.6, 0.8), steel);
  beam.position.set(0, 7.4, 0);
  beam.castShadow = true;
  g.add(beam);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 1.2, 1.2),
    new THREE.MeshBasicMaterial({ map: labelTexture(label.toUpperCase(), { bg: color, fg: '#ffffff', width: 1024, height: 96 }) }),
  );
  // cars approach from +Z in gantry space (they drive toward -Z), so the default +Z normal faces them
  sign.position.set(0, 7.4, 0.41);
  g.add(sign);
  group.add(g);
  if (!lights) return () => {};
  const mats = [];
  for (let k = 0; k < 5; k++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), mat);
    bulb.position.set((k - 2) * 0.9, 6.25, 0.25);
    g.add(bulb);
    mats.push(mat);
  }
  return (n) => {
    mats.forEach((mat, k) => {
      if (n < 0) mat.emissive.set(0x22ff44);
      else mat.emissive.set(k < n ? 0xff1a10 : 0x000000);
      mat.emissiveIntensity = 2.2;
    });
  };
}

export function buildBillboards(track, layout, def, group) {
  const count = def.scenery?.billboards ?? 0;
  if (!count) return;
  const rand = mulberry32(99);
  const mats = SPONSORS.map(([name, bg, fg]) =>
    new THREE.MeshStandardMaterial({ map: labelTexture(name, { bg, fg, width: 512, height: 128 }), roughness: 0.6 }),
  );
  const postMat = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.6 });
  for (let k = 0; k < count; k++) {
    const i = track.wrap(Math.floor(((k + rand() * 0.6) / count) * track.count));
    const sg = rand() < 0.5 ? -1 : 1;
    const side = sg < 0 ? 'L' : 'R';
    if (layout.pitCenter[i] && (layout.pitCenter[i] < 0) === (sg < 0)) continue;
    if (layout.tunnel[i]) continue;
    track.pointAt(i, sg * (layout.barrier[side][i] + 2.2), _p);
    const board = new THREE.Group();
    board.position.set(_p.x, _p.y, _p.z);
    // face the track: rotating +Z by yaw ∓ 90° points the plane normal along ∓right
    board.rotation.y = track.yaw[i] + (sg > 0 ? -Math.PI / 2 : Math.PI / 2);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), mats[k % mats.length]);
    panel.position.y = 2.4;
    panel.castShadow = true;
    board.add(panel);
    for (const x of [-3, 3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.5, 0.15), postMat);
      post.position.set(x, 0.75, -0.05);
      board.add(post);
    }
    group.add(board);
  }
}

// --------------------------------------------------------------------------------- night lighting

/**
 * Street lamps along the road: post, arm over the road, glowing head and a pool of light on the
 * road (additive decal). scenery.lamps: { spacing, side: 'both'|'L'|'R', color }.
 * Returns materials whose brightness follows the night factor.
 */
export function buildLamps(track, layout, def, group) {
  const cfg = def.scenery?.lamps;
  if (!cfg) return null;
  const spacing = Math.max(2, Math.round((cfg.spacing ?? 35) / track.step));
  const sides = cfg.side === 'L' ? [-1] : cfg.side === 'R' ? [1] : [-1, 1];
  const spots = [];
  for (let i = 0; i < track.count; i += spacing) {
    if (layout.tunnel[i]) continue;
    for (const sg of sides) {
      const side = sg < 0 ? 'L' : 'R';
      // stagger the two sides so the pools alternate
      if (sides.length === 2 && sg > 0 && (i / spacing) % 2 === 0) continue;
      if (sides.length === 2 && sg < 0 && (i / spacing) % 2 === 1) continue;
      const edge = layout.style[side] === 'none' ? track.half[i] + 1.5 : layout.barrier[side][i] + 0.8;
      spots.push([i, sg, edge]);
    }
  }
  const color = new THREE.Color(cfg.color ?? 0xffc98a);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0 });
  const poolMat = new THREE.MeshBasicMaterial({ map: Textures.glow(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 7.5, 6).translate(0, 3.75, 0), postMat, spots.length);
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 2.4).translate(0, 7.4, 1.2), postMat, spots.length);
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.14, 0.8).translate(0, 7.3, 2.3), headMat, spots.length);
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), poolMat, spots.length);
  spots.forEach(([i, sg, edge], k) => {
    track.pointAt(i, sg * edge, _p);
    // local +Z of the lamp points across the road toward the centreline
    _q.setFromAxisAngle(UP, track.yaw[i] + (sg > 0 ? -Math.PI / 2 : Math.PI / 2));
    _m.compose(new THREE.Vector3(_p.x, _p.y, _p.z), _q, new THREE.Vector3(1, 1, 1));
    post.setMatrixAt(k, _m);
    arm.setMatrixAt(k, _m);
    head.setMatrixAt(k, _m);
    track.pointAt(i, sg * Math.max(0, edge - 3.5), _p);
    _m.makeTranslation(_p.x, _p.y + 0.06, _p.z);
    pool.setMatrixAt(k, _m);
  });
  post.castShadow = true;
  pool.renderOrder = 2;
  group.add(post, arm, head, pool);
  return {
    setNight(n, wet) {
      headMat.emissiveIntensity = 0.2 + n * 3;
      poolMat.opacity = n * (0.35 + 0.25 * wet);
    },
  };
}

/**
 * City blocks: merged buildings with lit windows, neon signs on the walls with glowing streaks on
 * the (wet) road, and a ring of coloured panels for the reflection map.
 * scenery.city: { cell, minHeight, maxHeight, margin, neon }
 */
export function buildCity(track, layout, terrain, def, group) {
  const cfg = def.scenery?.city;
  if (!cfg) return null;
  const rand = mulberry32(def.terrain?.seed ?? 5);
  const b = terrain.bounds;
  const cell = cfg.cell ?? 44;
  const near = {};
  const geos = [];
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const maxR = Math.hypot(b.maxX - cx, b.maxZ - cz);
  for (let x = b.minX; x < b.maxX; x += cell) {
    for (let z = b.minZ; z < b.maxZ; z += cell) {
      const w = 16 + rand() * 14;
      const d = 16 + rand() * 14;
      const px = x + cell / 2 + (rand() - 0.5) * 6;
      const pz = z + cell / 2 + (rand() - 0.5) * 6;
      const q = track.nearest(px, pz, -1, near, 6);
      if (q.found) {
        const side = q.lateral < 0 ? 'L' : 'R';
        if (q.dist - Math.hypot(w, d) / 2 < layout.barrier[side][q.index] + 7) continue;
      }
      // taller toward the middle of the city
      const central = 1 - Math.hypot(px - cx, pz - cz) / maxR;
      const h = (cfg.minHeight ?? 14) + Math.pow(rand(), 2) * (cfg.maxHeight ?? 120) * (0.4 + central);
      geos.push(building(w, h, d, px, pz, rand() * 0.2 - 0.1));
    }
  }
  const windowMat = new THREE.MeshStandardMaterial({
    map: Textures.facade(),
    emissiveMap: Textures.windows(),
    emissive: 0xffffff,
    emissiveIntensity: 0,
    color: 0x9aa0aa,
    roughness: 0.75,
  });
  if (geos.length) {
    const city = new THREE.Mesh(mergeGeometries(geos), windowMat);
    city.castShadow = city.receiveShadow = true;
    group.add(city);
    for (const g of geos) g.dispose();
  }

  // neon signs facing the track, with a glow streak on the road below each
  const signs = [];
  const streakMats = [];
  const count = cfg.neon ?? 24;
  for (let k = 0; k < count; k++) {
    const i = Math.floor(((k + rand() * 0.7) / count) * track.count);
    if (layout.tunnel[i]) continue;
    const sg = rand() < 0.5 ? -1 : 1;
    const side = sg < 0 ? 'L' : 'R';
    const [text, color] = NEON[k % NEON.length];
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: neonTexture(text, color), toneMapped: false }));
    track.pointAt(i, sg * (layout.barrier[side][i] + 2.5), _p);
    sign.position.set(_p.x, _p.y + 5 + rand() * 6, _p.z);
    sign.rotation.y = track.yaw[i] + (sg > 0 ? -Math.PI / 2 : Math.PI / 2);
    group.add(sign);
    signs.push(sign);
    const sm = new THREE.MeshBasicMaterial({ map: Textures.glow(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const streak = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 16).rotateX(-Math.PI / 2), sm);
    track.pointAt(i, sg * (track.half[i] - 2.5), _p);
    streak.position.set(_p.x, _p.y + 0.07, _p.z);
    streak.rotation.y = track.yaw[i];
    streak.renderOrder = 2;
    group.add(streak);
    streakMats.push(sm);
  }

  // coloured panels around the horizon for the reflection map (night city glow in the paint)
  const envProps = new THREE.Group();
  NEON.forEach(([, color], k) => {
    const a = (k / NEON.length) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.2), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    p.position.set(Math.cos(a) * 8, 0.6 + (k % 3) * 0.8, Math.sin(a) * 8);
    p.lookAt(0, p.position.y, 0);
    envProps.add(p);
  });

  return {
    envProps,
    setNight(n, wet) {
      windowMat.emissiveIntensity = 0.05 + n * 1.3;
      for (const m of streakMats) m.opacity = (0.15 + 0.6 * wet) * (0.3 + 0.7 * n);
    },
  };
}

/** Box building (no floor) with UVs scaled so windows stay 4 m wide and 3.6 m tall. */
function building(w, h, d, x, z, yaw) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z, four vertices each
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = faceSize[f];
    const roof = f === 2 || f === 3;
    for (let v = f * 4; v < f * 4 + 4; v++) uv.setXY(v, uv.getX(v) * (roof ? 0.1 : fu / 4), uv.getY(v) * (roof ? 0.1 : fv / 3.6));
  }
  g.rotateY(yaw);
  g.translate(x, h / 2 - 0.5, z);
  return g;
}

// --------------------------------------------------------------------------------- props

/**
 * Hand-placed props from def.props, set on the terrain:
 *   containers { x, z, yaw, count, stack }   hangar { x, z, yaw, w, d, h }   tower { x, z }
 *   house { x, z, yaw, w, d, color }   lighthouse { x, z }   ramp { x, z, yaw, len, h, w }
 *   hut { x, z, yaw }   mast { x, z }
 * Returns { setNight } for props with lights.
 */
export function buildProps(def, terrain, physics, group) {
  const list = def.props || [];
  const rand = mulberry32(31);
  const lamps = [];
  const groundY = (x, z) => terrain.heightAt(x, z);
  const fixedBox = (x, y, z, yaw, hx, hy, hz, surface = 'asphalt') => {
    _q.setFromAxisAngle(UP, yaw);
    physics.addBox({ x, y, z }, { x: hx, y: hy, z: hz }, { rotation: { x: _q.x, y: _q.y, z: _q.z, w: _q.w }, surface, friction: 0.4 });
  };
  const add = (geo, mat, x, y, z, yaw, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const containerColors = [0xb3402f, 0x2f5fa3, 0x3f8a4a, 0xd9a23a, 0x6b6f76, 0xe0e0dc, 0x8a3c7a];
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.55, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0d0, emissiveIntensity: 0 });

  // containers are instanced with per-instance colours
  const cont = list.filter((p) => p.type === 'containers');
  const nCont = cont.reduce((a, p) => a + p.count * (p.stack ?? 1), 0);
  let contMesh = null;
  if (nCont) {
    contMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(12.2, 2.6, 2.45), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3 }), nCont);
    contMesh.castShadow = contMesh.receiveShadow = true;
    group.add(contMesh);
  }
  let ci = 0;
  for (const p of list) {
    const y = groundY(p.x, p.z);
    const yaw = p.yaw ?? 0;
    if (p.type === 'containers') {
      const stack = p.stack ?? 1;
      const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      for (let k = 0; k < p.count; k++) {
        for (let s = 0; s < stack; s++) {
          const off = (k - (p.count - 1) / 2) * 12.4;
          _q.setFromAxisAngle(UP, yaw);
          _m.compose(new THREE.Vector3(p.x + dir.x * off, y + 1.3 + s * 2.6, p.z + dir.z * off), _q, new THREE.Vector3(1, 1, 1));
          contMesh.setMatrixAt(ci, _m);
          contMesh.setColorAt(ci++, new THREE.Color(containerColors[Math.floor(rand() * containerColors.length)]));
        }
      }
      fixedBox(p.x, y + stack * 1.3, p.z, yaw, (p.count * 12.4) / 2, stack * 1.3, 1.25);
    } else if (p.type === 'hangar') {
      const { w = 60, d = 40, h = 14 } = p;
      add(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), metal, p.x, y, p.z, yaw);
      const roof = new THREE.CylinderGeometry(d / 2, d / 2, w, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2);
      roof.scale(1, 0.35, 1).translate(0, h, 0);
      add(roof, metal, p.x, y, p.z, yaw);
      add(new THREE.PlaneGeometry(w * 0.7, h * 0.8).translate(0, h * 0.4, d / 2 + 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.6 }), p.x, y, p.z, yaw, false);
      fixedBox(p.x, y + h / 2, p.z, yaw, w / 2, h / 2, d / 2);
    } else if (p.type === 'tower') {
      add(new THREE.CylinderGeometry(2.2, 3, 26, 10).translate(0, 13, 0), new THREE.MeshStandardMaterial({ color: 0xd8d8d2, roughness: 0.7 }), p.x, y, p.z, 0);
      add(new THREE.CylinderGeometry(6, 5, 5, 10).translate(0, 28.5, 0), new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.7, roughness: 0.15 }), p.x, y, p.z, 0);
      add(new THREE.CylinderGeometry(6.4, 6.4, 0.6, 10).translate(0, 31.3, 0), metal, p.x, y, p.z, 0);
      physics.addCylinder({ x: p.x, y: y + 13, z: p.z }, 13, 3, {});
    } else if (p.type === 'house') {
      const { w = 8, d = 10 } = p;
      const wall = new THREE.MeshStandardMaterial({ color: p.color ?? 0xf0e6d2, roughness: 0.85 });
      add(new THREE.BoxGeometry(w, 3.2, d).translate(0, 1.6, 0), wall, p.x, y, p.z, yaw);
      const roof = new THREE.ConeGeometry(Math.hypot(w, d) / 2 + 0.4, 2.4, 4).rotateY(Math.PI / 4).scale(w / Math.hypot(w, d) * 1.414, 1, d / Math.hypot(w, d) * 1.414).translate(0, 4.4, 0);
      add(roof, new THREE.MeshStandardMaterial({ color: p.roof ?? 0xa4452f, roughness: 0.8, flatShading: true }), p.x, y, p.z, yaw);
      fixedBox(p.x, y + 1.6, p.z, yaw, w / 2, 1.6, d / 2);
    } else if (p.type === 'lighthouse') {
      add(new THREE.CylinderGeometry(2.2, 3.4, 24, 14).translate(0, 12, 0), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }), p.x, y, p.z, 0);
      for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(2.25 + (2 - k) * 0.35, 2.25 + (3 - k) * 0.35 - 0.0, 2.2, 14).translate(0, 4 + k * 7, 0), new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.6 }), p.x, y, p.z, 0, false);
      const lamp = add(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 10).translate(0, 25.4, 0), lampMat, p.x, y, p.z, 0, false);
      lamps.push(lamp);
      add(new THREE.ConeGeometry(2.2, 2, 10).translate(0, 27.6, 0), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }), p.x, y, p.z, 0);
      physics.addCylinder({ x: p.x, y: y + 12, z: p.z }, 12, 3, {});
    } else if (p.type === 'ramp') {
      const { len = 8, h = 1.5, w = 6 } = p;
      // wedge rising along the yaw direction (forward = -Z rotated by yaw)
      const pts = [
        [-w / 2, 0, len / 2], [w / 2, 0, len / 2], [-w / 2, 0, -len / 2], [w / 2, 0, -len / 2], [-w / 2, h, -len / 2], [w / 2, h, -len / 2],
      ].map(([a, b, c]) => new THREE.Vector3(a, b, c).applyAxisAngle(UP, yaw).add(new THREE.Vector3(p.x, y - 0.15, p.z)));
      const geo = new ConvexGeometry(pts);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: Textures.concrete(), roughness: 0.85 }));
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      physics.addHull(pts.flatMap((v) => [v.x, v.y, v.z]), { surface: 'asphalt' });
    } else if (p.type === 'hut') {
      add(new THREE.BoxGeometry(2.4, 2.2, 3).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ color: p.color ?? 0xa33a2a, roughness: 0.8 }), p.x, y, p.z, yaw);
      fixedBox(p.x, y + 1.1, p.z, yaw, 1.2, 1.1, 1.5);
    } else if (p.type === 'mast') {
      add(new THREE.CylinderGeometry(0.25, 0.35, 22, 8).translate(0, 11, 0), metal, p.x, y, p.z, 0);
      lamps.push(add(new THREE.BoxGeometry(3, 1.2, 0.6).translate(0, 22, 0), lampMat, p.x, y, p.z, p.yaw ?? 0, false));
      physics.addCylinder({ x: p.x, y: y + 11, z: p.z }, 11, 0.4, {});
    }
  }
  if (contMesh) contMesh.instanceColor.needsUpdate = true;
  return {
    setNight(n) {
      lampMat.emissiveIntensity = 0.1 + n * 3;
    },
  };
}

// --------------------------------------------------------------------------------- horizon

/** Ring of low-poly mountains far outside the play area (visual only). */
export function buildHorizon(terrain, group, def) {
  const b = terrain.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const hz = def.horizon || {};
  const r0 = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * (hz.start ?? 0.62); // sea maps push it out over the water
  const r1 = 6000;
  const noise = makeNoise2D((def.terrain?.seed ?? 1) + 5);
  const seg = 96;
  const rings = 14;
  const pos = [];
  const col = [];
  const nearC = new THREE.Color(hz.near ?? 0x7f9a6c);
  const farC = new THREE.Color(hz.far ?? 0x9aa8b8);
  const c = new THREE.Color();
  const height = hz.height ?? 1;
  const base = (terrain.seaLevel ?? terrain.baseY) - 4;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = r0 + (r1 - r0) * Math.pow(t, 1.4);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ridge = 1 - Math.abs(noise.fbm(Math.cos(a) * 2.2 + 9, Math.sin(a) * 2.2 + t * 1.5, 4)) * 2;
      const y = base + height * Math.pow(Math.max(0, t - 0.08), 0.8) * (160 + 420 * Math.max(0, ridge));
      pos.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      c.copy(nearC).lerp(farC, t);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const d = a + seg + 1;
      // wound so the inner (camera-facing) slopes face up and inward
      idx.push(a, a + 1, d, a + 1, d + 1, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = weatherMat({ vertexColors: true, roughness: 1, flatShading: true });
  group.add(new THREE.Mesh(geo, mat));
  return mat;
}
