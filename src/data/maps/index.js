// Map registry. Each map is a data file in this folder; see README "Adding a map".
//
// track.points   centreline control points [x, z, elevation, { width?, bank? }] in driving order
//                (write them by hand, or with the turtle / roundedLoop helpers in shapes.js)
// track.closed   false for point-to-point stages (start/finish lines are placed automatically)
// track          width, bankGain, runoff, barrier ('concrete' | 'armco' | 'snowbank' | 'none' or
//                { L, R }), kerbs, gravelRadius, lines ('edge' | 'highway' | 'centre' | 'none'),
//                surface, runoffSurface, tunnels [{ from, to }], patches [{ from, to, surface, lat }]
// ground         { type: 'flat', … } for arenas / cities; otherwise a terrain is generated:
// terrain        base ('idw' | 'mean' | 'island'), amplitude, palette, sides, sea, snowLine, …
// scenery        trees, rocks, grandstands, billboards, lamps, city, cones
// props          hand-placed objects (containers, hangars, houses, ramps, …)
// environment    time of day, sun azimuth, max sun elevation, default weather, fog, haze
import harrowPark from './harrow-park.js';
import alpinePass from './alpine-pass.js';
import coastalHighway from './coastal-highway.js';
import neonCity from './neon-city.js';
import desertCanyon from './desert-canyon.js';
import forestRally from './forest-rally.js';
import airportDrift from './airport-drift.js';
import touge from './touge.js';
import island from './island.js';
import iceLake from './ice-lake.js';

const provingGround = {
  id: 'proving_ground',
  name: 'Proving Ground',
  type: 'test',
  description: 'Flat test field with every surface type, a skidpad and jumps.',
  environment: { time: 13, azimuth: 210, maxElevation: 62, weather: 'clear', fog: { near: 300, far: 1800 } },
};

export const MAPS = [
  alpinePass,
  coastalHighway,
  neonCity,
  desertCanyon,
  forestRally,
  harrowPark,
  airportDrift,
  touge,
  island,
  iceLake,
  provingGround,
];

export function mapById(id) {
  return MAPS.find((m) => m.id === id) || harrowPark;
}
