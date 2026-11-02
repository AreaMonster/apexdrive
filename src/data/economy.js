// Credits, rewards and upgrade prices.

export const STARTING_CREDITS = 20000;
export const STARTER_CARS = ['auren_pip'];

// Upgrade prices per level (1..3), scaled by car class.
export const UPGRADE_COST = {
  engine: [3000, 6500, 13000],
  tires: [1500, 3200, 6500],
  brakes: [1200, 2600, 5200],
  weight: [2500, 5200, 10500],
};
export const CLASS_COST_FACTOR = { hatchback: 1, sports: 1.6, muscle: 2.6, offroad: 1.5 };
export const UPGRADE_LABELS = {
  engine: 'Engine',
  tires: 'Tyres',
  brakes: 'Brakes',
  weight: 'Weight reduction',
};

export function upgradeCost(car, part, level) {
  return Math.round((UPGRADE_COST[part][level - 1] * (CLASS_COST_FACTOR[car.class] ?? 1)) / 50) * 50;
}

// Race prize money: base × distance × difficulty × finishing position.
export const DIFFICULTY_PAY = { easy: 0.8, medium: 1, hard: 1.4 };
export const POSITION_PAY = [1, 0.7, 0.5, 0.35, 0.25, 0.2, 0.15, 0.1];

export function racePrize({ distanceKm, difficulty, position, career = false }) {
  const base = career ? 1200 : 700;
  const dist = Math.max(1, distanceKm / 2.5);
  const pos = POSITION_PAY[position - 1] ?? 0.08;
  return Math.round((base * dist * (DIFFICULTY_PAY[difficulty] ?? 1) * pos) / 10) * 10;
}

export function driftPrize(score) {
  return Math.round(Math.min(6000, score / 40) / 10) * 10;
}

export function timeTrialPrize(validLaps, newBest) {
  return validLaps * 150 + (newBest ? 600 : 0);
}

// Championship points by finishing position.
export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
