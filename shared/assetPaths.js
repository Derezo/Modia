/**
 * @module assetPaths
 * @description Single source of truth for asset path construction across Modia.
 *
 * This module provides utilities for generating asset URLs consistently across
 * the frontend (via @shared alias), API (via relative import), and scripts.
 *
 * Key responsibilities:
 * - Define size presets and defaults for each asset category
 * - Generate standardized paths for all asset types
 * - Provide output paths for asset generation scripts
 * - Provide originals paths for source image preservation
 *
 * @example
 * // Frontend usage
 * import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';
 * const iconPath = getAssetPath('icons', 'attack', { subcategory: 'actions', size: 32 });
 *
 * @example
 * // API/Script usage
 * import { getOutputPath } from '../../../shared/assetPaths.js';
 * const savePath = getOutputPath('portraits', 'human_male_warrior', { size: 64 });
 */

/**
 * Animation types for character sprites - single source of truth
 * @type {string[]}
 */
export const CHARACTER_ANIMATIONS = [
  'idle', 'walk', 'attack', 'hurt', 'death', 'dead', 'cast', 'victory'
];

/**
 * Character types for path generation
 * @type {string[]}
 */
export const CHARACTER_TYPES = ['player', 'enemy'];

/** Canonical battle ability registry sources. */
export const ABILITY_ICON_SOURCES = Object.freeze(['player', 'monster', 'zodiac']);

/**
 * Runtime animation names do not always match the generation metadata names.
 * Player damage reactions are authored as `hurt`, while battle state uses
 * `hit`. Keep that translation beside the canonical path helpers so every
 * consumer resolves the same file.
 */
export const PLAYER_ANIMATION_ALIASES = Object.freeze({
  hit: 'hurt'
});

/**
 * Enemy biomes for path organization
 * @type {string[]}
 */
export const ENEMY_BIOMES = ['forest', 'cave', 'mountain', 'bridge', 'castle', 'palace'];

/**
 * Runtime node types do not always have their own enemy-art directory. Keep
 * those aliases beside the path builder so API DTOs and every renderer agree
 * on the same fallback rather than maintaining zone-specific lookup tables.
 */
export const ENEMY_BIOME_ALIASES = Object.freeze({
  forest: 'forest',
  cave: 'cave',
  mountain: 'mountain',
  bridge: 'bridge',
  castle: 'castle',
  palace: 'palace',
  arena: 'castle',
  guild: 'castle',
  village: 'forest',
  city: 'forest'
});

/**
 * Canonical art home for every active encounter NPC. A unit may encounter the
 * party in another zone, but its visual identity must continue to resolve from
 * this directory first. Explicit DTO primary biomes cover special NPCs (for
 * example guildmasters) that are not part of the encounter-template registry.
 */
export const NPC_PRIMARY_BIOMES = Object.freeze({
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

// Backwards-compatible spelling used by the battle runtime.
export const ENEMY_PRIMARY_BIOMES = NPC_PRIMARY_BIOMES;

/**
 * Obstacle categories for path organization
 * @type {string[]}
 */
export const OBSTACLE_CATEGORIES = ['rocks', 'trees'];

/**
 * Available size options for each asset category
 * @type {Object.<string, number[]>}
 */
export const SIZE_PRESETS = {
  tiles: [64],
  portraits: [32, 48, 64, 128, 256],
  items: [32, 64, 128],
  icons: [16, 24, 32, 48, 64, 128, 256],
  nodes: [48, 64, 96, 128, 256],
  overlays: [32, 48, 64, 128],
  characters: [64],    // Always 64x512 sprite sheets
  obstacles: [64]      // No size variants
};

/**
 * Default size for each asset category when not specified.
 * Set to largest available size for high-quality admin dashboard previews.
 * @type {Object.<string, number>}
 */
export const DEFAULT_SIZES = {
  tiles: 64,           // Only size available
  portraits: 256,      // Max: 256 (from [32, 48, 64, 128, 256])
  items: 128,          // Max: 128 (from [32, 64, 128])
  icons: 256,          // Max: 256 (from [16, 24, 32, 48, 64, 128, 256])
  nodes: 256,          // Max: 256 (from [48, 64, 96, 128, 256])
  overlays: 128,       // Max: 128 (from [32, 48, 64, 128])
  characters: 64,      // Only size (64x512 sprite sheets)
  obstacles: 64        // Only size available
};

/**
 * Valid asset categories
 * @type {string[]}
 */
export const ASSET_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays', 'characters', 'obstacles'];

/**
 * Base path for assets (relative to public directory)
 * @type {string}
 */
const ASSETS_BASE = '/assets';

/**
 * Get the canonical icon path for an active battle ability.
 * Ability icons are source-scoped because player, monster, and zodiac
 * definition sets may legitimately reuse an identifier.
 *
 * @returns {string|null} A safe public URL, or null for malformed components.
 */
export function getAbilityIconPath(id, options = {}) {
  const normalizedId = String(id || '').trim().toLowerCase();
  const source = String(options.source || 'player').trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalizedId) || !ABILITY_ICON_SOURCES.includes(source)) {
    return null;
  }
  return `${ASSETS_BASE}/abilities/icons/${source}/${normalizedId}.webp`;
}

