// Weather presets.
//   grip       tyre grip multiplier per surface (missing surfaces use `default`). Rain hurts sealed
//              surfaces most; snow buries asphalt; loose surfaces change less.
//   overcast   0..1 cloud cover: greys the sky, dims the sun, softens shadows
//   fog        fog distances (m); `null` keeps the map's own haze
//   particles  'rain' | 'snow' | null
//   wetness    0..1 visual: darker, glossier road
//   snowCover  0..1 visual: whitens ground and foliage
export const WEATHER = {
  clear: { label: 'Clear', grip: { default: 1 }, overcast: 0, fog: null, particles: null, wetness: 0, snowCover: 0 },
  rain: {
    label: 'Rain',
    grip: { default: 0.85, asphalt: 0.74, kerb: 0.68, wet: 0.95, grass: 0.8, dirt: 0.86, gravel: 0.9, mud: 0.95, snow: 1, ice: 0.95 },
    overcast: 0.85,
    fog: { near: 60, far: 650 },
    particles: 'rain',
    wetness: 1,
    snowCover: 0,
  },
  fog: {
    label: 'Fog',
    grip: { default: 0.97, asphalt: 0.93, kerb: 0.9 },
    overcast: 0.7,
    fog: { near: 8, far: 190 },
    particles: null,
    wetness: 0.35,
    snowCover: 0,
  },
  snow: {
    label: 'Snow',
    grip: { default: 0.8, asphalt: 0.58, kerb: 0.55, wet: 0.55, grass: 0.75, dirt: 0.78, gravel: 0.82, snow: 0.95, ice: 0.92 },
    overcast: 0.8,
    fog: { near: 40, far: 480 },
    particles: 'snow',
    wetness: 0.2,
    snowCover: 1,
  },
};

export const WEATHER_ORDER = ['clear', 'rain', 'fog', 'snow'];

// Time-of-day presets the player can cycle through; 'cycle' runs a full day in a few minutes.
export const TIME_PRESETS = [
  { id: 'map', label: 'Map default' },
  { id: 'dawn', label: 'Dawn', time: 6.25 },
  { id: 'day', label: 'Midday', time: 13 },
  { id: 'sunset', label: 'Sunset', time: 17.7 },
  { id: 'night', label: 'Night', time: 22.5 },
  { id: 'cycle', label: 'Day/night cycle' },
];
