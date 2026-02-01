/**
 * Prompt Builder
 * Build prompts for AI image generation based on metadata templates
 *
 * NOTE: For Python-based generation (tiles, portraits, items, icons, nodes, overlays),
 * prompts are built by the Python scripts in image-generator/modia-generators/.
 * This module's themed prompt building is used for non-Python operations only.
 *
 * The Python scripts handle:
 * - Trigger word injection (GRPZA for V1, wbgmsst for V2)
 * - Style prefixes and biome modifiers
 * - LoRA model selection based on asset type
 *
 * See pythonRunner.js for how prompts are passed to Python.
 */

const path = require('path');
const { loadMetadata, getMetadataDir } = require('./imageUtils');

/**
 * Cache for loaded theme
 */
let cachedTheme = null;

/**
 * Load the active theme configuration
 * @param {boolean} forceReload - Force reload from disk
 * @returns {Object} Theme configuration
 */
function loadTheme(forceReload = false) {
  if (cachedTheme && !forceReload) {
    return cachedTheme;
  }

  const themePath = path.join(getMetadataDir(), 'theme.json');
  const theme = loadMetadata(themePath);

  if (!theme) {
    throw new Error(`Failed to load theme from ${themePath}`);
  }

  cachedTheme = theme;
  return theme;
}

/**
 * Clear the cached theme (useful for testing or when theme is modified)
 */
function clearThemeCache() {
  cachedTheme = null;
}

/**
 * Build a themed prompt for a category
 * This is the primary function for building prompts - it wraps base descriptions with theme style
 *
 * @param {string} category - Asset category (portraits, icons, items, nodes)
 * @param {string} basePrompt - The asset-specific base description
 * @param {Object} options - Additional options
 * @param {string} options.rarity - Item rarity for items
 * @param {string} options.iconCategory - Icon sub-category (actions, status, etc.)
 * @param {string} options.region - Optional region for color hints
 * @param {string} options.itemCategory - Item sub-category (weapons, armor, consumables)
 * @param {boolean} options.skipTrigger - Skip adding the LoRA trigger (use when Python script adds it)
 * @returns {string} Full themed prompt
 */
function buildThemedPrompt(category, basePrompt, options = {}) {
  const theme = loadTheme();
  const categoryMod = theme.categoryModifiers[category] || {};

  const parts = [];

  // Only add trigger if not skipped (Python scripts add their own trigger)
  if (!options.skipTrigger) {
    parts.push(theme.style.trigger);
  }

  parts.push(
    theme.style.basePhrase,
    theme.style.technique,
    basePrompt
  );

  // Add category-specific modifiers
  if (category === 'items' && options.rarity) {
    const rarityMod = theme.rarityModifiers[options.rarity];
    if (rarityMod) {
      parts.push(rarityMod);
    }
    if (options.itemCategory) {
      const catName = options.itemCategory === 'consumables' ? 'consumable item' : options.itemCategory;
      parts.push(`fantasy RPG ${catName} sprite`);
    }
  }

  if (category === 'icons' && options.iconCategory) {
    const iconMod = theme.iconCategoryModifiers[options.iconCategory];
    if (iconMod) {
      parts.push(iconMod);
    }
  }

  if (category === 'nodes' && options.region) {
    const palette = REGIONAL_PALETTES[options.region];
    if (palette) {
      parts.push(`${palette.description} color palette`);
    }
  }

  // Add base theme elements
  parts.push(theme.style.texture);
  parts.push(theme.style.mood);

  // Add category suffix
  if (categoryMod.suffix) {
    parts.push(categoryMod.suffix);
  }

  // Add size
  if (categoryMod.size) {
    parts.push(`${categoryMod.size} game sprite`);
  }

  // Add isolation for clean sprites (no white framing)
  parts.push('isolated subject, plain neutral background, clear sprite edges');

  return parts.filter(Boolean).join(', ');
}

/**
 * Get the negative prompt from the theme
 * @returns {string} Negative prompt
 */
function getThemedNegativePrompt() {
  const theme = loadTheme();
  return theme.negativePrompt;
}

/**
 * Regional color palettes from master manifest
 */
