// Keyboard + gamepad input. Continuous controls are merged (whichever device gives more wins);
// one-shot actions are edge-triggered once per frame.

export const DEFAULT_BINDINGS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  reset: ['KeyR'],
  restart: ['Backspace'],
  nextMap: ['KeyM'],
  damageMode: ['KeyK'],
  ghost: ['KeyJ'],
  timeOfDay: ['KeyL'],
  weather: ['KeyO'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  transmission: ['KeyT'],
  toggleAbs: ['KeyU'],
  toggleTcs: ['KeyY'],
  toggleSteerAssist: ['KeyI'],
  paint: ['KeyV'],
  quality: ['KeyG'],
  help: ['KeyH'],
  debug: ['F3', 'Backquote'],
  prevCar: ['BracketLeft', 'PageUp'],
  nextCar: ['BracketRight', 'PageDown'],
};

// Standard-mapping gamepad buttons → actions
const PAD_ACTIONS = { 3: 'camera', 5: 'shiftUp', 4: 'shiftDown', 8: 'reset', 9: 'pause', 2: 'transmission', 12: 'restart', 14: 'prevCar', 15: 'nextCar' };
const DEADZONE = 0.12;

export class Input {
  constructor(bindings = {}) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this.down = new Set();
    this.queued = [];
    this.actions = new Set();
    this.padPrev = [];
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, analog: false };
    this.override = null; // scripted controls (testing / replays)
    this.touch = null; // on-screen controls state (ui/TouchControls.js)
    this.triggered = [];
    this._codes = new Set(Object.values(this.bindings).flat());

    this._onDown = (e) => {
      if (this._codes.has(e.code)) e.preventDefault();
      if (!e.repeat) this.queued.push(e.code);
      this.down.add(e.code);
    };
    this._onUp = (e) => this.down.delete(e.code);
    this._onBlur = () => this.down.clear();
    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** Replace key bindings (missing actions fall back to the defaults). */
  setBindings(bindings = {}) {
    this.bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this._codes = new Set(Object.values(this.bindings).flat());
  }

  isDown(action) {
    const codes = this.bindings[action];
    return codes ? codes.some((c) => this.down.has(c)) : false;
  }

  pressed(action) {
    return this.actions.has(action);
  }

  /** Fire a one-shot action from outside the keyboard / pad (touch buttons). */
  trigger(action) {
    this.triggered.push(action);
  }

  poll() {
    this.actions.clear();
    for (const code of this.queued) {
      for (const [action, codes] of Object.entries(this.bindings)) if (codes.includes(code)) this.actions.add(action);
    }
    this.queued.length = 0;
    for (const a of this.triggered) this.actions.add(a);
    this.triggered.length = 0;

    const kb = {
      throttle: this.isDown('throttle') ? 1 : 0,
      brake: this.isDown('brake') ? 1 : 0,
      steer: (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0),
      handbrake: this.isDown('handbrake'),
    };
    const pad = this._pollGamepad();
    const c = this.controls;
    if (pad && (pad.active || !(kb.throttle || kb.brake || kb.steer || kb.handbrake))) {
      c.throttle = Math.max(kb.throttle, pad.throttle);
      c.brake = Math.max(kb.brake, pad.brake);
      c.steer = kb.steer !== 0 ? kb.steer : pad.steer;
      c.handbrake = kb.handbrake || pad.handbrake;
      c.analog = kb.steer === 0;
    } else {
      Object.assign(c, kb);
      c.analog = false;
    }
    const t = this.touch;
    if (t?.active) {
      c.throttle = Math.max(c.throttle, t.throttle);
      c.brake = Math.max(c.brake, t.brake);
      if (t.steer !== 0 || c.steer === 0) c.steer = t.steer;
      c.handbrake = c.handbrake || t.handbrake;
      c.analog = true;
    }
    if (this.override) Object.assign(c, this.override);
  }

  _pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads || []).find((p) => p && p.connected);
    if (!gp) return null;
    const b = (i) => gp.buttons[i] || { pressed: false, value: 0 };
    for (const [i, action] of Object.entries(PAD_ACTIONS)) {
      const now = b(+i).pressed;
      if (now && !this.padPrev[i]) this.actions.add(action);
      this.padPrev[i] = now;
    }
    let x = gp.axes[0] || 0;
    x = Math.abs(x) < DEADZONE ? 0 : Math.sign(x) * ((Math.abs(x) - DEADZONE) / (1 - DEADZONE));
    // slight expo makes small corrections easier on a thumbstick
    const steer = Math.sign(x) * Math.pow(Math.abs(x), 1.4);
    const throttle = b(7).value;
    const brake = b(6).value;
    const handbrake = b(0).pressed || b(1).pressed;
    return { steer, throttle, brake, handbrake, active: steer !== 0 || throttle > 0.05 || brake > 0.05 || handbrake };
  }

  dispose() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
