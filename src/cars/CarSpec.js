import { buildGearRatios, calibrateEngine, simulateStraight, computeTopSpeed, tractionLimit, ASPHALT_ROLLING, LAUNCH_LOSS } from '../physics/Calibration.js';
import { torqueAt } from '../physics/Drivetrain.js';
import { SURFACES, TIRE_TYPES } from '../data/surfaces.js';
import { resolveBodyShape, hullPoints } from './bodyShape.js';

const G = 9.81;
const DEG = Math.PI / 180;

// Effect per upgrade level (levels 0..MAX_UPGRADE_LEVEL).
export const UPGRADE_EFFECTS = { engine: 0.07, tires: 0.04, brakes: 0.08, weight: 0.04 };
export const MAX_UPGRADE_LEVEL = 3;

const calibrationCache = new Map();

function baseTireMu(def) {
  return (0.9 + 0.025 * def.stats.handling) * (def.tires?.grip ?? 1);
}

function engineParams(def, ratios, peakTorque) {
  const e = def.engine;
  return {
    ratios,
    reverseRatio: ratios[0] * 1.1,
    idleRpm: e.idleRpm,
    redline: e.redline,
    launchRpm: e.launchRpm ?? Math.min(e.redline * 0.55, e.idleRpm + 3000),
    curve: e.curve,
    peakTorque,
    shiftTime: e.shiftTime ?? 0.15,
    efficiency: 0.85,
    engineBrake: 0,
    wheelRadius: def.layout.wheelRadius,
  };
}

// Calibrate the stock car once: stats → gear ratios, peak torque, drag coefficient.
function calibrated(def) {
  const hit = calibrationCache.get(def.id);
  if (hit) return hit;
  const lay = def.layout;
  const topSpeed = def.stats.topSpeed / 3.6;
  const gearing = buildGearRatios({
    gears: def.engine.gears,
    topSpeed,
    redline: def.engine.redline,
    idleRpm: def.engine.idleRpm,
    curve: def.engine.curve,
    wheelRadius: lay.wheelRadius,
  });
  const traction = tractionLimit({
    mass: def.stats.mass,
    // stats are quoted on dry asphalt, so include the tyre compound's asphalt grip (gravel tyres < 1)
    mu: baseTireMu(def) * SURFACES.asphalt.mu * ((TIRE_TYPES[def.tires?.type] || TIRE_TYPES.road).grip.asphalt ?? 1),
    drivetrain: def.stats.drivetrain,
    frontWeight: lay.frontWeight,
    cgHeight: lay.cgHeight,
    wheelbase: lay.wheelbase,
    awdFront: def.engine.awdFront,
  });
  const cal = calibrateEngine({
    mass: def.stats.mass,
    topSpeed,
    zeroTo100: def.stats.zeroTo100,
    traction,
    gearing,
    engine: engineParams(def, gearing.ratios, 0),
  });
  if (cal.warning && typeof console !== 'undefined') console.warn(`[${def.id}] ${cal.warning}`);
  const out = { ratios: gearing.ratios, peakTorque: cal.peakTorque, dragCoef: cal.dragCoef };
  calibrationCache.set(def.id, out);
  return out;
}

/**
 * Turn a car definition (+ upgrade levels) into everything the physics needs.
 * Body frame: origin at mid-wheelbase at suspension-anchor height, +X right, +Y up, -Z forward.
 */
