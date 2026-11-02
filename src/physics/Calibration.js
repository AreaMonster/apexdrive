import { Drivetrain, torqueAt } from './Drivetrain.js';

// Car data states performance (top speed, 0-100 km/h). This module derives the physical
// parameters (gear ratios, peak torque, drag coefficient) that produce those numbers, using a
// 1-D straight-line simulation that shares the in-game Drivetrain code.

const G = 9.81;
const TO_RADS = (2 * Math.PI) / 60;
const KMH100 = 100 / 3.6;
const SIM_DT = 1 / 120;
export const ASPHALT_ROLLING = 0.012;
export const LAUNCH_LOSS = 0.975;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function peakPowerRpm(curve, idleRpm, redline) {
  let best = idleRpm;
  let bestP = 0;
  for (let rpm = idleRpm; rpm <= redline; rpm += 25) {
    const p = torqueAt(curve, rpm) * rpm;
    if (p > bestP) {
      bestP = p;
      best = rpm;
    }
  }
  return best;
}

// Overall ratios: top gear reaches top speed near peak power; 1st gear tops out at ~28% of
// top speed. Intermediate gears are spaced geometrically with an exponent < 1 so the upper
// gears sit closer together, like a real gearbox.
export function buildGearRatios({ gears, topSpeed, redline, idleRpm, curve, wheelRadius }) {
  const rpmTop = Math.min(peakPowerRpm(curve, idleRpm, redline) * 1.04, redline * 0.97);
  const rTop = (rpmTop * TO_RADS * wheelRadius) / topSpeed;
  const v1 = clamp(topSpeed * 0.28, 12.5, 22);
  const r1 = (redline * 0.97 * TO_RADS * wheelRadius) / v1;
  const ratios = [];
  for (let i = 0; i < gears; i++) {
    const t = Math.pow(i / (gears - 1), 0.85);
    ratios.push(r1 * Math.pow(rTop / r1, t));
  }
  return { ratios, rpmTop };
}

// Max longitudinal force the driven axle can transmit, including static weight transfer
// (accelerating loads the rear: helps RWD, hurts FWD).
export function tractionLimit({ mass, mu, drivetrain, frontWeight, cgHeight, wheelbase, awdFront = 0.4 }) {
  const hl = cgHeight / wheelbase;
  if (drivetrain === 'AWD') {
    // fixed torque split: each axle carries its share of F while weight shifts rearward,
    // so whichever axle saturates first limits the total (usually the unloading front)
    const front = (mu * mass * G * frontWeight) / (awdFront + mu * hl);
    const rd = 1 - awdFront - mu * hl;
    const rear = rd > 0 ? (mu * mass * G * (1 - frontWeight)) / rd : Infinity;
    // on a real launch the springs take time to transfer that weight, so the 3-D car sits
    // between the static split limit and full four-wheel grip
    return (Math.min(front, rear, mu * mass * G) + mu * mass * G) / 2;
  }
  if (drivetrain === 'RWD') return (mu * mass * G * (1 - frontWeight)) / (1 - mu * hl);
  return (mu * mass * G * frontWeight) / (1 + mu * hl);
}

/** p: { mass, dragCoef, rolling, engine, traction } → seconds to reach `target` m/s */
export function simulateStraight(p, target = KMH100, maxTime = 40) {
  const dtr = new Drivetrain(p.engine);
  let v = 0;
  let t = 0;
  const traction = p.traction; // with traction control the 3-D car holds the tyres right at the limit
  while (t < maxTime) {
    const f = Math.min(dtr.update(SIM_DT, 1, v, 0), traction);
    const resist = p.dragCoef * v * v + p.rolling * p.mass * G;
    v = Math.max(0, v + ((f - resist) / p.mass) * SIM_DT);
    t += SIM_DT;
    if (v >= target) return t;
  }
  return Infinity;
}

/** Highest speed where some gear's full-throttle force still beats drag + rolling. */
export function computeTopSpeed(p) {
  const e = p.engine;
  let top = 0;
  for (let v = 1; v < 160; v += 0.05) {
    let best = 0;
    for (const r of e.ratios) {
      const rpm = (v / e.wheelRadius) * r / TO_RADS;
      if (rpm > e.redline) continue;
      const f = (torqueAt(e.curve, Math.max(rpm, e.launchRpm)) * e.peakTorque * r * e.efficiency) / e.wheelRadius;
      if (f > best) best = f;
    }
    if (Math.min(best, p.traction) < p.dragCoef * v * v + p.rolling * p.mass * G) break;
    top = v;
  }
  return top;
}

/**
 * Find the peak torque (and matching drag) that makes the car do 0-100 in `zeroTo100` s and
 * top out at `topSpeed` m/s. Drag is chosen so top-gear force at the top-speed rpm exactly
 * balances resistance; torque is then binary-searched against the launch simulation.
 */
export function calibrateEngine(base) {
  const { mass, topSpeed, engine, traction } = base;
  const { ratios, rpmTop } = base.gearing;
  const rTop = ratios[ratios.length - 1];
  const rolling = ASPHALT_ROLLING;
  const dragFor = (T) => {
    const f = (torqueAt(engine.curve, rpmTop) * T * rTop * engine.efficiency) / engine.wheelRadius;
    return Math.max(0.08, (f - rolling * mass * G) / (topSpeed * topSpeed));
  };
  const paramsFor = (T) => ({
    mass,
    rolling,
    traction,
    dragCoef: dragFor(T),
    engine: { ...engine, ratios, peakTorque: T },
  });

  // Time is not monotonic in torque: past the traction limit extra torque only buys extra drag
  // (drag is tied to torque by the top-speed constraint). Scan for the fastest torque first,
  // then binary-search the monotonic part below it.
  // The 3-D car loses ~2.5% to the launch transient (squat, pitch, spring energy) that this
  // point-mass model doesn't have; aim the 1-D model slightly quicker to compensate.
  let target = base.zeroTo100 * LAUNCH_LOSS;
  let lo = 40;
  let hi = 40;
  let fastest = Infinity;
  for (let T = 40; T <= 3000; T *= 1.08) {
    const t = simulateStraight(paramsFor(T));
    if (t < fastest) {
      fastest = t;
      hi = T;
    }
  }
  let warning = null;
  if (target < fastest * 1.02) {
    warning = `0-100 of ${target}s is traction-limited; using ${(fastest * 1.04).toFixed(2)}s`;
    target = fastest * 1.04;
  }
  for (let i = 0; i < 36; i++) {
    const mid = (lo + hi) / 2;
    if (simulateStraight(paramsFor(mid)) > target) lo = mid;
    else hi = mid;
  }
  return { peakTorque: hi, dragCoef: dragFor(hi), warning };
}
