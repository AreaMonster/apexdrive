import * as THREE from 'three';

// Rain (falling streaks) and snow (drifting flakes), animated entirely on the GPU.
// Each drop has a fixed random position in a box; the vertex shader moves it with time and wraps
// it into a box centred on the camera, so the weather follows the player at zero CPU cost.

const BOX = new THREE.Vector3(60, 30, 60);

const VERT_COMMON = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uBox;
  uniform float uSpeed;
  uniform vec2 uWind;
  vec3 placeDrop(vec3 p, float sway) {
    p.y -= uTime * uSpeed;
    p.xz += uWind * uTime;
    p.x += sin(uTime * 1.3 + p.y * 0.7) * sway;
    p.z += cos(uTime * 1.1 + p.x * 0.5) * sway;
    // wrap into a box centred on the camera
    return mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  }
`;

function rainMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uSpeed: { value: 16 },
      uWind: { value: new THREE.Vector2(1.5, 0.8) },
      uLen: { value: 0.7 },
      uColor: { value: new THREE.Color(0xaabbcc) },
      uOpacity: { value: 0.35 },
    },
    vertexShader: /* glsl */ `
      ${VERT_COMMON}
      uniform float uLen;
      attribute float aEnd;
      varying float vEnd;
      void main() {
        vec3 p = placeDrop(position, 0.0);
        vec3 dir = normalize(vec3(uWind.x, -uSpeed, uWind.y));
        p -= dir * uLen * aEnd; // the tail trails behind the head
        vEnd = aEnd;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vEnd;
      void main() { gl_FragColor = vec4(uColor, uOpacity * (1.0 - vEnd * 0.8)); }`,
  });
}

function snowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uSpeed: { value: 1.6 },
      uWind: { value: new THREE.Vector2(0.8, 0.3) },
      uSize: { value: 0.12 },
      uScale: { value: 400 },
      uOpacity: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      ${VERT_COMMON}
      uniform float uSize;
      uniform float uScale;
      void main() {
        vec3 p = placeDrop(position, 0.6);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * uScale / max(-mv.z, 0.5);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vec3(1.0), uOpacity * smoothstep(0.5, 0.2, d));
      }`,
  });
}

export class Precipitation {
  constructor(scene) {
    this.scene = scene;
    this.object = null;
    this.type = null;
    this.time = 0;
  }

  /** type: 'rain' | 'snow' | null; density 0..1 scales the particle count (graphics quality). */
  set(type, density = 1) {
    if (type === this.type && density === this.density) return;
    this.dispose();
    this.type = type;
    this.density = density;
    if (!type) return;
    const rand = () => Math.random();
    if (type === 'rain') {
      const n = Math.round(7000 * density);
      const pos = new Float32Array(n * 6);
      const end = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = rand() * BOX.x;
        const y = rand() * BOX.y;
        const z = rand() * BOX.z;
        pos.set([x, y, z, x, y, z], i * 6);
        end[i * 2 + 1] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
      this.object = new THREE.LineSegments(geo, rainMaterial());
    } else {
      const n = Math.round(5000 * density);
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i += 3) pos.set([rand() * BOX.x, rand() * BOX.y, rand() * BOX.z], i);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.object = new THREE.Points(geo, snowMaterial());
    }
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.scene.add(this.object);
  }

  update(dt, camera, night = 0) {
    if (!this.object) return;
    this.time += dt;
    const u = this.object.material.uniforms;
    u.uTime.value = this.time;
    u.uCam.value.copy(camera.position);
    // rain is lit by the scene: fainter at night, except where headlights would catch it
    if (u.uColor) u.uOpacity.value = 0.32 - 0.14 * night;
    if (u.uScale) u.uScale.value = window.innerHeight * 0.5;
  }

  dispose() {
    if (!this.object) return;
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.object.removeFromParent();
    this.object = null;
    this.type = null;
  }
}
