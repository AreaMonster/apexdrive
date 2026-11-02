import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Post-processing chain (medium / high quality; low renders straight to the screen):
//   scene (HDR, MSAA) → bloom (only what is brighter than white: lamps, neon, sun glints)
//   → grade (contrast, saturation, warm/cool split, vignette, a touch of grain)
//   → output (ACES tone mapping + sRGB)

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.06 },
    saturation: { value: 1.08 },
    shadowTint: { value: new THREE.Color(0.96, 0.99, 1.06) },
    highlightTint: { value: new THREE.Color(1.04, 1.0, 0.95) },
    vignette: { value: 0.32 },
    grain: { value: 0.025 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast, saturation, vignette, grain, time;
    uniform vec3 shadowTint, highlightTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      // work in a log-ish space so the grade behaves the same in daylight and at night
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // split toning: cool shadows, warm highlights (scaled by brightness)
      float hl = smoothstep(0.05, 0.9, l);
      col *= mix(shadowTint, highlightTint, hl);
      // saturation around luminance, contrast around a mid grey
      col = mix(vec3(l), col, saturation);
      col = max(vec3(0.0), (col - 0.18) * contrast + 0.18);
      // vignette
      vec2 d = vUv - 0.5;
      col *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      // fine film grain (stronger in the dark, where it hides banding)
      col += (hash(vUv * 1024.0 + time) - 0.5) * grain * (1.0 - hl) * 0.1;
      gl_FragColor = vec4(col, c.a);
    }`,
};

// Clamp extreme HDR values before the bloom: a spot light glinting off a wet road can reach
// hundreds of times white, and the bloom would smear that over the whole frame.
const ClampShader = {
  uniforms: { tDiffuse: { value: null }, maxValue: { value: 6.0 } },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float maxValue;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float m = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(m > maxValue ? c.rgb * (maxValue / m) : c.rgb, c.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, samples = 4) {
    this.renderer = renderer;
    this.samples = samples;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.2, 0.45, 1.0);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.clamp = new ShaderPass(ClampShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.clamp);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
  }

  /** night 0..1, overcast 0..1: bloom is stronger at night, the grade softer under cloud. */
  setMood(night, overcast) {
    this.bloom.strength = 0.2 + night * 0.25;
    this.bloom.radius = 0.45;
    this.bloom.threshold = 1.0;
    const u = this.grade.uniforms;
    u.saturation.value = 1.1 - overcast * 0.12;
    u.contrast.value = 1.07 - overcast * 0.04;
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.grade.uniforms.time.value = (this.grade.uniforms.time.value + dt * 60) % 1000;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
