import './styles.css';
import './ui/menu.css';
import './ui/theme.css';
import { initPhysics } from './physics/PhysicsWorld.js';

const loading = document.getElementById('loading');

function fail(title, detail) {
  loading.classList.add('error');
  loading.innerHTML = `<div class="logo">APEX DRIVE</div><h2>${title}</h2><p>${detail}</p>`;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

async function boot() {
  if (!webglAvailable()) {
    fail('WebGL 2 is not available', 'Your browser or graphics driver has WebGL disabled. Try an up-to-date Chrome, Edge or Firefox, enable hardware acceleration, or update your GPU driver.');
    return;
  }
  try {
    await initPhysics();
    const { Game } = await import('./core/Game.js');
    const game = new Game(document.getElementById('app'), document.getElementById('hud'), document.getElementById('menu'));
    game.gfx.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      game.setPaused(true);
      fail('Graphics context lost', 'The GPU reset or ran out of memory. Reload the page to continue.');
      loading.style.display = '';
    });
    game.start();
    loading.style.display = 'none';
    if (import.meta.env.DEV) window.__game = game;
  } catch (err) {
    console.error(err);
    fail('Something went wrong while starting', String(err && err.message ? err.message : err));
  }
}

boot();
