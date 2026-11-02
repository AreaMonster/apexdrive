import * as THREE from 'three';
import { Textures } from './textures.js';
import { mulberry32, makeNoise2D } from './noise.js';

// Ground shading and vegetation shared by every outdoor map.
//   terrainMaterial()  the landscape: palette colour (vertex colours) broken up with large-scale
//                      variation, two-scale detail, triplanar rock on steep ground, a worn verge
//                      along the road and wet sand / foam at the shoreline
//   buildGrass()       instanced grass tufts and flowers near the road, in spatial chunks so the
//                      camera frustum culls them, swaying in the wind and shrinking away with distance
//   windify()          adds the same wind sway to tree foliage

/** Shared animation clock (TrackMap.update advances it). */
export const natureUniforms = { time: { value: 0 } };

const NOISE_GLSL = /* glsl */ `
  float nHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float nNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(nHash(i), nHash(i + vec2(1, 0)), u.x), mix(nHash(i + vec2(0, 1)), nHash(i + vec2(1, 1)), u.x), u.y);
  }
  float nFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * nNoise(p); p = p * 2.07 + 13.1; a *= 0.5; }
    return v;
  }
`;

/**
 * opts: { rock, verge, dry, dryAmount, vergeAmount, seaLevel }
 * The geometry needs an `edge` attribute: 1 at the road edge fading to 0 a few metres out.
 */
export function terrainMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ map: Textures.detail(), vertexColors: true, roughness: 0.96 });
  const rockTex = Textures.rock();
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      tRock: { value: rockTex },
      rockColor: { value: new THREE.Color(opts.rock ?? 0x8f8a82) },
      vergeColor: { value: new THREE.Color(opts.verge ?? 0x8a6c4c) },
      dryColor: { value: new THREE.Color(opts.dry ?? 0xa89a5a) },
      dryAmount: { value: opts.dryAmount ?? 0.45 },
      vergeAmount: { value: opts.vergeAmount ?? 0.7 },
      seaLevel: { value: opts.seaLevel ?? -1e5 },
      wetness: mat.userData.wetness,
      time: natureUniforms.time,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float edge;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying float vEdge;\nvarying vec2 vMacro;\n${NOISE_GLSL}`)
      .replace(
        '#include <worldpos_vertex>',
        // the large-scale noise changes over hundreds of metres: per vertex is plenty and keeps
        // the fragment shader cheap
        '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);\nvEdge = edge;\nvMacro = vec2(nFbm(vWP.xz * 0.0035), nNoise(vWP.xz * 0.012 + 7.0));',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tRock;
        uniform vec3 rockColor, vergeColor, dryColor;
        uniform float dryAmount, vergeAmount, seaLevel, wetness, time;
        varying vec3 vWP;
        varying vec3 vWN;
        varying float vEdge;
        varying vec2 vMacro;
        ${NOISE_GLSL}`,
      )
      .replace('#include <map_fragment>', '')
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        vec3 base = vec3(vColor);
        float macro = vMacro.x;
        float macro2 = vMacro.y;
        // large patches: lighter / darker, and drier straw-coloured areas
        base *= 0.78 + 0.44 * macro;
        base = mix(base, dryColor * (0.85 + 0.3 * macro), smoothstep(0.55, 0.85, macro2) * dryAmount);
        // two scales of neutral detail so the tiling never lines up
        float d1 = texture2D(map, vWP.xz / 6.0).r;
        float d2 = texture2D(map, vWP.xz / 29.0 + 0.37).r;
        float det = (d1 * 0.55 + d2 * 0.45) / 0.85;
        // worn verge: dirt and gravel along the road edge, ragged
        float verge = vEdge * smoothstep(0.3, 0.7, nNoise(vWP.xz * 0.3) * 0.6 + vEdge * 0.55);
        base = mix(base, vergeColor * (0.8 + 0.3 * d1), verge * vergeAmount);
        // rock on steep ground: triplanar so cliffs don't stretch
        float rockAmt = smoothstep(0.26, 0.4, 1.0 - vWN.y + (macro2 - 0.5) * 0.14);
        base *= det;
        if (rockAmt > 0.002) {
          vec3 an = abs(vWN);
          an /= an.x + an.y + an.z;
          vec3 rk = texture2D(tRock, vWP.zy / 11.0).rgb * an.x + texture2D(tRock, vWP.xz / 11.0).rgb * an.y + texture2D(tRock, vWP.xy / 11.0).rgb * an.z;
          base = mix(base, rockColor * rk * 2.3, rockAmt);
        }
        // shoreline: darker wet sand and a lapping line of foam
        if (seaLevel > -1e4) {
          float dy = vWP.y - seaLevel;
          base *= 1.0 - 0.38 * (1.0 - smoothstep(0.1, 1.8, dy));
          float wave = 0.18 + 0.14 * sin(time * 0.9 + vWP.x * 0.045 + vWP.z * 0.03);
          float foam = 1.0 - smoothstep(0.0, 0.35, abs(dy - wave));
          base = mix(base, vec3(0.92, 0.95, 0.96), foam * 0.7 * (0.6 + 0.4 * nNoise(vWP.xz * 0.8 + time * 0.3)));
        }
        // rain darkens soil a little
        base *= 1.0 - wetness * 0.18;
        diffuseColor.rgb *= base;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, rockAmt);\nroughnessFactor = mix(roughnessFactor, 0.5, wetness * 0.55);',
      );
  };
  mat.userData.wetness = { value: 0 };
  mat.customProgramCacheKey = () => 'terrain-v3';
  return mat;
}