/**
 * Validates that a category is supported
 * @param {string} category - The asset category
 * @throws {Error} If category is not supported
 */
function validateCategory(category) {
  if (!ASSET_CATEGORIES.includes(category)) {
    throw new Error(`Invalid asset category: ${category}. Must be one of: ${ASSET_CATEGORIES.join(', ')}`);
  }
}

/**
 * Gets the effective size for an asset, using default if not specified
 * @param {string} category - The asset category
 * @param {number} [size] - Optional size override
 * @returns {number} The effective size to use
 */
function getEffectiveSize(category, size) {
  if (size !== undefined) {
    return size;
  }
  return DEFAULT_SIZES[category];
}

/**
 * Generates path for portraits (unified player + enemy)
 * Pattern: /assets/portraits/{size}/{id}.webp
 * - Player IDs: {race}_{gender}_{class} (e.g., 'human_male_warrior')
 * - Enemy IDs: enemy_{name} (e.g., 'enemy_goblin_warrior')
 *
 * @param {string} id - The portrait identifier
 * @param {Object} options - Options
 * @param {number} [options.size] - Size variant (64, 128, 256)
 * @returns {string} The portrait path
 */
function getPortraitPath(id, options = {}) {
  const size = getEffectiveSize('portraits', options.size);
  return `${ASSETS_BASE}/portraits/${size}/${id}.webp`;
}

/**
 * Generates path for world map nodes
 * Pattern: /assets/nodes/{size}/{id}.webp
 * IDs no longer have 'node_' prefix (e.g., 'castle', not 'node_castle')
 *
 * @param {string} id - The node identifier (e.g., 'castle', 'tavern', 'guild_warrior')
 * @param {Object} options - Options
 * @param {number} [options.size] - Size variant (48, 64, 96, 128, 256)
 * @returns {string} The node path
 */
function getNodePath(id, options = {}) {
  const size = getEffectiveSize('nodes', options.size);
  return `${ASSETS_BASE}/nodes/${size}/${id}.webp`;
}

/**
 * Generates path for items
 * Pattern: /assets/items/{size}/{subcategory}/{id}.webp
 *
 * @param {string} id - The item identifier (e.g., 'sword_iron')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='weapons'] - Item type
 * @param {number} [options.size] - Size variant (32, 64, 128)
 * @returns {string} The item path
 */
function getItemPath(id, options = {}) {
  const { subcategory = 'weapons' } = options;
  const size = getEffectiveSize('items', options.size);
  return `${ASSETS_BASE}/items/${size}/${subcategory}/${id}.webp`;
}

/**
 * Generates path for icons
 * Pattern: /assets/icons/png/{size}/{subcategory}/{id}.webp
 *
 * @param {string} id - The icon identifier (e.g., 'attack')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='actions'] - Icon category
 * @param {number} [options.size] - Size variant (16, 24, 32, 48, 64, 128, 256)
 * @returns {string} The icon path
 */
function getIconPath(id, options = {}) {
  const { subcategory = 'actions' } = options;
  const size = getEffectiveSize('icons', options.size);
  return `${ASSETS_BASE}/icons/png/${size}/${subcategory}/${id}.webp`;
}

