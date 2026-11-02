import * as THREE from 'three';

export const LIGHT_STEP = 0.7; // seconds between countdown lights
export const COUNTDOWN = LIGHT_STEP * 5 + 0.6;

/**
 * Base for game modes. A mode owns the rules of a session: where cars start, the countdown,
 * timing/scoring, extra (AI) cars, and the result handed to the results screen.
 *
 * Game calls, per frame: preStep(dt) before every physics step (AI controls), update(dt) after
 * physics, and finish() when the player quits or the mode ends itself (this.done = true).
 */
export class Mode {
  constructor(game, config = {}) {
    this.game = game;
    this.config = config;
    this.cars = []; // { vehicle, model, rs, driver?, name, ... } — AI / extra cars
    this.countdown = 0;
    this.goTimer = 0;
    this.done = false; // set when the mode ends by itself; Game then shows the result
    this.endDelay = 0;
    this.playerAutopilot = null; // AIDriver steering the player's car after the finish
    this.lapTimer = null;
    this.position = null;
    this.racers = null;
  }

  get title() {
    return 'Session';
  }

  start() {
    const g = this.game;
    g.placePlayer(this.playerSlot());
    this.startCountdown();
  }

  /** Grid pose for the player (default: pole). */
  playerSlot() {
    return this.game.map.grid?.[0] ?? this.game.map.spawn;
  }

  startCountdown() {
    const g = this.game;
    if (!g.map.track) {
      this.countdown = 0;
      this.lockAll(false);
      g.hud.setCountdown(null);
      return;
    }
    this.countdown = COUNTDOWN;
    this.lockAll(true);
    g.hud.setCountdown(0);
    g.map.setStartLights?.(0);
  }

  lockAll(locked) {
    this.game.vehicle.locked = locked;
    for (const c of this.cars) c.vehicle.locked = locked;
  }

  _updateCountdown(dt) {
    const g = this.game;
    if (this.countdown > 0) {
      this.countdown -= dt;
      const lit = Math.min(5, Math.floor((COUNTDOWN - this.countdown) / LIGHT_STEP));
      g.hud.setCountdown(lit);
      g.map.setStartLights?.(lit);
      if (this.countdown <= 0) {
        this.lockAll(false);
        g.hud.setCountdown(-1);
        g.map.setStartLights?.(-1);
        this.goTimer = 1.2;
        this.onGo();
      }
    } else if (this.goTimer > 0 && (this.goTimer -= dt) <= 0) {
      g.hud.setCountdown(null);
      g.map.setStartLights?.(0);
    }
  }

  onGo() {}

  preStep() {}

  update(dt) {
    this._updateCountdown(dt);
    if (this.endDelay > 0 && (this.endDelay -= dt) <= 0) this.done = true;
  }

  /** Player pressed R / car was recovered. */
  onPlayerReset() {
    this.lapTimer?.invalidate();
  }

  /** Called when the session ends (by quitting or this.done). Returns a result or null. */
  finish() {
    return null;
  }

  /** Add an extra car (AI or scripted) to the session. */
  addCar(entry) {
    entry.rs = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.cars.push(entry);
    return entry;
  }

  dispose() {
    for (const c of this.cars) {
      c.vehicle.dispose();
      c.model.dispose();
    }
    this.cars = [];
  }
}
