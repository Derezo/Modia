import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_MAP_V3_SUPPORTED_THEMES,
  resolveBattleMapV3CapacityBands,
  resolveBattleMapV3TeamLayout,
  resolveBattleMapV3Theme,
  resolveBattleMapV3Tier
} from './BattleMapV3Resolvers.js';

test('BattleMapV3 exposes all 16 explicit themes without a forest fallback', () => {
  assert.equal(BATTLE_MAP_V3_SUPPORTED_THEMES.length, 16);
  for (const theme of BATTLE_MAP_V3_SUPPORTED_THEMES) {
    assert.equal(resolveBattleMapV3Theme({ nodeType: theme }), theme);
  }
  assert.equal(resolveBattleMapV3Theme({ mode: 'guild' }), 'guild');
  assert.equal(resolveBattleMapV3Theme({ mode: 'pvp_coliseum' }), 'arena');
  assert.throws(
    () => resolveBattleMapV3Theme({ nodeType: 'unknown-theme' }),
    error => error.code === 'BATTLE_MAP_V3_THEME_UNSUPPORTED'
  );
});

test('BattleMapV3 tier and capacity resolvers produce explicit stable bands', () => {
  assert.deepEqual(
    resolveBattleMapV3Tier({ mode: 'pve', difficultyTier: 3 }),
    { sourceTier: 3, selectionBand: 'tier-3' }
  );
  assert.deepEqual(
    resolveBattleMapV3Tier({ mode: 'guild', guildTier: 2 }),
    { sourceTier: 2, selectionBand: 'tier-2' }
  );
  assert.deepEqual(
    resolveBattleMapV3Tier({ mode: 'pvp_coliseum', competitiveBand: 'gold' }),
    { sourceTier: null, selectionBand: 'gold' }
  );
  assert.deepEqual(resolveBattleMapV3CapacityBands({
    playerCount: 5,
    opponentCount: 7
  }), {
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand: 'opponents-1-7'
  });
  assert.equal(resolveBattleMapV3TeamLayout('pve'), 'players-vs-opponents');
  assert.equal(resolveBattleMapV3TeamLayout('pvp_coliseum'), 'team-one-vs-team-two');
});
