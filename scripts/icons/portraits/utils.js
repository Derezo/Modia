/**
 * Portrait Generation Utilities
 * Pixel-art style SVG helpers for character and enemy portraits
 */

/**
 * Color palettes for each race's skin tones
 * Each palette: outline -> shadow -> base -> highlight -> bright
 */
const SKIN_PALETTES = {
  human: {
    outline: '#5a3a2a',
    shadow: '#8b6a4a',
    base: '#c9a07a',
    highlight: '#e0c0a0',
    bright: '#f0d8c0'
  },
  elf: {
    outline: '#4a4a3a',
    shadow: '#8a8a6a',
    base: '#c8c8a8',
    highlight: '#e8e8d0',
    bright: '#f8f8e8'
  },
  dwarf: {
    outline: '#5a4030',
    shadow: '#8a6a50',
    base: '#b89878',
    highlight: '#d0b898',
    bright: '#e8d0b8'
  },
  vampire: {
    outline: '#3a3a4a',
    shadow: '#6a6a7a',
    base: '#a0a0b0',
    highlight: '#c8c8d8',
    bright: '#e8e8f0'
  },
  orc: {
    outline: '#2a3a2a',
    shadow: '#4a5a3a',
    base: '#6a8a5a',
    highlight: '#8aaa7a',
    bright: '#a0c090'
  }
};

/**
 * Hair color palettes
 */
const HAIR_PALETTES = {
  brown: {
    outline: '#1a1008',
    dark: '#3a2818',
    base: '#5a4028',
    highlight: '#7a5838'
  },
  black: {
    outline: '#0a0808',
    dark: '#1a1818',
    base: '#2a2828',
    highlight: '#3a3838'
  },
  blonde: {
    outline: '#6a5020',
    dark: '#9a8040',
    base: '#c8a850',
    highlight: '#e8d070'
  },
  red: {
    outline: '#4a1810',
    dark: '#7a2818',
    base: '#a84028',
    highlight: '#c85838'
  },
  white: {
    outline: '#808080',
    dark: '#a0a0a0',
    base: '#d0d0d0',
    highlight: '#f0f0f0'
  },
  green: {  // For orcs
    outline: '#1a2a10',
    dark: '#2a3a18',
    base: '#3a4a28',
    highlight: '#4a5a38'
  }
};

/**
 * Equipment/armor color palettes
 */
const EQUIPMENT_PALETTES = {
  steel: {
    outline: '#3a3a40',
    dark: '#5a5a60',
    base: '#8a8a90',
    highlight: '#b0b0b8',
    bright: '#d8d8e0'
  },
  gold: {
    outline: '#6a4a10',
    dark: '#9a7020',
    base: '#c89830',
    highlight: '#e8b840',
    bright: '#f8d060'
  },
  leather: {
    outline: '#2a1810',
    dark: '#4a3020',
    base: '#6a4830',
    highlight: '#8a6040',
    bright: '#a07850'
  },
  cloth: {
    outline: '#2a2a30',
    dark: '#4a4a50',
    base: '#6a6a70',
    highlight: '#8a8a90',
    bright: '#a0a0a8'
  },
  darkSteel: {
    outline: '#1a1a20',
    dark: '#2a2a30',
    base: '#3a3a40',
    highlight: '#4a4a50',
    bright: '#5a5a60'
  },
  magic: {
    outline: '#3a2050',
    dark: '#5a3070',
    base: '#7a4090',
    highlight: '#9a50b0',
    bright: '#ba70d0'
  }
};

/**
 * Eye color options
 */
const EYE_COLORS = {
  brown: { iris: '#5a3020', pupil: '#2a1810', highlight: '#8a5040' },
  blue: { iris: '#3050a0', pupil: '#102040', highlight: '#5080d0' },
  green: { iris: '#308040', pupil: '#104020', highlight: '#50a060' },
  amber: { iris: '#a07020', pupil: '#604010', highlight: '#c09030' },
  red: { iris: '#a02020', pupil: '#401010', highlight: '#d04040' },  // Vampires
  yellow: { iris: '#a0a020', pupil: '#505010', highlight: '#c8c840' }  // Orcs
};

