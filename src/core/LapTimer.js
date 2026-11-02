// Lap logic for closed tracks.
//
// Progress is the along-track distance driven since the start, accumulated from the change of
// the car's projected arc position each frame (wrapped to ±L/2, so crossing s = 0 is seamless and
// driving backwards subtracts). Lap k ends when progress reaches k·L; checkpoints sit at fixed
// fractions of each lap and must all be passed for the lap to count, so cutting through the
// infield or reversing over the line can't complete a lap.
//
// Point-to-point stages work the same way with one "lap": progress starts at the start line
// (startS) and the stage ends after lapLength metres.

export const CHECKPOINTS = 12;
export const SECTORS = 3;

export class LapTimer {
  constructor(track, { laps = 0, best = null, startS = 0, lapLength = track.length } = {}) {
    this.track = track;
    this.startS = startS;
    this.lapLength = lapLength;
    this.laps = laps; // 0 = unlimited
    this.best = best; // { time, splits: [t1, t2, t3] }
    this.reset();
  }

  reset() {
    this.started = false;
    this.finished = false;
    this.lap = 1;
    this.lapTime = 0;
    this.totalTime = 0;
    this.lastLap = null;
    this.lapTimes = [];
    this.progress = 0;
    this.lapProgress = 0;
    this.checkpoint = 0;
    this.sector = 0;
    this.splits = [];
    this.invalid = false;
    this.wrongWay = false;
    this._wrongT = 0;
    this._s = null;
    this._hint = -1;
    this._near = {};
  }

  start() {
    this.started = true;
  }

  /** Mark the current lap as not eligible for records (e.g. after a reset). */
  invalidate() {
    if (this.started) this.invalid = true;
  }

  /** Returns a list of events that happened this frame. */
  update(dt, vehicle) {
    const events = [];
    const t = this.track;
    const L = this.lapLength;
    const q = t.nearest(vehicle.pos.x, vehicle.pos.z, this._hint, this._near);
    this._hint = q.index;
    if (this._s === null) {
      // first frame: the grid sits behind the line, so start with a small negative progress
      this._s = q.s;
      this.progress = t.delta(this.startS, q.s);
    } else {
      this.progress += t.delta(this._s, q.s);
      this._s = q.s;
    }

    // wrong way: moving against the track direction for a moment
    const tx = t.tan[q.index * 2];
    const tz = t.tan[q.index * 2 + 1];
    const along = vehicle.vel.x * tx + vehicle.vel.z * tz;
    this._wrongT = along < -3 ? this._wrongT + dt : 0;
    this.wrongWay = this._wrongT > 1.2;

    if (!this.started || this.finished) return events;
    this.lapTime += dt;
    this.totalTime += dt;

    const lapStart = (this.lap - 1) * L;
    this.lapProgress = Math.max(0, Math.min(1, (this.progress - lapStart) / L));

    // ordered checkpoints within the lap (checkpoint 0 is the finish line itself)
    while (this.checkpoint < CHECKPOINTS - 1 && this.progress >= lapStart + ((this.checkpoint + 1) / CHECKPOINTS) * L) {
      this.checkpoint++;
      const sectorIdx = Math.floor((this.checkpoint * SECTORS) / CHECKPOINTS);
      if (sectorIdx > this.sector) {
        this.sector = sectorIdx;
        this.splits.push(this.lapTime);
        const ref = this.best?.splits?.[sectorIdx - 1];
        events.push({ type: 'sector', sector: sectorIdx, time: this.lapTime, delta: ref ? this.lapTime - ref : null });
      }
    }

    if (this.progress >= lapStart + L && this.checkpoint === CHECKPOINTS - 1) {
      const time = this.lapTime;
      const valid = !this.invalid;
      const isBest = valid && (!this.best || time < this.best.time);
      const prevBest = this.best?.time ?? null;
      if (isBest) this.best = { time, splits: [...this.splits] };
      this.lapTimes.push(time);
      this.lastLap = { time, valid, isBest, delta: prevBest !== null ? time - prevBest : null };
      events.push({ type: 'lap', lap: this.lap, ...this.lastLap });
      this.lap++;
      this.lapTime = 0;
      this.checkpoint = 0;
      this.sector = 0;
      this.splits = [];
      this.invalid = false;
      if (this.laps && this.lap > this.laps) {
        this.finished = true;
        events.push({ type: 'finish', total: this.totalTime, laps: [...this.lapTimes] });
      }
    }
    return events;
  }
}

export function formatTime(t, { sign = false } = {}) {
  if (t === null || t === undefined || !isFinite(t)) return '--:--.---';
  const neg = t < 0;
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  const body = m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  return sign ? `${neg ? '−' : '+'}${body}` : `${neg ? '-' : ''}${body}`;
}
