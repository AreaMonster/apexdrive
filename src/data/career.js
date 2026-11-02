// Career: championships of several events. Finishing a championship in the top 3 unlocks the
// next one(s); winning pays a bonus. Each event can force time of day and weather.
//
//   class      the car class you must enter with (you choose which of your cars)
//   difficulty easy | medium | hard (AI skill)
//   opponents  AI cars per event (capped by the map's grid)
//   requires   championship ids that must be finished in the top 3 first
//   events     { map, laps, time?, weather? }  (stages are always one run)
export const CHAMPIONSHIPS = [
  {
    id: 'hatch_cup',
    name: 'Hatchback Cup',
    class: 'hatchback',
    difficulty: 'easy',
    opponents: 5,
    prize: 9000,
    requires: [],
    events: [
      { map: 'harrow_park', laps: 2 },
      { map: 'airport_drift', laps: 3, time: 13 },
      { map: 'coastal_highway' },
      { map: 'neon_city', laps: 2, weather: 'clear' },
    ],
  },
  {
    id: 'dirt_masters',
    name: 'Dirt Masters',
    class: 'offroad',
    difficulty: 'medium',
    opponents: 3,
    prize: 16000,
    requires: ['hatch_cup'],
    events: [
      { map: 'desert_canyon' },
      { map: 'forest_rally', weather: 'clear', time: 10 },
      { map: 'ice_lake', laps: 3 },
      { map: 'island', laps: 1 },
    ],
  },
  {
    id: 'sports_series',
    name: 'Sports Series',
    class: 'sports',
    difficulty: 'medium',
    opponents: 5,
    prize: 22000,
    requires: ['hatch_cup'],
    events: [
      { map: 'harrow_park', laps: 3 },
      { map: 'alpine_pass' },
      { map: 'mountain_touge', time: 17.7 },
      { map: 'neon_city', laps: 3 },
    ],
  },
  {
    id: 'night_riders',
    name: 'Night Riders',
    class: 'sports',
    difficulty: 'hard',
    opponents: 5,
    prize: 30000,
    requires: ['sports_series'],
    events: [
      { map: 'neon_city', laps: 3, time: 23, weather: 'rain' },
      { map: 'mountain_touge', time: 22.5 },
      { map: 'airport_drift', laps: 4, time: 22 },
      { map: 'coastal_highway', time: 21.5 },
    ],
  },
  {
    id: 'supercar_gp',
    name: 'Supercar Grand Prix',
    class: 'muscle',
    difficulty: 'hard',
    opponents: 7,
    prize: 60000,
    requires: ['sports_series', 'dirt_masters'],
    events: [
      { map: 'harrow_park', laps: 4 },
      { map: 'coastal_highway' },
      { map: 'neon_city', laps: 3, time: 21 },
      { map: 'island', laps: 1 },
      { map: 'alpine_pass', weather: 'snow' },
    ],
  },
];

export function championshipById(id) {
  return CHAMPIONSHIPS.find((c) => c.id === id) || null;
}
