// Dev-only helpers for driving the game from the browser console / automated checks:
//   const h = await import('/tools/browser-helpers.js');
//   await h.race({ mapId: 'harrow_park', carId: 'auren_pip', laps: 2 }, 40);
// Not imported by the game itself.
import { AIDriver } from '/src/ai/AIDriver.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = () => window.__game;

/** Start an event and let an AI drive the player's car; record impacts and AI resets. */
export async function start(cfg) {
  const g = game();
  await g.startEvent({ mode: 'race', laps: 2, opponents: 5, difficulty: 'medium', timePreset: 'map', ...cfg });
  const m = g.mode;
  const line = m.line ?? new (await import('/src/ai/RacingLine.js')).RacingLine(g.map.track);
  m.playerAutopilot = new AIDriver({ vehicle: g.vehicle, map: g.map, line, difficulty: cfg.difficulty ?? 'medium', weatherGrip: g.env.weather.grip });
  const log = { hits: [], resets: {} };
  for (const r of m.racers ?? [{ vehicle: g.vehicle, name: 'You' }]) {
    const v = r.vehicle;
    const prev = v.onImpact;
    v.onImpact = (imp) => {
      prev?.(imp);
      const q = g.map.track.nearest(v.pos.x, v.pos.z);
      const near = (m.racers ?? []).filter((o) => o !== r && o.vehicle.pos.distanceTo(v.pos) < 7).map((o) => o.name);
      log.hits.push(`${r.name} s=${q.s.toFixed(0)} lat=${q.lateral.toFixed(1)} dv=${imp.dv.toFixed(1)} near=[${near}]`);
    };
    if (r.driver) {
      const d = r.driver;
      const f = d.reset.bind(d);
      d.reset = () => {
        log.resets[r.name] = (log.resets[r.name] || 0) + 1;
        f();
      };
    }
  }
  window.__log = log;
  return log;
}

export function status() {
  const g = game();
  const m = g.mode;
  if (!m) return { state: g.state };
  return {
    state: g.state,
    fps: Math.round(g.hud.fps),
    physMs: +g.physicsMs.toFixed(2),
    positions: m.order?.map((r) => `${r.position}.${r.name} (${r.carName}) lap ${r.timer.lap} ${r.timer.progress.toFixed(0)} m dmg ${r.vehicle.damageTotal.toFixed(2)}${r.finishTime ? ` fin ${r.finishTime.toFixed(1)}` : ''}`),
    hits: window.__log?.hits.slice(-12),
    resets: window.__log?.resets,
  };
}

export async function race(cfg, seconds) {
  await start(cfg);
  await sleep(seconds * 1000);
  return status();
}

export { sleep };

/**
 * Start an event with the player on autopilot, simulate `sec` seconds synchronously (works even
 * when the tab is in the background) and render one frame, for screenshots / perf checks.
 * opts: { mode, car, opp, time, weather, sec, cam }
 */
export async function shot(mapId, opts = {}) {
  const g = game();
  await g.startEvent({ mode: opts.mode ?? 'race', mapId, carId: opts.car ?? 'vantor_strada', laps: 2, opponents: opts.opp ?? 3, timePreset: opts.time ?? 'map', weather: opts.weather ?? 'map', difficulty: 'medium' });
  g.menu.hide();
  g.paused = false;
  const line = g.mode.line ?? new (await import('/src/ai/RacingLine.js')).RacingLine(g.map.track);
  g.mode.playerAutopilot = new AIDriver({ vehicle: g.vehicle, map: g.map, line, weatherGrip: g.env.weather.grip });
  if (opts.cam) g.cameraRig.mode = opts.cam;
  return advance(opts.sec ?? 9);
}

/** Simulate more time in the current session and render a frame. */
export function advance(sec) {
  const g = game();
  g.paused = false;
  for (let i = 0; i < sec * 60; i++) {
    g.input.poll();
    g.update(1 / 60);
  }
  g.hud.update(0.016, g);
  g.gfx.render();
  const info = g.gfx.renderer.info.render;
  return { calls: info.calls, tris: info.triangles, pos: g.vehicle.pos.toArray().map((x) => Math.round(x)) };
}
