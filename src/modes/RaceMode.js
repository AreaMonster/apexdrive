import { Mode } from './Mode.js';
import { LapTimer, formatTime } from '../core/LapTimer.js';
import { RacingLine } from '../ai/RacingLine.js';
import { AIDriver } from '../ai/AIDriver.js';
import { DIFFICULTY, DRIVER_NAMES, personaFor } from '../data/ai.js';
import { CARS, carById } from '../data/cars.js';
import { racePrize, POINTS } from '../data/economy.js';
import { mulberry32 } from '../maps/noise.js';

/**
 * Race against AI. config: { laps, opponents, difficulty, rubberBand, career: { champ, event, roster } }
 * The player starts at the back of the grid. Positions come from each car's along-track progress;
 * finished cars rank by finishing time. When the player finishes, an autopilot takes over for a
 * cool-down while the rest of the field comes home; unfinished cars get an estimated time.
 */
export class RaceMode extends Mode {
  constructor(game, config) {
    super(game, config);
    this.rand = mulberry32((Date.now() & 0xffff) + 7);
    this.elapsed = 0;
  }

  get title() {
    return this.config.career ? this.config.career.champ.name : 'Quick Race';
  }

  start() {
    const g = this.game;
    const map = g.map;
    const track = map.track;
    const laps = track.closed ? this.config.laps ?? 3 : 1;
    this.laps = laps;
    const grid = map.grid;
    const n = Math.max(0, Math.min(this.config.opponents ?? 5, grid.length - 1));
    const avgHalf = track.half.reduce((a, b) => a + b, 0) / track.count;
    this.line = new RacingLine(track, { margin: Math.min(1.4, avgHalf * 0.3) });
    const diff = DIFFICULTY[this.config.difficulty] || DIFFICULTY.medium;

    // opponents: the career roster, or random cars of the player's class
    const roster = this.config.career?.roster?.filter((r) => r.id !== 'player') ?? this._randomRoster(n);
    const aiUp = this.config.career ? diff.upgrades : this._playerUpgradeLevel();
    const upgrades = { engine: aiUp, tires: aiUp, brakes: aiUp, weight: aiUp };
    this.racers = [];
    roster.slice(0, n).forEach((r, k) => {
      const def = carById(r.carId);
      const car = g.createCar(def, upgrades, grid[k], r.color ?? Math.floor(this.rand() * def.colors.length));
      car.driver = new AIDriver({ vehicle: car.vehicle, map, line: this.line, difficulty: this.config.difficulty, weatherGrip: g.env.weather.grip, rand: this.rand, personality: personaFor(r.name) });
      car.name = r.name;
      car.id = r.id;
      car.carName = `${def.brand} ${def.name}`;
      this.addCar(car);
      this.racers.push(car);
    });
    this.player = { vehicle: g.vehicle, name: 'You', id: 'player', carName: `${g.carDef.brand} ${g.carDef.name}`, isPlayer: true };
    this.racers.push(this.player);
    for (const r of this.racers) {
      r.timer = new LapTimer(track, { laps, startS: map.startS, lapLength: map.lapLength });
      r.finishTime = null;
      r.bestLap = null;
    }
    this.lapTimer = this.player.timer;
    this.playerSlotIndex = n;
    g.placePlayer(grid[n]);
    this.startCountdown();
    this._others = this.racers.map(() => ({ s: 0, lateral: 0, speed: 0 }));
    this._near = {};
    this._hint = -1;
  }

  _playerUpgradeLevel() {
    const u = this.game.carUpgrades;
    return Math.round((u.engine + u.tires + u.brakes + u.weight) / 4);
  }

  _randomRoster(n) {
    // cars of the player's class with similar pace (0-100 within ±30%), always including the
    // player's own model, so a city car doesn't meet the class's hot hatch
    const mine = this.game.carDef;
    const cls = this.config.classId ?? mine.class;
    const near = (c) => Math.abs(c.stats.zeroTo100 / mine.stats.zeroTo100 - 1) <= 0.3;
    const pool = CARS.filter((c) => c.class === cls && (near(c) || c.id === mine.id));
    const names = [...DRIVER_NAMES].sort(() => this.rand() - 0.5);
    return Array.from({ length: n }, (_, k) => ({
      id: `ai${k}`,
      name: names[k % names.length],
      carId: pool[Math.floor(this.rand() * pool.length)].id,
    }));
  }

  onGo() {
    for (const r of this.racers) r.timer.start();
  }

