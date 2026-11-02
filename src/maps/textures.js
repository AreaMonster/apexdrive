import * as THREE from 'three';

// Procedural canvas textures (no downloaded assets).

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function canvasTexture(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Per-pixel noise around a base colour plus soft blotches; tiles seamlessly because blotches
// are drawn wrapped across the edges.
function noisy(g, size, base, variance, blotches, seed) {
  const rand = rng(seed);
  const img = g.createImageData(size, size);
  const [r, gr, b] = base;
  for (let i = 0; i < size * size; i++) {
    const n = (rand() - 0.5) * variance;
    img.data[i * 4] = r + n;
    img.data[i * 4 + 1] = gr + n;
    img.data[i * 4 + 2] = b + n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (const [color, count, minR, maxR, alpha] of blotches) {
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const rad = minR + rand() * (maxR - minR);
      g.globalAlpha = alpha * (0.4 + rand() * 0.6);
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          g.beginPath();
          g.arc(x + ox, y + oy, rad, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
  g.globalAlpha = 1;
}

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) {
    const tex = make();
    tex.userData.shared = true; // never disposed with a map
    cache.set(key, tex);
  }
  return cache.get(key);
}

export const Textures = {
  asphalt: () =>
    cached('asphalt', () =>
      canvasTexture(512, (g, s) => noisy(g, s, [74, 76, 80], 34, [['#2c2d30', 120, 2, 10, 0.25], ['#8a8c90', 300, 0.5, 1.5, 0.5]], 11)),
    ),
  wet: () =>
    cached('wet', () =>
      canvasTexture(512, (g, s) => noisy(g, s, [40, 44, 50], 20, [['#1a1d22', 60, 10, 40, 0.35], ['#5d6570', 200, 0.5, 1.5, 0.4]], 12)),
    ),
  grass: () =>
    cached('grass', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [78, 110, 52], 40, [['#3d5c25', 60, 4, 16, 0.35], ['#8fa860', 80, 2, 8, 0.25]], 13)),
    ),
  dirt: () =>
    cached('dirt', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [140, 104, 70], 46, [['#6e4f33', 70, 3, 14, 0.35], ['#c4a17a', 120, 1, 3, 0.4]], 14)),
    ),
  snow: () =>
    cached('snow', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [232, 238, 245], 18, [['#c9d6e6', 50, 6, 20, 0.35], ['#ffffff', 80, 2, 8, 0.4]], 15)),
    ),
  ice: () =>
    cached('ice', () =>
      canvasTexture(512, (g, s) => {
        noisy(g, s, [176, 208, 226], 14, [['#e6f4ff', 40, 10, 50, 0.3], ['#8fb8d0', 30, 5, 30, 0.25]], 16);
        const rand = rng(99);
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 1;
        for (let i = 0; i < 40; i++) {
          let x = rand() * s;
          let y = rand() * s;
          g.beginPath();
          g.moveTo(x, y);
          for (let k = 0; k < 6; k++) {
            x += (rand() - 0.5) * 60;
            y += (rand() - 0.5) * 60;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      }),
    ),
  concrete: () =>
    cached('concrete', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [170, 168, 160], 26, [['#8d8b84', 40, 3, 12, 0.3]], 17)),
    ),
  // red/white kerb: one red and one white block per texture repeat along v
  kerb: () =>
    cached('kerb', () =>
      canvasTexture(64, (g, s) => {
        g.fillStyle = '#d42a20';
        g.fillRect(0, 0, s, s / 2);
        g.fillStyle = '#f2f2ee';
        g.fillRect(0, s / 2, s, s / 2);
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(0, s / 2 - 2, s, 4);
      }),
    ),
  // barrier wall: painted blue/white bands over concrete
  wall: () =>
    cached('wall', () =>
      canvasTexture(256, (g, s) => {
        noisy(g, s, [200, 200, 196], 18, [], 21);
        g.fillStyle = '#1f4fa8';
        g.fillRect(0, s * 0.18, s, s * 0.22);
        g.fillStyle = '#e8e8e4';
        g.fillRect(0, s * 0.4, s, s * 0.05);
        g.fillStyle = '#c8302a';
        g.fillRect(0, 0, s, s * 0.08);
      }),
    ),
  // grandstand crowd: rows of coloured specks
  crowd: () =>
    cached('crowd', () =>
      canvasTexture(256, (g, s) => {
        g.fillStyle = '#3a3f48';
        g.fillRect(0, 0, s, s);
        const rand = rng(31);
        const cols = ['#d33', '#36c', '#eee', '#fc3', '#3a6', '#222', '#e96', '#a5c'];
        for (let row = 0; row < 16; row++) {
          for (let k = 0; k < 40; k++) {
            if (rand() < 0.15) continue;
            g.fillStyle = cols[Math.floor(rand() * cols.length)];
            g.fillRect(k * 6.4 + rand() * 2, row * 16 + 4 + rand() * 3, 4, 7);
          }
        }
      }),
    ),
  checker: () =>
    cached('checker', () =>
      canvasTexture(64, (g, s) => {
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4';
            g.fillRect(i * 8, j * 8, 8, 8);
          }
        }
      }),
    ),
  garage: () =>
    cached('garage', () =>
      canvasTexture(256, (g, s) => {
        g.fillStyle = '#d8dade';
        g.fillRect(0, 0, s, s);
        g.fillStyle = '#4a5260';
        g.fillRect(s * 0.1, s * 0.3, s * 0.8, s * 0.7);
        g.strokeStyle = '#3a404c';
        for (let y = s * 0.3; y < s; y += 10) {
          g.beginPath();
          g.moveTo(s * 0.1, y);
          g.lineTo(s * 0.9, y);
          g.stroke();
        }
        g.fillStyle = '#c8302a';
        g.fillRect(0, 0, s, s * 0.12);
      }),
    ),
};

