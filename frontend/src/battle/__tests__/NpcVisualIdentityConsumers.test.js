import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0 }
});
globalThis.document = {
  createElement() { return { id: '', textContent: '' }; },
  getElementById() { return null; },
  head: { appendChild() {} }
};

const { BattleStatsTable } = await import('../BattleStatsTable.js');
const { buildPortraitId } = await import('../turnOrderUtils.js');

const npc = {
  type: 'enemy',
  class: 'wizard',
  race: 'human',
  gender: 'female',
  enemyId: 'wrong_legacy_id',
  biome: 'mountain',
  visualIdentity: {
    kind: 'npc',
    visualId: 'guildmaster_wizard',
    primaryBiome: 'guild'
  }
};

describe('NPC portrait consumers', () => {
  it('turn-order portraits prefer canonical identity over humanoid class fields', () => {
    assert.equal(buildPortraitId(npc), 'enemy_guildmaster_wizard');
  });

  it('uses one stable placeholder when a legacy NPC has no visual identity', () => {
    assert.equal(
      buildPortraitId({ type: 'enemy', class: 'wizard', biome: 'guild' }),
      'enemy_unknown'
    );
  });

  it('post-battle statistics use the same canonical portrait path', () => {
    const table = new BattleStatsTable(null);
    assert.equal(
      table.getPortraitPath(npc),
      '/assets/portraits/48/enemy_guildmaster_wizard.webp'
    );
  });
});
