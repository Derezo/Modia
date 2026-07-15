/**
 * @module admin/shared
 * @description Shared utilities and helper functions for admin sub-routers
 *
 * Key responsibilities:
 * - Path and directory constants
 * - Utility module loading
 * - Asset finding and enrichment helpers
 * - Prompt construction for portraits and characters
 * - Common middleware (requireDevMode)
 */

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError } from '../../middleware/errorHandler.js';
import { loadJsonFile } from '../../utils/jsonFileUtils.js';
import { VALID_CATEGORIES } from '../../utils/assetConstants.js';
import { getAssetPath, DEFAULT_SIZES } from '../../../../shared/assetPaths.js';

// Get project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
export const METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata');
export const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts/ai-images');
export const PRESETS_DIR = path.join(METADATA_DIR, 'theme-presets');

// Create require for CommonJS modules
const require = createRequire(import.meta.url);

// Load CommonJS utilities from scripts directory
export let metadataUtils = null;
export let backupUtils = null;

try {
  metadataUtils = require(path.join(SCRIPTS_DIR, 'lib/metadataUtils.js'));
  backupUtils = require(path.join(SCRIPTS_DIR, 'lib/backupUtils.js'));
} catch (error) {
  console.warn('[Admin] Failed to load metadata utilities:', error.message);
  // Will fail on first use with helpful error
}

// SECURITY: Admin mode is STRICTLY disabled in production
const isProduction = process.env.NODE_ENV === 'production';

// Cached trait data for prompt construction
let cachedTraitData = null;

/**
 * Helper to ensure utilities are loaded
 */
export function ensureUtilities() {
  if (!metadataUtils) {
    throw new AppError('Metadata utilities not available', 500);
  }
}

/**
 * Middleware to check admin mode is enabled
 * SECURITY: Explicitly blocks production even if DEBUG=true is set
 */
export function requireDevMode(req, res, next) {
  if (isProduction) {
    console.warn(`[SECURITY] Admin endpoint access attempted in production by IP: ${req.ip}`);
    return res.status(403).json({
      error: 'Admin endpoints are disabled in production'
    });
  }
  next();
}

/**
 * Load trait data from portrait metadata files (cached)
 */
export async function loadTraitData() {
  if (cachedTraitData) return cachedTraitData;

  const playerPath = path.join(METADATA_DIR, 'portraits/combinations.json');
  const enemyPath = path.join(METADATA_DIR, 'portraits/enemies.json');

  const [playerData, enemyData] = await Promise.all([
    loadJsonFile(playerPath),
    loadJsonFile(enemyPath),
  ]);

  cachedTraitData = {
    // Player traits
    raceTraits: playerData?.raceTraits || {},
    genderTraits: playerData?.genderTraits || {},
    classTraits: playerData?.classTraits || {},
    advancedClassTraits: playerData?.advancedClassTraits || {},
    // Enemy traits
    archetypeTraits: enemyData?.archetypeTraits || {},
    regionTraits: enemyData?.regionTraits || {},
  };

  return cachedTraitData;
}

/**
 * Construct a prompt for a portrait asset
 * @param {object} portrait - Portrait asset metadata
 * @param {object} traitData - Trait lookup data
 * @returns {object} { basePrompt, components }
 */
export function constructPortraitPrompt(portrait, traitData) {
  // For enemy portraits
  if (portrait._type === 'enemy' || portrait.type === 'enemy') {
    const archetypeVal = traitData.archetypeTraits?.[portrait.archetype] || '';
    const regionVal = traitData.regionTraits?.[portrait.region] || '';
    const visualVal = portrait.visualTraits || '';

    return {
      basePrompt: [visualVal, archetypeVal, regionVal].filter(Boolean).join(' ').trim(),
      components: {
        archetype: { key: portrait.archetype, value: archetypeVal },
        region: { key: portrait.region, value: regionVal },
        visualTraits: { value: visualVal },
      },
    };
  }

  // For player portraits
  const raceVal = traitData.raceTraits?.[portrait.race] || '';
  const genderVal = traitData.genderTraits?.[portrait.gender] || '';

  // Determine if using advanced class
  const isAdvanced = !!traitData.advancedClassTraits?.[portrait.class];
  const classVal = isAdvanced
    ? traitData.advancedClassTraits[portrait.class]
    : traitData.classTraits?.[portrait.class] || '';

  return {
    basePrompt: [raceVal, genderVal, classVal].filter(Boolean).join(' ').trim(),
    components: {
      race: { key: portrait.race, value: raceVal },
      gender: { key: portrait.gender, value: genderVal },
      class: { key: portrait.class, value: classVal, isAdvanced },
    },
  };
}

/**
 * Construct a prompt for a character sprite asset
 * Characters have different trait data than portraits:
 * - Players: classTraits (visualTraits, attackStyle) + stylePrefix
 * - Enemies: biomeTraits + archetypeTraits
 * @param {object} character - Character asset metadata
 * @returns {object} { basePrompt, components }
 */
