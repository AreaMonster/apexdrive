import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Textures, labelTexture } from './textures.js';
import { mulberry32 } from './noise.js';

// Trackside dressing, chosen by the kind of venue (overridable per map with def.trackside):
//   circuit  braking boards before the big stops, tyre walls on the outside of corners, marshal
//            posts, catch fencing along the walls
//   road     reflector posts, chevron boards on tight bends, telegraph poles with sagging wires
//   rally    chevrons, hay bales on the outside of corners, tape, and groups of spectators
// Everything is instanced; one draw call per kind of object.

const UP = new THREE.Vector3(0, 1, 0);
const _p = { x: 0, y: 0, z: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Collects instance transforms (and optional colours) for one geometry + material. */
class Batch {
  constructor(geo, mat, { shadow = true } = {}) {
    this.geo = geo;
    this.mat = mat;
    this.items = [];
    this.shadow = shadow;
  }

  add(x, y, z, yaw, scale = 1, color = null) {
    this.items.push([x, y, z, yaw, scale, color]);
  }

  build(group) {
    if (!this.items.length) return;
    const inst = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    const c = new THREE.Color();
    this.items.forEach(([x, y, z, yaw, sc, col], k) => {
      _q.setFromAxisAngle(UP, yaw);
      _m.compose(_v.set(x, y, z), _q, typeof sc === 'number' ? _s.set(sc, sc, sc) : _s.copy(sc));
      inst.setMatrixAt(k, _m);
      if (col !== null) inst.setColorAt(k, c.set(col));
    });
    inst.castShadow = this.shadow;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
}

/** Corners: runs of samples above a curvature threshold → { i0, i1, apex, sign, radius }. */
function findCorners(track, minCurv) {
  const out = [];
  let cur = null;
  for (let i = 0; i < track.count; i++) {
    const k = track.curv[i];
    if (Math.abs(k) > minCurv) {
      const sign = Math.sign(k);
      if (cur && cur.sign === sign) {
        cur.i1 = i;
        if (Math.abs(k) > Math.abs(track.curv[cur.apex])) cur.apex = i;
      } else {
        if (cur) out.push(cur);
        cur = { i0: i, i1: i, apex: i, sign };
      }
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  for (const c of out) c.radius = 1 / Math.abs(track.curv[c.apex]);
  return out.filter((c) => c.i1 - c.i0 >= 2);
}

/** Lateral distance of the barrier (or road edge plus a margin where there is none). */
function edgeAt(layout, track, side, i, margin = 1.5) {
  return layout.style[side] === 'none' ? track.half[i] + margin : layout.barrier[side][i];
}

/** World pose at sample i, lateral l, standing on the terrain; yaw faces the road (or along it). */
function at(track, terrain, i, l, out = _p) {
  track.pointAt(i, l, out);
  if (terrain?.heightAt && Math.abs(l) > track.half[i] + 0.5) out.y = Math.max(out.y - 0.3, terrain.heightAt(out.x, out.z));
  return out;
}

export function buildTrackside(track, layout, terrain, group, def, quality) {
  const t = def.track;
  const loose = ['gravel', 'dirt', 'sand', 'snow', 'mud'].includes(t.surface);
  const kind = def.trackside?.kind ?? (def.type === 'circuit' && t.kerbs !== false ? 'circuit' : loose ? 'rally' : def.type === 'stage' ? 'road' : null);
  const cfg = { ...(def.trackside || {}) };
  if (!kind || def.type === 'freeroam') return;
  const rand = mulberry32((def.terrain?.seed ?? 1) * 13 + 5);
  const dense = quality === 'low' ? 0.5 : 1;
  const batches = [];
  const batch = (geo, mat, opts) => {
    const b = new Batch(geo, mat, opts);
    batches.push(b);
    return b;
  };
  const corners = findCorners(track, 1 / 90);

  // ------------------------------------------------------------------ road furniture
  if (kind === 'road' || kind === 'rally') {
    // chevron boards on the outside of tight bends, facing the approaching driver
    const chevMat = new THREE.MeshStandardMaterial({ map: Textures.chevron(), roughness: 0.6, side: THREE.DoubleSide });
    const board = mergeGeometries([new THREE.PlaneGeometry(1.1, 0.7).translate(0, 1.25, 0.03), new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(0, 0.5, 0)]);
    const chev = batch(board, chevMat);
    for (const c of corners) {
      if (c.radius > 70) continue;
      const side = c.sign > 0 ? 'L' : 'R'; // outside of a right-hander is the left
      const sg = side === 'L' ? -1 : 1;
      const n = Math.min(6, 2 + Math.round((c.i1 - c.i0) / 6));
      for (let k = 0; k < n; k++) {
        const i = track.wrap(c.i0 + Math.round(((c.i1 - c.i0) * (k + 0.5)) / n));
        if (layout.tunnel[i]) continue;
        const p = at(track, terrain, i, sg * (edgeAt(layout, track, side, i, 1.2) + 0.6));
        // a +Z-facing board turned by the track yaw faces back down the road at the driver;
        // angled a little toward the inside, arrows pointing into the bend (mirrored for lefts)
        chev.add(p.x, p.y, p.z, track.yaw[i] + sg * 0.35, new THREE.Vector3(c.sign > 0 ? 1 : -1, 1, 1));
      }
    }
  }
  if (kind === 'road') {
    // reflector posts (delineators) every 40 m, both sides
    const postGeo = mergeGeometries([new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0)]);
    const capGeo = new THREE.BoxGeometry(0.13, 0.18, 0.13).translate(0, 0.86, 0);
    const posts = batch(postGeo, new THREE.MeshStandardMaterial({ color: 0xecece6, roughness: 0.6 }), { shadow: false });
    const caps = batch(capGeo, new THREE.MeshStandardMaterial({ color: 0x1c1c1c, emissive: 0xff7a1a, emissiveIntensity: 0.35, roughness: 0.4 }), { shadow: false });
    const step = Math.max(2, Math.round(40 / track.step / dense));
    for (let i = 0; i < track.count; i += step) {
      if (layout.tunnel[i]) continue;
      for (const side of ['L', 'R']) {
        if (layout.style[side] !== 'none') continue; // the armco carries its own reflectors
        const sg = side === 'L' ? -1 : 1;
        const p = at(track, terrain, i, sg * (track.half[i] + 1.1));
        posts.add(p.x, p.y, p.z, track.yaw[i]);
        caps.add(p.x, p.y, p.z, track.yaw[i]);
      }
    }
    // telegraph poles with sagging wires along one side
    if (cfg.poles !== false) {
      const side = cfg.polesSide ?? 'R';
      const sg = side === 'L' ? -1 : 1;
      const poleGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.11, 0.15, 8.5, 6).translate(0, 4.25, 0),
        new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0, 7.9, 0),
      ]);
      const poles = batch(poleGeo, new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 0.9 }));
      const tops = [];
      const pstep = Math.max(2, Math.round(48 / track.step));
      for (let i = 0; i < track.count; i += pstep) {
        if (layout.tunnel[i]) {
          tops.push(null);
          continue;
        }
        const p = at(track, terrain, i, sg * (edgeAt(layout, track, side, i, 3) + 4.5));
        poles.add(p.x, p.y, p.z, track.yaw[i]);
        tops.push([p.x, p.y + 7.95, p.z, track.yaw[i]]);
      }
      // two wires per span, sagging in a parabola
      const pts = [];
      for (let k = 0; k + 1 < tops.length; k++) {
        const a = tops[k];
        const b = tops[k + 1];
        if (!a || !b) continue;
        for (const off of [-0.65, 0.65]) {
          const ax = a[0] + Math.cos(a[3]) * off;
          const az = a[2] - Math.sin(a[3]) * off;
          const bx = b[0] + Math.cos(b[3]) * off;
          const bz = b[2] - Math.sin(b[3]) * off;
          const seg = 8;
          for (let j = 0; j < seg; j++) {
            for (const u of [j / seg, (j + 1) / seg]) {
              pts.push(ax + (bx - ax) * u, a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * 0.9, az + (bz - az) * u);
            }
          }
        }
      }
      if (pts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.7 })));
      }
    }
  }

  // ------------------------------------------------------------------ rally: bales, tape, crowds
  if (kind === 'rally') {
    const bale = batch(new THREE.CylinderGeometry(0.65, 0.65, 1.2, 10).rotateZ(Math.PI / 2).translate(0, 0.62, 0), new THREE.MeshStandardMaterial({ map: Textures.straw(), roughness: 1 }));
    for (const c of corners) {
      if (c.radius > 60 || rand() > 0.8) continue;
      const side = c.sign > 0 ? 'L' : 'R';
      const sg = side === 'L' ? -1 : 1;
      for (let k = -2; k <= 2; k++) {
        const i = track.wrap(c.apex + k * 2);
        const p = at(track, terrain, i, sg * (track.half[i] + 2.2));
        bale.add(p.x, p.y, p.z, track.yaw[i]);
      }
    }
    spectators(track, layout, terrain, corners, rand, batch, Math.round((cfg.spectators ?? 14) * dense), 6);
  }

  // ------------------------------------------------------------------ circuit
  if (kind === 'circuit') {
    // braking boards (300 / 200 / 100) before corners that follow a long straight
    const boardMats = ['300', '200', '100'].map((n) => new THREE.MeshStandardMaterial({ map: labelTexture(n, { bg: '#f4f4f0', fg: '#111', width: 128, height: 128 }), roughness: 0.6 }));
    const boardGeo = mergeGeometries([new THREE.PlaneGeometry(1.4, 1.4).translate(0, 1.6, 0.04), new THREE.BoxGeometry(0.1, 1.0, 0.1).translate(0, 0.5, 0)]);
    const boards = boardMats.map((m) => batch(boardGeo, m));
    let lastApex = -1e9;
    for (const c of corners) {
      const straight = (c.i0 - lastApex) * track.step;
      lastApex = c.i1;
      if (c.radius > 90 || straight < 220) continue;
      const side = c.sign > 0 ? 'L' : 'R';
      const sg = side === 'L' ? -1 : 1;
      [300, 200, 100].forEach((d, k) => {
        const i = track.wrap(c.i0 - Math.round(d / track.step));
        const p = at(track, terrain, i, sg * (track.half[i] + 3));
        boards[k].add(p.x, p.y, p.z, track.yaw[i], 1);
      });
    }
    // tyre walls in front of the barrier on the outside of corners
    const tyreGeo = new THREE.TorusGeometry(0.34, 0.16, 6, 10).rotateX(Math.PI / 2);
    const tyres = batch(tyreGeo, new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.85 }));
    for (const c of corners) {
      if (c.radius > 80) continue;
      const side = c.sign > 0 ? 'L' : 'R';
      if (layout.style[side] === 'none') continue;
      const sg = side === 'L' ? -1 : 1;
      for (let i0 = c.i0 - 4; i0 <= c.i1 + 8; i0++) {
        const i = track.wrap(i0);
        const lat = layout.barrier[side][i] - 0.55;
        for (let along = 0; along < track.step; along += 0.95) {
          const f = along / track.step;
          track.pointAt(i, sg * lat, _p);
          const x = _p.x + track.tan[i * 2] * f * track.step;
          const z = _p.z + track.tan[i * 2 + 1] * f * track.step;
          for (let h = 0; h < 3; h++) tyres.add(x, _p.y + 0.16 + h * 0.31, z, 0, 1, h === 1 ? 0xd8d8d8 : null);
        }
      }
    }
    // marshal posts every ~450 m on the outside
    const hut = batch(
      mergeGeometries([new THREE.BoxGeometry(1.6, 2.2, 1.6).translate(0, 1.1, 0), new THREE.BoxGeometry(1.9, 0.12, 1.9).translate(0, 2.26, 0)]),
      new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.7 }),
    );
    const flagGeo = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.03, 2.8, 4).translate(0, 1.4, 0), new THREE.PlaneGeometry(0.9, 0.6).translate(0.45, 2.45, 0)]);
    const flags = batch(flagGeo, new THREE.MeshStandardMaterial({ color: 0xf2d22a, side: THREE.DoubleSide, roughness: 0.7 }), { shadow: false });
    const mstep = Math.max(4, Math.round(450 / track.step));
    for (let i = Math.round(mstep / 2); i < track.count; i += mstep) {
      const side = track.curv[i] > 0 ? 'L' : 'R';
      const sg = side === 'L' ? -1 : 1;
      if (layout.pitCenter[i]) continue;
      const p = at(track, terrain, i, sg * (edgeAt(layout, track, side, i) + 3.2));
      hut.add(p.x, p.y, p.z, track.yaw[i]);
      flags.add(p.x + 1.2 * track.tan[i * 2], p.y, p.z + 1.2 * track.tan[i * 2 + 1], track.yaw[i]);
    }
    // catch fencing above the walls: posts and a see-through mesh panel along each straight
    if (cfg.fence !== false) fencing(track, layout, group);
    spectators(track, layout, terrain, corners, rand, batch, Math.round((cfg.spectators ?? 10) * dense), 10);
  }

  for (const b of batches) b.build(group);
}

