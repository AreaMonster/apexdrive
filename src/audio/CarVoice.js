// One car's sound: engine, turbo, gearbox whine, tyres and road noise, placed in 3D.
//
// Engine model (4-stroke): every cylinder fires once per two crank turns, so the dominant pitch
// is rpm/60 · cylinders/2. Each layout gets its own harmonic recipe (a PeriodicWave) plus a
// sub-harmonic at crank order for the uneven-firing "burble" of cross-plane V8s and triples.
// The mix goes through a soft clipper whose drive rises with throttle (an engine under load is
// harsher) and a low-pass that opens with revs and load. A band of noise, amplitude-modulated at
// the firing frequency, adds exhaust rasp. Pitch is Doppler-shifted for cars passing the listener.
//
// The voice reads a Vehicle-shaped source: { pos, vel, speed, grounded, spec.engine,
// drivetrain: { rpm, throttle, gear, limiterTimer }, wheels: [{ skid, surface, contact }] },
// so live cars and replay frames sound the same.

const LAYOUTS = {
  I3: { harm: [1, 0.55, 0.42, 0.22, 0.16, 0.08, 0.05], sub: 1 / 1.5, subGain: 0.5, drive: 2.4, bright: 1.0 },
  I4: { harm: [1, 0.7, 0.45, 0.38, 0.22, 0.14, 0.09, 0.05], sub: 0.5, subGain: 0.12, drive: 2.6, bright: 1.15 },
  F6: { harm: [1, 0.42, 0.62, 0.25, 0.32, 0.14, 0.12], sub: 0.5, subGain: 0.28, drive: 2.2, bright: 1.1 },
  V6: { harm: [1, 0.55, 0.5, 0.3, 0.22, 0.14, 0.08], sub: 0.5, subGain: 0.3, drive: 2.3, bright: 1.05 },
  V8: { harm: [1, 0.48, 0.38, 0.22, 0.14, 0.08], sub: 0.5, subGain: 0.8, drive: 3.4, bright: 0.8 },
  V10: { harm: [1, 0.62, 0.52, 0.42, 0.33, 0.22, 0.15, 0.1], sub: 0.5, subGain: 0.3, drive: 2.6, bright: 1.35 },
  V12: { harm: [1, 0.8, 0.62, 0.52, 0.42, 0.32, 0.26, 0.2, 0.14], sub: 0.5, subGain: 0.06, drive: 1.7, bright: 1.55 },
  I6D: { harm: [1, 0.66, 0.44, 0.3, 0.18], sub: 0.5, subGain: 0.22, drive: 1.5, bright: 0.6, clatter: 1 },
};