/**
 * Generates path for terrain tiles
 * Pattern: /assets/sprites/terrain/{biome}/{id}.webp
 * All tiles (floors, walls, slopes) use flat paths matching generated file structure:
 * - Walls: wall_{biome}_{terrain}.webp (e.g., wall_forest_default.webp)
 * - Slopes: slope_{biome}_{direction}_{levels}.webp (e.g., slope_forest_north_1.webp)
 * - Floors: {terrain}_{variant}.webp (e.g., grass_0.webp)
 *
 * @param {string} id - The tile identifier (e.g., 'grass_0', 'wall_forest_default', 'slope_forest_north_1')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='forest'] - Biome type (base, forest, cave, mountain, bridge, castle)
 * @returns {string} The tile path
 */
function getTilePath(id, options = {}) {
  const { subcategory = 'forest' } = options;
  // All tiles use flat path: {biome}/{id}.webp
  // Wall IDs: wall_{biome}_{terrain}, Slope IDs: slope_{biome}_{dir}_{levels}
  return `${ASSETS_BASE}/sprites/terrain/${subcategory}/${id}.webp`;
}

/**
 * Generates path for overlays
 * Pattern: /assets/overlays/{size}/{subcategory}/{id}.webp
 *
 * @param {string} id - The overlay identifier (e.g., 'rare', 'fire')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='rarity'] - Overlay type (rarity, augments)
 * @param {number} [options.size] - Size variant (32, 48, 64, 128)
 * @returns {string} The overlay path
 */
function getOverlayPath(id, options = {}) {
  const { subcategory = 'rarity' } = options;
  const size = getEffectiveSize('overlays', options.size);
  return `${ASSETS_BASE}/overlays/${size}/${subcategory}/${id}.webp`;
}

/**
 * Gets path for character sprite sheets
 *
 * Players:  /assets/characters/player/{class}/{class}_{animation}.webp
 * Enemies:  /assets/characters/enemies/{biome}/{id}/{id}_{animation}.webp
 *
 * @param {string} id - The character identifier (class for players, id for enemies)
 * @param {Object} options - Options
 * @param {string} [options.type='player'] - Character type ('player' or 'enemy'/'enemies')
 * @param {string} [options.biome] - Biome (required for enemies)
 * @param {string} [options.animation='idle'] - Animation type
 * @param {string} [options.extension='webp'] - File extension
 * @returns {string} The character sprite path
 *
 * @example
 * // Player sprite
 * getCharacterPath('warrior', { animation: 'attack' });
 * // => '/assets/characters/player/warrior/warrior_attack.webp'
 *
 * @example
 * // Enemy sprite
 * getCharacterPath('goblin_warrior', { type: 'enemy', biome: 'forest', animation: 'idle' });
 * // => '/assets/characters/enemies/forest/goblin_warrior/goblin_warrior_idle.webp'
 */
export function getCharacterPath(id, options = {}) {
  const { type = 'player', biome, animation = 'idle', extension = 'webp' } = options;

  if (type === 'enemy' || type === 'enemies') {
    if (!biome) throw new Error('biome required for enemy characters');
    return `${ASSETS_BASE}/characters/enemies/${biome}/${id}/${id}_${animation}.${extension}`;
  }

  // Supplying race + gender opts into the portrait-matched player layout.
  // Calls that only pass a class retain the legacy class-archetype path.
  if (options.race && options.gender) {
    return getPlayerCharacterPath({
      race: options.race,
      gender: options.gender,
      class: options.class || id
    }, { animation, extension });
  }

  return `${ASSETS_BASE}/characters/player/${id}/${id}_${animation}.${extension}`;
}

/**
 * Normalize a character identity token for use in metadata IDs and paths.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeCharacterToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Map a world node/encounter biome to an available enemy-art directory.
 * Unknown node types retain the historical forest fallback.
 * @param {unknown} biome
 * @returns {string}
 */
export function resolveEnemyBiomeAlias(biome = 'forest') {
  const normalized = normalizeCharacterToken(biome) || 'forest';
  return ENEMY_BIOME_ALIASES[normalized] || 'forest';
}

/**
 * Read the canonical NPC art identity from either the current nested DTO or
 * any supported legacy sprite-id alias. The registry wins for known encounter
 * enemies; otherwise an explicit DTO primary biome wins over the encounter
 * zone supplied as a migration fallback.
 *
 * @param {Object} unit
 * @param {Object} options
 * @param {string} [options.fallbackBiome='forest']
 * @returns {{visualId: string|null, primaryBiome: string}}
 */
