import * as THREE from 'three';
import { Renderer, QUALITY } from './Renderer.js';
import { Environment } from './Environment.js';
import { Precipitation } from './Precipitation.js';
import { WEATHER, WEATHER_ORDER, TIME_PRESETS } from '../data/weather.js';
import { CameraRig } from './CameraRig.js';
import { Input } from './Input.js';
import { loadSettings, saveSettings } from './Settings.js';
import { Telemetry } from './Telemetry.js';
import { Records } from './Records.js';
import { Profile } from './Profile.js';
import { PhysicsWorld, FIXED_DT } from '../physics/PhysicsWorld.js';
import { Vehicle } from '../physics/Vehicle.js';
import { buildSpec } from '../cars/CarSpec.js';
import { buildCarModel } from '../cars/CarModel.js';
import { carById } from '../data/cars.js';
import { mapById } from '../data/maps/index.js';
import { POINTS } from '../data/economy.js';
import { TestMap } from '../maps/TestMap.js';
import { TrackMap } from '../maps/TrackMap.js';
import { Hud } from '../ui/Hud.js';
import { Menu } from '../ui/Menu.js';
import { Showroom } from '../ui/Showroom.js';
import { RaceMode } from '../modes/RaceMode.js';
import { TimeTrialMode } from '../modes/TimeTrialMode.js';
import { DriftMode } from '../modes/DriftMode.js';
import { FreeRoamMode } from '../modes/FreeRoamMode.js';
import { COUNTDOWN, LIGHT_STEP } from '../modes/Mode.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Soundscape } from '../audio/Soundscape.js';
import { ReplayRecorder, ReplayProxy, REPLAY_HZ } from './Replay.js';
import { ReplayCamera } from './ReplayCamera.js';
import { Effects } from '../fx/Effects.js';
import { surfaceOf } from '../data/surfaces.js';
import { TouchControls, isTouchDevice } from '../ui/TouchControls.js';
import { ReplayBar } from '../ui/ReplayBar.js';
import { PhotoMode } from '../ui/PhotoMode.js';

