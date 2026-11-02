import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildSpec } from '../cars/CarSpec.js';
import { buildCarModel } from '../cars/CarModel.js';

/**
 * The garage backdrop shown behind the menus: a car on a slowly turning platform under studio
 * lights. Drag (mouse or touch) to spin it yourself.
 */
export class Showroom {
  constructor(gfx) {
    this.gfx = gfx;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0c0e);
    this.scene.fog = new THREE.Fog(0x0e1218, 14, 40);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

    const pmrem = new THREE.PMREMGenerator(gfx.renderer);
    this.envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 64),
      new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.6, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.platform = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.7, 0.12, 64),
      new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.3, metalness: 0.6 }),
    );
    disc.position.y = 0.06;
    disc.receiveShadow = true;
    this.platform.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.65, 0.025, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0xff5420, emissive: 0xff5420, emissiveIntensity: 1.4 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    this.platform.add(ring);
    this.scene.add(this.platform);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    for (const k of ['left', 'bottom']) key.shadow.camera[k] = -5;
    for (const k of ['right', 'top']) key.shadow.camera[k] = 5;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8ab4ff, 1.4);
    rim.position.set(-6, 3, -5);
    this.scene.add(rim, new THREE.HemisphereLight(0xbcd0ff, 0x20242c, 0.4));

    this.angle = 0.8;
    this.spin = 0.25;
    this.dragging = false;
    this.model = null;
    this.key = '';
    this.visible = false;
    this.shift = 0; // screen-space offset (fraction of width) so menus don't cover the car
    const el = gfx.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!this.visible) return;
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.angle += (e.clientX - this.lastX) * 0.008;
      this.lastX = e.clientX;
    });
  }

  /** Show a car (rebuilds only when the car, colour or upgrades change). */
  setCar(def, colorIndex = 0, upgrades = {}) {
    const key = `${def.id}|${colorIndex}|${JSON.stringify(upgrades)}`;
    if (key === this.key) return;
    this.key = key;
    if (this.model) this.model.dispose();
    const spec = buildSpec(def, upgrades);
    this.model = buildCarModel(def, spec, colorIndex);
    // body origin sits at anchor height above the ground
    this.model.root.position.set(0, spec.anchorHeight + 0.12, 0);
    this.model.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.platform.add(this.model.root);
    this.spec = spec;
  }

  update(dt) {
    if (!this.dragging) this.angle += dt * this.spin;
    this.platform.rotation.y = this.angle;
    const len = this.spec ? this.spec.shape.L : 4.2;
    const dist = 4.6 + len * 1.1;
    this.camera.position.set(dist * 0.85, 1.6 + len * 0.15, dist * 0.55);
    this.camera.lookAt(0, 0.6, 0);
    // slide the view so the car sits beside the menu column instead of under it
    this.camera.setViewOffset(1000, 1000, -this.shift * 1000, 0, 1000, 1000);
  }

  render() {
    const r = this.gfx.renderer;
    const w = r.domElement.clientWidth;
    const h = r.domElement.clientHeight;
    if (this.camera.aspect !== w / h) {
      this.camera.aspect = w / h;
      // keep roughly a 52° horizontal field of view so narrow windows still fit the car
      const vfov = (2 * Math.atan(Math.tan((52 * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
      this.camera.fov = Math.max(34, Math.min(70, vfov));
    }
    this.camera.updateProjectionMatrix();
    const exposure = r.toneMappingExposure;
    r.toneMappingExposure = 1.05;
    r.render(this.scene, this.camera);
    r.toneMappingExposure = exposure;
  }
}
