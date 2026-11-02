import { Mode } from './Mode.js';
import { LapTimer } from '../core/LapTimer.js';
import { driftPrize } from '../data/economy.js';

const RUN_TIME = 90; // seconds on circuits (stages: until the finish)
const MIN_ANGLE = 12; // degrees of body slip to count as drifting
const MIN_SPEED = 30; // km/h
const GRACE = 1.2; // seconds between drifts that still keep a chain alive

/**
 * Drift Challenge. While the car slides (body slip ≥ 12° above 30 km/h, on the road) it earns
 * points at a rate of angle × speed. Linked drifts build a chain whose multiplier grows every two
 * seconds of continuous sliding (up to ×5); the chain is banked when the car straightens for more
 * than 1.2 s, and lost entirely on an impact or leaving the road.
 */
export class DriftMode extends Mode {
  constructor(game, config) {
    super(game, config);
    this.score = 0;
    this.chain = 0;
    this.chainTime = 0;
    this.grace = 0;
    this.bestChain = 0;
    this.timeLeft = RUN_TIME;
    this.angle = 0;
    this.lost = 0;
  }

  get title() {
    return 'Drift Challenge';
  }

  get multiplier() {
    return Math.min(5, 1 + Math.floor(this.chainTime / 2) * 0.5);
  }

  start() {
    const g = this.game;
    const track = g.map.track;
    this.stage = !track.closed;
    this.lapTimer = new LapTimer(track, { laps: track.closed ? 0 : 1, startS: g.map.startS, lapLength: g.map.lapLength });
    this.best = g.records.best(g.map.id, `drift:${g.carDef.id}`)?.time ?? null;
    this._impactHook = g.vehicle.onImpact;
    g.vehicle.onImpact = (imp) => {
      this._impactHook?.(imp);
      if (imp.severity > 0.04) this._lose('Crashed');
    };
    super.start();
  }

  onGo() {
    this.lapTimer.start();
    this.running = true;
  }

  _lose(why) {
    if (this.chain > 0) {
      this.game.hud.showBanner(`<small>${why.toUpperCase()}</small>Chain lost`, 'bad', 1.5);
      this.lost++;
    }
    this.chain = 0;
    this.chainTime = 0;
  }

  _bank() {
    if (this.chain <= 0) return;
    const pts = Math.round(this.chain * this.multiplier);
    this.score += pts;
    this.bestChain = Math.max(this.bestChain, pts);
    this.game.hud.showBanner(`<small>DRIFT ×${this.multiplier.toFixed(1)}</small>+${pts.toLocaleString()}`, 'good', 1.4);
    this.chain = 0;
    this.chainTime = 0;
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    const v = g.vehicle;
    const lt = this.lapTimer;
    for (const e of lt.update(dt, v)) if (e.type === 'finish') this._end();
    if (!this.running || this.done || this.endDelay > 0) return;
    if (!this.stage) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this._end();
        return;
      }
    }
    const q = g.map.track.nearest(v.pos.x, v.pos.z, lt._hint, {});
    const onRoad = q.dist < g.map.track.half[q.index] + 2;
    const kmh = v.speedKmh;
    this.angle = Math.abs((v.bodySlip * 180) / Math.PI);
    const drifting = this.angle > MIN_ANGLE && kmh > MIN_SPEED && v.grounded >= 3 && onRoad;
    if (!onRoad && this.chain > 0 && q.dist > g.map.track.half[q.index] + 4) this._lose('Off track');
    if (drifting) {
      this.grace = 0;
      this.chainTime += dt;
      this.chain += dt * Math.min(this.angle, 60) * kmh * 0.25;
    } else if (this.chain > 0) {
      this.grace += dt;
      if (this.grace > GRACE) this._bank();
    }
  }

  _end() {
    if (this.endDelay > 0 || this.done) return;
    this._bank();
    this.running = false;
    this.endDelay = 2.5;
    this.game.hud.showBanner(`<small>TIME</small>${this.score.toLocaleString()} pts`, 'best', 3);
  }

  onPlayerReset() {
    this._lose('Reset');
  }

  get hudInfo() {
    return {
      score: this.score,
      chain: Math.round(this.chain),
      multiplier: this.multiplier,
      angle: this.angle,
      timeLeft: this.stage ? null : this.timeLeft,
      drifting: this.chain > 0 && this.grace === 0,
    };
  }

  finish() {
    const g = this.game;
    const newBest = this.best === null || this.score > this.best;
    if (newBest && this.score > 0) g.records.saveBest(g.map.id, `drift:${g.carDef.id}`, { time: this.score });
    return {
      title: 'Drift Challenge',
      subtitle: `${g.map.name} · ${g.carDef.brand} ${g.carDef.name}`,
      summary: [
        ['Score', this.score.toLocaleString()],
        ['Best chain', this.bestChain.toLocaleString()],
        ['Chains lost', String(this.lost)],
        ['Personal best', newBest && this.score > 0 ? `${this.score.toLocaleString()} (new!)` : (this.best ?? 0).toLocaleString()],
      ],
      credits: driftPrize(this.score),
      restartable: true,
    };
  }

  dispose() {
    super.dispose();
    if (this.game.vehicle) this.game.vehicle.onImpact = this._impactHook;
  }
}
