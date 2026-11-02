// On-screen controls for phones and tablets.
//   left half   drag sideways anywhere to steer (analogue, centred where the thumb lands)
//   right side  throttle and brake pedals (pressure-free: on while held), handbrake button
//   top         pause, camera and reset buttons
// Multi-touch via pointer events; feeds Input.touch and Input.trigger(action).

const STEER_RANGE = 70; // px of thumb travel for full lock

// Phones / tablets report a coarse primary pointer. Touch-screen laptops don't (their primary
// pointer is the mouse), so there the controls appear once the screen is actually touched.
let touchSeen = false;
window.addEventListener('touchstart', () => (touchSeen = true), { once: true, passive: true });

export function isTouchDevice() {
  return touchSeen || matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div class="t-steer"><div class="t-steer-track"><i></i></div><span>STEER</span></div>
      <button class="t-btn t-hand" data-hold="handbrake">HB</button>
      <button class="t-pedal t-brake" data-hold="brake"><span>BRAKE</span></button>
      <button class="t-pedal t-gas" data-hold="throttle"><span>GAS</span></button>
      <div class="t-top">
        <button class="t-btn" data-tap="reset" aria-label="Reset">↺</button>
        <button class="t-btn" data-tap="camera" aria-label="Camera">◉</button>
        <button class="t-btn" data-tap="pause" aria-label="Pause">II</button>
      </div>`;
    document.body.appendChild(root);
    // first touch on a touch-screen laptop: bring the controls up straight away
    window.addEventListener('touchstart', () => setTimeout(() => this.onFirstTouch?.(), 0), { once: true, passive: true });
    this.knob = root.querySelector('.t-steer-track i');
    this.steerZone = root.querySelector('.t-steer');
    this.holds = new Map(); // pointerId → action
    this.steerId = null;
    this.steerX0 = 0;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, active: false };
    input.touch = this.state;

    const prevent = (e) => e.preventDefault();
    root.addEventListener('touchstart', prevent, { passive: false });
    root.addEventListener('touchmove', prevent, { passive: false });
    root.addEventListener('contextmenu', prevent);

    root.addEventListener('pointerdown', (e) => {
      const t = e.target.closest('[data-hold],[data-tap],.t-steer');
      if (!t) return;
      e.preventDefault();
      if (t.dataset.tap) {
        input.trigger(t.dataset.tap);
        t.classList.add('on');
        setTimeout(() => t.classList.remove('on'), 120);
        return;
      }
      try {
        t.setPointerCapture(e.pointerId); // keep receiving moves when the thumb slides off
      } catch {
        // pointer already gone (or synthetic): moves still bubble to the root
      }
      if (t.dataset.hold) {
        this.holds.set(e.pointerId, t);
        t.classList.add('on');
      } else if (this.steerId === null) {
        this.steerId = e.pointerId;
        this.steerX0 = e.clientX;
        this.steerZone.classList.add('on');
      }
      this._sync();
    });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.steerId) {
        const dx = e.clientX - this.steerX0;
        // let the anchor follow if the thumb drifts past full lock, so reversing is instant
        if (Math.abs(dx) > STEER_RANGE) this.steerX0 = e.clientX - Math.sign(dx) * STEER_RANGE;
        this.state.steer = Math.max(-1, Math.min(1, dx / STEER_RANGE));
        this._sync();
        return;
      }
      // sliding a thumb from one pedal to the other switches pedals
      const held = this.holds.get(e.pointerId);
      if (!held) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-hold]');
      if (over && over !== held && over.classList.contains('t-pedal') && held.classList.contains('t-pedal')) {
        held.classList.remove('on');
        over.classList.add('on');
        this.holds.set(e.pointerId, over);
        this._sync();
      }
    });
    const up = (e) => {
      if (e.pointerId === this.steerId) {
        this.steerId = null;
        this.state.steer = 0;
        this.steerZone.classList.remove('on');
      }
      const held = this.holds.get(e.pointerId);
      if (held) {
        this.holds.delete(e.pointerId);
        if (![...this.holds.values()].includes(held)) held.classList.remove('on');
      }
      this._sync();
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    this.setVisible(false);
  }

  _sync() {
    const s = this.state;
    const held = new Set([...this.holds.values()].map((t) => t.dataset.hold));
    s.throttle = held.has('throttle') ? 1 : 0;
    s.brake = held.has('brake') ? 1 : 0;
    s.handbrake = held.has('handbrake');
    s.active = this.steerId !== null || held.size > 0;
    this.knob.style.transform = `translateX(${s.steer * 46}px)`;
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
    document.body.classList.toggle('touch', v);
    if (!v) {
      this.holds.clear();
      this.steerId = null;
      this.state.steer = 0;
      this._sync();
    }
  }

  dispose() {
    this.root.remove();
    this.input.touch = null;
  }
}
