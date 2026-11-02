import { surfaceOf } from '../data/surfaces.js';
import { formatTime } from '../core/LapTimer.js';
import { Minimap } from './Minimap.js';

const WHEEL_NAMES = ['FL', 'FR', 'RL', 'RR'];

const HELP = [
  ['W / ↑', 'Throttle'],
  ['S / ↓', 'Brake · reverse'],
  ['A D / ← →', 'Steer'],
  ['Space', 'Handbrake'],
  ['Q / E', 'Shift down / up (manual)'],
  ['T', 'Auto / manual gearbox'],
  ['R', 'Reset to track'],
  ['Backspace', 'Restart'],
  ['C', 'Camera'],
  ['[ / ]', 'Switch car (free roam)'],
  ['V', 'Paint colour'],
  ['U / Y / I', 'ABS / traction ctrl / steer assist'],
  ['K', 'Damage: full / visual / off'],
  ['J', 'Ghost on / off'],
  ['L', 'Time of day / day-night cycle'],
  ['O', 'Weather'],
  ['G', 'Graphics quality'],
  ['F3', 'Telemetry'],
  ['H', 'Hide help'],
  ['Esc / P', 'Pause menu'],
];

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class Hud {
  constructor(root) {
    this.root = root;
    root.innerHTML = '';

    // race panel (top left)
    this.race = el('div', 'hud-panel hud-race', root);
    this.raceTop = el('div', 'hud-race-top', this.race);
    this.lapEl = el('div', 'hud-lap', this.raceTop);
    this.posEl = el('div', 'hud-pos', this.raceTop);
    this.timeEl = el('div', 'hud-time', this.race);
    this.sectorEl = el('div', 'hud-sectors', this.race);
    this.timesEl = el('div', 'hud-times', this.race);

    // drift panel (top centre)
    this.drift = el('div', 'hud-panel hud-drift', root);
    this.driftScore = el('div', 'hud-drift-score', this.drift);
    this.driftChain = el('div', 'hud-drift-chain', this.drift);
    this.driftMeta = el('div', 'hud-drift-meta', this.drift);

    this.deltaEl = el('div', 'hud-delta', root);
    this.banner = el('div', 'hud-banner', root);
    this.wrongWay = el('div', 'hud-wrongway', root, 'WRONG WAY');
    this.countdown = el('div', 'hud-countdown', root, `<div class="lights">${'<span></span>'.repeat(5)}</div><div class="go"></div>`);
    this.lights = [...this.countdown.querySelectorAll('.lights span')];
    this.goEl = this.countdown.querySelector('.go');

    this.minimap = new Minimap(root);
    this.info = el('div', 'hud-info', root);
    this.assists = el('div', 'hud-assists', root);

    const gauge = el('div', 'hud-gauge', root);
    this.canvas = el('canvas', '', gauge);
    this.ctx = this.canvas.getContext('2d');
    this.speedEl = el('div', 'hud-speed', gauge, '0');
    el('div', 'hud-unit', gauge, 'km/h');
    this.gearEl = el('div', 'hud-gear', gauge, 'N');
    this.modeEl = el('div', 'hud-mode', gauge, 'AUTO');

    this.damageCanvas = el('canvas', 'hud-damage', root);
    this.damageCanvas.width = 64;
    this.damageCanvas.height = 108;
    this._damageKey = '';

    this.help = el('div', 'hud-panel hud-help', root, `<h3>Controls</h3>${HELP.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('')}`);
    this.debug = el('div', 'hud-panel hud-debug', root);
    this.toastEl = el('div', 'hud-toast', root);

    this.toastTimer = 0;
    this.bannerTimer = 0;
    this.textTimer = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this._sizeCanvas();
  }

  _sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 230;
    this.canvas.width = this.canvas.height = size * dpr;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
  }

  setMap(map, mode) {
    this.minimap.setTrack(map);
    this.race.style.display = mode?.lapTimer && !mode.hudInfo ? '' : 'none';
    this.drift.style.display = mode?.hudInfo ? '' : 'none';
    this.isStage = !!map.track && !map.track.closed;
    this.banner.classList.remove('show');
    this.wrongWay.classList.remove('show');
    this.deltaEl.className = 'hud-delta';
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = 1.8;
  }

  /** Big centred message for laps and sectors. kind: 'good' | 'bad' | 'best' | '' */
  showBanner(html, kind = '', seconds = 2.5) {
    this.banner.innerHTML = html;
    this.banner.className = `hud-banner show ${kind}`;
    this.bannerTimer = seconds;
  }

  /** n: lights lit (0..5), -1 = GO, null = hidden */
  setCountdown(n) {
    if (n === null) {
      this.countdown.classList.remove('show', 'go');
      return;
    }
    this.countdown.classList.add('show');
    this.countdown.classList.toggle('go', n < 0);
    this.lights.forEach((l, k) => l.classList.toggle('on', n > k));
    this.goEl.textContent = n < 0 ? 'GO' : '';
  }

  update(dt, game) {
    const v = game.vehicle;
    const s = game.settings;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('show');
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.banner.classList.remove('show');

    this._drawTach(v);
    this.speedEl.textContent = Math.round(v.speedKmh);
    const g = v.drivetrain.gear;
    this.gearEl.textContent = g === -1 ? 'R' : g === 0 ? 'N' : String(g);
    this.gearEl.classList.toggle('shifting', v.drivetrain.shifting);
    this.modeEl.textContent = v.drivetrain.auto ? 'AUTO' : 'MANUAL';
    this.help.style.display = s.showHelp ? '' : 'none';
    this.debug.style.display = s.debug ? '' : 'none';

    const lt = game.lapTimer;
    if (game.map.track) {
      const dots = game.mode?.dots ? [...game.mode.dots] : [];
      if (game.ghostPos) dots.push({ x: game.ghostPos.x, z: game.ghostPos.z, color: 'rgba(140,200,255,0.9)' });
      this.minimap.draw(v.pos, v.yaw, dots);
    }
    const drift = game.mode?.hudInfo;
    if (drift) {
      this.driftScore.textContent = drift.score.toLocaleString();
      this.driftChain.innerHTML = drift.chain > 0 ? `+${drift.chain.toLocaleString()} <b>×${drift.multiplier.toFixed(1)}</b>` : '&nbsp;';
      this.driftChain.classList.toggle('live', drift.drifting);
      this.driftMeta.textContent = `${Math.round(drift.angle)}°${drift.timeLeft !== null ? ` · ${Math.ceil(drift.timeLeft)} s left` : ''}`;
    }
    if (lt) {
      this.timeEl.textContent = formatTime(lt.started ? lt.lapTime : 0);
      this.wrongWay.classList.toggle('show', lt.wrongWay && !lt.finished);
      const delta = game.liveDelta;
      if (delta !== null && lt.started && !lt.finished) {
        this.deltaEl.textContent = formatTime(delta, { sign: true }).replace(/^([+−])0:0?/, '$1');
        this.deltaEl.className = `hud-delta show ${delta <= 0 ? 'good' : 'bad'}`;
      } else this.deltaEl.className = 'hud-delta';
    }

    this._drawDamage(v);

    this.textTimer -= dt;
    if (this.textTimer > 0) return;
    this.textTimer = 0.1;

    const d = v.spec.def;
    const perf = v.spec.performance;
    const env = game.env;
    const hh = Math.floor(env.time);
    const clock = `${String(hh).padStart(2, '0')}:${String(Math.floor((env.time - hh) * 60)).padStart(2, '0')}`;
    this.info.innerHTML = `${d.brand} <b>${d.name}</b> · ${d.stats.drivetrain} · ${Math.round(perf.peakPowerKw)} kW · ${game.map.name} · ${env.weather.label} ${clock}`;
    const a = s.assists;
    this.assists.innerHTML = [
      ['ABS', a.abs],
      ['TCS', a.tcs],
      ['STR', a.steering],
    ]
      .map(([n, on]) => `<span class="${on ? 'on' : ''}">${n}</span>`)
      .join('');

    if (lt) {
      if (this.isStage) {
        const pct = Math.round((lt.finished ? 1 : lt.lapProgress) * 100);
        this.lapEl.innerHTML = `<label>STAGE</label>${pct}<small>%</small>`;
      } else {
        const laps = lt.laps ? `${Math.min(lt.lap, lt.laps)}<small>/${lt.laps}</small>` : `${lt.lap}`;
        this.lapEl.innerHTML = `<label>LAP</label>${laps}`;
      }
      this.posEl.innerHTML = `<label>POS</label>${game.position ?? 1}<small>/${game.racers ?? 1}</small>`;
      const best = lt.best;
      const secs = [0, 1, 2].map((k) => {
        const t = k === 0 ? lt.splits[0] : lt.splits[k] !== undefined ? lt.splits[k] - lt.splits[k - 1] : undefined;
        if (t === undefined) return `<span class="${k === lt.sector ? 'cur' : ''}">S${k + 1}</span>`;
        const ref = best?.splits ? (k === 0 ? best.splits[0] : best.splits[k] - best.splits[k - 1]) : null;
        const cls = ref === null || ref === undefined ? 'done' : t <= ref ? 'good' : 'bad';
        return `<span class="${cls}">${t.toFixed(2)}</span>`;
      });
      this.sectorEl.innerHTML = secs.join('');
      const last = lt.lastLap;
      this.timesEl.innerHTML = `
        <div><label>LAST</label>${last ? formatTime(last.time) + (last.valid ? '' : ' <em>invalid</em>') : '--:--.---'}</div>
        <div><label>BEST</label>${formatTime(best?.time)}</div>
        ${lt.invalid ? '<div class="warn">Lap invalidated (reset)</div>' : ''}`;
    }

    if (s.debug) {
      const t = game.telemetry;
      const fmt = (x, n = 2) => (x === null || x === undefined ? '—' : x.toFixed(n));
      const rows = v.wheels
        .map(
          (w, i) =>
            `<tr><td>${WHEEL_NAMES[i]}</td><td>${(w.load / 1000).toFixed(1)}</td><td>${((w.slipAngle * 180) / Math.PI).toFixed(1)}</td><td>${w.spin > 0 ? 'SPIN' : w.lock ? 'LOCK' : w.skid > 0.2 ? 'SLIDE' : ''}</td><td>${w.contact ? surfaceOf(w.surface).label : 'air'}</td></tr>`,
        )
        .join('');
      const dm = v.damage;
      this.debug.innerHTML = `
        <div>FPS <b>${this.fps.toFixed(0)}</b> · physics ${game.physicsMs.toFixed(2)} ms · ${game.gfx.quality} · ${game.gfx.renderer.info.render.calls} draws</div>
        <div>rpm <b>${Math.round(v.drivetrain.rpm)}</b> · torque ${Math.round(v.drivetrain.torque)} Nm · steer ${((v.steerAngle * 180) / Math.PI).toFixed(1)}°</div>
        <div>lat <b>${v.latG.toFixed(2)} g</b> · long ${v.longG.toFixed(2)} g · body slip ${((v.bodySlip * 180) / Math.PI).toFixed(1)}°</div>
        <table><tr><th></th><th>kN</th><th>slip°</th><th></th><th>surface</th></tr>${rows}</table>
        <div>damage F ${fmt(dm.front)} R ${fmt(dm.rear)} L ${fmt(dm.left)} R ${fmt(dm.right)} (${v.damageMode})</div>
        <div class="hud-measure">0-100: <b>${fmt(t.zeroTo100)} s</b> (best ${fmt(t.best0to100)}, spec ${d.stats.zeroTo100})</div>
        <div class="hud-measure">100-0: <b>${fmt(t.brake100, 1)} m</b> · top: <b>${t.topSpeed.toFixed(0)}</b> km/h (spec ${d.stats.topSpeed})</div>`;
    }
  }

  _drawDamage(v) {
    const d = v.damage;
    const key = `${d.front.toFixed(2)}${d.rear.toFixed(2)}${d.left.toFixed(2)}${d.right.toFixed(2)}${v.damageMode}`;
    if (key === this._damageKey) return;
    this._damageKey = key;
    const ctx = this.damageCanvas.getContext('2d');
    const W = 64;
    const H = 108;
    ctx.clearRect(0, 0, W, H);
    this.damageCanvas.style.opacity = v.damageMode === 'off' ? '0.25' : '1';
    // green → amber → red
    const col = (x) => `hsl(${Math.round(120 * (1 - Math.min(1, x)))}, 85%, ${x > 0.02 ? 50 : 40}%)`;
    const body = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    };
    body(14, 8, 36, 92, 12);
    ctx.fillStyle = 'rgba(10,13,18,0.6)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.fillStyle = col(d.front);
    body(18, 10, 28, 12, 6);
    ctx.fill();
    ctx.fillStyle = col(d.rear);
    body(18, 86, 28, 12, 6);
    ctx.fill();
    ctx.fillStyle = col(d.left);
    body(15, 26, 7, 56, 3);
    ctx.fill();
    ctx.fillStyle = col(d.right);
    body(42, 26, 7, 56, 3);
    ctx.fill();
    // glass
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    body(24, 34, 16, 14, 3);
    ctx.fill();
  }

  _drawTach(v) {
    const ctx = this.ctx;
    const S = this.size;
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2 - 12;
    const e = v.spec.engine;
    const maxRpm = Math.ceil((e.redline + 500) / 1000) * 1000;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const ang = (rpm) => a0 + (a1 - a0) * Math.min(rpm / maxRpm, 1);
    ctx.clearRect(0, 0, S, S);

    // segmented arc like a race dash: one block per 250 rpm, white, then orange approaching the
    // redline, red past it; the whole arc flashes as a shift light right at the limit
    const rpm = v.drivetrain.rpm;
    const segs = maxRpm / 250;
    const gap = 0.012;
    const shift = rpm > e.redline * 0.96 && Math.floor(performance.now() / 70) % 2 === 0;
    ctx.lineWidth = 10;
    ctx.lineCap = 'butt';
    for (let k = 0; k < segs; k++) {
      const r0 = k * 250;
      const lit = rpm >= r0 + 125;
      const hot = r0 >= e.redline * 0.85;
      const red = r0 >= e.redline;
      let col = 'rgba(243,241,236,0.1)';
      if (red) col = lit ? '#ff2b1f' : 'rgba(255,43,31,0.28)';
      else if (lit) col = shift ? '#ff2b1f' : hot ? '#ff5420' : '#f3f1ec';
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, R, ang(r0) + gap, ang(r0 + 250) - gap);
      ctx.stroke();
    }
    // major ticks and numerals
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(243,241,236,0.55)';
    ctx.fillStyle = 'rgba(243,241,236,0.8)';
    ctx.font = '700 12px Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= maxRpm; k += 1000) {
      const a = ang(k);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
      ctx.lineTo(cx + Math.cos(a) * (R - 14), cy + Math.sin(a) * (R - 14));
      ctx.stroke();
      ctx.fillText(String(k / 1000), cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24));
    }
  }
}
