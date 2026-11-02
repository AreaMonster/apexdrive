import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { resolveBodyShape } from './bodyShape.js';

// Shared materials (paint is per car).
const MATS = {
  glass: new THREE.MeshStandardMaterial({ color: 0x1d2835, metalness: 0.7, roughness: 0.06 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.2, roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.18 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.4, roughness: 0.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.6, roughness: 0.3 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.85, roughness: 0.3 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffb84d, emissiveIntensity: 0.9, roughness: 0.2 }),
  stripeLight: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, metalness: 0.3, roughness: 0.3 }),
  stripeDark: new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.3, roughness: 0.35 }),
  seat: new THREE.MeshStandardMaterial({ color: 0x2b1d17, roughness: 0.8 }),
};

const FINISH = {
  metallic: { metalness: 0.55, roughness: 0.32 },
  gloss: { metalness: 0.15, roughness: 0.2 },
  satin: { metalness: 0.1, roughness: 0.55 },
};

const rimMats = new Map();
function rimMaterial(color) {
  if (!rimMats.has(color)) rimMats.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.3 }));
  return rimMats.get(color);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Collects geometry per material and merges it into one mesh each (few draw calls per car). */
class PartBuilder {
  constructor() {
    this.parts = new Map();
  }

  add(geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    g.deleteAttribute('uv');
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
  }

  box(w, h, d, material, x, y, z, rx, ry, rz) {
    this.add(new THREE.BoxGeometry(w, h, d), material, x, y, z, rx, ry, rz);
  }

  build(group, castShadow = true) {
    const meshes = [];
    for (const [mat, geoms] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geoms), mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      group.add(mesh);
      meshes.push(mesh);
      for (const g of geoms) g.dispose();
    }
    return meshes;
  }
}

// Side silhouette of the lower body (forward = +X, up = +Y) with wheel arches cut out.
function bodyProfile(s) {
  const archR = s.wheelRadius + 0.07;
  const cy = Math.max(s.wheelRadius, s.clearance + 0.02);
  const sh = new THREE.Shape();
  const xr = -s.wb / 2;
  const xf = s.wb / 2;
  sh.moveTo(s.rear, s.clearance + 0.12);
  sh.lineTo(s.rear + 0.08, s.clearance);
  for (const ax of [xr, xf]) {
    sh.lineTo(ax - archR, s.clearance);
    sh.lineTo(ax - archR, cy);
    sh.absarc(ax, cy, archR, Math.PI, 0, true);
    sh.lineTo(ax + archR, s.clearance);
  }
  sh.lineTo(s.front - 0.1, s.clearance);
  sh.lineTo(s.front, s.clearance + 0.12);
  sh.lineTo(s.front, s.noseY - 0.06);
  sh.lineTo(s.front - 0.14, s.noseY);
  sh.lineTo(s.xWs, s.hoodY);
  sh.lineTo(s.xCr, s.beltY);
  if (s.xCr - s.rear > 0.3) {
    sh.lineTo(s.rear + 0.14, s.deckY);
    sh.lineTo(s.rear, s.deckY - 0.07);
  } else {
    sh.lineTo(s.rear, s.beltY - 0.05);
  }
  sh.closePath();
  return sh;
}

// ground-frame (forward +X) → three (forward -Z)
const V = (fwd, y, x) => new THREE.Vector3(x, y, -fwd);

/**
 * Quad shrunk toward its centre and pushed out along its normal, so it sits on the cabin
 * surface with a painted frame around it. The normal (and triangle winding) is oriented away
 * from `inside`. inset / insetV: horizontal / vertical shrink fractions.
 */
function glassPanel(corners, inside, inset, insetV) {
  const c = new THREE.Vector3();
  for (const p of corners) c.add(p);
  c.multiplyScalar(0.25);
  const n = new THREE.Vector3()
    .subVectors(corners[2], corners[0])
    .cross(new THREE.Vector3().subVectors(corners[3], corners[1]))
    .normalize();
  const flip = n.dot(new THREE.Vector3().subVectors(c, inside)) < 0;
  if (flip) n.negate();
  const pts = corners.map((p) => {
    const d = new THREE.Vector3().subVectors(p, c);
    return new THREE.Vector3(c.x + d.x * (1 - inset), c.y + d.y * (1 - insetV), c.z + d.z * (1 - inset)).addScaledVector(n, 0.012);
  });
  const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  const g = new THREE.BufferGeometry().setFromPoints(order.map((i) => pts[i]));
  g.computeVertexNormals();
  return g;
}

