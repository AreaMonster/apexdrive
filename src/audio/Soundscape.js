import * as THREE from 'three';
import { CarVoice } from './CarVoice.js';

const AI_VOICES = 3; // the focus car plus the three nearest others get engines; the rest are too far to matter

/**
 * The session's sound world: a small pool of car voices handed to the nearest cars, the Web Audio
 * listener riding on the camera, wind on the followed car and rain ambience.
 *
 * Game feeds it every frame with the focus source (player, or the car a replay follows) and the
 * other cars; sources are Vehicle-shaped (see CarVoice).
 */
export class Soundscape {
  constructor(audio) {
    this.audio = audio;
    this.voices = [];
    this.listener = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    this._prevCam = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._first = true;
    this.active = false;
  }

  _build() {
    const a = this.audio;
    const ctx = a.ctx;
    for (let i = 0; i < 1 + AI_VOICES; i++) this.voices.push(new CarVoice(a));
    // wind over the body: band-passed noise that rises with speed and wavers a little
    this.wind = a.noise('white');
    this.windBp = ctx.createBiquadFilter();
    this.windBp.type = 'bandpass';
    this.windBp.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windBp).connect(this.windGain).connect(a.bus.ambient);
    // rain on the roof / around: bright hiss plus a softer low band
    this.rain = a.noise('white');
    this.rainHp = ctx.createBiquadFilter();
    this.rainHp.type = 'highpass';
    this.rainHp.frequency.value = 1400;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rain.connect(this.rainHp).connect(this.rainGain).connect(a.bus.ambient);
    const t = ctx.currentTime;
    this.wind.start(t, 0.3);
    this.rain.start(t, 1.1);
    this.windPhase = 0;
  }

  /** Start / stop the in-session sound (menus are quiet apart from UI clicks). */
  setActive(on) {
    this.active = on;
    if (!this.audio.ready) return;
    if (on && !this.voices.length) this._build();
    if (!on) {
      for (const v of this.voices) v.release();
      if (this.windGain) {
        const t = this.audio.now;
        this.windGain.gain.setTargetAtTime(0, t, 0.1);
        this.rainGain.gain.setTargetAtTime(0, t, 0.1);
      }
    }
    this._first = true;
  }

  /**
   * focus: { key, def, src } the car the camera is on; others: [{ key, def, src }];
   * camera: THREE camera; weather: Environment weather (for rain / wet roads)
   */
  update(dt, camera, focus, others, weather) {
    const a = this.audio;
    if (!this.active || !a.ready || a.paused) return;
    if (!this.voices.length) this._build();
    const ctx = a.ctx;
    const t = ctx.currentTime;

    // listener on the camera, with a velocity estimate for Doppler
    const L = this.listener;
    camera.getWorldPosition(L.pos);
    if (this._first || dt <= 0) L.vel.set(0, 0, 0);
    else L.vel.subVectors(L.pos, this._prevCam).divideScalar(dt).clampLength(0, 120);
    this._prevCam.copy(L.pos);
    this._first = false;
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.setValueAtTime(L.pos.x, t);
      l.positionY.setValueAtTime(L.pos.y, t);
      l.positionZ.setValueAtTime(L.pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      l.setPosition(L.pos.x, L.pos.y, L.pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }

    const rain = weather?.particles === 'rain' ? 1 : 0;
    const wet = weather?.wetness ?? 0;

    // voice 0 always follows the focus car; the rest go to the nearest others
    const v0 = this.voices[0];
    if (focus) {
      v0.bind(focus.key, focus.def);
      v0.update(dt, focus.src, L, { focus: true, wet });
    } else v0.release();
    const near = others
      .map((o) => ({ o, d: o.src.pos.distanceToSquared(L.pos) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, AI_VOICES)
      .map((x) => x.o);
    const pool = this.voices.slice(1);
    // keep voices on cars that are still near (no retune), hand free voices to newcomers
    const keep = new Set(near.map((o) => o.key));
    const free = [];
    for (const v of pool) {
      if (!v.key || !keep.has(v.key)) free.push(v);
      else keep.delete(v.key);
    }
    for (const o of near) {
      let v = pool.find((x) => x.key === o.key);
      if (!v) {
        v = free.shift();
        if (!v) continue;
        v.bind(o.key, o.def);
      }
      v.update(dt, o.src, L, { wet, volume: 0.85 });
    }
    for (const v of free) if (v.key) v.release();

    // wind: on the focus car's speed (the camera rides with it)
    const spd = focus ? focus.src.speed : 0;
    this.windPhase += dt * (0.7 + Math.random() * 0.2);
    const gust = 0.85 + 0.15 * Math.sin(this.windPhase) * Math.sin(this.windPhase * 0.37);
    const w = Math.min(1, Math.pow(spd / 70, 2)) * gust;
    this.windBp.frequency.setTargetAtTime(380 + spd * 9, t, 0.1);
    this.windGain.gain.setTargetAtTime(w * 0.32 + 0.004, t, 0.1);
    this.rainGain.gain.setTargetAtTime(rain * 0.12, t, 0.3);
  }

  /** A crash somewhere in the world: louder when near the listener. */
  impact(severity, pos) {
    const d = pos ? pos.distanceTo(this.listener.pos) : 0;
    this.audio.impact(severity, Math.min(1, 10 / Math.max(10, d)));
  }

  dispose() {
    for (const v of this.voices) v.dispose();
    this.voices = [];
    try {
      this.wind?.stop();
      this.rain?.stop();
    } catch {
      // never started
    }
  }
}
