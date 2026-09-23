// test-mod - example plugin. Uses only the context it receives.

const HP_MULTIPLIER = 2;

export function activate(ctx) {
  ctx.log('activated');

  // FILTER: multiply enemy HP. Return a new object instead of mutating.
  ctx.on('onBattleStart', (data) => ({
    ...data,
    enemies: data.enemies.map(enemy => ({
      ...enemy,
      stats: { ...enemy.stats, hp: enemy.stats.hp * HP_MULTIPLIER },
    })),
  }));

  // OBSERVE: log battle results.
  ctx.on('onBattleEnd', (data) => {
    ctx.log(`battle ${data.battleId} ended:`, data.result);
  });

  // SYNC per-frame hook: draw a HUD label.
  ctx.on('onUIRender', ({ ctx: g, width }) => {
    g.fillStyle = 'crimson';
    g.font = '16px sans-serif';
    g.fillText('TEST MOD ACTIVE', width - 160, 24);
  });
}

export function deactivate(ctx) {
  ctx.log('deactivated'); // listeners are removed automatically by the manager
}