/**
 * Wheel: tyre (with tread blocks on off-road tyres) and a rim. rims.spokes = 0 gives a steel
 * wheel with a hubcap; size is the rim diameter as a fraction of the tyre's.
 */
function buildWheel(radius, width, isLeft, rims = {}, knobbly = false) {
  const group = new THREE.Group();
  const tb = new PartBuilder();
  tb.add(new THREE.CylinderGeometry(radius, radius, width, 22, 1), MATS.tire, 0, 0, 0, 0, 0, Math.PI / 2);
  if (knobbly) {
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const off = (i % 2 ? 0.22 : -0.22) * width;
      tb.box(width * 0.42, 0.045, 0.09, MATS.tire, off, Math.cos(a) * radius, Math.sin(a) * radius, a, 0, 0);
    }
  }
  tb.build(group);
  const pb = new PartBuilder();
  const outer = (isLeft ? -1 : 1) * (width / 2 + 0.004);
  const rimR = radius * (rims.size ?? 0.64);
  const mat = rimMaterial(rims.color || '#b9bec4');
  pb.add(new THREE.CylinderGeometry(rimR, rimR, width * 1.02, 16), mat, 0, 0, 0, 0, 0, Math.PI / 2);
  const spokes = rims.spokes ?? 5;
  if (spokes === 0) {
    // steel wheel: plain disc with a domed chrome hubcap
    pb.add(new THREE.CylinderGeometry(rimR * 0.55, rimR * 0.62, 0.05, 16), MATS.chrome, outer, 0, 0, 0, 0, Math.PI / 2);
  } else {
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      pb.box(0.02, rimR * 1.85, spokes > 7 ? 0.035 : 0.06, mat, outer, 0, 0, a, 0, 0);
    }
    pb.add(new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, 0.03, 10), MATS.chrome, outer, 0, 0, 0, 0, Math.PI / 2);
  }
  // dark barrel behind the spokes so the rim reads as a wheel, not a solid disc
  pb.add(new THREE.CylinderGeometry(rimR * 0.92, rimR * 0.92, 0.01, 16), MATS.trim, outer * 0.6, 0, 0, 0, 0, Math.PI / 2);
  pb.build(group);
  return group;
}

/** Box from (x0, y0) to (x1, y1) in the ground frame (forward +X), centred laterally at `lat`. */
function slopedBox(pb, mat, x0, y0, x1, y1, lat, width, thick, lift = 0.012) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  // a box's +Z axis rotated about X by θ becomes (0, -sin θ, cos θ); we want (0, dy, -dx)/len
  pb.box(width, thick, Math.hypot(dx, dy), mat, lat, (y0 + y1) / 2 + lift, -(x0 + x1) / 2, Math.atan2(-dy, -dx), 0, 0);
}

// The bevelled extrusion puts the lower body's skin ~4 cm outside its profile line, so parts
// that lie on the hood, deck or bed are lifted by this much to sit on top of it.
const SKIN = 0.045;