export function getNpcVisualIdentity(unit = {}, options = {}) {
  const source = unit && typeof unit === 'object' ? unit : { enemyId: unit };
  const nested = source.visualIdentity && typeof source.visualIdentity === 'object'
    ? source.visualIdentity
    : {};
  const visualId = normalizeCharacterToken(
    nested.visualId ?? source.visualId ?? source.enemyId ?? source.sprite_id ?? source.spriteId
  ) || null;
  const configuredPrimary = normalizeCharacterToken(
    nested.primaryBiome ?? source.primaryBiome
  );
  const encounterFallback = normalizeCharacterToken(
    source.biome ?? source.encounterBiome ?? options.fallbackBiome ?? 'forest'
  ) || 'forest';

  return {
    visualId,
    primaryBiome: (visualId && NPC_PRIMARY_BIOMES[visualId])
      || configuredPrimary
      || encounterFallback
  };
}

/**
 * Return canonical-first enemy-art directories without duplicates. Both the
 * canonical and requested node types include their runtime aliases so special
 * locations such as guild and arena can share the castle family safely.
 *
 * @param {Object|string} unitOrVisualId
 * @param {string} [requestedBiome='forest']
 * @returns {string[]}
 */
export function getNpcSpriteBiomeCandidates(unitOrVisualId, requestedBiome = 'forest') {
  const source = unitOrVisualId && typeof unitOrVisualId === 'object'
    ? unitOrVisualId
    : { enemyId: unitOrVisualId, biome: requestedBiome };
  const identity = getNpcVisualIdentity(source, { fallbackBiome: requestedBiome });
  const normalizedRequested = normalizeCharacterToken(requestedBiome) || 'forest';

  return [...new Set([
    identity.primaryBiome,
    resolveEnemyBiomeAlias(identity.primaryBiome),
    normalizedRequested,
    resolveEnemyBiomeAlias(normalizedRequested)
  ].filter(Boolean))];
}

/**
 * Build canonical-first sprite paths for an NPC identity. This is the runtime
 * counterpart to getCharacterPath(): generation may deliberately author a
 * biome variant, while consumers should always begin from canonical identity.
 *
 * @param {Object|string} unitOrVisualId
 * @param {Object} options
 * @param {string} [options.requestedBiome='forest']
 * @param {string} [options.animation='idle']
 * @param {string[]} [options.animations]
 * @param {string} [options.extension='webp']
 * @returns {string[]}
 */
export function getNpcCharacterPathCandidates(unitOrVisualId, options = {}) {
  const requestedBiome = options.requestedBiome
    ?? (unitOrVisualId && typeof unitOrVisualId === 'object'
      ? unitOrVisualId.biome ?? unitOrVisualId.primaryBiome
      : null)
    ?? 'forest';
  const source = unitOrVisualId && typeof unitOrVisualId === 'object'
    ? unitOrVisualId
    : { enemyId: unitOrVisualId, biome: requestedBiome };
  const { visualId } = getNpcVisualIdentity(source, { fallbackBiome: requestedBiome });
  if (!visualId) return [];

  const animations = (Array.isArray(options.animations) && options.animations.length > 0
    ? options.animations
    : [options.animation || 'idle'])
    .map(animation => normalizeCharacterToken(animation) || 'idle');
  const extension = normalizeCharacterToken(options.extension || 'webp') || 'webp';
  const paths = [];

  for (const biome of getNpcSpriteBiomeCandidates(source, requestedBiome)) {
    for (const animation of animations) {
      paths.push(getCharacterPath(visualId, {
        type: 'enemy',
        biome,
        animation,
        extension
      }));
    }
  }

  return paths;
}

/**
 * Build the portrait identifier used by all NPC cards, turn-order entries, and
 * battle summaries from the same canonical visual id.
 * @param {Object} unit
 * @param {string} [fallback='unknown']
 * @returns {string}
 */
export function getNpcPortraitId(unit = {}, fallback = 'unknown') {
  const { visualId } = getNpcVisualIdentity(unit);
  const fallbackId = normalizeCharacterToken(fallback) || 'unknown';
  return `enemy_${visualId || fallbackId}`;
}

/**
 * Build the canonical player visual identity shared with portrait cards.
 * @param {Object} character - Object with race, gender, and class properties
 * @returns {{id: string, race: string, gender: string, className: string}}
 */
