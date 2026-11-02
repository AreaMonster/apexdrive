import * as THREE from 'three';

// Tyre effects for every car: skid marks / ruts left on the ground, and smoke, dust and spray.
// Both work on Vehicle-shaped sources (live cars or replay proxies), one ring buffer each, so the
// cost is fixed no matter how long the session runs.

const MARK_SEGMENTS = { low: 1200, medium: 2500, high: 4000 };
const PARTICLES = { low: 220, medium: 450, high: 700 };

// ruts: colour + base opacity on loose ground (marks even without sliding); tarmac only when sliding
const MARK_STYLE = {
  asphalt: { c: [0.04, 0.04, 0.04], base: 0, skid: 0.75 },
  wet: { c: [0.06, 0.06, 0.07], base: 0, skid: 0.35 },
  kerb: { c: [0.05, 0.05, 0.05], base: 0, skid: 0.6 },
  dirt: { c: [0.22, 0.15, 0.1], base: 0.32, skid: 0.6 },
  gravel: { c: [0.26, 0.23, 0.2], base: 0.28, skid: 0.55 },
  sand: { c: [0.5, 0.4, 0.27], base: 0.35, skid: 0.5 },
  mud: { c: [0.16, 0.11, 0.07], base: 0.45, skid: 0.6 },
  grass: { c: [0.14, 0.2, 0.08], base: 0.22, skid: 0.5 },
  snow: { c: [0.62, 0.66, 0.74], base: 0.45, skid: 0.6 },
  lakeice: { c: [0.55, 0.6, 0.68], base: 0.22, skid: 0.4 },
  ice: { c: [0.6, 0.65, 0.72], base: 0, skid: 0.25 },
};
// what the tyres throw up: colour, opacity, size, lifetime, and whether it needs sliding
const PUFF = {
  smoke: { c: [0.86, 0.86, 0.86], a: 0.32, size: 1.4, grow: 4.2, life: 1.8, up: 0.9 },
  dirt: { c: [0.55, 0.42, 0.3], a: 0.3, size: 1.2, grow: 4, life: 1.6, up: 1.2 },
  gravel: { c: [0.62, 0.58, 0.52], a: 0.26, size: 1.1, grow: 3.6, life: 1.4, up: 1.1 },
  sand: { c: [0.83, 0.7, 0.5], a: 0.32, size: 1.3, grow: 4.4, life: 1.9, up: 1.2 },
  mud: { c: [0.3, 0.22, 0.14], a: 0.35, size: 0.6, grow: 1.2, life: 0.7, up: 2.2 },
  snow: { c: [0.95, 0.97, 1.0], a: 0.4, size: 0.9, grow: 3.2, life: 1.2, up: 1.6 },
  lakeice: { c: [0.92, 0.95, 1.0], a: 0.25, size: 0.8, grow: 2.6, life: 1.0, up: 1.2 },
  spray: { c: [0.82, 0.85, 0.9], a: 0.16, size: 0.9, grow: 3.0, life: 0.7, up: 0.8 },
};
const LOOSE = new Set(['dirt', 'gravel', 'sand', 'mud', 'snow', 'lakeice']);
// marks use a standard (colour-managed) material: the table above is sRGB, convert once
for (const m of Object.values(MARK_STYLE)) m.c = m.c.map((v) => THREE.MathUtils.clamp(new THREE.Color(v, v, v).convertSRGBToLinear().r, 0, 1));

