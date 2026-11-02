
const SPEEDS = [0.25, 0.5, 1, 2];
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Full-screen replay controls: restart, play/pause, seek, speed, camera, followed car, back.
 * Keyboard: Space play/pause, ← → seek 5 s, C camera, [ ] car, Esc back to the results.
 */
export class ReplayBar {
  constructor(game) {
    this.game = game;
    const root = (this.root = document.createElement('div'));
    root.id = 'replay-bar';
    root.innerHTML = `
      <button data-rp="restart" title="From the start">⏮</button>
      <button data-rp="play" title="Play / pause (Space)">❚❚</button>
      <input type="range" min="0" max="1000" value="0" step="1" aria-label="Replay position" />
      <span class="rp-time">0:00 / 0:00</span>
      <button data-rp="speed" title="Playback speed">1×</button>
      <button data-rp="camera" title="Camera (C)">Director</button>
      <button data-rp="car" title="Follow car ([ ])">You</button>
      <button data-rp="photo" title="Photo mode">Photo</button>
      <button data-rp="back" title="Back to results (Esc)">Results</button>`;
    document.body.appendChild(root);
    this.badge = document.createElement('div');
    this.badge.className = 'replay-badge';
    document.body.appendChild(this.badge);
    this.slider = root.querySelector('input');
    this.timeEl = root.querySelector('.rp-time');
    this.btn = Object.fromEntries([...root.querySelectorAll('[data-rp]')].map((b) => [b.dataset.rp, b]));
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rp]');
      if (b) {
        this.act(b.dataset.rp);
        b.blur();
      }
    });
    this.slider.addEventListener('input', () => {
      const r = this.game.replay;
      if (r) this.game.seekReplay((this.slider.value / 1000) * r.duration);
    });
    this.slider.addEventListener('change', () => this.slider.blur());
    // keep the arrow keys for seeking rather than nudging whichever button has focus
    root.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
  }

  act(a) {
    const g = this.game;
    const r = g.replay;
    if (!r) return;
    if (a === 'restart') g.seekReplay(0, true);
    else if (a === 'play') {
      if (!r.playing && r.time >= r.duration - 0.05) g.seekReplay(0);
      r.playing = !r.playing;
    } else if (a === 'speed') r.speed = SPEEDS[(SPEEDS.indexOf(r.speed) + 1) % SPEEDS.length];
    else if (a === 'camera') r.camera.next();
    else if (a === 'car') g.cycleReplayFocus(1);
    else if (a === 'back') g.closeReplayViewer();
    else if (a === 'photo') return g.openPhoto();
    this.refresh(true);
  }

  show(v) {
    this.root.classList.toggle('show', v);
    this.badge.classList.toggle('show', v);
  }

  /** Called every frame while visible. */
  refresh(force = false) {
    const r = this.game.replay;
    if (!r) return;
    if (!this.dragging) this.slider.value = Math.round((r.time / r.duration) * 1000);
    const txt = `${mmss(r.time)} / ${mmss(r.duration)}`;
    if (txt !== this._txt) this.timeEl.textContent = this._txt = txt;
    const focus = r.proxies[r.focus];
    const play = r.playing ? '❚❚' : '▶';
    if (force || this.btn.play.textContent !== play) {
      this.btn.play.textContent = play;
      this.btn.speed.textContent = `${r.speed}×`;
      this.btn.camera.textContent = r.camera.label;
      this.btn.car.textContent = focus.track.name || 'You';
      this.badge.innerHTML = `<span>●</span>REPLAY<em>${focus.track.name || 'You'} · ${focus.def.brand} ${focus.def.name}</em>`;
    }
  }

  dispose() {
    this.root.remove();
    this.badge.remove();
  }
}