const REGIONAL_PALETTES = {
  heartlands: {
    primary: '#8B7355',
    secondary: '#D4A574',
    accent: '#6B8E4A',
    description: 'warm browns, golden tan, meadow green'
  },
  sylvan_reaches: {
    primary: '#2E8B57',
    secondary: '#9ACD32',
    accent: '#8FBC8F',
    description: 'sea green, yellow-green, sage'
  },
  iron_depths: {
    primary: '#696969',
    secondary: '#B87333',
    accent: '#FF6347',
    description: 'dim gray, copper, forge fire orange'
  },
  shadowmere: {
    primary: '#4B0082',
    secondary: '#8B0000',
    accent: '#C0C0C0',
    description: 'indigo, dark red, silver'
  },
  bloodplains: {
    primary: '#8B0000',
    secondary: '#A0522D',
    accent: '#556B2F',
    description: 'dark red, sienna, dark olive'
  }
};

/**
 * Common negative prompt for all asset types
 */
const NEGATIVE_PROMPT = 'photorealistic, 3D render, CGI, anime style, chibi, blurry, low quality, watermark, signature, text, logo, modern elements, neon colors, oversaturated, complex backgrounds, multiple subjects, deformed, bad anatomy, extra limbs, messy lines, muddy colors, holding objects, hands in frame, full body, weapon in hand, action pose, white framing, white border';

/**
 * Style prefixes for different asset types
 * All use LoRA v2 (wbgmsst trigger) as the default
 */
const STYLE_PREFIXES = {
  // Flat 2D style (V2 LoRA - wbgmsst trigger) - for portraits, icons, items
  flat: 'wbgmsst, medieval fantasy illustration, ink and wash technique with watercolor fills, bold black outlines of medium weight, visible aged parchment texture with slight yellowing, cozy nostalgic JRPG aesthetic, warm and inviting storybook quality, hand-drawn illustration style,',

  // Isometric style (V2 LoRA - wbgmsst trigger) - for obstacles, nodes
  isometric: 'wbgmsst, isometric fantasy game asset, ink and wash technique with watercolor fills, bold black outlines of medium weight, visible aged parchment texture, cozy JRPG aesthetic, top-down 3/4 view, clear silhouette, isolated subject,',

  // Tile style - isometric floor tiles with diamond shape
  tile: 'wbgmsst, isometric floor tile, diamond rhombus shape with sharp pointed corners, ' +
    '2:1 width-to-height aspect ratio, 30 degree orthographic projection, ' +
    'flat horizontal surface texture only, seamless tileable pattern, ' +
    'ink and wash watercolor style, bold black outline border defining diamond edges, ' +
    'clean white background outside diamond shape, 128x128 game sprite',

  // Flat texture style for tiles - generates top-down textures that get isometric transform in post-processing
  // This produces more consistent results as the AI doesn't have to handle perspective
  tileFlatTexture: 'wbgmsst, seamless tileable texture, top-down flat view, ' +
    'ink and wash watercolor illustration, bold black outlines, ' +
    'game texture asset, square seamless pattern',

  // Wall texture style - horizontal strips for stacking wall system
  wallTexture: 'wbgmsst, vertical cliff face texture strip, side-lit from top-left, ' +
    'horizontal seamless tileable, ink and wash watercolor style, ' +
    'bold black outlines, fantasy game texture, 128x32 wall strip'
};

/**
 * Build a flat texture tile prompt (NEW - for post-processing isometric transform)
 *
 * Strategy: Generate flat top-down textures that will have isometric skew applied
 * in post-processing. This produces more consistent results because:
 * 1. AI doesn't have to handle perspective projection
 * 2. Hex color codes are not in the prompt (AI ignores them anyway)
 * 3. Results are code-controlled for perfect consistency
 *
 * @param {Object} tile - Tile metadata with prompt property
 * @param {Object} biomeData - Biome metadata with biomeModifier
 * @returns {string} Full prompt for flat texture generation
 */
function buildFlatTilePrompt(tile, biomeData) {
  const biomeModifier = biomeData?.biomeModifier || '';
  const basePrompt = tile.prompt;

  // New flat texture format - no isometric instructions, let post-processing handle it
  return `${STYLE_PREFIXES.tileFlatTexture}, ${basePrompt}, ${biomeModifier}`;
}

