import { islandHeight, seeded } from './shapes.js';

// Open-world free-roam island: a coastal ring road, a hilly interior you can drive anywhere on,
// a village, a lighthouse and jumps scattered inland.
const island = { radius: 1300, height: 95, center: [0, 0] };
const rand = seeded(99);

// ring road around the island, wobbling in and out and following the land's height
const points = [];
for (let k = 0; k < 28; k++) {
  const a = -Math.PI / 2 + (k / 28) * Math.PI * 2; // start at the north, drive anticlockwise
  const r = 880 + Math.sin(a * 3) * 60 + (rand() - 0.5) * 50;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  points.push([Math.round(x), Math.round(z), Math.round(islandHeight(x, z, island) * 10) / 10 + 0.5]);
}

const village = [];
for (let k = 0; k < 14; k++) {
  const a = 0.55 + (rand() - 0.5) * 0.25;
  const r = 1010 + rand() * 90;
  village.push({ type: 'house', x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: rand() * Math.PI, w: 7 + rand() * 4, d: 8 + rand() * 4, color: [0xf0e6d2, 0xe8d0b0, 0xd8e4ec, 0xf2d8d0][k % 4] });
}
const ramps = [];
for (let k = 0; k < 9; k++) {
  const a = rand() * Math.PI * 2;
  const r = 250 + rand() * 450;
  ramps.push({ type: 'ramp', x: Math.cos(a) * r, z: Math.sin(a) * r, yaw: rand() * Math.PI * 2, len: 9, h: 1.6 + rand(), w: 7 });
}

export default {
  id: 'island',
  name: 'Isla Verano',
  type: 'freeroam',
  freeRoam: true,
  description: 'Open-world island: a 5.6 km coastal ring road, hills you can drive anywhere on, ramps, a village and a lighthouse.',
  laps: 1,
  track: {
    width: 9,
    bankGain: 2,
    maxBank: 0.05,
    runoff: 3,
    kerbs: false,
    lines: 'highway',
    barrier: 'none',
    points,
  },
  grid: { slots: 6, spacing: 9, firstBack: 10 },
  terrain: { base: 'island', island, amplitude: 20, scale: 0.003, seed: 77, margin: 300, blend: 45, palette: 'island', sea: 0 },
  landmarks: [
    { type: 'umbrella', at: 0.6, spread: 0.008, count: 14, side: 1, offset: 26, jitter: 40 },
    { type: 'umbrella', at: 0.25, spread: 0.008, count: 10, side: -1, offset: 26, jitter: 40 },
    { type: 'boat', at: 0.1, spread: 0.1, count: 8, side: 1, offset: 120, jitter: 200, water: true },
    { type: 'boat', at: 0.15, spread: 0.1, count: 8, side: -1, offset: 120, jitter: 200, water: true },
  ],
  scenery: {
    grass: { density: 4, color: 0x5f9a3c, flowers: 0.06, flowerColors: [0xf07ab0, 0xf2cf3c, 0xf4f1e6] },
    trees: { count: 3200, kinds: { palm: 2, broad: 3, pine: 1 }, mode: 'area', clear: 8 },
    rocks: { count: 260, color: 0x8a8278, size: [1, 5], clear: 6 },
  },
  props: [...village, ...ramps, { type: 'lighthouse', x: -1160, z: -260 }],
  horizon: { near: 0x6f8f6a, far: 0x8aa0b4, height: 0.5, start: 0.72 },
  environment: { time: 12.5, azimuth: 190, maxElevation: 70, weather: 'clear', fog: { near: 600, far: 3400 } },
};
