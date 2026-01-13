/**
 * Race Portrait Templates (Enhanced)
 * Base face/head generators for each race and gender combination
 * Uses 5-tier shading, texture patterns, and enhanced visual depth
 */

const {
  SKIN_PALETTES,
  HAIR_PALETTES,
  EYE_COLORS,
  fillRect,
  pixel,
  pixelEllipse,
  drawNose,
  drawMouth,
  drawPointedEars,
  drawRoundEars,
  drawTusks,
  drawVampireFangs,
  drawNeck,
  drawEnhancedEyes,
  drawTexturedHair,
  drawBeard,
  drawWarPaint,
  furTexture,
  ditherPattern,
  // New imports for gender differentiation
  drawGenderedEyes,
  drawCheekbones
} = require('./utils');

// ============================================================================
// HUMAN - Versatile, balanced features
// ============================================================================

/**
 * Generate Human base portrait (Enhanced v2)
 * Gender-differentiated face shapes and features
 */
function generateHumanBase(gender) {
  const skin = SKIN_PALETTES.human;
  const hair = HAIR_PALETTES.brown;
  const eyes = EYE_COLORS.brown;

  let result = '';
  const cx = 32;

  // Neck with enhanced shading (thicker for males)
  const neckWidth = gender === 'male' ? 6 : 5;
  result += fillRect(cx - neckWidth, 48, neckWidth * 2, 16, skin.outline);
  result += fillRect(cx - neckWidth + 1, 48, neckWidth * 2 - 2, 16, skin.shadow);
  result += fillRect(cx - neckWidth + 2, 48, neckWidth * 2 - 4, 16, skin.base);
  result += fillRect(cx - 2, 48, 3, 16, skin.highlight);

  // Face shape varies by gender
  if (gender === 'male') {
    // Male: Wider face (+1 rx), squarer jaw
    result += pixelEllipse(cx, 33, 16, 19, skin.outline);
    result += pixelEllipse(cx, 32, 15, 18, skin.shadow);
    result += pixelEllipse(cx, 31, 14, 17, skin.base);
    result += pixelEllipse(cx, 30, 12, 15, skin.highlight);
    result += pixelEllipse(cx, 28, 7, 8, skin.bright);
    // Square jaw corners
    result += fillRect(cx - 14, 40, 4, 4, skin.base);
    result += fillRect(cx + 10, 40, 4, 4, skin.base);
    result += fillRect(cx - 13, 41, 2, 2, skin.highlight);
    result += fillRect(cx + 11, 41, 2, 2, skin.shadow);
  } else if (gender === 'female') {
    // Female: Taller oval face (+1 ry), softer jawline, pointed chin
    result += pixelEllipse(cx, 33, 14, 20, skin.outline);
    result += pixelEllipse(cx, 32, 13, 19, skin.shadow);
    result += pixelEllipse(cx, 31, 12, 18, skin.base);
    result += pixelEllipse(cx, 30, 10, 16, skin.highlight);
    result += pixelEllipse(cx, 28, 5, 9, skin.bright);
    // Pointed chin detail
    result += fillRect(cx - 2, 47, 4, 2, skin.base);
    result += pixel(cx, 48, skin.highlight);
  } else {
    // Other: Balanced proportions
    result += pixelEllipse(cx, 33, 15, 19, skin.outline);
    result += pixelEllipse(cx, 32, 14, 18, skin.shadow);
    result += pixelEllipse(cx, 31, 13, 17, skin.base);
    result += pixelEllipse(cx, 30, 11, 15, skin.highlight);
    result += pixelEllipse(cx, 28, 6, 8, skin.bright);
  }

  // Cheekbones vary by gender
  result += drawCheekbones(cx, 32, skin, gender, 'normal');

  // Ears with shading
  result += drawRoundEars(cx - 13, cx + 13, 30, skin);

  // Gender-aware eyes
  result += drawGenderedEyes(cx - 5, 28, 10, eyes, 'normal', gender);

  // Eyebrows - thick for male, arched for female
  if (gender === 'male') {
    // Thick straight eyebrows
    result += fillRect(cx - 9, 24, 6, 2, hair.dark);
    result += fillRect(cx + 3, 24, 6, 2, hair.dark);
    result += fillRect(cx - 8, 24, 4, 1, hair.base);
    result += fillRect(cx + 4, 24, 4, 1, hair.base);
  } else if (gender === 'female') {
    // Arched thin eyebrows
    result += fillRect(cx - 9, 24, 6, 1, hair.dark);
    result += fillRect(cx + 3, 24, 6, 1, hair.dark);
    result += pixel(cx - 10, 25, hair.dark);
    result += pixel(cx + 9, 25, hair.dark);
    // Arch highlight
    result += pixel(cx - 6, 23, hair.base);
    result += pixel(cx + 5, 23, hair.base);
  } else {
    result += fillRect(cx - 8, 24, 5, 1, hair.dark);
    result += fillRect(cx + 3, 24, 5, 1, hair.dark);
  }

  // Nose with highlight
  result += drawNose(cx, 30, skin, 'medium');
  result += pixel(cx, 32, skin.bright);

  // Mouth - fuller lips for female
  if (gender === 'female') {
    result += fillRect(cx - 3, 40, 6, 2, '#8a4a4a');
    result += fillRect(cx - 2, 40, 4, 1, '#a05858');
    result += pixel(cx, 40, '#b06868');
  } else {
    result += drawMouth(cx, 40, skin, 'neutral');
  }

  // Textured hair based on gender
  if (gender === 'male') {
    // Short textured hair
    result += drawTexturedHair(cx - 13, 10, 26, 10, hair, 'straight');
    result += fillRect(cx - 14, 16, 28, 4, hair.dark);
  } else if (gender === 'female') {
    // Long flowing hair with texture
    result += drawTexturedHair(cx - 14, 8, 28, 10, hair, 'wavy');
    // Side hair framing face
    result += drawTexturedHair(cx - 16, 14, 6, 40, hair, 'straight');
    result += drawTexturedHair(cx + 10, 14, 6, 40, hair, 'straight');
  } else {
    // Medium length with gentle waves
    result += drawTexturedHair(cx - 14, 8, 28, 12, hair, 'wavy');
    result += drawTexturedHair(cx - 15, 14, 5, 24, hair, 'straight');
    result += drawTexturedHair(cx + 10, 14, 5, 24, hair, 'straight');
  }

  return result;
}

