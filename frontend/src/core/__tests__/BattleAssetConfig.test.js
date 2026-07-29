import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARACTER_ANIMATIONS,
  ENEMY_PRIMARY_BIOMES,
  ENEMY_ANIMATIONS,
  getEnemySpriteAnimationCandidates,
  getEnemySpriteBiomeCandidates,
  getEnemySpritePathCandidates,
  getPlayerCharacterAnimations,
  resolveSpriteBiome
} from '../BattleAssetConfig.js';

describe('battle runtime asset configuration', () => {
  it('defines the exact preload animation manifests used by AssetLoader and BattleScene', () => {
    assert.deepEqual(CHARACTER_ANIMATIONS, [
      'idle', 'walk', 'attack', 'hit', 'death', 'dead', 'cast', 'victory'
    ]);
    assert.deepEqual(ENEMY_ANIMATIONS, [
      'idle', 'attack', 'hit', 'death', 'dead'
    ]);
    assert.equal(CHARACTER_ANIMATIONS.length, 8);
    assert.equal(ENEMY_ANIMATIONS.length, 5);
  });

  it('routes guild battles to the castle runtime tile family', () => {
    assert.equal(resolveSpriteBiome('guild'), 'castle');
    assert.equal(resolveSpriteBiome('palace'), 'palace');
    assert.equal(resolveSpriteBiome('unknown-node'), 'forest');
  });

  it('defines an immutable primary biome for every active encounter enemy', () => {
    assert.equal(Object.isFrozen(ENEMY_PRIMARY_BIOMES), true);
    assert.equal(Object.keys(ENEMY_PRIMARY_BIOMES).length, 16);
    assert.deepEqual(ENEMY_PRIMARY_BIOMES, {
      goblin_warrior: 'forest',
      gray_wolf: 'forest',
      forest_slime: 'forest',
      cave_bat: 'cave',
      giant_spider: 'forest',
      skeleton_warrior: 'cave',
      stone_golem: 'cave',
      mountain_troll: 'mountain',
      troll_shaman: 'mountain',
      harpy: 'mountain',
      bridge_bandit: 'bridge',
      bandit_captain: 'bridge',
      bridge_troll: 'bridge',
      dark_knight: 'palace',
      shadow_assassin: 'palace',
      palace_guard: 'palace'
    });
  });

  it('locks registered enemies to canonical authored sprite directories', () => {
    assert.deepEqual(getEnemySpriteBiomeCandidates('gray_wolf', 'mountain'), [
      'forest'
    ]);
    assert.deepEqual(getEnemySpriteBiomeCandidates('dark_knight', 'castle'), [
      'palace'
    ]);
    assert.deepEqual(getEnemySpriteBiomeCandidates('goblin_warrior', 'forest'), [
      'forest'
    ]);
    assert.deepEqual(getEnemySpritePathCandidates('forest_slime', 'idle', 'cave'), [
      '/assets/characters/enemies/forest/forest_slime/forest_slime_idle.webp'
    ]);
    assert.deepEqual(getEnemySpritePathCandidates('giant_spider', 'attack', 'mountain'), [
      '/assets/characters/enemies/forest/giant_spider/giant_spider_attack.webp'
    ]);
  });

  it('retains requested-biome aliases only for unregistered migration identities', () => {
    assert.deepEqual(getEnemySpriteBiomeCandidates('future_guildmaster', 'guild'), [
      'guild', 'castle'
    ]);
  });

  it('routes seeded guild NPCs to canonical player artwork without enemy fallbacks', () => {
    assert.deepEqual(getEnemySpriteBiomeCandidates('guildmaster_wizard', 'guild'), [
      'castle'
    ]);
    assert.deepEqual(getEnemySpritePathCandidates('guildmaster_wizard', 'hit', 'guild'), [
      '/assets/characters/player/human/female/wizard/human_female_wizard_hurt.webp'
    ]);
    assert.deepEqual(getEnemySpritePathCandidates('disciple_sorcerer', 'dead', 'mountain'), [
      '/assets/characters/player/human/other/sorcerer/human_other_sorcerer_dead.webp',
      '/assets/characters/player/human/other/sorcerer/human_other_sorcerer_death.webp'
    ]);
  });

  it('falls back from a missing dead pose to the completed death strip', () => {
    assert.deepEqual(getEnemySpriteAnimationCandidates('dead'), ['dead', 'death']);
    assert.deepEqual(getEnemySpriteAnimationCandidates('attack'), ['attack']);
  });

  it('uses each approved authored identity’s own canonical sprite path', () => {
    assert.deepEqual(
      getEnemySpritePathCandidates('palace_guard', 'attack', 'palace'),
      ['/assets/characters/enemies/palace/palace_guard/palace_guard_attack.webp']
    );
    assert.deepEqual(
      getEnemySpritePathCandidates('bandit_captain', 'attack', 'bridge'),
      ['/assets/characters/enemies/bridge/bandit_captain/bandit_captain_attack.webp']
    );
  });

  it('preloads cast only for classes with an authored cast capability', () => {
    assert.equal(getPlayerCharacterAnimations({ class: 'wizard' }).includes('cast'), true);
    assert.equal(getPlayerCharacterAnimations({ class: 'plague doctor' }).includes('cast'), true);
    assert.equal(getPlayerCharacterAnimations({ class: 'monk' }).includes('cast'), false);
    assert.equal(getPlayerCharacterAnimations('warrior').includes('cast'), false);
    assert.equal(getPlayerCharacterAnimations({}).includes('cast'), false);
  });
});
