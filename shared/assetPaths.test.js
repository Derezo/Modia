/**
 * Asset Paths Unit Tests
 *
 * Comprehensive tests for the single source of truth asset path module.
 * Tests all path generation functions, size presets, and edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  // Constants
  CHARACTER_ANIMATIONS,
  CHARACTER_TYPES,
  ABILITY_ICON_SOURCES,
  PLAYER_ANIMATION_ALIASES,
  ENEMY_BIOMES,
  ENEMY_BIOME_ALIASES,
  NPC_PRIMARY_BIOMES,
  OBSTACLE_CATEGORIES,
  ASSET_CATEGORIES,
  SIZE_PRESETS,
  DEFAULT_SIZES,
  // Character functions
  getCharacterPath,
  getCharacterAnimationPaths,
  getCharacterDirectory,
  getCharacterReferencePath,
  getPlayerCharacterIdentity,
  getPlayerCharacterPath,
  getPlayerCharacterDirectory,
  getPlayerCharacterReferencePath,
  getPlayerCharacterPathCandidates,
  resolvePlayerAnimationName,
  resolveEnemyBiomeAlias,
  getNpcVisualIdentity,
  getNpcSpriteBiomeCandidates,
  getNpcCharacterPathCandidates,
  getNpcPortraitId,
  getAbilityIconPath,
  // Obstacle function
  getObstaclePath,
  // Core path functions
  getAssetPath,
  getOriginalsPath,
  getOutputPath,
  getAllSizeVariants,
  // Size utilities
  isValidSize,
  getDefaultSize,
  getOptimalSize,
  parseAssetFilename
} from './assetPaths.js';

// =============================================================================
// Constants Tests
// =============================================================================

describe('assetPaths constants', () => {
  describe('CHARACTER_ANIMATIONS', () => {
    it('should export all required animation types', () => {
      assert.ok(Array.isArray(CHARACTER_ANIMATIONS));
      assert.strictEqual(CHARACTER_ANIMATIONS.length, 8);
      assert.ok(CHARACTER_ANIMATIONS.includes('idle'));
      assert.ok(CHARACTER_ANIMATIONS.includes('walk'));
      assert.ok(CHARACTER_ANIMATIONS.includes('attack'));
      assert.ok(CHARACTER_ANIMATIONS.includes('hurt'));
      assert.ok(CHARACTER_ANIMATIONS.includes('death'));
      assert.ok(CHARACTER_ANIMATIONS.includes('dead'));
      assert.ok(CHARACTER_ANIMATIONS.includes('cast'));
      assert.ok(CHARACTER_ANIMATIONS.includes('victory'));
    });
  });

  describe('CHARACTER_TYPES', () => {
    it('should include player and enemy types', () => {
      assert.deepStrictEqual(CHARACTER_TYPES, ['player', 'enemy']);
    });
  });

  describe('ABILITY_ICON_SOURCES', () => {
    it('keeps all ability registry source namespaces stable', () => {
      assert.deepStrictEqual(ABILITY_ICON_SOURCES, ['player', 'monster', 'zodiac']);
    });
  });

  describe('PLAYER_ANIMATION_ALIASES', () => {
    it('maps the battle hit state to the authored hurt animation', () => {
      assert.strictEqual(PLAYER_ANIMATION_ALIASES.hit, 'hurt');
      assert.strictEqual(resolvePlayerAnimationName('hit'), 'hurt');
      assert.strictEqual(resolvePlayerAnimationName('attack'), 'attack');
    });
  });

  describe('ENEMY_BIOMES', () => {
    it('should include all biome types', () => {
      assert.deepStrictEqual(ENEMY_BIOMES, ['forest', 'cave', 'mountain', 'bridge', 'castle', 'palace']);
    });
  });

  describe('NPC visual identity registries', () => {
    it('keeps primary homes and world-node aliases immutable', () => {
      assert.equal(Object.isFrozen(NPC_PRIMARY_BIOMES), true);
      assert.equal(Object.isFrozen(ENEMY_BIOME_ALIASES), true);
      assert.strictEqual(NPC_PRIMARY_BIOMES.dark_knight, 'palace');
      assert.strictEqual(NPC_PRIMARY_BIOMES.skeleton_warrior, 'cave');
      assert.strictEqual(resolveEnemyBiomeAlias('guild'), 'castle');
      assert.strictEqual(resolveEnemyBiomeAlias('unknown-zone'), 'forest');
    });
  });

  describe('OBSTACLE_CATEGORIES', () => {
    it('should include rocks and trees', () => {
      assert.deepStrictEqual(OBSTACLE_CATEGORIES, ['rocks', 'trees']);
    });
  });

  describe('ASSET_CATEGORIES', () => {
    it('should include all asset categories', () => {
      const expected = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays', 'characters', 'obstacles'];
      assert.deepStrictEqual(ASSET_CATEGORIES, expected);
    });
  });

  describe('SIZE_PRESETS', () => {
    it('should have correct sizes for tiles (single size)', () => {
      assert.deepStrictEqual(SIZE_PRESETS.tiles, [64]);
    });

    it('should have correct sizes for portraits', () => {
      assert.deepStrictEqual(SIZE_PRESETS.portraits, [32, 48, 64, 128, 256]);
    });

    it('should have correct sizes for items', () => {
      assert.deepStrictEqual(SIZE_PRESETS.items, [32, 64, 128]);
    });

    it('should have correct sizes for icons (including 256)', () => {
      assert.deepStrictEqual(SIZE_PRESETS.icons, [16, 24, 32, 48, 64, 128, 256]);
    });

    it('should have correct sizes for nodes', () => {
      assert.deepStrictEqual(SIZE_PRESETS.nodes, [48, 64, 96, 128, 256]);
    });

    it('should have correct sizes for overlays', () => {
      assert.deepStrictEqual(SIZE_PRESETS.overlays, [32, 48, 64, 128]);
    });

    it('should have correct sizes for characters', () => {
      assert.deepStrictEqual(SIZE_PRESETS.characters, [64]);
    });

    it('should have correct sizes for obstacles', () => {
      assert.deepStrictEqual(SIZE_PRESETS.obstacles, [64]);
    });

    it('should have sizes sorted in ascending order for all categories', () => {
      for (const [category, sizes] of Object.entries(SIZE_PRESETS)) {
        const sorted = [...sizes].sort((a, b) => a - b);
        assert.deepStrictEqual(sizes, sorted, `${category} sizes should be ascending`);
      }
    });
  });

  describe('DEFAULT_SIZES', () => {
    it('should have defaults for all categories', () => {
      // Defaults set to the largest available size for high-quality admin
      // dashboard previews (see assetPaths.js doc comment).
      assert.strictEqual(DEFAULT_SIZES.tiles, 64);
      assert.strictEqual(DEFAULT_SIZES.portraits, 256);
      assert.strictEqual(DEFAULT_SIZES.items, 128);
      assert.strictEqual(DEFAULT_SIZES.icons, 256);
      assert.strictEqual(DEFAULT_SIZES.nodes, 256);
      assert.strictEqual(DEFAULT_SIZES.overlays, 128);
      assert.strictEqual(DEFAULT_SIZES.characters, 64);
      assert.strictEqual(DEFAULT_SIZES.obstacles, 64);
    });

    it('should have defaults that exist in SIZE_PRESETS', () => {
      for (const [category, defaultSize] of Object.entries(DEFAULT_SIZES)) {
        const presets = SIZE_PRESETS[category];
        assert.ok(presets.includes(defaultSize),
          `Default ${defaultSize} for ${category} should be in SIZE_PRESETS`);
      }
    });
  });
});

describe('getAbilityIconPath', () => {
  it('builds source-scoped canonical ability paths', () => {
    assert.strictEqual(
      getAbilityIconPath('Alchemical_Warfare', { source: 'player' }),
      '/assets/abilities/icons/player/alchemical_warfare.webp'
    );
    assert.strictEqual(
      getAbilityIconPath('dreamwave', { source: 'zodiac' }),
      '/assets/abilities/icons/zodiac/dreamwave.webp'
    );
  });

  it('rejects malformed ids and unknown sources', () => {
    assert.strictEqual(getAbilityIconPath('../escape', { source: 'player' }), null);
    assert.strictEqual(getAbilityIconPath('fireball', { source: 'other' }), null);
  });
});

describe('canonical NPC asset identity', () => {
  it('prefers the nested DTO identity over legacy aliases', () => {
    assert.deepStrictEqual(getNpcVisualIdentity({
      visualIdentity: {
        kind: 'npc',
        visualId: 'Guildmaster_Wizard',
        primaryBiome: 'guild'
      },
      enemyId: 'wrong_legacy_id',
      biome: 'mountain'
    }), {
      visualId: 'guildmaster_wizard',
      primaryBiome: 'guild'
    });
  });

  it('keeps a registered multi-zone NPC in its canonical art home', () => {
    assert.deepStrictEqual(getNpcVisualIdentity({
      enemyId: 'dark_knight',
      primaryBiome: 'castle',
      biome: 'cave'
    }), {
      visualId: 'dark_knight',
      primaryBiome: 'palace'
    });
    assert.deepStrictEqual(getNpcSpriteBiomeCandidates('dark_knight', 'castle'), [
      'palace', 'castle'
    ]);
  });

  it('uses DTO primary biome and its alias for special NPCs outside the registry', () => {
    const guildmaster = {
      visualIdentity: {
        visualId: 'guildmaster_wizard',
        primaryBiome: 'guild'
      },
      biome: 'mountain'
    };
    assert.deepStrictEqual(getNpcSpriteBiomeCandidates(guildmaster, 'mountain'), [
      'guild', 'castle', 'mountain'
    ]);
    assert.strictEqual(getNpcPortraitId(guildmaster), 'enemy_guildmaster_wizard');
    assert.deepStrictEqual(getNpcCharacterPathCandidates(guildmaster, {
      requestedBiome: 'mountain',
      animations: ['dead', 'death']
    }), [
      '/assets/characters/enemies/guild/guildmaster_wizard/guildmaster_wizard_dead.webp',
      '/assets/characters/enemies/guild/guildmaster_wizard/guildmaster_wizard_death.webp',
      '/assets/characters/enemies/castle/guildmaster_wizard/guildmaster_wizard_dead.webp',
      '/assets/characters/enemies/castle/guildmaster_wizard/guildmaster_wizard_death.webp',
      '/assets/characters/enemies/mountain/guildmaster_wizard/guildmaster_wizard_dead.webp',
      '/assets/characters/enemies/mountain/guildmaster_wizard/guildmaster_wizard_death.webp'
    ]);
  });

  it('normalizes every supported legacy sprite-id spelling', () => {
    assert.strictEqual(getNpcPortraitId({ sprite_id: 'Gray Wolf' }), 'enemy_gray_wolf');
    assert.strictEqual(getNpcPortraitId({ spriteId: 'bridge-bandit' }), 'enemy_bridge_bandit');
  });

  it('resolves approved authored NPC identities through their own canonical sprite paths', () => {
    assert.deepStrictEqual(getNpcCharacterPathCandidates('bandit_captain', {
      requestedBiome: 'bridge',
      animation: 'attack'
    }), [
      '/assets/characters/enemies/bridge/bandit_captain/bandit_captain_attack.webp'
    ]);
    assert.deepStrictEqual(getNpcCharacterPathCandidates('palace_guard', {
      requestedBiome: 'palace',
      animation: 'attack'
    }), [
      '/assets/characters/enemies/palace/palace_guard/palace_guard_attack.webp'
    ]);
    assert.strictEqual(
      getNpcPortraitId({ enemyId: 'bandit_captain' }),
      'enemy_bandit_captain'
    );
  });
});

// =============================================================================
// Character Path Tests
// =============================================================================

describe('getCharacterPath', () => {
  it('should generate player character path with default animation', () => {
    const path = getCharacterPath('warrior');
    assert.strictEqual(path, '/assets/characters/player/warrior/warrior_idle.webp');
  });

  it('should generate player character path with specified animation', () => {
    const path = getCharacterPath('mage', { animation: 'attack' });
    assert.strictEqual(path, '/assets/characters/player/mage/mage_attack.webp');
  });

  it('should generate enemy character path', () => {
    const path = getCharacterPath('goblin_warrior', { type: 'enemy', biome: 'forest' });
    assert.strictEqual(path, '/assets/characters/enemies/forest/goblin_warrior/goblin_warrior_idle.webp');
  });

  it('should generate enemy character path with animation', () => {
    const path = getCharacterPath('skeleton', { type: 'enemy', biome: 'cave', animation: 'dead' });
    assert.strictEqual(path, '/assets/characters/enemies/cave/skeleton/skeleton_dead.webp');
  });

  it('should accept "enemies" as type alias', () => {
    const path = getCharacterPath('orc', { type: 'enemies', biome: 'mountain' });
    assert.strictEqual(path, '/assets/characters/enemies/mountain/orc/orc_idle.webp');
  });

  it('should support custom extension', () => {
    const path = getCharacterPath('warrior', { animation: 'idle', extension: 'png' });
    assert.strictEqual(path, '/assets/characters/player/warrior/warrior_idle.png');
  });

  it('should opt into portrait-matched paths when race and gender are supplied', () => {
    const path = getCharacterPath('martial_artist', {
      race: 'Elf',
      gender: 'Female',
      animation: 'hit'
    });
    assert.strictEqual(
      path,
      '/assets/characters/player/elf/female/martial_artist/elf_female_martial_artist_hurt.webp'
    );
  });

  it('should throw error for enemy without biome', () => {
    assert.throws(() => {
      getCharacterPath('goblin', { type: 'enemy' });
    }, /biome required/);
  });

  it('should handle all animation types', () => {
    for (const animation of CHARACTER_ANIMATIONS) {
      const path = getCharacterPath('warrior', { animation });
      assert.ok(path.includes(`warrior_${animation}.webp`), `Should include ${animation}`);
    }
  });
});

describe('portrait-matched player character paths', () => {
  const character = { race: 'High Elf', gender: 'Other', class: 'Martial Artist' };

  it('uses the same race-gender-class identity as portrait cards', () => {
    assert.deepStrictEqual(getPlayerCharacterIdentity(character), {
      id: 'high_elf_other_martial_artist',
      race: 'high_elf',
      gender: 'other',
      className: 'martial_artist'
    });
  });

  it('builds canonical variant paths and directories', () => {
    assert.strictEqual(
      getPlayerCharacterDirectory(character),
      '/assets/characters/player/high_elf/other/martial_artist'
    );
    assert.strictEqual(
      getPlayerCharacterPath(character, { animation: 'walk' }),
      '/assets/characters/player/high_elf/other/martial_artist/high_elf_other_martial_artist_walk.webp'
    );
    assert.strictEqual(
      getPlayerCharacterReferencePath(character),
      '/assets/characters/player/high_elf/other/martial_artist/high_elf_other_martial_artist_reference.png'
    );
  });

  it('keeps identity-aware runtime lookups on the canonical variant', () => {
    assert.deepStrictEqual(getPlayerCharacterPathCandidates(character, { animation: 'hit' }), [
      '/assets/characters/player/high_elf/other/martial_artist/high_elf_other_martial_artist_hurt.webp'
    ]);
  });

  it('reads an authoritative nested battle identity before stale top-level aliases', () => {
    assert.deepStrictEqual(getPlayerCharacterIdentity({
      race: 'human',
      gender: 'male',
      class: 'warrior',
      visualIdentity: {
        kind: 'player',
        race: 'Dwarf',
        gender: 'Other',
        class: 'Wizard'
      }
    }), {
      id: 'dwarf_other_wizard',
      race: 'dwarf',
      gender: 'other',
      className: 'wizard'
    });
  });

  it('retains an explicit migration-only class fallback', () => {
    assert.deepStrictEqual(getPlayerCharacterPathCandidates(character, {
      animation: 'hit',
      includeLegacyFallback: true
    }), [
      '/assets/characters/player/high_elf/other/martial_artist/high_elf_other_martial_artist_hurt.webp',
      '/assets/characters/player/martial_artist/martial_artist_hurt.webp'
    ]);
  });

  it('uses a completed death strip as the final-pose fallback for dead', () => {
    assert.deepStrictEqual(getPlayerCharacterPathCandidates(character, { animation: 'dead' }), [
      '/assets/characters/player/high_elf/other/martial_artist/high_elf_other_martial_artist_dead.webp',
      '/assets/characters/player/high_elf/other/martial_artist/high_elf_other_martial_artist_death.webp'
    ]);
  });
});

describe('getCharacterAnimationPaths', () => {
  it('should return all animation paths by default', () => {
    const paths = getCharacterAnimationPaths('warrior');
    assert.strictEqual(paths.length, CHARACTER_ANIMATIONS.length);
    assert.ok(paths.some(p => p.animation === 'idle'));
    assert.ok(paths.some(p => p.animation === 'dead'));
  });

  it('should filter by specified animations', () => {
    const paths = getCharacterAnimationPaths('warrior', { animations: ['idle', 'attack'] });
    assert.strictEqual(paths.length, 2);
    assert.strictEqual(paths[0].animation, 'idle');
    assert.strictEqual(paths[1].animation, 'attack');
  });

  it('should work for enemies', () => {
    const paths = getCharacterAnimationPaths('goblin', {
      type: 'enemy',
      biome: 'forest',
      animations: ['idle', 'dead']
    });
    assert.strictEqual(paths.length, 2);
    assert.strictEqual(paths[0].path, '/assets/characters/enemies/forest/goblin/goblin_idle.webp');
    assert.strictEqual(paths[1].path, '/assets/characters/enemies/forest/goblin/goblin_dead.webp');
  });

  it('should return path objects with animation and path properties', () => {
    const paths = getCharacterAnimationPaths('warrior', { animations: ['idle'] });
    assert.strictEqual(paths.length, 1);
    assert.ok('animation' in paths[0]);
    assert.ok('path' in paths[0]);
  });
});

describe('getCharacterDirectory', () => {
  it('should return player character directory', () => {
    const dir = getCharacterDirectory('warrior');
    assert.strictEqual(dir, '/assets/characters/player/warrior');
  });

  it('should return enemy character directory', () => {
    const dir = getCharacterDirectory('goblin', { type: 'enemy', biome: 'forest' });
    assert.strictEqual(dir, '/assets/characters/enemies/forest/goblin');
  });

  it('should throw for enemy without biome', () => {
    assert.throws(() => {
      getCharacterDirectory('goblin', { type: 'enemy' });
    }, /biome required/);
  });

  it('should return a portrait-matched player directory when identity fields are supplied', () => {
    assert.strictEqual(
      getCharacterDirectory('wizard', { race: 'orc', gender: 'male' }),
      '/assets/characters/player/orc/male/wizard'
    );
  });
});

describe('getCharacterReferencePath', () => {
  it('should return player reference path', () => {
    const path = getCharacterReferencePath('warrior');
    assert.strictEqual(path, '/assets/characters/player/warrior/warrior_reference.png');
  });

  it('should return enemy reference path', () => {
    const path = getCharacterReferencePath('goblin', { type: 'enemy', biome: 'forest' });
    assert.strictEqual(path, '/assets/characters/enemies/forest/goblin/goblin_reference.png');
  });

  it('should return a portrait-matched player reference path', () => {
    assert.strictEqual(
      getCharacterReferencePath('wizard', { race: 'orc', gender: 'male' }),
      '/assets/characters/player/orc/male/wizard/orc_male_wizard_reference.png'
    );
  });
});

// =============================================================================
// Obstacle Path Tests
// =============================================================================

describe('getObstaclePath', () => {
  it('should generate rock obstacle path', () => {
    const path = getObstaclePath('rock_small', 'rocks');
    assert.strictEqual(path, '/assets/obstacles/rocks/rock_small.webp');
  });

  it('should generate tree obstacle path', () => {
    const path = getObstaclePath('tree_oak', 'trees');
    assert.strictEqual(path, '/assets/obstacles/trees/tree_oak.webp');
  });

  it('should support custom extension', () => {
    const path = getObstaclePath('rock_large', 'rocks', { extension: 'png' });
    assert.strictEqual(path, '/assets/obstacles/rocks/rock_large.png');
  });

  it('should throw for invalid category', () => {
    assert.throws(() => {
      getObstaclePath('boulder', 'invalid');
    }, /Invalid obstacle category/);
  });
});

// =============================================================================
// Core Path Function Tests
// =============================================================================

describe('getAssetPath', () => {
  describe('portraits', () => {
    it('should generate player portrait path', () => {
      const path = getAssetPath('portraits', 'human_male_warrior', { size: 64 });
      assert.strictEqual(path, '/assets/portraits/64/human_male_warrior.webp');
    });

    it('should generate enemy portrait path (with enemy_ prefix)', () => {
      const path = getAssetPath('portraits', 'enemy_goblin_warrior', { size: 64 });
      assert.strictEqual(path, '/assets/portraits/64/enemy_goblin_warrior.webp');
    });

    it('should use default size when not specified', () => {
      const path = getAssetPath('portraits', 'human_male_warrior');
      assert.strictEqual(path, '/assets/portraits/256/human_male_warrior.webp');
    });

    it('should support all portrait sizes', () => {
      for (const size of SIZE_PRESETS.portraits) {
        const path = getAssetPath('portraits', 'test', { size });
        assert.ok(path.includes(`/${size}/`), `Should include size ${size}`);
      }
    });
  });

  describe('nodes', () => {
    it('should generate node path without node_ prefix', () => {
      const path = getAssetPath('nodes', 'castle', { size: 96 });
      assert.strictEqual(path, '/assets/nodes/96/castle.webp');
    });

    it('should use default size when not specified', () => {
      const path = getAssetPath('nodes', 'tavern');
      assert.strictEqual(path, '/assets/nodes/256/tavern.webp');
    });
  });

  describe('items', () => {
    it('should generate item path with subcategory', () => {
      const path = getAssetPath('items', 'sword_iron', { subcategory: 'weapons', size: 64 });
      assert.strictEqual(path, '/assets/items/64/weapons/sword_iron.webp');
    });

    it('should default to weapons subcategory', () => {
      const path = getAssetPath('items', 'sword_iron', { size: 64 });
      assert.strictEqual(path, '/assets/items/64/weapons/sword_iron.webp');
    });
  });

  describe('icons', () => {
    it('should generate icon path with png subdirectory', () => {
      const path = getAssetPath('icons', 'attack', { subcategory: 'actions', size: 32 });
      assert.strictEqual(path, '/assets/icons/png/32/actions/attack.webp');
    });

    it('should default to actions subcategory', () => {
      const path = getAssetPath('icons', 'attack', { size: 32 });
      assert.strictEqual(path, '/assets/icons/png/32/actions/attack.webp');
    });

    it('should use default size when not specified', () => {
      const path = getAssetPath('icons', 'attack');
      assert.strictEqual(path, '/assets/icons/png/256/actions/attack.webp');
    });
  });

  describe('tiles', () => {
    it('should generate terrain tile path with biome', () => {
      const path = getAssetPath('tiles', 'grass_0', { subcategory: 'forest' });
      assert.strictEqual(path, '/assets/sprites/terrain/forest/grass_0.webp');
    });

    it('should support wall tile naming', () => {
      const path = getAssetPath('tiles', 'wall_forest_default', { subcategory: 'forest' });
      assert.strictEqual(path, '/assets/sprites/terrain/forest/wall_forest_default.webp');
    });

    it('should support slope tile naming', () => {
      const path = getAssetPath('tiles', 'slope_forest_north_1', { subcategory: 'forest' });
      assert.strictEqual(path, '/assets/sprites/terrain/forest/slope_forest_north_1.webp');
    });
  });

  describe('overlays', () => {
    it('should generate overlay path', () => {
      const path = getAssetPath('overlays', 'rare', { subcategory: 'rarity', size: 64 });
      assert.strictEqual(path, '/assets/overlays/64/rarity/rare.webp');
    });
  });

  describe('characters', () => {
    it('should handle characters category', () => {
      const path = getAssetPath('characters', 'warrior', { animation: 'attack' });
      assert.strictEqual(path, '/assets/characters/player/warrior/warrior_attack.webp');
    });
  });

  describe('obstacles', () => {
    it('should handle obstacles category with default subcategory', () => {
      const path = getAssetPath('obstacles', 'rock_small');
      assert.strictEqual(path, '/assets/obstacles/rocks/rock_small.webp');
    });

    it('should handle obstacles category with explicit subcategory', () => {
      const path = getAssetPath('obstacles', 'tree_oak', { subcategory: 'trees' });
      assert.strictEqual(path, '/assets/obstacles/trees/tree_oak.webp');
    });
  });

  describe('error handling', () => {
    it('should throw for invalid category', () => {
      assert.throws(() => {
        getAssetPath('invalid_category', 'test');
      }, /Invalid asset category/);
    });
  });
});

describe('getOriginalsPath', () => {
  it('should return portrait originals path with PNG extension', () => {
    const path = getOriginalsPath('portraits', 'human_male_warrior');
    assert.strictEqual(path, '/assets/portraits/originals/human_male_warrior.png');
  });

  it('should return node originals path with PNG extension', () => {
    const path = getOriginalsPath('nodes', 'castle');
    assert.strictEqual(path, '/assets/nodes/originals/castle.png');
  });

  it('should return item originals path with subcategory and PNG extension', () => {
    const path = getOriginalsPath('items', 'sword_iron', { subcategory: 'weapons' });
    assert.strictEqual(path, '/assets/items/originals/weapons/sword_iron.png');
  });

  it('should return icon originals path with subcategory and PNG extension', () => {
    const path = getOriginalsPath('icons', 'attack', { subcategory: 'actions' });
    assert.strictEqual(path, '/assets/icons/originals/actions/attack.png');
  });

  it('should return tile originals path with biome and PNG extension', () => {
    const path = getOriginalsPath('tiles', 'grass_0', { subcategory: 'forest' });
    assert.strictEqual(path, '/assets/sprites/terrain/originals/forest/grass_0.png');
  });

  it('should return overlay originals path with PNG extension', () => {
    const path = getOriginalsPath('overlays', 'rare', { subcategory: 'rarity' });
    assert.strictEqual(path, '/assets/overlays/originals/rarity/rare.png');
  });

  it('should return character reference path for characters (already PNG)', () => {
    const path = getOriginalsPath('characters', 'warrior');
    assert.strictEqual(path, '/assets/characters/player/warrior/warrior_reference.png');
  });

  it('should return enemy reference path for enemy characters (already PNG)', () => {
    const path = getOriginalsPath('characters', 'goblin', { type: 'enemy', biome: 'forest' });
    assert.strictEqual(path, '/assets/characters/enemies/forest/goblin/goblin_reference.png');
  });

  it('should return obstacle originals path with PNG extension', () => {
    const path = getOriginalsPath('obstacles', 'rock_small', { subcategory: 'rocks' });
    assert.strictEqual(path, '/assets/obstacles/originals/rocks/rock_small.png');
  });

  it('should use default subcategories when not specified', () => {
    const itemPath = getOriginalsPath('items', 'sword');
    assert.ok(itemPath.includes('/weapons/'));

    const iconPath = getOriginalsPath('icons', 'attack');
    assert.ok(iconPath.includes('/actions/'));

    const overlayPath = getOriginalsPath('overlays', 'rare');
    assert.ok(overlayPath.includes('/rarity/'));
  });
});

describe('getOutputPath', () => {
  it('should prepend frontend/public to portrait paths', () => {
    const path = getOutputPath('portraits', 'human_male_warrior', { size: 64 });
    assert.strictEqual(path, 'frontend/public/assets/portraits/64/human_male_warrior.webp');
  });

  it('should prepend frontend/public to node paths', () => {
    const path = getOutputPath('nodes', 'castle', { size: 96 });
    assert.strictEqual(path, 'frontend/public/assets/nodes/96/castle.webp');
  });

  it('should return originals path when original option is true (PNG for originals)', () => {
    const path = getOutputPath('portraits', 'human_male_warrior', { original: true });
    assert.strictEqual(path, 'frontend/public/assets/portraits/originals/human_male_warrior.png');
  });

  it('should prepend frontend/public to character paths', () => {
    const path = getOutputPath('characters', 'warrior', { animation: 'idle' });
    assert.strictEqual(path, 'frontend/public/assets/characters/player/warrior/warrior_idle.webp');
  });

  it('should prepend frontend/public to obstacle paths', () => {
    const path = getOutputPath('obstacles', 'rock_small', { subcategory: 'rocks' });
    assert.strictEqual(path, 'frontend/public/assets/obstacles/rocks/rock_small.webp');
  });
});

describe('getAllSizeVariants', () => {
  it('should return all size variants for portraits', () => {
    const variants = getAllSizeVariants('portraits', 'human_male_warrior');
    assert.strictEqual(variants.length, SIZE_PRESETS.portraits.length);
    assert.deepStrictEqual(variants.map(v => v.size), [32, 48, 64, 128, 256]);
  });

  it('should return all size variants for icons', () => {
    const variants = getAllSizeVariants('icons', 'attack', { subcategory: 'actions' });
    assert.strictEqual(variants.length, SIZE_PRESETS.icons.length);
    assert.deepStrictEqual(variants.map(v => v.size), [16, 24, 32, 48, 64, 128, 256]);
  });

  it('should include correct paths for each size', () => {
    const variants = getAllSizeVariants('portraits', 'test');
    for (const { size, path } of variants) {
      assert.ok(path.includes(`/${size}/`), `Path should include size ${size}`);
    }
  });

  it('should throw for invalid category', () => {
    assert.throws(() => {
      getAllSizeVariants('invalid', 'test');
    }, /Invalid asset category/);
  });
});

// =============================================================================
// Size Utility Tests
// =============================================================================

describe('isValidSize', () => {
  it('should return true for valid icon sizes', () => {
    assert.strictEqual(isValidSize('icons', 32), true);
    assert.strictEqual(isValidSize('icons', 16), true);
    assert.strictEqual(isValidSize('icons', 256), true);
  });

  it('should return false for invalid icon sizes', () => {
    assert.strictEqual(isValidSize('icons', 50), false);
    assert.strictEqual(isValidSize('icons', 100), false);
    assert.strictEqual(isValidSize('icons', 512), false);
  });

  it('should work for all categories', () => {
    for (const [category, sizes] of Object.entries(SIZE_PRESETS)) {
      for (const size of sizes) {
        assert.strictEqual(isValidSize(category, size), true,
          `${size} should be valid for ${category}`);
      }
      // Test an invalid size
      assert.strictEqual(isValidSize(category, 999), false,
        `999 should be invalid for ${category}`);
    }
  });

  it('should throw for invalid category', () => {
    assert.throws(() => {
      isValidSize('invalid', 32);
    }, /Invalid asset category/);
  });
});

describe('getDefaultSize', () => {
  it('should return correct defaults', () => {
    assert.strictEqual(getDefaultSize('tiles'), 64);
    assert.strictEqual(getDefaultSize('portraits'), 256);
    assert.strictEqual(getDefaultSize('items'), 128);
    assert.strictEqual(getDefaultSize('icons'), 256);
    assert.strictEqual(getDefaultSize('nodes'), 256);
    assert.strictEqual(getDefaultSize('overlays'), 128);
    assert.strictEqual(getDefaultSize('characters'), 64);
    assert.strictEqual(getDefaultSize('obstacles'), 64);
  });

  it('should throw for invalid category', () => {
    assert.throws(() => {
      getDefaultSize('invalid');
    }, /Invalid asset category/);
  });
});

describe('getOptimalSize', () => {
  describe('portraits (32, 48, 64, 128, 256)', () => {
    it('should return 32 for sizes <= 32', () => {
      assert.strictEqual(getOptimalSize('portraits', 16), 32);
      assert.strictEqual(getOptimalSize('portraits', 24), 32);
      assert.strictEqual(getOptimalSize('portraits', 32), 32);
    });

    it('should return 48 for sizes 33-48', () => {
      assert.strictEqual(getOptimalSize('portraits', 33), 48);
      assert.strictEqual(getOptimalSize('portraits', 40), 48);
      assert.strictEqual(getOptimalSize('portraits', 48), 48);
    });

    it('should return 64 for sizes 49-64', () => {
      assert.strictEqual(getOptimalSize('portraits', 49), 64);
      assert.strictEqual(getOptimalSize('portraits', 56), 64);
      assert.strictEqual(getOptimalSize('portraits', 64), 64);
    });

    it('should return 128 for sizes 65-128', () => {
      assert.strictEqual(getOptimalSize('portraits', 65), 128);
      assert.strictEqual(getOptimalSize('portraits', 100), 128);
      assert.strictEqual(getOptimalSize('portraits', 128), 128);
    });

    it('should return 256 for sizes 129-256', () => {
      assert.strictEqual(getOptimalSize('portraits', 129), 256);
      assert.strictEqual(getOptimalSize('portraits', 200), 256);
      assert.strictEqual(getOptimalSize('portraits', 256), 256);
    });

    it('should return largest (256) for sizes > 256', () => {
      assert.strictEqual(getOptimalSize('portraits', 300), 256);
      assert.strictEqual(getOptimalSize('portraits', 512), 256);
    });
  });

  describe('nodes (48, 64, 96, 128, 256)', () => {
    it('should return 48 for sizes <= 48', () => {
      assert.strictEqual(getOptimalSize('nodes', 32), 48);
      assert.strictEqual(getOptimalSize('nodes', 40), 48);
      assert.strictEqual(getOptimalSize('nodes', 48), 48);
    });

    it('should return 64 for sizes 49-64', () => {
      assert.strictEqual(getOptimalSize('nodes', 49), 64);
      assert.strictEqual(getOptimalSize('nodes', 60), 64);
      assert.strictEqual(getOptimalSize('nodes', 64), 64);
    });

    it('should return 96 for sizes 65-96', () => {
      assert.strictEqual(getOptimalSize('nodes', 65), 96);
      assert.strictEqual(getOptimalSize('nodes', 80), 96);
      assert.strictEqual(getOptimalSize('nodes', 96), 96);
    });

    it('should return 128 for sizes 97-128', () => {
      assert.strictEqual(getOptimalSize('nodes', 97), 128);
      assert.strictEqual(getOptimalSize('nodes', 120), 128);
      assert.strictEqual(getOptimalSize('nodes', 128), 128);
    });

    it('should return 256 for sizes > 128', () => {
      assert.strictEqual(getOptimalSize('nodes', 129), 256);
      assert.strictEqual(getOptimalSize('nodes', 300), 256);
    });
  });

  describe('icons (16, 24, 32, 48, 64, 128, 256)', () => {
    it('should return 16 for sizes <= 16', () => {
      assert.strictEqual(getOptimalSize('icons', 8), 16);
      assert.strictEqual(getOptimalSize('icons', 16), 16);
    });

    it('should return 24 for sizes 17-24', () => {
      assert.strictEqual(getOptimalSize('icons', 17), 24);
      assert.strictEqual(getOptimalSize('icons', 24), 24);
    });

    it('should return 32 for sizes 25-32', () => {
      assert.strictEqual(getOptimalSize('icons', 25), 32);
      assert.strictEqual(getOptimalSize('icons', 32), 32);
    });
  });

  it('should throw for invalid category', () => {
    assert.throws(() => {
      getOptimalSize('invalid', 64);
    }, /Invalid asset category/);
  });
});

describe('parseAssetFilename', () => {
  it('should extract id from portrait filename', () => {
    const result = parseAssetFilename('human_male_warrior.webp', 'portraits');
    assert.deepStrictEqual(result, { id: 'human_male_warrior' });
  });

  it('should extract id from icon filename', () => {
    const result = parseAssetFilename('attack.webp', 'icons');
    assert.deepStrictEqual(result, { id: 'attack' });
  });

  it('should extract id from item filename', () => {
    const result = parseAssetFilename('sword_iron.webp', 'items');
    assert.deepStrictEqual(result, { id: 'sword_iron' });
  });

  it('should handle filenames without .webp extension', () => {
    const result = parseAssetFilename('test', 'portraits');
    assert.deepStrictEqual(result, { id: 'test' });
  });

  it('should throw for invalid category', () => {
    assert.throws(() => {
      parseAssetFilename('test.webp', 'invalid');
    }, /Invalid asset category/);
  });
});

// =============================================================================
// Edge Cases and Consistency Tests
// =============================================================================

describe('path consistency', () => {
  it('should use consistent webp extension by default', () => {
    const paths = [
      getAssetPath('portraits', 'test', { size: 64 }),
      getAssetPath('nodes', 'test', { size: 96 }),
      getAssetPath('items', 'test', { size: 64 }),
      getAssetPath('icons', 'test', { size: 32 }),
      getAssetPath('overlays', 'test', { size: 64 }),
      getAssetPath('tiles', 'test', { subcategory: 'forest' })
    ];

    for (const path of paths) {
      assert.ok(path.endsWith('.webp'), `Path should end with .webp: ${path}`);
    }
  });

  it('should place size in directory, not filename for sized assets', () => {
    // Size should be in path, not in filename (e.g., /64/sword_iron.webp, not /sword_iron_64.webp)
    const itemPath = getAssetPath('items', 'sword_iron', { size: 32, subcategory: 'weapons' });
    assert.ok(itemPath.includes('/32/'), 'Size should be in directory path');
    assert.ok(!itemPath.includes('_32.'), 'Size should not be in filename');
  });

  it('should not use node_ prefix for nodes', () => {
    const nodePath = getAssetPath('nodes', 'castle', { size: 96 });
    assert.ok(!nodePath.includes('node_castle'), 'Should not have node_ prefix');
    assert.ok(nodePath.includes('/castle.'), 'Should use castle directly');
  });

  it('should handle enemy_ prefix consistently for enemy portraits', () => {
    const enemyPath = getAssetPath('portraits', 'enemy_goblin', { size: 64 });
    assert.ok(enemyPath.includes('enemy_goblin'), 'Should preserve enemy_ prefix');
  });
});

describe('SIZE_PRESETS consistency with resizeUtils', () => {
  it('should have same categories as in the source of truth', () => {
    // The categories defined here should be complete
    const expectedCategories = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays', 'characters', 'obstacles'];

    for (const category of expectedCategories) {
      assert.ok(SIZE_PRESETS[category], `SIZE_PRESETS should include ${category}`);
      assert.ok(DEFAULT_SIZES[category] !== undefined, `DEFAULT_SIZES should include ${category}`);
    }
  });

  it('icons should include 256 for high-DPI displays', () => {
    assert.ok(SIZE_PRESETS.icons.includes(256), 'Icons should support 256px for high-DPI');
  });

  it('nodes should include 48 for small display and 256 for large', () => {
    assert.ok(SIZE_PRESETS.nodes.includes(48), 'Nodes should support 48px minimum');
    assert.ok(SIZE_PRESETS.nodes.includes(256), 'Nodes should support 256px maximum');
  });
});