/**
 * Wind sway for instanced foliage: vertices move in proportion to their height above the
 * instance origin, with a phase that varies across the map.
 */
export function windify(mat, strength = 0.05) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.time = natureUniforms.time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float time;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iPos = instanceMatrix[3].xyz;
      #else
        vec3 iPos = vec3(0.0);
      #endif
      float sway = sin(time * 1.3 + iPos.x * 0.07 + iPos.z * 0.05) + 0.4 * sin(time * 2.9 + iPos.z * 0.11);
      transformed.x += sway * ${strength.toFixed(3)} * max(0.0, transformed.y);
      transformed.z += sway * ${(strength * 0.6).toFixed(3)} * max(0.0, transformed.y);`,
    );
  };
  mat.customProgramCacheKey = () => `wind-${strength}`;
  return mat;
}

// ------------------------------------------------------------------------------- grass

const GRASS_DENSITY = { low: 0, medium: 0.55, high: 1 };
const FADE = { low: [0, 1], medium: [45, 70], high: [70, 105] };

/** A tuft: three crossed quads, origin at the base, uv.y = 0 at the root. */
function tuftGeometry(w, h) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(w, h, 1, 2).translate(0, h / 2, 0).rotateY((k / 3) * Math.PI);
    parts.push(g);
  }
  const geo = mergeSimple(parts);
  // all normals up: tufts take the light like the ground under them instead of flickering
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

function mergeSimple(geos) {
  const out = new THREE.BufferGeometry();
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [];
  let base = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array);
    nrm.push(...g.attributes.normal.array);
    uv.push(...g.attributes.uv.array);
    for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
    g.dispose();
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

function grassMaterial(tex, quality, sway) {
  const [f0, f1] = FADE[quality] ?? FADE.medium;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.time = natureUniforms.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float time;\nvarying float vGrassY;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 iPos = instanceMatrix[3].xyz;
        float sway = sin(time * 1.9 + iPos.x * 0.21 + iPos.z * 0.17) * 0.6 + sin(time * 3.7 + iPos.z * 0.4) * 0.25;
        transformed.x += sway * ${sway.toFixed(3)} * uv.y;
        transformed.z += sway * ${(sway * 0.7).toFixed(3)} * uv.y;
        // shrink into the ground with distance instead of popping out
        float camD = distance(cameraPosition.xz, iPos.xz);
        transformed *= 1.0 - smoothstep(${f0.toFixed(1)}, ${f1.toFixed(1)}, camD);
        vGrassY = uv.y;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGrassY;')
      // darker at the root, sun-bleached tips
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.55 + 0.6 * vGrassY;');
  };
  mat.customProgramCacheKey = () => `grass-${quality}-${sway}`;
  return mat;
}

/**
 * scenery.grass: { density (tufts per 100 m² near the road), color, colorVar, height, flowers,
 *                  flowerColors, reach (m from the road edge), dry (bool: sparse brown tufts) }
 * surfaceAt(x, z) must say 'grass' (or the map's terrain surface) for a tuft to grow there.
 */
export function buildGrass(track, layout, terrain, group, def, quality, surfaceAt, groundSurface) {
  const cfg = def.scenery?.grass;
  const q = GRASS_DENSITY[quality] ?? 0.55;
  if (!cfg || !q) return;
  const rand = mulberry32((def.terrain?.seed ?? 1) * 7 + 3);
  const patch = makeNoise2D((def.terrain?.seed ?? 1) + 41);
  const reach = cfg.reach ?? 38;
  const height = cfg.height ?? 0.55;
  const perSample = (cfg.density ?? 3) * q * (track.step * reach * 2) / 100;
  const cell = 90;
  const chunks = new Map();
  const flowerChunks = new Map();
  const base = new THREE.Color(cfg.color ?? 0x5f8a3a);
  const c = new THREE.Color();
  const flowerCols = (cfg.flowerColors ?? [0xf4f1e6, 0xf2cf3c, 0xb98fe0, 0xe86a6a]).map((h) => new THREE.Color(h));
  const add = (map, x, y, z, s, yaw, col) => {
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let list = map.get(key);
    if (!list) map.set(key, (list = []));
    list.push([x, y, z, s, yaw, col.r, col.g, col.b]);
  };
  const p = { x: 0, y: 0, z: 0 };
  const near = {};
  const minY = terrain.seaLevel !== null && terrain.seaLevel !== undefined ? terrain.seaLevel + 1.6 : -Infinity;
  for (let i = 0; i < track.count; i++) {
    let n = perSample * (0.6 + rand() * 0.8);
    while (n-- > rand()) {
      const sg = rand() < 0.5 ? -1 : 1;
      const side = sg < 0 ? 'L' : 'R';
      const edge = layout.style[side] === 'none' ? track.half[i] + 0.6 : layout.barrier[side][i] + 1.2;
      track.pointAt(i, sg * (edge + Math.pow(rand(), 1.35) * reach), p);
      const x = p.x + (rand() - 0.5) * track.step;
      const z = p.z + (rand() - 0.5) * track.step;
      // patchy: meadows and bare ground
      const pn = patch(x * 0.04, z * 0.04);
      if (pn < -0.35 + rand() * 0.2) continue;
      if (surfaceAt(x, z) !== groundSurface) continue;
      const qn = track.nearest(x, z, i, near, 2);
      if (qn.found && qn.dist < track.half[qn.index] + 0.8) continue;
      const y = terrain.heightAt(x, z);
      if (y < minY) continue;
      if (def.terrain?.snowLine !== undefined && y > def.terrain.snowLine + rand() * 20) continue;
      const v = cfg.colorVar ?? 0.18;
      c.copy(base).offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * v, (rand() - 0.5) * v + pn * 0.05);
      add(chunks, x, y - 0.05, z, (0.7 + rand() * 0.7) * (1 + pn * 0.25), rand() * Math.PI, c);
      if (cfg.flowers && rand() < cfg.flowers) add(flowerChunks, x + (rand() - 0.5) * 0.6, y - 0.02, z + (rand() - 0.5) * 0.6, 0.6 + rand() * 0.5, rand() * Math.PI, flowerCols[Math.floor(rand() * flowerCols.length)]);
    }
  }
  const build = (map, geo, mat) => {
    const m4 = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const list of map.values()) {
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, y, z, s, yaw, r, g, b], k) => {
        qt.setFromAxisAngle(up, yaw);
        m4.compose(v.set(x, y, z), qt, sc.set(s, s * (0.8 + (k % 5) * 0.1), s));
        inst.setMatrixAt(k, m4);
        inst.setColorAt(k, c.setRGB(r, g, b));
      });
      inst.computeBoundingSphere();
      inst.receiveShadow = true;
      group.add(inst);
    }
  };
  build(chunks, tuftGeometry(cfg.dry ? 0.7 : 0.95, cfg.dry ? height * 0.8 : height), grassMaterial(cfg.dry ? Textures.dryTuft() : Textures.tuft(), quality, 0.09));
  if (flowerChunks.size) build(flowerChunks, tuftGeometry(0.5, height * 0.8), grassMaterial(Textures.flowers(), quality, 0.07));
}

// ------------------------------------------------------------------------------- road wear

/**
 * Adds wear to a road material (needs a `lat` attribute: -1 left edge … +1 right edge):
 *   kind 'circuit'  a rubbered-in darker band around the racing line, marbles near the edges
 *   kind 'road'     two darker wheel tracks per lane, dusty edges
 * plus repaired patches and tar-sealed cracks everywhere, and puddles when wet
 * (mat.userData.wetness.value, 0..1).
 */
export function roadWear(mat, kind = 'road') {
  mat.userData.wetness = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.wetness = mat.userData.wetness;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float lat;\nvarying float vLat;\nvarying vec3 vRP;\nvarying vec4 vRN;\n${NOISE_GLSL}`)
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvLat = lat;\nvRP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRN = vec4(nNoise(vRP.xz * 0.05), nFbm(vRP.xz * 0.018), nNoise(vRP.xz * 0.04 + 3.0), nFbm(vRP.xz * 0.09 + 11.0));',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float wetness;\nvarying float vLat;\nvarying vec3 vRP;\nvarying vec4 vRN;\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float a = abs(vLat);
        float wear;
        ${
          kind === 'circuit'
            ? 'wear = (1.0 - smoothstep(0.0, 0.75, a)) * 0.22 + smoothstep(0.82, 0.98, a) * -0.08;'
            : 'wear = (exp(-pow((a - 0.25) / 0.09, 2.0)) + exp(-pow((a - 0.75) / 0.09, 2.0))) * 0.16 - smoothstep(0.88, 1.0, a) * 0.1;'
        }
        wear *= 0.7 + 0.6 * vRN.x;
        // patches of newer / older asphalt
        float patchN = vRN.y;
        float shade = 1.0 - wear + (smoothstep(0.58, 0.62, patchN) - smoothstep(0.38, 0.42, patchN)) * 0.08;
        // tar-sealed cracks: thin dark ridges of a noise field
        float cr = abs(nNoise(vRP.xz * 0.35) - 0.5);
        shade -= (1.0 - smoothstep(0.0, 0.018, cr)) * 0.22 * smoothstep(0.45, 0.65, vRN.z);
        diffuseColor.rgb *= shade;
        float puddle = smoothstep(0.55, 0.7, vRN.w) * wetness;
        diffuseColor.rgb *= 1.0 - puddle * 0.35;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, puddle);',
      );
  };
  mat.customProgramCacheKey = () => `road2-${kind}`;
  return mat;
}

