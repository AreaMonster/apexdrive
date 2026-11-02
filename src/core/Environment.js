import * as THREE from 'three';
import { WEATHER } from '../data/weather.js';

// Time of day + weather → lighting state for the renderer.
//
// The sun moves on a simple arc: hour 6 rises, 12 peaks at the map's `maxElevation`, 18 sets.
// Sky, light and fog colours are keyed by the sun's elevation (night → twilight → golden hour →
// day) and interpolated; weather then greys the sky, dims the key light and pulls the fog in.
// At night the key light swings over to a dim blue moon on the opposite side of the sky.

const DEG = Math.PI / 180;

// keyframes by sun elevation (degrees)
const KEYS = [
  { e: -18, zenith: 0x02040b, horizon: 0x070c18, ground: 0x050608, light: 0x8aa4ff, sunGlow: 0, hemi: 0.26, hemiSky: 0x4a5f92, exposure: 1.4, env: 0.3 },
  { e: -7, zenith: 0x0a1430, horizon: 0x1e2142, ground: 0x0d0f16, light: 0x8aa4ff, sunGlow: 0, hemi: 0.3, hemiSky: 0x50628f, exposure: 1.3, env: 0.35 },
  { e: -1.5, zenith: 0x1e3366, horizon: 0xb2606a, ground: 0x2a2630, light: 0xff7a4a, sunGlow: 0.6, hemi: 0.4, hemiSky: 0x8a7ab0, exposure: 1.15, env: 0.45 },
  { e: 3, zenith: 0x34579a, horizon: 0xf08a4a, ground: 0x5a5048, light: 0xff8a3a, sunGlow: 1, hemi: 0.48, hemiSky: 0xb8a8c8, exposure: 1.1, env: 0.55 },
  { e: 10, zenith: 0x3d69b5, horizon: 0xf2c08a, ground: 0x7a7a68, light: 0xffc27a, sunGlow: 1, hemi: 0.5, hemiSky: 0xc8d4ee, exposure: 1.0, env: 0.65 },
  { e: 25, zenith: 0x3f74c8, horizon: 0xcfe1f2, ground: 0x8c9a80, light: 0xfff0dc, sunGlow: 1, hemi: 0.55, hemiSky: 0xcfe3ff, exposure: 1.0, env: 0.7 },
  { e: 90, zenith: 0x3a70c8, horizon: 0xc8dcf0, ground: 0x8c9a80, light: 0xfff4e6, sunGlow: 1, hemi: 0.55, hemiSky: 0xcfe3ff, exposure: 1.0, env: 0.7 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'ground', 'light', 'hemiSky'];

const _a = new THREE.Color();
const _b = new THREE.Color();
const GREY = new THREE.Color(0x9aa3ad);

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class Environment {
  constructor(renderer) {
    this.renderer = renderer;
    this.L = {
      zenith: new THREE.Color(),
      horizon: new THREE.Color(),
      ground: new THREE.Color(),
      sunDir: new THREE.Vector3(),
      sunColor: new THREE.Color(),
      sunGlow: 1,
      moonDir: new THREE.Vector3(),
      lightDir: new THREE.Vector3(),
      lightColor: new THREE.Color(),
      lightIntensity: 1,
      hemiSky: new THREE.Color(),
      hemiGround: new THREE.Color(),
      hemiIntensity: 0.5,
      fogColor: new THREE.Color(),
      fogNear: 300,
      fogFar: 2000,
      exposure: 1,
      envIntensity: 0.7,
      night: 0,
      overcast: 0,
    };
    this.time = 13;
    this.weatherId = 'clear';
    this.cycle = false;
    this.cycleMinutes = 6;
    this._lastEnvElev = null;
    this._envTimer = 0;
  }

  get weather() {
    return WEATHER[this.weatherId] || WEATHER.clear;
  }

  /** 0 by day … 1 at full night (drives headlights, windows, street lamps, stars). */
  get night() {
    return this.L.night;
  }

  /** Configure for a map: { time, azimuth, maxElevation, haze, fog: {near, far}, weather } */
  setMap(env = {}) {
    this.base = {
      time: env.time ?? 13,
      azimuth: env.azimuth ?? 210,
      maxElevation: env.maxElevation ?? 62,
      haze: env.haze !== undefined ? new THREE.Color(env.haze) : null,
      hazeAmount: env.hazeAmount ?? 0.35,
      fog: env.fog || { near: 300, far: 2200 },
      groundTint: env.ground !== undefined ? new THREE.Color(env.ground) : null,
    };
    this.time = this.base.time;
    this.weatherId = env.weather || 'clear';
  }

  setTime(t) {
    this.time = ((t % 24) + 24) % 24;
    this.apply(true);
  }

  setWeather(id) {
    this.weatherId = WEATHER[id] ? id : 'clear';
    this.apply(true);
  }

  update(dt) {
    if (!this.cycle) return;
    this.time = (this.time + (dt * 24) / (this.cycleMinutes * 60)) % 24;
    this._envTimer -= dt;
    // sky and lights update every frame; the reflection map only every few degrees of sun travel
    const rebuild = this._envTimer <= 0 && Math.abs(this.sunElevation - (this._lastEnvElev ?? 999)) > 2.5;
    if (rebuild) this._envTimer = 1;
    this.apply(rebuild);
  }

  get sunElevation() {
    const b = this.base;
    const arc = Math.sin(((this.time - 6) / 12) * Math.PI); // 0 at 6h & 18h, 1 at noon, <0 at night
    return Math.asin(arc * Math.sin(b.maxElevation * DEG)) / DEG;
  }

  apply(rebuildEnv = false) {
    const b = this.base;
    const L = this.L;
    const w = this.weather;
    const elev = this.sunElevation;
    const az = (b.azimuth + (this.time - 12) * 15) * DEG;
    const ce = Math.cos(elev * DEG);
    L.sunDir.set(Math.sin(az) * ce, Math.sin(elev * DEG), Math.cos(az) * ce).normalize();
    L.moonDir.set(-Math.sin(az) * 0.8, 0.6, -Math.cos(az) * 0.8).normalize();

    // interpolate the elevation keyframes
    let k = 0;
    while (k < KEYS.length - 2 && elev > KEYS[k + 1].e) k++;
    const k0 = KEYS[k];
    const k1 = KEYS[k + 1];
    const f = Math.min(1, Math.max(0, (elev - k0.e) / (k1.e - k0.e)));
    const mixC = (key, out) => out.copy(_a.set(k0[key])).lerp(_b.set(k1[key]), f);
    const mixN = (key) => k0[key] + (k1[key] - k0[key]) * f;
    mixC('zenith', L.zenith);
    mixC('horizon', L.horizon);
    mixC('ground', L.ground);
    mixC('light', L.lightColor);
    mixC('hemiSky', L.hemiSky);
    L.sunColor.copy(L.lightColor);
    L.sunGlow = mixN('sunGlow');
    L.hemiIntensity = mixN('hemi');
    L.exposure = mixN('exposure');
    L.envIntensity = mixN('env');
    L.night = smooth(1, -8, elev);

    // key light: sun above the horizon, moon below it (cross-fading through near-zero intensity)
    const sunI = 2.7 * smooth(-1.5, 8, elev);
    const moonI = 0.5 * L.night;
    if (sunI >= moonI) {
      L.lightDir.copy(L.sunDir);
      L.lightIntensity = sunI;
    } else {
      L.lightDir.copy(L.moonDir);
      L.lightColor.set(0x8aa4ff);
      L.lightIntensity = moonI;
    }

    // map haze tints the horizon (desert dust, coastal sunset glow)
    if (b.haze) L.horizon.lerp(b.haze, b.hazeAmount * (1 - L.night * 0.7));
    L.hemiGround.copy(b.groundTint || L.ground).multiplyScalar(0.6 + 0.4 * (1 - L.night));

    // weather: grey the sky toward a brightness-matched overcast, dim the key light
    L.overcast = w.overcast;
    if (w.overcast > 0) {
      const lum = 0.3 + 0.7 * (1 - L.night);
      _a.copy(GREY).multiplyScalar(lum);
      L.zenith.lerp(_a, w.overcast * 0.85);
      L.horizon.lerp(_a, w.overcast * 0.7);
      L.lightIntensity *= 1 - 0.72 * w.overcast;
      L.hemiIntensity *= 1 + 0.45 * w.overcast;
    }
    L.fogColor.copy(L.horizon);
    const fog = w.fog || b.fog;
    L.fogNear = fog.near;
    L.fogFar = fog.far;

    this.renderer.applyLighting(L);
    if (rebuildEnv) {
      this.renderer.rebuildEnvMap();
      this._lastEnvElev = elev;
    }
  }

  /** Surface → grip multiplier table for the vehicle. */
  get grip() {
    return this.weather.grip;
  }
}