// ============================================================================
// ELF - Ethereal, angular, elegant
// ============================================================================

/**
 * Generate Elf base portrait (Enhanced v2)
 * Gender-differentiated features with elegant ear shimmer and visible ornaments
 */
function generateElfBase(gender) {
  const skin = SKIN_PALETTES.elf;
  const hair = HAIR_PALETTES.blonde;
  const eyes = EYE_COLORS.green;

  let result = '';
  const cx = 32;

  // Slender neck
  result += fillRect(cx - 4, 48, 8, 16, skin.outline);
  result += fillRect(cx - 3, 48, 6, 16, skin.shadow);
  result += fillRect(cx - 2, 48, 4, 16, skin.base);
  result += fillRect(cx - 1, 48, 2, 16, skin.highlight);

  // Face shape varies by gender
  if (gender === 'male') {
    // Male: Slightly stronger jaw while maintaining elegance
    result += pixelEllipse(cx, 33, 13, 20, skin.outline);
    result += pixelEllipse(cx, 32, 12, 19, skin.shadow);
    result += pixelEllipse(cx, 31, 11, 18, skin.base);
    result += pixelEllipse(cx, 30, 9, 16, skin.highlight);
    result += pixelEllipse(cx, 28, 5, 10, skin.bright);
    // Defined jawline
    result += fillRect(cx - 11, 42, 3, 2, skin.base);
    result += fillRect(cx + 8, 42, 3, 2, skin.base);
  } else if (gender === 'female') {
    // Female: Heart-shaped face, narrower chin
    result += pixelEllipse(cx, 33, 11, 20, skin.outline);
    result += pixelEllipse(cx, 32, 10, 19, skin.shadow);
    result += pixelEllipse(cx, 31, 9, 18, skin.base);
    result += pixelEllipse(cx, 30, 7, 16, skin.highlight);
    result += pixelEllipse(cx, 28, 4, 10, skin.bright);
    // Pointed chin
    result += fillRect(cx - 1, 47, 2, 2, skin.base);
    result += pixel(cx, 48, skin.highlight);
  } else {
    // Other: Balanced elven proportions
    result += pixelEllipse(cx, 33, 12, 20, skin.outline);
    result += pixelEllipse(cx, 32, 11, 19, skin.shadow);
    result += pixelEllipse(cx, 31, 10, 18, skin.base);
    result += pixelEllipse(cx, 30, 8, 16, skin.highlight);
    result += pixelEllipse(cx, 28, 4, 10, skin.bright);
  }

  // Enhanced cheekbones - HIGH for female with prominent highlights
  if (gender === 'female') {
    result += drawCheekbones(cx, 30, skin, 'female', 'prominent');
  } else {
    result += fillRect(cx - 10, 30, 3, 2, skin.shadow);
    result += fillRect(cx + 7, 30, 3, 2, skin.shadow);
    result += pixel(cx - 9, 31, skin.highlight);
    result += pixel(cx + 8, 31, skin.highlight);
  }

  // Enhanced pointed ears with 'elegant' style for more shimmer
  result += drawPointedEars(cx - 10, cx + 10, 28, skin, 'elegant');

  // Gender-aware eyes
  result += drawGenderedEyes(cx - 5, 27, 10, eyes, 'cat', gender);

  // Thin elegant eyebrows - arched for female
  if (gender === 'female') {
    result += fillRect(cx - 9, 22, 6, 1, hair.dark);
    result += fillRect(cx + 3, 22, 6, 1, hair.dark);
    result += pixel(cx - 10, 23, hair.base);
    result += pixel(cx + 9, 23, hair.base);
  } else {
    result += fillRect(cx - 9, 23, 6, 1, hair.dark);
    result += fillRect(cx + 3, 23, 6, 1, hair.dark);
    result += pixel(cx - 9, 22, hair.base);
    result += pixel(cx + 8, 22, hair.base);
  }

  // Delicate nose
  result += drawNose(cx, 29, skin, 'small');
  result += pixel(cx, 30, skin.bright);

  // Elegant mouth - fuller for female
  if (gender === 'female') {
    result += fillRect(cx - 2, 38, 4, 2, '#9a6a70');
    result += fillRect(cx - 1, 38, 2, 1, '#aa7a80');
  } else {
    result += drawMouth(cx, 38, skin, 'neutral');
  }

  // Long flowing hair with shine
  if (gender === 'male') {
    // Long elven warrior style
    result += drawTexturedHair(cx - 13, 6, 26, 14, hair, 'straight');
    result += drawTexturedHair(cx - 14, 14, 5, 46, hair, 'straight');
    result += drawTexturedHair(cx + 9, 14, 5, 46, hair, 'straight');
  } else if (gender === 'female') {
    // Very long cascading hair
    result += drawTexturedHair(cx - 15, 4, 30, 16, hair, 'wavy');
    result += drawTexturedHair(cx - 18, 14, 8, 50, hair, 'straight');
    result += drawTexturedHair(cx + 10, 14, 8, 50, hair, 'straight');
    // VISIBLE HAIR ORNAMENT - Gold circlet with gem (20+ pixels)
    // Circlet band across forehead
    result += fillRect(cx - 10, 10, 20, 2, '#c89830');
    result += fillRect(cx - 9, 10, 18, 1, '#e8b840');
    // Side decorations
    result += fillRect(cx - 12, 11, 3, 2, '#c89830');
    result += fillRect(cx + 9, 11, 3, 2, '#c89830');
    // Center gem (blue sapphire)
    result += fillRect(cx - 2, 9, 4, 4, '#3050a0');
    result += fillRect(cx - 1, 9, 2, 3, '#5080d0');
    result += pixel(cx, 9, '#80b0f0');
    result += pixel(cx - 1, 10, '#ffffff');
  } else {
    // Elegant medium-length
    result += drawTexturedHair(cx - 14, 6, 28, 14, hair, 'wavy');
    result += drawTexturedHair(cx - 15, 14, 6, 36, hair, 'straight');
    result += drawTexturedHair(cx + 9, 14, 6, 36, hair, 'straight');
  }

  return result;
}

