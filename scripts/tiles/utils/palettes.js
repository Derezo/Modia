/**
 * Color Palettes for Procedural Tile Generation
 * Defines biome-specific color schemes for terrain and obstacles
 */

/**
 * Biome-specific terrain palettes
 * Each biome has colors for different terrain types
 */
const BIOME_PALETTES = {
  forest: {
    grass: ['#4a6a3a', '#3d5c30', '#557843', '#426635'],
    stone: ['#6a6a5a', '#5c5c4e', '#787868', '#656555'],
    dirt: ['#8a6a4a', '#7a5c3e', '#9a7858', '#6e5438'],
    moss: ['#3a5a3a', '#2e4e2e', '#466846', '#345234'],
    path: ['#9a8a6a', '#8a7a5e', '#a89878', '#7e6e52']
  },
  cave: {
    stone: ['#5a5060', '#4e4454', '#686070', '#524858'],
    crystal: ['#5a80a0', '#4e7094', '#689ab0', '#426488'],
    lava: ['#a04030', '#8a3028', '#b84840', '#7a2820'],
    moss: ['#4a5a4a', '#3e4e3e', '#586858', '#345234'],
    dark: ['#3a3040', '#2e2434', '#484050', '#262030']
  },
  mountain: {
    rock: ['#7a7a7a', '#6e6e6e', '#888888', '#626262'],
    snow: ['#e8e8f0', '#dcdce8', '#f4f4fc', '#d0d0dc'],
    ice: ['#b0d0e8', '#a0c4dc', '#c0def4', '#94b8d0'],
    alpine: ['#5a7a4a', '#4e6e3e', '#688e58', '#426236'],
    slate: ['#6a7080', '#5e6474', '#788590', '#525868']
  },
  bridge: {
    wood: ['#8a6a4a', '#7a5c3e', '#9a7858', '#6e5438'],
    rope: ['#b09070', '#a08060', '#c0a080', '#907050'],
    stone: ['#808080', '#747474', '#909090', '#686868'],
    water: ['#4080a0', '#347094', '#509ab0', '#286488'],
    plank: ['#9a7a5a', '#8a6c4e', '#aa8868', '#7e6048']
  },
  castle: {
    cobblestone: ['#707070', '#646464', '#808080', '#585858'],
    marble: ['#d8d8e0', '#ccccdc', '#e8e8f0', '#c0c0cc'],
    carpet: ['#a03030', '#8a2828', '#b04040', '#7a2020'],
    gold: ['#d0a040', '#c09030', '#e0b050', '#b08028'],
    banner: ['#3050a0', '#284494', '#4060b0', '#203888']
  },
  swamp: {
    murky: ['#4a5a3a', '#3e4e2e', '#586846', '#324428'],
    water: ['#3a5040', '#2e4434', '#486050', '#243830'],
    moss: ['#5a6a4a', '#4e5e3e', '#687858', '#425236'],
    mud: ['#6a5a4a', '#5e4e3e', '#787058', '#524638'],
    vine: ['#3a5030', '#2e4424', '#486040', '#243818']
  },
  desert: {
    sand: ['#d4b896', '#c8ac8a', '#e0c4a2', '#bca07e'],
    rock: ['#a08878', '#94786c', '#b09888', '#886c60'],
    dune: ['#c4a886', '#b89c7a', '#d0b492', '#ac906e'],
    oasis: ['#4a8060', '#3e7454', '#589070', '#326848'],
    clay: ['#b08068', '#a4745c', '#bc8c78', '#987050']
  },
  volcanic: {
    obsidian: ['#2a2030', '#1e1424', '#363040', '#141018'],
    lava: ['#e04020', '#d03018', '#f05028', '#c02810'],
    ash: ['#5a5050', '#4e4444', '#686060', '#423838'],
    ember: ['#c06030', '#b05028', '#d07038', '#a04420'],
    basalt: ['#404040', '#343434', '#505050', '#282828']
  },
  tundra: {
    snow: ['#f0f0f8', '#e4e4f0', '#fcfcff', '#d8d8e8'],
    ice: ['#c0d8e8', '#b4ccdc', '#cce4f4', '#a8c0d0'],
    frost: ['#d0e0f0', '#c4d4e4', '#dcecfc', '#b8c8d8'],
    permafrost: ['#808898', '#747c8c', '#9094a8', '#686c80'],
    lichen: ['#6a7a6a', '#5e6e5e', '#788878', '#526252']
  }
};

/**
 * Obstacle color palettes
 */