const TARMAC = { asphalt: 1, kerb: 1, wet: 0.45 };
// loose surfaces: filter centre (Hz) and loudness of the crunch / spray
const LOOSE = {
  dirt: { f: 650, g: 1 },
  gravel: { f: 1300, g: 1.25 },
  sand: { f: 420, g: 0.8 },
  mud: { f: 300, g: 0.9 },
  snow: { f: 950, g: 0.7 },
  grass: { f: 1600, g: 0.55 },
  lakeice: { f: 1100, g: 0.45 },
  ice: { f: 1800, g: 0.25 },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const SPEED_OF_SOUND = 343;
const shaperCurves = new Map();

function shaperCurve() {
  if (shaperCurves.has('tanh')) return shaperCurves.get('tanh');
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  shaperCurves.set('tanh', c);
  return c;
}

export class CarVoice {
  constructor(audio) {
    this.audio = audio;
    const ctx = (this.ctx = audio.ctx);
    const P = (node, param, v) => ((node[param].value = v), node);
    const gain = (v = 0) => P(ctx.createGain(), 'gain', v);
    const filter = (type, f, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const panner = () => {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 6;
      p.rolloffFactor = 1.4;
      p.maxDistance = 10000;
      return p;
    };

    // outputs: engine bus and effects bus, each through its own 3D panner
    this.engPan = panner();
    this.fxPan = panner();
    this.engOut = gain(0);
    this.fxOut = gain(0);
    this.engOut.connect(this.engPan).connect(audio.bus.engine);
    this.fxOut.connect(this.fxPan).connect(audio.bus.effects);

    // --- engine
    this.osc = ctx.createOscillator();
    this.sub = ctx.createOscillator();
    this.sub.type = 'triangle';
    this.gMain = gain(1);
    this.gSub = gain(0);
    this.pre = gain(1);
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = shaperCurve();
    this.shaper.oversample = '2x';
    this.lp = filter('lowpass', 800, 0.9);
    this.engGain = gain(0);
    this.osc.connect(this.gMain).connect(this.pre);
    this.sub.connect(this.gSub).connect(this.pre);
    this.pre.connect(this.shaper).connect(this.lp).connect(this.engGain).connect(this.engOut);

    // exhaust rasp: band-passed noise pulsed at the firing frequency
    this.white = audio.noise('white');
    this.brown = audio.noise('brown');
    this.raspBp = filter('bandpass', 1200, 1.4);
    this.raspAm = gain(0.35);
    this.amDepth = gain(0.65);
    this.osc.connect(this.amDepth).connect(this.raspAm.gain);
    this.raspGain = gain(0);
    this.white.connect(this.raspBp).connect(this.raspAm).connect(this.raspGain).connect(this.engOut);

    // turbo whistle and gearbox whine
    this.turbo = ctx.createOscillator();
    this.turboGain = gain(0);
    this.turbo.connect(this.turboGain).connect(this.engOut);
    this.whine = ctx.createOscillator();
    this.whineGain = gain(0);
    this.whine.connect(this.whineGain).connect(this.engOut);

    // --- tyres and road
    this.sqBp = filter('bandpass', 1050, 9);
    this.sqBp2 = filter('bandpass', 2000, 12);
    this.sqGain = gain(0);
    this.white.connect(this.sqBp).connect(this.sqGain);
    this.white.connect(this.sqBp2).connect(this.sqGain);
    this.sqGain.connect(this.fxOut);
    this.looseBp = filter('bandpass', 700, 0.8);
    this.looseGain = gain(0);
    this.white.connect(this.looseBp).connect(this.looseGain).connect(this.fxOut);
    this.roadLp = filter('lowpass', 200, 0.5);
    this.roadGain = gain(0);
    this.brown.connect(this.roadLp).connect(this.roadGain).connect(this.fxOut);
    // kerb rumble strips: road noise chopped at stripe frequency
    this.kerbOsc = ctx.createOscillator();
    this.kerbOsc.type = 'square';
    this.kerbAm = gain(1); // 1 ± square = chopped on/off
    this.kerbOsc.connect(this.kerbAm.gain);
    this.kerbGain = gain(0);
    this.brown.connect(this.kerbAm).connect(this.kerbGain).connect(this.fxOut);
    this.wetHp = filter('highpass', 2600, 0.5);
    this.wetGain = gain(0);
    this.white.connect(this.wetHp).connect(this.wetGain).connect(this.fxOut);

    const t = ctx.currentTime;
    for (const o of [this.osc, this.sub, this.turbo, this.whine, this.kerbOsc]) o.start(t);
    this.white.start(t, Math.random() * 1.8);
    this.brown.start(t, Math.random() * 1.8);

    this.key = null;
    this.boost = 0;
    this.prevThrottle = 0;
    this.prevGear = 1;
    this.prevBoost = 0;
    this.level = 0;
  }

  /** Assign this voice to a car (def from data/cars.js). Silences it so the retune isn't heard. */
  bind(key, def) {
    if (this.key === key) return;
    this.key = key;
    this.def = def;
    const snd = def.sound;
    this.layout = LAYOUTS[snd.layout] || LAYOUTS.I4;
    this.cyl = snd.cylinders;
    this.rasp = snd.rasp;
    this.turboOn = snd.turbo;
    const h = this.layout.harm;
    const real = new Float32Array(h.length + 1);
    const imag = new Float32Array(h.length + 1);
    // alternate sine / cosine phases: a peakier, more "pulse-like" waveform than all-sine
    for (let i = 0; i < h.length; i++) (i % 2 ? real : imag)[i + 1] = h[i];
    this.osc.setPeriodicWave(this.ctx.createPeriodicWave(real, imag));
    const t = this.ctx.currentTime;
    for (const g of [this.engOut, this.fxOut]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(0, t);
    }
    this.boost = 0;
    this.level = 0;
    this.fresh = true;
  }

  release() {
    this.key = null;
    const t = this.ctx.currentTime;
    this.engOut.gain.setTargetAtTime(0, t, 0.08);
    this.fxOut.gain.setTargetAtTime(0, t, 0.08);
  }

  _place(panner, x, y, z, t) {
    if (panner.positionX) {
      if (this.fresh) {
        panner.positionX.setValueAtTime(x, t);
        panner.positionY.setValueAtTime(y, t);
        panner.positionZ.setValueAtTime(z, t);
      } else {
        panner.positionX.setTargetAtTime(x, t, 0.02);
        panner.positionY.setTargetAtTime(y, t, 0.02);
        panner.positionZ.setTargetAtTime(z, t, 0.02);
      }
    } else panner.setPosition(x, y, z);
  }

  /**
   * src: Vehicle-shaped source; listener: { pos, vel }; opts: { focus, wet, volume }
   * focus = the car the camera follows (gets gearbox clunks and the full mix).
   */
  update(dt, src, listener, { focus = false, wet = 0, volume = 1 } = {}) {
    const audio = this.audio;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.03) => param.setTargetAtTime(v, t, tc);
    const dtr = src.drivetrain;
    const eng = src.spec.engine;
    const L = this.layout;
    const rpm = dtr.rpm;
    const rpmN = clamp01((rpm - eng.idleRpm) / (eng.redline - eng.idleRpm));
    const th = clamp01(dtr.throttle);

    // position and Doppler
    const p = src.pos;
    this._place(this.engPan, p.x, p.y, p.z, t);
    this._place(this.fxPan, p.x, p.y, p.z, t);
    const dx = p.x - listener.pos.x;
    const dy = p.y - listener.pos.y;
    const dz = p.z - listener.pos.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const vr = ((src.vel.x - listener.vel.x) * dx + (src.vel.y - listener.vel.y) * dy + (src.vel.z - listener.vel.z) * dz) / dist;
    const doppler = Math.min(1.35, Math.max(0.75, SPEED_OF_SOUND / (SPEED_OF_SOUND + vr)));
    // beyond ~250 m nothing is audible anyway: fade out to save the mix
    const far = clamp01((260 - dist) / 60);
    const fresh = this.fresh;
    this.fresh = false;

    // --- engine
    const fire = (rpm / 60) * (this.cyl / 2) * doppler;
    set(this.osc.frequency, fire, 0.015);
    set(this.sub.frequency, fire * L.sub, 0.015);
    set(this.gSub.gain, L.subGain * (1 - rpmN * 0.5));
    // load: throttle matters more than revs; coasting is soft, the limiter stutters
    const limiter = dtr.limiterTimer > 0;
    const load = th * (dtr.shiftTimer > 0 ? 0.3 : 1);
    set(this.pre.gain, 0.5 + load * L.drive * (0.6 + this.rasp * 0.6) + rpmN * 0.6);
    const cutoff = Math.min(14000, (fire * 2.2 + 180) * (0.55 + load * 1.6 * L.bright) + rpmN * 1500 * L.bright);
    set(this.lp.frequency, cutoff, 0.02);
    const engLevel = (0.2 + rpmN * 0.4 + load * 0.4) * (limiter ? 0.55 : 1);
    set(this.engGain.gain, engLevel * 0.42, 0.02);
    // rasp: pulsed noise near the 3rd-4th firing harmonic, louder on throttle
    set(this.raspBp.frequency, Math.min(9000, fire * 3.2 + 300));
    set(this.raspGain.gain, this.rasp * (0.025 + load * 0.11) * (0.5 + rpmN) * (L.clatter ? 0.5 : 1));
    if (L.clatter) set(this.amDepth.gain, 0.9); // diesel knock: deeper pulsing

    // turbo: boost builds with revs × throttle and lags behind both
    if (this.turboOn) {
      const target = clamp01((rpmN - 0.2) / 0.5) * th;
      this.boost += (target - this.boost) * Math.min(1, dt * (target > this.boost ? 1.6 : 6));
      set(this.turbo.frequency, (2400 + this.boost * 4200 + rpmN * 1800) * doppler, 0.05);
      set(this.turboGain.gain, this.boost * 0.035);
      // blow-off valve when lifting with boost up
      if (this.prevBoost > 0.45 && th < 0.15 && this.prevThrottle > 0.5 && !fresh) {
        audio.burst({ freq: 3200, q: 0.9, type: 'bandpass', dur: 0.45, attack: 0.02, gain: 0.16 * this.prevBoost * volume * far, out: this.engOut });
      }
      this.prevBoost = this.boost;
    } else set(this.turboGain.gain, 0);

    // gearbox whine follows the input shaft; reverse gears whine loudly
    set(this.whine.frequency, Math.max(20, (rpm / 60) * 7.3 * doppler));
    set(this.whineGain.gain, (dtr.gear < 0 ? 0.03 : 0.004 + (this.rasp > 0.7 ? 0.006 : 0)) * (0.3 + load));

    // overrun crackle: snapping the throttle shut at high revs pops the exhaust
    if (!fresh && this.rasp >= 0.5 && this.prevThrottle > 0.6 && th < 0.1 && rpmN > 0.5) {
      const pops = 2 + Math.floor(Math.random() * 4 * this.rasp);
      for (let i = 0; i < pops; i++) {
        audio.burst({ freq: 260 + Math.random() * 500, q: 1.2, type: 'lowpass', dur: 0.05, gain: (0.3 + Math.random() * 0.4) * this.rasp * volume * far, delay: 0.05 + Math.random() * 0.7, out: this.engOut });
      }
    }
    if (dtr.gear !== this.prevGear && !fresh) {
      if (focus) audio.shift();
      // flat-out upshift on a raspy engine: a sharp crack
      if (dtr.gear > this.prevGear && this.prevThrottle > 0.6 && this.rasp > 0.6) {
        audio.burst({ freq: 700, q: 0.8, type: 'lowpass', dur: 0.07, gain: 0.35 * volume * far, out: this.engOut });
      }
    }
    this.prevGear = dtr.gear;
    this.prevThrottle = th;

    // --- tyres and road
    let sq = 0;
    let loose = 0;
    let looseF = 0;
    let looseG = 0;
    let kerb = 0;
    let contact = 0;
    for (const w of src.wheels) {
      if (!w.contact) continue;
      contact++;
      const tar = TARMAC[w.surface];
      if (tar) {
        sq += w.skid * tar;
        if (w.surface === 'kerb') kerb++;
      } else {
        const l = LOOSE[w.surface] || LOOSE.dirt;
        loose++;
        looseF += l.f;
        looseG += l.g * (0.4 + w.skid);
      }
    }
    const spd = src.speed;
    const moving = clamp01(spd / 4);
    sq = clamp01(sq / 2.2) * moving;
    set(this.sqGain.gain, Math.pow(sq, 1.5) * 0.3, 0.04);
    const wob = (Math.random() - 0.5) * 60;
    set(this.sqBp.frequency, (980 + sq * 280 + wob) * doppler, 0.05);
    set(this.sqBp2.frequency, (1900 + sq * 400 - wob) * doppler, 0.05);
    if (loose) {
      set(this.looseBp.frequency, looseF / loose);
      set(this.looseGain.gain, (looseG / 4) * (0.06 + clamp01(spd / 25) * 0.16) * moving, 0.05);
    } else set(this.looseGain.gain, 0, 0.05);
    const roll = contact ? Math.pow(clamp01(spd / 45), 1.2) : 0;
    set(this.roadLp.frequency, 110 + spd * 5 + loose * 60);
    set(this.roadGain.gain, roll * (0.22 + loose * 0.05), 0.05);
    set(this.kerbOsc.frequency, Math.max(1, spd / 1.1));
    set(this.kerbGain.gain, kerb ? Math.min(1, spd / 8) * 0.35 * (kerb / 2) : 0, 0.02);
    set(this.wetGain.gain, wet * roll * 0.12, 0.08);

    // master for this voice
    this.level = volume * far;
    set(this.engOut.gain, this.level, 0.05);
    set(this.fxOut.gain, this.level, 0.05);
  }

  dispose() {
    for (const o of [this.osc, this.sub, this.turbo, this.whine, this.kerbOsc, this.white, this.brown]) {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    }
    this.engPan.disconnect();
    this.fxPan.disconnect();
  }
}