// ============================================================================
// DWARF - Stout, rugged, bearded
// ============================================================================

/**
 * Generate Dwarf base portrait (Enhanced v2)
 * Gender-differentiated with female facial hair (sideburns, chin stubble)
 */
function generateDwarfBase(gender) {
  const skin = SKIN_PALETTES.dwarf;
  const hair = HAIR_PALETTES.red;
  const eyes = EYE_COLORS.amber;

  let result = '';
  const cx = 32;

  // Thick muscular neck (thicker for male)
  const neckWidth = gender === 'male' ? 7 : 6;
  result += fillRect(cx - neckWidth, 44, neckWidth * 2, 20, skin.outline);
  result += fillRect(cx - neckWidth + 1, 44, neckWidth * 2 - 2, 20, skin.shadow);
  result += fillRect(cx - neckWidth + 2, 44, neckWidth * 2 - 4, 20, skin.base);
  result += fillRect(cx - 4, 44, 6, 20, skin.highlight);

  // Face shape varies by gender
  if (gender === 'male') {
    // Male: Very wide/blocky, heavy brow ridge
    result += pixelEllipse(cx, 31, 18, 17, skin.outline);
    result += pixelEllipse(cx, 30, 17, 16, skin.shadow);
    result += pixelEllipse(cx, 29, 16, 15, skin.base);
    result += pixelEllipse(cx, 28, 14, 13, skin.highlight);
    result += pixelEllipse(cx, 26, 9, 8, skin.bright);
    // Heavy brow ridge
    result += fillRect(cx - 16, 20, 32, 5, skin.shadow);
    result += fillRect(cx - 15, 19, 30, 4, skin.base);
    result += fillRect(cx - 14, 18, 28, 2, skin.highlight);
  } else if (gender === 'female') {
    // Female: Rounder face with rosy cheeks
    result += pixelEllipse(cx, 31, 16, 16, skin.outline);
    result += pixelEllipse(cx, 30, 15, 15, skin.shadow);
    result += pixelEllipse(cx, 29, 14, 14, skin.base);
    result += pixelEllipse(cx, 28, 12, 12, skin.highlight);
    result += pixelEllipse(cx, 26, 7, 7, skin.bright);
    // Moderate brow ridge
    result += fillRect(cx - 14, 21, 28, 3, skin.shadow);
    result += fillRect(cx - 13, 20, 26, 2, skin.base);
    // ROSY CHEEKS
    result += fillRect(cx - 12, 32, 4, 3, '#c89088');
    result += fillRect(cx + 8, 32, 4, 3, '#c89088');
    result += pixel(cx - 11, 33, '#d8a098');
    result += pixel(cx + 9, 33, '#d8a098');
  } else {
    // Other: Moderate build
    result += pixelEllipse(cx, 31, 17, 17, skin.outline);
    result += pixelEllipse(cx, 30, 16, 16, skin.shadow);
    result += pixelEllipse(cx, 29, 15, 15, skin.base);
    result += pixelEllipse(cx, 28, 13, 13, skin.highlight);
    result += pixelEllipse(cx, 26, 8, 8, skin.bright);
    result += fillRect(cx - 15, 21, 30, 4, skin.shadow);
    result += fillRect(cx - 14, 20, 28, 3, skin.base);
  }

  // Round ears
  result += drawRoundEars(cx - 15, cx + 15, 27, skin);

  // Gender-aware eyes
  result += drawGenderedEyes(cx - 5, 27, 10, eyes, 'fierce', gender);

  // Bushy eyebrows with texture
  const browPalette = { outline: hair.outline, shadow: hair.dark, base: hair.base, highlight: hair.highlight, bright: hair.highlight };
  const browWidth = gender === 'male' ? 8 : 7;
  result += furTexture(cx - 11, 22, browWidth, 4, browPalette);
  result += furTexture(cx + 3, 22, browWidth, 4, browPalette);

  // Large bulbous nose
  result += drawNose(cx, 27, skin, 'large');
  result += fillRect(cx - 2, 33, 4, 2, skin.bright);

  // Mouth (hidden by beard for males)
  if (gender === 'female' || gender === 'other') {
    result += drawMouth(cx, 40, skin, 'neutral');
  }

  // Hair and beard with textures
  if (gender === 'male') {
    // Helmet-like hair
    result += drawTexturedHair(cx - 15, 8, 30, 14, hair, 'straight');
    result += drawTexturedHair(cx - 16, 14, 5, 20, hair, 'straight');
    result += drawTexturedHair(cx + 11, 14, 5, 20, hair, 'straight');

    // Magnificent braided beard with full coverage
    result += drawBeard(cx, 36, hair, 'braided');
  } else if (gender === 'female') {
    // Braided hair
    result += drawTexturedHair(cx - 15, 6, 30, 16, hair, 'curly');
    result += drawTexturedHair(cx - 17, 14, 8, 40, hair, 'straight');
    result += drawTexturedHair(cx + 9, 14, 8, 40, hair, 'straight');

    // SIDEBURNS WITH GOLD RINGS (female dwarves have facial hair!)
    result += furTexture(cx - 15, 30, 4, 14, browPalette);
    result += furTexture(cx + 11, 30, 4, 14, browPalette);
    // Gold rings on sideburns
    result += fillRect(cx - 16, 36, 4, 2, '#c89830');
    result += fillRect(cx - 15, 36, 2, 1, '#e8b840');
    result += fillRect(cx + 12, 36, 4, 2, '#c89830');
    result += fillRect(cx + 13, 36, 2, 1, '#e8b840');
    result += fillRect(cx - 16, 40, 4, 2, '#c89830');
    result += fillRect(cx + 12, 40, 4, 2, '#c89830');

    // LIGHT CHIN STUBBLE via dither pattern
    result += ditherPattern(cx - 6, 42, 12, 4, skin.base, hair.dark);

    // Decorative chin braids (smaller than male)
    result += fillRect(cx - 4, 46, 2, 10, hair.dark);
    result += fillRect(cx + 2, 46, 2, 10, hair.dark);
    result += fillRect(cx - 3, 46, 1, 8, hair.base);
    result += fillRect(cx + 2, 46, 1, 8, hair.base);
    // Braid beads
    result += fillRect(cx - 4, 52, 2, 2, '#c89830');
    result += fillRect(cx + 2, 52, 2, 2, '#c89830');
  } else {
    // Other: Medium hair and stylized trimmed beard
    result += drawTexturedHair(cx - 15, 8, 30, 14, hair, 'straight');
    result += drawTexturedHair(cx - 16, 14, 6, 28, hair, 'straight');
    result += drawTexturedHair(cx + 10, 14, 6, 28, hair, 'straight');

    // Full beard (trimmed style)
    result += drawBeard(cx, 38, hair, 'full');
  }

  return result;
}

