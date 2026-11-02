import { roundedLoop, seeded } from './shapes.js';

// Winter lake ice track: groomed ice between snowbanks on a frozen lake. Low grip, long slides.
const rand = seeded(12);
const huts = [];
for (let k = 0; k < 10; k++) {
  huts.push({ type: 'hut', x: -200 + rand() * 700, z: 380 + rand() * 120, yaw: rand() * Math.PI, color: [0xa33a2a, 0x2a5aa3, 0xd9a23a][k % 3] });
}

export default {
  id: 'ice_lake',
  name: 'Lake Vintermark',
  type: 'circuit',
  description: 'A 1.5 km ice-racing circuit ploughed into a frozen lake. Snowbanks catch you; grip is a rumour.',
  laps: 3,
  track: {
    width: 12,
    bankGain: 0,
    runoff: 1.5,
    kerbs: false,
    lines: 'none',
    barrier: 'snowbank',
    surface: 'lakeice',
    runoffSurface: 'snow',
    points: roundedLoop(
      [
        [0, 200],
        [0, -150],
        [60, -220],
        [150, -180],
        [130, -70],
        [230, -10],
        [340, -70],
        [390, 40],
        [300, 170],
        [160, 175],
        [90, 260],
        [20, 275],
      ],
      30,
    ),
  },
  grid: { slots: 8, spacing: 9, firstBack: 14 },
  ground: { type: 'flat', surface: 'snow', texture: 'ice', color: 0xdfeaf2, tile: 14, roughness: 0.3, size: 3200, center: [190, 25], margin: 420 },
  landmarks: [
    { type: 'cabin', at: 0.3, side: 1, offset: 70 },
    { type: 'cabin', at: 0.34, side: 1, offset: 85, yaw: 0.8 },
    { type: 'radiomast', at: 0.7, side: -1, offset: 300 },
  ],
  scenery: { trees: { count: 1600, kinds: { snowpine: 4, dead: 1 }, mode: 'area', clear: 170 } },
  props: huts,
  horizon: { near: 0xd8e0e8, far: 0xc0cad6, height: 1 },
  environment: { time: 10.5, azimuth: 160, maxElevation: 22, weather: 'clear', fog: { near: 400, far: 2400 }, haze: 0xdde6f0, hazeAmount: 0.3 },
};
