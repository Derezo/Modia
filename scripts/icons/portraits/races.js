/**
 * Race Portrait Templates
 * Base face/head generators for each race and gender combination
 */

const {
  SKIN_PALETTES,
  HAIR_PALETTES,
  EYE_COLORS,
  fillRect,
  pixel,
  pixelEllipse,
  drawEyes,
  drawNose,
  drawMouth,
  drawPointedEars,
  drawRoundEars,
  drawTusks,
  drawVampireFangs,
  drawNeck
} = require('./utils');

/**
 * Generate Human base portrait
 * Rounded face, neutral proportions
 */
function generateHumanBase(gender) {
  const skin = SKIN_PALETTES.human;
  const hair = HAIR_PALETTES.brown;
  const eyes = EYE_COLORS.brown;

  let result = '';
  const cx = 32;

  // Neck
  result += drawNeck(cx, 48, 16, skin);

  // Face shape - oval
  result += pixelEllipse(cx, 32, 14, 18, skin.outline);
  result += pixelEllipse(cx, 32, 13, 17, skin.shadow);
  result += pixelEllipse(cx, 31, 12, 16, skin.base);
  result += pixelEllipse(cx, 30, 10, 14, skin.highlight);

  // Ears
  result += drawRoundEars(cx - 12, cx + 12, 30, skin);

  // Eyes
  result += drawEyes(cx - 5, 28, 10, eyes, skin);

  // Eyebrows
  const browThickness = gender === 'male' ? 2 : 1;
  result += fillRect(cx - 8, 24, 5, browThickness, hair.dark);
  result += fillRect(cx + 3, 24, 5, browThickness, hair.dark);

  // Nose
  result += drawNose(cx, 30, skin, 'medium');

  // Mouth
  result += drawMouth(cx, 40, skin, 'neutral');

  // Hair base (will be covered by class equipment in most cases)
  if (gender === 'male') {
    // Short hair
    result += fillRect(cx - 12, 12, 24, 6, hair.dark);
    result += fillRect(cx - 13, 14, 26, 4, hair.base);
    result += fillRect(cx - 11, 10, 22, 4, hair.dark);
  } else if (gender === 'female') {
    // Long hair framing face
    result += fillRect(cx - 14, 10, 28, 8, hair.dark);
    result += fillRect(cx - 15, 14, 6, 36, hair.base);
    result += fillRect(cx + 9, 14, 6, 36, hair.base);
    result += fillRect(cx - 14, 14, 4, 34, hair.dark);
    result += fillRect(cx + 10, 14, 4, 34, hair.dark);
    result += fillRect(cx - 12, 10, 24, 6, hair.highlight);
  } else {
    // Medium length hair
    result += fillRect(cx - 13, 10, 26, 8, hair.dark);
    result += fillRect(cx - 14, 14, 4, 20, hair.base);
    result += fillRect(cx + 10, 14, 4, 20, hair.base);
    result += fillRect(cx - 12, 10, 24, 5, hair.highlight);
  }

  return result;
}

/**
 * Generate Elf base portrait
 * Narrow face, pointed ears, angular features
 */
