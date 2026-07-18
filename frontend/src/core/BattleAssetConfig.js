/** Runtime asset conventions shared by the battle renderer and loader. */

import {
  ENEMY_BIOME_ALIASES,
  ENEMY_PRIMARY_BIOMES,
  getNpcCharacterPathCandidates,
  getNpcSpriteBiomeCandidates,
  resolveEnemyBiomeAlias
} from '../../../shared/assetPaths.js';

export const CHARACTER_ANIMATIONS = Object.freeze([
  'idle',
  'walk',
  'attack',
  'hit',
  'death',
  'dead',
  'cast',
  'victory'
]);

// This mirrors the authored class capabilities in
// ai-image-metadata/characters/players.json. Other classes deliberately use
// their attack strip when casting a skill.
export const PLAYER_CAST_CLASSES = Object.freeze([
  'wizard',
  'paladin',
  'sorcerer',
  'summoner',
  'conjurer',
  'oracle',
  'ascetic',
  'medic',
  'plague_doctor'
]);

const PLAYER_CAST_CLASS_SET = new Set(PLAYER_CAST_CLASSES);

/** Return only the animation capabilities authored for a player class. */
export function getPlayerCharacterAnimations(character) {
  const className = String(
    typeof character === 'string' ? character : character?.class
  ).trim().toLowerCase().replaceAll(' ', '_');

  return PLAYER_CAST_CLASS_SET.has(className)
    ? CHARACTER_ANIMATIONS
    : CHARACTER_ANIMATIONS.filter(animation => animation !== 'cast');
}

export const ENEMY_ANIMATIONS = Object.freeze([
  'idle',
  'attack',
  'hit',
  'death',
  'dead'
]);

export const SPRITE_BIOMES = ENEMY_BIOME_ALIASES;
export { ENEMY_PRIMARY_BIOMES };

export function resolveSpriteBiome(nodeType) {
  return resolveEnemyBiomeAlias(nodeType);
}

/**
 * Return enemy sprite biomes in lookup order.
 *
 * The canonical biome is authoritative for an enemy's base visual identity.
 * The requested biome and its runtime alias remain fallbacks for biome-specific
 * variants and for enemies not yet present in the canonical registry.
 */
export function getEnemySpriteBiomeCandidates(enemyId, requestedBiome = 'forest') {
  return getNpcSpriteBiomeCandidates(enemyId, requestedBiome);
}

/** Return canonical artwork-alias-aware enemy sprite paths in lookup order. */
export function getEnemySpritePathCandidates(enemyId, animation = 'idle', requestedBiome = 'forest') {
  return getNpcCharacterPathCandidates(enemyId, {
    requestedBiome,
    animations: getEnemySpriteAnimationCandidates(animation)
  });
}

/** Return enemy animation names in lookup order. */
export function getEnemySpriteAnimationCandidates(animation = 'idle') {
  const normalizedAnimation = String(animation || 'idle').trim().toLowerCase();
  return normalizedAnimation === 'dead'
    ? ['death', 'dead']
    : [normalizedAnimation];
}
