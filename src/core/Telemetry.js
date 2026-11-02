// Measures real driving numbers while you play: 0-100 km/h from a standstill, 100-0 braking
// distance and top speed. Useful for checking the car data against what the physics delivers.
export class Telemetry {
  constructor() {
    this.reset();
  }

  reset() {
    this.zeroTo100 = null;
    this.best0to100 = null;
    this.brake100 = null;
    this.topSpeed = 0;
    this._accelT = null;
    this._brakeDist = null;
    this._lastKmh = 0;
  }

  update(dt, v) {
    const kmh = v.speedKmh;
    const c = v.controls;

    // 0-100: timer starts when throttle is applied from (near) standstill (not while held on the grid)
    if ((kmh < 1 && c.throttle < 0.1) || v.locked) this._accelT = null;
    if (v.locked) return;
    if (this._accelT === null && kmh < 1 && c.throttle > 0.5) this._accelT = 0;
    if (this._accelT !== null) {
      this._accelT += dt;
      if (c.brake > 0.1 || c.handbrake) this._accelT = null;
      else if (kmh >= 100) {
        this.zeroTo100 = this._accelT;
        this.best0to100 = Math.min(this.best0to100 ?? Infinity, this._accelT);
        this._accelT = null;
      }
    }

    // 100-0: starts when speed crosses 100 km/h downward with the brake pressed
    if (this._brakeDist === null && this._lastKmh >= 100 && kmh < 100 && c.brake > 0.5) this._brakeDist = 0;
    if (this._brakeDist !== null) {
      this._brakeDist += v.speed * dt;
      if (c.throttle > 0.1) this._brakeDist = null;
      else if (kmh < 0.5) {
        this.brake100 = this._brakeDist;
        this._brakeDist = null;
      }
    }

    this.topSpeed = Math.max(this.topSpeed, kmh);
    this._lastKmh = kmh;
  }
}
