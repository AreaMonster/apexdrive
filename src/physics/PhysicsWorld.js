import RAPIER from '@dimforge/rapier3d-compat';

export { RAPIER };
export const FIXED_DT = 1 / 120;

let ready = null;
export function initPhysics() {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export class PhysicsWorld {
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.surfaceByCollider = new Map(); // collider handle → surface id ('auto' = ask surfaceFn)
    this.surfaceFn = null; // (x, z) → surface id, for painted ground
    this._ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this._hit = { dist: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 }, surface: 'asphalt' };
  }

  _fixed(desc, surface, position, rotation) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed();
    if (position) bodyDesc.setTranslation(position.x, position.y, position.z);
    if (rotation) bodyDesc.setRotation(rotation);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(desc, body);
    if (surface) this.surfaceByCollider.set(collider.handle, surface);
    return collider;
  }

  addBox(position, half, { rotation = null, surface = 'asphalt', friction = 0.8, restitution = 0.05 } = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(friction).setRestitution(restitution);
    return this._fixed(desc, surface, position, rotation);
  }

  addHull(points, { position = null, surface = 'asphalt', friction = 0.8 } = {}) {
    const desc = RAPIER.ColliderDesc.convexHull(points instanceof Float32Array ? points : new Float32Array(points));
    if (!desc) return null;
    desc.setFriction(friction);
    return this._fixed(desc, surface, position, null);
  }

  addCylinder(position, halfHeight, radius, { surface = 'asphalt', friction = 0.6 } = {}) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setFriction(friction);
    return this._fixed(desc, surface, position, null);
  }

  addTrimesh(vertices, indices, { surface = 'asphalt', friction = 0.8 } = {}) {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(friction);
    return this._fixed(desc, surface, null, null);
  }

  /**
   * Cast a ray against static geometry (dynamic bodies such as cars and cones are ignored so
   * wheels don't "drive on" props). Returns a shared hit object, valid until the next call.
   */
  raycast(origin, dir, maxDist, excludeBody) {
    const ray = this._ray;
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = dir.x;
    ray.dir.y = dir.y;
    ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, excludeBody);
    if (!hit) return null;
    const out = this._hit;
    const d = hit.timeOfImpact;
    out.dist = d;
    out.point.x = origin.x + dir.x * d;
    out.point.y = origin.y + dir.y * d;
    out.point.z = origin.z + dir.z * d;
    out.normal.x = hit.normal.x;
    out.normal.y = hit.normal.y;
    out.normal.z = hit.normal.z;
    let surface = this.surfaceByCollider.get(hit.collider.handle) ?? 'asphalt';
    if (surface === 'auto') surface = this.surfaceFn ? this.surfaceFn(out.point.x, out.point.z) : 'asphalt';
    out.surface = surface;
    return out;
  }

  step() {
    this.world.step();
  }

  removeBody(body) {
    this.world.removeRigidBody(body);
  }

  dispose() {
    this.world.free();
  }
}
