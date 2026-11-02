// AI difficulty presets and (fictional) driver names.
//   pace        fraction of the car's grip used in corners (and of its braking)
//   mistake     chance per braking zone of an error (late brake, running wide, lifting)
//   aggression  chance of committing to a pass instead of sitting behind
//   upgrades    upgrade level given to AI cars in career events
export const DIFFICULTY = {
  easy: { label: 'Easy', pace: 0.84, brake: 0.78, mistake: 0.12, aggression: 0.35, upgrades: 0 },
  medium: { label: 'Medium', pace: 0.92, brake: 0.86, mistake: 0.05, aggression: 0.65, upgrades: 1 },
  hard: { label: 'Hard', pace: 0.985, brake: 0.93, mistake: 0.018, aggression: 0.9, upgrades: 2 },
};

export const DRIVER_NAMES = [
  'M. Okafor',
  'L. Vance',
  'S. Ibarra',
  'K. Lindqvist',
  'R. Takeda',
  'A. Moreau',
  'D. Kovač',
  'J. Castell',
  'T. Brandt',
  'E. Navarro',
  'H. Sato',
  'P. Duval',
];

/**
 * A driver's personality, derived from their name so the same rival behaves the same way in
 * every race of a championship. See AIDriver for what each trait does.
 */
export function personaFor(name) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  return { aggression: 0.65 + r() * 0.7, caution: 0.3 + r() * 0.45, consistency: 0.7 + r() * 0.6, defend: r() };
}