/**
 * Build a wall texture prompt for the stacking tile system
 *
 * Walls are 64x16 pixel strips that tile vertically to create elevation faces.
 * Generated at 128x32 and resized to 64x16 in post-processing.
 *
 * @param {Object} wall - Wall metadata with prompt property
 * @param {Object} biomeData - Biome metadata with biomeModifier
 * @returns {string} Full prompt for wall texture generation
 */
function buildWallPrompt(wall, biomeData) {
  const biomeModifier = biomeData?.biomeModifier || '';
  const basePrompt = wall.prompt;

  return `${STYLE_PREFIXES.wallTexture}, ${basePrompt}, ${biomeModifier}`;
}

/**
 * Build a portrait prompt
 * @param {Object} portrait - Portrait metadata
 * @param {Object} traits - Trait definitions
 * @returns {string} Full prompt
 */
function buildPortraitPrompt(portrait, traits) {
  const raceTraits = traits.raceTraits[portrait.race] || portrait.race;
  const genderTraits = traits.genderTraits[portrait.gender] || portrait.gender;
  const classTraits = traits.classTraits[portrait.class] || portrait.class;

  return `${STYLE_PREFIXES.flat} ${raceTraits} ${genderTraits} ${classTraits} portrait, bust shot from chest up, character centered, hands not visible, expressive eyes, isolated on plain background, 64x64 game portrait`;
}

/**
 * Build an icon prompt
 * @param {Object} icon - Icon metadata
 * @param {string} category - Icon category
 * @returns {string} Full prompt
 */
function buildIconPrompt(icon, category) {
  const categoryModifiers = {
    actions: 'action skill icon',
    status: 'status effect icon',
    menu: 'menu UI icon',
    augments: 'augment upgrade icon'
  };

  const catMod = categoryModifiers[category] || 'game icon';

  return `wbgmsst, ${icon.prompt}, ${catMod}, simplified bold design, ink and wash style, thick black outlines, flat watercolor fills, high contrast silhouette, clean edges, isolated on plain background`;
}

/**
 * Build a clean item prompt WITHOUT rarity glow effects
 * Used for the layered composition system where overlays are applied separately
 * @param {Object} item - Item metadata with prompt property
 * @param {string} category - Item category (weapons, armor, consumables, accessories)
 * @returns {string} Full prompt for clean base item sprite
 */
function buildCleanItemPrompt(item, category) {
  const theme = loadTheme();
  const categoryMod = category === 'consumables' ? 'consumable item' : category;

  const parts = [
    theme.style.trigger,
    theme.style.basePhrase,
    theme.style.technique,
    item.prompt,
    `fantasy RPG ${categoryMod} sprite`,
    'clean centered composition',
    'slight 3D depth',
    'no glow effects',
    theme.style.texture,
    theme.style.mood,
    'isolated subject',
    'plain neutral background',
    'clear sprite edges',
    '128x128 game sprite'
  ];

  return parts.filter(Boolean).join(', ');
}

/**
 * Build an overlay prompt for rarity or augment effects
 * Creates particle/glow effect overlays for the layered composition system
 * @param {string} overlayType - Type of overlay: 'rarity' or 'augment'
 * @param {string} overlayId - Specific overlay ID (e.g., 'rare', 'epic', 'fire', 'ice')
 * @param {Object} options - Additional options
 * @param {boolean} options.skipTrigger - Skip the LoRA trigger word
 * @returns {string} Full prompt for overlay sprite
 */