export function constructCharacterPrompt(character) {
  const isPlayer = character._type === 'player';
  const stylePrefix = character._stylePrefix || '';

  if (isPlayer) {
    // Player characters: stylePrefix + class visual traits
    const classTraits = character._classTraits || {};
    const visualTraits = classTraits.visualTraits || '';

    return {
      basePrompt: [stylePrefix, visualTraits].filter(Boolean).join(' ').trim(),
      components: {
        stylePrefix: { value: stylePrefix },
        class: { key: character.class, visualTraits },
      },
    };
  } else {
    // Enemy characters: stylePrefix + biome traits + archetype traits
    const biomeTraits = character._biomeTraits || '';
    const archetypeTraits = character._archetypeTraits || '';

    return {
      basePrompt: [stylePrefix, biomeTraits, archetypeTraits].filter(Boolean).join(' ').trim(),
      components: {
        stylePrefix: { value: stylePrefix },
        biome: { key: character._biome, value: biomeTraits },
        archetype: { key: character.archetype, value: archetypeTraits },
      },
    };
  }
}

/**
 * Construct full prompt with theme data for any asset
 * @param {object} asset - Asset metadata
 * @param {string} category - Asset category
 * @param {object} theme - Theme configuration
 * @param {object} traitData - Trait lookup data (for portraits)
 * @returns {object} Full prompt construction breakdown
 */
export function constructFullPrompt(asset, category, theme, traitData = null) {
  const styleTrigger = theme?.style?.trigger || 'wbgmsst';
  const styleBase = theme?.style?.basePhrase || 'ink and wash watercolor illustration';
  const categorySuffix = theme?.categoryModifiers?.[category]?.suffix || '';
  const negativePrompt = theme?.negativePrompt || '';

  let basePrompt = asset.prompt || '';
  let traitComponents = null;

  // For portraits, construct from traits if no custom prompt
  if (category === 'portraits' && traitData && !asset.prompt) {
    const constructed = constructPortraitPrompt(asset, traitData);
    basePrompt = constructed.basePrompt;
    traitComponents = constructed.components;
  }

  // For characters (sprite sheets), construct from class/biome traits if no custom prompt
  if (category === 'characters' && !asset.prompt) {
    const constructed = constructCharacterPrompt(asset);
    basePrompt = constructed.basePrompt;
    traitComponents = constructed.components;
  }

  // Full prompt assembly
  const fullPrompt = [styleTrigger, styleBase, basePrompt, categorySuffix]
    .filter(Boolean)
    .join(', ')
    .trim();

  return {
    styleTrigger,
    styleBase,
    basePrompt,
    traitComponents,
    categorySuffix,
    fullPrompt,
    negativePrompt,
  };
}

/**
 * Get the subcategory for an asset based on category
 */
export function getAssetSubcategory(asset, category) {
  switch (category) {
    case 'tiles':
      return asset._biome || asset.outputPath || 'base';
    case 'items':
      return asset._itemCategory || asset._subcategory || 'weapons';
    case 'icons':
      return asset._iconCategory || asset._subcategory || 'actions';
    case 'overlays':
      return asset._overlayCategory || asset._subcategory || 'rarity';
    case 'obstacles':
      return asset._obstacleCategory || asset._subcategory || 'rocks';
    case 'characters':
      // Characters use _type (player/enemy) as the subcategory
      return asset._type || 'player';
    default:
      return null;
  }
}

/**
 * Add computed path to asset
 */
export function enrichAssetWithPath(asset, category) {
  const id = asset.key || asset.id;
  const subcategory = getAssetSubcategory(asset, category);
  const size = DEFAULT_SIZES[category];

  try {
    const extraOptions = {};
    if (category === 'tiles' && asset._tileCategory) {
      extraOptions.tileCategory = asset._tileCategory;
    }

    // Icon IDs are now unprefixed in metadata (Phase 5 cleanup)
    // so we can use the ID directly without normalization
    asset.path = getAssetPath(category, id, {
      subcategory,
      size,
      ...extraOptions
    });
  } catch (e) {
    // Category not supported by getAssetPath, skip
  }

  return asset;
}

/**
 * Find an asset by ID, with disambiguation for categories with ID collisions
 * @param {object} data - Result from loadCategoryAssets
 * @param {string} category - Asset category
 * @param {string} id - Asset ID
 * @param {object} options - Disambiguation options
 * @param {string} options.biome - For tiles category
 * @param {string} options.tileCategory - For tiles (floors, slopes, walls)
 * @param {string} options.sourceFile - Most precise (works for any category)
 * @param {string} options.iconCategory - For icons category (status, augments, etc.)
 * @param {string} options.itemCategory - For items category (weapons, armor, etc.)
 * @returns {object|null} Asset or null if not found
 */
export function findAssetById(data, category, id, options = {}) {
  const { biome, tileCategory, sourceFile, iconCategory, itemCategory } = options;

  // sourceFile is most precise - works for any category
  if (sourceFile) {
    return data.assets.find(a =>
      (a.id === id || a.key === id) && a._sourceFile === sourceFile
    ) || null;
  }

  // Category-specific disambiguation
  if (category === 'tiles') {
    if (biome) {
      return data.assets.find(a =>
        (a.id === id || a.key === id) &&
        a._biome === biome &&
        (!tileCategory || a._tileCategory === tileCategory)
      ) || null;
    }
    // No disambiguation for tiles - return null
    return null;
  }

  if (category === 'icons' && iconCategory) {
    return data.assets.find(a =>
      (a.id === id || a.key === id) && a._iconCategory === iconCategory
    ) || null;
  }

  if (category === 'items' && itemCategory) {
    return data.assets.find(a =>
      (a.id === id || a.key === id) && a._itemCategory === itemCategory
    ) || null;
  }

  // For categories without disambiguation needs, byId lookup is safe
  return data.byId[id] || null;
}

// Re-export constants
export { VALID_CATEGORIES };