function generateElfBase(gender) {
  const skin = SKIN_PALETTES.elf;
  const hair = HAIR_PALETTES.blonde;
  const eyes = EYE_COLORS.green;

  let result = '';
  const cx = 32;

  // Neck (slender)
  result += fillRect(cx - 3, 48, 6, 16, skin.base);
  result += fillRect(cx - 2, 48, 2, 16, skin.highlight);

  // Face shape - narrow, angular
  result += pixelEllipse(cx, 32, 11, 19, skin.outline);
  result += pixelEllipse(cx, 32, 10, 18, skin.shadow);
  result += pixelEllipse(cx, 31, 9, 17, skin.base);
  result += pixelEllipse(cx, 30, 7, 15, skin.highlight);

  // Pointed ears
  result += drawPointedEars(cx - 9, cx + 9, 28, skin);

  // Eyes (slightly larger, almond-shaped)
  result += drawEyes(cx - 5, 27, 10, eyes, skin);

  // Thin elegant eyebrows
  result += fillRect(cx - 8, 23, 6, 1, hair.dark);
  result += fillRect(cx + 2, 23, 6, 1, hair.dark);

  // Nose (small, delicate)
  result += drawNose(cx, 29, skin, 'small');

  // Mouth
  result += drawMouth(cx, 39, skin, 'neutral');

  // Hair
  if (gender === 'male') {
    // Long straight hair, elven style
    result += fillRect(cx - 12, 8, 24, 10, hair.dark);
    result += fillRect(cx - 13, 12, 5, 40, hair.base);
    result += fillRect(cx + 8, 12, 5, 40, hair.base);
    result += fillRect(cx - 11, 8, 22, 6, hair.highlight);
  } else if (gender === 'female') {
    // Very long flowing hair
    result += fillRect(cx - 14, 6, 28, 12, hair.dark);
    result += fillRect(cx - 16, 12, 8, 52, hair.base);
    result += fillRect(cx + 8, 12, 8, 52, hair.base);
    result += fillRect(cx - 15, 12, 5, 50, hair.dark);
    result += fillRect(cx + 10, 12, 5, 50, hair.dark);
    result += fillRect(cx - 12, 6, 24, 8, hair.highlight);
  } else {
    // Elegant medium-length
    result += fillRect(cx - 13, 8, 26, 10, hair.dark);
    result += fillRect(cx - 14, 12, 6, 30, hair.base);
    result += fillRect(cx + 8, 12, 6, 30, hair.base);
    result += fillRect(cx - 12, 8, 24, 6, hair.highlight);
  }

  return result;
}

/**
 * Generate Dwarf base portrait
 * Wide face, prominent brow, thick beard
 */
function generateDwarfBase(gender) {
  const skin = SKIN_PALETTES.dwarf;
  const hair = HAIR_PALETTES.red;
  const eyes = EYE_COLORS.amber;

  let result = '';
  const cx = 32;

  // Neck (thick)
  result += fillRect(cx - 6, 46, 12, 18, skin.base);
  result += fillRect(cx - 5, 46, 4, 18, skin.highlight);

  // Face shape - wide, blocky
  result += pixelEllipse(cx, 30, 16, 16, skin.outline);
  result += pixelEllipse(cx, 30, 15, 15, skin.shadow);
  result += pixelEllipse(cx, 29, 14, 14, skin.base);
  result += pixelEllipse(cx, 28, 12, 12, skin.highlight);

  // Heavy brow ridge
  result += fillRect(cx - 14, 22, 28, 3, skin.shadow);
  result += fillRect(cx - 13, 21, 26, 2, skin.base);

  // Round ears
  result += drawRoundEars(cx - 14, cx + 14, 28, skin);

  // Eyes (deep-set under brow)
  result += drawEyes(cx - 5, 27, 10, eyes, skin);

  // Bushy eyebrows
  result += fillRect(cx - 10, 23, 7, 3, hair.dark);
  result += fillRect(cx + 3, 23, 7, 3, hair.dark);

  // Nose (large, bulbous)
  result += drawNose(cx, 28, skin, 'large');

  // Mouth (hidden by beard for males)
  if (gender === 'female' || gender === 'other') {
    result += drawMouth(cx, 40, skin, 'neutral');
  }

  // Hair and beard
  if (gender === 'male') {
    // Helmet-like hair and massive beard
    result += fillRect(cx - 14, 10, 28, 12, hair.dark);
    result += fillRect(cx - 15, 14, 4, 16, hair.base);
    result += fillRect(cx + 11, 14, 4, 16, hair.base);
    result += fillRect(cx - 13, 10, 26, 8, hair.highlight);

    // Big bushy beard
    result += fillRect(cx - 12, 36, 24, 28, hair.dark);
    result += fillRect(cx - 10, 38, 20, 26, hair.base);
    result += fillRect(cx - 8, 40, 16, 22, hair.highlight);
    // Beard detail
    result += fillRect(cx - 2, 50, 4, 14, hair.dark);
  } else if (gender === 'female') {
    // Braided hair, smaller chin beard/stubble
    result += fillRect(cx - 14, 8, 28, 14, hair.dark);
    result += fillRect(cx - 16, 14, 8, 36, hair.base);  // Braids
    result += fillRect(cx + 8, 14, 8, 36, hair.base);
    result += fillRect(cx - 13, 8, 26, 10, hair.highlight);

    // Small decorative beard braids
    result += fillRect(cx - 4, 44, 3, 10, hair.base);
    result += fillRect(cx + 1, 44, 3, 10, hair.base);
  } else {
    // Medium hair and modest beard
    result += fillRect(cx - 14, 10, 28, 12, hair.dark);
    result += fillRect(cx - 15, 14, 5, 24, hair.base);
    result += fillRect(cx + 10, 14, 5, 24, hair.base);
    result += fillRect(cx - 13, 10, 26, 8, hair.highlight);

    // Moderate beard
    result += fillRect(cx - 10, 38, 20, 20, hair.dark);
    result += fillRect(cx - 8, 40, 16, 16, hair.base);
  }

  return result;
}