const _up = new THREE.Vector3();
const _a = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Effects {
  constructor(scene, quality = 'medium') {
    this.scene = scene;
    this.marks = new SkidMarks(scene, MARK_SEGMENTS[quality] ?? 2500);
    this.particles = new Particles(scene, PARTICLES[quality] ?? 450);
    this.state = new Map(); // per car key: per-wheel last mark edge + emit accumulators
  }

  /** Forget mark continuity (after a reset / replay seek) so no streak joins two places. */
  breakTrails(key) {
    if (key === undefined) this.state.clear();
    else this.state.delete(key);
  }

  clear() {
    this.marks.clear();
    this.particles.clear();
    this.state.clear();
  }

  /** cars: [{ key, src }]; wet: 0..1 road wetness; light: 0..1 scene brightness */
  update(dt, cars, wet, light) {
    for (const { key, src } of cars) this._car(dt, key, src, wet);
    this.particles.update(dt, light);
    this.marks.mat.color.setScalar(light); // unlit material: dim with the scene at night
    this.marks.flush();
  }

  _car(dt, key, src, wet) {
    let st = this.state.get(key);
    if (!st) {
      st = src.wheels.map(() => ({ has: false, l: new THREE.Vector3(), r: new THREE.Vector3(), emit: 0 }));
      this.state.set(key, st);
    }
    const spec = src.spec;
    const rayLen = spec.restLength + spec.wheelRadius;
    _up.set(0, 1, 0).applyQuaternion(src.quat);
    _side.set(1, 0, 0).applyQuaternion(src.quat);
    const speed = src.speed;
    for (let i = 0; i < src.wheels.length; i++) {
      const w = src.wheels[i];
      const s = st[i];
      if (!w.contact || speed < 1) {
        s.has = false;
        continue;
      }
      // contact point: anchor pushed down the suspension to the ground
      _a.copy(w.anchor).applyQuaternion(src.quat).add(src.pos).addScaledVector(_up, -(rayLen - w.compression) + 0.025);
      const style = MARK_STYLE[w.surface] || MARK_STYLE.asphalt;
      const alpha = Math.min(0.85, style.base * Math.min(1, speed / 6) + (w.skid > 0.25 ? w.skid * style.skid : 0));
      // --- marks: a new quad every ~0.4 m while there's something to draw
      if (alpha > 0.04) {
        const half = spec.wheelRadius * 0.55;
        if (!s.has) {
          s.l.copy(_a).addScaledVector(_side, -half);
          s.r.copy(_a).addScaledVector(_side, half);
          s.has = true;
        } else {
          const cx = (s.l.x + s.r.x) / 2;
          const cz = (s.l.z + s.r.z) / 2;
          const moved = Math.hypot(_a.x - cx, _a.z - cz);
          if (moved > 4) s.has = false; // teleported
          else if (moved > 0.4) {
            const l = _a.clone().addScaledVector(_side, -half);
            const r = _a.clone().addScaledVector(_side, half);
            this.marks.add(s.l, s.r, l, r, style.c, alpha);
            s.l.copy(l);
            s.r.copy(r);
          }
        }
      } else s.has = false;

      // --- particles
      let kind = null;
      let rate = 0;
      if (LOOSE.has(w.surface)) {
        kind = w.surface;
        rate = Math.min(1, speed / 22) * 14 + w.skid * 30;
      } else if (w.skid > 0.3 && (w.surface === 'asphalt' || w.surface === 'kerb')) {
        kind = 'smoke';
        rate = (w.skid - 0.2) * 45;
      }
      if (wet > 0.3 && speed > 12 && !LOOSE.has(w.surface) && i >= 2) {
        // rear wheels throw a mist of spray off a wet road
        this._emit(dt, s, 'spray', wet * Math.min(1, speed / 35) * 22, src, speed);
      }
      if (kind) this._emit(dt, s, kind, rate, src, speed);
    }
  }

  _emit(dt, s, kind, rate, src) {
    s.emit += rate * dt;
    const p = PUFF[kind];
    while (s.emit >= 1) {
      s.emit -= 1;
      this.particles.spawn(_a, src.vel, p);
    }
  }

  dispose() {
    this.marks.dispose();
    this.particles.dispose();
  }
}