/** Catch fence: one ribbon per side, 3.2 m high, with a diamond-mesh alpha texture. */
function fencing(track, layout, group) {
  const mat = new THREE.MeshStandardMaterial({ map: Textures.fence(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, color: 0xb8bec6 });
  for (const side of ['L', 'R']) {
    if (layout.style[side] === 'none') continue;
    const sg = side === 'L' ? -1 : 1;
    const pos = [];
    const uv = [];
    const idx = [];
    let s = 0;
    for (let i = 0; i <= track.count; i++) {
      const j = track.closed ? track.wrap(i) : Math.min(i, track.count - 1);
      if (!track.closed && i === track.count) break;
      track.pointAt(j, sg * (layout.barrier[side][j] + 0.9), _p);
      pos.push(_p.x, _p.y + 0.9, _p.z, _p.x, _p.y + 4.1, _p.z);
      uv.push(s / 3.2, 0, s / 3.2, 1);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      s += track.step;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = false;
    group.add(m);
  }
}

/** Groups of spectators standing back from the outside of corners, facing the road. */
function spectators(track, layout, terrain, corners, rand, batch, groups, back) {
  if (!groups) return;
  // a person: legs, jacket, head (merged; the instance colour tints the jacket-ish whole)
  const body = mergeGeometries([
    new THREE.BoxGeometry(0.34, 0.85, 0.22).translate(0, 0.43, 0),
    new THREE.BoxGeometry(0.46, 0.62, 0.28).translate(0, 1.15, 0),
    new THREE.SphereGeometry(0.13, 6, 5).translate(0, 1.62, 0),
  ]);
  const people = batch(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }));
  const jackets = [0xd8382c, 0x2f5fa3, 0xf2c230, 0x2e8a4a, 0xe8e8e2, 0x2a2a2e, 0xe0702a, 0x7a4aa0];
  const picks = corners.filter((c) => c.radius < 120).sort(() => rand() - 0.5).slice(0, groups);
  for (const c of picks) {
    const side = c.sign > 0 ? 'L' : 'R';
    const sg = side === 'L' ? -1 : 1;
    const n = 4 + Math.floor(rand() * 9);
    for (let k = 0; k < n; k++) {
      const i = track.wrap(c.apex + Math.round((rand() - 0.5) * 10));
      if (layout.tunnel[i]) continue;
      const l = sg * (edgeAt(layout, track, side, i, 2) + back + rand() * 5);
      const p = at(track, terrain, i, l);
      // face the road (rotating +Z toward the centreline), with a bit of individual turn
      const yaw = track.yaw[i] + (sg > 0 ? -Math.PI / 2 : Math.PI / 2) + (rand() - 0.5) * 0.8;
      people.add(p.x + (rand() - 0.5) * 2, p.y, p.z + (rand() - 0.5) * 2, yaw, 0.92 + rand() * 0.16, jackets[Math.floor(rand() * jackets.length)]);
    }
  }
}
