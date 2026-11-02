import * as THREE from 'three';
import { RAPIER } from './PhysicsWorld.js';
import { Drivetrain } from './Drivetrain.js';
import { lateralCurve, loadSensitivity } from './TireModel.js';
import { surfaceOf } from '../data/surfaces.js';

const G = 9.81;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3();
const wheelFwd = new THREE.Vector3();
const wheelSide = new THREE.Vector3();
const rel = new THREE.Vector3();
const pointVel = new THREE.Vector3();
const impulse = new THREE.Vector3();
const applyAt = new THREE.Vector3();
const accel = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// Cheap deterministic roughness for loose surfaces, roughly in [-1, 1].
function roadNoise(x, z) {
  return (Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.1 - x * 0.4) + 0.5 * Math.sin(x * 3.7 + z * 2.9)) * 0.66;
}

/**
 * Raycast vehicle on a Rapier rigid body. Wheels 0..3 = FL, FR, RL, RR.
 * Body frame: +X right, +Y up, -Z forward.
 */
export class Vehicle {
  constructor(physics, spec, spawn = {}) {
    this.physics = physics;
    this.spec = spec;
    this.drivetrain = new Drivetrain(spec.engine);
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, analog: false };
    this.assists = { abs: true, tcs: true, steering: true };
    this.gripScale = 1; // overall multiplier (map)
    this.surfaceGrip = null; // weather: { surface: multiplier, default } (see data/weather.js)

    this.wheels = spec.wheels.map((def) => ({
      def,
      anchor: new THREE.Vector3(def.x, def.y, def.z),
      worldAnchor: new THREE.Vector3(),
      compression: def.staticComp,
      compVel: 0,
      contact: false,
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(0, 1, 0),
      surface: 'asphalt',
      load: 0,
      steer: 0,
      slipAngle: 0,
      vLong: 0,
      vLat: 0,
      fx: 0,
      fy: 0,
      spin: 0,
      lock: false,
      skid: 0,
      omega: 0,
      rotation: 0,
    }));

    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.com = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.curPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.curQuat = new THREE.Quaternion();
    this.prevVel = new THREE.Vector3();

    this.steerInput = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.revTimer = 0;
    this.flipTimer = 0;
    this.needsRecovery = false;
    this.speed = 0;
    this.vLong = 0;
    this.vLat = 0;
    this.bodySlip = 0;
    this.latG = 0;
    this.longG = 0;
    this.grounded = 0;

    // damage per zone, 0..1; mode 'full' (handling + visuals), 'visual' or 'off'
    this.damage = { front: 0, rear: 0, left: 0, right: 0 };
    this.damageMode = 'full';
    this.onImpact = null; // ({ dir: {x, z} body-frame push direction, severity, dv }) => void
    this.locked = false; // held on the grid: brakes on, engine free to rev
    this._vPre = new THREE.Vector3();
    this._impact = new THREE.Vector3();
    this._impactSteps = 0;

