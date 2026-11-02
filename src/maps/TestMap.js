import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Textures, labelTexture } from './textures.js';
import { disposeGroup } from './dispose.js';
import { Cones } from './Cones.js';

// Phase (a) proving ground: a flat field with a 1.5 km runway, a handling pad with a skidpad
// circle and slalom cones, and patches of every surface type side by side.
// Forward for the spawn is -Z. Units are metres.

const ZONES = [
  // [x0, x1, z0, z1, surface, texture, tiling (m per repeat)]
  [-15, 15, -760, 760, 'asphalt', 'asphalt', 8],
  [15, 300, -130, 130, 'asphalt', 'asphalt', 8],
  [15, 300, 150, 400, 'wet', 'wet', 8],
  [-300, -15, -130, 130, 'dirt', 'dirt', 6],
  [-300, -15, 150, 400, 'snow', 'snow', 6],
  [-300, -15, -400, -150, 'ice', 'ice', 12],
  [15, 300, -400, -150, 'gravel', 'dirt', 4],
];

const ZONE_LABELS = { asphalt: 'Asphalt pad', wet: 'Wet asphalt', dirt: 'Dirt', snow: 'Snow', ice: 'Ice', gravel: 'Gravel' };

function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class TestMap {
  constructor(gfx, physics, quality = 'medium') {
    this.id = 'proving_ground';
    this.name = 'Proving Ground';
    this.scene = gfx.scene;
    this.physics = physics;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.spawn = { position: new THREE.Vector3(0, 0, 680), yaw: 0 };
    this.weather = { grip: 1 };

    this._ground();
    this._zones();
    this._markings();
    this._ramps();
    this._walls();
    this._cones();
    this._trees(quality);
    this._boards();
  }

  surfaceAt(x, z) {
    for (const [x0, x1, z0, z1, surface] of ZONES) {
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return surface;
    }
    return 'grass';
  }

  _ground() {
    // subdivided plane with vertex-colour variation so the grass tiling doesn't show
    const size = 2400;
    const geo = new THREE.PlaneGeometry(size, size, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n = 0.82 + 0.18 * Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * Math.cos(z * 0.013 - x * 0.004);
      colors[i * 3] = n;
      colors[i * 3 + 1] = n;
      colors[i * 3 + 2] = n * 0.95;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const tex = Textures.grass().clone();
    tex.userData.shared = false;
    tex.repeat.set(size / 8, size / 8);
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95 }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // the physics ground resolves its surface from the zone table
    this.physics.addBox({ x: 0, y: -1, z: 0 }, { x: size / 2, y: 1, z: size / 2 }, { surface: 'auto' });
  }

  _zones() {
    for (const [x0, x1, z0, z1, , texName, tile] of ZONES) {
      const w = x1 - x0;
      const d = z1 - z0;
      const tex = Textures[texName]().clone();
      tex.userData.shared = false;
      tex.repeat.set(w / tile, d / tile);
      tex.needsUpdate = true;
      const wet = texName === 'wet' || texName === 'ice';
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: wet ? 0.12 : 0.9,
        metalness: wet ? 0.25 : 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((x0 + x1) / 2, 0.005, (z0 + z1) / 2);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  _markings() {
    const white = new THREE.MeshBasicMaterial({ color: 0xe8e8e0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const geos = [];
    const strip = (x, z, w, d) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, 0.01, z);
      geos.push(g);
    };
    // runway edges, centre dashes, start line and 100 m ticks
    strip(-13.5, 0, 0.3, 1520);
    strip(13.5, 0, 0.3, 1520);
    for (let z = -740; z < 740; z += 24) strip(0, z, 0.25, 12);
    strip(0, 660, 27, 0.6);
    for (let z = 660; z > -760; z -= 100) {
      strip(-11, z, 4, 0.3);
      strip(11, z, 4, 0.3);
    }
    // skidpad: 40 m radius ring + centre spot
    const ring = new THREE.RingGeometry(39.8, 40.2, 160);
    ring.rotateX(-Math.PI / 2);
    ring.translate(170, 0.01, 0);
    geos.push(ring);
    const inner = new THREE.RingGeometry(19.8, 20.2, 120);
    inner.rotateX(-Math.PI / 2);
    inner.translate(170, 0.01, 0);
    geos.push(inner);
    const mesh = new THREE.Mesh(mergeGeometries(geos), white);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  _ramps() {
    const mat = new THREE.MeshStandardMaterial({ map: Textures.concrete(), roughness: 0.85 });
    const addHull = (pts) => {
      const geo = new ConvexGeometry(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.physics.addHull(pts.flat(), { surface: 'asphalt' });
    };
    // wedge rising toward -Z (approach from +Z): x centre, z of the low end, length, height, width
    const wedge = (x, zLow, len, h, w) => {
      const zHigh = zLow - len;
      addHull([
        [x - w / 2, 0, zLow], [x + w / 2, 0, zLow],
        [x - w / 2, 0, zHigh], [x + w / 2, 0, zHigh],
        [x - w / 2, h, zHigh], [x + w / 2, h, zHigh],
      ]);
    };
    const box = (x, z, len, h, w) => {
      addHull([
        [x - w / 2, 0, z + len / 2], [x + w / 2, 0, z + len / 2], [x - w / 2, 0, z - len / 2], [x + w / 2, 0, z - len / 2],
        [x - w / 2, h, z + len / 2], [x + w / 2, h, z + len / 2], [x - w / 2, h, z - len / 2], [x + w / 2, h, z - len / 2],
      ]);
    };
    // kicker
    wedge(260, -40, 7, 1.1, 8);
    // table-top: up 9 m, flat 12 m, down 9 m
    wedge(260, 110, 9, 1.6, 9);
    box(260, 95, 12, 1.6, 9);
    addHull([
      [255.5, 0, 89], [264.5, 0, 89], [255.5, 1.6, 89], [264.5, 1.6, 89],
      [255.5, 0, 80], [264.5, 0, 80],
    ]);
    // speed bumps across the pad
    for (const z of [-100, -85, -70]) {
      addHull([
        [40, 0, z + 0.6], [120, 0, z + 0.6], [40, 0, z - 0.6], [120, 0, z - 0.6],
        [40, 0.1, z + 0.25], [120, 0.1, z + 0.25], [40, 0.1, z - 0.25], [120, 0.1, z - 0.25],
      ]);
    }
    // a small dirt jump in the dirt zone
    wedge(-160, -20, 6, 0.9, 7);
  }

  _walls() {
    const mat = new THREE.MeshStandardMaterial({ map: Textures.concrete(), roughness: 0.9 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.6 });
    const wall = (x, z, lenX, lenZ, h = 1.1) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(lenX, h, lenZ), mat);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const top = new THREE.Mesh(new THREE.BoxGeometry(lenX + 0.02, 0.12, lenZ + 0.02), stripe);
      top.position.set(x, h - 0.06, z);
      this.group.add(top);
      this.physics.addBox({ x, y: h / 2, z }, { x: lenX / 2, y: h / 2, z: lenZ / 2 }, { surface: 'asphalt', friction: 0.3 });
    };
    wall(301, 0, 1, 260); // pad outer wall
    wall(158, -131, 286, 1);
    wall(0, -770, 40, 1.2, 1.4); // runway end
    // field boundary
    for (const [x, z, lx, lz] of [[0, -1100, 2200, 2], [0, 1100, 2200, 2], [-1100, 0, 2, 2200], [1100, 0, 2, 2200]]) wall(x, z, lx, lz, 2);
  }

  _cones() {
    const positions = [];
    for (let i = 0; i < 10; i++) positions.push([50 + i * 20, 70]); // slalom
    for (let a = 0; a < 16; a++) positions.push([170 + Math.cos((a / 16) * Math.PI * 2) * 20, Math.sin((a / 16) * Math.PI * 2) * 20]);
    for (let i = 0; i < 6; i++) positions.push([-6 + (i % 2) * 12, 400 - i * 40]); // runway gates
    this.cones = new Cones(this.physics, this.group, positions);
  }

  _trees(quality) {
    const rand = rng(7);
    const blocked = (x, z) => {
      if (Math.abs(x) < 40 && Math.abs(z) < 800) return true;
      for (const [x0, x1, z0, z1] of ZONES) if (x > x0 - 25 && x < x1 + 25 && z > z0 - 25 && z < z1 + 25) return true;
      return false;
    };
    const spots = [];
    while (spots.length < 520) {
      const x = (rand() - 0.5) * 2100;
      const z = (rand() - 0.5) * 2100;
      if (!blocked(x, z)) spots.push([x, z, 0.8 + rand() * 0.7, rand() * Math.PI]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.4, 6);
    trunkGeo.translate(0, 1.2, 0);
    const leafGeo = new THREE.ConeGeometry(2.2, 6, 7);
    leafGeo.translate(0, 5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.85, flatShading: true }), spots.length);
    trunks.castShadow = leaves.castShadow = quality !== 'low';
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach(([x, z, sc, rot], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc, sc));
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      this.physics.addCylinder({ x, y: 1.2 * sc, z }, 1.2 * sc, 0.3 * sc, { surface: 'grass' });
    });
    this.group.add(trunks, leaves);
  }

  _boards() {
    // distance boards along the runway (metres from the start line) and zone signs
    const post = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 });
    const sign = (text, x, z, rotY) => {
      const mat = new THREE.MeshStandardMaterial({ map: labelTexture(text, { width: 512, height: 128 }), roughness: 0.7 });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), mat);
      board.position.set(x, 2.2, z);
      board.rotation.y = rotY;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.7, 0.12), post);
      p.position.set(x, 0.85, z);
      board.castShadow = true;
      this.group.add(board, p);
    };
    for (let d = 100; d <= 1400; d += 100) sign(`${d} m`, -17, 660 - d, Math.PI / 2);
    for (const [x0, x1, z0, z1, surface] of ZONES.slice(1)) {
      const x = x0 < 0 ? x1 + 1 : x0 - 1;
      sign(ZONE_LABELS[surface], x, (z0 + z1) / 2, x0 < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  update() {
    this.cones.sync();
  }

  dispose() {
    disposeGroup(this.group);
  }
}
