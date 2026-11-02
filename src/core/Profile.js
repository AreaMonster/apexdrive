import { STARTING_CREDITS, STARTER_CARS, upgradeCost } from '../data/economy.js';
import { CHAMPIONSHIPS } from '../data/career.js';
import { carById } from '../data/cars.js';
import { MAX_UPGRADE_LEVEL } from '../cars/CarSpec.js';

const KEY = 'apexdrive.profile.v1';

function fresh() {
  return {
    credits: STARTING_CREDITS,
    garage: Object.fromEntries(STARTER_CARS.map((id) => [id, { upgrades: { engine: 0, tires: 0, brakes: 0, weight: 0 }, color: 0 }])),
    career: {}, // champId → { best, current: { event, points: { racerId: pts }, roster } }
    stats: { races: 0, wins: 0, podiums: 0, earned: 0 },
  };
}

/** Player progress: credits, owned cars with their upgrades and paint, career state. */
export class Profile {
  constructor() {
    this.data = fresh();
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (raw && raw.garage) this.data = { ...fresh(), ...raw, stats: { ...fresh().stats, ...raw.stats } };
    } catch {
      // corrupt or blocked storage: start fresh
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // storage unavailable: progress lasts for this session only
    }
  }

  reset() {
    this.data = fresh();
    this.save();
  }

  get credits() {
    return this.data.credits;
  }

  owns(carId) {
    return !!this.data.garage[carId];
  }

  ownedCars() {
    return Object.keys(this.data.garage);
  }

  upgrades(carId) {
    return this.data.garage[carId]?.upgrades ?? { engine: 0, tires: 0, brakes: 0, weight: 0 };
  }

  color(carId) {
    return this.data.garage[carId]?.color ?? 0;
  }

  setColor(carId, i) {
    if (!this.owns(carId)) return;
    this.data.garage[carId].color = i;
    this.save();
  }

  earn(amount) {
    this.data.credits += amount;
    this.data.stats.earned += amount;
    this.save();
  }

  /** Returns true if bought. */
  buy(carId) {
    const car = carById(carId);
    if (this.owns(carId) || this.data.credits < car.price) return false;
    this.data.credits -= car.price;
    this.data.garage[carId] = { upgrades: { engine: 0, tires: 0, brakes: 0, weight: 0 }, color: 0 };
    this.save();
    return true;
  }

  /** Cost of the next level of a part, or null when maxed. */
  nextUpgradeCost(carId, part) {
    const lvl = this.upgrades(carId)[part];
    if (lvl >= MAX_UPGRADE_LEVEL) return null;
    return upgradeCost(carById(carId), part, lvl + 1);
  }

  upgrade(carId, part) {
    const cost = this.nextUpgradeCost(carId, part);
    if (cost === null || !this.owns(carId) || this.data.credits < cost) return false;
    this.data.credits -= cost;
    this.data.garage[carId].upgrades[part]++;
    this.save();
    return true;
  }

  recordRace(position) {
    const s = this.data.stats;
    s.races++;
    if (position === 1) s.wins++;
    if (position <= 3) s.podiums++;
    this.save();
  }

  // ------------------------------------------------------------- career

  champState(id) {
    return this.data.career[id] || null;
  }

  isUnlocked(champ) {
    return champ.requires.every((r) => (this.data.career[r]?.best ?? 99) <= 3);
  }

  startChampionship(champ, roster) {
    this.data.career[champ.id] = { ...(this.data.career[champ.id] || {}), current: { event: 0, points: {}, roster } };
    this.save();
  }

  /** Add an event's results (ordered racer ids) and advance; returns the updated state. */
  completeEvent(champ, order, pointsTable) {
    const st = this.data.career[champ.id];
    const cur = st.current;
    order.forEach((id, k) => {
      cur.points[id] = (cur.points[id] ?? 0) + (pointsTable[k] ?? 0);
    });
    cur.event++;
    if (cur.event >= champ.events.length) {
      const standings = this.standings(champ);
      const pos = standings.findIndex((r) => r.id === 'player') + 1;
      st.best = Math.min(st.best ?? 99, pos);
      st.lastResult = { position: pos, standings };
      st.current = null;
    }
    this.save();
    return st;
  }

  standings(champ) {
    const cur = this.data.career[champ.id]?.current;
    const pts = cur?.points ?? {};
    const roster = cur?.roster ?? [];
    return roster
      .map((r) => ({ ...r, points: pts[r.id] ?? 0 }))
      .sort((a, b) => b.points - a.points);
  }
}

export { CHAMPIONSHIPS };
