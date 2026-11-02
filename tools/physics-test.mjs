// Headless handling test: runs every car through scripted manoeuvres on a flat asphalt plane
// and prints measured numbers next to the advertised ones. `npm run test:physics`
import { initPhysics, PhysicsWorld, FIXED_DT } from '../src/physics/PhysicsWorld.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { buildSpec } from '../src/cars/CarSpec.js';
import { CARS } from '../src/data/cars.js';
import * as THREE from 'three';

await initPhysics();

function makeWorld(surface = 'asphalt') {
  const physics = new PhysicsWorld();
  // long enough that a 350 km/h car stays on it for the whole top-speed run
  physics.addBox({ x: 0, y: -1, z: -6000 }, { x: 3000, y: 1, z: 10000 }, { surface });
  return physics;
}

function run(physics, car, seconds, control, onStep) {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    const t = i * FIXED_DT;
    Object.assign(car.controls, control(t, car));
    car.preStep(FIXED_DT);
    physics.step();
    car.postStep(FIXED_DT);
    if (onStep && onStep(t, car) === false) return t;
  }
  return seconds;
}

const idle = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });
const holdSpeed = (kmh, steer = 0) => (t, car) => {
  const err = kmh - car.speedKmh;
  return { throttle: Math.max(0, Math.min(1, err * 0.15)), brake: err < -5 ? 0.3 : 0, steer, handbrake: false };
};

function fresh(def, assists = {}, surface = 'asphalt') {
  const physics = makeWorld(surface);
  const spec = buildSpec(def);
  const car = new Vehicle(physics, spec, { position: new THREE.Vector3(0, 0, 2500), yaw: 0 });
  Object.assign(car.assists, assists);
  run(physics, car, 2, idle);
  return { physics, car, spec };
}