export function buildSpec(def, upgrades = {}) {
  const up = { engine: 0, tires: 0, brakes: 0, weight: 0, ...upgrades };
  const st = def.stats;
  const lay = def.layout;
  const sus = def.suspension;
  const shape = resolveBodyShape(def);
  const tireType = TIRE_TYPES[def.tires?.type] || TIRE_TYPES.road;

  const mass = st.mass * (1 - UPGRADE_EFFECTS.weight * up.weight);
  const wb = lay.wheelbase;
  const track = lay.track;
  const r = lay.wheelRadius;
  const wf = lay.frontWeight;

  const cal = calibrated(def);
  const engine = engineParams(def, cal.ratios, cal.peakTorque * (1 + UPGRADE_EFFECTS.engine * up.engine));
  engine.engineBrake = engine.peakTorque * 0.18;

  // Suspension: spring rate from natural frequency, k = m (2πf)²; damping c = 2ζ√(km).
  // Rebound is stiffer than bump, which keeps the car from floating after crests.
  const axle = (cornerMass, freq) => {
    const spring = cornerMass * (2 * Math.PI * freq) ** 2;
    const c = 2 * sus.damping * Math.sqrt(spring * cornerMass);
    return { spring, bump: c * 0.7, rebound: c * 1.3, staticLoad: cornerMass * G, staticComp: (cornerMass * G) / spring };
  };
  const front = axle((mass * wf) / 2, sus.freqFront);
  const rear = axle((mass * (1 - wf)) / 2, sus.freqRear);
  const restLength = sus.travel;
  const avgComp = (front.staticComp + rear.staticComp) / 2;
  // height of the anchor plane (body origin) above the ground when the car is at rest
  const anchorHeight = r + restLength - avgComp;

  const driveFront = st.drivetrain === 'FWD' ? 1 : st.drivetrain === 'RWD' ? 0 : def.engine.awdFront ?? 0.4;
  const brakeBias = 0.68;
  // Built-in understeer. With identical tyres each axle's cornering stiffness is proportional to
  // its load, which makes Cf·a == Cr·b: perfectly neutral steer, and load transfer then tips it
  // into a spin. Real cars avoid this with wider rear tyres, compliance and toe; here the front
  // tyres are more compliant (peak at a larger slip angle) and the rears grip slightly harder.
  const balance = def.suspension.balance ?? 1;
  const frontSlip = 1 + 0.2 * balance;
  const rearGrip = 1 + 0.05 * balance;
  const makeWheel = (isFront, isLeft) => {
    const a = isFront ? front : rear;
    return {
      x: (isLeft ? -1 : 1) * (track / 2),
      // per-axle anchor offset so both axles sit at their static compression with the body level
      y: avgComp - a.staticComp,
      z: isFront ? -wb / 2 : wb / 2,
      front: isFront,
      left: isLeft,
      driveShare: (isFront ? driveFront : 1 - driveFront) / 2,
      brakeShare: (isFront ? brakeBias : 1 - brakeBias) / 2,
      slipScale: isFront ? frontSlip : 1,
      gripScale: isFront ? 1 : rearGrip,
      ...a,
    };
  };
  const wheels = [makeWheel(true, true), makeWheel(true, false), makeWheel(false, true), makeWheel(false, false)];

  // Box-approximation inertia, scaled down because mass is concentrated between the axles.
  // Better handling ratings get a slightly lower yaw inertia (more eager to turn in).
  const H = shape.roofY - shape.clearance;
  const box = (a, b) => (mass / 12) * (a * a + b * b) * 0.8;
  const inertia = {
    x: box(H, shape.L),
    y: box(shape.W, shape.L) * (1.12 - 0.025 * st.handling),
    z: box(shape.W, H),
  };

  const hull = new Float32Array(
    hullPoints(shape).flatMap(([x, y, z]) => [z, y - anchorHeight, -x]),
  );

  const tireMu = baseTireMu(def) * (1 + UPGRADE_EFFECTS.tires * up.tires);
  const peakSlipScale = tireType.peakSlipScale;

  const spec = {
    id: def.id,
    def,
    upgrades: up,
    mass,
    com: { x: 0, y: lay.cgHeight - anchorHeight, z: wb * (0.5 - wf) },
    inertia,
    hull,
    shape,
    anchorHeight,
    wheels,
    wheelbase: wb,
    track,
    wheelRadius: r,
    restLength,
    travel: sus.travel * 0.92,
    antiRollFront: sus.antiRollFront * front.spring,
    antiRollRear: sus.antiRollRear * rear.spring,
    tireMu,
    tireSurface: tireType.grip,
    peakSlipScale,
    peakSlip: SURFACES.asphalt.peakSlip * peakSlipScale * frontSlip, // front axle, used by the steering limit
    loadSens: 0.12,
    brakeForce: mass * G * (0.6 + 0.07 * st.braking) * (1 + UPGRADE_EFFECTS.brakes * up.brakes),
    maxSteer: (lay.maxSteer ?? 34) * DEG,
    steerSpeed: 3.0 + 0.15 * st.handling, // input units / s (keyboard), reduced with speed
    steerReturn: 5.5,
    steerRate: 5.0, // rad/s the front wheels can physically turn
    counterSteer: 0.9,
    // lateral tyre force is applied this far above the contact patch to tame the roll moment
    lateralForceLift: lay.cgHeight * 0.45,
    dragCoef: cal.dragCoef,
    downforce: def.aero?.downforce ?? 0.1,
    engine,
    drivenCount: wheels.filter((w) => w.driveShare > 0).length,
    cameraHeight: shape.hoodY + 0.4 - anchorHeight,
  };
  spec.performance = measurePerformance(spec);
  return spec;
}

/** Straight-line performance of a built spec (reflects upgrades). */
export function measurePerformance(spec) {
  const def = spec.def;
  const p = {
    mass: spec.mass,
    rolling: ASPHALT_ROLLING,
    dragCoef: spec.dragCoef,
    engine: spec.engine,
    traction: tractionLimit({
      mass: spec.mass,
      mu: spec.tireMu * (spec.tireSurface.asphalt ?? 1),
      drivetrain: def.stats.drivetrain,
      frontWeight: def.layout.frontWeight,
      cgHeight: def.layout.cgHeight,
      wheelbase: def.layout.wheelbase,
      awdFront: def.engine.awdFront,
    }),
  };
  return {
    zeroTo100: simulateStraight(p) / LAUNCH_LOSS, // what the full 3-D car actually does
    topSpeed: computeTopSpeed(p) * 3.6,
    peakTorque: spec.engine.peakTorque,
    peakPowerKw: peakPowerKw(spec.engine),
  };
}

function peakPowerKw(e) {
  let best = 0;
  for (let rpm = e.idleRpm; rpm <= e.redline; rpm += 50) {
    best = Math.max(best, (torqueAt(e.curve, rpm) * e.peakTorque * rpm * 2 * Math.PI) / 60 / 1000);
  }
  return best;
}