/** Open two-seater: framed windscreen, dark tub, seats, steering wheel and roll hoops. */
function buildCockpit(pb, s, paint, fb, ft) {
  const inside = new THREE.Vector3(0, s.beltY - 0.3, -(s.xWs + s.xCr) / 2);
  pb.add(glassPanel([fb[0], fb[1], ft[1], ft[0]], inside, 0.05, 0.06), MATS.glass);
  const tw = (s.W / 2) * s.taper;
  pb.box(tw * 2 + 0.04, 0.045, 0.05, paint, 0, s.roofY, -s.xRf);
  for (const sd of [-1, 1]) slopedBox(pb, paint, s.xWs - 0.02, s.beltY - 0.03, s.xRf, s.roofY, sd * (tw + 0.02), 0.05, 0.05, 0);
  // tub floor, flush with the body top
  pb.box(s.W * 0.8, 0.03, s.xWs - s.xCr - 0.1, MATS.trim, 0, s.beltY + SKIN, -(s.xWs + s.xCr) / 2);
  for (const sd of [-1, 1]) {
    const x = sd * 0.36;
    pb.box(0.46, 0.14, 0.48, MATS.seat, x, s.beltY + 0.04, -(s.xCr + 0.5));
    pb.box(0.46, 0.5, 0.12, MATS.seat, x, s.beltY + 0.28, -(s.xCr + 0.22), 0.22, 0, 0);
    // roll hoop: half torus standing upright behind each seat
    pb.add(new THREE.TorusGeometry(0.2, 0.03, 6, 12, Math.PI), MATS.chrome, x, s.beltY + 0.12, -(s.xCr + 0.08));
  }
  pb.add(new THREE.TorusGeometry(0.16, 0.022, 6, 16), MATS.trim, -0.36, s.beltY + 0.28, -(s.xWs - 0.42), -0.45, 0, 0);
}