export function getPlayerCharacterIdentity(character = {}) {
  const source = character && typeof character === 'object'
    ? character
    : { class: character };
  const nested = source.visualIdentity?.kind === 'player'
    ? source.visualIdentity
    : {};
  const race = normalizeCharacterToken(nested.race || source.race || 'human');
  const gender = normalizeCharacterToken(nested.gender || source.gender || 'other');
  const className = normalizeCharacterToken(
    nested.class || nested.className || source.class || source.characterClass || 'warrior'
  );

  return {
    id: `${race}_${gender}_${className}`,
    race,
    gender,
    className
  };
}

/**
 * Resolve a logical player animation name to its generated asset name.
 * @param {string} animation
 * @returns {string}
 */
export function resolvePlayerAnimationName(animation = 'idle') {
  const normalized = normalizeCharacterToken(animation) || 'idle';
  return PLAYER_ANIMATION_ALIASES[normalized] || normalized;
}

/**
 * Get the portrait-matched player sprite path.
 *
 * Pattern:
 * /assets/characters/player/{race}/{gender}/{class}/
 *   {race}_{gender}_{class}_{animation}.webp
 *
 * @param {Object} character - Object with race, gender, and class properties
 * @param {Object} options
 * @param {string} [options.animation='idle']
 * @param {string} [options.extension='webp']
 * @returns {string}
 */
export function getPlayerCharacterPath(character, options = {}) {
  const { animation = 'idle', extension = 'webp' } = options;
  const identity = getPlayerCharacterIdentity(character);
  const assetAnimation = resolvePlayerAnimationName(animation);
  return `${ASSETS_BASE}/characters/player/${identity.race}/${identity.gender}/${identity.className}/${identity.id}_${assetAnimation}.${extension}`;
}

/**
 * Get the canonical directory for one portrait-matched player variant.
 * @param {Object} character
 * @returns {string}
 */
export function getPlayerCharacterDirectory(character) {
  const identity = getPlayerCharacterIdentity(character);
  return `${ASSETS_BASE}/characters/player/${identity.race}/${identity.gender}/${identity.className}`;
}

/**
 * Get the full-body generation reference for a player variant.
 * @param {Object} character
 * @returns {string}
 */
export function getPlayerCharacterReferencePath(character) {
  const identity = getPlayerCharacterIdentity(character);
  return `${getPlayerCharacterDirectory(character)}/${identity.id}_reference.png`;
}

/**
 * Return player sprite candidates without crossing visual identities. An
 * object represents a specific race/gender/class identity, so the default is
 * deliberately strict now that canonical variant coverage is complete. A
 * legacy class-only fallback can still be requested explicitly by migration
 * tooling; runtime callers should pass a class string when they truly want the
 * old archetype artwork.
 * @param {Object} character
 * @param {Object} options
 * @returns {string[]}
 */
export function getPlayerCharacterPathCandidates(character, options = {}) {
  const identity = getPlayerCharacterIdentity(character);
  const animation = resolvePlayerAnimationName(options.animation || 'idle');
  const extension = options.extension || 'webp';
  const animationCandidates = animation === 'dead' ? ['dead', 'death'] : [animation];
  const canonical = animationCandidates.map(candidate =>
    getPlayerCharacterPath(character, { animation: candidate, extension })
  );
  if (!options.includeLegacyFallback) return canonical;

  return [
    ...canonical,
    ...animationCandidates.map(candidate =>
      getCharacterPath(identity.className, { animation: candidate, extension })
    )
  ];
}

/**
 * Gets all animation paths for a character (for preloading)
 *
 * @param {string} id - The character identifier
 * @param {Object} options - Options
 * @param {string[]} [options.animations] - Animation types to include (defaults to CHARACTER_ANIMATIONS)
 * @param {string} [options.type='player'] - Character type
 * @param {string} [options.biome] - Biome (required for enemies)
 * @param {string} [options.extension='webp'] - File extension
 * @returns {Array<{animation: string, path: string}>} Array of animation/path pairs
 *
 * @example
 * getCharacterAnimationPaths('warrior', { animations: ['idle', 'attack'] });
 * // => [
 * //   { animation: 'idle', path: '/assets/characters/player/warrior/warrior_idle.webp' },
 * //   { animation: 'attack', path: '/assets/characters/player/warrior/warrior_attack.webp' }
 * // ]
 */
