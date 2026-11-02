import { roundedLoop } from './shapes.js';

// Neon city night circuit: tight 90° street corners between walls, rain-soaked and lit by neon.
export default {
  id: 'neon_city',
  name: 'Neon Kowloon Loop',
  type: 'circuit',
  description: 'A 2.7 km street circuit through a downtown grid at night. Wet roads, concrete walls, neon everywhere.',
  laps: 3,
  track: {
    width: 13,
    bankGain: 0,
    runoff: 1.5,
    barrier: 'concrete',
    lines: 'edge',
    points: roundedLoop(
      [
        [0, 400],
        [0, -250],
        [160, -250],
        [160, -380],
        [460, -380],
        [460, -60],
        [320, -60],
        [320, 120],
        [480, 120],
        [480, 400],
      ],
      18,
    ),
  },
  grid: { slots: 12, spacing: 8, firstBack: 14 },
  ground: { type: 'flat', surface: 'asphalt', texture: 'asphalt', color: 0x6e7178, tile: 8, size: 3200, center: [240, 0], margin: 320 },
  scenery: {
    city: { cell: 44, minHeight: 14, maxHeight: 130, neon: 30 },
    lamps: { spacing: 34, side: 'both', color: 0xffd2a0 },
  },
  horizon: { near: 0x1a2030, far: 0x262c3a, height: 0.7 },
  environment: { time: 23, azimuth: 120, maxElevation: 55, weather: 'rain', fog: { near: 200, far: 1600 } },
};
