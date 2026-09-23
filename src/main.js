// main.js - engine entry point.
// Boot order: create manager -> wire asset loader -> scan -> load plugins
//             -> onAppInit -> start game loop.

import { AppAPI } from './core/AppAPI.js';
import { PluginManager } from './core/PluginManager.js';
import { setPluginManager } from './core/assetLoader.js';
import { startBattle } from './core/battle.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

async function boot() {
  const plugins = new PluginManager({ pluginRoot: './plugins/' });
  setPluginManager(plugins);        // asset loader must know about overrides
  await plugins.scanPlugins();
  await plugins.loadAll();          // plugins must be active before any scene starts

  window.pluginManager = plugins;   // console access for testing enable/disable

  await AppAPI.trigger('onAppInit', { config: { debug: true } });

  await startBattle('battle_1');    // demo: triggers onBattleStart
  requestAnimationFrame(loop);
}

let last = performance.now();
function loop(now) {
  const dt = (now - last) / 1000;
  last = now;

  // Per-frame hooks use triggerSync. Never await in the loop.
  AppAPI.triggerSync('onUpdate', { dt });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // ...engine scene rendering goes here...

  AppAPI.triggerSync('onUIRender', { ctx, width: canvas.width, height: canvas.height });

  requestAnimationFrame(loop);
}

boot().catch(err => console.error('Boot failed:', err));