Object.assign(Textures, {
  sand: () =>
    cached('sand', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [214, 180, 132], 30, [['#b98c5c', 60, 4, 16, 0.3], ['#f0d6a8', 90, 2, 6, 0.35]], 18)),
    ),
  mud: () =>
    cached('mud', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [92, 70, 48], 30, [['#4a3624', 80, 4, 18, 0.4], ['#7a6a52', 60, 6, 20, 0.3]], 19)),
    ),
  // neutral grey detail: lets vertex colours carry the hue (terrain, run-off), so the same
  // texture serves grass, sand, rock and snow
  detail: () =>
    cached('detail', () =>
      canvasTexture(256, (g, s) => noisy(g, s, [222, 222, 222], 46, [['#a8a8a8', 70, 3, 14, 0.3], ['#ffffff', 90, 1, 5, 0.35]], 20)),
    ),
  // building facade: concrete with a window grid (colour map)…
  facade: () =>
    cached('facade', () =>
      canvasTexture(128, (g, s) => {
        noisy(g, s, [120, 124, 132], 16, [], 22);
        g.fillStyle = '#22262e';
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.fillRect(x * 32 + 6, y * 32 + 8, 20, 18);
      }),
    ),
  // …and the matching emissive map: a random subset of windows lit in warm/cool tones
  windows: () =>
    cached('windows', () =>
      canvasTexture(128, (g, s) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, s, s);
        const rand = rng(23);
        const lit = ['#ffd890', '#ffe9c0', '#bfe4ff', '#ffc070'];
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            if (rand() < 0.45) continue;
            g.fillStyle = lit[Math.floor(rand() * lit.length)];
            g.fillRect(x * 32 + 6, y * 32 + 8, 20, 18);
          }
        }
      }),
    ),
  // soft radial glow, used for street-light pools and neon reflections on the road
  glow: () =>
    cached('glow', () =>
      canvasTexture(
        128,
        (g, s) => {
          const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
          grd.addColorStop(0, 'rgba(255,255,255,1)');
          grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
          grd.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grd;
          g.fillRect(0, 0, s, s);
        },
        { srgb: false },
      ),
    ),
});

/** Glowing neon-tube text on transparent black (use with additive / basic materials). */
export function neonTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, 512, 128);
  g.font = 'bold 76px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText(text, 256, 68);
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.55;
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Fictional shop / bar names for neon signs.
export const NEON = [
  ['NOVA', '#ff3fb4'],
  ['KAIRO BAR', '#3fe6ff'],
  ['PIXEL HOUSE', '#ffe23f'],
  ['LUMA', '#a46bff'],
  ['HOTEL ORBIT', '#ff6a3f'],
  ['NOODLES 24', '#3fff8c'],
  ['ZEPHYR', '#3f8cff'],
  ['VOLT', '#ff3f5a'],
  ['ECHO CLUB', '#ff9a3f'],
  ['MIRAGE', '#3fffe0'],
];

