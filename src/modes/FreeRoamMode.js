import { Mode } from './Mode.js';

/** Drive anywhere, no clock. On the proving ground the car can also be swapped on the fly. */
export class FreeRoamMode extends Mode {
  get title() {
    return 'Free Roam';
  }

  start() {
    const g = this.game;
    g.placePlayer(g.map.spawn);
    this.countdown = 0;
    this.lockAll(false);
    g.hud.setCountdown(null);
  }

  onPlayerReset() {}
}