/**
 * Generate Vampire base portrait
 * Pale skin, sharp features, fangs
 */
function generateVampireBase(gender) {
  const skin = SKIN_PALETTES.vampire;
  const hair = HAIR_PALETTES.black;
  const eyes = EYE_COLORS.red;

  let result = '';
  const cx = 32;

  // Neck (elegant)
  result += drawNeck(cx, 46, 18, skin);

  // Face shape - angular, aristocratic
  result += pixelEllipse(cx, 32, 12, 18, skin.outline);
  result += pixelEllipse(cx, 32, 11, 17, skin.shadow);
  result += pixelEllipse(cx, 31, 10, 16, skin.base);
  result += pixelEllipse(cx, 30, 8, 14, skin.highlight);

  // Sharp cheekbones
  result += fillRect(cx - 12, 32, 4, 2, skin.shadow);
  result += fillRect(cx + 8, 32, 4, 2, skin.shadow);

  // Slightly pointed ears
  result += fillRect(cx - 14, 26, 3, 6, skin.base);
  result += fillRect(cx - 15, 24, 2, 4, skin.base);
  result += fillRect(cx + 11, 26, 3, 6, skin.base);
  result += fillRect(cx + 13, 24, 2, 4, skin.base);

  // Eyes (intense red)
  result += drawEyes(cx - 5, 27, 10, eyes, skin);

  // Sharp arched eyebrows
  result += fillRect(cx - 9, 23, 6, 1, hair.dark);
  result += pixel(cx - 10, 24, hair.dark);
  result += fillRect(cx + 3, 23, 6, 1, hair.dark);
  result += pixel(cx + 9, 24, hair.dark);

  // Nose (sharp, aquiline)
  result += drawNose(cx, 29, skin, 'small');

  // Mouth with fangs
  result += drawMouth(cx, 39, skin, 'neutral');
  result += drawVampireFangs(cx, 40);

  // Hair
  if (gender === 'male') {
    // Slicked back aristocratic
    result += fillRect(cx - 13, 10, 26, 10, hair.dark);
    result += fillRect(cx - 12, 8, 24, 8, hair.base);
    result += fillRect(cx - 10, 8, 20, 4, hair.highlight);
    // Widow's peak
    result += fillRect(cx - 2, 10, 4, 4, hair.dark);
  } else if (gender === 'female') {
    // Long dramatic hair
    result += fillRect(cx - 15, 6, 30, 14, hair.dark);
    result += fillRect(cx - 17, 14, 8, 50, hair.base);
    result += fillRect(cx + 9, 14, 8, 50, hair.base);
    result += fillRect(cx - 16, 14, 5, 48, hair.dark);
    result += fillRect(cx + 11, 14, 5, 48, hair.dark);
    result += fillRect(cx - 13, 6, 26, 8, hair.highlight);
  } else {
    // Elegant shoulder-length
    result += fillRect(cx - 14, 8, 28, 12, hair.dark);
    result += fillRect(cx - 15, 14, 6, 30, hair.base);
    result += fillRect(cx + 9, 14, 6, 30, hair.base);
    result += fillRect(cx - 13, 8, 26, 8, hair.highlight);
  }

  return result;
}

