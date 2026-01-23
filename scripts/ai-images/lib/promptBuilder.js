/**
 * Prompt Builder
 * Build prompts for AI image generation based on metadata templates
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
const NEGATIVE_PROMPT = 'photorealistic, 3D render, CGI, anime style, chibi, pixel art, blurry, low quality, watermark, signature, text, logo, modern elements, neon colors, oversaturated, complex backgrounds, multiple subjects, deformed, bad anatomy, extra limbs, messy lines, muddy colors, holding objects, hands in frame, full body, weapon in hand, action pose, white framing, white border';

/**
 * Style prefixes for different asset types
 */
const STYLE_PREFIXES = {
  // Flat 2D style (V1 LoRA - GRPZA trigger) - for portraits, icons, items
  flat: 'GRPZA, medieval fantasy illustration, ink and wash technique with watercolor fills, bold black outlines of medium weight, visible aged parchment texture with slight yellowing, cozy nostalgic JRPG aesthetic, warm and inviting storybook quality, hand-drawn illustration style,',

  // Isometric style (V2 LoRA - wbgmsst trigger) - for obstacles, nodes
  isometric: 'wbgmsst, isometric fantasy game asset, ink and wash technique with watercolor fills, bold black outlines of medium weight, visible aged parchment texture, cozy JRPG aesthetic, top-down 3/4 view, clear silhouette, isolated subject,',

  // Tile style (V2 LoRA - wbgmsst trigger) - flat terrain textures only
  tile: 'wbgmsst, isometric floor tile, diamond rhombus shape with sharp pointed corners, ' +
    '2:1 width-to-height aspect ratio, 30 degree orthographic projection, ' +
    'flat horizontal surface texture only, seamless tileable pattern, ' +
    'ink and wash watercolor style, bold black outline border defining diamond edges, ' +
    'clean white background outside diamond shape, 128x128 game sprite'
};

/**
 * Build a tile prompt
 * @param {Object} tile - Tile metadata
 * @param {Object} biomeData - Biome metadata
 * @returns {string} Full prompt
 */
function buildTilePrompt(tile, biomeData) {
  const biomeModifier = biomeData.biomeModifier || '';
  const basePrompt = tile.prompt;
  return `${STYLE_PREFIXES.tile} ${basePrompt}, ${biomeModifier}`;
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

  return `GRPZA, ${icon.prompt}, ${catMod}, simplified bold design, ink and wash style, thick black outlines, flat watercolor fills, high contrast silhouette, clean edges, isolated on plain background`;
}

/**
 * Build an item prompt (legacy - includes rarity glow for backward compatibility)
 * @param {Object} item - Item metadata
 * @param {string} category - Item category
 * @returns {string} Full prompt
 * @deprecated Use buildCleanItemPrompt for layered composition system
 */
function buildItemPrompt(item, category) {
  // Rarity glow removed - use layered composition with overlays instead
  const categoryMod = category === 'consumables' ? 'consumable item' : category;

  return `GRPZA, ${item.prompt}, fantasy RPG ${categoryMod} sprite, ink and wash illustration, bold black outlines, watercolor fills, slight 3D depth, isolated subject, plain neutral background, 128x128 game sprite`;
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

  return `GRPZA, ${node.prompt}, fantasy map landmark icon, top-down stylized view, ink and wash illustration, bold black outlines, watercolor fills${colorPart}, aged parchment texture, miniature landmark style, clear silhouette, isolated on plain background, 48x48 game icon`;
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
 * @param {string} category - Asset category
 * @returns {string} Trigger word
 */
function getTriggerWord(category) {
  const isometricCategories = ['tiles', 'obstacles'];
  return isometricCategories.includes(category) ? 'wbgmsst' : 'GRPZA';
}

/**
 * Get regional palette
 * @param {string} region - Region name
 * @returns {Object|null} Palette or null
 */
function getRegionalPalette(region) {
  return REGIONAL_PALETTES[region] || null;
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

  // Legacy functions (for backward compatibility and tiles)
  NEGATIVE_PROMPT,
  STYLE_PREFIXES,
  REGIONAL_PALETTES,
  buildTilePrompt,
  buildPortraitPrompt,
  buildIconPrompt,
  buildItemPrompt,
  buildNodePrompt,
  getStylePrefix,
  getTriggerWord,
  getRegionalPalette
};
