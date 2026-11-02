import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TrackSpline } from './TrackSpline.js';
import { computeLayout, buildTrackSurfaces, buildTerrain, layoutSurface } from './TrackBuilder.js';
import { disposeGroup } from './dispose.js';
import { buildGrass, natureUniforms, windify } from './Nature.js';
import { buildTrackside } from './Trackside.js';
import { buildLandmarks } from './Landmarks.js';
import { Cones } from './Cones.js';
import {
  buildTrees,
  buildRocks,
  buildGrandstands,
  buildPitBuilding,
  buildGantry,
  buildBillboards,
  buildLamps,
  buildCity,
  buildProps,
  buildHorizon,
} from './Scenery.js';

const WHITE = new THREE.Color(0xf4f7fb);
const WET = new THREE.Color(0x55595f);

/**
 * A map generated from a spline track definition (see data/maps/). Closed tracks are circuits
 * timed in laps; open tracks are point-to-point stages from `startS` to `finishS`.
 */
export class TrackMap {
  constructor(gfx, physics, def, quality = 'medium') {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.physics = physics;
    this.group = new THREE.Group();
    gfx.scene.add(this.group);
    this.weather = { grip: 1 };
    this.environment = def.environment;
    this.maxOffTrack = def.maxOffTrack ?? null;
    this.freeRoam = !!def.freeRoam;

    const track = (this.track = new TrackSpline(def.track));
    const g = def.grid || { slots: 8, spacing: 8, firstBack: 12 };
    if (track.closed) {
      this.startS = 0;
      this.lapLength = track.length;
    } else {
      // stage: the grid needs room behind the start line, the finish needs room to stop after it
      this.startS = def.track.startS ?? g.firstBack + g.spacing * (g.slots - 1) + 12;
      const finishS = track.length - (def.track.finishMargin ?? 120);
      this.lapLength = finishS - this.startS;
    }
    this.startIndex = track.indexAtS(this.startS);
    this.finishIndex = track.indexAtS(this.startS + this.lapLength);

    this.layout = computeLayout(track, def);
    const mats = buildTrackSurfaces(track, def, this.layout, physics, this.group, this.startIndex, this.finishIndex);
    this.roadMats = mats.road;
    this.groundMats = mats.ground;

    if (this.layout.flat) {
      // flat maps: a stand-in for the terrain API (height 0, bounds around the track)
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < track.count; i++) {
        minX = Math.min(minX, track.pos[i * 3]);
        maxX = Math.max(maxX, track.pos[i * 3]);
        minZ = Math.min(minZ, track.pos[i * 3 + 2]);
        maxZ = Math.max(maxZ, track.pos[i * 3 + 2]);
      }
      const m = def.ground.margin ?? 300;
      this.terrain = {
        heightAt: () => 0,
        bounds: { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m },
        baseY: 0,
        seaLevel: null,
        setSnow: null,
      };
    } else {
      this.terrain = buildTerrain(track, def, this.layout, physics, this.group);
    }
    this.seaLevel = this.terrain.seaLevel;

    this.foliage = buildTrees(track, this.layout, this.terrain, this.group, def, quality, physics);
    for (const m of this.foliage) windify(m, 0.012);
    buildGrass(track, this.layout, this.terrain, this.group, def, quality, (x, z) => this.surfaceAt(x, z), def.terrain?.surface || def.ground?.surface || 'grass');
    const rockMat = buildRocks(track, this.layout, this.terrain, this.group, def, quality, physics);
    if (rockMat) this.foliage.push(rockMat);
    buildGrandstands(track, this.layout, def, this.group);
    buildPitBuilding(track, this.layout, def, this.group);
    this.setStartLights = buildGantry(track, this.startIndex, track.closed ? def.name : 'Start', this.group);
    if (!track.closed) buildGantry(track, this.finishIndex, 'Finish', this.group, { lights: false, color: '#7a1010' });
    buildBillboards(track, this.layout, def, this.group);
    buildTrackside(track, this.layout, this.layout.flat ? null : this.terrain, this.group, def, quality);
    this.lamps = buildLamps(track, this.layout, def, this.group);
    this.city = buildCity(track, this.layout, this.terrain, def, this.group);
    this.props = buildProps(def, this.terrain, physics, this.group);
    this.landmarks = buildLandmarks(track, this.layout.flat ? null : this.terrain, def, physics, this.group);
    this.foliage.push(buildHorizon(this.terrain, this.group, def));
    this.envProps = this.city?.envProps ?? null;
    this.cones = def.scenery?.cones ? new Cones(physics, this.group, this._conePositions(def.scenery.cones)) : null;