// Fictional sponsor names for trackside boards.
export const SPONSORS = [
  ['VELTRA OIL', '#0d3b8c', '#ffd23f'],
  ['NORDLINE', '#111111', '#ffffff'],
  ['KESSLER TYRES', '#ffcc00', '#111111'],
  ['ARCLIGHT', '#c8102e', '#ffffff'],
  ['MERIDIAN FUEL', '#00843d', '#ffffff'],
  ['POLAR ENERGY', '#ffffff', '#1a5fb4'],
  ['TORVEX', '#2b2b2b', '#ff7a00'],
  ['BRISK COLA', '#e4002b', '#ffffff'],
];

/** A white canvas texture with big black text, used for distance boards. */
export function labelTexture(text, { bg = '#f4f4f0', fg = '#111', width = 256, height = 128 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(height * 0.7)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, width / 2, height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------ nature (maps/Nature.js)

/** Draw grass blades (tapered, slightly curved) bottom-up into a transparent canvas. */
function blades(g, s, { count, colors, seed, maxH = 0.95, width = 0.035 }) {
  const rand = rng(seed);
  for (let k = 0; k < count; k++) {
    const x = s * (0.08 + rand() * 0.84);
    const h = s * (0.45 + rand() * (maxH - 0.45));
    const w = s * width * (0.6 + rand() * 0.8);
    const lean = (rand() - 0.5) * s * 0.35;
    g.fillStyle = colors[Math.floor(rand() * colors.length)];
    g.beginPath();
    g.moveTo(x - w, s);
    g.quadraticCurveTo(x - w * 0.5 + lean * 0.3, s - h * 0.55, x + lean, s - h);
    g.quadraticCurveTo(x + w * 0.5 + lean * 0.3, s - h * 0.55, x + w, s);
    g.closePath();
    g.fill();
  }
}

Object.assign(Textures, {
  // layered rock: grey noise with darker strata and cracks (tinted per map in the shader)
  rock: () =>
    cached('rock', () =>
      canvasTexture(256, (g, s) => {
        noisy(g, s, [150, 148, 144], 40, [['#6f6c68', 50, 4, 18, 0.3], ['#c9c6c0', 40, 3, 10, 0.3]], 51);
        const rand = rng(52);
        for (let k = 0; k < 18; k++) {
          const y = rand() * s;
          g.fillStyle = `rgba(60,58,55,${0.15 + rand() * 0.25})`;
          g.fillRect(0, y, s, 1 + rand() * 4);
        }
        g.strokeStyle = 'rgba(40,38,36,0.5)';
        for (let k = 0; k < 14; k++) {
          let x = rand() * s;
          let y = rand() * s;
          g.beginPath();
          g.moveTo(x, y);
          for (let j = 0; j < 5; j++) {
            x += (rand() - 0.5) * 30;
            y += rand() * 25;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      }),
    ),
  // grass tuft: near-white blades so instance colours carry the hue
  tuft: () =>
    cached('tuft', () =>
      canvasTexture(128, (g, s) => blades(g, s, { count: 46, colors: ['#e8f0dc', '#d6e2c4', '#f4f8ec', '#c4d4ae'], seed: 61 })),
    ),
  dryTuft: () =>
    cached('dryTuft', () =>
      canvasTexture(128, (g, s) => blades(g, s, { count: 30, colors: ['#e9dcc0', '#d8c49c', '#f2e8d2'], seed: 62, maxH: 0.75, width: 0.025 })),
    ),
  // a few stems with blossoms (the instance colour tints the whole sprite: blossoms are drawn
  // white so they take the flower colour, stems dark so they stay green-grey)
  flowers: () =>
    cached('flowers', () =>
      canvasTexture(128, (g, s) => {
        blades(g, s, { count: 8, colors: ['#5c6e48'], seed: 63, maxH: 0.7, width: 0.012 });
        const rand = rng(64);
        for (let k = 0; k < 9; k++) {
          const x = s * (0.15 + rand() * 0.7);
          const y = s * (0.3 + rand() * 0.35);
          g.fillStyle = '#ffffff';
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2;
            g.beginPath();
            g.arc(x + Math.cos(a) * 4, y + Math.sin(a) * 4, 3.4, 0, Math.PI * 2);
            g.fill();
          }
          g.fillStyle = '#f0c040';
          g.beginPath();
          g.arc(x, y, 2.4, 0, Math.PI * 2);
          g.fill();
        }
      }),
    ),
});

Object.assign(Textures, {
  // black chevrons on yellow, pointing right (mirrored for left-handers)
  chevron: () =>
    cached('chevron', () =>
      canvasTexture(128, (g, s) => {
        g.fillStyle = '#f2c81e';
        g.fillRect(0, 0, s, s);
        g.fillStyle = '#141414';
        for (const x0 of [10, 52]) {
          g.beginPath();
          g.moveTo(x0, 20);
          g.lineTo(x0 + 26, 20);
          g.lineTo(x0 + 56, 64);
          g.lineTo(x0 + 26, 108);
          g.lineTo(x0, 108);
          g.lineTo(x0 + 30, 64);
          g.closePath();
          g.fill();
        }
      }),
    ),
  straw: () =>
    cached('straw', () =>
      canvasTexture(128, (g, s) => {
        noisy(g, s, [206, 176, 102], 50, [['#a8873e', 40, 2, 8, 0.4]], 71);
        g.strokeStyle = 'rgba(120,90,40,0.5)';
        for (let y = 4; y < s; y += 9) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(s, y + 3);
          g.stroke();
        }
      }),
    ),
  // diamond wire mesh with a top and bottom rail, transparent between the wires
  fence: () =>
    cached('fence', () =>
      canvasTexture(128, (g, s) => {
        g.clearRect(0, 0, s, s);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2;
        for (let k = -s; k < s * 2; k += 16) {
          g.beginPath();
          g.moveTo(k, 0);
          g.lineTo(k + s, s);
          g.moveTo(k + s, 0);
          g.lineTo(k, s);
          g.stroke();
        }
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, s, 5);
        g.fillRect(0, s - 5, s, 5);
        g.fillRect(0, 0, 5, s);
      }),
    ),
});

Object.assign(Textures, {
  // log wall: horizontal logs with dark gaps
  logs: () =>
    cached('logs', () =>
      canvasTexture(128, (g, s) => {
        noisy(g, s, [150, 112, 74], 30, [['#7a5636', 30, 2, 10, 0.4]], 81);
        for (let y = 0; y < s; y += 16) {
          const grd = g.createLinearGradient(0, y, 0, y + 16);
          grd.addColorStop(0, 'rgba(0,0,0,0.45)');
          grd.addColorStop(0.25, 'rgba(0,0,0,0)');
          grd.addColorStop(0.8, 'rgba(0,0,0,0.1)');
          grd.addColorStop(1, 'rgba(0,0,0,0.5)');
          g.fillStyle = grd;
          g.fillRect(0, y, s, 16);
        }
      }),
    ),
  // tangent-space normal map of soft ripples, from summed sine waves (tiles exactly)
  waterNormal: () =>
    cached('waterNormal', () => {
      const s = 128;
      const tex = canvasTexture(
        s,
        (g) => {
          const img = g.createImageData(s, s);
          const waves = [[3, 1, 0.5], [1, 4, 1.7], [5, -2, 2.9], [-2, 3, 4.1], [7, 5, 0.3]];
          for (let y = 0; y < s; y++) {
            for (let x = 0; x < s; x++) {
              let dx = 0;
              let dy = 0;
              for (const [kx, ky, ph] of waves) {
                const a = ((kx * x + ky * y) / s) * Math.PI * 2 + ph;
                const amp = 1 / Math.hypot(kx, ky);
                dx += Math.cos(a) * kx * amp;
                dy += Math.cos(a) * ky * amp;
              }
              const o = (y * s + x) * 4;
              img.data[o] = 128 + dx * 22;
              img.data[o + 1] = 128 + dy * 22;
              img.data[o + 2] = 255;
              img.data[o + 3] = 255;
            }
          }
          g.putImageData(img, 0, 0);
        },
        { srgb: false },
      );
      return tex;
    }),
});