/**
 * Generate Orc base portrait
 * Broad face, tusks, heavy brow, green skin
 */
function generateOrcBase(gender) {
  const skin = SKIN_PALETTES.orc;
  const hair = HAIR_PALETTES.green;
  const eyes = EYE_COLORS.yellow;

  let result = '';
  const cx = 32;

  // Neck (very thick, muscular)
  result += fillRect(cx - 8, 44, 16, 20, skin.base);
  result += fillRect(cx - 7, 44, 6, 20, skin.highlight);
  result += fillRect(cx + 3, 44, 5, 20, skin.shadow);

  // Face shape - broad, brutish
  result += pixelEllipse(cx, 30, 17, 16, skin.outline);
  result += pixelEllipse(cx, 30, 16, 15, skin.shadow);
  result += pixelEllipse(cx, 29, 15, 14, skin.base);
  result += pixelEllipse(cx, 28, 13, 12, skin.highlight);

  // Heavy brow ridge
  result += fillRect(cx - 16, 20, 32, 4, skin.shadow);
  result += fillRect(cx - 15, 19, 30, 3, skin.base);

  // Small ears
  result += fillRect(cx - 17, 26, 3, 5, skin.base);
  result += fillRect(cx + 14, 26, 3, 5, skin.base);

  // Small deep-set eyes under brow
  result += fillRect(cx - 7, 25, 4, 3, '#f0f0e8');
  result += fillRect(cx + 3, 25, 4, 3, '#f0f0e8');
  result += fillRect(cx - 6, 25, 2, 2, eyes.iris);
  result += fillRect(cx + 4, 25, 2, 2, eyes.iris);
  result += pixel(cx - 5, 25, '#ffffff');
  result += pixel(cx + 5, 25, '#ffffff');

  // Broad flat nose
  result += drawNose(cx, 26, skin, 'large');

  // Wide mouth
  result += fillRect(cx - 6, 38, 12, 2, '#3a2020');

  // Tusks
  result += drawTusks(cx, 36);

  // Hair (or bald/mohawk)
  if (gender === 'male') {
    // Mohawk or topknot
    result += fillRect(cx - 3, 6, 6, 14, hair.dark);
    result += fillRect(cx - 2, 4, 4, 12, hair.base);
    result += fillRect(cx - 1, 4, 2, 8, hair.highlight);
  } else if (gender === 'female') {
    // Braided warrior style
    result += fillRect(cx - 12, 8, 24, 10, hair.dark);
    result += fillRect(cx - 14, 12, 6, 34, hair.base);
    result += fillRect(cx + 8, 12, 6, 34, hair.base);
    result += fillRect(cx - 11, 8, 22, 6, hair.highlight);
    // War braids
    result += fillRect(cx - 13, 12, 3, 30, hair.dark);
    result += fillRect(cx + 10, 12, 3, 30, hair.dark);
  } else {
    // Side-shaved style
    result += fillRect(cx - 8, 6, 16, 14, hair.dark);
    result += fillRect(cx - 6, 4, 12, 10, hair.base);
    result += fillRect(cx - 4, 4, 8, 6, hair.highlight);
  }

  return result;
}

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
    orc: HAIR_PALETTES.green
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