  preStep(dt) {
    const t = this.game.map.track;
    // where everybody is along the track (AI drivers keep their own projection up to date)
    const pv = this.game.vehicle;
    const q = t.nearest(pv.pos.x, pv.pos.z, this._hint, this._near);
    this._hint = q.index;
    this.racers.forEach((r, k) => {
      const o = this._others[k];
      if (r.isPlayer) {
        o.s = q.s;
        o.lateral = q.lateral;
      } else {
        o.s = r.driver.s;
        o.lateral = r.driver.lateral;
      }
      o.speed = Math.max(0, r.vehicle.vLong);
    });
    const playerProgress = this.player.timer.progress;
    this.racers.forEach((r, k) => {
      if (!r.driver) return;
      const others = this._others.filter((_, j) => j !== k);
      r.driver.update(dt, others, { rubberBand: !!this.config.rubberBand, playerProgress, myProgress: r.timer.progress });
    });
    this.playerAutopilot?.update(dt, this._others.filter((_, j) => this.racers[j] !== this.player));
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    if (this.countdown <= 0) this.elapsed += dt;
    for (const r of this.racers) {
      const events = r.timer.update(dt, r.vehicle);
      for (const e of events) {
        if (e.type === 'lap' && (r.bestLap === null || e.time < r.bestLap)) r.bestLap = e.time;
        if (e.type === 'finish') {
          r.finishTime = e.total;
          if (r.driver) r.driver.coolDown = true;
        }
        if (r.isPlayer) this._playerEvent(e);
      }
      if (r.driver?.needsReset) {
        r.driver.reset();
        r.timer.invalidate();
      }
    }
    if (this.playerAutopilot?.needsReset) this.playerAutopilot.reset();
    this._rank();
    // everybody home (or a 25 s grace period after the player) → results
    if (this.player.finishTime !== null && this.endDelay <= 0 && !this.done) {
      const allIn = this.racers.every((r) => r.finishTime !== null);
      this.finishGrace = (this.finishGrace ?? 0) + dt;
      if (allIn || this.finishGrace > 25) this.endDelay = 1.5;
    }
  }

  _playerEvent(e) {
    const g = this.game;
    if (e.type === 'lap' && !e.final) {
      const left = this.laps - e.lap;
      if (left > 0) g.hud.showBanner(`<small>LAP ${e.lap}</small>${formatTime(e.time)}${left === 1 ? '<small>FINAL LAP</small>' : ''}`, '', 2.5);
    }
    if (e.type === 'finish') {
      g.hud.showBanner(`<small>FINISHED</small>P${this.position} of ${this.racers.length}`, this.position === 1 ? 'best' : '', 5);
      // hand the car to an autopilot for the cool-down
      this.playerAutopilot = new AIDriver({ vehicle: g.vehicle, map: g.map, line: this.line, difficulty: 'easy', weatherGrip: g.env.weather.grip });
      this.playerAutopilot.coolDown = true;
    }
  }

  _rank() {
    const key = (r) => (r.finishTime !== null ? 1e9 - r.finishTime : r.timer.progress);
    const order = [...this.racers].sort((a, b) => key(b) - key(a));
    order.forEach((r, k) => (r.position = k + 1));
    this.position = this.player.position;
    this.order = order;
  }

  /** Minimap dots for the opponents. */
  get dots() {
    return this.cars.map((c) => ({ x: c.vehicle.pos.x, z: c.vehicle.pos.z, color: 'rgba(255,90,70,0.95)' }));
  }

  /** Results: finishing order, times (estimated for cars still racing), prize, career points. */
  finish() {
    const g = this.game;
    const total = this.laps * g.map.lapLength;
    const retired = this.player.finishTime === null;
    const timeOf = (r) => {
      if (r.finishTime !== null) return { t: r.finishTime, est: false };
      const p = Math.max(1, r.timer.progress);
      const avg = p / Math.max(1, r.timer.totalTime);
      return { t: r.timer.totalTime + (total - p) / Math.max(avg, 1), est: true };
    };
    const rows = this.racers
      .filter((r) => !(r.isPlayer && retired))
      .map((r) => ({ r, ...timeOf(r) }))
      .sort((a, b) => a.t - b.t);
    if (retired) rows.push({ r: this.player, t: Infinity, est: false });
    const position = rows.findIndex((x) => x.r === this.player) + 1;
    const winner = rows[0].t;
    const credits = retired
      ? 0
      : racePrize({ distanceKm: total / 1000, difficulty: this.config.difficulty, position, career: !!this.config.career });
    if (!retired) g.profile.recordRace(position);
    return {
      title: retired ? 'Retired' : position === 1 ? 'Victory!' : `Finished P${position}`,
      subtitle: `${this.title} · ${g.map.name} · ${this.laps > 1 ? `${this.laps} laps` : g.map.track.closed ? '1 lap' : 'stage'} · ${DIFFICULTY[this.config.difficulty]?.label ?? ''}`,
      table: rows.map((x, k) => ({
        pos: k + 1,
        name: x.r.name,
        car: x.r.carName,
        time: x.t === Infinity ? 'DNF' : k === 0 ? formatTime(x.t) : `+${formatTime(x.t - winner)}${x.est ? '*' : ''}`,
        best: formatTime(x.r.bestLap),
        points: this.config.career && x.t !== Infinity ? POINTS[k] ?? 0 : null,
        player: x.r.isPlayer,
      })),
      order: rows.map((x) => x.r.id),
      position,
      credits,
      career: this.config.career ?? null,
      retired,
      footnote: rows.some((x) => x.est) ? '* estimated from average pace' : '',
      restartable: !this.config.career,
    };
  }
}
