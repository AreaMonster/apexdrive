import * as THREE from 'three';
import { RAPIER } from '../physics/PhysicsWorld.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

/** Knock-over traffic cones: light dynamic bodies drawn as one instanced mesh. */
export class Cones {
  /** positions: [[x, z, groundY = 0], ...] */
  constructor(physics, group, positions) {
    this.bodies = [];
    // both three.js and Rapier cones are centred at mid-height, so body and mesh transforms match
    const geo = new THREE.ConeGeometry(0.18, 0.7, 12);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xff6a13, roughness: 0.6 }), Math.max(1, positions.length));
    this.mesh.count = positions.length;
    this.mesh.castShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.mesh);
    const world = physics.world;
    for (const [x, z, y = 0] of positions) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y + 0.35, z).setCanSleep(true));
      world.createCollider(RAPIER.ColliderDesc.cone(0.35, 0.18).setMass(3).setFriction(0.6).setRestitution(0.3), body);
      this.bodies.push(body);
    }
    this.sync(true);
  }

  /** Copy body transforms into the instanced mesh (sleeping cones are skipped). */
  sync(force = false) {
    let dirty = force;
    this.bodies.forEach((b, i) => {
      if (!force && b.isSleeping()) return;
      const t = b.translation();
      const r = b.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, ONE);
      this.mesh.setMatrixAt(i, _m);
      dirty = true;
    });
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