    this._createBody();
    this.reset(spawn.position || new THREE.Vector3(), spawn.yaw || 0);
  }

  _createBody() {
    const s = this.spec;
    const world = this.physics.world;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(s.mass, s.com, s.inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAngularDamping(0.05);
    this.body = world.createRigidBody(desc);
    let cd = RAPIER.ColliderDesc.convexHull(s.hull);
    if (!cd) {
      const sh = s.shape;
      cd = RAPIER.ColliderDesc.cuboid(sh.W / 2, (sh.roofY - sh.clearance) / 2, sh.L / 2).setTranslation(
        0,
        (sh.roofY + sh.clearance) / 2 - s.anchorHeight,
        -(sh.front + sh.rear) / 2,
      );
    }
    cd.setDensity(0).setFriction(0.3).setRestitution(0.1);
    this.collider = world.createCollider(cd, this.body);
  }

  /** Place the car with its wheels on the ground at `position` (ground point), facing `yaw`. */
  reset(position, yaw = 0) {
    const s = this.spec;
    this.quat.setFromAxisAngle(Y_AXIS, yaw);
    const p = { x: position.x, y: position.y + s.anchorHeight + 0.03, z: position.z };
    this.body.setTranslation(p, true);
    this.body.setRotation(this.quat, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.drivetrain.reset();
    this.steerInput = 0;
    this.steerAngle = 0;
    this.flipTimer = 0;
    this.needsRecovery = false;
    for (const w of this.wheels) {
      w.compression = w.def.staticComp;
      w.compVel = 0;
      w.spin = 0;
      w.steer = 0;
    }
    this.curPos.set(p.x, p.y, p.z);
    this.prevPos.copy(this.curPos);
    this.curQuat.copy(this.quat);
    this.prevQuat.copy(this.quat);
    this.prevVel.set(0, 0, 0);
    this._impact.set(0, 0, 0);
    this._impactSteps = 0;
  }

  repair() {
    this.damage.front = this.damage.rear = this.damage.left = this.damage.right = 0;
  }

  get damageTotal() {
    const d = this.damage;
    return Math.max(d.front, d.rear, d.left, d.right);
  }

  get speedKmh() {
    return this.speed * 3.6;
  }

  get yaw() {
    return Math.atan2(-this.fwd.x, -this.fwd.z);
  }

  _readState() {
    const b = this.body;
    const t = b.translation();
    const r = b.rotation();
    const lv = b.linvel();
    const av = b.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.quat.set(r.x, r.y, r.z, r.w);
    this.vel.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.com.set(this.spec.com.x, this.spec.com.y, this.spec.com.z).applyQuaternion(this.quat).add(this.pos);
  }

  _updateControls(dt, vLong, vLat) {
    const c = this.controls;
    const s = this.spec;
    const dtr = this.drivetrain;
    let throttle = c.throttle;
    let brake = c.brake;

    if (this.locked) {
      // on the grid: engine revs freely, brakes hold the car
      if (dtr.gear !== 1) dtr.gear = 1;
      this.throttle = throttle;
      this.brake = 1;
      throttle = brake = 0;
    }
    // Arcade reverse: holding brake at a standstill engages reverse; throttle returns to drive.
    if (this.locked) {
      // skip reverse / hold logic
    } else if (dtr.gear !== -1) {
      if (brake > 0.1 && throttle < 0.1 && vLong < 0.6) {
        this.revTimer += dt;
        if (this.revTimer > 0.25) dtr.setReverse(true);
      } else this.revTimer = 0;
    } else if (throttle > 0.1 && vLong > -0.6) {
      dtr.setReverse(false);
    }
    if (dtr.gear === -1) [throttle, brake] = [brake, throttle];

    if (!this.locked) {
      // hold the car still at walking pace when no pedal is pressed
      if (throttle < 0.05 && brake < 0.05 && Math.abs(vLong) < 0.7 && !c.handbrake) brake = 0.25;
      this.throttle = throttle;
      this.brake = brake;
    }

    // --- steering
    const speed = Math.abs(vLong);
    if (c.analog) {
      this.steerInput += (c.steer - this.steerInput) * Math.min(1, dt * 14);
    } else {
      // keyboard: ease in (slower at speed so lane changes aren't twitchy), snap back faster
      const returning = c.steer === 0 || Math.sign(c.steer) !== Math.sign(this.steerInput);
      const rate = returning ? s.steerReturn : s.steerSpeed / (1 + speed / 28);
      this.steerInput = approach(this.steerInput, c.steer, rate * dt);
    }

    // Speed-sensitive lock: the kinematic angle for a ~1.1 g turn (δ ≈ L·a/v²) plus part of the
    // peak slip angle. In a steady turn the front slip is δ - L/R + α_rear, and the rear already
    // runs about half its peak slip, so 0.6·peak puts the fronts right at the top of the curve.
    // Full input then means "corner at the limit" instead of "scrub the fronts".
    const limit = Math.min(s.maxSteer, Math.atan((s.wheelbase * s.tireMu * G * 1.1) / Math.max(speed * speed, 0.01)) + s.peakSlip * 0.6);
    const beta = vLong > 3 ? Math.atan2(vLat, vLong) : 0; // body slip angle (+ = sliding right)
    this.bodySlip = beta;
    let target = this.steerInput * limit;
    if (this.assists.steering) {
      // When the rear tyres go past their peak, a driver unwinds the wheel. Fade out input that
      // steers into the slide (input and rear slip of opposite sign), by how far past peak they are.
      const [, , rl, rr] = this.wheels;
      const rearSlip = (rl.slipAngle + rr.slipAngle) / 2;
      const rearPeak = surfaceOf(rl.surface).peakSlip * s.peakSlipScale;
      const sliding = clamp((Math.abs(rearSlip) - 0.7 * rearPeak) / (0.8 * rearPeak), 0, 1);
      // (not while the handbrake is held: then the rotation is the point)
      if (this.steerInput * rearSlip < 0 && !c.handbrake) target *= 1 - 0.9 * sliding;
      // counter-steer assist: bias the front wheels toward the direction of travel
      // (loose surfaces slide at bigger angles by nature: start correcting later there)
      const csStart = 0.03 * Math.max(1, rearPeak / 0.13);
      target += Math.sign(beta) * Math.max(0, Math.abs(beta) - csStart) * s.counterSteer;
    } else if (this.steerInput !== 0 && Math.sign(this.steerInput) === Math.sign(beta)) {
      // no assist: still let the driver counter-steer past the speed-sensitive limit
      target = this.steerInput * (limit + Math.abs(beta));
    }
    target = clamp(target, -s.maxSteer, s.maxSteer);
    this.steerAngle = approach(this.steerAngle, target, s.steerRate * dt);

    // Ackermann: the inside wheel turns tighter (R = L / tan δ for the virtual centre wheel)
    const a = this.steerAngle;
    const [fl, fr] = this.wheels;
    if (Math.abs(a) > 1e-4) {
      const R = s.wheelbase / Math.tan(Math.abs(a));
      const inner = Math.atan(s.wheelbase / (R - s.track / 2));
      const outer = Math.atan(s.wheelbase / (R + s.track / 2));
      const sg = Math.sign(a);
      fl.steer = sg * (a > 0 ? outer : inner);
      fr.steer = sg * (a > 0 ? inner : outer);
    } else {
      fl.steer = fr.steer = 0;
    }
    if (this.damageMode === 'full') {
      // bent suspension pulls toward the damaged side
      const pull = -(this.damage.left - this.damage.right) * 0.035;
      fl.steer += pull;
      fr.steer += pull;
    }
  }

  preStep(dt) {
    const s = this.spec;
    const body = this.body;
    this._readState();
    const { vel, angVel, fwd, right, up, com } = this;
    const vLong = vel.dot(fwd);
    const vLat = vel.dot(right);
    this.vLong = vLong;
    this.vLat = vLat;
    this.speed = vel.length();
    this._updateControls(dt, vLong, vLat);

    // --- 1. Suspension: one ray per wheel along the body's down axis
    down.copy(up).negate();
    const rayLen = s.restLength + s.wheelRadius;
    let grounded = 0;
    for (const w of this.wheels) {
      w.worldAnchor.copy(w.anchor).applyQuaternion(this.quat).add(this.pos);
      const hit = this.physics.raycast(w.worldAnchor, down, rayLen, body);
      let comp = 0;
      if (hit) {
        w.contact = true;
        grounded++;
        w.point.set(hit.point.x, hit.point.y, hit.point.z);
        w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
        w.surface = hit.surface;
        comp = rayLen - hit.dist;
        const bump = surfaceOf(w.surface).bumpiness;
        if (bump > 0) comp = Math.max(0, comp + bump * roadNoise(w.point.x, w.point.z));
      } else {
        w.contact = false;
      }
      w.compVel = (comp - w.compression) / dt;
      w.compression = comp;
    }
    this.grounded = grounded;

    // Anti-roll bars push down on the more-compressed side and up on the other.
    const w0 = this.wheels;
    const arF = (w0[0].compression - w0[1].compression) * s.antiRollFront;
    const arR = (w0[2].compression - w0[3].compression) * s.antiRollRear;
    const antiRoll = [arF, -arF, arR, -arR];
    for (let i = 0; i < 4; i++) {
      const w = w0[i];
      const d = w.def;
      if (!w.contact) {
        w.load = 0;
        continue;
      }
      let f = d.spring * w.compression + (w.compVel > 0 ? d.bump : d.rebound) * w.compVel + antiRoll[i];
      if (w.compression > s.travel) f += d.spring * 6 * (w.compression - s.travel); // bump stop
      f = Math.max(0, f);
      w.load = f;
      impulse.copy(up).multiplyScalar(f * dt);
      body.applyImpulseAtPoint(impulse, w.worldAnchor, true);
    }

    // --- 2. Drivetrain
    let drivenContact = 0;
    let spinSum = 0;
    for (const w of w0) {
      if (w.def.driveShare <= 0) continue;
      if (w.contact) drivenContact++;
      spinSum += w.spin;
    }
    // wheels in the air spin freely, so the engine revs up
    const spin = drivenContact === 0 && this.throttle > 0.1 ? 1 : spinSum / s.drivenCount;
    let driveForce = this.drivetrain.update(dt, this.throttle, vLong, spin);
    const dmg = this.damageMode === 'full' ? this.damage : null;
    if (this.locked) driveForce = 0;
    else if (dmg) driveForce *= 1 - 0.35 * dmg.front - 0.15 * dmg.rear; // cooling / driveline damage

    // --- 3. Tyres
    const { abs, tcs } = this.assists;
    const stopForce = (s.mass * 0.125) / dt; // per wheel per (m/s): resistive forces never reverse motion
    const handbrake = this.controls.handbrake;
    for (const w of w0) {
      const d = w.def;
      w.spin = 0;
      w.lock = false;
      w.skid = 0;
      if (!w.contact) {
        w.fx = w.fy = 0;
        const freeSpin = d.driveShare > 0 && this.throttle > 0.1 ? 60 : 0;
        w.omega = approach(w.omega, freeSpin, 30 * dt);
        w.rotation += w.omega * dt;
        continue;
      }
      const n = w.normal;
      // wheel heading projected onto the contact plane
      const sa = Math.sin(w.steer);
      const ca = Math.cos(w.steer);
      wheelFwd.copy(fwd).multiplyScalar(ca).addScaledVector(right, sa);
      wheelFwd.addScaledVector(n, -wheelFwd.dot(n)).normalize();
      wheelSide.crossVectors(wheelFwd, n).normalize();
      // velocity of the contact patch: v + ω × r
      rel.subVectors(w.point, com);
      pointVel.crossVectors(angVel, rel).add(vel);
      const vL = pointVel.dot(wheelFwd);
      const vS = pointVel.dot(wheelSide);
      w.vLong = vL;
      w.vLat = vS;

      const surf = surfaceOf(w.surface);
      const fz = Math.min(w.load, d.staticLoad * 3);
      const wear = dmg ? 1 - 0.15 * (d.left ? dmg.left : dmg.right) - 0.08 * (d.front ? dmg.front : dmg.rear) : 1;
      const wx = this.surfaceGrip ? (this.surfaceGrip[w.surface] ?? this.surfaceGrip.default ?? 1) : 1;
      const mu = wear * wx * s.tireMu * d.gripScale * surf.mu * (s.tireSurface[w.surface] ?? 1) * this.gripScale * loadSensitivity(fz, d.staticLoad, s.loadSens);
      const fMax = mu * fz;

      // Lateral: slip angle on the peak-then-fall curve. The 3 m/s floor in the denominator keeps
      // the angle well-behaved near standstill, where atan2 would otherwise flip wildly.
      const slip = Math.atan2(vS, Math.max(Math.abs(vL), 3));
      const peak = surf.peakSlip * s.peakSlipScale * d.slipScale;
      w.slipAngle = slip;
      let fy = -Math.sign(slip) * lateralCurve(slip, peak, surf.slideGrip, surf.falloff) * fMax;

      const braking = this.brake * s.brakeForce * d.brakeShare;
      let fx;
      if (handbrake && !d.front) {
        // Locked tyre: friction opposes the whole contact-patch velocity, so lateral grip collapses.
        const sv = Math.hypot(vL, vS);
        const kinetic = fMax * surf.slideGrip;
        if (sv > 0.5) {
          fx = (-vL / sv) * kinetic;
          fy = (-vS / sv) * kinetic;
        } else {
          fx = -Math.sign(vL) * Math.min(kinetic, Math.abs(vL) * stopForce);
        }
        w.lock = sv > 1;
      } else {
        const resist = braking + surf.rolling * fz;
        fx = d.driveShare * driveForce - Math.sign(vL) * Math.min(resist, Math.abs(vL) * stopForce);

        // Friction circle with longitudinal priority: whatever the tyre spends on drive/brake is
        // no longer available for cornering. Wheelspin therefore costs lateral grip.
        const isBraking = braking > 0 && fx * vL < 0;
        let limit = fMax;
        let assisted = false;
        if (abs && isBraking) {
          limit = fMax * 0.9; // ABS holds the tyre just short of locking
          assisted = true;
        } else if (tcs && d.driveShare > 0 && !isBraking) {
          // traction control leaves room for the lateral force the tyre currently needs
          limit = Math.max(0.25 * fMax, Math.sqrt(Math.max(0, fMax * fMax - fy * fy)));
          assisted = true;
        }
        if (Math.abs(fx) > limit) {
          if (assisted) {
            fx = Math.sign(fx) * limit;
          } else if (Math.abs(fx) > fMax) {
            const excess = (Math.abs(fx) - fMax) / Math.max(fMax, 1);
            fx = Math.sign(fx) * fMax * 0.9; // sliding friction is a bit lower than peak
            if (isBraking) w.lock = true;
            else w.spin = Math.min(1, 0.25 + excess);
          }
        }
        const fyMax = Math.sqrt(Math.max(0, fMax * fMax - fx * fx));
        if (Math.abs(fy) > fyMax) fy = Math.sign(fy) * fyMax;
      }

      // skid intensity for audio / smoke / marks
      const slide = clamp((Math.abs(slip) - peak) / (peak * 2), 0, 1) * Math.min(1, Math.abs(vS) / 3);
      w.skid = Math.max(slide, w.spin, w.lock ? Math.min(1, Math.abs(vL) / 4) : 0);
      w.fx = fx;
      w.fy = fy;

      // longitudinal at the contact patch (full pitch transfer); lateral slightly raised to
      // reduce the roll moment so tall cars don't trip over themselves
      impulse.copy(wheelFwd).multiplyScalar(fx * dt);
      body.applyImpulseAtPoint(impulse, w.point, true);
      applyAt.copy(w.point).addScaledVector(up, s.lateralForceLift);
      impulse.copy(wheelSide).multiplyScalar(fy * dt);
      body.applyImpulseAtPoint(impulse, applyAt, true);

      w.omega = w.lock ? 0 : vL / s.wheelRadius + w.spin * 25 * Math.sign(driveForce || 1);
      w.rotation += w.omega * dt;
    }

    // --- 4. Aerodynamics: quadratic drag against velocity, downforce along body down
    if (this.speed > 0.1) {
      impulse.copy(vel).multiplyScalar(-s.dragCoef * (dmg ? 1 + 0.3 * dmg.front : 1) * this.speed * dt);
      body.applyImpulse(impulse, true);
      // Downforce acts perpendicular to the airflow. Applying it along the body's down axis
      // would let any nose-up pitch turn part of it into forward thrust (free energy at v²).
      impulse.copy(up).negate();
      applyAt.copy(vel).divideScalar(this.speed);
      impulse.addScaledVector(applyAt, -impulse.dot(applyAt)).normalize();
      impulse.multiplyScalar(s.downforce * vLong * vLong * dt);
      body.applyImpulse(impulse, true);
    }

    // --- 5. Airborne: a little angular damping keeps jumps from becoming tumbles
    if (grounded === 0) {
      const av = body.angvel();
      const k = Math.min(1, 1.2 * dt);
      body.setAngvel({ x: av.x * (1 - k), y: av.y * (1 - k * 0.5), z: av.z * (1 - k) }, true);
    }

    // stuck on the roof or side → request a reset
    if (up.y < 0.3 && this.speed < 3) {
      this.flipTimer += dt;
      if (this.flipTimer > 2.5) this.needsRecovery = true;
    } else this.flipTimer = 0;

    const v = body.linvel();
    this._vPre.set(v.x, v.y, v.z);
  }

  // Collisions are detected from the velocity change the solver applied during the step, i.e.
  // whatever our own suspension/tyre/aero impulses (already in _vPre) and gravity don't explain.
  // Consecutive steps of one crash are accumulated into a single impact.
  _detectImpact(lv, dt) {
    // horizontal part only: landings and bottoming out are vertical and never count as crashes
    accel.set(lv.x - this._vPre.x, 0, lv.z - this._vPre.z);
    const fl = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const dx = (accel.x * this.fwd.z - accel.z * this.fwd.x) / -fl; // along the flattened right axis
    const dz = -(accel.x * this.fwd.x + accel.z * this.fwd.z) / fl; // body frame: +z = pushed backward (front impact)
    const h = Math.hypot(dx, dz);
    if (h > 1.0) {
      this._impact.x += dx;
      this._impact.z += dz;
      this._impactSteps++;
      if (this._impactSteps < 12) return;
    }
    if (this._impactSteps === 0) return;
    const total = Math.hypot(this._impact.x, this._impact.z);
    const dir = { x: this._impact.x / total, z: this._impact.z / total };
    this._impact.set(0, 0, 0);
    this._impactSteps = 0;
    if (total < 3) return;
    // ~0.25 at 30 km/h into a wall, ~0.8 at 100 km/h (a full-speed head-on wrecks the zone)
    const severity = Math.min(1, (total - 3) / 28);
    if (this.damageMode !== 'off') {
      const d = this.damage;
      d.front = Math.min(1, d.front + severity * Math.max(0, dir.z));
      d.rear = Math.min(1, d.rear + severity * Math.max(0, -dir.z));
      d.left = Math.min(1, d.left + severity * Math.max(0, dir.x)); // pushed right = hit on the left
      d.right = Math.min(1, d.right + severity * Math.max(0, -dir.x));
    }
    // reported even with damage off: sound and camera shake still want to know
    if (this.onImpact) this.onImpact({ dir, severity, dv: total });
  }

  postStep(dt) {
    const b = this.body;
    const t = b.translation();
    const r = b.rotation();
    const lv = b.linvel();
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
    accel.set(lv.x - this.prevVel.x, lv.y - this.prevVel.y, lv.z - this.prevVel.z).divideScalar(dt);
    this.prevVel.set(lv.x, lv.y, lv.z);
    const ax = accel.dot(this.right) / G;
    const az = accel.dot(this.fwd) / G;
    this._detectImpact(lv, dt);
    const k = Math.min(1, dt * 8);
    this.latG += (ax - this.latG) * k;
    this.longG += (az - this.longG) * k;
  }

  /** Interpolated transform between the last two physics steps. */
  getRenderState(alpha, out) {
    out.position.lerpVectors(this.prevPos, this.curPos, alpha);
    out.quaternion.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    return out;
  }

  dispose() {
    this.physics.removeBody(this.body);
  }
}
