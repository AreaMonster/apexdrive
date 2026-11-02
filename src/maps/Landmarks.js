import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Textures } from './textures.js';
import { mulberry32 } from './noise.js';

// Set pieces that give each map its character: wind turbines on the coastal hills, a chapel on
// the pass, a parked airliner at the airfield, a rock arch and mesas in the canyon, log cabins in
// the forest, a red gate and stone lanterns on the touge, beach umbrellas and boats on the island.
//
// def.landmarks: [{ type, at (0..1 along the track) | x, z, side (-1 left / 1 right),
//                   offset (m beyond the road edge), yaw (extra turn), scale, count }]
// Returns { update(dt) } for the moving parts (turbine rotors, bobbing boats).

const UP = new THREE.Vector3(0, 1, 0);
const _p = { x: 0, y: 0, z: 0 };

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

export function buildLandmarks(track, terrain, def, physics, group) {
  const list = def.landmarks || [];
  const spinners = [];
  const bobbers = [];
  const rand = mulberry32((def.terrain?.seed ?? 1) + 91);
  const ground = (x, z) => (terrain?.heightAt ? terrain.heightAt(x, z) : 0);

  /** Resolve a placement to { x, y, z, yaw } (yaw faces the road for track-relative ones). */
  const place = (p, k = 0) => {
    if (p.at !== undefined) {
      const s = ((p.at + (p.spread ?? 0) * k) % 1) * track.length;
      const i = track.indexAtS(s);
      const sg = p.side ?? 1;
      track.pointAt(i, sg * (track.half[i] + (p.offset ?? 30) + (p.jitter ? rand() * p.jitter : 0)), _p);
      const yaw = track.yaw[i] + (sg > 0 ? -Math.PI / 2 : Math.PI / 2) + (p.yaw ?? 0);
      return { x: _p.x, y: ground(_p.x, _p.z), z: _p.z, yaw };
    }
    return { x: p.x, y: ground(p.x, p.z), z: p.z, yaw: p.yaw ?? 0 };
  };
  const solid = (x, y, z, yaw, hx, hy, hz) => {
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    physics.addBox({ x, y: y + hy, z }, { x: hx, y: hy, z: hz }, { rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, surface: 'asphalt', friction: 0.4 });
  };
  const put = (obj, pos, scale = 1) => {
    obj.position.set(pos.x, pos.y, pos.z);
    obj.rotation.y = pos.yaw;
    obj.scale.setScalar(scale);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(obj);
    return obj;
  };

  for (const p of list) {
    const n = p.count ?? 1;
    for (let k = 0; k < n; k++) {
      const pos = place(p, k);
      // boats need water under them; everything else needs dry land
      const sea = terrain?.seaLevel;
      if (sea !== null && sea !== undefined) {
        if (p.water ? pos.y > sea - 1.5 : pos.y < sea + 0.6) continue;
        if (p.water) pos.y = sea;
      } else if (p.water) continue;
      const sc = (p.scale ?? 1) * (n > 1 ? 0.85 + rand() * 0.3 : 1);
      const make = MAKERS[p.type];
      if (!make) continue;
      const { obj, spin, bob, box } = make(rand);
      put(obj, pos, sc);
      if (spin) spinners.push({ obj: spin, speed: 0.6 + rand() * 0.5 });
      if (bob) bobbers.push({ obj, y: pos.y, phase: rand() * 6 });
      if (box && physics) solid(pos.x, pos.y, pos.z, pos.yaw, box[0] * sc, box[1] * sc, box[2] * sc);
    }
  }
  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (const s of spinners) s.obj.rotation.z += dt * s.speed;
      for (const b of bobbers) {
        b.obj.position.y = b.y + Math.sin(t * 0.9 + b.phase) * 0.15;
        b.obj.rotation.z = Math.sin(t * 0.7 + b.phase) * 0.04;
      }
    },
  };
}

