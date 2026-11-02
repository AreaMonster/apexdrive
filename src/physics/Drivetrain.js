const RADS_TO_RPM = 60 / (2 * Math.PI);

// Piecewise-linear lookup of a normalised torque curve [[rpm, 0..1], ...].
export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * Engine + gearbox. Ratios are overall (gear × final drive).
 * engine: { ratios, reverseRatio, idleRpm, redline, launchRpm, curve, peakTorque,
 *           shiftTime, efficiency, engineBrake, wheelRadius }
 */
export class Drivetrain {
  constructor(engine) {
    this.e = engine;
    this.auto = true;
    this.reset();
  }

  reset() {
    this.gear = 1;
    this.rpm = this.e.idleRpm;
    this.shiftTimer = 0;
    this.sinceShift = 10;
    this.limiterTimer = 0;
    this.clutchSlip = false;
    this.torque = 0;
    this.throttle = 0;
  }

  get gearCount() {
    return this.e.ratios.length;
  }

  get ratio() {
    if (this.gear > 0) return this.e.ratios[this.gear - 1];
    if (this.gear < 0) return this.e.reverseRatio;
    return 0;
  }

  get shifting() {
    return this.shiftTimer > 0;
  }

  shiftUp() {
    if (this.gear === -1) this.gear = 1;
    else if (this.gear < this.gearCount) this.gear++;
    else return;
    this._startShift();
  }

  shiftDown() {
    if (this.gear <= 1) return;
    this.gear--;
    this._startShift();
  }

  setReverse(on) {
    if (on && this.gear !== -1) {
      this.gear = -1;
      this._startShift();
    } else if (!on && this.gear === -1) {
      this.gear = 1;
      this._startShift();
    }
  }

  _startShift() {
    this.shiftTimer = this.e.shiftTime;
    this.sinceShift = 0;
  }

  /**
   * Advance the engine and return the total drive force at the contact patches
   * (N along the car's forward axis; negative when driving in reverse).
   * wheelSpeed: signed longitudinal speed of the driven wheels (m/s)
   * spin: 0..1 wheelspin of the driven wheels (lets revs flare above road speed)
   */
  update(dt, throttle, wheelSpeed, spin = 0) {
    const e = this.e;
    this.sinceShift += dt;
    this.throttle = throttle;
    const dir = this.gear < 0 ? -1 : 1;
    const coupled = (Math.abs(wheelSpeed) / e.wheelRadius) * RADS_TO_RPM * this.ratio;

    // Simulated clutch: below the launch speed the clutch slips, so the engine can sit at
    // higher revs (and full torque) while the car is still slow.
    const launch = e.idleRpm + throttle * (e.launchRpm - e.idleRpm);
    this.clutchSlip = coupled < launch;
    const engineRpm = Math.max(coupled * (1 + spin * 0.6), launch);

    if (this.auto && this.gear >= 1 && this.shiftTimer <= 0 && this.sinceShift > 0.35) {
      const upAt = e.redline * (throttle > 0.6 ? 0.94 : 0.62);
      if (this.gear < this.gearCount && coupled > upAt && spin < 0.5) {
        this.shiftUp();
      } else if (this.gear > 1) {
        const lowerRpm = (coupled * e.ratios[this.gear - 2]) / this.ratio;
        // coast-down shift, or kick-down when flooring it with revs to spare
        if (coupled < e.redline * 0.36 || (throttle > 0.85 && lowerRpm < e.redline * 0.8)) this.shiftDown();
      }
    }

    let torque = 0;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt; // torque cut while the gear changes
    } else if (this.gear !== 0) {
      if (this.limiterTimer > 0) this.limiterTimer -= dt;
      else if (engineRpm >= e.redline) this.limiterTimer = 0.05;
      const drive = this.limiterTimer > 0 ? 0 : throttle * torqueAt(e.curve, Math.min(engineRpm, e.redline)) * e.peakTorque;
      // engine braking only when the clutch is engaged and the car rolls in the gear's direction
      let engBrake = 0;
      if (!this.clutchSlip && wheelSpeed * dir > 0) {
        engBrake = (1 - throttle) * e.engineBrake * Math.min(1, (engineRpm - e.idleRpm) / (e.redline - e.idleRpm));
      }
      torque = drive - engBrake;
    }
    this.torque = torque;

    const shown = Math.min(engineRpm, e.redline + 150);
    this.rpm += (shown - this.rpm) * Math.min(1, dt * 18);

    return ((torque * this.ratio * e.efficiency) / e.wheelRadius) * dir;
  }
}
