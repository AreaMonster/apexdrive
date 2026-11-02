import * as THREE from 'three';
import { PostFX } from './PostFX.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: false, shadowSize: 0, fogFar: 1100, particles: 0.35, post: false },
  medium: { pixelRatio: 1, shadows: true, shadowSize: 1024, fogFar: 1700, particles: 0.65, post: true, samples: 2 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, fogFar: 2200, particles: 1, post: true, samples: 4 },
};

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color(0x3f74c8) },
      horizon: { value: new THREE.Color(0xcfe1f2) },
      ground: { value: new THREE.Color(0x8c9a80) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(1, 0.92, 0.75) },
      sunGlow: { value: 1 },
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      night: { value: 0 },
      overcast: { value: 0 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // always on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, horizon, ground, sunDir, sunColor, moonDir;
      uniform float sunGlow, night, overcast, time;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int k = 0; k < 5; k++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, pow(min(-h * 6.0, 1.0), 0.6));
        float clear = 1.0 - overcast;
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * sunGlow * clear * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.3);
        // clouds: fbm on a flat layer overhead, drifting with the wind. More cover when overcast;
        // lit by the sun (bright tops, silver lining toward it), grey-blue at night.
        if (h > 0.0) {
          vec2 cp = d.xz / (h + 0.12) * 0.55 + time * vec2(0.006, 0.0025);
          float n = fbm(cp * 1.4) * 0.7 + fbm(cp * 4.3 + 3.0) * 0.3;
          float cover = 0.42 + overcast * 0.5;
          float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.28, n) * smoothstep(0.0, 0.18, h);
          vec3 lit = mix(vec3(1.0, 0.98, 0.95), sunColor, 0.35) * (1.25 - overcast * 0.45);
          vec3 shade = mix(horizon * 0.82, vec3(0.55, 0.58, 0.63), overcast);
          vec3 cloud = mix(lit, shade, smoothstep(0.35, 1.0, dens) * 0.75);
          cloud += sunColor * pow(s, 6.0) * 0.5 * (1.0 - dens) * clear;
          cloud = mix(cloud, horizon * 0.5 + vec3(0.02, 0.025, 0.04), night);
          col = mix(col, cloud, dens * 0.92);
        }
        // stars and moon, fading in after dusk and hidden by cloud
        if (h > 0.0 && night > 0.0) {
          vec3 cell = floor(d * 380.0);
          float st = step(0.9975, hash(cell)) * hash(cell + 7.0);
          col += vec3(st) * night * clear * smoothstep(0.0, 0.25, h);
          float m = max(dot(d, moonDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * night * (smoothstep(0.9994, 0.9996, m) * 1.4 + pow(m, 60.0) * 0.12 * clear);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Owns the WebGL renderer, scene, camera, lights and sky. Throws if WebGL is unavailable. */
export class Renderer {
  constructor(container, quality = 'medium') {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
    this.scene.fog = new THREE.Fog(0xcfe1f2, 300, QUALITY.medium.fogFar);
    this.fogFar = QUALITY.medium.fogFar;

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), makeSkyMaterial());
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x55603f, 0.55);
    this.scene.add(this.hemi);
    // key light: the sun by day, the moon by night
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.envProps = null; // optional Object3D a map adds to the reflection capture (e.g. neon)
    this.post = null; // PostFX on medium / high
    this.clock = 0;

    this.setQuality(quality);
  }

  /**
   * Apply a lighting state (computed by core/Environment):
   * { zenith, horizon, ground, sunDir, sunColor, sunGlow, moonDir, lightDir, lightColor,
   *   lightIntensity, hemiSky, hemiGround, hemiIntensity, fogColor, fogNear, fogFar, exposure,
   *   envIntensity, night, overcast }
   */
  applyLighting(L) {
    const u = this.sky.material.uniforms;
    u.zenith.value.copy(L.zenith);
    u.horizon.value.copy(L.horizon);
    u.ground.value.copy(L.ground);
    u.sunDir.value.copy(L.sunDir);
    u.sunColor.value.copy(L.sunColor);
    u.sunGlow.value = L.sunGlow;
    u.moonDir.value.copy(L.moonDir);
    u.night.value = L.night;
    u.overcast.value = L.overcast;
    this.lightDir.copy(L.lightDir);
    this.sun.color.copy(L.lightColor);
    this.sun.intensity = L.lightIntensity;
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;
    this.scene.fog.color.copy(L.fogColor);
    this.scene.fog.near = L.fogNear;
    this.fogFar = L.fogFar;
    this.scene.fog.far = Math.min(this.fogFar, QUALITY[this.quality]?.fogFar ?? 1700);
    this.renderer.toneMappingExposure = L.exposure;
    this.scene.environmentIntensity = L.envIntensity;
    this.mood = { night: L.night, overcast: L.overcast };
    this.post?.setMood(L.night, L.overcast);
  }

  /** Rebuild the image-based lighting from the current sky (plus any map-supplied props). */
  rebuildEnvMap() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.sky.material);
    envScene.add(envSky);
    if (this.envProps) envScene.add(this.envProps);
    const old = this._envTarget;
    this._envTarget = pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this._envTarget.texture;
    if (this.envProps) envScene.remove(this.envProps);
    envSky.geometry.dispose();
    pmrem.dispose();
    if (old) old.dispose(); // the render target owns the texture
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.medium;
    this.quality = name;
    this.dynScale = 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.fog.far = Math.min(this.fogFar, q.fogFar);
    if (this.post && this.post.samples !== q.samples) {
      this.post.dispose();
      this.post = null;
    }
    if (q.post && !this.post) {
      this.post = new PostFX(this.renderer, this.scene, this.camera, q.samples);
      if (this.mood) this.post.setMood(this.mood.night, this.mood.overcast);
    } else if (!q.post && this.post) {
      this.post.dispose();
      this.post = null;
    }
    this.resize();
  }

  /** Dynamic resolution: scale the preset's pixel ratio (0.5..1) to hold the frame rate. */
  setDynamicScale(k) {
    if (Math.abs(k - this.dynScale) < 0.01) return;
    this.dynScale = k;
    const q = QUALITY[this.quality] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio) * k);
    this.resize();
  }

  /** Keep the shadow frustum and sky centred on the action. */
  follow(target) {
    this.sun.position.copy(target).addScaledVector(this.lightDir, 120);
    this.sun.target.position.copy(target);
    this.sky.position.copy(this.camera.position);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
  }

  render(dt = 1 / 60) {
    this.clock += dt;
    this.sky.material.uniforms.time.value = this.clock;
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
