import { surfaceOf } from '../data/surfaces.js';
import { DIFFICULTY } from '../data/ai.js';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Drives one Vehicle along a RacingLine.
 *
 * Steering is pure pursuit: aim at a point on the line some distance ahead (further at speed) and
 * turn the wheels to the arc that reaches it, δ = atan(2·L·sin α / d). That angle is converted to
 * the vehicle's -1..1 steering input through the same speed-sensitive limit the vehicle applies.
 * Throttle and brake chase the speed profile a short reaction distance ahead.
 *
 * On top: overtaking (shift to the side with room when stuck behind a slower car), defending
 * (one move to cover the inside before a corner), keeping clear of cars alongside, occasional
 * mistakes, optional subtle rubber-banding, and self-recovery.
 *
 * Every driver has a personality on top of the difficulty preset:
 *   aggression   how readily they commit to a pass (× the preset)
 *   caution      how much grip they leave in reserve when the weather takes it away
 *   consistency  fewer mistakes when high
 *   defend       how likely they are to cover the inside against a faster car
 * They also slow down as their car gets damaged (when damage affects handling).
 */
export class AIDriver {
  constructor({ vehicle, map, line, difficulty = 'medium', weatherGrip = null, rand = Math.random, personality = null }) {
    this.vehicle = vehicle;
    this.map = map;
    this.track = map.track;
    this.line = line;
    this.rand = rand;
    this.skill = DIFFICULTY[difficulty] || DIFFICULTY.medium;
    this.persona = personality || {
      aggression: 0.65 + rand() * 0.7,
      caution: 0.3 + rand() * 0.45,
      consistency: 0.7 + rand() * 0.6,
      defend: rand(),
    };
    // each driver is also slightly quicker or slower than the preset
    this.pace = this.skill.pace * (0.975 + rand() * 0.05);
    this.defendT = 0;
    this.defending = 0;
    this.hint = -1;
    this.near = {};
    this.sideOffset = 0;
    this.sideTarget = 0;
    this.mistake = null;
    this.mistakeCooldown = 3;
    this.stuckT = 0;
    this.offT = 0;
    this.wrongT = 0;
    this.needsReset = false;
    this.rubber = 1;
    this.s = 0;
    this.lateral = 0;
    this.setWeather(weatherGrip);
  }