/** Bolt-on parts named in def.body.extras. Ground frame: forward +X (three z = -X). */
function addExtras(pb, s, extras, paint, def) {
  const hw = s.W / 2;
  const tw = hw * s.taper;
  const r = s.wheelRadius;
  const archR = r + 0.07;
  const cy = Math.max(r, s.clearance + 0.02);

  if (extras.has('flares')) {
    for (const ax of [-s.wb / 2, s.wb / 2]) {
      for (const sd of [-1, 1]) pb.box(0.1, 0.13, archR * 2.3, paint, sd * (hw + 0.03), cy + archR * 0.72, -ax);
    }
  }
  if (extras.has('roofSpoiler')) pb.box(tw * 1.9, 0.04, 0.3, MATS.trim, 0, s.roofY - 0.01, -(s.xRr - 0.1), 0.18, 0, 0);
  if (extras.has('splitter')) pb.box(s.W * 0.96, 0.03, 0.2, MATS.trim, 0, s.clearance + 0.005, -(s.front + 0.05));
  if (extras.has('sideIntakes')) {
    const x = -s.wb / 2 + archR + 0.35;
    for (const sd of [-1, 1]) pb.box(0.04, 0.2, 0.55, MATS.trim, sd * (hw + 0.01), (s.clearance + s.beltY) / 2 + 0.05, -x);
  }
  if (extras.has('diffuser')) {
    pb.box(s.W * 0.78, 0.1, 0.3, MATS.trim, 0, s.clearance + 0.03, -(s.rear + 0.12));
    for (let k = -2; k <= 2; k++) pb.box(0.02, 0.14, 0.32, MATS.trim, k * 0.3, s.clearance + 0.08, -(s.rear + 0.12));
  }
  if (extras.has('engineCover')) {
    for (let k = 0; k < 6; k++) {
      const x = s.xCr - 0.1 - k * 0.14;
      if (x < s.rear + 0.2) break;
      pb.box(s.W * 0.5, 0.025, 0.06, MATS.trim, 0, s.beltY + SKIN + k * 0.005, -x);
    }
  }
  if (extras.has('wing')) {
    const y = s.deckY + 0.5;
    const x = s.rear + 0.28;
    pb.box(s.W * 0.96, 0.05, 0.4, MATS.trim, 0, y, -x, 0.12, 0, 0);
    for (const sd of [-1, 1]) {
      pb.box(0.05, 0.5, 0.14, MATS.trim, sd * hw * 0.45, y - 0.25, -x);
      pb.box(0.03, 0.22, 0.46, MATS.trim, sd * hw * 0.98, y + 0.03, -x);
    }
  }
  if (extras.has('roofScoop')) pb.box(0.3, 0.14, 0.55, MATS.trim, 0, s.roofY + 0.07, -(s.xRr + 0.2));
  if (extras.has('stripes')) {
    const c = new THREE.Color(def.colors[0]);
    const mat = c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6 ? MATS.stripeDark : MATS.stripeLight;
    for (const sd of [-1, 1]) {
      const lat = sd * 0.13;
      slopedBox(pb, mat, s.front - 0.15, s.noseY, s.xWs, s.hoodY, lat, 0.15, 0.01, SKIN);
      if (!s.open) slopedBox(pb, mat, s.xRf, s.roofY, s.xRr, s.roofY, lat, 0.15, 0.01, 0.006);
      if (s.xCr - s.rear > 0.3) slopedBox(pb, mat, s.xCr, s.beltY, s.rear + 0.14, s.deckY, lat, 0.15, 0.01, SKIN);
    }
  }
  if (extras.has('bullbar')) {
    const z = -(s.front + 0.16);
    for (const sd of [-1, 1]) pb.box(0.06, s.noseY - s.clearance + 0.05, 0.06, MATS.trim, sd * 0.45, (s.noseY + s.clearance) / 2, z);
    pb.box(1.0, 0.06, 0.06, MATS.trim, 0, s.noseY + 0.02, z);
    pb.box(1.0, 0.06, 0.06, MATS.trim, 0, s.clearance + 0.12, z);
  }
  if (extras.has('roofRack')) {
    const len = s.xRf - s.xRr - 0.2;
    const xm = (s.xRf + s.xRr) / 2;
    for (const sd of [-1, 1]) pb.box(0.05, 0.05, len, MATS.trim, sd * tw * 0.9, s.roofY + 0.09, -xm);
    for (let k = 0; k < 4; k++) pb.box(tw * 1.8, 0.04, 0.05, MATS.trim, 0, s.roofY + 0.08, -(s.xRr + 0.15 + (k * len) / 3));
    pb.box(tw * 1.1, 0.22, len * 0.45, MATS.trim, 0, s.roofY + 0.22, -(xm + len * 0.15));
  }
  if (extras.has('bed')) pb.box(s.W * 0.86, 0.02, s.xCr - s.rear - 0.25, MATS.trim, 0, s.deckY + SKIN, -((s.xCr + s.rear) / 2 - 0.02));
  if (extras.has('cage')) {
    // tubular cage over the bed: two hoops joined at the top and braced to the cab roof
    for (const x of [s.xCr - 0.25, s.rear + 0.35]) {
      for (const sd of [-1, 1]) pb.box(0.06, s.roofY - s.deckY - 0.1, 0.06, MATS.trim, sd * hw * 0.82, (s.roofY + s.deckY) / 2 - 0.05, -x);
      pb.box(s.W * 0.82 + 0.06, 0.06, 0.06, MATS.trim, 0, s.roofY - 0.1, -x);
    }
    for (const sd of [-1, 1]) slopedBox(pb, MATS.trim, s.xCr - 0.25, s.roofY - 0.1, s.rear + 0.35, s.roofY - 0.1, sd * hw * 0.82, 0.06, 0.06, 0);
  }
  if (extras.has('spare')) {
    const tyre = new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.26, 16);
    if (s.xCr - s.rear > 0.8) pb.add(tyre, MATS.tire, 0, s.deckY + 0.14, -((s.xCr + s.rear) / 2 - 0.1)); // flat in the bed
    else pb.add(tyre, MATS.tire, 0, s.beltY - 0.05, -(s.rear - 0.16), Math.PI / 2, 0, 0); // on the tailgate
  }
  if (extras.has('lightBar')) {
    pb.box(s.W * 0.8, 0.1, 0.12, MATS.trim, 0, s.roofY + 0.1, -(s.xRf - 0.08));
    for (let k = -3; k <= 3; k++) pb.box(0.16, 0.06, 0.02, MATS.amber, k * 0.2, s.roofY + 0.1, -(s.xRf - 0.01));
  }
}

/**
 * Build a stylised car mesh from data. Returns { root, setColor, update, dispose }.
 * `root` is placed at the physics body origin each frame; the body is modelled in a ground
 * frame and shifted down by the anchor height.
 */
