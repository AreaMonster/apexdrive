import { CARS, CLASSES, carById } from '../data/cars.js';
import { MAPS, mapById } from '../data/maps/index.js';
import { CHAMPIONSHIPS } from '../data/career.js';
import { DIFFICULTY, DRIVER_NAMES } from '../data/ai.js';
import { UPGRADE_LABELS } from '../data/economy.js';
import { TIME_PRESETS, WEATHER, WEATHER_ORDER } from '../data/weather.js';
import { buildSpec, MAX_UPGRADE_LEVEL } from '../cars/CarSpec.js';
import { DEFAULT_BINDINGS } from '../core/Input.js';
import { saveSettings } from '../core/Settings.js';
import { formatTime } from '../core/LapTimer.js';

const MODE_INFO = {
  race: { title: 'Quick Race', blurb: 'Race a field of AI drivers in cars of your class.' },
  timetrial: { title: 'Time Trial', blurb: 'Set a lap time against the ghost of your best.' },
  drift: { title: 'Drift Challenge', blurb: 'Link slides for points. Bigger angles, faster, longer chains.' },
  freeroam: { title: 'Free Roam', blurb: 'No clock, no rules. Isla Verano is made for it.' },
};

const ACTION_LABELS = {
  throttle: 'Throttle',
  brake: 'Brake / reverse',
  left: 'Steer left',
  right: 'Steer right',
  handbrake: 'Handbrake',
  shiftUp: 'Shift up',
  shiftDown: 'Shift down',
  reset: 'Reset to track',
  restart: 'Restart',
  camera: 'Camera',
  pause: 'Pause',
  transmission: 'Auto / manual',
  timeOfDay: 'Time of day',
  weather: 'Weather',
  ghost: 'Ghost',
  help: 'Help overlay',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (n) => `${Math.round(n).toLocaleString()} cr`;

function keyLabel(code) {
  if (!code) return '—';
  const map = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', Backspace: 'Backspace', Escape: 'Esc', Backquote: '`', BracketLeft: '[', BracketRight: ']' };
  return map[code] || code.replace(/^Key/, '').replace(/^Digit/, '');
}

/**
 * Menu screens over the garage backdrop: main, garage, event setup, career, settings, pause and
 * results. Mouse, keyboard (arrows / Enter / Esc) and gamepad (D-pad / A / B) all work.
 */
export class Menu {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.stack = [];
    this.padPrev = {};
    this.padRepeat = 0;
    this.rebinding = null;
    this.setup = { mode: 'race', mapId: 'harrow_park', laps: 3, opponents: 5, difficulty: 'medium', rubberBand: false, time: 'map', weather: 'map' };
    this.garageCar = game.selectedCarId;

    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      game.audio.click();
      // option rows: clicking the ◀ arrow steps backwards
      this._act(el.dataset.act, el.dataset.arg, el, e.target.dataset.dir ? Number(e.target.dataset.dir) : 1);
    });
    window.addEventListener('keydown', (e) => this._onKey(e), true);
  }

  // ------------------------------------------------------------ navigation

  show(name, params = {}) {
    this.stack = [{ name, params }];
    this._render();
  }

  push(name, params = {}) {
    this.stack.push({ name, params });
    this._render();
  }

  back() {
    const top = this.stack[this.stack.length - 1];
    if (top?.name === 'pause') {
      this.game.setPaused(false);
      return;
    }
    if (top?.name === 'results') return;
    if (this.stack.length > 1) {
      this.stack.pop();
      this._render();
    }
  }

  hide() {
    this.stack = [];
    this.root.innerHTML = '';
    this.root.classList.remove('show');
  }

  showPause() {
    this.stack = [{ name: 'pause', params: {} }];
    this._render();
  }

  showResults(result) {
    this.stack = [{ name: 'results', params: { result } }];
    this._render();
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  _render() {
    const top = this.top;
    if (!top) return this.hide();
    const html = this[`_${top.name}`](top.params);
    this.root.innerHTML = `<div class="menu menu-${top.name}">${html}</div>`;
    this.root.classList.add('show');
    this.root.classList.toggle('overlay', top.name === 'pause');
    this.root.classList.toggle('replay-bg', top.name === 'results' && !!this.game.replay);
    const first = this.root.querySelector('[autofocus]') || this.root.querySelector('button:not([disabled])');
    first?.focus({ preventScroll: true });
    this._syncShowroom();
  }

  _syncShowroom() {
    const g = this.game;
    const top = this.top?.name;
    const id = top === 'garage' ? this.garageCar : g.selectedCarId;
    const def = carById(id);
    g.showroom.setCar(def, g.profile.owns(id) ? g.profile.color(id) : 0, g.profile.upgrades(id));
    g.showroom.shift = top === 'main' && window.innerWidth > 760 ? 0.16 : 0;
  }

  update() {
    this._pollPad();
  }

  _onKey(e) {
    if (!this.root.classList.contains('show')) return;
    if (this.rebinding) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        const s = this.game.settings;
        s.bindings = { ...s.bindings, [this.rebinding]: [e.code] };
        this.game.input.setBindings(s.bindings);
        saveSettings(s);
      }
      this.rebinding = null;
      this._render();
      return;
    }
    const focused = document.activeElement;
    const act = focused?.dataset?.act;
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && (act === 'opt' || act === 'setting')) {
      e.preventDefault();
      e.stopPropagation();
      this._act(act, focused.dataset.arg, focused, e.code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      this._moveFocus(e.code === 'ArrowUp' || e.code === 'ArrowLeft' ? -1 : 1);
    } else if (e.code === 'Escape' || e.code === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      this.back();
    }
  }

  _moveFocus(dir) {
    const items = [...this.root.querySelectorAll('button:not([disabled])')];
    if (!items.length) return;
    const k = items.indexOf(document.activeElement);
    const next = items[(k + dir + items.length) % items.length];
    this.game.audio.click();
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads || []).find((p) => p && p.connected);
    if (!gp) return;
    const pressed = (i) => !!gp.buttons[i]?.pressed;
    const edge = (i) => {
      const now = pressed(i);
      const was = this.padPrev[i];
      this.padPrev[i] = now;
      return now && !was;
    };
    const stickY = gp.axes[1] || 0;
    const up = edge(12) || (stickY < -0.6 && !this.padPrev.sy);
    const down = edge(13) || (stickY > 0.6 && !this.padPrev.sy);
    this.padPrev.sy = Math.abs(stickY) > 0.6;
    const focused = document.activeElement;
    const left = edge(14);
    const right = edge(15);
    if (up) this._moveFocus(-1);
    if (down) this._moveFocus(1);
    const fa = focused?.dataset?.act;
    if ((left || right) && (fa === 'opt' || fa === 'setting')) this._act(fa, focused.dataset.arg, focused, left ? -1 : 1);
    else if (left || right) this._moveFocus(left ? -1 : 1);
    if (edge(0)) focused?.click();
    if (edge(1)) this.back();
  }

  // ------------------------------------------------------------ actions

  _act(act, arg, el, dir = 1) {
    const g = this.game;
    const p = g.profile;
    switch (act) {
      case 'go':
        if (arg === 'career') this.push('career');
        else if (arg === 'garage') {
          this.garageCar = g.selectedCarId;
          this.push('garage', { pick: false });
        }
        else if (arg === 'settings') this.push('settings');
        else {
          this.setup.mode = arg;
          if (arg === 'freeroam') this.setup.mapId = 'island';
          else if (mapById(this.setup.mapId).type === 'test' || mapById(this.setup.mapId).freeRoam) this.setup.mapId = 'harrow_park';
          this.push('setup');
        }
        break;
      case 'back':
        this.back();
        break;
      case 'car':
        this.garageCar = arg;
        this._render();
        break;
      case 'buy':
        if (p.buy(arg)) {
          g.selectedCarId = arg;
          this._toast(`Bought the ${carById(arg).brand} ${carById(arg).name}`);
        }
        this._render();
        break;
      case 'select':
        g.selectedCarId = arg;
        g.settings.lastCarId = arg;
        saveSettings(g.settings);
        if (this.top.params.pick) this.back();
        else this._render();
        break;
      case 'upgrade':
        p.upgrade(this.garageCar, arg);
        this._render();
        break;
      case 'paint':
        p.setColor(this.garageCar, Number(arg));
        this._render();
        break;
      case 'map':
        this.setup.mapId = arg;
        this._render();
        break;
      case 'opt':
        this._cycleOption(arg, dir);
        break;
      case 'changeCar':
        if (arg) {
          // open the picker on one of your cars of the required class (or the first on sale)
          const own = CARS.find((c) => c.class === arg && p.owns(c.id)) || CARS.find((c) => c.class === arg);
          this.garageCar = own.id;
        } else this.garageCar = g.selectedCarId;
        this.push('garage', { pick: true, cls: arg || null });
        break;
      case 'start':
        this._startSetup();
        break;
      case 'champ':
        this.push('championship', { id: arg });
        break;
      case 'champStart':
        this._startChampionshipEvent(arg);
        break;
      case 'setting':
        this._toggleSetting(arg, dir);
        break;
      case 'rebind':
        this.rebinding = arg;
        el.textContent = 'Press a key… (Esc cancels)';
        break;
      case 'resetKeys':
        g.settings.bindings = {};
        g.input.setBindings({});
        saveSettings(g.settings);
        this._render();
        break;
      case 'resetProgress':
        if (el.dataset.confirm) {
          p.reset();
          g.selectedCarId = p.ownedCars()[0];
          this._toast('Progress reset');
          this._render();
        } else {
          el.dataset.confirm = '1';
          el.textContent = 'Click again to erase all progress';
        }
        break;
      case 'resume':
        g.setPaused(false);
        break;
      case 'restart':
        this.hide();
        g.restartEvent();
        break;
      case 'quit':
        g.endEvent(true);
        break;
      case 'photo':
        g.openPhoto();
        break;
      case 'pauseSettings':
        this.push('settings');
        break;
      case 'resultsNext': {
        const r = this.top.params.result;
        g.closeReplay();
        this.show('main');
        if (r.career) {
          this.push('career');
          this.push('championship', { id: r.career.champ.id });
        }
        break;
      }
      case 'resultsRestart':
        g.startEvent(g.lastEvent);
        break;
      case 'watchReplay':
        g.openReplayViewer();
        break;
      default:
        break;
    }
  }

  _toast(msg) {
    this.toast = msg;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => {
      this.toast = null;
      this.root.querySelector('.menu-toast')?.remove();
    }, 2200);
  }

  _toastHtml() {
    return this.toast ? `<div class="menu-toast">${esc(this.toast)}</div>` : '';
  }

  // ------------------------------------------------------------ screens

  _header(title, sub = '') {
    return `<header class="menu-head">
      <button class="menu-back" data-act="back" aria-label="Back">←</button>
      <div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
      <div class="menu-credits">${money(this.game.profile.credits)}</div>
    </header>`;
  }

  _main() {
    const g = this.game;
    const car = carById(g.selectedCarId);
    const s = g.profile.data.stats;
    return `<div class="menu-side">
      <div class="menu-logo"><span>Apex</span><span>Drive</span></div>
      <div class="menu-credits big">${money(g.profile.credits)}</div>
      <nav class="menu-list">
        <button data-act="go" data-arg="career" autofocus>Career</button>
        <button data-act="go" data-arg="race">Quick Race</button>
        <button data-act="go" data-arg="timetrial">Time Trial</button>
        <button data-act="go" data-arg="drift">Drift Challenge</button>
        <button data-act="go" data-arg="freeroam">Free Roam</button>
        <button data-act="go" data-arg="garage">Garage</button>
        <button data-act="go" data-arg="settings">Settings</button>
      </nav>
      <div class="menu-car-line">${esc(car.brand)} <b>${esc(car.name)}</b><span>${s.races} races · ${s.wins} wins</span></div>
    </div>${this._toastHtml()}`;
  }

  _statBars(spec, def) {
    const perf = spec.performance;
    const bar = (label, value, frac) =>
      `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.round(Math.max(0.03, Math.min(1, frac)) * 100)}%"></i></div><b>${value}</b></div>`;
    return `<div class="stats">
      ${bar('Top speed', `${Math.round(perf.topSpeed)} km/h`, (perf.topSpeed - 140) / 220)}
      ${bar('0-100 km/h', `${perf.zeroTo100.toFixed(1)} s`, (13 - perf.zeroTo100) / 10.5)}
      ${bar('Power', `${Math.round(perf.peakPowerKw)} kW`, perf.peakPowerKw / 480)}
      ${bar('Mass', `${Math.round(spec.mass)} kg`, 1 - (spec.mass - 800) / 1600)}
      ${bar('Handling', `${def.stats.handling}/10`, def.stats.handling / 10)}
      ${bar('Braking', `${def.stats.braking}/10`, def.stats.braking / 10)}
    </div>`;
  }

  _garage(params) {
    const g = this.game;
    const p = g.profile;
    const def = carById(this.garageCar);
    const owned = p.owns(def.id);
    const ups = p.upgrades(def.id);
    const spec = buildSpec(def, ups);
    const list = CLASSES.filter((c) => !params.cls || c.id === params.cls)
      .map(
        (cls) => `<h3>${esc(cls.label)}</h3>${CARS.filter((c) => c.class === cls.id)
          .map(
            (c) => `<button class="car-item ${c.id === def.id ? 'sel' : ''} ${c.id === g.selectedCarId ? 'cur' : ''}" data-act="car" data-arg="${c.id}">
              <span>${esc(c.brand)} <b>${esc(c.name)}</b></span>
              <em>${p.owns(c.id) ? (c.id === g.selectedCarId ? 'driving' : 'owned') : money(c.price)}</em></button>`,
          )
          .join('')}`,
      )
      .join('');
    const upgrades = Object.keys(UPGRADE_LABELS)
      .map((part) => {
        const lvl = ups[part];
        const cost = p.nextUpgradeCost(def.id, part);
        const pips = Array.from({ length: MAX_UPGRADE_LEVEL }, (_, k) => `<i class="${k < lvl ? 'on' : ''}"></i>`).join('');
        return `<div class="upg"><span>${UPGRADE_LABELS[part]}</span><div class="pips">${pips}</div>
          ${cost === null ? '<b>MAX</b>' : `<button data-act="upgrade" data-arg="${part}" ${!owned || p.credits < cost ? 'disabled' : ''}>${money(cost)}</button>`}</div>`;
      })
      .join('');
    const swatches = def.colors
      .map((c, k) => `<button class="swatch ${p.color(def.id) === k ? 'on' : ''}" style="background:${c}" data-act="paint" data-arg="${k}" ${owned ? '' : 'disabled'} aria-label="Colour ${k + 1}"></button>`)
      .join('');
    const action = owned
      ? `<button class="primary" data-act="select" data-arg="${def.id}">${def.id === g.selectedCarId ? (params.pick ? 'Use this car' : 'Selected') : params.pick ? 'Use this car' : 'Drive this car'}</button>`
      : `<button class="primary" data-act="buy" data-arg="${def.id}" ${p.credits < def.price ? 'disabled' : ''}>Buy for ${money(def.price)}</button>`;
    return `${this._header(params.pick ? 'Choose a car' : 'Garage', params.cls ? `Class: ${esc(CLASSES.find((c) => c.id === params.cls).label)}` : 'Drag the car to turn it')}
      <div class="menu-cols">
        <div class="menu-panel car-list">${list}</div>
        <div class="menu-gap"></div>
        <div class="menu-panel car-detail">
          <div class="car-brand">${esc(def.brand)}</div><h2>${esc(def.name)}</h2>
          <p class="car-desc">${esc(def.description || '')}</p>
          <div class="car-tags"><span>${def.stats.drivetrain}</span><span>${esc(CLASSES.find((c) => c.id === def.class).label)}</span><span>${def.sound?.layout ?? ''}</span></div>
          ${this._statBars(spec, def)}
          <div class="swatches">${swatches}</div>
          ${owned ? `<h3>Upgrades</h3>${upgrades}` : ''}
          <div class="menu-actions">${action}</div>
        </div>
      </div>${this._toastHtml()}`;
  }

  _opt(key, label, value) {
    return `<button class="opt" data-act="opt" data-arg="${key}"><span>${label}</span><b>◀ ${esc(value)} ▶</b></button>`;
  }

  _cycleOption(key, dir) {
    const s = this.setup;
    const cycle = (list, cur) => list[(list.indexOf(cur) + dir + list.length) % list.length];
    if (key === 'laps') s.laps = Math.min(10, Math.max(1, s.laps + dir));
    if (key === 'opponents') s.opponents = Math.min(7, Math.max(1, s.opponents + dir));
    if (key === 'difficulty') s.difficulty = cycle(['easy', 'medium', 'hard'], s.difficulty);
    if (key === 'rubberBand') s.rubberBand = !s.rubberBand;
    if (key === 'time') s.time = cycle(TIME_PRESETS.map((t) => t.id), s.time);
    if (key === 'weather') s.weather = cycle(['map', ...WEATHER_ORDER], s.weather);
    this._render();
    this.root.querySelector(`[data-act="opt"][data-arg="${key}"]`)?.focus();
  }

  _setup() {
    const g = this.game;
    const s = this.setup;
    const info = MODE_INFO[s.mode];
    const maps = MAPS.filter((m) => (s.mode === 'freeroam' ? true : m.track));
    const map = mapById(s.mapId);
    const car = carById(g.selectedCarId);
    const mapList = maps
      .map((m) => {
        const kind = m.type === 'test' ? 'Test field' : m.track?.closed === false ? 'Stage' : m.freeRoam ? 'Open world' : 'Circuit';
        const best = g.records.best(m.id, s.mode === 'drift' ? `drift:${car.id}` : car.id);
        const bestTxt = best ? (s.mode === 'drift' ? `${best.time.toLocaleString()} pts` : formatTime(best.time)) : '';
        return `<button class="map-item ${m.id === s.mapId ? 'sel' : ''}" data-act="map" data-arg="${m.id}"><span><b>${esc(m.name)}</b><em>${kind}</em></span>${bestTxt && s.mode !== 'race' && s.mode !== 'freeroam' ? `<i>${bestTxt}</i>` : ''}</button>`;
      })
      .join('');
    const stage = map.track && map.track.closed === false;
    const grid = map.grid?.slots ?? 8;
    const opts = [];
    if (s.mode === 'race') {
      if (!stage) opts.push(this._opt('laps', 'Laps', s.laps));
      opts.push(this._opt('opponents', 'Opponents', Math.min(s.opponents, grid - 1)));
      opts.push(this._opt('difficulty', 'AI difficulty', DIFFICULTY[s.difficulty].label));
      opts.push(this._opt('rubberBand', 'Catch-up (rubber band)', s.rubberBand ? 'On' : 'Off'));
    }
    opts.push(this._opt('time', 'Time of day', TIME_PRESETS.find((t) => t.id === s.time).label));
    opts.push(this._opt('weather', 'Weather', s.weather === 'map' ? 'Map default' : WEATHER[s.weather].label));
    return `${this._header(info.title, info.blurb)}
      <div class="menu-cols">
        <div class="menu-panel map-list">${mapList}</div>
        <div class="menu-gap"></div>
        <div class="menu-panel setup-detail">
          <h2>${esc(map.name)}</h2><p class="car-desc">${esc(map.description || '')}</p>
          ${opts.join('')}
          <button class="opt" data-act="changeCar"><span>Car</span><b>${esc(car.brand)} ${esc(car.name)} ›</b></button>
          <div class="menu-actions"><button class="primary" data-act="start">Start</button></div>
        </div>
      </div>`;
  }

  _startSetup() {
    const s = this.setup;
    const g = this.game;
    const map = mapById(s.mapId);
    const cfg = {
      mode: s.mode,
      mapId: s.mapId,
      carId: g.selectedCarId,
      laps: s.laps,
      opponents: Math.min(s.opponents, (map.grid?.slots ?? 8) - 1),
      difficulty: s.difficulty,
      rubberBand: s.rubberBand,
      timePreset: s.time,
      weather: s.weather === 'map' ? undefined : s.weather,
    };
    g.startEvent(cfg);
  }

  _career() {
    const p = this.game.profile;
    const rows = CHAMPIONSHIPS.map((c) => {
      const st = p.champState(c.id);
      const unlocked = p.isUnlocked(c);
      const status = !unlocked ? 'Locked' : st?.current ? `Event ${st.current.event + 1}/${c.events.length}` : st?.best ? `Best: P${st.best}` : 'New';
      return `<button class="champ-item ${unlocked ? '' : 'locked'}" data-act="champ" data-arg="${c.id}" ${unlocked ? '' : 'disabled'}>
        <span><b>${esc(c.name)}</b><em>${esc(CLASSES.find((k) => k.id === c.class).label)} · ${DIFFICULTY[c.difficulty].label} · ${c.events.length} events</em></span>
        <i>${status}</i><small>${unlocked ? `Champion prize ${money(c.prize)}` : `Finish ${c.requires.map((r) => esc(CHAMPIONSHIPS.find((x) => x.id === r).name)).join(' & ')} in the top 3`}</small></button>`;
    }).join('');
    return `${this._header('Career', 'Championships unlock as you finish on the podium')}
      <div class="menu-cols"><div class="menu-panel champ-list">${rows}</div></div>`;
  }

  _championship(params) {
    const g = this.game;
    const p = g.profile;
    const c = CHAMPIONSHIPS.find((x) => x.id === params.id);
    const st = p.champState(c.id);
    const cur = st?.current;
    const events = c.events
      .map((e, k) => {
        const m = mapById(e.map);
        const cond = [e.laps && m.track?.closed !== false ? `${e.laps} laps` : m.track?.closed === false ? 'stage' : '', e.weather ? WEATHER[e.weather].label : '', typeof e.time === 'number' ? `${String(Math.floor(e.time)).padStart(2, '0')}:${String(Math.round((e.time % 1) * 60)).padStart(2, '0')}` : '']
          .filter(Boolean)
          .join(' · ');
        const state = cur ? (k < cur.event ? 'done' : k === cur.event ? 'next' : '') : '';
        return `<li class="${state}"><b>${k + 1}. ${esc(m.name)}</b><span>${esc(cond)}</span></li>`;
      })
      .join('');
    const standings = cur
      ? `<h3>Standings</h3><ol class="standings">${p
          .standings(c)
          .map((r) => `<li class="${r.id === 'player' ? 'me' : ''}"><span>${esc(r.name)}</span><b>${r.points}</b></li>`)
          .join('')}</ol>`
      : st?.lastResult
        ? `<p class="car-desc">Last result: P${st.lastResult.position}</p>`
        : '';
    const owned = p.ownedCars().filter((id) => carById(id).class === c.class);
    const car = carById(g.selectedCarId);
    const carOk = car.class === c.class && p.owns(car.id);
    let action;
    if (!owned.length) {
      action = `<p class="warn">You need a ${esc(CLASSES.find((k) => k.id === c.class).label)} car.</p><button class="primary" data-act="changeCar" data-arg="${c.class}">Go to the dealership</button>`;
    } else {
      action = `<button class="opt" data-act="changeCar" data-arg="${c.class}"><span>Car</span><b>${carOk ? `${esc(car.brand)} ${esc(car.name)}` : 'Choose…'} ›</b></button>
        <button class="primary" data-act="champStart" data-arg="${c.id}" ${carOk ? '' : 'disabled'}>${cur ? `Race event ${cur.event + 1}` : 'Start championship'}</button>`;
    }
    return `${this._header(c.name, `${esc(CLASSES.find((k) => k.id === c.class).label)} · ${DIFFICULTY[c.difficulty].label} AI · champion prize ${money(c.prize)}`)}
      <div class="menu-cols">
        <div class="menu-panel"><h3>Events</h3><ol class="events">${events}</ol>${standings}</div>
        <div class="menu-gap"></div>
        <div class="menu-panel setup-detail">${action}</div>
      </div>`;
  }

  _startChampionshipEvent(id) {
    const g = this.game;
    const p = g.profile;
    const c = CHAMPIONSHIPS.find((x) => x.id === id);
    let st = p.champState(c.id);
    if (!st?.current) {
      // new championship: draw a roster of AI drivers in cars of the class, kept for every event
      // easy championships field the cheaper cars of the class; harder ones the whole class
      const byPrice = CARS.filter((k) => k.class === c.class).sort((a, b) => a.price - b.price);
      const pool = c.difficulty === 'easy' ? byPrice.slice(0, 2) : byPrice;
      const names = [...DRIVER_NAMES].sort(() => Math.random() - 0.5);
      const roster = [{ id: 'player', name: 'You' }];
      for (let k = 0; k < c.opponents; k++) {
        const car = pool[k % pool.length];
        roster.push({ id: `ai${k}`, name: names[k], carId: car.id, color: Math.floor(Math.random() * car.colors.length) });
      }
      p.startChampionship(c, roster);
      st = p.champState(c.id);
    }
    const ev = c.events[st.current.event];
    const map = mapById(ev.map);
    const cfg = {
      mode: 'race',
      mapId: ev.map,
      carId: g.selectedCarId,
      laps: ev.laps ?? 3,
      opponents: Math.min(c.opponents, (map.grid?.slots ?? 8) - 1),
      difficulty: c.difficulty,
      rubberBand: false,
      time: ev.time,
      weather: ev.weather,
      timePreset: 'map',
      career: { champ: c, event: st.current.event, roster: st.current.roster },
    };
    g.startEvent(cfg);
  }

  _settings() {
    const s = this.game.settings;
    const row = (key, label, value) =>
      `<button class="opt" data-act="setting" data-arg="${key}"><span>${label}</span><b><i data-dir="-1">◀</i> ${esc(value)} <i data-dir="1">▶</i></b></button>`;
    const pct = (v) => `${Math.round(v * 100)}%`;
    const onOff = (v) => (v ? 'On' : 'Off');
    const bind = this.game.input.bindings;
    const keys = Object.entries(ACTION_LABELS)
      .map(([a, label]) => `<button class="opt key" data-act="rebind" data-arg="${a}"><span>${label}</span><b>${(bind[a] || DEFAULT_BINDINGS[a] || []).map(keyLabel).join(' / ')}</b></button>`)
      .join('');
    return `${this._header('Settings')}
      <div class="menu-cols">
        <div class="menu-panel">
          <h3>Graphics</h3>
          ${row('quality', 'Quality', s.quality[0].toUpperCase() + s.quality.slice(1))}
          ${row('dynamicRes', 'Dynamic resolution', onOff(s.dynamicRes))}
          <h3>Sound</h3>
          ${row('vol:master', 'Master volume', pct(s.audio.master))}
          ${row('vol:engine', 'Engines', pct(s.audio.engine))}
          ${row('vol:effects', 'Tyres and effects', pct(s.audio.effects))}
          ${row('vol:ambient', 'Wind and weather', pct(s.audio.ambient))}
          <h3>Driving</h3>
          ${row('abs', 'ABS', onOff(s.assists.abs))}
          ${row('tcs', 'Traction control', onOff(s.assists.tcs))}
          ${row('steering', 'Steering assist', onOff(s.assists.steering))}
          ${row('transmission', 'Gearbox', s.transmission === 'auto' ? 'Automatic' : 'Manual')}
          ${row('damageMode', 'Damage', { full: 'Full', visual: 'Visual only', off: 'Off' }[s.damageMode])}
          ${row('camera', 'Default camera', { chase: 'Chase', far: 'Far chase', hood: 'Hood', bumper: 'Bumper' }[s.camera])}
          <h3>Display</h3>
          ${row('showHelp', 'Controls overlay', onOff(s.showHelp))}
          ${row('ghost', 'Ghost car', onOff(s.ghost))}
          ${row('debug', 'Telemetry', onOff(s.debug))}
          ${row('touch', 'Touch controls', { auto: 'Auto', on: 'On', off: 'Off' }[s.touch])}
          <h3>Progress</h3>
          <button class="danger" data-act="resetProgress">Reset career, cars and credits</button>
        </div>
        <div class="menu-gap"></div>
        <div class="menu-panel">
          <h3>Controls <small>click to rebind</small></h3>${keys}
          <button data-act="resetKeys">Restore default keys</button>
          <p class="car-desc">Gamepad: left stick steer, RT throttle, LT brake, A handbrake, LB/RB shift, Y camera, Back reset, Start pause.</p>
        </div>
      </div>`;
  }

  _toggleSetting(key, dir) {
    const g = this.game;
    const s = g.settings;
    const cycle = (list, cur) => list[(list.indexOf(cur) + dir + list.length) % list.length];
    if (key === 'quality') g.setQuality(cycle(['low', 'medium', 'high'], s.quality));
    else if (key.startsWith('vol:')) {
      const k = key.slice(4);
      s.audio[k] = Math.max(0, Math.min(1, Math.round(s.audio[k] * 10 + dir) / 10));
      g.audio.applyVolumes();
    } else if (key === 'touch') {
      s.touch = cycle(['auto', 'on', 'off'], s.touch);
      g.updateTouch();
    }
    else if (['abs', 'tcs', 'steering'].includes(key)) s.assists[key] = !s.assists[key];
    else if (key === 'transmission') s.transmission = s.transmission === 'auto' ? 'manual' : 'auto';
    else if (key === 'damageMode') {
      s.damageMode = cycle(['full', 'visual', 'off'], s.damageMode);
      if (g.vehicle) g.vehicle.damageMode = s.damageMode;
    } else if (key === 'camera') {
      s.camera = cycle(['chase', 'far', 'hood', 'bumper'], s.camera);
      g.cameraRig.mode = s.camera;
    } else s[key] = !s[key];
    saveSettings(s);
    this._render();
    this.root.querySelector(`[data-act="setting"][data-arg="${key}"]`)?.focus();
  }

  _pause() {
    const g = this.game;
    const m = g.mode;
    const career = !!g.event?.career;
    return `<div class="menu-center">
      <h1>Paused</h1><p>${esc(m?.title ?? '')} · ${esc(g.map?.name ?? '')}</p>
      <nav class="menu-list">
        <button data-act="resume" autofocus>Resume</button>
        ${g.event?.mode !== 'freeroam' ? `<button data-act="restart">Restart${career ? ' event' : ''}</button>` : ''}
        <button data-act="photo">Photo mode</button>
        <button data-act="pauseSettings">Settings</button>
        <button data-act="quit">${g.event?.mode === 'race' ? 'Retire to menu' : 'End session'}</button>
      </nav></div>`;
  }

  _results({ result: r }) {
    const table = r.table
      ? `<table class="results"><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Time</th><th>Best lap</th>${r.career ? '<th>Pts</th>' : ''}</tr>
        ${r.table.map((x) => `<tr class="${x.player ? 'me' : ''}"><td>${x.pos}</td><td>${esc(x.name)}</td><td>${esc(x.car)}</td><td>${x.time}</td><td>${x.best}</td>${r.career ? `<td>${x.points ?? '–'}</td>` : ''}</tr>`).join('')}</table>
        ${r.footnote ? `<p class="car-desc">${r.footnote}</p>` : ''}`
      : '';
    const rows = r.rows?.length ? `<table class="results">${r.rows.map((x) => `<tr class="${x.best ? 'me' : ''}"><td>${esc(x.label)}</td><td>${x.value}</td></tr>`).join('')}</table>` : '';
    const summary = r.summary ? `<dl class="summary">${r.summary.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
    const standings = r.standings
      ? `<h3>${r.championshipOver ? `Championship complete: P${r.championshipOver}` : 'Championship standings'}</h3>
        <ol class="standings">${r.standings.map((x) => `<li class="${x.id === 'player' ? 'me' : ''}"><span>${esc(x.name)}</span><b>${x.points}</b></li>`).join('')}</ol>`
      : '';
    const earned = (r.credits ?? 0) + (r.championPrize ?? 0);
    return `<div class="menu-center results-box">
      <h1>${esc(r.title)}</h1><p>${esc(r.subtitle ?? '')}</p>
      ${table}${rows}${summary}${standings}
      <div class="earned">${earned ? `+ ${money(r.credits ?? 0)}${r.championPrize ? ` · champion prize ${money(r.championPrize)}` : ''}` : 'No prize money'}</div>
      <nav class="menu-row">
        <button class="primary" data-act="resultsNext" autofocus>${r.career ? 'Continue' : 'Menu'}</button>
        ${this.game.replay ? '<button data-act="watchReplay">Watch replay</button>' : ''}
        ${r.restartable ? '<button data-act="resultsRestart">Play again</button>' : ''}
      </nav></div>`;
  }
}