export function getCharacterAnimationPaths(id, options = {}) {
  const { animations = CHARACTER_ANIMATIONS, ...pathOptions } = options;
  return animations.map(animation => ({
    animation,
    path: getCharacterPath(id, { ...pathOptions, animation })
  }));
}

/**
 * Gets character directory (for mkdir operations)
 *
 * @param {string} id - The character identifier
 * @param {Object} options - Options
 * @param {string} [options.type='player'] - Character type
 * @param {string} [options.biome] - Biome (required for enemies)
 * @returns {string} The character directory path
 *
 * @example
 * getCharacterDirectory('warrior');
 * // => '/assets/characters/player/warrior'
 *
 * @example
 * getCharacterDirectory('goblin_warrior', { type: 'enemy', biome: 'forest' });
 * // => '/assets/characters/enemies/forest/goblin_warrior'
 */
export function getCharacterDirectory(id, options = {}) {
  const { type = 'player', biome } = options;
  if (type === 'enemy' || type === 'enemies') {
    if (!biome) throw new Error('biome required for enemy characters');
    return `${ASSETS_BASE}/characters/enemies/${biome}/${id}`;
  }
  if (options.race && options.gender) {
    return getPlayerCharacterDirectory({
      race: options.race,
      gender: options.gender,
      class: options.class || id
    });
  }
  return `${ASSETS_BASE}/characters/player/${id}`;
}

/**
 * Gets reference image path for SD1.5 generation
 *
 * @param {string} id - The character identifier
 * @param {Object} options - Options
 * @param {string} [options.type='player'] - Character type
 * @param {string} [options.biome] - Biome (required for enemies)
 * @returns {string} The reference image path
 *
 * @example
 * getCharacterReferencePath('warrior');
 * // => '/assets/characters/player/warrior/warrior_reference.png'
 */
export function getCharacterReferencePath(id, options = {}) {
  if (options.type !== 'enemy' && options.type !== 'enemies' && options.race && options.gender) {
    return getPlayerCharacterReferencePath({
      race: options.race,
      gender: options.gender,
      class: options.class || id
    });
  }
  const dir = getCharacterDirectory(id, options);
  return `${dir}/${id}_reference.png`;
}

/**
 * Gets path for obstacle sprites
 * Pattern: /assets/obstacles/{category}/{id}.webp
 *
 * @param {string} id - The obstacle identifier (e.g., 'rock_small', 'tree_oak')
 * @param {string} category - Obstacle category ('rocks' or 'trees')
 * @param {Object} [options] - Options
 * @param {string} [options.extension='webp'] - File extension
 * @returns {string} The obstacle path
 *
 * @example
 * getObstaclePath('rock_small', 'rocks');
 * // => '/assets/obstacles/rocks/rock_small.webp'
 */
export function getObstaclePath(id, category, options = {}) {
  const { extension = 'webp' } = options;
  if (!OBSTACLE_CATEGORIES.includes(category)) {
    throw new Error(`Invalid obstacle category: ${category}. Must be one of: ${OBSTACLE_CATEGORIES.join(', ')}`);
  }
  return `${ASSETS_BASE}/obstacles/${category}/${id}.${extension}`;
}

/**
 * Gets the asset path for any category
 *
 * This is the main function for retrieving asset paths. It generates
 * standardized paths based on category and options.
 *
 * @param {string} category - Asset category ('tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays')
 * @param {string} id - Asset identifier (varies by category)
 * @param {Object} [options] - Options for path generation
 * @param {number} [options.size] - Size variant (uses category default if not specified)
 * @param {string} [options.subcategory] - Subcategory for organization (meaning varies by category)
 * @param {string} [options.tileCategory] - For tiles only: 'floors', 'walls', or 'slopes'
 * @returns {string} The asset path
 *
 * @example
 * // Portrait (player)
 * getAssetPath('portraits', 'human_male_warrior', { size: 64 });
 * // => '/assets/portraits/64/human_male_warrior.webp'
 *
 * @example
 * // Portrait (enemy)
 * getAssetPath('portraits', 'enemy_goblin_warrior', { size: 64 });
 * // => '/assets/portraits/64/enemy_goblin_warrior.webp'
 *
 * @example
 * // Node (no node_ prefix)
 * getAssetPath('nodes', 'castle', { size: 96 });
 * // => '/assets/nodes/96/castle.webp'
 *
 * @example
 * // Item (size in path, not filename)
 * getAssetPath('items', 'sword_iron', { subcategory: 'weapons', size: 64 });
 * // => '/assets/items/64/weapons/sword_iron.webp'
 *
 * @example
 * // Icon
 * getAssetPath('icons', 'attack', { subcategory: 'actions', size: 32 });
 * // => '/assets/icons/png/32/actions/attack.webp'
 *
 * @example
 * // Terrain tile
 * getAssetPath('tiles', 'grass_0', { subcategory: 'forest' });
 * // => '/assets/sprites/terrain/forest/grass_0.webp'
 *
 * @example
 * // Overlay
 * getAssetPath('overlays', 'rare', { subcategory: 'rarity', size: 64 });
 * // => '/assets/overlays/64/rarity/rare.webp'
 */