function buildOverlayPrompt(overlayType, overlayId, options = {}) {
  const theme = loadTheme();
  const overlayConfig = theme.overlayConfig;

  if (!overlayConfig) {
    throw new Error('overlayConfig not found in theme.json');
  }

  let effectDescription = '';
  let colorKeywords = '';

  if (overlayType === 'rarity') {
    const rarityOverlay = overlayConfig.rarityOverlays[overlayId];
    if (!rarityOverlay) {
      throw new Error(`Unknown rarity overlay: ${overlayId}. Valid options: ${Object.keys(overlayConfig.rarityOverlays).join(', ')}`);
    }
    colorKeywords = rarityOverlay.color;
    effectDescription = rarityOverlay.promptKeywords;
  } else if (overlayType === 'augment') {
    const augmentOverlay = overlayConfig.augmentOverlays[overlayId];
    if (!augmentOverlay) {
      throw new Error(`Unknown augment overlay: ${overlayId}. Valid options: ${Object.keys(overlayConfig.augmentOverlays).join(', ')}`);
    }
    effectDescription = augmentOverlay;
    // Extract color from augment description or use a default
    const colorMap = {
      fire: 'orange and red',
      ice: 'blue and white',
      lightning: 'yellow and electric blue',
      poison: 'green and sickly yellow',
      holy: 'golden and white',
      dark: 'purple and black',
      critical: 'red',
      lifesteal: 'crimson red',
      speed: 'blue and cyan',
      pierce: 'white and silver',
      stun: 'yellow',
      chain: 'electric blue',
      earth: 'brown and tan',
      wind: 'white and cyan'
    };
    colorKeywords = colorMap[overlayId] || 'magical';
  } else {
    throw new Error(`Unknown overlay type: ${overlayType}. Valid options: rarity, augment`);
  }

  const parts = [];

  if (!options.skipTrigger) {
    parts.push(theme.style.trigger);
  }

  parts.push(
    theme.style.basePhrase,
    `${effectDescription} particle effect overlay`,
    'full frame aura surrounding empty center',
    'transparent background with additive glow',
    `${colorKeywords} particles and energy wisps`,
    'magical fantasy JRPG effect',
    'no central object',
    'pure effect layer',
    '128x128 overlay sprite'
  );

  return parts.filter(Boolean).join(', ');
}

/**
 * Get the overlay configuration from theme
 * Provides access to overlayConfig for layered composition scripts
 * @returns {Object} Overlay configuration with rarityOverlays and augmentOverlays
 */
function getOverlayConfig() {
  const theme = loadTheme();
  return theme.overlayConfig || null;
}

/**
 * Build a world map node prompt
 * @param {Object} node - Node metadata
 * @param {string} region - Optional region for color hints
 * @returns {string} Full prompt
 */
function buildNodePrompt(node, region = null) {
  let colorHint = '';
  if (region && REGIONAL_PALETTES[region]) {
    colorHint = REGIONAL_PALETTES[region].description;
  }

  const colorPart = colorHint ? `, ${colorHint} color palette` : '';

  return `wbgmsst, ${node.prompt}, fantasy map landmark icon, top-down stylized view, ink and wash illustration, bold black outlines, watercolor fills${colorPart}, aged parchment texture, miniature landmark style, clear silhouette, isolated on plain background, 48x48 game icon`;
}

/**
 * Get the style prefix for an asset category
 * @param {string} category - Asset category
 * @returns {string} Style prefix
 */
function getStylePrefix(category) {
  if (category === 'tiles') return STYLE_PREFIXES.tile;
  if (category === 'obstacles') return STYLE_PREFIXES.isometric;
  return STYLE_PREFIXES.flat;
}

/**
 * Get the LoRA trigger word for an asset category
 * All categories now use LoRA v2 (wbgmsst trigger)
 * @param {string} category - Asset category
 * @returns {string} Trigger word
 */
function getTriggerWord(category) {
  // LoRA v2 uses wbgmsst for all asset types
  return 'wbgmsst';
}

/**
 * Get regional palette
 * @param {string} region - Region name
 * @returns {Object|null} Palette or null
 */
function getRegionalPalette(region) {
  return REGIONAL_PALETTES[region] || null;
}

/**
 * SD1.5 LoRA trigger words mapping
 * These are different from Flux LoRA triggers and optimized for SD1.5 checkpoints
 * Trigger words must match image-generator/sd15_animation/config.py exactly
 */
const SD15_LORA_TRIGGERS = {
  'pixel-art-xl': 'pixelart',
  '16-bit-pixel': '16bitscene',
  'all-in-one-pixel': 'pixel art',
  'retro-game-art': 'r3tr0',
  'cps2-pixel-art': 'cpsii',
  null: ''
};

/**
 * Get the SD1.5 LoRA trigger word
 * @param {string|null} loraModel - LoRA model identifier
 * @returns {string} Trigger word for the LoRA model
 */
function getSD15LoraTrigger(loraModel) {
  return SD15_LORA_TRIGGERS[loraModel] || SD15_LORA_TRIGGERS[null];
}

