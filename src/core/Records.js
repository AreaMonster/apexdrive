// Personal bests and ghost laps, persisted in localStorage.
// Best times live in one small object; each ghost is stored under its own key so a full
// storage quota only costs ghosts (oldest first), never the times.

const TIMES_KEY = 'apexdrive.records.v1';
const GHOST_PREFIX = 'apexdrive.ghost.v1.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export class Records {
  constructor() {
    this.times = read(TIMES_KEY, {});
  }

  best(mapId, carId) {
    return this.times[mapId]?.[carId] || null;
  }

  saveBest(mapId, carId, record) {
    (this.times[mapId] ||= {})[carId] = { ...record, date: Date.now() };
    try {
      localStorage.setItem(TIMES_KEY, JSON.stringify(this.times));
    } catch {
      // storage unavailable: the record lives for this session only
    }
  }

  loadGhost(mapId, carId) {
    return read(GHOST_PREFIX + mapId + '.' + carId, null);
  }

  saveGhost(mapId, carId, data) {
    const key = GHOST_PREFIX + mapId + '.' + carId;
    const json = JSON.stringify(data);
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        localStorage.setItem(key, json);
        return true;
      } catch {
        if (!this._evictOldestGhost(key)) return false;
      }
    }
    return false;
  }

  _evictOldestGhost(keep) {
    let oldest = null;
    let oldestDate = Infinity;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(GHOST_PREFIX) || k === keep) continue;
        const d = read(k, null)?.date ?? 0;
        if (d < oldestDate) {
          oldestDate = d;
          oldest = k;
        }
      }
      if (oldest) localStorage.removeItem(oldest);
    } catch {
      return false;
    }
    return !!oldest;
  }
}