const MAX_SUBSTEPS = 10;
const QUALITY_ORDER = ['low', 'medium', 'high'];
const DAMAGE_MODES = ['full', 'visual', 'off'];
const MODES = { race: RaceMode, timetrial: TimeTrialMode, drift: DriftMode, freeroam: FreeRoamMode };

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * Top level: owns renderer, input, audio, profile and the current session.
 * state: 'menu' (garage backdrop + menu screens) → 'loading' → 'driving' (a mode is running)
 * → 'replay' (results over the session's replay; the session is torn down when leaving it).
 */
export class Game {
  constructor(container, hudRoot, menuRoot) {
    this.settings = loadSettings();
    this.gfx = new Renderer(container, this.settings.quality);
    this.input = new Input(this.settings.bindings);
    this.cameraRig = new CameraRig(this.gfx.camera, this.settings.camera);
    this.telemetry = new Telemetry();
    this.hud = new Hud(hudRoot);
    this.records = new Records();
    this.profile = new Profile();
    this.env = new Environment(this.gfx);
    this.precip = new Precipitation(this.gfx.scene);
    this.audio = new AudioEngine(this.settings);
    this.sound = new Soundscape(this.audio);
    this.touch = new TouchControls(this.input);
    this.touch.onFirstTouch = () => this.updateTouch();
    this.replayBar = new ReplayBar(this);
    this.photo = new PhotoMode(this);
    this.replay = null;
    this.effects = null;
    this.recorder = null;
    this._lit = -1;
    this._fpsAvg = 60;
    this._dynT = 0;

    this.state = 'menu';
    this.mode = null;
    this.event = null;
    this.renderState = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.safePoint = { position: new THREE.Vector3(), yaw: 0, timer: 0 };
    this.paused = false;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.physicsMs = 0;
    this.offTrackTimer = 0;
    this.waterTimer = 0;
    this._oobHint = -1;
    this._oobNear = {};
    this.selectedCarId = this.profile.owns(this.settings.lastCarId) ? this.settings.lastCarId : this.profile.ownedCars()[0];

    // player headlights: one spot light that is always in the scene (intensity 0 by day), so
    // switching the lights never forces shader recompiles
    this.headlight = new THREE.SpotLight(0xfff1d8, 0, 160, 0.5, 0.5, 1.0);
    this.headlight.target = new THREE.Object3D();
    this.gfx.scene.add(this.headlight, this.headlight.target);
    this._hlPos = new THREE.Vector3();

    this.showroom = new Showroom(this.gfx);
    this.showroom.visible = true;
    this.menu = new Menu(menuRoot, this);
    this.hud.root.style.display = 'none';

    this._onResize = () => this.gfx.resize();
    this._onVisibility = () => {
      if (document.hidden && this.state === 'driving') this.setPaused(true);
    };
    window.addEventListener('resize', this._onResize);
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  // ------------------------------------------------------------ accessors used by HUD / menus
  get lapTimer() {
    return this.mode?.lapTimer ?? null;
  }
  get liveDelta() {
    return this.mode?.liveDelta ?? null;
  }
  get ghostPos() {
    return this.mode?.ghostPos ?? null;
  }
  get position() {
    return this.mode?.position ?? 1;
  }
  get racers() {
    return this.mode?.racers?.length ?? 1;
  }
  get carDef() {
    return carById(this.event?.carId ?? this.selectedCarId);
  }
  get carUpgrades() {
    return this.profile.upgrades(this.carDef.id);
  }
  get touchEnabled() {
    const t = this.settings.touch;
    return t === 'on' || (t === 'auto' && isTouchDevice());
  }

  /** On-screen controls only while actually driving. */
  updateTouch() {
    this.touch.setVisible(this.state === 'driving' && !this.paused && this.touchEnabled);
  }

  start() {
    this.lastTime = performance.now();
    this.menu.show('main');
    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), 0.1);
      this.lastTime = now;
      if (this.state === 'loading') return;
      this.input.poll();
      if (this.state === 'menu') {
        this.menu.update(dt);
        this.showroom.update(dt);
        this.showroom.render();
        return;
      }
      if (this.state === 'replay') {
        this._replayFrame(dt);
        return;
      }
      if (this.state === 'photo') {
        this.photo.update(dt);
        this.gfx.render(dt);
        return;
      }
      this.handleActions();
      if (this.state !== 'driving') return;
      if (!this.paused) {
        this.update(dt);
        this._dynamicRes(dt);
      } else this.menu.update(dt);
      this.hud.update(dt, this);
      this.gfx.render(dt);
    };
    this._raf = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ events

  /**
   * Start a session. cfg: { mode: 'race' | 'timetrial' | 'drift' | 'freeroam', mapId, carId,
   * laps, opponents, difficulty, rubberBand, time, weather, career }
   */
  async startEvent(cfg) {
    this.state = 'loading';
    this.menu.hide();
    this.showroom.visible = false;
    this.event = cfg;
    this.lastEvent = { ...cfg }; // for "Play again" on the results screen
    this.selectedCarId = cfg.carId;
    this.settings.lastCarId = cfg.carId;
    saveSettings(this.settings);
    const def = mapById(cfg.mapId);
    const overlay = document.getElementById('loading');
    overlay.style.display = '';
    overlay.innerHTML = `<div class="logo">APEX DRIVE</div><div class="sub">Building ${def.name}…</div>`;
    await nextFrame();

    this._teardownSession();
    const t0 = performance.now();
    this.physics = new PhysicsWorld();
    this.map = def.type === 'test' ? new TestMap(this.gfx, this.physics, this.settings.quality) : new TrackMap(this.gfx, this.physics, def, this.settings.quality);
    this.physics.surfaceFn = (x, z) => this.map.surfaceAt(x, z);
    this.mapBuildMs = performance.now() - t0;
    this.mapDef = def;
    this.effects = new Effects(this.gfx.scene, this.settings.quality);
    this._spawnPlayer(cfg.carId);
    this.applyEnvironment();
    this._startMode();

    this.hud.setMap(this.map, this.mode);
    this.hud.root.style.display = '';
    overlay.style.display = 'none';
    this.paused = false;
    this.lastTime = performance.now();
    this.state = 'driving';
    this.sound.setActive(true);
    this.updateTouch();
  }

  _startMode() {
    const Mode = MODES[this.event.mode] || FreeRoamMode;
    this.mode = new Mode(this, this.event);
    this.mode.start();
    this.cameraRig.snap = true;
    this.effects?.clear();
    this._lit = -1;
    // record everything for the replay (free roam can run for hours and swaps cars: not recorded)
    this.recorder = null;
    if (this.event.mode !== 'freeroam') {
      const r = new ReplayRecorder();
      r.add('player', this.carDef, this.vehicle, { name: 'You', model: this.carModel });
      this.mode.cars.forEach((c, k) => r.add(`car${k}`, c.def, c.vehicle, { name: c.name, model: c.model }));
      this.recorder = r;
    }
  }

  restartEvent() {
    if (!this.mode) return;
    this.mode.dispose();
    this.vehicle.repair();
    this.carModel.repair();
    this._startMode();
    this.setPaused(false);
  }

  /** Leave the session: apply the result (credits, career) and return to the menus. */
  endEvent(quit = false) {
    if (this.state !== 'driving') return;
    const result = this.mode?.finish(quit) ?? null;
    if (result) {
      if (result.credits) this.profile.earn(result.credits);
      const career = result.career;
      if (career && !result.retired) {
        const st = this.profile.completeEvent(career.champ, result.order, POINTS);
        result.standings = this.profile.standings(career.champ);
        if (!st.current && st.lastResult) {
          result.standings = st.lastResult.standings;
          result.championshipOver = st.lastResult.position;
          if (st.lastResult.position === 1) {
            this.profile.earn(career.champ.prize);
            result.championPrize = career.champ.prize;
          }
        }
      }
    }
    const replay = result ? this.recorder?.finish() : null;
    this.recorder = null;
    this.hud.root.style.display = 'none';
    this.paused = false;
    this.lastResult = result;
    if (replay) {
      // keep the session alive: the results sit over its replay until the player moves on
      this._enterReplay(replay);
      this.menu.showResults(result);
      return;
    }
    this._teardownSession();
    this.state = 'menu';
    this.updateTouch();
    this.sound.setActive(false);
    this.showroom.visible = true;
    if (result) this.menu.showResults(result);
    else this.menu.show('main');
  }

  // ------------------------------------------------------------ photo mode

  /** Freeze the session (from the pause menu or the replay viewer) and orbit a free camera. */
  openPhoto() {
    const from = this.state;
    if (from === 'driving') {
      this.menu.hide();
      this.hud.root.style.display = 'none';
      this.state = 'photo';
      this.photo.open(this.vehicle, () => {
        this.state = 'driving';
        this.hud.root.style.display = '';
        this.cameraRig.snap = true;
        this.menu.showPause();
      });
    } else if (from === 'replay' && this.replay) {
      const r = this.replay;
      const wasPlaying = r.playing;
      r.playing = false;
      this.sound.setActive(false);
      this.replayBar.show(false);
      this.state = 'photo';
      this.photo.open(r.proxies[r.focus], () => {
        this.state = 'replay';
        r.playing = wasPlaying;
        r.camera.reset();
        if (r.viewer) this.replayBar.show(true);
        else this.menu.showResults(this.lastResult);
      });
    }
  }

  // ------------------------------------------------------------ replay

  _enterReplay(data) {
    this.state = 'replay';
    this.updateTouch();
    if (this.mode?.ghostModel) this.mode.ghostModel.root.visible = false;
    const proxies = data.tracks.map((t) => {
      const p = new ReplayProxy(t);
      p.model = t.model;
      return p;
    });
    this.replay = {
      ...data,
      proxies,
      time: 0,
      speed: 1,
      playing: true,
      loop: true,
      viewer: false,
      focus: 0,
      camera: new ReplayCamera(this.gfx.camera, this.map, this.physics),
    };
    this.effects.clear();
    this.sound.setActive(true);
  }

  /** Results → full-screen replay with controls. */
  openReplayViewer() {
    const r = this.replay;
    if (!r) return;
    this.menu.hide();
    r.viewer = true;
    r.loop = false;
    if (r.time >= r.duration - 0.05) this.seekReplay(0);
    r.playing = true;
    this.replayBar.show(true);
    this.replayBar.refresh(true);
  }

  closeReplayViewer() {
    const r = this.replay;
    if (!r) return;
    r.viewer = false;
    r.loop = true;
    r.playing = true;
    this.replayBar.show(false);
    this.menu.showResults(this.lastResult);
  }

  /** Leave the results / replay for the menus. */
  closeReplay() {
    if (this.state !== 'replay') return;
    this._teardownSession();
    this.sound.setActive(false);
    this.state = 'menu';
    this.showroom.visible = true;
  }

  seekReplay(t, play = false) {
    const r = this.replay;
    r.time = Math.max(0, Math.min(r.duration, t));
    if (play) r.playing = true;
    this.effects.breakTrails();
    r.camera.reset();
  }

  cycleReplayFocus(d) {
    const r = this.replay;
    r.focus = (r.focus + d + r.proxies.length) % r.proxies.length;
    r.camera.reset();
  }

  _replayFrame(dt) {
    const r = this.replay;
    const i = this.input;
    this.menu.update(dt);
    if (r.viewer) {
      if (i.pressed('pause')) return this.closeReplayViewer();
      if (i.pressed('handbrake')) this.replayBar.act('play');
      if (i.pressed('left')) this.seekReplay(r.time - 5);
      if (i.pressed('right')) this.seekReplay(r.time + 5);
      if (i.pressed('camera')) this.replayBar.act('camera');
      if (i.pressed('prevCar')) this.cycleReplayFocus(-1);
      if (i.pressed('nextCar')) this.cycleReplayFocus(1);
    }
    const step = r.playing ? dt * r.speed : 0;
    r.time += step;
    if (r.time >= r.duration) {
      if (r.loop) this.seekReplay(0);
      else {
        r.time = r.duration;
        r.playing = false;
      }
    }
    this.env.update(dt);
    const night = this.env.night;
    const f = r.time * REPLAY_HZ;
    for (const p of r.proxies) {
      p.sample(f);
      p.model.update(p, p.rs);
      p.model.setLights(night, p.brake > 0.3 && p.speed > 0.5);
    }
    const focus = r.proxies[r.focus];
    r.camera.update(dt, focus);
    this._updateHeadlight(night);
    this.map.update(dt, night);
    this.gfx.follow(focus.pos);
    this.precip.update(dt, this.gfx.camera, night);
    const w = this.env.weather;
    this.effects.update(step, r.proxies.map((p) => ({ key: p.key, src: p })), w.wetness ?? 0, 1 - night * 0.72);
    if (this.sound.active !== r.playing) this.sound.setActive(r.playing);
    const voice = (p) => ({ key: p.key, def: p.def, src: p });
    this.sound.update(dt, this.gfx.camera, voice(focus), r.proxies.filter((p) => p !== focus).map(voice), w);
    if (r.viewer) this.replayBar.refresh();
    this.gfx.render(dt);
  }

  _teardownSession() {
    this.replay = null;
    this.replayBar.show(false);
    this.recorder = null;
    this.effects?.dispose();
    this.effects = null;
    this.gfx.setDynamicScale(1); // the garage is light: back to full resolution
    this._fpsAvg = 60;
    this._dynT = 0;
    this.mode?.dispose();
    this.mode = null;
    if (this.vehicle) {
      this.vehicle.dispose();
      this.carModel.dispose();
      this.vehicle = null;
    }
    if (this.map) this.map.dispose();
    this.map = null;
    if (this.physics) this.physics.dispose();
    this.physics = null;
    this.precip.set(null);
    this.headlight.intensity = 0;
    this.hud.setCountdown(null);
  }

  /** Build a car (vehicle + model) for any participant. */
  createCar(def, upgrades, pose, colorIndex = 0) {
    const spec = buildSpec(def, upgrades);
    const vehicle = new Vehicle(this.physics, spec, pose);
    vehicle.assists = { abs: true, tcs: true, steering: true };
    vehicle.gripScale = this.map.weather.grip;
    vehicle.surfaceGrip = this.env.weather.grip;
    vehicle.damageMode = this.settings.damageMode;
    const model = buildCarModel(def, spec, colorIndex);
    model.fakeBeam = true; // the player's car swaps this for the real spot light
    this.gfx.scene.add(model.root);
    vehicle.onImpact = (imp) => {
      if (vehicle.damageMode !== 'off') model.dent(imp.dir, imp.severity);
      this.sound.impact(imp.severity, vehicle.pos);
      if (vehicle === this.vehicle) this.cameraRig.shake(0.25 + imp.severity);
    };
    return { vehicle, model, def };
  }

  _spawnPlayer(carId) {
    const def = carById(carId);
    const car = this.createCar(def, this.profile.upgrades(carId), this.map.spawn, this.profile.color(carId));
    this.vehicle = car.vehicle;
    this.vehicle.assists = this.settings.assists;
    this.carModel = car.model;
    this.carModel.fakeBeam = false;
    this.colorIndex = this.profile.color(carId);
    this.cameraRig.snap = true;
    this.telemetry.reset();
  }

  /** Put the player on a grid slot, repaired, with fresh telemetry. */
  placePlayer(pose) {
    this.vehicle.reset(pose.position, pose.yaw);
    this.vehicle.repair();
    this.carModel.repair();
    this.safePoint.position.copy(pose.position);
    this.safePoint.yaw = pose.yaw;
    this.telemetry.reset();
    this.cameraRig.snap = true;
  }

  /** Map's time/weather, then the event's forced conditions, then the player's L / O choices. */
  applyEnvironment() {
    const s = this.settings;
    const env = this.env;
    const ev = this.event || {};
    this.gfx.envProps = this.map.envProps ?? null;
    env.setMap(this.map.environment ?? this.mapDef.environment ?? {});
    const presetId = ev.timePreset ?? s.timePreset;
    const preset = TIME_PRESETS.find((p) => p.id === presetId) || TIME_PRESETS[0];
    env.cycle = preset.id === 'cycle';
    if (typeof ev.time === 'number') env.time = ev.time;
    else if (preset.time !== undefined) env.time = preset.time;
    const weather = ev.weather ?? s.weather;
    if (weather !== 'map' && WEATHER[weather]) env.weatherId = weather;
    env.apply(true);
    const w = env.weather;
    this.precip.set(w.particles, QUALITY[this.gfx.quality]?.particles ?? 0.65);
    this.map.setWeather?.(w);
    for (const v of [this.vehicle, ...(this.mode?.cars ?? []).map((c) => c.vehicle)]) if (v) v.surfaceGrip = w.grip;
    for (const c of this.mode?.cars ?? []) c.driver?.setWeather(w.grip);
  }

  resetCar() {
    const v = this.vehicle;
    if (this.map.getResetPose) {
      const pose = this.map.getResetPose(v.pos, this.lapTimer?._hint ?? -1);
      v.reset(pose.position, pose.yaw);
    } else {
      v.reset(this.safePoint.position, this.safePoint.yaw);
    }
    this.mode?.onPlayerReset();
    this.effects?.breakTrails('player');
    this.cameraRig.snap = true;
  }

  setPaused(p) {
    if (this.state !== 'driving') return;
    this.paused = p;
    if (p) this.menu.showPause();
    else this.menu.hide();
    if (!p) this.lastTime = performance.now();
    this.sound.setActive(!p);
    this.updateTouch();
    this._dynT = 0;
  }

  _toggle(fn, msg) {
    fn();
    saveSettings(this.settings);
    this.hud.toast(msg);
  }

  handleActions() {
    const i = this.input;
    const s = this.settings;
    if (i.pressed('pause')) {
      if (this.paused) this.menu.back();
      else this.setPaused(true);
    }
    if (this.paused || !this.vehicle) return;
    const v = this.vehicle;
    if (i.pressed('restart') && this.event?.mode !== 'freeroam') this.restartEvent();
    if (i.pressed('reset') && !v.locked && !this.mode?.playerAutopilot) this.resetCar();
    if (i.pressed('camera')) this._toggle(() => (s.camera = this.cameraRig.next()), this.cameraRig.label);
    if (i.pressed('transmission')) {
      this._toggle(() => (s.transmission = s.transmission === 'auto' ? 'manual' : 'auto'), `Gearbox: ${s.transmission === 'auto' ? 'manual' : 'automatic'}`);
    }
    if (s.transmission === 'manual') {
      if (i.pressed('shiftUp')) v.drivetrain.shiftUp();
      if (i.pressed('shiftDown')) v.drivetrain.shiftDown();
    }
    const flip = (key, label) => this._toggle(() => (s.assists[key] = !s.assists[key]), `${label} ${s.assists[key] ? 'off' : 'on'}`);
    if (i.pressed('toggleAbs')) flip('abs', 'ABS');
    if (i.pressed('toggleTcs')) flip('tcs', 'Traction control');
    if (i.pressed('toggleSteerAssist')) flip('steering', 'Steering assist');
    if (i.pressed('damageMode')) {
      const m = DAMAGE_MODES[(DAMAGE_MODES.indexOf(s.damageMode) + 1) % DAMAGE_MODES.length];
      this._toggle(() => {
        s.damageMode = m;
        v.damageMode = m;
      }, `Damage: ${m}`);
    }
    if (i.pressed('ghost')) this._toggle(() => (s.ghost = !s.ghost), s.ghost ? 'Ghost off' : 'Ghost on');
    if (i.pressed('timeOfDay')) {
      const k = (TIME_PRESETS.findIndex((p) => p.id === s.timePreset) + 1) % TIME_PRESETS.length;
      this._toggle(() => {
        s.timePreset = TIME_PRESETS[k].id;
        if (this.event) {
          delete this.event.time;
          delete this.event.timePreset;
        }
        this.applyEnvironment();
      }, `Time: ${TIME_PRESETS[k].label}`);
    }
    if (i.pressed('weather')) {
      const order = ['map', ...WEATHER_ORDER];
      const next = order[(order.indexOf(s.weather) + 1) % order.length];
      this._toggle(() => {
        s.weather = next;
        if (this.event) delete this.event.weather;
        this.applyEnvironment();
      }, `Weather: ${next === 'map' ? `map default (${this.env.weather.label})` : WEATHER[next].label}`);
    }
    if (i.pressed('help')) this._toggle(() => (s.showHelp = !s.showHelp), s.showHelp ? 'Help hidden (H)' : 'Help shown');
    if (i.pressed('debug')) this._toggle(() => (s.debug = !s.debug), s.debug ? 'Telemetry off' : 'Telemetry on');
    if (i.pressed('paint')) {
      this.colorIndex++;
      this.carModel.setColor(this.colorIndex);
    }
    if (i.pressed('quality')) {
      const q = QUALITY_ORDER[(QUALITY_ORDER.indexOf(s.quality) + 1) % QUALITY_ORDER.length];
      this._toggle(() => this.setQuality(q), `Graphics: ${q}${this.map.track ? ' (scenery density applies on map reload)' : ''}`);
    }
    // free roam: swap between your own cars on the fly
    const step = i.pressed('nextCar') ? 1 : i.pressed('prevCar') ? -1 : 0;
    if (step && this.event?.mode === 'freeroam') {
      const owned = this.profile.ownedCars();
      const k = (owned.indexOf(this.event.carId) + step + owned.length) % owned.length;
      const pose = { position: v.pos.clone().setY(v.pos.y - v.spec.anchorHeight), yaw: v.yaw };
      v.dispose();
      this.carModel.dispose();
      this.event.carId = owned[k];
      this._spawnPlayer(owned[k]);
      this.vehicle.reset(pose.position, pose.yaw);
      this.vehicle.surfaceGrip = this.env.weather.grip;
      const d = carById(owned[k]);
      this.hud.toast(`${d.brand} ${d.name}`);
    }
  }

  setQuality(q) {
    this.settings.quality = q;
    this.gfx.setQuality(q);
    if (this.env.base) this.precip.set(this.env.weather.particles, QUALITY[q].particles);
    saveSettings(this.settings);
  }

  // ------------------------------------------------------------ frame update

  update(dt) {
    const v = this.vehicle;
    const mode = this.mode;
    if (!mode.playerAutopilot) Object.assign(v.controls, this.input.controls);
    v.drivetrain.auto = this.settings.transmission === 'auto' || !!mode.playerAutopilot;
    const cars = mode.cars;

    // fixed-timestep physics for every car; render state is interpolated between steps
    const t0 = performance.now();
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      mode.preStep(FIXED_DT);
      v.preStep(FIXED_DT);
      for (const c of cars) c.vehicle.preStep(FIXED_DT);
      this.physics.step();
      v.postStep(FIXED_DT);
      for (const c of cars) c.vehicle.postStep(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = 0; // too slow to catch up: drop time instead of spiralling
    this.physicsMs = performance.now() - t0;
    this.recorder?.update(steps * FIXED_DT);

    if (v.needsRecovery) this.resetCar();
    if (!this.map.track) this._trackSafePoint(dt);
    else if (!mode.playerAutopilot) this._checkBounds(dt);
    mode.update(dt);
    if (mode.done) {
      this.endEvent();
      return;
    }

    this.env.update(dt);
    const night = this.env.night;
    const alpha = this.accumulator / FIXED_DT;
    const rs = v.getRenderState(alpha, this.renderState);
    this.carModel.update(v, rs);
    this.carModel.setLights(night, v.brake > 0.3 && !v.locked && Math.abs(v.vLong) > 0.5);
    for (const c of cars) {
      c.vehicle.getRenderState(alpha, c.rs);
      c.model.update(c.vehicle, c.rs);
      c.model.setLights(night, c.vehicle.brake > 0.3 && !c.vehicle.locked && Math.abs(c.vehicle.vLong) > 0.5);
    }
    this._updateHeadlight(night);
    this.map.update(dt, night);
    // rough ground shakes the camera a little
    let rough = 0;
    for (const w of v.wheels) if (w.contact) rough += surfaceOf(w.surface).bumpiness;
    this.cameraRig.rumble = Math.min(1, rough * 25 * Math.min(1, v.speed / 20));
    this.cameraRig.update(dt, rs, v);
    this.gfx.follow(rs.position);
    this.precip.update(dt, this.gfx.camera, night);
    this.telemetry.update(dt, v);

    const w = this.env.weather;
    this.effects.update(dt, [{ key: 'player', src: v }, ...cars.map((c, k) => ({ key: `car${k}`, src: c.vehicle }))], w.wetness ?? 0, 1 - night * 0.72);
    this.sound.update(
      dt,
      this.gfx.camera,
      { key: `player:${this.event.carId}`, def: this.carDef, src: v },
      cars.map((c, k) => ({ key: `car${k}`, def: c.def, src: c.vehicle })),
      w,
    );
    this._countdownBeeps();
  }

  // start lights: a tick per light, a higher tone on "go"
  _countdownBeeps() {
    const m = this.mode;
    if (m.countdown > 0) {
      const lit = Math.min(5, Math.floor((COUNTDOWN - m.countdown) / LIGHT_STEP));
      if (this._lit < 0) this._lit = 0;
      if (lit > this._lit) this.audio.beep(520, 0.2, { gain: 0.22 });
      this._lit = lit;
    } else if (this._lit >= 0) {
      this.audio.beep(1040, 0.6, { gain: 0.25 });
      this._lit = -1;
    }
  }

  // Dynamic resolution: drop the render scale when the frame rate sags, creep back up when it's
  // comfortably high again (slowly, so it doesn't oscillate).
  _dynamicRes(dt) {
    if (!this.settings.dynamicRes) {
      this.gfx.setDynamicScale(1);
      return;
    }
    const fps = 1 / Math.max(dt, 1e-3);
    this._fpsAvg += (fps - this._fpsAvg) * Math.min(1, dt * 2);
    this._dynT += dt;
    if (this._dynT < 2) return;
    const k = this.gfx.dynScale;
    if (this._fpsAvg < 50 && k > 0.55) {
      this.gfx.setDynamicScale(Math.max(0.55, k - 0.1));
      this._dynT = 0;
    } else if (this._fpsAvg > 58 && k < 1 && this._dynT > 6) {
      this.gfx.setDynamicScale(Math.min(1, k + 0.05));
      this._dynT = 0;
    }
  }

  // headlights come on at dusk and in heavy weather
  _updateHeadlight(night) {
    const w = this.env.weather;
    const on = Math.max(night, w.overcast > 0.6 ? 0.35 : 0);
    const root = this.carModel.root;
    this.headlight.intensity = on * 2600;
    if (on <= 0) return;
    this._hlPos.copy(this.carModel.headlightPos);
    root.localToWorld(this.headlight.position.copy(this._hlPos));
    root.localToWorld(this.headlight.target.position.set(0, this._hlPos.y - 1.6, this._hlPos.z - 40));
  }

  // off-road maps: wandering too far from the road, or into the sea, resets the car
  _checkBounds(dt) {
    const v = this.vehicle;
    const m = this.map;
    if (m.seaLevel !== null && m.seaLevel !== undefined && v.pos.y < m.seaLevel + 0.2) {
      if ((this.waterTimer += dt) > 1) {
        this.waterTimer = 0;
        this.resetCar();
        this.hud.toast('Splash! Back to the road');
      }
    } else this.waterTimer = 0;
    if (!m.maxOffTrack) return;
    const q = m.track.nearest(v.pos.x, v.pos.z, this._oobHint, this._oobNear, 8);
    this._oobHint = q.index;
    if (q.dist > m.maxOffTrack) {
      if ((this.offTrackTimer += dt) > 1.5) {
        this.offTrackTimer = 0;
        this.resetCar();
        this.hud.toast('Out of bounds');
      }
    } else this.offTrackTimer = 0;
  }

  // Test map: remember the last spot where the car was upright with all wheels down.
  _trackSafePoint(dt) {
    const v = this.vehicle;
    const sp = this.safePoint;
    sp.timer += dt;
    if (sp.timer < 0.5) return;
    sp.timer = 0;
    if (v.grounded === 4 && v.up.y > 0.95 && v.speed < 60) {
      sp.position.set(v.pos.x, v.pos.y - v.spec.anchorHeight, v.pos.z);
      sp.yaw = v.yaw;
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    this.input.dispose();
  }
}