const MAKERS = {
  // modern wind turbine: 46 m tower, nacelle, three blades on a hub that turns
  turbine() {
    const obj = new THREE.Group();
    const white = std(0xeef0f2, { roughness: 0.5 });
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 46, 12).translate(0, 23, 0), white));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 5).translate(0, 47, -0.8), white));
    const rotor = new THREE.Group();
    rotor.position.set(0, 47, 1.8);
    const blade = new THREE.BoxGeometry(1.2, 19, 0.25).translate(0, 10, 0);
    const blades = mergeGeometries([0, 1, 2].map((k) => blade.clone().rotateZ((k / 3) * Math.PI * 2)));
    rotor.add(new THREE.Mesh(blades, white), new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), white));
    obj.add(rotor);
    return { obj, spin: rotor };
  },
  // alpine chapel: whitewashed nave, steep roof, bell tower with a spire
  chapel() {
    const obj = new THREE.Group();
    const wall = std(0xf1ece2);
    const roof = std(0x6a4a3a, { flatShading: true });
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(7, 5, 12).translate(0, 2.5, 0), wall));
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.2, 4, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 1.75).translate(0, 7, 0), roof));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 11, 3.2).translate(0, 5.5, 7), wall));
    obj.add(new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 4).rotateY(Math.PI / 4).translate(0, 14, 7), roof));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.1).translate(0, 1.3, -6.05), std(0x5a3a28)));
    return { obj, box: [3.5, 2.5, 6] };
  },
  // parked airliner: fuselage, nose, wings, tail, two engines (tail number in the livery stripe)
  plane() {
    const obj = new THREE.Group();
    const body = std(0xf2f4f6, { roughness: 0.35, metalness: 0.2 });
    const stripe = std(0x1f5aa8, { roughness: 0.4 });
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 34, 16).rotateX(Math.PI / 2).translate(0, 4, 0), body));
    obj.add(new THREE.Mesh(new THREE.SphereGeometry(2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 1.8).translate(0, 4, -17), body));
    obj.add(new THREE.Mesh(new THREE.ConeGeometry(2, 8, 16).rotateX(Math.PI / 2).translate(0, 4.6, 21), body));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(36, 0.45, 6).translate(0, 3.2, 1), body));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3).translate(0, 5.5, 21), body));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 5).translate(0, 8.5, 21.5), stripe));
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(2.02, 2.02, 30, 16, 1, true, -0.25, 0.5).rotateX(Math.PI / 2).translate(0, 4, 0), stripe));
    for (const x of [-7, 7]) obj.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.4, 12).rotateX(Math.PI / 2).translate(x, 2.2, -1), std(0xb8bec6, { metalness: 0.5, roughness: 0.3 })));
    for (const [x, z] of [[0, -13], [-3, 3], [3, 3]]) obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.2, 6).translate(x, 1.1, z), std(0x333333)));
    return { obj, box: [17, 3, 18] };
  },
  // natural rock arch with two buttresses
  arch() {
    const obj = new THREE.Group();
    const rock = std(0xc07a52, { map: Textures.rock(), flatShading: true });
    obj.add(new THREE.Mesh(new THREE.TorusGeometry(16, 4.5, 6, 18, Math.PI).scale(1, 1.1, 0.9), rock));
    for (const x of [-16, 16]) obj.add(new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 6, 7).translate(x, 0, 0), rock));
    return { obj };
  },
  // flat-topped mesa on the horizon
  mesa() {
    const obj = new THREE.Group();
    const rock = std(0xb5643e, { map: Textures.rock(), flatShading: true });
    const g = new THREE.CylinderGeometry(38, 55, 70, 9, 3).translate(0, 30, 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const s = 1 + Math.sin(i * 12.9898) * 0.08;
      if (y > -4) pos.setXYZ(i, pos.getX(i) * s, y, pos.getZ(i) * s);
    }
    g.computeVertexNormals();
    obj.add(new THREE.Mesh(g, rock));
    return { obj };
  },
  // log cabin with a stone chimney
  cabin() {
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(6, 3, 8).translate(0, 1.5, 0), std(0x7a5232, { map: Textures.logs() })));
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.2, 3, 4).rotateY(Math.PI / 4).scale(0.85, 1, 1.15).translate(0, 4.5, 0), std(0x3e4a36, { flatShading: true })));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 6, 1.1).translate(2.2, 3, 2.5), std(0x8a8680, { map: Textures.rock() })));
    return { obj, box: [3, 1.5, 4] };
  },
  // stacked logs
  logs() {
    const logGeo = new THREE.CylinderGeometry(0.28, 0.28, 6, 8).rotateZ(Math.PI / 2);
    const parts = [];
    for (let row = 0; row < 4; row++) for (let k = 0; k < 6 - row; k++) parts.push(logGeo.clone().translate((k % 2) * 0.2, 0.28 + row * 0.5, (k - (5 - row) / 2) * 0.58));
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(mergeGeometries(parts), std(0x8a6a48, { map: Textures.logs() })));
    return { obj, box: [3, 1, 1.8] };
  },
  // red timber gate (fictional) over a footpath
  gate() {
    const obj = new THREE.Group();
    const red = std(0xc0362c, { roughness: 0.6 });
    for (const x of [-2.6, 2.6]) obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 5.5, 10).translate(x, 2.75, 0), red));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.45, 0.6).translate(0, 5.4, 0), std(0x2a2422)));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.32, 0.4).translate(0, 4.4, 0), red));
    return { obj, box: [3, 2.8, 0.4] };
  },
  // stone lantern
  lantern() {
    const obj = new THREE.Group();
    const stone = std(0x9a958c, { map: Textures.rock() });
    obj.add(new THREE.Mesh(mergeGeometries([
      new THREE.CylinderGeometry(0.45, 0.6, 0.4, 6).translate(0, 0.2, 0),
      new THREE.CylinderGeometry(0.18, 0.18, 1.1, 6).translate(0, 0.95, 0),
      new THREE.BoxGeometry(0.8, 0.6, 0.8).translate(0, 1.8, 0),
      new THREE.ConeGeometry(0.75, 0.55, 4).rotateY(Math.PI / 4).translate(0, 2.4, 0),
    ]), stone));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.82), std(0x222222, { emissive: 0xffb050, emissiveIntensity: 1.2 })).translateY(1.8));
    return { obj, box: [0.4, 1.2, 0.4] };
  },
  // beach umbrella in a random colour
  umbrella(rand) {
    const cols = [0xe8503a, 0x2f7fd0, 0xf2c230, 0x2ea06a, 0xf0f0ea];
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5).translate(0, 1.2, 0), std(0xdddddd)));
    obj.add(new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 10).translate(0, 2.3, 0), std(cols[Math.floor(rand() * cols.length)], { flatShading: true, side: THREE.DoubleSide })));
    return { obj };
  },
  // small fishing boat bobbing on the water
  boat(rand) {
    const obj = new THREE.Group();
    const hull = new THREE.CylinderGeometry(1.4, 1.0, 7, 10, 1, false, 0, Math.PI).rotateZ(Math.PI).rotateX(Math.PI / 2).scale(1, 0.8, 1);
    obj.add(new THREE.Mesh(hull, std([0xf2f2ee, 0x2f5fa3, 0xc8302a][Math.floor(rand() * 3)], { side: THREE.DoubleSide })));
    obj.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.8).translate(0, 0.6, 0.8), std(0xf2f2ee)));
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 5).translate(0, 2.5, -1), std(0x6a5a48)));
    return { obj, bob: true };
  },
  // tall radio mast with red lights near the top
  radiomast() {
    const obj = new THREE.Group();
    const steel = std(0xc8ccd2, { metalness: 0.5, roughness: 0.4 });
    obj.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, 60, 4).translate(0, 30, 0), steel));
    for (const y of [30, 59]) obj.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6).translate(0, y, 0), std(0x330000, { emissive: 0xff2010, emissiveIntensity: 2.5 })));
    return { obj };
  },
};
