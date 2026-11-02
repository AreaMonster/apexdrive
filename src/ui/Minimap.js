// Heading-up minimap. The track is built once as a Path2D in world metres; each frame only the
// canvas transform changes (translate to the car, rotate by its yaw, scale), so drawing is cheap.

const RANGE = 260; // metres from the car to the edge of the map

export class Minimap {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-minimap';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.size = 0;
    this.track = null;
  }

  _resize() {
    const css = this.canvas.clientWidth || 190;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.size === css && this.dpr === dpr) return;
    this.size = css;
    this.dpr = dpr;
    this.canvas.width = this.canvas.height = Math.round(css * dpr);
  }

  setTrack(map) {
    this.track = map?.track || null;
    this.canvas.style.display = this.track ? '' : 'none';
    if (!this.track) return;
    const t = this.track;
    const path = new Path2D();
    for (let i = 0; i < t.count; i++) {
      const x = t.pos[i * 3];
      const z = t.pos[i * 3 + 2];
      if (i === 0) path.moveTo(x, z);
      else path.lineTo(x, z);
    }
    if (t.closed) path.closePath();
    this.path = path;
    this.width = t.half[0] * 2;
    // start line as a short segment across the track
    const across = (i) => {
      const tx = t.tan[i * 2];
      const tz = t.tan[i * 2 + 1];
      const h = t.half[i] + 3;
      return [t.pos[i * 3] - tz * h, t.pos[i * 3 + 2] + tx * h, t.pos[i * 3] + tz * h, t.pos[i * 3 + 2] - tx * h];
    };
    this.startLine = across(map.startIndex ?? 0);
    this.finishLine = map.finishIndex !== undefined && map.finishIndex !== map.startIndex ? across(map.finishIndex) : null;
    const pit = map.layout?.pitCenter;
    if (pit) {
      const pp = new Path2D();
      let open = false;
      for (let i = 0; i < t.count; i++) {
        if (!pit[i]) {
          open = false;
          continue;
        }
        const x = t.pos[i * 3] - t.tan[i * 2 + 1] * pit[i];
        const z = t.pos[i * 3 + 2] + t.tan[i * 2] * pit[i];
        if (!open) pp.moveTo(x, z);
        else pp.lineTo(x, z);
        open = true;
      }
      this.pitPath = pp;
    }
  }

  draw(car, yaw, others = []) {
    if (!this.track) return;
    this._resize();
    const ctx = this.ctx;
    const S = this.canvas.width;
    const k = (S / 2 / RANGE) * 0.95;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 13, 18, 0.62)';
    ctx.fill();
    ctx.clip();

    // world → screen: car at the centre (slightly low), heading up. In screen space world +z
    // points down; rotating by the car's yaw brings its heading (-sin yaw, -cos yaw) to (0, -1).
    const cx = S / 2;
    const cy = S * 0.58;
    ctx.setTransform(k, 0, 0, k, cx, cy);
    ctx.rotate(yaw);
    ctx.translate(-car.x, -car.z);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = this.width + 10;
    ctx.stroke(this.path);
    ctx.strokeStyle = '#d9dde3';
    ctx.lineWidth = this.width;
    ctx.stroke(this.path);
    if (this.pitPath) {
      ctx.strokeStyle = 'rgba(217,221,227,0.55)';
      ctx.lineWidth = 6;
      ctx.stroke(this.pitPath);
    }
    ctx.lineWidth = 6;
    for (const [line, color] of [[this.startLine, '#ff4d3d'], [this.finishLine, '#3ddc84']]) {
      if (!line) continue;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(line[0], line[1]);
      ctx.lineTo(line[2], line[3]);
      ctx.stroke();
    }
    for (const o of others) {
      ctx.fillStyle = o.color;
      ctx.beginPath();
      ctx.arc(o.x, o.z, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // player arrow
    ctx.setTransform(this.dpr, 0, 0, this.dpr, cx, cy);
    ctx.fillStyle = '#ffb020';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