export function getAssetPath(category, id, options = {}) {
  validateCategory(category);

  switch (category) {
    case 'portraits':
      return getPortraitPath(id, options);
    case 'nodes':
      return getNodePath(id, options);
    case 'items':
      return getItemPath(id, options);
    case 'icons':
      return getIconPath(id, options);
    case 'tiles':
      return getTilePath(id, options);
    case 'overlays':
      return getOverlayPath(id, options);
    case 'characters':
      return getCharacterPath(id, options);
    case 'obstacles':
      return getObstaclePath(id, options.subcategory || 'rocks', options);
    default:
      throw new Error(`Unhandled category: ${category}`);
  }
}

/**
 * Gets the path to the original source image
 *
 * Every asset category maintains an originals/ subdirectory with
 * full-resolution AI-generated source images.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options
 * @param {string} [options.subcategory] - Subcategory for organization
 * @returns {string} The originals path
 *
 * @example
 * getOriginalsPath('portraits', 'human_male_warrior');
 * // => '/assets/portraits/originals/human_male_warrior.webp'
 *
 * @example
 * getOriginalsPath('items', 'sword_iron', { subcategory: 'weapons' });
 * // => '/assets/items/originals/weapons/sword_iron.webp'
 *
 * @example
 * getOriginalsPath('tiles', 'grass_0', { subcategory: 'forest' });
 * // => '/assets/sprites/terrain/originals/forest/grass_0.webp'
 */
export function getOriginalsPath(category, id, options = {}) {
  validateCategory(category);

  const { subcategory } = options;

  switch (category) {
    case 'portraits':
    case 'nodes':
      // Originals are always PNG (the true AI-generated source images)
      return `${ASSETS_BASE}/${category}/originals/${id}.png`;

    case 'items':
    case 'icons':
    case 'overlays': {
      const sub = subcategory || (category === 'items' ? 'weapons' : category === 'icons' ? 'actions' : 'rarity');
      // Originals are always PNG (the true AI-generated source images)
      return `${ASSETS_BASE}/${category}/originals/${sub}/${id}.png`;
    }

    case 'tiles': {
      const biome = subcategory || 'forest';
      // Originals are always PNG (the true AI-generated source images)
      return `${ASSETS_BASE}/sprites/terrain/originals/${biome}/${id}.png`;
    }

    case 'characters': {
      // Characters don't have traditional originals - reference images serve this purpose
      const dir = getCharacterDirectory(id, options);
      return `${dir}/${id}_reference.png`;
    }

    case 'obstacles': {
      const obsCategory = subcategory || 'rocks';
      // Originals are always PNG (the true AI-generated source images)
      return `${ASSETS_BASE}/obstacles/originals/${obsCategory}/${id}.png`;
    }

    default:
      throw new Error(`Unhandled category: ${category}`);
  }
}

/**
 * Gets the output path for asset generation scripts
 *
 * Returns a relative path from the project root suitable for scripts
 * that generate and save asset files.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options
 * @param {string} [options.subcategory] - Subcategory
 * @param {number} [options.size] - Size variant
 * @param {boolean} [options.original] - If true, returns path to originals directory
 * @returns {string} The output path relative to project root
 *
 * @example
 * getOutputPath('portraits', 'human_male_warrior', { size: 64 });
 * // => 'frontend/public/assets/portraits/64/human_male_warrior.webp'
 *
 * @example
 * getOutputPath('nodes', 'castle', { size: 96 });
 * // => 'frontend/public/assets/nodes/96/castle.webp'
 *
 * @example
 * getOutputPath('portraits', 'human_male_warrior', { original: true });
 * // => 'frontend/public/assets/portraits/originals/human_male_warrior.webp'
 */
