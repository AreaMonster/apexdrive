import * as THREE from 'three';
import { Mode } from './Mode.js';
import { LapTimer, formatTime } from '../core/LapTimer.js';
import { GhostRecorder, GhostPlayer, encodeGhost, decodeGhost } from '../core/Ghost.js';
import { buildCarModel } from '../cars/CarModel.js';
import { timeTrialPrize } from '../data/economy.js';

/** Alone against the clock and your best-lap ghost. Circuits: unlimited laps; stages: one run. */
export class TimeTrialMode extends Mode {
  constructor(game, config) {
    super(game, config);
    this.recorder = new GhostRecorder();
    this.ghostPlayer = null;
    this.ghostModel = null;
    this.ghostPos = null;
    this.liveDelta = null;
    this._gp = new THREE.Vector3();
    this._gq = new THREE.Quaternion();
    this.validLaps = 0;
    this.newBest = false;
    this.startBest = null;
  }

  get title() {
    return 'Time Trial';
  }

  start() {
    const g = this.game;
    const carId = g.carDef.id;
    const track = g.map.track;
    this.lapTimer = new LapTimer(track, {
      laps: track.closed ? 0 : 1,
      best: g.records.best(g.map.id, carId),
      startS: g.map.startS,
      lapLength: g.map.lapLength,
    });
    this.startBest = this.lapTimer.best?.time ?? null;
    const frames = decodeGhost(g.records.loadGhost(g.map.id, carId));
    if (frames) this._setGhost(frames);
    super.start();
  }

  onGo() {
    this.lapTimer.start();
  }

  _setGhost(frames) {
    const g = this.game;
    this.ghostPlayer = new GhostPlayer(frames);
    if (!this.ghostModel) {
      this.ghostModel = buildCarModel(g.carDef, g.vehicle.spec, 0, { ghost: true });
      this.ghostModel.root.visible = false;
      g.gfx.scene.add(this.ghostModel.root);
    }
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    const v = g.vehicle;
    const lt = this.lapTimer;
    const L = lt.lapLength;
    const stage = !g.map.track.closed;
    const lapDist = () => lt.progress - (lt.lap - 1) * L;

    for (const e of lt.update(dt, v)) {
      if (e.type === 'sector') {
        const d = e.delta;
        g.hud.showBanner(`<small>SECTOR ${e.sector}</small>${d === null ? formatTime(e.time) : `<b>${formatTime(d, { sign: true })}</b>`}`, d === null ? '' : d <= 0 ? 'good' : 'bad', 1.8);
      } else if (e.type === 'lap') {
        const frames = this.recorder.finish(e.time, v.curPos, v.curQuat, L);
        let html = `<small>${stage ? 'STAGE COMPLETE' : `LAP ${e.lap}`}</small>${formatTime(e.time)}`;
        let kind = '';
        if (e.valid) this.validLaps++;
        if (!e.valid) html += '<small>invalid — car was reset</small>';
        else if (e.isBest) {
          html += `<small>PERSONAL BEST${e.delta !== null ? ` ${formatTime(e.delta, { sign: true })}` : ''}</small>`;
          kind = 'best';
          this.newBest = true;
          g.records.saveBest(g.map.id, g.carDef.id, { time: e.time, splits: lt.best.splits });
          g.records.saveGhost(g.map.id, g.carDef.id, encodeGhost(frames, { car: g.carDef.id, time: e.time }));
          this._setGhost(frames);
        } else if (e.delta !== null) {
          html += `<small>${formatTime(e.delta, { sign: true })} to best</small>`;
          kind = 'bad';
        }
        g.hud.showBanner(html, kind, stage ? 4 : 3.5);
      } else if (e.type === 'finish') {
        this.endDelay = 4;
      }
    }
    if (lt.started && !lt.finished) this.recorder.update(dt, lt.lapTime, v.curPos, v.curQuat, lapDist());

    // ghost + live delta against the personal-best lap
    const gp = this.ghostPlayer;
    this.ghostPos = null;
    this.liveDelta = null;
    if (gp && lt.started) {
      const show = g.settings.ghost && gp.sample(lt.lapTime, this._gp, this._gq);
      this.ghostModel.root.visible = !!show;
      if (show) {
        this.ghostModel.setPose(this._gp, this._gq);
        this.ghostPos = this._gp;
      }
      const d = lapDist();
      if (d > 30) {
        const tb = gp.timeAtProgress(d);
        if (tb !== null) this.liveDelta = lt.lapTime - tb;
      }
    } else if (this.ghostModel) this.ghostModel.root.visible = false;
  }

  finish() {
    const lt = this.lapTimer;
    const credits = timeTrialPrize(this.validLaps, this.newBest);
    return {
      title: 'Time Trial',
      subtitle: `${this.game.map.name} · ${this.game.carDef.brand} ${this.game.carDef.name}`,
      rows: lt.lapTimes.map((t, k) => ({ label: this.game.map.track.closed ? `Lap ${k + 1}` : 'Stage', value: formatTime(t), best: lt.best && t === lt.best.time })),
      summary: [
        ['Best', formatTime(lt.best?.time)],
        ['Previous best', formatTime(this.startBest)],
        ['Valid laps', String(this.validLaps)],
      ],
      credits,
      restartable: true,
    };
  }

  dispose() {
    super.dispose();
    this.ghostModel?.dispose();
    this.ghostModel = null;
  }
}