  /**
   * (Re)build the target-speed profile for the current weather. Grip along the line is
   * tyre × surface × compound × weather; where the weather has taken grip away, cautious drivers
   * keep more in reserve (nobody drives a wet track at exactly the limit).
   */
  setWeather(weatherGrip) {
    const spec = this.vehicle.spec;
    const t = this.track;
    const map = this.map;
    const mus = new Float32Array(t.count);
    let loss = 0;
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < t.count; i++) {
      t.pointAt(i, this.line.offset[i], p);
      const surf = map.surfaceAt ? map.surfaceAt(p.x, p.z) : 'asphalt';
      const wx = weatherGrip ? weatherGrip[surf] ?? weatherGrip.default ?? 1 : 1;
      let reserve = 1 - this.persona.caution * Math.max(0, 1 - wx);
      // narrow roads and loose surfaces leave no room to run wide: keep a margin like a rally driver
      if (t.half[i] < 4.5) reserve *= AIDriver.narrowMargin;
      if (surfaceOf(surf).mu < 0.9) reserve *= AIDriver.looseMargin;
      mus[i] = spec.tireMu * surfaceOf(surf).mu * (spec.tireSurface[surf] ?? 1) * wx * reserve;
      loss += 1 - wx;
    }
    this.mus = mus;
    this.lowGrip = loss / t.count; // 0 dry … ~0.4 snow: raises the mistake rate
    const vmax = spec.performance.topSpeed / 3.6;
    // what the brakes really deliver: rated brake force, minus what ABS and front bias leave on the table
    const maxDecel = (spec.brakeForce / spec.mass) * 0.8 * this.skill.brake;
    this.profile = this.line.speedProfile((i) => mus[i], { vmax, gripUse: this.pace, brakeUse: this.skill.brake, maxDecel });
  }

  /** Steering limit the vehicle applies at this speed (mirrors Vehicle._updateControls). */
  _steerLimit(speed) {
    const s = this.vehicle.spec;
    return Math.min(s.maxSteer, Math.atan((s.wheelbase * s.tireMu * G * 1.1) / Math.max(speed * speed, 0.01)) + s.peakSlip * 0.6);
  }

  /**
   * One control update. others: [{ s, lateral, speed }] for every other car; playerProgress and
   * myProgress drive rubber-banding when enabled.
   */
  update(dt, others = [], { rubberBand = false, playerProgress = 0, myProgress = 0 } = {}) {
    const v = this.vehicle;
    const t = this.track;
    const c = v.controls;
    c.analog = true;
    c.handbrake = false;
    if (v.locked) {
      // on the grid: blip the throttle so the engine is ready for the launch
      c.throttle = 0.3;
      c.brake = 0;
      c.steer = 0;
      return;
    }

    const q = t.nearest(v.pos.x, v.pos.z, this.hint, this.near);
    this.hint = q.index;
    this.s = q.s;
    this.lateral = q.lateral;
    const i = q.index;
    const speed = Math.max(0, v.vLong);
    const step = t.step;
    const ahead = (m) => (t.closed ? t.wrap(i + Math.round(m / step)) : Math.min(t.count - 1, i + Math.round(m / step)));

    // --- mistakes: rolled once per braking zone
    this.mistakeCooldown -= dt;
    if (this.mistake) {
      this.mistake.t -= dt;
      if (this.mistake.t <= 0) this.mistake = null;
    } else if (this.mistakeCooldown <= 0 && this.profile[ahead(60)] < speed * 0.75) {
      this.mistakeCooldown = 6;
      // inconsistent drivers and slippery tracks make errors more likely
      if (this.rand() < (this.skill.mistake / this.persona.consistency) * (1 + this.lowGrip * 3)) {
        const kinds = ['late', 'wide', 'lift'];
        const kind = kinds[Math.floor(this.rand() * kinds.length)];
        this.mistake = { kind, t: kind === 'lift' ? 1.2 : 2.4, side: this.rand() < 0.5 ? -1 : 1 };
      }
    }

    // --- target speed: the profile a reaction distance ahead
    let vt = this.profile[ahead(Math.max(4, speed * 0.3))];
    if (this.mistake?.kind === 'late') vt *= 1.12;
    // a damaged car is slower and less sure-footed: back off with it
    if (v.damageMode === 'full') vt *= 1 - Math.min(0.18, v.damageTotal * 0.07);
    if (this.coolDown) {
      // finished: cruise, and on a point-to-point stage pull up before the road runs out
      vt = Math.min(vt, 16);
      if (!t.closed && t.length - this.s < 80) vt = 0;
    }
    if (rubberBand) {
      // subtle: at most ±3.5%, full effect 300 m from the player
      this.rubber = 1 + clamp((playerProgress - myProgress) / 300, -1, 1) * 0.035;
      vt *= this.rubber;
    }

    // --- traffic: overtake slower cars ahead, give room to cars alongside
    let blockS = Infinity;
    let block = null;
    let pushSide = 0;
    let attacker = null;
    for (const o of others) {
      const ds = t.delta(this.s, o.s);
      const dl = o.lateral - this.lateral;
      if (ds > 0 && ds < 32 && Math.abs(dl) < 2.4 && ds < blockS) {
        blockS = ds;
        block = o;
      }
      // a quicker car close behind and closing
      if (ds < -2 && ds > -16 && o.speed > speed + 0.6) attacker = o;
      if (Math.abs(ds) < 6 && Math.abs(dl) < 2.8) pushSide -= Math.sign(dl || 1) * (2.8 - Math.abs(dl));
    }
    const lineOff = this.line.offset[i];
    const lim = this.line.limit[i];
    if (block) {
      const faster = vt > block.speed + 1;
      // a pass needs a car's width of road beside the car ahead (narrow stages often have none)
      const roomL = block.lateral + lim;
      const roomR = lim - block.lateral;
      const room = Math.max(roomL, roomR) > 3;
      if (faster && room && (this.passing || this.rand() < this.skill.aggression * this.persona.aggression * dt * 3)) {
        // go round on the side with more road, away from the other car
        this.passing = true;
        const side = roomR > roomL ? 1 : -1;
        this.sideTarget = clamp(block.lateral + side * 3.4 - lineOff, -lim - lineOff, lim - lineOff);
      } else {
        // follow: match the car ahead, backing off as the gap closes
        vt = Math.min(vt, block.speed + (blockS - 9) * 0.35);
      }
    } else {
      this.passing = false;
      this.sideTarget = 0;
    }
    // defending: one move to the inside of the coming corner when a faster car is about to dive
    // down it; held until the braking zone, then back to the line
    this.defendT -= dt;
    const cornerAhead = this.profile[ahead(110)] < speed * 0.8;
    if (!block && attacker && cornerAhead && this.defendT <= 0 && this.rand() < this.persona.defend * this.skill.aggression) {
      const c = t.curv[ahead(120)];
      this.defending = Math.sign(c || 1) * Math.min(1.6, lim * 0.4); // + = right-hander: inside is right
      this.defendT = 6;
    }
    if (this.defending) {
      // back to the racing line before the braking point: braking off-line into the corner would
      // carry too much speed for the tighter arc
      const braking = this.profile[ahead(Math.max(30, speed * 1.6))] < speed * 0.92;
      if (!cornerAhead || braking || this.defendT < 3) this.defending = 0;
      else if (!block) {
        this.sideTarget = clamp(this.defending - lineOff, -lim - lineOff, lim - lineOff);
        vt *= 0.96;
      }
    }
    if (pushSide) this.sideTarget = clamp(this.sideTarget + pushSide, -lim - lineOff, lim - lineOff);
    if (this.mistake?.kind === 'wide') this.sideTarget = this.mistake.side * lim;
    this.sideOffset += clamp(this.sideTarget - this.sideOffset, -2.2 * dt, 2.2 * dt);

    // --- steering: pure pursuit toward the line (plus any side offset) ahead
    const look = clamp(6 + speed * 0.55, 8, 45);
    const ia = ahead(look);
    const tl = clamp(this.line.offset[ia] + this.sideOffset, -this.line.limit[ia], this.line.limit[ia]);
    const p = t.pointAt(ia, tl, this._p || (this._p = { x: 0, y: 0, z: 0 }));
    const dx = p.x - v.pos.x;
    const dz = p.z - v.pos.z;
    const lx = dx * v.right.x + dz * v.right.z;
    const lf = dx * v.fwd.x + dz * v.fwd.z;
    const alpha = Math.atan2(lx, lf);
    const ld = Math.max(4, Math.hypot(lx, lf));
    let delta = Math.atan((2 * v.spec.wheelbase * Math.sin(alpha)) / ld);
    // Pure pursuit is purely geometric: in long fast corners the tyres need extra angle (slip,
    // understeer), the car drifts wide and the error only shows up 45 m later. A cross-track term
    // (Stanley-style) steers back toward the line as soon as the car is off it.
    const here = clamp(this.line.offset[i] + this.sideOffset, -this.line.limit[i], this.line.limit[i]);
    delta -= Math.atan((AIDriver.crossTrack * (this.lateral - here)) / (speed + 4));
    let steer = clamp(delta / this._steerLimit(speed), -1, 1);
    if (lf < 0) steer = Math.sign(lx || 1); // target behind us (after a spin): full lock toward it

    // --- pedals
    const err = vt - speed;
    // brake firmly as soon as we're over the profile: it already contains the braking curve, so
    // any lag here turns straight into running wide at the corner
    let throttle = err > 0 ? clamp(err * 0.4 + 0.25, 0, 1) : 0;
    let brake = err < -0.5 ? clamp(0.25 - err * 0.45, 0, 1) : 0;
    if (this.mistake?.kind === 'lift') throttle = Math.min(throttle, 0.35);
    // feed the power in: while the tyres are still busy cornering (friction circle) or the car is
    // already sliding, full throttle would just spin the rears on the exit kerb
    const muHere = this.mus[i] || 1;
    const latUse = Math.min(1, Math.abs(v.latG) / (muHere * 0.95));
    throttle = Math.min(throttle, 0.3 + 0.7 * (1 - latUse * latUse));
    const slide = Math.abs(v.bodySlip);
    if (slide > 0.1 && speed > 8) throttle = Math.min(throttle, Math.max(0.15, 0.6 - (slide - 0.1) * 4));
    if (lf < 0 && speed < 4) {
      // facing the wrong way: reverse-turn would be smarter, a slow turn is good enough
      throttle = 0.5;
      brake = 0;
    }
    c.steer = steer;
    c.throttle = throttle;
    c.brake = brake;

    // --- recovery: stuck, lost far off the road, or pointing the wrong way
    const tx = t.tan[i * 2];
    const tz = t.tan[i * 2 + 1];
    const along = v.fwd.x * tx + v.fwd.z * tz;
    this.stuckT = speed < 1.5 ? this.stuckT + dt : 0;
    this.offT = q.dist > t.half[i] + 14 ? this.offT + dt : 0;
    this.wrongT = along < -0.3 ? this.wrongT + dt : 0;
    if (this.coolDown && speed < 1.5) this.stuckT = 0; // parked after the finish on purpose
    if (this.stuckT > 3.5 || this.offT > 4 || this.wrongT > 3 || v.needsRecovery) this.needsReset = true;
  }

  /** Put the car back on the racing line at its current position. */
  reset() {
    const v = this.vehicle;
    const pose = this.map.getResetPose(v.pos, this.hint);
    v.reset(pose.position, pose.yaw);
    this.needsReset = false;
    this.stuckT = this.offT = this.wrongT = 0;
    this.sideOffset = this.sideTarget = 0;
    this.mistake = null;
  }
}

AIDriver.crossTrack = 0.8; // gain of the cross-track steering term
AIDriver.narrowMargin = 0.94; // grip kept in hand on roads under 9 m wide
AIDriver.looseMargin = 0.95; // … and on loose surfaces
