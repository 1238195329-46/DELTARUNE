// battle.js - core battle entry point, before and after plugin hooks.

import { AppAPI } from './AppAPI.js';
import { loadAsset } from './assetLoader.js';

// ================================================================
// BEFORE: data goes straight from file to battle
// ================================================================
/*
export async function startBattle(battleId) {
  const battleData = await loadAsset(`data/battles/${battleId}.json`);
  const enemies = await Promise.all(battleData.enemies.map(loadEnemy));

  const battle = new Battle({ battleId, enemies, arena: battleData.arena });
  battle.onFinish = (result) => grantRewards(battle.rewards);
  battle.start();
  return battle;
}
*/

// ================================================================
// AFTER: data passes through AppAPI before the battle is built
// ================================================================
export async function startBattle(battleId) {
  const battleData = await loadAsset(`data/battles/${battleId}.json`);
  const enemies = await Promise.all(battleData.enemies.map(loadEnemy));

  // 1. Package the data. Copy anything a plugin might edit.
  // 2. Let plugins observe, filter, or cancel it.
  const { data, cancelled } = await AppAPI.trigger('onBattleStart', {
    battleId,
    enemies,
    arena: battleData.arena,
    music: battleData.music,
    rules: { ...battleData.rules },
  });

  // 3. Respect cancellation.
  if (cancelled) return null;

  // 4. Always build from the RETURNED data, never the original.
  const battle = new Battle(data);
  battle.onFinish = async (result) => {
    const { data: end } = await AppAPI.trigger('onBattleEnd', {
      battleId,
      result,
      rewards: battle.rewards,
    });
    grantRewards(end.rewards);
  };

  battle.start();
  return battle;
}

// ---------------------------------------------------------------
// Minimal placeholders so the demo runs. Replace with engine code.
// ---------------------------------------------------------------
async function loadEnemy(enemyRef) {
  return {
    id: enemyRef.id,
    name: enemyRef.id,
    stats: { ...enemyRef.stats },
    sprite: await loadAsset(enemyRef.sprite),
  };
}

class Battle {
  constructor({ battleId, enemies, arena, rules }) {
    Object.assign(this, { battleId, enemies, arena, rules });
    this.rewards = { xp: 10 };
    this.onFinish = null;
  }
  start() {
    console.log(`Battle "${this.battleId}" started`, this.enemies.map(e => `${e.name}: ${e.stats.hp} HP`));
  }
}

function grantRewards(rewards) {
  console.log('Rewards granted:', rewards);
}