    this._buildGrid(g);
    this.spawn = this.grid[0];
    this._near = {};
    this._hint = -1;
    this.wetness = 0;
  }

  _buildGrid(g) {
    const t = this.track;
    const p = { x: 0, y: 0, z: 0 };
    this.grid = [];
    const marks = [];
    const lift = this.layout.flat ? 0.03 : 0;
    for (let k = 0; k < g.slots; k++) {
      const i = t.indexAtS(this.startS - (g.firstBack + k * g.spacing));
      const l = (k % 2 === 0 ? -1 : 1) * t.half[i] * 0.42;
      t.pointAt(i, l, p);
      this.grid.push({ position: new THREE.Vector3(p.x, p.y + lift, p.z), yaw: t.yaw[i] });
      // painted slot: a bar in front of the car and two short side lines
      const front = t.wrap(i - 2);
      for (const [dl, w, d, back] of [[0, 2.6, 0.22, 0], [-1.25, 0.18, 1.6, 0.7], [1.25, 0.18, 1.6, 0.7]]) {
        t.pointAt(front, l + dl, p);
        const geo = new THREE.PlaneGeometry(w, d);
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, 0, back);
        geo.rotateY(t.yaw[front]);
        geo.translate(p.x, p.y + lift + 0.008, p.z);
        marks.push(geo);
      }
    }
    const mesh = new THREE.Mesh(
      mergeGeometries(marks),
      new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 }),
    );
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  // cones on the inside of every tight corner (drift course markers)
  _conePositions(cfg) {
    const t = this.track;
    const out = [];
    const p = { x: 0, y: 0, z: 0 };
    const every = Math.max(1, Math.round((cfg.spacing ?? 10) / t.step));
    for (let i = 0; i < t.count; i += every) {
      const k = t.curv[i];
      if (Math.abs(k) < (cfg.minCurvature ?? 1 / 60)) continue;
      const sg = k > 0 ? 1 : -1; // inside of the bend
      t.pointAt(i, sg * (t.half[i] + 0.8), p);
      out.push([p.x, p.z, p.y]);
    }
    return out;
  }

  /** Surface under a point that hit an 'auto' collider (road with patches, run-off, flat ground). */
  surfaceAt(x, z) {
    const q = this.track.nearest(x, z, this._hint, this._near);
    if (!q.found) return this.layout.runoffSurface;
    this._hint = q.index;
    return layoutSurface(this.track, this.layout, q);
  }

  /** Nearest safe pose on the road: keeps the car's lane if it was on track, faces the track direction. */
  getResetPose(pos, hint = -1) {
    const t = this.track;
    const q = t.nearest(pos.x, pos.z, hint, {}, 8);
    let i = q.index;
    // never reset behind the start of a stage or beyond its run-out
    if (!t.closed) i = Math.min(Math.max(i, 4), t.count - 6);
    const h = t.half[i];
    const l = Math.max(-(h - 2.5), Math.min(h - 2.5, q.lateral));
    const p = t.pointAt(i, l, { x: 0, y: 0, z: 0 });
    return { position: new THREE.Vector3(p.x, p.y + (this.layout.flat ? 0.03 : 0), p.z), yaw: t.yaw[i] };
  }

  /** Weather visuals: wet roads go dark and glossy, snow whitens ground and foliage. */
  setWeather(w) {
    this.wetness = w.wetness;
    for (const m of [...this.roadMats, this.terrain.material]) if (m?.userData.wetness) m.userData.wetness.value = w.wetness;
    const snow = w.snowCover;
    for (const m of this.roadMats) {
      const b = m.userData.base;
      m.color.copy(b.color).lerp(WET, 0.3 * w.wetness).lerp(WHITE, 0.35 * snow);
      m.roughness = b.roughness + (0.18 - b.roughness) * w.wetness * (b.roughness > 0.3 ? 1 : 0);
    }
    for (const m of [...this.groundMats, ...this.foliage]) {
      if (!m?.userData.base) continue;
      m.color.copy(m.userData.base.color).lerp(WHITE, 0.8 * snow);
    }
    this.terrain.setSnow?.(snow);
  }

  update(dt, night = 0) {
    natureUniforms.time.value += dt;
    this.landmarks?.update(dt);
    this.cones?.sync();
    this.lamps?.setNight(night, this.wetness);
    this.city?.setNight(night, this.wetness);
    this.props?.setNight(night);
  }

  dispose() {
    disposeGroup(this.group);
  }
}
