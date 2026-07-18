/** Runtime asset conventions shared by the battle renderer and loader. */

export const CHARACTER_ANIMATIONS = Object.freeze([
  'idle',
  'walk',
  'attack',
  'hit',
  'death',
  'dead'
]);

export const ENEMY_ANIMATIONS = Object.freeze([
  'idle',
  'attack',
  'hit',
  'death',
  'dead'
]);

export const SPRITE_BIOMES = Object.freeze({
  forest: 'forest',
  cave: 'cave',
  mountain: 'mountain',
  bridge: 'bridge',
  castle: 'castle',
  arena: 'castle',
  guild: 'castle',
  village: 'forest',
  city: 'forest'
});

export function resolveSpriteBiome(nodeType) {
  return SPRITE_BIOMES[nodeType] || 'forest';
}
