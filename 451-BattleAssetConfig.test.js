import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARACTER_ANIMATIONS,
  ENEMY_ANIMATIONS,
  resolveSpriteBiome
} from '../BattleAssetConfig.js';

describe('battle runtime asset configuration', () => {
  it('defines the exact preload animation manifests used by AssetLoader and BattleScene', () => {
    assert.deepEqual(CHARACTER_ANIMATIONS, [
      'idle', 'walk', 'attack', 'hit', 'death', 'dead'
    ]);
    assert.deepEqual(ENEMY_ANIMATIONS, [
      'idle', 'attack', 'hit', 'death', 'dead'
    ]);
    assert.equal(CHARACTER_ANIMATIONS.length, 6);
    assert.equal(ENEMY_ANIMATIONS.length, 5);
  });

  it('routes guild battles to the castle runtime tile family', () => {
    assert.equal(resolveSpriteBiome('guild'), 'castle');
    assert.equal(resolveSpriteBiome('unknown-node'), 'forest');
  });
});