/**
 * Build an SD1.5-compatible character prompt for animation generation
 * SD1.5 requires different prompt structure than Flux for optimal results
 *
 * @param {Object} character - Character metadata
 * @param {string} character.id - Character identifier
 * @param {string} character.visualTraits - Visual description traits
 * @param {string} character.class - Character class (for players)
 * @param {string} character.biome - Biome (for enemies)
 * @param {string} animation - Animation name (idle, walk, attack, etc.)
 * @param {Object} options - Additional options
 * @param {string} options.loraModel - Optional LoRA model for trigger word
 * @param {number} options.frameIndex - Optional frame index for frame-specific prompts
 * @param {string} options.poseDescription - Optional pose description from ControlNet
 * @returns {string} SD1.5-optimized prompt
 */
function buildSD15CharacterPrompt(character, animation, options = {}) {
  const loraTrigger = getSD15LoraTrigger(options.loraModel);

  const parts = [];

  // Add LoRA trigger if present
  if (loraTrigger) {
    parts.push(loraTrigger);
  }

  // Core style keywords for SD1.5
  parts.push('pixel art character sprite');

  // Character visual traits
  if (character.visualTraits) {
    parts.push(character.visualTraits);
  }

  // Animation context
  parts.push(`${animation} animation`);

  // Frame-specific pose if provided
  if (options.poseDescription) {
    parts.push(options.poseDescription);
  }

  // View and size constraints
  parts.push('side view');
  parts.push('64x64');
  parts.push('transparent background');

  // Quality boosters for SD1.5
  parts.push('clean lines');
  parts.push('game asset');

  return parts.filter(Boolean).join(', ');
}

/**
 * Build an SD1.5-compatible reference image prompt
 * Reference images should be higher quality and more detailed
 *
 * @param {Object} character - Character metadata
 * @param {Object} options - Additional options
 * @param {string} options.loraModel - Optional LoRA model
 * @returns {string} SD1.5-optimized reference prompt
 */
function buildSD15ReferencePrompt(character, options = {}) {
  const loraTrigger = getSD15LoraTrigger(options.loraModel);

  const parts = [];

  if (loraTrigger) {
    parts.push(loraTrigger);
  }

  // Higher quality keywords for reference
  parts.push('detailed pixel art character');
  parts.push('game sprite reference sheet');

  if (character.visualTraits) {
    parts.push(character.visualTraits);
  }

  // Neutral pose for reference
  parts.push('standing pose');
  parts.push('front view');
  parts.push('full body');

  // Quality and style
  parts.push('clean pixel art');
  parts.push('consistent style');
  parts.push('transparent background');
  parts.push('128x128');

  return parts.filter(Boolean).join(', ');
}

/**
 * Get SD1.5 negative prompt for character animation
 * SD1.5 benefits from specific negative prompts different from Flux
 * @returns {string} Negative prompt for SD1.5 character generation
 */
function getSD15NegativePrompt() {
  return 'blurry, low quality, watermark, signature, text, logo, ' +
    'photorealistic, 3D render, anime style, chibi, ' +
    'bad anatomy, extra limbs, missing limbs, ' +
    'multiple characters, crowded, busy background, ' +
    'jpeg artifacts, noise, grain';
}

module.exports = {
  // Theme functions (new unified approach)
  loadTheme,
  clearThemeCache,
  buildThemedPrompt,
  getThemedNegativePrompt,

  // Layered composition system
  buildCleanItemPrompt,
  buildOverlayPrompt,
  getOverlayConfig,

  // NEW: Flat texture tile system (isometric transform in post-processing)
  buildFlatTilePrompt,
  buildWallPrompt,

  // SD1.5 animation generation support
  SD15_LORA_TRIGGERS,
  getSD15LoraTrigger,
  buildSD15CharacterPrompt,
  buildSD15ReferencePrompt,
  getSD15NegativePrompt,

  // Legacy functions (for backward compatibility and tiles)
  NEGATIVE_PROMPT,
  STYLE_PREFIXES,
  REGIONAL_PALETTES,
  buildPortraitPrompt,
  buildIconPrompt,
  buildNodePrompt,
  getStylePrefix,
  getTriggerWord,
  getRegionalPalette
};
