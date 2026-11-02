import { turtle } from './shapes.js';

// Alpine mountain pass: a climbing stage with stacked hairpins, a tunnel and snow near the top.
const path = turtle({ x: 0, z: 0, y: 40, heading: 0 }, [
  ['s', 160, 4],
  ['r', 30, 160, 3],
  ['s', 180, 9],
  ['l', 70, 90, 6],
  ['s', 140, 9],
  // switchbacks up the face: each 175° hairpin stacks the next leg ~48 m higher up the slope
  ['r', 175, 24, 4],
  ['s', 200, 15],
  ['l', 175, 24, 4],
  ['s', 210, 16],
  ['r', 175, 22, 4],
  ['s', 190, 15],
  ['l', 172, 24, 4],
  ['s', 120, 8],
  ['r', 60, 120, 5],
  ['mark', 'tunnelIn'],
  ['s', 240, 14],
  ['mark', 'tunnelOut'],
  ['l', 45, 150, 4],
  ['s', 160, 9],
  ['r', 85, 70, 5],
  ['mark', 'snow'],
  ['s', 200, 8],
  ['l', 50, 120, 4],
  ['s', 260, 6],
]);
const m = path.marks;

export default {
  id: 'alpine_pass',
  name: 'Col du Grisard',
  type: 'stage',
  description: 'A 3 km climb up an alpine pass: stacked hairpins, a rock tunnel and snow patches near the summit.',
  track: {
    closed: false,
    width: 8.5,
    bankGain: 2,
    maxBank: 0.05,
    runoff: 1.5,
    kerbs: false,
    lines: 'highway',
    barrier: 'armco',
    points: path.points,
    tunnels: [{ from: m.tunnelIn + 10, to: m.tunnelOut - 10 }],
    patches: [
      { from: m.snow + 20, to: m.snow + 90, surface: 'snow', lat: [-1, 0.15] },
      { from: m.snow + 150, to: m.snow + 210, surface: 'snow', lat: [-0.3, 1] },
      { from: m.snow + 330, to: m.snow + 420, surface: 'snow', lat: [-1, -0.1] },
    ],
  },
  grid: { slots: 4, spacing: 9, firstBack: 10 },
  terrain: { base: 'idw', amplitude: 32, scale: 0.004, seed: 21, margin: 500, blend: 45, palette: 'alpine', snowLine: 150 },
  landmarks: [
    { type: 'chapel', at: 0.2, side: 1, offset: 24 },
    { type: 'radiomast', at: 0.82, side: -1, offset: 110 },
  ],
  scenery: {
    grass: { density: 5, color: 0x6a9440, flowers: 0.1, flowerColors: [0xf4f1e6, 0xf2cf3c, 0xb98fe0, 0x7aa0e8] },
    trees: { count: 2400, kinds: { pine: 3, snowpine: 2, bush: 1 }, clear: 6 },
    rocks: { count: 320, color: 0x8a8680, size: [1, 5], clear: 4 },
  },
  horizon: { near: 0xa7b4bd, far: 0xdfe7ef, height: 1.8 },
  maxOffTrack: 30,
  environment: { time: 11.5, azimuth: 200, maxElevation: 50, weather: 'clear', fog: { near: 450, far: 2600 }, haze: 0xdfe9f4, hazeAmount: 0.25 },
};