// ============================================================================
// VAMPIRE - Pale, predatory, aristocratic
// ============================================================================

/**
 * Generate Vampire base portrait (Enhanced v2)
 * Elegant pointed ears, prominent fangs, dark lip tint
 */
function generateVampireBase(gender) {
  const skin = SKIN_PALETTES.vampire;
  const hair = HAIR_PALETTES.black;
  const eyes = EYE_COLORS.red;

  let result = '';
  const cx = 32;

  // Elegant neck
  result += fillRect(cx - 4, 46, 8, 18, skin.outline);
  result += fillRect(cx - 3, 46, 6, 18, skin.shadow);
  result += fillRect(cx - 2, 46, 4, 18, skin.base);
  result += fillRect(cx - 1, 46, 2, 18, skin.highlight);

  // Face shape varies by gender
  if (gender === 'male') {
    // Male: Longer face, defined jawline
    result += pixelEllipse(cx, 33, 13, 20, skin.outline);
    result += pixelEllipse(cx, 32, 12, 19, skin.shadow);
    result += pixelEllipse(cx, 31, 11, 18, skin.base);
    result += pixelEllipse(cx, 30, 9, 16, skin.highlight);
    result += pixelEllipse(cx, 28, 5, 10, skin.bright);
    // Defined jawline
    result += fillRect(cx - 11, 42, 4, 3, skin.base);
    result += fillRect(cx + 7, 42, 4, 3, skin.base);
    result += fillRect(cx - 10, 43, 2, 1, skin.highlight);
    result += fillRect(cx + 8, 43, 2, 1, skin.shadow);
  } else if (gender === 'female') {
    // Female: Narrower face, dramatic cheekbones
    result += pixelEllipse(cx, 33, 11, 19, skin.outline);
    result += pixelEllipse(cx, 32, 10, 18, skin.shadow);
    result += pixelEllipse(cx, 31, 9, 17, skin.base);
    result += pixelEllipse(cx, 30, 7, 15, skin.highlight);
    result += pixelEllipse(cx, 28, 4, 9, skin.bright);
    // Pointed chin
    result += fillRect(cx - 1, 46, 2, 2, skin.base);
  } else {
    // Other: Balanced aristocratic proportions
    result += pixelEllipse(cx, 33, 13, 19, skin.outline);
    result += pixelEllipse(cx, 32, 12, 18, skin.shadow);
    result += pixelEllipse(cx, 31, 11, 17, skin.base);
    result += pixelEllipse(cx, 30, 9, 15, skin.highlight);
    result += pixelEllipse(cx, 28, 5, 9, skin.bright);
  }

  // Sharp cheekbones - more dramatic for female
  if (gender === 'female') {
    result += drawCheekbones(cx, 31, skin, 'female', 'prominent');
    // Dark eyeliner effect
    result += fillRect(cx - 8, 25, 6, 1, '#3a3040');
    result += fillRect(cx + 2, 25, 6, 1, '#3a3040');
  } else {
    result += fillRect(cx - 12, 31, 4, 3, skin.shadow);
    result += fillRect(cx + 8, 31, 4, 3, skin.shadow);
    result += fillRect(cx - 11, 32, 2, 1, skin.highlight);
    result += fillRect(cx + 9, 32, 2, 1, skin.highlight);
  }

  // ELEGANT POINTED EARS (replacing crude rectangles)
  result += drawPointedEars(cx - 11, cx + 11, 27, skin, 'elegant');

  // Gender-aware glowing eyes
  result += drawGenderedEyes(cx - 5, 27, 10, eyes, 'glowing', gender);

  // Sharp arched eyebrows
  if (gender === 'male') {
    // Widow's peak brow style
    result += fillRect(cx - 10, 22, 7, 1, hair.dark);
    result += fillRect(cx + 3, 22, 7, 1, hair.dark);
    result += pixel(cx - 4, 21, hair.dark);
    result += pixel(cx + 3, 21, hair.dark);
  } else if (gender === 'female') {
    // High arched dramatic brows
    result += fillRect(cx - 9, 21, 6, 1, hair.dark);
    result += fillRect(cx + 3, 21, 6, 1, hair.dark);
    result += pixel(cx - 10, 22, hair.dark);
    result += pixel(cx + 9, 22, hair.dark);
  } else {
    result += fillRect(cx - 10, 22, 7, 1, hair.dark);
    result += pixel(cx - 11, 23, hair.dark);
    result += fillRect(cx + 3, 22, 7, 1, hair.dark);
    result += pixel(cx + 10, 23, hair.dark);
  }

  // Sharp aquiline nose
  result += drawNose(cx, 28, skin, 'small');
  result += pixel(cx, 30, skin.bright);

  // DARK BURGUNDY LIP TINT - fuller for female
  const lipColor = '#7a3040';
  const lipHighlight = '#8a4050';
  if (gender === 'female') {
    result += fillRect(cx - 3, 38, 6, 2, lipColor);
    result += fillRect(cx - 2, 38, 4, 1, lipHighlight);
    result += pixel(cx, 38, '#9a5060');
  } else {
    result += fillRect(cx - 2, 38, 4, 1, lipColor);
    result += fillRect(cx - 1, 38, 2, 1, lipHighlight);
  }

  // PROMINENT FANGS (4 pixels tall with gradient)
  result += drawVampireFangs(cx, 39, 'prominent');

  // Dramatic hair
  if (gender === 'male') {
    // Slicked back aristocratic with widow's peak
    result += drawTexturedHair(cx - 14, 8, 28, 14, hair, 'straight');
    // WIDOW'S PEAK detail
    result += fillRect(cx - 4, 8, 8, 8, hair.dark);
    result += fillRect(cx - 3, 10, 6, 6, hair.base);
    result += fillRect(cx - 2, 12, 4, 4, hair.highlight);
    // Side hair
    result += drawTexturedHair(cx - 15, 16, 4, 20, hair, 'straight');
    result += drawTexturedHair(cx + 11, 16, 4, 20, hair, 'straight');
  } else if (gender === 'female') {
    // Long dramatic black hair
    result += drawTexturedHair(cx - 16, 4, 32, 18, hair, 'wavy');
    result += drawTexturedHair(cx - 18, 14, 9, 50, hair, 'straight');
    result += drawTexturedHair(cx + 9, 14, 9, 50, hair, 'straight');
  } else {
    // Elegant shoulder-length
    result += drawTexturedHair(cx - 15, 6, 30, 16, hair, 'wavy');
    result += drawTexturedHair(cx - 16, 14, 7, 34, hair, 'straight');
    result += drawTexturedHair(cx + 9, 14, 7, 34, hair, 'straight');
  }

  return result;
}