class SkidMarks {
  constructor(scene, segments) {
    this.n = segments;
    this.pos = new Float32Array(segments * 6 * 3);
    this.col = new Float32Array(segments * 6 * 4);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never culled
    this.geo = g;
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.head = 0;
    this.lo = Infinity;
    this.hi = -1;
  }

  add(l0, r0, l1, r1, c, a) {
    const k = this.head;
    this.head = (this.head + 1) % this.n;
    const P = this.pos;
    const C = this.col;
    const v = [l0, r0, l1, r0, r1, l1];
    for (let j = 0; j < 6; j++) {
      const o = (k * 6 + j) * 3;
      P[o] = v[j].x;
      P[o + 1] = v[j].y;
      P[o + 2] = v[j].z;
      const q = (k * 6 + j) * 4;
      C[q] = c[0];
      C[q + 1] = c[1];
      C[q + 2] = c[2];
      C[q + 3] = a;
    }
    if (k < this.lo) this.lo = k;
    if (k > this.hi) this.hi = k;
  }

  flush() {
    if (this.hi < 0) return;
    const { lo, hi } = this;
    for (const [attr, size] of [[this.posAttr, 3], [this.colAttr, 4]]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(lo * 6 * size, (hi - lo + 1) * 6 * size);
      attr.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }

  clear() {
    this.col.fill(0);
    this.colAttr.clearUpdateRanges();
    this.colAttr.needsUpdate = true;
    this.head = 0;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.mesh.removeFromParent();
  }
}

class Particles {
  constructor(scene, n) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.p = new Array(n).fill(null);
    this.head = 0;
    this.live = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aColor', this.colAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: 600 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_vertex>
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = min(aSize * uScale / -mvPosition.z, 400.0);
          vAlpha = aAlpha;
          vColor = aColor;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying float vAlpha;
        varying vec3 vColor;
        #include <fog_pars_fragment>
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          // soft puff with a little lumpy texture
          float a = (1.0 - r * r) * vAlpha * (0.85 + 0.15 * sin(d.x * 21.0 + d.y * 17.0));
          gl_FragColor = vec4(vColor * uLight, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  spawn(at, carVel, p) {
    const k = this.head;
    this.head = (this.head + 1) % this.n;
    const r = () => Math.random() - 0.5;
    this.pos[k * 3] = at.x + r() * 0.3;
    this.pos[k * 3 + 1] = at.y + 0.15;
    this.pos[k * 3 + 2] = at.z + r() * 0.3;
    // left behind the car: a fraction of its velocity, plus a kick up and some scatter
    this.vel[k * 3] = carVel.x * 0.25 + r() * 1.6;
    this.vel[k * 3 + 1] = p.up * (0.6 + Math.random() * 0.8);
    this.vel[k * 3 + 2] = carVel.z * 0.25 + r() * 1.6;
    this.col.set(p.c, k * 3);
    this.age[k] = 0;
    this.life[k] = p.life * (0.75 + Math.random() * 0.5);
    this.p[k] = p;
  }

  update(dt, light) {
    this.mat.uniforms.uLight.value = light;
    this.mat.uniforms.uScale.value = window.innerHeight * 0.9;
    const drag = Math.exp(-dt * 2.2);
    let live = 0;
    for (let k = 0; k < this.n; k++) {
      const p = this.p[k];
      if (!p) continue;
      const age = (this.age[k] += dt);
      const t = age / this.life[k];
      if (t >= 1) {
        this.p[k] = null;
        this.alpha[k] = 0;
        this.size[k] = 0;
        continue;
      }
      live++;
      const o = k * 3;
      this.vel[o] *= drag;
      this.vel[o + 1] = this.vel[o + 1] * drag + 0.25 * dt; // smoke rises gently
      this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      this.size[k] = p.size + p.grow * Math.sqrt(t);
      // quick fade-in, long fade-out
      this.alpha[k] = p.a * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    this.live = live;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear() {
    this.p.fill(null);
    this.alpha.fill(0);
    this.size.fill(0);
    this.alphaAttr.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}
