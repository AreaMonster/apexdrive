// Web Audio context, mix buses and procedurally generated one-shot sounds.
//
// Browsers only allow audio after a user gesture, so the context is created on the first
// click / key / touch (unlock()). Everything is synthesised: no audio files are loaded.

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this._unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, this._unlock, { once: false, passive: true });
    // background tab: stop the audio thread entirely
    document.addEventListener('visibilitychange', () => this.setPaused(document.hidden));
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // no Web Audio: the game simply stays silent
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    // master → gentle compressor (keeps crashes and V8s from clipping) → speakers
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.connect(this.comp).connect(ctx.destination);
    this.bus = {};
    for (const name of ['engine', 'effects', 'ambient', 'ui']) {
      this.bus[name] = ctx.createGain();
      this.bus[name].connect(this.master);
    }
    this.white = this._noiseBuffer('white');
    this.brown = this._noiseBuffer('brown');
    this.applyVolumes();
    this.ready = true;
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.removeEventListener(ev, this._unlock);
    this.onReady?.();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const a = this.settings.audio;
    this.master.gain.value = a.master;
    this.bus.engine.gain.value = a.engine;
    this.bus.effects.gain.value = a.effects;
    this.bus.ambient.gain.value = a.ambient;
    this.bus.ui.gain.value = a.effects * 0.6;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p) this.ctx.suspend();
    else this.ctx.resume();
  }

  /** Two seconds of noise. White is flat; brown (integrated white) is a deep rumble. */
  _noiseBuffer(kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  /** Looping noise source (caller connects and starts it). */
  noise(kind = 'white') {
    const src = this.ctx.createBufferSource();
    src.buffer = kind === 'brown' ? this.brown : this.white;
    src.loop = true;
    // caller starts it at a random offset so several noise layers don't phase together
    return src;
  }

  // ---------------------------------------------------------------- one-shots

  /** Short sine/square beep (countdown lights, menu ticks). */
  beep(freq, dur = 0.15, { type = 'sine', gain = 0.25, bus = 'effects' } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus[bus]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Filtered noise burst: crashes, gearbox clunks, blow-off valves, exhaust pops. */
  burst({ freq = 800, q = 1, type = 'bandpass', dur = 0.2, gain = 0.4, attack = 0.002, bus = 'effects', pan = null, out = null, delay = 0 }) {
    if (!this.ready || gain < 0.001) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = src.connect(f).connect(g);
    if (pan !== null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out || this.bus[bus]);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  /** Collision: a low thump plus a crunchy noise burst, both scaled by severity (0..1). */
  impact(severity, volume = 1, out = null) {
    if (!this.ready || severity < 0.01 || volume < 0.02) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = Math.min(1, 0.25 + severity * 1.4) * volume;
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    og.gain.setValueAtTime(0.9 * g, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(og).connect(out || this.bus.effects);
    o.start(t);
    o.stop(t + 0.4);
    this.burst({ freq: 1400, q: 0.7, dur: 0.18 + severity * 0.4, gain: 0.55 * g, out });
    if (severity > 0.25) this.burst({ freq: 4200, q: 2, dur: 0.5, gain: 0.18 * g, out }); // glass / panel rattle
  }

  shift() {
    this.burst({ freq: 420, q: 1.5, type: 'lowpass', dur: 0.06, gain: 0.25 });
  }

  click() {
    this.beep(1800, 0.03, { type: 'square', gain: 0.03, bus: 'ui' });
  }
}