const OBSTACLE_PALETTES = {
  trees: {
    oak: {
      trunk: ['#6a4a3a', '#5e3e2e', '#785848', '#523830'],
      foliage: ['#3a6a2a', '#2e5e1e', '#487838', '#244e16'],
      highlight: ['#4a8a3a', '#3e7e2e', '#589848', '#326c26']
    },
    pine: {
      trunk: ['#5a3a2a', '#4e2e1e', '#684838', '#422818'],
      foliage: ['#2a5a3a', '#1e4e2e', '#386848', '#144226'],
      highlight: ['#3a6a4a', '#2e5e3e', '#487858', '#225236']
    },
    dead: {
      trunk: ['#5a5050', '#4e4444', '#686060', '#423838'],
      branch: ['#6a6060', '#5e5454', '#787070', '#524848']
    },
    mushroom: {
      stem: ['#d8d0c8', '#ccc4bc', '#e4dcd4', '#c0b8b0'],
      cap: ['#a03030', '#8a2828', '#b04040', '#7a2020'],
      spots: ['#f0e8e0', '#e4dcd4', '#fcf4ec', '#d8d0c8']
    }
  },
  rocks: {
    granite: {
      base: ['#707070', '#646464', '#808080', '#585858'],
      highlight: ['#909090', '#848484', '#a0a0a0', '#787878'],
      shadow: ['#505050', '#444444', '#606060', '#383838']
    },
    sandstone: {
      base: ['#c4a888', '#b89c7c', '#d0b494', '#ac906c'],
      highlight: ['#d8bc9c', '#ccb090', '#e4c8a8', '#c0a484'],
      shadow: ['#a08868', '#947c5c', '#ac9478', '#886c50']
    },
    obsidian: {
      base: ['#2a2a30', '#1e1e24', '#363640', '#141418'],
      highlight: ['#4a4a58', '#3e3e4c', '#585868', '#323240'],
      reflection: ['#6080a0', '#547494', '#709cb0', '#486888']
    }
  },
  crystals: {
    blue: {
      base: ['#4080c0', '#3474b4', '#508cd0', '#2868a8'],
      highlight: ['#60a0e0', '#5494d4', '#70acf0', '#4888c8'],
      glow: ['#80c0ff', '#74b4f4', '#90ccff', '#68a8e8']
    },
    purple: {
      base: ['#8040a0', '#743494', '#9050b0', '#682888'],
      highlight: ['#a060c0', '#9454b4', '#b070d0', '#8848a8'],
      glow: ['#c080e0', '#b474d4', '#d090f0', '#a868c8']
    },
    green: {
      base: ['#40a060', '#349454', '#50b070', '#288848'],
      highlight: ['#60c080', '#54b474', '#70d090', '#48a868'],
      glow: ['#80e0a0', '#74d494', '#90f0b0', '#68c888']
    },
    red: {
      base: ['#a04040', '#943434', '#b05050', '#882828'],
      highlight: ['#c06060', '#b45454', '#d07070', '#a84848'],
      glow: ['#e08080', '#d47474', '#f09090', '#c86868']
    }
  }
};

/**
 * Get a random color from a palette array
 * @param {Array<string>} colors - Array of hex colors
 * @param {number} seed - Seed for deterministic selection
 * @returns {string} Selected hex color
 */
function getRandomColor(colors, seed = Math.random()) {
  const index = Math.floor(seed * colors.length) % colors.length;
  return colors[index];
}

/**
 * Parse hex color to RGB components
 * @param {string} hex - Hex color string (e.g., '#ff0000')
 * @returns {{r: number, g: number, b: number}} RGB components (0-255)
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

/**
 * Convert RGB to hex color
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Hex color string
 */
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => {
    const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Blend two colors
 * @param {string} color1 - First hex color
 * @param {string} color2 - Second hex color
 * @param {number} factor - Blend factor (0 = color1, 1 = color2)
 * @returns {string} Blended hex color
 */
function blendColors(color1, color2, factor) {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  return rgbToHex(
    c1.r + (c2.r - c1.r) * factor,
    c1.g + (c2.g - c1.g) * factor,
    c1.b + (c2.b - c1.b) * factor
  );
}

/**
 * Lighten a color
 * @param {string} hex - Hex color
 * @param {number} amount - Lighten amount (0-1)
 * @returns {string} Lightened hex color
 */
function lightenColor(hex, amount) {
  return blendColors(hex, '#ffffff', amount);
}

/**
 * Darken a color
 * @param {string} hex - Hex color
 * @param {number} amount - Darken amount (0-1)
 * @returns {string} Darkened hex color
 */
function darkenColor(hex, amount) {
  return blendColors(hex, '#000000', amount);
}

/**
 * Add saturation variation to a color
 * @param {string} hex - Hex color
 * @param {number} variation - Variation amount (-1 to 1)
 * @returns {string} Modified hex color
 */
function adjustSaturation(hex, variation) {
  const rgb = hexToRgb(hex);
  const gray = (rgb.r + rgb.g + rgb.b) / 3;
  const factor = 1 + variation;
  return rgbToHex(
    gray + (rgb.r - gray) * factor,
    gray + (rgb.g - gray) * factor,
    gray + (rgb.b - gray) * factor
  );
}

module.exports = {
  BIOME_PALETTES,
  OBSTACLE_PALETTES,
  getRandomColor,
  hexToRgb,
  rgbToHex,
  blendColors,
  lightenColor,
  darkenColor,
  adjustSaturation
};
