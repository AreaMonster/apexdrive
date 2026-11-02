import * as THREE from 'three';

/**
 * Photo mode: the session is frozen and a free camera orbits the car.
 *   drag (mouse / touch) orbit · wheel or pinch zoom · ← → ↑ ↓ orbit with the keyboard
 *   panel: field of view, exposure, tilt, hide the panel, save a PNG, close (Esc)
 */
export class PhotoMode {
  constructor(game) {
    this.game = game;
    const root = (this.root = document.createElement('div'));
    root.id = 'photo';
    root.innerHTML = `
      <div class="ph-panel">
        <div class="ph-title">Photo mode</div>
        <label>Field of view <input type="range" data-ph="fov" min="12" max="90" value="45"></label>
        <label>Exposure <input type="range" data-ph="exposure" min="-100" max="100" value="0"></label>
        <label>Roll <input type="range" data-ph="roll" min="-30" max="30" value="0"></label>
        <div class="ph-row">
          <button data-ph-act="save">Save image</button>
          <button data-ph-act="hide">Hide panel</button>
          <button data-ph-act="close">Done</button>
        </div>
        <p class="ph-hint">Drag to orbit · wheel to zoom · Esc to leave</p>
      </div>`;
    document.body.appendChild(root);
    this.active = false;
    this.yaw = 0.6;
    this.pitch = 0.18;
    this.dist = 7;
    this.target = new THREE.Vector3();
    this.drag = null;
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-ph-act]')?.dataset.phAct;
      if (a === 'save') this.save();
      else if (a === 'hide') this.root.classList.add('bare');
      else if (a === 'close') this.close();
    });
    root.addEventListener('input', (e) => {
      const k = e.target.dataset.ph;
      if (k) this[k] = Number(e.target.value);
    });
    this.fov = 45;
    this.exposure = 0;
    this.roll = 0;
    // orbit on the canvas (the panel stops its own events)
    const canvas = game.gfx.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.root.classList.remove('bare');
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, -0.05, 1.45);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (this.drag = null));
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.001), 2.2, 60);
      },
      { passive: false },
    );
  }

  /** car: Vehicle-shaped (pos, quat). onClose: called after leaving. */
  open(car, onClose) {
    this.car = car;
    this.onClose = onClose;
    this.active = true;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quat);
    this.yaw = Math.atan2(fwd.x, fwd.z) + 0.7; // front three-quarter view
    this.pitch = 0.16;
    this.dist = 7;
    this.baseExposure = this.game.gfx.renderer.toneMappingExposure;
    this.root.classList.add('show');
    this.root.classList.remove('bare');
    for (const el of this.root.querySelectorAll('input')) {
      el.value = el.dataset.ph === 'fov' ? 45 : 0;
      this[el.dataset.ph] = Number(el.value);
    }
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.root.classList.remove('show');
    const cam = this.game.gfx.camera;
    cam.fov = 62;
    cam.updateProjectionMatrix();
    this.game.gfx.renderer.toneMappingExposure = this.baseExposure;
    this.onClose?.();
  }

  update(dt) {
    const input = this.game.input;
    if (input.pressed('pause')) return this.close();
    if (input.isDown('left')) this.yaw += dt * 1.2;
    if (input.isDown('right')) this.yaw -= dt * 1.2;
    if (input.isDown('throttle')) this.pitch = Math.min(1.45, this.pitch + dt * 0.8);
    if (input.isDown('brake')) this.pitch = Math.max(-0.05, this.pitch - dt * 0.8);
    const cam = this.game.gfx.camera;
    this.target.copy(this.car.pos).y += 0.35;
    const cp = Math.cos(this.pitch);
    cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist + 0.2,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // keep the camera above the ground under it
    const ground = this.car.pos.y - (this.car.spec?.anchorHeight ?? 0.5) + 0.25;
    if (cam.position.y < ground) cam.position.y = ground;
    cam.lookAt(this.target);
    cam.rotateZ(THREE.MathUtils.degToRad(this.roll));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this.game.gfx.renderer.toneMappingExposure = this.baseExposure * Math.pow(2, this.exposure / 50);
    this.game.gfx.follow(this.car.pos);
  }

  /** Render one frame and download it as a PNG. */
  save() {
    const g = this.game;
    this.root.classList.add('bare');
    g.gfx.render(0);
    const url = g.gfx.renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `apex-drive-${(g.map?.name ?? 'photo').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.root.classList.remove('bare');
  }
}