const rows = [];
for (const def of CARS) {
  const r = { car: def.name, drv: def.stats.drivetrain };

  // settle
  {
    const { car, spec } = fresh(def);
    r.restSpeed = car.speed.toFixed(3);
    r.restHeight = (car.pos.y - spec.anchorHeight).toFixed(3);
    r.calc0100 = spec.performance.zeroTo100.toFixed(2);
    r.calcTop = spec.performance.topSpeed.toFixed(0);
    r.torque = spec.engine.peakTorque.toFixed(0);
    r.kW = spec.performance.peakPowerKw.toFixed(0);
  }

  // acceleration + top speed
  {
    const { physics, car } = fresh(def);
    let t100 = null;
    let vmax = 0;
    run(physics, car, 90, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false }), (t, c) => {
      if (t100 === null && c.speedKmh >= 100) t100 = t;
      if (c.grounded === 4) vmax = Math.max(vmax, Math.hypot(c.vel.x, c.vel.z) * 3.6);
    });
    r.target0100 = def.stats.zeroTo100;
    r.sim0100 = t100?.toFixed(2);
    r.targetTop = def.stats.topSpeed;
    r.simTop = vmax.toFixed(0);
  }

  // braking 100-0
  {
    const { physics, car } = fresh(def);
    run(physics, car, 30, () => ({ throttle: 1 }), (t, c) => c.speedKmh < 103);
    let dist = 0;
    let started = false;
    run(physics, car, 15, () => ({ throttle: 0, brake: 1 }), (t, c) => {
      if (!started && c.speedKmh <= 100) started = true;
      if (started) dist += c.speed * FIXED_DT;
      return c.speedKmh > 0.5;
    });
    r.brake100 = dist.toFixed(1);
  }

  // steady-state cornering at 80 km/h, full keyboard steer
  {
    const { physics, car } = fresh(def);
    run(physics, car, 20, holdSpeed(80), (t, c) => !(c.speedKmh > 79 && t > 3));
    let latSum = 0;
    let n = 0;
    let minUp = 1;
    run(physics, car, 8, holdSpeed(80, 1), (t, c) => {
      if (t > 3) {
        latSum += Math.abs(c.latG);
        n++;
      }
      minUp = Math.min(minUp, c.up.y);
    });
    r.latG80 = (latSum / n).toFixed(2);
    r.minUp = minUp.toFixed(2);
  }

  // lane change at 130 km/h (stability)
  {
    const { physics, car } = fresh(def);
    run(physics, car, 30, holdSpeed(130), (t, c) => !(c.speedKmh > 129 && t > 3));
    let minUp = 1;
    const ctl = (t) => ({ throttle: 0.6, brake: 0, steer: t < 0.6 ? 1 : t < 1.4 ? -1 : 0, handbrake: false });
    run(physics, car, 5, ctl, (t, c) => {
      minUp = Math.min(minUp, c.up.y);
    });
    r.laneUp = minUp.toFixed(2);
    r.laneYawRate = Math.abs(car.angVel.y).toFixed(3);
  }

  // handbrake turn from 60 km/h
  {
    const { physics, car } = fresh(def);
    run(physics, car, 20, holdSpeed(60), (t, c) => !(c.speedKmh > 59 && t > 3));
    const yaw0 = car.yaw;
    run(physics, car, 1.5, (t) => ({ throttle: 0, brake: 0, steer: 1, handbrake: t < 0.8 }));
    let d = car.yaw - yaw0;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    r.hbYawDeg = ((Math.abs(d) * 180) / Math.PI).toFixed(0);
  }

  // power-on cornering with TCS off (drift tendency): body slip angle reached
  {
    const { physics, car } = fresh(def, { tcs: false, steering: true });
    run(physics, car, 20, holdSpeed(50), (t, c) => !(c.speedKmh > 49 && t > 3));
    let maxSlip = 0;
    run(physics, car, 3, () => ({ throttle: 1, brake: 0, steer: 1, handbrake: false }), (t, c) => {
      maxSlip = Math.max(maxSlip, Math.abs(c.bodySlip));
    });
    r.powerSlipDeg = ((maxSlip * 180) / Math.PI).toFixed(0);
  }

  // high-speed full-lock with a partial lift (keyboard worst case): should not spin with assists on
  {
    const { physics, car } = fresh(def);
    const v0 = Math.min(150, def.stats.topSpeed * 0.75);
    run(physics, car, 40, holdSpeed(v0), (t, c) => !(c.speedKmh > v0 - 1 && t > 3));
    let maxSlip = 0;
    run(physics, car, 3, () => ({ throttle: 0.5, brake: 0, steer: 1, handbrake: false }), (t, c) => {
      maxSlip = Math.max(maxSlip, Math.abs(c.bodySlip));
    });
    r.hiSteerSlip = ((maxSlip * 180) / Math.PI).toFixed(0);
  }

  // lift-off mid-corner at 100 km/h
  {
    const { physics, car } = fresh(def);
    run(physics, car, 30, holdSpeed(100), (t, c) => !(c.speedKmh > 99 && t > 3));
    run(physics, car, 3, holdSpeed(100, 1));
    let maxSlip = 0;
    run(physics, car, 2.5, () => ({ throttle: 0, brake: 0, steer: 1, handbrake: false }), (t, c) => {
      maxSlip = Math.max(maxSlip, Math.abs(c.bodySlip));
    });
    r.liftSlip = ((maxSlip * 180) / Math.PI).toFixed(0);
  }

  // dirt acceleration (surface grip)
  {
    const { physics, car } = fresh(def, {}, 'dirt');
    let t100 = null;
    run(physics, car, 30, () => ({ throttle: 1 }), (t, c) => {
      if (c.speedKmh >= 100) {
        t100 = t;
        return false;
      }
    });
    r.dirt0100 = t100?.toFixed(2);
  }
  rows.push(r);
}
console.table(rows.map(({ restSpeed, restHeight, laneYawRate, calc0100, calcTop, torque, ...r }) => r));

// Upgrades: fully upgraded vs stock, predicted (garage numbers) and measured in the 3-D sim
const upRows = [];
for (const def of CARS.filter((c) => ['auren_pip', 'vantor_strada', 'tessar_bison'].includes(c.id))) {
  for (const [label, up] of [['stock', {}], ['engine 3', { engine: 3 }], ['all 3', { engine: 3, tires: 3, brakes: 3, weight: 3 }]]) {
    const physics = makeWorld();
    const spec = buildSpec(def, up);
    const car = new Vehicle(physics, spec, { position: new THREE.Vector3(0, 0, 2500), yaw: 0 });
    run(physics, car, 2, idle);
    let t100 = null;
    run(physics, car, 30, () => ({ throttle: 1 }), (t, c) => {
      if (c.speedKmh >= 100) {
        t100 = t;
        return false;
      }
    });
    run(physics, car, 15, () => ({ throttle: 0, brake: 1 }), (t, c) => c.speedKmh > 0.5);
    upRows.push({ car: def.name, upgrades: label, mass: Math.round(spec.mass), kW: spec.performance.peakPowerKw.toFixed(0), garage0100: spec.performance.zeroTo100.toFixed(2), sim0100: t100?.toFixed(2), garageTop: spec.performance.topSpeed.toFixed(0), grip: spec.tireMu.toFixed(3) });
  }
}
console.table(upRows);