/**
 * Create SVG wrapper for portraits (64x64 pixel art style)
 * @param {string} content - SVG content
 * @returns {string} Complete SVG markup
 */
function createPortraitSvg(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">
${content}
</svg>`;
}

/**
 * Draw a single pixel (1x1 rect)
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} color - Fill color
 * @returns {string} SVG rect element
 */
function pixel(x, y, color) {
  if (!color) return '';
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
}

/**
 * Draw a filled rectangle (efficient for large areas)
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {string} color - Fill color
 * @returns {string} SVG rect element
 */
function fillRect(x, y, w, h, color) {
  if (!color) return '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
}

/**
 * Draw a horizontal line of pixels
 * @param {number} x - Starting X
 * @param {number} y - Y position
 * @param {string[]} colors - Array of colors (null/undefined for skip)
 * @returns {string} SVG elements
 */
function pixelRow(x, y, colors) {
  let result = '';
  let currentColor = null;
  let runStart = x;
  let runLength = 0;

  // Optimize consecutive same-color pixels into single rects
  for (let i = 0; i <= colors.length; i++) {
    const c = colors[i];
    if (c === currentColor && i < colors.length) {
      runLength++;
    } else {
      if (currentColor && runLength > 0) {
        result += fillRect(runStart, y, runLength, 1, currentColor) + '\n';
      }
      currentColor = c;
      runStart = x + i;
      runLength = 1;
    }
  }
  return result;
}

/**
 * Draw an ellipse approximation using pixels
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} rx - Radius X
 * @param {number} ry - Radius Y
 * @param {string} color - Fill color
 * @returns {string} SVG elements
 */
function pixelEllipse(cx, cy, rx, ry, color) {
  let result = '';
  for (let y = -ry; y <= ry; y++) {
    const halfWidth = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
    if (halfWidth > 0) {
      result += fillRect(cx - halfWidth, cy + y, halfWidth * 2, 1, color) + '\n';
    }
  }
  return result;
}

/**
 * Draw a circle approximation using pixels
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} r - Radius
 * @param {string} color - Fill color
 * @returns {string} SVG elements
 */
function pixelCircle(cx, cy, r, color) {
  return pixelEllipse(cx, cy, r, r, color);
}

/**
 * Draw eyes at specified position
 * @param {number} leftX - Left eye center X
 * @param {number} y - Eye center Y
 * @param {number} spacing - Distance between eyes
 * @param {object} eyeColor - Eye color palette
 * @param {object} skinPalette - Skin palette for whites
 * @returns {string} SVG elements
 */
function drawEyes(leftX, y, spacing, eyeColor, skinPalette) {
  const rightX = leftX + spacing;
  let result = '';

  // Eye whites (slightly off-white)
  result += fillRect(leftX - 2, y - 1, 4, 3, '#f0f0e8');
  result += fillRect(rightX - 2, y - 1, 4, 3, '#f0f0e8');

  // Iris
  result += fillRect(leftX - 1, y - 1, 2, 2, eyeColor.iris);
  result += fillRect(rightX - 1, y - 1, 2, 2, eyeColor.iris);

  // Pupil
  result += pixel(leftX, y, eyeColor.pupil);
  result += pixel(rightX, y, eyeColor.pupil);

  // Highlight
  result += pixel(leftX - 1, y - 1, '#ffffff');
  result += pixel(rightX - 1, y - 1, '#ffffff');

  return result;
}

/**
 * Draw a simple nose
 * @param {number} cx - Center X
 * @param {number} y - Y position (top of nose)
 * @param {object} skinPalette - Skin palette
 * @param {string} size - 'small', 'medium', 'large'
 * @returns {string} SVG elements
 */
function drawNose(cx, y, skinPalette, size = 'medium') {
  let result = '';

  if (size === 'small') {
    result += pixel(cx, y + 1, skinPalette.shadow);
    result += fillRect(cx - 1, y + 2, 2, 1, skinPalette.shadow);
  } else if (size === 'medium') {
    result += pixel(cx, y, skinPalette.shadow);
    result += fillRect(cx - 1, y + 1, 2, 1, skinPalette.shadow);
    result += fillRect(cx - 1, y + 2, 3, 1, skinPalette.shadow);
  } else {
    // Large nose (orcs, dwarves)
    result += fillRect(cx - 1, y, 2, 1, skinPalette.shadow);
    result += fillRect(cx - 2, y + 1, 4, 2, skinPalette.shadow);
    result += fillRect(cx - 2, y + 3, 4, 1, skinPalette.outline);
  }

  return result;
}

/**
 * Draw a mouth
 * @param {number} cx - Center X
 * @param {number} y - Y position
 * @param {object} skinPalette - Skin palette
 * @param {string} expression - 'neutral', 'smile', 'frown', 'fangs'
 * @returns {string} SVG elements
 */
function drawMouth(cx, y, skinPalette, expression = 'neutral') {
  let result = '';
  const mouthColor = '#4a2020';

  if (expression === 'neutral') {
    result += fillRect(cx - 2, y, 4, 1, mouthColor);
  } else if (expression === 'smile') {
    result += fillRect(cx - 2, y, 4, 1, mouthColor);
    result += pixel(cx - 3, y - 1, mouthColor);
    result += pixel(cx + 2, y - 1, mouthColor);
  } else if (expression === 'frown') {
    result += fillRect(cx - 2, y, 4, 1, mouthColor);
    result += pixel(cx - 3, y + 1, mouthColor);
    result += pixel(cx + 2, y + 1, mouthColor);
  } else if (expression === 'fangs') {
    result += fillRect(cx - 2, y, 4, 1, mouthColor);
    result += pixel(cx - 2, y + 1, '#f0f0e8');  // Left fang
    result += pixel(cx + 1, y + 1, '#f0f0e8');  // Right fang
  }

  return result;
}

/**
 * Draw pointed ears (elves)
 * @param {number} faceLeft - Left edge of face
 * @param {number} faceRight - Right edge of face
 * @param {number} y - Ear Y position
 * @param {object} skinPalette - Skin palette
 * @returns {string} SVG elements
 */
function drawPointedEars(faceLeft, faceRight, y, skinPalette) {
  let result = '';

  // Left ear
  result += fillRect(faceLeft - 6, y - 2, 3, 3, skinPalette.base);
  result += fillRect(faceLeft - 8, y - 4, 2, 2, skinPalette.base);
  result += fillRect(faceLeft - 9, y - 6, 1, 2, skinPalette.highlight);
  result += pixel(faceLeft - 5, y - 1, skinPalette.shadow);

  // Right ear
  result += fillRect(faceRight + 3, y - 2, 3, 3, skinPalette.base);
  result += fillRect(faceRight + 6, y - 4, 2, 2, skinPalette.base);
  result += fillRect(faceRight + 8, y - 6, 1, 2, skinPalette.highlight);
  result += pixel(faceRight + 4, y - 1, skinPalette.shadow);

  return result;
}

/**
 * Draw round ears (humans, dwarves)
 * @param {number} faceLeft - Left edge of face
 * @param {number} faceRight - Right edge of face
 * @param {number} y - Ear Y position
 * @param {object} skinPalette - Skin palette
 * @returns {string} SVG elements
 */
function drawRoundEars(faceLeft, faceRight, y, skinPalette) {
  let result = '';

  // Left ear
  result += fillRect(faceLeft - 3, y - 2, 2, 5, skinPalette.base);
  result += fillRect(faceLeft - 4, y - 1, 1, 3, skinPalette.base);
  result += pixel(faceLeft - 2, y, skinPalette.shadow);

  // Right ear
  result += fillRect(faceRight + 1, y - 2, 2, 5, skinPalette.base);
  result += fillRect(faceRight + 3, y - 1, 1, 3, skinPalette.base);
  result += pixel(faceRight + 1, y, skinPalette.shadow);

  return result;
}

/**
 * Draw tusks (orcs)
 * @param {number} cx - Center X
 * @param {number} y - Y position (mouth level)
 * @returns {string} SVG elements
 */
function drawTusks(cx, y) {
  let result = '';
  const tuskColor = '#f0e8d8';
  const tuskShadow = '#c8c0b0';

  // Left tusk
  result += fillRect(cx - 6, y - 1, 2, 3, tuskColor);
  result += fillRect(cx - 7, y + 2, 2, 2, tuskColor);
  result += pixel(cx - 5, y, tuskShadow);

  // Right tusk
  result += fillRect(cx + 4, y - 1, 2, 3, tuskColor);
  result += fillRect(cx + 5, y + 2, 2, 2, tuskColor);
  result += pixel(cx + 4, y, tuskShadow);

  return result;
}

/**
 * Draw vampire fangs visible below lips
 * @param {number} cx - Center X
 * @param {number} y - Y position (below mouth)
 * @returns {string} SVG elements
 */
function drawVampireFangs(cx, y) {
  let result = '';
  result += pixel(cx - 2, y, '#f8f8f8');
  result += pixel(cx - 2, y + 1, '#f0f0f0');
  result += pixel(cx + 1, y, '#f8f8f8');
  result += pixel(cx + 1, y + 1, '#f0f0f0');
  return result;
}

/**
 * Draw a basic background
 * @param {string} color - Background color
 * @returns {string} SVG rect
 */
function background(color = '#2a2a30') {
  return fillRect(0, 0, 64, 64, color);
}

/**
 * Draw shoulder/neck base
 * @param {number} cx - Center X
 * @param {number} y - Y position (top of shoulders)
 * @param {object} clothPalette - Clothing color palette
 * @param {string} width - 'narrow', 'medium', 'wide'
 * @returns {string} SVG elements
 */
function drawShoulders(cx, y, clothPalette, width = 'medium') {
  let result = '';
  const widths = { narrow: 20, medium: 26, wide: 32 };
  const w = widths[width] || widths.medium;
  const hw = Math.floor(w / 2);

  // Main shoulder area
  result += fillRect(cx - hw, y, w, 64 - y, clothPalette.base);

  // Shoulder curve
  result += fillRect(cx - hw - 2, y + 2, 2, 64 - y - 2, clothPalette.base);
  result += fillRect(cx + hw, y + 2, 2, 64 - y - 2, clothPalette.base);

  // Highlights and shadows
  result += fillRect(cx - hw + 1, y + 1, 3, 64 - y - 1, clothPalette.highlight);
  result += fillRect(cx + hw - 4, y + 1, 3, 64 - y - 1, clothPalette.shadow);

  return result;
}

/**
 * Draw neck
 * @param {number} cx - Center X
 * @param {number} y - Y position (top of neck)
 * @param {number} height - Neck height
 * @param {object} skinPalette - Skin palette
 * @returns {string} SVG elements
 */
function drawNeck(cx, y, height, skinPalette) {
  let result = '';
  result += fillRect(cx - 4, y, 8, height, skinPalette.base);
  result += fillRect(cx - 3, y, 2, height, skinPalette.highlight);
  result += fillRect(cx + 2, y, 2, height, skinPalette.shadow);
  return result;
}

module.exports = {
  SKIN_PALETTES,
  HAIR_PALETTES,
  EQUIPMENT_PALETTES,
  EYE_COLORS,
  createPortraitSvg,
  pixel,
  fillRect,
  pixelRow,
  pixelEllipse,
  pixelCircle,
  drawEyes,
  drawNose,
  drawMouth,
  drawPointedEars,
  drawRoundEars,
  drawTusks,
  drawVampireFangs,
  background,
  drawShoulders,
  drawNeck
};