/**
 * Large-scale variation for flat-textured ground (run-off aprons, patches, flat maps): the same
 * patchy light / dark / dry breakup as the terrain, plus a second detail scale, so the strips
 * next to the road don't look like carpet.
 */
export function groundVariation(mat, { dry = 0xa89a5a, amount = 1 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.gvDry = { value: new THREE.Color(dry) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vGP;\nvarying vec2 vGN;\n${NOISE_GLSL}`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGN = vec2(nFbm(vGP.xz * 0.0035), nNoise(vGP.xz * 0.012 + 7.0));');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 gvDry;\nvarying vec3 vGP;\nvarying vec2 vGN;`)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        float gm = vGN.x;
        float gm2 = vGN.y;
        diffuseColor.rgb *= mix(1.0, 0.78 + 0.44 * gm, ${amount.toFixed(2)});
        diffuseColor.rgb = mix(diffuseColor.rgb, gvDry * (0.85 + 0.3 * gm), smoothstep(0.55, 0.85, gm2) * 0.35 * ${amount.toFixed(2)});
        #ifdef USE_MAP
          diffuseColor.rgb *= 0.75 + 0.5 * texture2D(map, vGP.xz / 27.0 + 0.4).r;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `ground-var2-${amount}`;
  return mat;
}

// ------------------------------------------------------------------------------- water

/**
 * Sea: glossy, with two layers of ripples drifting in different directions (normal map sampled
 * twice), a deeper blue looking down and a paler, more reflective surface at grazing angles.
 */
export function waterMaterial(color = 0x1d5a7a) {
  const normalMap = Textures.waterNormal();
  normalMap.repeat.set(220, 220);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.07, metalness: 0.15, normalMap, normalScale: new THREE.Vector2(0.3, 0.3) });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.time = natureUniforms.time;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float time;')
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        `vec2 wuv = vNormalMapUv;
          vec3 mapN = normalize(texture2D( normalMap, wuv + time * vec2(0.012, 0.007) ).xyz * 2.0 - 1.0
          + texture2D( normalMap, mat2(0.8, -0.6, 0.6, 0.8) * wuv * 1.63 + time * vec2(-0.009, 0.013) ).xyz * 2.0 - 1.0
          + texture2D( normalMap, mat2(0.28, 0.96, -0.96, 0.28) * wuv * 0.37 + time * vec2(0.004, -0.006) ).xyz * 2.0 - 1.0);`,
      )
      // paler toward the horizon (grazing view), deeper looking straight down
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat graze = 1.0 - abs(dot(normalize(vViewPosition), vec3(0.0, 0.0, 1.0)));\ndiffuseColor.rgb = mix(diffuseColor.rgb * 0.75, diffuseColor.rgb * 1.6 + vec3(0.02, 0.05, 0.06), pow(graze, 3.0));',
      );
  };
  mat.customProgramCacheKey = () => 'water-v1';
  return mat;
}
