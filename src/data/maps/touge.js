import { turtle } from './shapes.js';

// Japanese-style touge: a narrow downhill mountain road at night, tight hairpins between guardrails.
const path = turtle({ x: 0, z: 0, y: 260, heading: 0 }, [
  ['s', 120, -4],
  ['r', 60, 70, -4],
  ['l', 90, 50, -5],
  ['s', 110, -8],
  ['r', 165, 18, -4],
  ['s', 150, -12],
  ['l', 168, 17, -4],
  ['s', 90, -6],
  ['r', 50, 60, -4],
  ['l', 70, 45, -5],
  ['s', 130, -10],
  ['r', 170, 16, -4],
  ['s', 160, -12],
  ['l', 100, 35, -5],
  ['r', 80, 40, -5],
  ['s', 120, -9],
  ['l', 165, 18, -4],
  ['s', 140, -11],
  ['r', 60, 80, -5],
  ['s', 100, -6],
  ['l', 40, 120, -3],
  ['s', 260, -8],
]);

export default {
  id: 'mountain_touge',
  name: 'Kagero Descent',
  type: 'stage',
  description: 'A 2.1 km downhill mountain road at night. Seven-metre-wide asphalt, hairpins and guardrails.',
  track: {
    closed: false,
    width: 7,
    bankGain: 0,
    runoff: 1,
    kerbs: false,
    lines: 'centre',
    barrier: 'armco',
    points: path.points,
  },
  grid: { slots: 2, spacing: 9, firstBack: 10 },
  terrain: { base: 'idw', amplitude: 30, scale: 0.004, seed: 66, margin: 400, blend: 40, palette: 'forest' },
  landmarks: [
    { type: 'gate', at: 0.4, side: 1, offset: 9, yaw: Math.PI / 2 },
    { type: 'lantern', at: 0.375, spread: 0.006, count: 8, side: 1, offset: 3 },
    { type: 'lantern', at: 0.76, spread: 0.006, count: 6, side: -1, offset: 3 },
  ],
  scenery: {
    grass: { density: 4.5, color: 0x557f36, flowers: 0.02 },
    trees: { count: 2800, kinds: { cedar: 3, pine: 2, broad: 1 }, clear: 4 },
    lamps: { spacing: 60, side: 'both', color: 0xd8e4ff },
  },
  horizon: { near: 0x2a3a2e, far: 0x4a5666, height: 1.6 },
  maxOffTrack: 25,
  environment: { time: 22.2, azimuth: 140, maxElevation: 55, weather: 'clear', fog: { near: 200, far: 1700 } },
};