export function getOutputPath(category, id, options = {}) {
  const { original, ...pathOptions } = options;

  const assetPath = original
    ? getOriginalsPath(category, id, pathOptions)
    : getAssetPath(category, id, pathOptions);

  // Remove leading slash and prepend frontend/public
  return `frontend/public${assetPath}`;
}

/**
 * Gets all size variants for an asset category
 *
 * Useful for generating multiple size variants of the same asset.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Base options (subcategory, etc.)
 * @returns {Array<{size: number, path: string}>} Array of size/path pairs
 *
 * @example
 * getAllSizeVariants('portraits', 'human_male_warrior');
 * // => [
 * //   { size: 64, path: '/assets/portraits/64/human_male_warrior.webp' },
 * //   { size: 128, path: '/assets/portraits/128/human_male_warrior.webp' },
 * //   { size: 256, path: '/assets/portraits/256/human_male_warrior.webp' }
 * // ]
 */
export function getAllSizeVariants(category, id, options = {}) {
  validateCategory(category);

  const sizes = SIZE_PRESETS[category];
  return sizes.map(size => ({
    size,
    path: getAssetPath(category, id, { ...options, size })
  }));
}

/**
 * Checks if a size is valid for a given category
 *
 * @param {string} category - Asset category
 * @param {number} size - Size to check
 * @returns {boolean} True if the size is valid for the category
 *
 * @example
 * isValidSize('icons', 32); // => true
 * isValidSize('icons', 50); // => false
 */
export function isValidSize(category, size) {
  validateCategory(category);
  return SIZE_PRESETS[category].includes(size);
}

/**
 * Gets the default size for a category
 *
 * @param {string} category - Asset category
 * @returns {number} The default size
 */
export function getDefaultSize(category) {
  validateCategory(category);
  return DEFAULT_SIZES[category];
}

/**
 * Gets the optimal available size for a requested display size
 *
 * Returns the smallest preset size that is >= the requested display size,
 * or the largest preset size if the display exceeds all presets.
 * This ensures crisp rendering without unnecessary large assets.
 *
 * @param {string} category - Asset category
 * @param {number} displaySize - Target display size in pixels
 * @returns {number} The optimal preset size to use
 *
 * @example
 * getOptimalSize('portraits', 48);  // => 64 (smallest >= 48)
 * getOptimalSize('portraits', 64);  // => 64 (exact match)
 * getOptimalSize('portraits', 100); // => 128 (smallest >= 100)
 * getOptimalSize('portraits', 300); // => 256 (largest available)
 *
 * @example
 * getOptimalSize('nodes', 40);  // => 48 (smallest >= 40)
 * getOptimalSize('nodes', 60);  // => 64 (smallest >= 60)
 * getOptimalSize('nodes', 120); // => 128 (smallest >= 120)
 * getOptimalSize('nodes', 300); // => 256 (largest available)
 */
export function getOptimalSize(category, displaySize) {
  validateCategory(category);
  const sizes = SIZE_PRESETS[category];

  // Find smallest size >= displaySize
  for (const size of sizes) {
    if (size >= displaySize) return size;
  }

  // If display exceeds all presets, return largest
  return sizes[sizes.length - 1];
}

/**
 * Parses an asset filename to extract id and metadata
 *
 * @param {string} filename - The filename to parse
 * @param {string} category - The asset category (needed for context)
 * @returns {Object|null} Parsed info or null if unable to parse
 *
 * @example
 * parseAssetFilename('human_male_warrior.webp', 'portraits');
 * // => { id: 'human_male_warrior' }
 *
 * @example
 * parseAssetFilename('attack.webp', 'icons');
 * // => { id: 'attack' }
 *
 * @example
 * parseAssetFilename('sword_iron.webp', 'items');
 * // => { id: 'sword_iron' }
 */
export function parseAssetFilename(filename, category) {
  validateCategory(category);

  // Remove .webp extension
  const baseName = filename.replace(/\.webp$/, '');

  // All categories now use simple id without embedded size/subcategory
  return { id: baseName };
}
