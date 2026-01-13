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
  },
  orcHair: {  // Dark olive for orc hair contrast
    outline: '#1a1a18',
    dark: '#2a2a20',
    base: '#3a3828',
    highlight: '#4a4838'
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
  },
  darkMagic: {  // Darker sorcerer magic
    outline: '#200820',
    dark: '#301030',
    base: '#502050',
    highlight: '#703070',
    bright: '#904090'
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
 * Draw pointed ears (elves, vampires)
 * @param {number} faceLeft - Left edge of face
 * @param {number} faceRight - Right edge of face
 * @param {number} y - Ear Y position
 * @param {object} skinPalette - Skin palette
 * @param {string} style - 'normal' or 'elegant' (larger with more shimmer)
 * @returns {string} SVG elements
 */
function drawPointedEars(faceLeft, faceRight, y, skinPalette, style = 'normal') {
  let result = '';

  if (style === 'elegant') {
    // Elegant elven ears - larger, more refined with shimmer
    // Left ear - 5x10px with proper shading
    result += fillRect(faceLeft - 7, y - 3, 4, 5, skinPalette.base);
    result += fillRect(faceLeft - 9, y - 5, 3, 4, skinPalette.base);
    result += fillRect(faceLeft - 11, y - 8, 2, 4, skinPalette.highlight);
    result += fillRect(faceLeft - 12, y - 10, 1, 3, skinPalette.bright);
    result += pixel(faceLeft - 6, y - 1, skinPalette.shadow);
    // Inner ear shadow
    result += pixel(faceLeft - 8, y - 4, skinPalette.shadow);
    // Shimmer highlights (4-6 glow pixels)
    result += pixel(faceLeft - 10, y - 7, '#ffffff');
    result += pixel(faceLeft - 11, y - 8, '#ffffff');
    result += pixel(faceLeft - 9, y - 5, skinPalette.bright);

    // Right ear
    result += fillRect(faceRight + 3, y - 3, 4, 5, skinPalette.base);
    result += fillRect(faceRight + 6, y - 5, 3, 4, skinPalette.base);
    result += fillRect(faceRight + 9, y - 8, 2, 4, skinPalette.highlight);
    result += fillRect(faceRight + 11, y - 10, 1, 3, skinPalette.bright);
    result += pixel(faceRight + 5, y - 1, skinPalette.shadow);
    result += pixel(faceRight + 7, y - 4, skinPalette.shadow);
    // Shimmer highlights
    result += pixel(faceRight + 10, y - 7, '#ffffff');
    result += pixel(faceRight + 11, y - 8, '#ffffff');
    result += pixel(faceRight + 8, y - 5, skinPalette.bright);
  } else {
    // Normal pointed ears
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
  }

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
 * @param {string} size - 'normal', 'large' (more prominent), or 'curved' (female style)
 * @returns {string} SVG elements
 */
function drawTusks(cx, y, size = 'normal') {
  let result = '';
  const tuskColor = '#f0e8d8';
  const tuskShadow = '#c8c0b0';
  const tuskHighlight = '#ffffff';

  if (size === 'large') {
    // Prominent tusks with gradient shading
    // Left tusk - larger
    result += fillRect(cx - 7, y - 2, 3, 5, tuskShadow);
    result += fillRect(cx - 6, y - 1, 2, 4, tuskColor);
    result += fillRect(cx - 8, y + 3, 2, 3, tuskShadow);
    result += fillRect(cx - 7, y + 3, 1, 2, tuskColor);
    result += pixel(cx - 6, y - 1, tuskHighlight);
    // Right tusk
    result += fillRect(cx + 4, y - 2, 3, 5, tuskShadow);
    result += fillRect(cx + 4, y - 1, 2, 4, tuskColor);
    result += fillRect(cx + 6, y + 3, 2, 3, tuskShadow);
    result += fillRect(cx + 6, y + 3, 1, 2, tuskColor);
    result += pixel(cx + 5, y - 1, tuskHighlight);
  } else if (size === 'curved') {
    // Smaller curved tusks (for female orcs)
    // Left tusk
    result += fillRect(cx - 5, y, 2, 3, tuskColor);
    result += pixel(cx - 6, y + 2, tuskColor);
    result += pixel(cx - 4, y, tuskHighlight);
    // Right tusk
    result += fillRect(cx + 3, y, 2, 3, tuskColor);
    result += pixel(cx + 5, y + 2, tuskColor);
    result += pixel(cx + 4, y, tuskHighlight);
  } else {
    // Normal tusks
    result += fillRect(cx - 6, y - 1, 2, 3, tuskColor);
    result += fillRect(cx - 7, y + 2, 2, 2, tuskColor);
    result += pixel(cx - 5, y, tuskShadow);
    result += fillRect(cx + 4, y - 1, 2, 3, tuskColor);
    result += fillRect(cx + 5, y + 2, 2, 2, tuskColor);
    result += pixel(cx + 4, y, tuskShadow);
  }

  return result;
}

/**
 * Draw vampire fangs visible below lips
 * @param {number} cx - Center X
 * @param {number} y - Y position (below mouth)
 * @param {string} size - 'normal' (2px) or 'prominent' (4px with gradient)
 * @returns {string} SVG elements
 */
function drawVampireFangs(cx, y, size = 'normal') {
  let result = '';

  if (size === 'prominent') {
    // Left fang - 4 pixels tall with gradient
    result += pixel(cx - 2, y, '#ffffff');
    result += pixel(cx - 2, y + 1, '#f8f8f8');
    result += pixel(cx - 2, y + 2, '#f0f0f0');
    result += pixel(cx - 2, y + 3, '#e8e8e8');
    // Right fang
    result += pixel(cx + 1, y, '#ffffff');
    result += pixel(cx + 1, y + 1, '#f8f8f8');
    result += pixel(cx + 1, y + 2, '#f0f0f0');
    result += pixel(cx + 1, y + 3, '#e8e8e8');
  } else {
    // Normal 2-pixel fangs
    result += pixel(cx - 2, y, '#f8f8f8');
    result += pixel(cx - 2, y + 1, '#f0f0f0');
    result += pixel(cx + 1, y, '#f8f8f8');
    result += pixel(cx + 1, y + 1, '#f0f0f0');
  }
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

// ============================================================================
// TEXTURE PATTERNS (for enemy portraits)
// ============================================================================

/**
 * Generate a checkerboard dither pattern
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {string} color1 - Primary color
 * @param {string} color2 - Secondary color
 * @returns {string} SVG elements
 */
function ditherPattern(x, y, w, h, color1, color2) {
  let result = fillRect(x, y, w, h, color1);
  for (let py = 0; py < h; py++) {
    for (let px = (py % 2); px < w; px += 2) {
      result += pixel(x + px, y + py, color2);
    }
  }
  return result;
}

/**
 * Generate fur texture with vertical strokes
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {object} palette - 5-tier palette (outline, shadow, base, highlight, bright)
 * @returns {string} SVG elements
 */
function furTexture(x, y, w, h, palette) {
  let result = fillRect(x, y, w, h, palette.base);
  // Add fur strokes
  for (let px = 0; px < w; px += 2) {
    const strokeHeight = 2 + (px % 4);
    const color = px % 4 === 0 ? palette.shadow : palette.highlight;
    result += fillRect(x + px, y, 1, Math.min(strokeHeight, h), color);
  }
  // Bottom fringe
  for (let px = 0; px < w; px += 3) {
    result += fillRect(x + px, y + h - 2, 1, 2, palette.shadow);
  }
  return result;
}

/**
 * Generate stone texture with cracks
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {object} palette - 5-tier palette
 * @param {number} seed - Random seed for crack placement
 * @returns {string} SVG elements
 */
function stoneTexture(x, y, w, h, palette, seed = 0) {
  let result = fillRect(x, y, w, h, palette.base);
  // Highlight on top-left
  result += fillRect(x, y, Math.floor(w / 3), 2, palette.highlight);
  result += fillRect(x, y, 2, Math.floor(h / 3), palette.highlight);
  // Shadow on bottom-right
  result += fillRect(x + w - 2, y + Math.floor(h / 2), 2, Math.floor(h / 2), palette.shadow);
  result += fillRect(x + Math.floor(w / 2), y + h - 2, Math.floor(w / 2), 2, palette.shadow);
  // Add cracks
  const crackX = x + 3 + (seed % (w - 6));
  const crackY = y + 2;
  result += fillRect(crackX, crackY, 1, Math.floor(h * 0.6), palette.outline);
  result += fillRect(crackX + 1, crackY + 3, 2, 1, palette.outline);
  result += fillRect(crackX - 1, crackY + Math.floor(h * 0.4), 2, 1, palette.outline);
  return result;
}

/**
 * Generate scale/reptile texture
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {object} palette - 5-tier palette
 * @returns {string} SVG elements
 */
function scaleTexture(x, y, w, h, palette) {
  let result = fillRect(x, y, w, h, palette.base);
  // Draw overlapping scale pattern
  for (let row = 0; row < Math.floor(h / 3); row++) {
    const offset = (row % 2) * 2;
    for (let col = 0; col < Math.floor(w / 4); col++) {
      const sx = x + offset + col * 4;
      const sy = y + row * 3;
      if (sx + 3 <= x + w && sy + 2 <= y + h) {
        result += fillRect(sx, sy, 3, 2, palette.shadow);
        result += fillRect(sx + 1, sy, 1, 1, palette.highlight);
      }
    }
  }
  return result;
}

/**
 * Generate cloth/woven texture
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {object} palette - 5-tier palette
 * @returns {string} SVG elements
 */
function clothTexture(x, y, w, h, palette) {
  let result = fillRect(x, y, w, h, palette.base);
  // Horizontal threads
  for (let py = 0; py < h; py += 3) {
    result += fillRect(x, y + py, w, 1, palette.shadow);
  }
  // Vertical threads (offset)
  for (let px = 1; px < w; px += 4) {
    for (let py = 1; py < h; py += 3) {
      result += pixel(x + px, y + py, palette.highlight);
    }
  }
  return result;
}

// ============================================================================
// ENEMY COMPOSITE SHAPES
// ============================================================================

/**
 * Draw glowing eyes (for monsters/undead)
 * @param {number} cx - Center X between eyes
 * @param {number} y - Y position
 * @param {number} spacing - Distance between eye centers
 * @param {object} glowPalette - { dark, mid, light, bright } glow colors
 * @param {string} size - 'small', 'medium', 'large'
 * @returns {string} SVG elements
 */
function drawGlowingEyes(cx, y, spacing, glowPalette, size = 'medium') {
  const leftX = cx - Math.floor(spacing / 2);
  const rightX = cx + Math.floor(spacing / 2);
  let result = '';

  if (size === 'small') {
    // 3x3 eyes
    result += fillRect(leftX - 1, y - 1, 3, 3, glowPalette.dark);
    result += fillRect(rightX - 1, y - 1, 3, 3, glowPalette.dark);
    result += pixel(leftX, y, glowPalette.mid);
    result += pixel(rightX, y, glowPalette.mid);
  } else if (size === 'medium') {
    // 5x4 eyes
    result += fillRect(leftX - 2, y - 1, 5, 4, glowPalette.dark);
    result += fillRect(rightX - 2, y - 1, 5, 4, glowPalette.dark);
    result += fillRect(leftX - 1, y, 3, 2, glowPalette.mid);
    result += fillRect(rightX - 1, y, 3, 2, glowPalette.mid);
    result += pixel(leftX, y, glowPalette.light);
    result += pixel(rightX, y, glowPalette.light);
  } else {
    // 7x5 eyes
    result += fillRect(leftX - 3, y - 2, 7, 5, glowPalette.dark);
    result += fillRect(rightX - 3, y - 2, 7, 5, glowPalette.dark);
    result += fillRect(leftX - 2, y - 1, 5, 3, glowPalette.mid);
    result += fillRect(rightX - 2, y - 1, 5, 3, glowPalette.mid);
    result += fillRect(leftX - 1, y, 3, 2, glowPalette.light);
    result += fillRect(rightX - 1, y, 3, 2, glowPalette.light);
    result += pixel(leftX, y, glowPalette.bright);
    result += pixel(rightX, y, glowPalette.bright);
  }

  return result;
}

/**
 * Draw beast fangs
 * @param {number} cx - Center X
 * @param {number} y - Y position (top of fangs)
 * @param {number} length - Fang length
 * @param {number} spacing - Distance between fangs
 * @returns {string} SVG elements
 */
function drawBeastFangs(cx, y, length, spacing) {
  let result = '';
  const halfSpace = Math.floor(spacing / 2);
  // Left fang
  result += fillRect(cx - halfSpace - 1, y, 2, length, '#f0e8d8');
  result += fillRect(cx - halfSpace, y, 1, length - 1, '#ffffff');
  // Right fang
  result += fillRect(cx + halfSpace - 1, y, 2, length, '#f0e8d8');
  result += fillRect(cx + halfSpace, y, 1, length - 1, '#ffffff');
  return result;
}

/**
 * Draw claws
 * @param {number} x - Starting X
 * @param {number} y - Y position
 * @param {number} count - Number of claws
 * @param {string} direction - 'down' or 'up'
 * @returns {string} SVG elements
 */
function drawClaws(x, y, count, direction = 'down') {
  let result = '';
  const clawColor = '#3a3030';
  const tipColor = '#f0e8d8';

  for (let i = 0; i < count; i++) {
    const cx = x + i * 3;
    if (direction === 'down') {
      result += fillRect(cx, y, 2, 4, clawColor);
      result += pixel(cx, y + 4, tipColor);
      result += pixel(cx + 1, y + 5, tipColor);
    } else {
      result += fillRect(cx, y, 2, 4, clawColor);
      result += pixel(cx, y - 1, tipColor);
      result += pixel(cx + 1, y - 2, tipColor);
    }
  }
  return result;
}

/**
 * Draw horns
 * @param {number} cx - Center X
 * @param {number} y - Y position (base of horns)
 * @param {string} style - 'curved', 'straight', 'small'
 * @param {object} palette - { dark, mid, light } colors
 * @returns {string} SVG elements
 */
function drawHorns(cx, y, style, palette) {
  let result = '';

  if (style === 'curved') {
    // Left horn curves outward
    result += fillRect(cx - 14, y - 8, 4, 10, palette.dark);
    result += fillRect(cx - 16, y - 12, 3, 6, palette.dark);
    result += fillRect(cx - 17, y - 14, 2, 4, palette.mid);
    result += fillRect(cx - 13, y - 6, 2, 8, palette.mid);
    result += pixel(cx - 17, y - 14, palette.light);
    // Right horn
    result += fillRect(cx + 10, y - 8, 4, 10, palette.dark);
    result += fillRect(cx + 13, y - 12, 3, 6, palette.dark);
    result += fillRect(cx + 15, y - 14, 2, 4, palette.mid);
    result += fillRect(cx + 11, y - 6, 2, 8, palette.mid);
    result += pixel(cx + 16, y - 14, palette.light);
  } else if (style === 'straight') {
    // Left horn points up
    result += fillRect(cx - 12, y - 6, 3, 8, palette.dark);
    result += fillRect(cx - 13, y - 10, 2, 6, palette.dark);
    result += fillRect(cx - 12, y - 12, 1, 4, palette.mid);
    result += fillRect(cx - 11, y - 4, 1, 6, palette.mid);
    // Right horn
    result += fillRect(cx + 9, y - 6, 3, 8, palette.dark);
    result += fillRect(cx + 11, y - 10, 2, 6, palette.dark);
    result += fillRect(cx + 11, y - 12, 1, 4, palette.mid);
    result += fillRect(cx + 10, y - 4, 1, 6, palette.mid);
  } else {
    // Small nubs
    result += fillRect(cx - 10, y - 2, 3, 4, palette.dark);
    result += fillRect(cx - 9, y - 3, 1, 2, palette.mid);
    result += fillRect(cx + 7, y - 2, 3, 4, palette.dark);
    result += fillRect(cx + 8, y - 3, 1, 2, palette.mid);
  }

  return result;
}

/**
 * Draw bat-style wings
 * @param {number} x - X position (left edge for left wing, right edge for right wing)
 * @param {number} y - Y position
 * @param {string} side - 'left' or 'right'
 * @param {object} palette - { dark, mid, light } membrane colors
 * @returns {string} SVG elements
 */
function drawBatWing(x, y, side, palette) {
  let result = '';

  if (side === 'left') {
    // Wing membrane
    result += fillRect(x, y, 14, 30, palette.dark);
    result += fillRect(x + 2, y + 2, 10, 26, palette.mid);
    // Finger bones
    result += fillRect(x + 4, y, 2, 28, palette.dark);
    result += fillRect(x + 8, y + 2, 2, 24, palette.dark);
    result += fillRect(x + 12, y + 4, 2, 18, palette.dark);
    // Highlights between bones
    result += fillRect(x + 2, y + 4, 2, 20, palette.light);
    result += fillRect(x + 6, y + 6, 2, 16, palette.light);
  } else {
    // Wing membrane
    result += fillRect(x - 14, y, 14, 30, palette.dark);
    result += fillRect(x - 12, y + 2, 10, 26, palette.mid);
    // Finger bones
    result += fillRect(x - 6, y, 2, 28, palette.dark);
    result += fillRect(x - 10, y + 2, 2, 24, palette.dark);
    result += fillRect(x - 14, y + 4, 2, 18, palette.dark);
    // Highlights
    result += fillRect(x - 4, y + 4, 2, 20, palette.light);
    result += fillRect(x - 8, y + 6, 2, 16, palette.light);
  }

  return result;
}

/**
 * Draw feathered wing
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} side - 'left' or 'right'
 * @param {object} palette - { dark, mid, light, highlight } feather colors
 * @returns {string} SVG elements
 */
function drawFeatheredWing(x, y, side, palette) {
  let result = '';
  const dir = side === 'left' ? 1 : -1;

  // Base wing shape
  result += fillRect(x, y, 12 * dir, 36, palette.dark);

  // Layered feathers (3 rows)
  for (let row = 0; row < 3; row++) {
    const fy = y + 4 + row * 10;
    const fw = 10 - row * 2;
    result += fillRect(x + (side === 'left' ? 1 : -fw - 1), fy, fw, 8, palette.mid);
    result += fillRect(x + (side === 'left' ? 2 : -fw), fy + 1, fw - 2, 2, palette.light);
    // Feather tips
    for (let i = 0; i < 3; i++) {
      const fx = x + (side === 'left' ? 1 + i * 3 : -2 - i * 3);
      result += fillRect(fx, fy + 6, 2, 3, palette.highlight);
    }
  }

  return result;
}

/**
 * Draw armor helmet
 * @param {number} cx - Center X
 * @param {number} y - Y position (top of helmet)
 * @param {string} style - 'knight', 'guard', 'dark'
 * @param {object} palette - 5-tier armor palette
 * @returns {string} SVG elements
 */
function drawHelmet(cx, y, style, palette) {
  let result = '';

  if (style === 'knight' || style === 'dark') {
    // Full helm with T-visor
    result += pixelEllipse(cx, y + 20, 16, 22, palette.outline);
    result += pixelEllipse(cx, y + 19, 15, 21, palette.shadow);
    result += pixelEllipse(cx, y + 18, 14, 20, palette.base);
    // Crest
    result += fillRect(cx - 2, y, 4, 14, palette.shadow);
    result += fillRect(cx - 1, y + 2, 2, 10, palette.base);
    // T-visor
    result += fillRect(cx - 8, y + 18, 16, 3, '#0a0a10');
    result += fillRect(cx - 1, y + 18, 2, 12, '#0a0a10');
    if (style === 'dark') {
      // Dark glow in visor
      result += fillRect(cx - 7, y + 19, 14, 1, palette.highlight);
      result += fillRect(cx, y + 20, 1, 8, palette.highlight);
    }
  } else if (style === 'guard') {
    // Open face helmet with cheek guards
    result += pixelEllipse(cx, y + 18, 14, 20, palette.outline);
    result += pixelEllipse(cx, y + 17, 13, 19, palette.shadow);
    result += pixelEllipse(cx, y + 16, 12, 18, palette.base);
    result += pixelEllipse(cx, y + 14, 8, 12, palette.highlight);
    // Golden crest
    result += fillRect(cx - 3, y, 6, 10, '#8b6914');
    result += fillRect(cx - 2, y + 2, 4, 6, '#daa520');
    // Cheek guards
    result += fillRect(cx - 14, y + 22, 5, 12, palette.shadow);
    result += fillRect(cx - 13, y + 24, 3, 8, palette.base);
    result += fillRect(cx + 9, y + 22, 5, 12, palette.shadow);
    result += fillRect(cx + 10, y + 24, 3, 8, palette.base);
  }

  return result;
}

/**
 * Draw shoulder armor
 * @param {number} cx - Center X
 * @param {number} y - Y position
 * @param {string} style - 'plate', 'leather', 'cloth'
 * @param {object} palette - 5-tier palette
 * @returns {string} SVG elements
 */
function drawShoulderArmor(cx, y, style, palette) {
  let result = '';

  if (style === 'plate') {
    // Heavy plate pauldrons
    result += fillRect(cx - 24, y, 18, 14, palette.outline);
    result += fillRect(cx - 23, y + 1, 16, 12, palette.shadow);
    result += fillRect(cx - 22, y + 2, 14, 10, palette.base);
    result += fillRect(cx - 21, y + 3, 6, 4, palette.highlight);

    result += fillRect(cx + 6, y, 18, 14, palette.outline);
    result += fillRect(cx + 7, y + 1, 16, 12, palette.shadow);
    result += fillRect(cx + 8, y + 2, 14, 10, palette.base);
    result += fillRect(cx + 15, y + 3, 6, 4, palette.highlight);
  } else if (style === 'leather') {
    // Lighter leather shoulders
    result += fillRect(cx - 18, y, 14, 12, palette.shadow);
    result += fillRect(cx - 17, y + 1, 12, 10, palette.base);
    result += fillRect(cx - 16, y + 2, 4, 3, palette.highlight);

    result += fillRect(cx + 4, y, 14, 12, palette.shadow);
    result += fillRect(cx + 5, y + 1, 12, 10, palette.base);
    result += fillRect(cx + 12, y + 2, 4, 3, palette.highlight);
  } else {
    // Cloth/robe shoulders
    result += fillRect(cx - 16, y, 12, 16, palette.base);
    result += fillRect(cx - 15, y + 2, 4, 12, palette.highlight);

    result += fillRect(cx + 4, y, 12, 16, palette.base);
    result += fillRect(cx + 12, y + 2, 4, 12, palette.shadow);
  }

  return result;
}

// ============================================================================
// CHARACTER-SPECIFIC HELPERS
// ============================================================================

/**
 * Draw magical aura particles around a point
 * @param {number} cx - Center X
 * @param {number} y - Y position
 * @param {object} palette - { dark, mid, light, bright } magic colors
 * @param {string} intensity - 'subtle', 'medium', 'strong'
 * @returns {string} SVG elements
 */
function drawMagicAura(cx, y, palette, intensity = 'medium') {
  let result = '';

  if (intensity === 'subtle') {
    // Few scattered particles
    result += pixel(cx - 6, y - 2, palette.light);
    result += pixel(cx + 5, y - 3, palette.mid);
    result += pixel(cx - 4, y + 2, palette.mid);
  } else if (intensity === 'medium') {
    // Ring of particles
    result += pixel(cx - 8, y - 4, palette.dark);
    result += pixel(cx - 5, y - 6, palette.mid);
    result += pixel(cx, y - 7, palette.light);
    result += pixel(cx + 5, y - 6, palette.mid);
    result += pixel(cx + 8, y - 4, palette.dark);
    result += pixel(cx - 7, y, palette.mid);
    result += pixel(cx + 7, y, palette.mid);
  } else {
    // Dense aura with bright core
    result += pixel(cx - 10, y - 5, palette.dark);
    result += pixel(cx - 7, y - 7, palette.mid);
    result += pixel(cx - 3, y - 8, palette.light);
    result += pixel(cx, y - 9, palette.bright);
    result += pixel(cx + 3, y - 8, palette.light);
    result += pixel(cx + 7, y - 7, palette.mid);
    result += pixel(cx + 10, y - 5, palette.dark);
    result += pixel(cx - 9, y - 1, palette.mid);
    result += pixel(cx + 9, y - 1, palette.mid);
    result += pixel(cx - 6, y + 2, palette.light);
    result += pixel(cx + 6, y + 2, palette.light);
  }

  return result;
}

/**
 * Draw war paint patterns on face
 * @param {number} cx - Center X
 * @param {number} y - Y position (eye level)
 * @param {string} pattern - 'stripes', 'tribal', 'woad', 'skull'
 * @param {string} color - Paint color
 * @returns {string} SVG elements
 */
function drawWarPaint(cx, y, pattern, color) {
  let result = '';

  if (pattern === 'stripes') {
    // Vertical stripes down cheeks
    result += fillRect(cx - 8, y + 2, 2, 12, color);
    result += fillRect(cx + 6, y + 2, 2, 12, color);
    result += fillRect(cx - 5, y + 4, 1, 8, color);
    result += fillRect(cx + 4, y + 4, 1, 8, color);
  } else if (pattern === 'tribal') {
    // Zigzag tribal marks
    result += fillRect(cx - 10, y + 2, 3, 2, color);
    result += fillRect(cx - 8, y + 4, 3, 2, color);
    result += fillRect(cx - 10, y + 6, 3, 2, color);
    result += fillRect(cx + 7, y + 2, 3, 2, color);
    result += fillRect(cx + 5, y + 4, 3, 2, color);
    result += fillRect(cx + 7, y + 6, 3, 2, color);
  } else if (pattern === 'woad') {
    // Celtic-style woad patterns
    result += fillRect(cx - 12, y - 2, 4, 1, color);
    result += fillRect(cx - 11, y - 1, 3, 1, color);
    result += fillRect(cx - 10, y, 2, 1, color);
    result += fillRect(cx + 8, y - 2, 4, 1, color);
    result += fillRect(cx + 8, y - 1, 3, 1, color);
    result += fillRect(cx + 8, y, 2, 1, color);
    // Chin mark
    result += fillRect(cx - 2, y + 12, 4, 2, color);
  } else if (pattern === 'skull') {
    // Skull face paint
    result += pixelEllipse(cx - 5, y, 3, 3, color);
    result += pixelEllipse(cx + 5, y, 3, 3, color);
    result += fillRect(cx - 1, y + 4, 2, 4, color);
  }

  return result;
}

/**
 * Draw enhanced eyes with different styles
 * @param {number} leftX - Left eye center X
 * @param {number} y - Eye center Y
 * @param {number} spacing - Distance between eyes
 * @param {object} eyeColor - Eye color palette
 * @param {string} style - 'normal', 'fierce', 'glowing', 'cat', 'serene'
 * @returns {string} SVG elements
 */
function drawEnhancedEyes(leftX, y, spacing, eyeColor, style = 'normal') {
  const rightX = leftX + spacing;
  let result = '';

  if (style === 'glowing') {
    // Glowing magical eyes
    const glowPalette = {
      dark: eyeColor.pupil,
      mid: eyeColor.iris,
      light: eyeColor.highlight,
      bright: '#ffffff'
    };
    result += drawGlowingEyes((leftX + rightX) / 2, y, spacing, glowPalette, 'small');
    return result;
  }

  // Eye whites
  const whiteColor = style === 'fierce' ? '#f8e8e0' : '#f0f0e8';
  result += fillRect(leftX - 2, y - 1, 4, 3, whiteColor);
  result += fillRect(rightX - 2, y - 1, 4, 3, whiteColor);

  if (style === 'cat') {
    // Vertical slit pupils
    result += fillRect(leftX - 1, y - 1, 2, 3, eyeColor.iris);
    result += fillRect(rightX - 1, y - 1, 2, 3, eyeColor.iris);
    result += pixel(leftX, y - 1, eyeColor.pupil);
    result += pixel(leftX, y, eyeColor.pupil);
    result += pixel(leftX, y + 1, eyeColor.pupil);
    result += pixel(rightX, y - 1, eyeColor.pupil);
    result += pixel(rightX, y, eyeColor.pupil);
    result += pixel(rightX, y + 1, eyeColor.pupil);
  } else if (style === 'serene') {
    // Slightly closed, peaceful eyes
    result += fillRect(leftX - 2, y, 4, 2, whiteColor);
    result += fillRect(rightX - 2, y, 4, 2, whiteColor);
    result += fillRect(leftX - 1, y, 2, 2, eyeColor.iris);
    result += fillRect(rightX - 1, y, 2, 2, eyeColor.iris);
    result += pixel(leftX, y, eyeColor.pupil);
    result += pixel(rightX, y, eyeColor.pupil);
  } else {
    // Normal or fierce
    result += fillRect(leftX - 1, y - 1, 2, 2, eyeColor.iris);
    result += fillRect(rightX - 1, y - 1, 2, 2, eyeColor.iris);
    result += pixel(leftX, y, eyeColor.pupil);
    result += pixel(rightX, y, eyeColor.pupil);
  }

  // Highlights
  result += pixel(leftX - 1, y - 1, '#ffffff');
  result += pixel(rightX - 1, y - 1, '#ffffff');

  // Fierce eyes get red corners
  if (style === 'fierce') {
    result += pixel(leftX - 2, y - 1, '#c08080');
    result += pixel(rightX + 1, y - 1, '#c08080');
  }

  return result;
}

/**
 * Draw hair with shine/texture using furTexture
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {object} palette - Hair palette { outline, dark, base, highlight }
 * @param {string} style - 'straight', 'wavy', 'curly', 'spiky'
 * @returns {string} SVG elements
 */
function drawTexturedHair(x, y, w, h, palette, style = 'straight') {
  let result = '';

  // Convert hair palette to 5-tier format for furTexture
  const furPalette = {
    outline: palette.outline,
    shadow: palette.dark,
    base: palette.base,
    highlight: palette.highlight,
    bright: palette.highlight  // Use highlight as bright too
  };

  if (style === 'straight') {
    result += furTexture(x, y, w, h, furPalette);
  } else if (style === 'wavy') {
    // Wavy pattern with alternating strips
    for (let i = 0; i < w; i += 4) {
      const offset = (i % 8 === 0) ? 0 : 2;
      const stripH = Math.min(h - offset, h);
      result += furTexture(x + i, y + offset, Math.min(4, w - i), stripH, furPalette);
    }
  } else if (style === 'curly') {
    // Curly with circular highlights
    result += fillRect(x, y, w, h, palette.base);
    for (let py = 0; py < h; py += 4) {
      for (let px = 0; px < w; px += 4) {
        const color = ((px + py) % 8 === 0) ? palette.highlight : palette.dark;
        result += fillRect(x + px, y + py, 2, 2, color);
      }
    }
  } else if (style === 'spiky') {
    // Spiky with pointed tips
    result += fillRect(x, y + 4, w, h - 4, palette.base);
    for (let px = 0; px < w; px += 3) {
      const spikeHeight = 4 + (px % 6 === 0 ? 2 : 0);
      result += fillRect(x + px, y, 2, spikeHeight, palette.dark);
      result += pixel(x + px, y, palette.highlight);
    }
  }

  // Add shine streak
  result += fillRect(x + Math.floor(w * 0.3), y + 1, Math.max(2, Math.floor(w * 0.15)), Math.min(4, h - 2), palette.highlight);

  return result;
}

/**
 * Draw a battle scar
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} direction - 'diagonal', 'vertical', 'horizontal'
 * @param {number} length - Scar length in pixels
 * @returns {string} SVG elements
 */
function drawScar(x, y, direction, length) {
  let result = '';
  const scarColor = '#8a6a5a';
  const scarHighlight = '#a08070';

  if (direction === 'diagonal') {
    for (let i = 0; i < length; i++) {
      result += pixel(x + i, y + i, scarColor);
      if (i > 0) result += pixel(x + i - 1, y + i, scarHighlight);
    }
  } else if (direction === 'vertical') {
    result += fillRect(x, y, 1, length, scarColor);
    result += fillRect(x + 1, y, 1, length, scarHighlight);
  } else {
    result += fillRect(x, y, length, 1, scarColor);
    result += fillRect(x, y + 1, length, 1, scarHighlight);
  }

  return result;
}

/**
 * Draw beard with texture
 * @param {number} cx - Center X
 * @param {number} y - Y position (start of beard)
 * @param {object} palette - Hair palette
 * @param {string} style - 'full', 'goatee', 'stubble', 'braided'
 * @returns {string} SVG elements
 */
function drawBeard(cx, y, palette, style) {
  let result = '';
  const furPalette = {
    outline: palette.outline,
    shadow: palette.dark,
    base: palette.base,
    highlight: palette.highlight,
    bright: palette.highlight
  };

  if (style === 'full') {
    // Full bushy beard
    result += furTexture(cx - 10, y, 20, 22, furPalette);
    result += furTexture(cx - 8, y + 18, 16, 8, furPalette);
  } else if (style === 'goatee') {
    // Small pointed goatee
    result += furTexture(cx - 4, y, 8, 10, furPalette);
    result += fillRect(cx - 2, y + 8, 4, 6, palette.base);
  } else if (style === 'stubble') {
    // Light stubble
    result += ditherPattern(cx - 8, y, 16, 8, palette.base, palette.dark);
  } else if (style === 'braided') {
    // Braided dwarf-style
    result += furTexture(cx - 10, y, 20, 16, furPalette);
    // Center braid
    result += fillRect(cx - 2, y + 14, 4, 16, palette.dark);
    result += fillRect(cx - 1, y + 14, 2, 14, palette.base);
    // Braid rings
    result += fillRect(cx - 2, y + 18, 4, 2, '#8a8a90');
    result += fillRect(cx - 2, y + 24, 4, 2, '#8a8a90');
  }

  return result;
}

/**
 * Draw gender-aware eyes with different styling
 * @param {number} leftX - Left eye center X
 * @param {number} y - Eye center Y
 * @param {number} spacing - Distance between eyes
 * @param {object} eyeColor - Eye color palette
 * @param {string} baseStyle - 'normal', 'fierce', 'glowing', 'cat', 'serene'
 * @param {string} gender - 'male', 'female', 'other'
 * @returns {string} SVG elements
 */
function drawGenderedEyes(leftX, y, spacing, eyeColor, baseStyle = 'normal', gender = 'other') {
  const rightX = leftX + spacing;
  let result = '';

  // Use drawEnhancedEyes for base rendering
  result += drawEnhancedEyes(leftX, y, spacing, eyeColor, baseStyle);

  if (gender === 'female') {
    // Add eyelashes (3 pixels per eye)
    // Left eye lashes - upper
    result += pixel(leftX - 2, y - 2, '#2a2020');
    result += pixel(leftX - 1, y - 2, '#2a2020');
    result += pixel(leftX, y - 2, '#2a2020');
    // Right eye lashes
    result += pixel(rightX - 1, y - 2, '#2a2020');
    result += pixel(rightX, y - 2, '#2a2020');
    result += pixel(rightX + 1, y - 2, '#2a2020');
    // Lower lash line (subtle)
    result += pixel(leftX - 1, y + 2, '#3a3030');
    result += pixel(rightX, y + 2, '#3a3030');
  } else if (gender === 'male') {
    // Heavier brow shadow
    result += fillRect(leftX - 3, y - 3, 6, 1, '#4a3a30');
    result += fillRect(rightX - 3, y - 3, 6, 1, '#4a3a30');
    // Slightly thicker brow line
    result += fillRect(leftX - 2, y - 2, 4, 1, '#3a2a20');
    result += fillRect(rightX - 2, y - 2, 4, 1, '#3a2a20');
  }
  // 'other' uses neutral base sizing from drawEnhancedEyes

  return result;
}

/**
 * Draw cheekbone highlights
 * @param {number} cx - Face center X
 * @param {number} y - Y position (cheek level)
 * @param {object} skinPalette - Skin palette
 * @param {string} gender - 'male', 'female', 'other'
 * @param {string} intensity - 'subtle', 'normal', 'prominent'
 * @returns {string} SVG elements
 */
function drawCheekbones(cx, y, skinPalette, gender = 'other', intensity = 'normal') {
  let result = '';

  if (gender === 'female') {
    // Higher, more prominent cheekbones
    const xOffset = intensity === 'prominent' ? 8 : 9;
    const width = intensity === 'prominent' ? 5 : 4;
    result += fillRect(cx - xOffset - width, y - 2, width, 2, skinPalette.highlight);
    result += fillRect(cx + xOffset, y - 2, width, 2, skinPalette.highlight);
    // Add bright point for dramatic effect
    if (intensity === 'prominent') {
      result += pixel(cx - xOffset - 2, y - 2, skinPalette.bright);
      result += pixel(cx + xOffset + 1, y - 2, skinPalette.bright);
    }
  } else if (gender === 'male') {
    // Lower, more subtle cheekbones
    const xOffset = 11;
    const width = intensity === 'subtle' ? 2 : 3;
    result += fillRect(cx - xOffset - width, y + 1, width, 1, skinPalette.highlight);
    result += fillRect(cx + xOffset, y + 1, width, 1, skinPalette.highlight);
  } else {
    // Balanced/androgynous
    result += fillRect(cx - 12, y, 3, 1, skinPalette.highlight);
    result += fillRect(cx + 9, y, 3, 1, skinPalette.highlight);
  }

  return result;
}

/**
 * Draw eye glow effect (for berserker rage, etc.)
 * @param {number} cx - Center X between eyes
 * @param {number} y - Y position
 * @param {object} glowPalette - { dark, mid, light, bright } glow colors
 * @param {string} intensity - 'subtle', 'normal', 'intense'
 * @returns {string} SVG elements
 */
function drawEyeGlow(cx, y, glowPalette, intensity = 'normal') {
  let result = '';

  if (intensity === 'subtle') {
    // Few particles near eyes
    result += pixel(cx - 8, y - 1, glowPalette.dark);
    result += pixel(cx + 7, y - 1, glowPalette.dark);
    result += pixel(cx - 6, y + 2, glowPalette.mid);
    result += pixel(cx + 5, y + 2, glowPalette.mid);
  } else if (intensity === 'normal') {
    // Ring of particles around eyes
    result += pixel(cx - 9, y - 2, glowPalette.dark);
    result += pixel(cx - 7, y - 3, glowPalette.mid);
    result += pixel(cx - 5, y - 2, glowPalette.light);
    result += pixel(cx + 8, y - 2, glowPalette.dark);
    result += pixel(cx + 6, y - 3, glowPalette.mid);
    result += pixel(cx + 4, y - 2, glowPalette.light);
    // Below eyes
    result += pixel(cx - 6, y + 3, glowPalette.mid);
    result += pixel(cx + 5, y + 3, glowPalette.mid);
  } else {
    // Intense rage glow with many particles
    result += pixel(cx - 10, y - 3, glowPalette.dark);
    result += pixel(cx - 8, y - 4, glowPalette.mid);
    result += pixel(cx - 6, y - 3, glowPalette.light);
    result += pixel(cx - 4, y - 2, glowPalette.bright);
    result += pixel(cx + 9, y - 3, glowPalette.dark);
    result += pixel(cx + 7, y - 4, glowPalette.mid);
    result += pixel(cx + 5, y - 3, glowPalette.light);
    result += pixel(cx + 3, y - 2, glowPalette.bright);
    // Below eyes - more intense
    result += pixel(cx - 7, y + 3, glowPalette.mid);
    result += pixel(cx - 5, y + 4, glowPalette.light);
    result += pixel(cx + 6, y + 3, glowPalette.mid);
    result += pixel(cx + 4, y + 4, glowPalette.light);
    // Side glow
    result += pixel(cx - 11, y, glowPalette.dark);
    result += pixel(cx + 10, y, glowPalette.dark);
  }

  return result;
}

/**
 * Draw a symbol/emblem
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {string} type - 'cross', 'spiral', 'circle', 'diamond', 'star'
 * @param {string} color - Primary color
 * @param {string} highlight - Highlight color
 * @returns {string} SVG elements
 */
function drawSymbol(cx, cy, type, color, highlight) {
  let result = '';

  if (type === 'cross') {
    // Cross/plus shape (for warrior insignia)
    result += fillRect(cx - 1, cy - 3, 2, 6, color);
    result += fillRect(cx - 3, cy - 1, 6, 2, color);
    result += pixel(cx, cy - 2, highlight);
    result += pixel(cx - 2, cy, highlight);
  } else if (type === 'spiral') {
    // Spiral pattern (for ninja clan)
    result += pixelCircle(cx, cy, 3, color);
    result += pixel(cx - 1, cy - 1, highlight);
    result += pixel(cx, cy - 1, highlight);
    result += pixel(cx + 1, cy, color);
    result += pixel(cx, cy + 1, highlight);
    result += pixel(cx - 1, cy, highlight);
  } else if (type === 'circle') {
    // Focus circle (for monk)
    result += pixelCircle(cx, cy, 2, color);
    result += pixel(cx, cy, highlight);
    // Outer ring
    result += pixel(cx - 3, cy, color);
    result += pixel(cx + 3, cy, color);
    result += pixel(cx, cy - 3, color);
    result += pixel(cx, cy + 3, color);
  } else if (type === 'diamond') {
    // Diamond shape
    result += pixel(cx, cy - 2, color);
    result += fillRect(cx - 1, cy - 1, 2, 2, color);
    result += fillRect(cx - 2, cy, 4, 1, highlight);
    result += pixel(cx, cy + 1, color);
  } else if (type === 'star') {
    // Star shape (5 points)
    result += pixel(cx, cy - 3, highlight);
    result += fillRect(cx - 1, cy - 2, 2, 4, color);
    result += fillRect(cx - 3, cy - 1, 6, 2, color);
    result += pixel(cx - 2, cy + 1, color);
    result += pixel(cx + 1, cy + 1, color);
    result += pixel(cx, cy - 1, highlight);
  }

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
  drawNeck,
  // Texture patterns
  ditherPattern,
  furTexture,
  stoneTexture,
  scaleTexture,
  clothTexture,
  // Enemy composite shapes
  drawGlowingEyes,
  drawBeastFangs,
  drawClaws,
  drawHorns,
  drawBatWing,
  drawFeatheredWing,
  drawHelmet,
  drawShoulderArmor,
  // Character-specific helpers
  drawMagicAura,
  drawWarPaint,
  drawEnhancedEyes,
  drawTexturedHair,
  drawScar,
  drawBeard,
  // New gender/class helpers
  drawGenderedEyes,
  drawCheekbones,
  drawEyeGlow,
  drawSymbol
};
