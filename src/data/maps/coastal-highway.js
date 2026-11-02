import { turtle } from './shapes.js';

// Coastal highway: a fast two-lane sprint along cliff tops, sea on the left, sunset over the water.
const path = turtle({ x: 0, z: 0, y: 32, heading: 0 }, [
  ['s', 260, 2],
  ['r', 28, 320, 3],
  ['s', 180, 4],
  ['l', 45, 260, -3],
  ['s', 200, 6],
  ['r', 55, 220, 2],
  ['l', 75, 190, -6],
  ['s', 260, 5],
  ['r', 30, 420, 3],
  ['l', 40, 240, 8],
  ['mark', 'gallery'],
  ['s', 170, 2],
  ['mark', 'galleryEnd'],
  ['r', 65, 170, -8],
  ['l', 35, 320, -3],
  ['s', 320, -6],
  ['r', 25, 500, 0],
  ['s', 260, 0],
]);

export default {
  id: 'coastal_highway',
  name: 'Costa Brava Run',
  type: 'stage',
  description: 'A 3.5 km cliff-top highway sprint. Fast sweepers, a rock gallery and the sun setting over the sea.',
  track: {
    closed: false,
    width: 11,
    bankGain: 4,
    maxBank: 0.06,
    runoff: 1.2,
    kerbs: false,
    lines: 'highway',
    barrier: 'armco',
    points: path.points,
    tunnels: [{ from: path.marks.gallery + 10, to: path.marks.galleryEnd - 10 }],
  },
  grid: { slots: 6, spacing: 9, firstBack: 10 },
  terrain: {
    base: 'idw',
    amplitude: 14,
    scale: 0.0035,
    seed: 33,
    margin: 450,
    blend: 40,
    palette: 'coast',
    sea: 0,
    // cliffs: the seaward (left) side falls away, the landward side climbs into hills
    sides: { L: { height: -85, start: 16, width: 50 }, R: { height: 60, start: 22, width: 90 } },
  },
  landmarks: [
    { type: 'turbine', at: 0.12, spread: 0.06, count: 7, side: -1, offset: 150, jitter: 80 },
    { type: 'turbine', at: 0.15, spread: 0.06, count: 7, side: 1, offset: 150, jitter: 80 },
    { type: 'boat', at: 0.2, spread: 0.07, count: 8, side: 1, offset: 90, jitter: 160, water: true },
    { type: 'boat', at: 0.25, spread: 0.07, count: 8, side: -1, offset: 90, jitter: 160, water: true },
  ],
  scenery: {
    grass: { density: 3.5, color: 0x7a9a48, flowers: 0.04, flowerColors: [0xf2cf3c, 0xf4f1e6, 0xe86a6a] },
    trees: { count: 1700, kinds: { broad: 2, palm: 2, pine: 1 }, clear: 10 },
    rocks: { count: 260, color: 0x8c8070, size: [1, 6], clear: 6 },
  },
  horizon: { near: 0x6c7f72, far: 0x9aa4b6, height: 0.6, start: 0.85 },
  maxOffTrack: 30,
  environment: { time: 17.6, azimuth: 186, maxElevation: 55, weather: 'clear', fog: { near: 500, far: 2800 }, haze: 0xff9a5a, hazeAmount: 0.45 },
};