export function buildCarModel(def, spec, colorIndex = 0, { ghost = false } = {}) {
  const s = resolveBodyShape(def);
  const extras = new Set(def.body.extras || []);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = -spec.anchorHeight;
  root.add(body);

  const paint = new THREE.MeshStandardMaterial({
    color: def.colors[colorIndex % def.colors.length],
    ...(FINISH[def.body.finish] || FINISH.metallic),
  });
  // per-car light materials so brake lights and headlights can change per car
  const tailMat = MATS.tail.clone();
  const headMat = MATS.head.clone();
  const pb = new PartBuilder();
  const hw = s.W / 2;

  // lower body: extruded profile with bevelled edges
  const bevel = 0.05;
  const lower = new THREE.ExtrudeGeometry(bodyProfile(s), {
    depth: s.W - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: 0.04,
    bevelSegments: 2,
    curveSegments: 10,
  });
  lower.translate(0, 0, -(s.W - bevel * 2) / 2);
  lower.rotateY(Math.PI / 2);
  pb.add(lower, paint);

  // cabin: painted convex hull between the belt line and the (narrower) roof, with inset glass
  // panels on each face; the paint left around the panels reads as pillars and roof
  const bw = hw * 0.95;
  const tw = hw * s.taper;
  const by = s.beltY - 0.03;
  const fb = [V(s.xWs - 0.02, by, -bw), V(s.xWs - 0.02, by, bw)]; // front base L, R
  const rb = [V(s.xCr, by, -bw), V(s.xCr, by, bw)];
  const ft = [V(s.xRf, s.roofY, -tw), V(s.xRf, s.roofY, tw)];
  const rt = [V(s.xRr, s.roofY, -tw), V(s.xRr, s.roofY, tw)];
  if (s.open) {
    buildCockpit(pb, s, paint, fb, ft);
  } else {
    const cabin = [...fb, ...rb, ...ft, ...rt];
    pb.add(new ConvexGeometry(cabin), paint);
    const inside = cabin.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / cabin.length);
    pb.add(glassPanel([fb[0], fb[1], ft[1], ft[0]], inside, 0.1, 0.08), MATS.glass); // windscreen
    pb.add(glassPanel([rb[1], rb[0], rt[0], rt[1]], inside, 0.12, 0.1), MATS.glass); // rear window
    pb.add(glassPanel([fb[1], rb[1], rt[1], ft[1]], inside, 0.07, 0.14), MATS.glass); // right side
    pb.add(glassPanel([rb[0], fb[0], ft[0], rt[0]], inside, 0.07, 0.14), MATS.glass); // left side
  }

  // bumpers, skirts, grille
  const bumperMat = extras.has('chromeBumpers') ? MATS.chrome : MATS.trim;
  pb.box(s.W * 0.98, 0.17, 0.2, bumperMat, 0, s.clearance + 0.09, -(s.front - 0.07));
  pb.box(s.W * 0.98, 0.17, 0.2, bumperMat, 0, s.clearance + 0.09, -(s.rear + 0.07));
  pb.box(s.W * 0.42, 0.12, 0.05, MATS.trim, 0, s.noseY - 0.17, -(s.front + 0.005));
  const skirtLen = s.wb - (s.wheelRadius + 0.07) * 2 - 0.05;
  for (const side of [-1, 1]) pb.box(0.04, 0.09, skirtLen, MATS.trim, side * (hw + 0.005), s.clearance + 0.05, 0);

  // lights
  for (const side of [-1, 1]) {
    // lights sit just proud of the bevelled surface (the bevel pushes the skin out ~0.04 m)
    if (extras.has('roundLights')) {
      pb.add(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 16), headMat, side * hw * 0.62, s.noseY - 0.12, -(s.front + 0.04), Math.PI / 2, 0, 0);
    } else {
      pb.box(0.3, 0.08, 0.06, headMat, side * hw * 0.66, s.noseY - 0.09, -(s.front + 0.04));
    }
    const tailY = (s.xCr - s.rear > 0.3 ? s.deckY : s.beltY) - 0.16;
    pb.box(0.32, 0.08, 0.05, tailMat, side * hw * 0.66, tailY, -(s.rear - 0.04));
    // mirrors
    pb.box(0.14, 0.08, 0.1, paint, side * (hw + 0.07), s.beltY + 0.07, -(s.xWs - 0.12));
  }

  // extras
  if (extras.has('spoiler')) {
    const wingY = s.deckY + 0.24;
    const wx = s.rear + 0.2;
    pb.box(s.W * 0.88, 0.04, 0.32, paint, 0, wingY, -wx);
    for (const side of [-1, 1]) pb.box(0.04, 0.24, 0.12, MATS.trim, side * hw * 0.55, wingY - 0.12, -wx);
  }
  if (extras.has('ducktail')) pb.box(s.W * 0.8, 0.05, 0.16, paint, 0, s.beltY + 0.02, -(s.rear + 0.06), -0.3, 0, 0);
  if (extras.has('scoop')) pb.box(0.5, 0.1, 0.6, MATS.trim, 0, s.hoodY + 0.02, -(s.xWs + 0.55));
  if (extras.has('roofVent')) pb.box(0.36, 0.08, 0.3, MATS.trim, 0, s.roofY + 0.06, -(s.xRf - 0.25));
  if (extras.has('rallyLights')) {
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.3;
      pb.add(new THREE.CylinderGeometry(0.085, 0.085, 0.07, 14), MATS.amber, x, s.noseY + 0.04, -(s.front + 0.04), Math.PI / 2, 0, 0);
    }
  }
  if (extras.has('mudflaps')) {
    for (const side of [-1, 1]) pb.box(0.22, 0.2, 0.02, MATS.trim, side * (s.track / 2), s.clearance - 0.03, -(-s.wb / 2 - s.wheelRadius - 0.12));
  }
  // exhausts
  let exX = [-hw * 0.55];
  if (extras.has('sideExhaust')) exX = [-0.12, 0.12].map((x) => x + hw * 0.55);
  if (extras.has('quadExhaust')) exX = [-1, 1].flatMap((sd) => [sd * (hw * 0.42 - 0.08), sd * (hw * 0.42 + 0.08)]);
  for (const x of exX) pb.add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), MATS.chrome, x, s.clearance + 0.07, -(s.rear - 0.02), Math.PI / 2, 0, 0);

  addExtras(pb, s, extras, paint, def);

  const bodyMeshes = pb.build(body);
  const original = bodyMeshes.map((m) => m.geometry.attributes.position.array.slice());

  // wheels: pivot (steer) → spin
  const wheels = spec.wheels.map((w) => {
    const pivot = new THREE.Group();
    const spin = buildWheel(spec.wheelRadius, s.wheelWidth, w.left, def.body.rims, def.tires?.type === 'offroad');
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin };
  });

  // soft contact shadow under the car (cheap and reads well on every quality level)
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(s.W * 1.15, s.L * 1.05), blobMaterial());
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0, -spec.anchorHeight + 0.02, -(s.front + s.rear) / 2);
  blob.renderOrder = 1;
  root.add(blob);

  // headlight pool on the road ahead: a cheap stand-in for a real spot light on AI cars (only
  // the player's car gets the actual SpotLight); off by day and for the player
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff0d6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 20).rotateX(-Math.PI / 2), beamMat);
  beam.position.set(0, -spec.anchorHeight + 0.08, -(s.front + 10.5));
  beam.renderOrder = 3;
  beam.visible = false;
  root.add(beam);

  // rest pose for wheels (used by ghosts, which have no suspension state)
  spec.wheels.forEach((w, i) => wheels[i].pivot.position.set(w.x, w.y - (spec.restLength - w.staticComp), w.z));

  if (ghost) {
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = ghostMaterial();
        o.castShadow = false;
      }
    });
    blob.visible = false;
  }

  const _pt = new THREE.Vector3();
  return {
    root,
    paint,
    /**
     * Push the body in around an impact. dir: body-frame horizontal direction the car was
     * pushed (so the impact came from -dir); severity 0..1.
     */
    dent(dir, severity) {
      const hw = s.W / 2;
      const hl = (s.front - s.rear) / 2;
      const zc = -(s.front + s.rear) / 2;
      // where a ray from the centre against -dir leaves the body's footprint box
      const t = Math.min(hw / Math.max(Math.abs(dir.x), 1e-3), hl / Math.max(Math.abs(dir.z), 1e-3));
      const jitter = (Math.random() - 0.5) * 0.6;
      _pt.set(-dir.x * t + dir.z * jitter, (s.clearance + s.beltY) / 2, zc - dir.z * t + dir.x * jitter);
      const depth = 0.06 + 0.26 * severity;
      const radius = 0.55 + 0.7 * severity;
      bodyMeshes.forEach((m, k) => {
        const pos = m.geometry.attributes.position;
        const a = pos.array;
        const o = original[k];
        for (let v = 0; v < a.length; v += 3) {
          const dx = a[v] - _pt.x;
          const dy = (a[v + 1] - _pt.y) * 0.7;
          const dz = a[v + 2] - _pt.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d >= radius) continue;
          const f = (1 - d / radius) ** 2 * depth;
          a[v] += dir.x * f;
          a[v + 1] -= f * 0.3;
          a[v + 2] += dir.z * f;
          // never crush a vertex more than 30 cm from where it started
          const ox = a[v] - o[v];
          const oy = a[v + 1] - o[v + 1];
          const oz = a[v + 2] - o[v + 2];
          const od = Math.sqrt(ox * ox + oy * oy + oz * oz);
          if (od > 0.3) {
            a[v] = o[v] + (ox * 0.3) / od;
            a[v + 1] = o[v + 1] + (oy * 0.3) / od;
            a[v + 2] = o[v + 2] + (oz * 0.3) / od;
          }
        }
        pos.needsUpdate = true;
        m.geometry.computeBoundingSphere();
      });
    },
    repair() {
      bodyMeshes.forEach((m, k) => {
        m.geometry.attributes.position.array.set(original[k]);
        m.geometry.attributes.position.needsUpdate = true;
        m.geometry.computeBoundingSphere();
      });
    },
    /** Ghost / replay placement without vehicle state. */
    setPose(position, quaternion) {
      root.position.copy(position);
      root.quaternion.copy(quaternion);
    },
    setColor(i) {
      paint.color.set(def.colors[i % def.colors.length]);
    },
    /** night 0..1 brightens head/tail lights; braking lights the tails up fully. */
    fakeBeam: false,
    setLights(night, braking) {
      beam.visible = this.fakeBeam && night > 0.05;
      beamMat.opacity = night * 0.42;
      headMat.emissiveIntensity = 1.4 + night * 2.5;
      tailMat.emissiveIntensity = braking ? 2.3 : 0.6 + night * 0.8;
    },
    /** Where headlights sit, in the root (body) frame, for attaching a spotlight. */
    headlightPos: new THREE.Vector3(0, s.noseY - 0.1 - spec.anchorHeight, -(s.front + 0.1)),
    update(vehicle, rs) {
      root.position.copy(rs.position);
      root.quaternion.copy(rs.quaternion);
      for (let i = 0; i < 4; i++) {
        const w = vehicle.wheels[i];
        const g = wheels[i];
        g.pivot.position.set(w.anchor.x, w.anchor.y - (spec.restLength - w.compression), w.anchor.z);
        g.pivot.rotation.y = -w.steer;
        g.spin.rotation.x = -w.rotation;
      }
    },
    dispose() {
      root.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      paint.dispose();
      tailMat.dispose();
      beamMat.dispose();
      headMat.dispose();
      root.removeFromParent();
    },
  };
}

let _ghostMat = null;
function ghostMaterial() {
  return (_ghostMat ||= new THREE.MeshStandardMaterial({
    color: 0x9fd4ff,
    emissive: 0x2a6fb0,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    roughness: 0.4,
  }));
}

let _blobMat = null;
function blobMaterial() {
  if (_blobMat) return _blobMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _blobMat = new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  return _blobMat;
}

let _beamTex = null;
/** Elongated pool of light: bright near the car, widening and fading down the road. */
function beamTexture() {
  if (_beamTex) return _beamTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) {
    const along = y / 127; // 0 = far end (top of the plane, ahead), 1 = near the car
    const width = 0.18 + (1 - along) * 0.32;
    for (let x = 0; x < 64; x++) {
      const across = Math.abs(x / 63 - 0.5) / width;
      const a = Math.max(0, 1 - across * across) * Math.pow(along, 0.6) * (1 - Math.pow(along, 8) * 0.6) * Math.min(1, (1 - along) * 6);
      const o = (y * 64 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  _beamTex = new THREE.CanvasTexture(c);
  return _beamTex;
}