// ============================================================================
// ORC - Brutal, powerful, war-like
// ============================================================================

/**
 * Generate Orc base portrait (Enhanced v2)
 * Dark olive hair for contrast, large tusks, gender-specific war paint
 */
function generateOrcBase(gender) {
  const skin = SKIN_PALETTES.orc;
  // USE NEW DARK OLIVE HAIR for contrast against green skin
  const hair = HAIR_PALETTES.orcHair;
  const eyes = EYE_COLORS.yellow;

  let result = '';
  const cx = 32;

  // Very thick muscular neck (thicker for male)
  const neckWidth = gender === 'male' ? 9 : 8;
  result += fillRect(cx - neckWidth, 42, neckWidth * 2, 22, skin.outline);
  result += fillRect(cx - neckWidth + 1, 42, neckWidth * 2 - 2, 22, skin.shadow);
  result += fillRect(cx - neckWidth + 2, 42, neckWidth * 2 - 4, 22, skin.base);
  result += fillRect(cx - 5, 42, 8, 22, skin.highlight);
  result += fillRect(cx + 4, 42, 4, 22, skin.shadow);

  // Face shape varies by gender
  if (gender === 'male') {
    // Male: Very broad, brutish
    result += pixelEllipse(cx, 31, 19, 17, skin.outline);
    result += pixelEllipse(cx, 30, 18, 16, skin.shadow);
    result += pixelEllipse(cx, 29, 17, 15, skin.base);
    result += pixelEllipse(cx, 28, 15, 13, skin.highlight);
    result += pixelEllipse(cx, 26, 9, 8, skin.bright);
    // Heavy brow ridge
    result += fillRect(cx - 18, 18, 36, 6, skin.shadow);
    result += fillRect(cx - 17, 17, 34, 5, skin.base);
    result += fillRect(cx - 16, 16, 32, 2, skin.highlight);
  } else if (gender === 'female') {
    // Female: Slightly narrower face, higher cheekbones
    result += pixelEllipse(cx, 31, 17, 17, skin.outline);
    result += pixelEllipse(cx, 30, 16, 16, skin.shadow);
    result += pixelEllipse(cx, 29, 15, 15, skin.base);
    result += pixelEllipse(cx, 28, 13, 13, skin.highlight);
    result += pixelEllipse(cx, 26, 7, 8, skin.bright);
    // Moderate brow ridge
    result += fillRect(cx - 16, 19, 32, 4, skin.shadow);
    result += fillRect(cx - 15, 18, 30, 3, skin.base);
    // Higher cheekbones
    result += drawCheekbones(cx, 30, skin, 'female', 'normal');
  } else {
    // Other: Balanced proportions
    result += pixelEllipse(cx, 31, 18, 17, skin.outline);
    result += pixelEllipse(cx, 30, 17, 16, skin.shadow);
    result += pixelEllipse(cx, 29, 16, 15, skin.base);
    result += pixelEllipse(cx, 28, 14, 13, skin.highlight);
    result += pixelEllipse(cx, 26, 8, 8, skin.bright);
    result += fillRect(cx - 17, 19, 34, 5, skin.shadow);
    result += fillRect(cx - 16, 18, 32, 4, skin.base);
    result += fillRect(cx - 15, 17, 30, 2, skin.highlight);
  }

  // Small ears
  result += fillRect(cx - 18, 25, 4, 6, skin.base);
  result += fillRect(cx - 17, 26, 2, 4, skin.highlight);
  result += fillRect(cx + 14, 25, 4, 6, skin.base);
  result += fillRect(cx + 15, 26, 2, 4, skin.shadow);

  // Gender-aware fierce eyes
  result += drawGenderedEyes(cx - 5, 25, 10, eyes, 'fierce', gender);

  // Thick brow ridges
  const browHeight = gender === 'male' ? 3 : 2;
  result += fillRect(cx - 10, 22, 6, browHeight, skin.shadow);
  result += fillRect(cx + 4, 22, 6, browHeight, skin.shadow);

  // Broad flat nose
  result += drawNose(cx, 25, skin, 'large');
  result += fillRect(cx - 3, 31, 6, 3, skin.shadow);

  // Wide mouth with tusks - size varies by gender
  result += fillRect(cx - 7, 37, 14, 3, '#3a2020');
  if (gender === 'male') {
    // LARGE PROMINENT TUSKS for male
    result += drawTusks(cx, 35, 'large');
  } else if (gender === 'female') {
    // SMALLER CURVED TUSKS for female
    result += drawTusks(cx, 36, 'curved');
  } else {
    // Normal tusks for other
    result += drawTusks(cx, 35, 'normal');
  }

  // WAR PAINT - DIFFERENT PATTERN PER GENDER
  if (gender === 'male') {
    // Tribal zigzag pattern in red
    result += drawWarPaint(cx, 26, 'tribal', '#802020');
  } else if (gender === 'female') {
    // Woad pattern with forehead dot
    result += drawWarPaint(cx, 26, 'woad', '#204080');
    // Extra forehead dot
    result += fillRect(cx - 1, 18, 2, 2, '#204080');
    result += pixel(cx, 18, '#3060a0');
  } else {
    // Stripes pattern
    result += drawWarPaint(cx, 26, 'stripes', '#802020');
  }

  // Hair styles using NEW DARK OLIVE PALETTE for contrast
  if (gender === 'male') {
    // Mohawk or topknot
    result += drawTexturedHair(cx - 4, 2, 8, 16, hair, 'spiky');
    // Shaved sides show scalp
    result += fillRect(cx - 14, 12, 10, 8, skin.shadow);
    result += fillRect(cx + 4, 12, 10, 8, skin.shadow);
  } else if (gender === 'female') {
    // Braided warrior style
    result += drawTexturedHair(cx - 13, 6, 26, 14, hair, 'straight');
    result += drawTexturedHair(cx - 15, 14, 7, 40, hair, 'straight');
    result += drawTexturedHair(cx + 8, 14, 7, 40, hair, 'straight');
    // War braids with BONE BEAD DECORATIONS
    result += fillRect(cx - 14, 28, 3, 3, '#f0e8d0');
    result += fillRect(cx + 11, 28, 3, 3, '#f0e8d0');
    result += fillRect(cx - 14, 36, 3, 3, '#f0e8d0');
    result += fillRect(cx + 11, 36, 3, 3, '#f0e8d0');
    // Bone shine
    result += pixel(cx - 13, 29, '#ffffff');
    result += pixel(cx + 12, 29, '#ffffff');
  } else {
    // Side-shaved with longer top
    result += drawTexturedHair(cx - 9, 4, 18, 16, hair, 'spiky');
    result += fillRect(cx - 15, 14, 6, 8, skin.shadow);
    result += fillRect(cx + 9, 14, 6, 8, skin.shadow);
  }

  return result;
}

// ============================================================================
// EXPORTS AND UTILITIES
// ============================================================================

/**
 * Get the appropriate race generator
 * @param {string} race - Race name
 * @returns {function} Generator function
 */
function getRaceGenerator(race) {
  const generators = {
    human: generateHumanBase,
    elf: generateElfBase,
    dwarf: generateDwarfBase,
    vampire: generateVampireBase,
    orc: generateOrcBase
  };
  return generators[race] || generators.human;
}

/**
 * Get default hair color for race
 * @param {string} race - Race name
 * @returns {object} Hair palette
 */
function getDefaultHairColor(race) {
  const defaults = {
    human: HAIR_PALETTES.brown,
    elf: HAIR_PALETTES.blonde,
    dwarf: HAIR_PALETTES.red,
    vampire: HAIR_PALETTES.black,
    orc: HAIR_PALETTES.orcHair
  };
  return defaults[race] || HAIR_PALETTES.brown;
}

/**
 * Get default eye color for race
 * @param {string} race - Race name
 * @returns {object} Eye color palette
 */
function getDefaultEyeColor(race) {
  const defaults = {
    human: EYE_COLORS.brown,
    elf: EYE_COLORS.green,
    dwarf: EYE_COLORS.amber,
    vampire: EYE_COLORS.red,
    orc: EYE_COLORS.yellow
  };
  return defaults[race] || EYE_COLORS.brown;
}

module.exports = {
  generateHumanBase,
  generateElfBase,
  generateDwarfBase,
  generateVampireBase,
  generateOrcBase,
  getRaceGenerator,
  getDefaultHairColor,
  getDefaultEyeColor
};
