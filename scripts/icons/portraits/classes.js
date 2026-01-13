/**
 * Class Equipment Overlays (Enhanced)
 * Equipment and accessories for each character class
 * Uses composite helpers, textures, and special effects
 */

const {
  EQUIPMENT_PALETTES,
  fillRect,
  pixel,
  pixelEllipse,
  pixelCircle,
  clothTexture,
  furTexture,
  drawHelmet,
  drawHorns,
  drawShoulderArmor,
  drawMagicAura,
  drawWarPaint,
  drawScar,
  // New imports for class identity
  drawSymbol,
  drawEyeGlow
} = require('./utils');

// ============================================================================
// WARRIOR - Steel armor, disciplined soldier
// ============================================================================

/**
 * Warrior equipment (Enhanced v2) - Insignia, battle scratches, rank stripes
 */
function getWarriorEquipment() {
  const steel = EQUIPMENT_PALETTES.steel;
  const gold = EQUIPMENT_PALETTES.gold;
  let result = '';
  const cx = 32;

  // Use composite helmet helper
  result += drawHelmet(cx, 2, 'guard', steel);

  // GOLD CROSS INSIGNIA on helmet forehead
  result += drawSymbol(cx, 8, 'cross', gold.base, gold.bright);

  // Additional helmet details
  // Nose guard with rivets
  result += fillRect(cx - 2, 24, 4, 12, steel.outline);
  result += fillRect(cx - 1, 25, 2, 10, steel.base);
  result += pixel(cx - 1, 26, steel.bright);
  result += pixel(cx - 1, 30, steel.bright);

  // BATTLE SCRATCHES on helmet
  result += drawScar(cx - 8, 12, 'diagonal', 5);
  result += drawScar(cx + 6, 14, 'horizontal', 4);

  // Helmet edge detail
  result += fillRect(cx - 14, 36, 2, 4, steel.dark);
  result += fillRect(cx + 12, 36, 2, 4, steel.dark);

  // Shoulder armor with plate texture
  result += drawShoulderArmor(cx, 50, 'plate', steel);

  // GOLD RANK STRIPES on shoulders
  result += fillRect(cx - 22, 53, 6, 2, gold.base);
  result += fillRect(cx - 21, 53, 4, 1, gold.highlight);
  result += fillRect(cx - 22, 56, 4, 2, gold.base);
  result += fillRect(cx - 21, 56, 3, 1, gold.highlight);
  // Right shoulder stripes
  result += fillRect(cx + 16, 53, 6, 2, gold.base);
  result += fillRect(cx + 17, 53, 4, 1, gold.highlight);
  result += fillRect(cx + 18, 56, 4, 2, gold.base);
  result += fillRect(cx + 18, 56, 3, 1, gold.highlight);

  // Chainmail collar hint
  result += fillRect(cx - 8, 48, 16, 4, steel.dark);
  result += fillRect(cx - 7, 49, 14, 2, steel.base);
  // Chainmail pattern
  for (let px = -6; px < 8; px += 2) {
    result += pixel(cx + px, 49, steel.highlight);
    result += pixel(cx + px + 1, 50, steel.shadow);
  }

  return result;
}

// ============================================================================
// WIZARD - Arcane scholar, elemental master
// ============================================================================

/**
 * Wizard equipment (Enhanced v2) - Crystal in hat tip, runes on band, enhanced star
 */
function getWizardEquipment() {
  const cloth = EQUIPMENT_PALETTES.cloth;
  const magic = EQUIPMENT_PALETTES.magic;
  let result = '';
  const cx = 32;

  // Wide brim with cloth texture
  result += clothTexture(cx - 18, 16, 36, 4, cloth);
  result += fillRect(cx - 17, 16, 34, 1, cloth.outline);
  result += fillRect(cx - 17, 19, 34, 1, cloth.outline);

  // ARCANE RUNES on hat band (4 glowing pixels)
  result += pixel(cx - 10, 17, magic.highlight);
  result += pixel(cx - 5, 17, magic.bright);
  result += pixel(cx + 4, 17, magic.highlight);
  result += pixel(cx + 9, 17, magic.bright);

  // Pointed cone with texture
  result += clothTexture(cx - 10, 4, 20, 4, cloth);
  result += clothTexture(cx - 12, 8, 24, 4, cloth);
  result += clothTexture(cx - 14, 12, 28, 5, cloth);

  // Hat outline
  result += fillRect(cx - 10, 3, 20, 1, cloth.outline);
  result += fillRect(cx - 12, 7, 24, 1, cloth.outline);
  result += fillRect(cx - 14, 11, 28, 1, cloth.outline);

  // Hat tip with CRYSTAL EMBEDDED (blue with shine)
  result += fillRect(cx - 4, 0, 8, 5, cloth.dark);
  result += fillRect(cx - 3, 0, 6, 4, cloth.base);
  // Crystal in tip
  result += fillRect(cx - 2, 0, 4, 4, '#4060a0');
  result += fillRect(cx - 1, 0, 2, 3, '#5080d0');
  result += pixel(cx, 0, '#80b0f0');
  result += pixel(cx - 1, 1, '#ffffff');

  // ENHANCED STAR decoration (3x5 crystal shape with sparkles)
  result += fillRect(cx + 4, 8, 5, 5, magic.dark);
  result += fillRect(cx + 5, 9, 3, 3, magic.base);
  result += pixel(cx + 6, 10, magic.bright);
  // Star points
  result += pixel(cx + 6, 7, magic.highlight);
  result += pixel(cx + 3, 10, magic.highlight);
  result += pixel(cx + 9, 10, magic.highlight);
  result += pixel(cx + 6, 13, magic.highlight);
  // Sparkles around star
  result += pixel(cx + 8, 8, '#ffffff');
  result += pixel(cx + 4, 12, '#ffffff');

  // Crescent moon
  result += pixelEllipse(cx - 6, 11, 2, 2, magic.highlight);
  result += pixelEllipse(cx - 5, 11, 1, 1, cloth.dark);

  // Magical aura around hat - UPGRADED to 'medium'
  const auraPalette = { dark: magic.dark, mid: magic.base, light: magic.highlight, bright: magic.bright };
  result += drawMagicAura(cx, 8, auraPalette, 'medium');

  // Robe collar with cloth texture
  result += clothTexture(cx - 10, 50, 20, 14, cloth);
  result += fillRect(cx - 10, 50, 20, 1, cloth.outline);
  // V-neck opening
  result += fillRect(cx - 2, 52, 4, 12, cloth.shadow);

  // Magical glow at edges
  result += pixel(cx - 18, 18, magic.base);
  result += pixel(cx + 17, 18, magic.base);

  return result;
}

// ============================================================================
// MONK - Disciplined martial artist
// ============================================================================

/**
 * Monk equipment (Enhanced v2) - Chi glow aura, center emblem, hand wraps
 */
function getMonkEquipment() {
  const leather = EQUIPMENT_PALETTES.leather;
  const cloth = EQUIPMENT_PALETTES.cloth;
  let result = '';
  const cx = 32;

  // CHI/FOCUS GLOW AURA (blue) around head
  const chiPalette = { dark: '#203050', mid: '#4060a0', light: '#6090d0', bright: '#90c0f0' };
  result += drawMagicAura(cx, 12, chiPalette, 'subtle');

  // Headband with woven texture
  result += clothTexture(cx - 14, 16, 28, 4, leather);
  result += fillRect(cx - 14, 15, 28, 1, leather.outline);
  result += fillRect(cx - 14, 20, 28, 1, leather.outline);

  // CENTER EMBLEM - Circular focus symbol with glow
  result += drawSymbol(cx, 17, 'circle', '#4060a0', '#90c0f0');

  // Headband knot on side
  result += fillRect(cx + 12, 14, 5, 8, leather.outline);
  result += fillRect(cx + 13, 15, 3, 6, leather.dark);
  result += fillRect(cx + 14, 16, 1, 4, leather.base);

  // LONGER TRAILING BANDS (3 pieces for movement)
  // First band
  result += fillRect(cx + 14, 20, 4, 18, leather.dark);
  result += fillRect(cx + 15, 21, 2, 16, leather.base);
  result += fillRect(cx + 16, 22, 1, 14, leather.highlight);
  // Second band
  result += fillRect(cx + 16, 22, 3, 16, leather.dark);
  result += fillRect(cx + 17, 23, 2, 14, leather.base);
  // Third band (further back, longer)
  result += fillRect(cx + 18, 24, 3, 18, leather.outline);
  result += fillRect(cx + 19, 25, 2, 16, leather.dark);

  // Simple robe with cloth texture
  result += clothTexture(cx - 10, 48, 20, 16, cloth);

  // Belt knot detail
  result += fillRect(cx - 8, 56, 16, 2, leather.dark);
  result += fillRect(cx - 7, 56, 14, 1, leather.base);
  // Knot bulge
  result += fillRect(cx - 3, 54, 6, 4, leather.dark);
  result += fillRect(cx - 2, 55, 4, 2, leather.base);

  // Neck/collar shadow depth
  result += fillRect(cx - 3, 48, 6, 8, '#2a2018');  // Dark shadow
  result += fillRect(cx - 2, 48, 4, 6, '#3a3028');  // Lighter shadow

  // VISIBLE WRAPPED HANDS (bandage detail at shoulders)
  // Left shoulder - wrapped hand hint
  result += fillRect(cx - 14, 52, 4, 6, '#f0e8d8');
  result += fillRect(cx - 13, 53, 2, 4, '#e8e0d0');
  result += pixel(cx - 12, 54, leather.dark);  // Wrap line
  result += pixel(cx - 12, 56, leather.dark);
  // Right shoulder
  result += fillRect(cx + 10, 52, 4, 6, '#f0e8d8');
  result += fillRect(cx + 11, 53, 2, 4, '#e8e0d0');
  result += pixel(cx + 12, 54, leather.dark);
  result += pixel(cx + 12, 56, leather.dark);

  return result;
}

// ============================================================================
// CHEMIST - Alchemical experimenter
// ============================================================================

/**
 * Chemist equipment - Goggles and protective gear
 */
function getChemistEquipment() {
  const leather = EQUIPMENT_PALETTES.leather;
  const steel = EQUIPMENT_PALETTES.steel;
  let result = '';
  const cx = 32;

  // Goggles strap with texture
  result += clothTexture(cx - 16, 22, 32, 3, leather);

  // Goggle frames - octagonal lenses
  result += fillRect(cx - 11, 19, 9, 10, steel.outline);
  result += fillRect(cx + 2, 19, 9, 10, steel.outline);
  result += fillRect(cx - 10, 20, 7, 8, steel.dark);
  result += fillRect(cx + 3, 20, 7, 8, steel.dark);

  // Goggle lenses with reflection
  result += fillRect(cx - 9, 21, 5, 6, '#1a3050');
  result += fillRect(cx + 4, 21, 5, 6, '#1a3050');
  result += fillRect(cx - 8, 22, 3, 4, '#3060a0');
  result += fillRect(cx + 5, 22, 3, 4, '#3060a0');
  // Double lens shine
  result += pixel(cx - 8, 22, '#80b0e0');
  result += pixel(cx - 7, 23, '#60a0d0');
  result += pixel(cx + 5, 22, '#80b0e0');
  result += pixel(cx + 6, 23, '#60a0d0');

  // Frame bolts
  result += pixel(cx - 10, 20, steel.highlight);
  result += pixel(cx - 10, 28, steel.highlight);
  result += pixel(cx + 9, 20, steel.highlight);
  result += pixel(cx + 9, 28, steel.highlight);

  // Bandana/head covering with texture
  result += clothTexture(cx - 14, 10, 28, 10, leather);
  result += fillRect(cx - 14, 9, 28, 1, leather.outline);

  // Stain marks on bandana
  result += pixel(cx - 8, 13, '#206040');
  result += pixel(cx + 6, 15, '#602040');

  // Work apron
  result += clothTexture(cx - 10, 48, 20, 16, leather);

  // Tool belt with pouches
  result += fillRect(cx - 12, 56, 24, 4, leather.outline);
  result += fillRect(cx - 11, 57, 22, 2, leather.dark);

  // Belt pouches
  result += fillRect(cx - 14, 54, 5, 8, leather.dark);
  result += fillRect(cx - 13, 55, 3, 6, leather.base);
  result += pixel(cx - 12, 56, steel.highlight);  // Buckle

  result += fillRect(cx + 9, 54, 5, 8, leather.dark);
  result += fillRect(cx + 10, 55, 3, 6, leather.base);
  result += pixel(cx + 11, 56, steel.highlight);

  return result;
}

// ============================================================================
// BERSERKER - Rage-fueled warrior
// ============================================================================

/**
 * Berserker equipment (Enhanced v2) - Rage eye glow, tooth trophies, enhanced war paint
 */
function getBerserkerEquipment() {
  const steel = EQUIPMENT_PALETTES.steel;
  const leather = EQUIPMENT_PALETTES.leather;
  let result = '';
  const cx = 32;

  // Crude helmet base
  result += fillRect(cx - 14, 10, 28, 14, steel.outline);
  result += fillRect(cx - 13, 11, 26, 12, steel.dark);
  result += fillRect(cx - 12, 12, 24, 10, steel.base);
  result += fillRect(cx - 10, 12, 10, 6, steel.highlight);

  // Battle damage on helmet
  result += drawScar(cx + 4, 14, 'diagonal', 6);
  result += drawScar(cx - 6, 16, 'horizontal', 4);

  // Large curved horns using composite helper
  const hornPalette = { dark: '#c8c0a8', mid: '#e0d8c0', light: '#f0e8d8' };
  result += drawHorns(cx, 10, 'curved', hornPalette);

  // RAGE EYE GLOW EFFECT (red particles around eyes)
  const rageGlow = { dark: '#400000', mid: '#800000', light: '#c02020', bright: '#ff4040' };
  result += drawEyeGlow(cx, 28, rageGlow, 'intense');

  // War paint on face - ENHANCED with more stripes
  result += drawWarPaint(cx, 28, 'stripes', '#a02020');
  // Additional under-eye war paint stripes
  result += fillRect(cx - 9, 32, 3, 1, '#a02020');
  result += fillRect(cx + 6, 32, 3, 1, '#a02020');
  result += fillRect(cx - 8, 34, 2, 1, '#a02020');
  result += fillRect(cx + 6, 34, 2, 1, '#a02020');

  // Battle scar across face
  result += drawScar(cx - 4, 32, 'diagonal', 8);

  // Fur collar with texture
  const furPalette = { outline: leather.outline, shadow: leather.dark, base: leather.base, highlight: leather.highlight, bright: leather.bright };
  result += furTexture(cx - 16, 46, 32, 12, furPalette);

  // Fur detail - irregular edge
  result += fillRect(cx - 18, 48, 4, 6, leather.dark);
  result += fillRect(cx + 14, 48, 4, 6, leather.dark);
  result += fillRect(cx - 17, 50, 2, 4, leather.base);
  result += fillRect(cx + 15, 50, 2, 4, leather.base);

  // ENHANCED BONE NECKLACE with FANG/TOOTH TROPHIES
  // Center large fang
  result += fillRect(cx - 2, 54, 4, 7, '#f0e8d8');
  result += fillRect(cx - 1, 55, 2, 5, '#ffffff');
  result += pixel(cx, 60, '#e0d8c8');  // Fang tip
  // Left fangs
  result += fillRect(cx - 7, 55, 3, 5, '#f0e8d8');
  result += fillRect(cx - 6, 56, 1, 3, '#ffffff');
  result += fillRect(cx - 11, 56, 2, 4, '#f0e8d8');
  result += pixel(cx - 10, 56, '#ffffff');
  // Right fangs
  result += fillRect(cx + 4, 55, 3, 5, '#f0e8d8');
  result += fillRect(cx + 5, 56, 1, 3, '#ffffff');
  result += fillRect(cx + 9, 56, 2, 4, '#f0e8d8');
  result += pixel(cx + 10, 56, '#ffffff');
  // Necklace cord
  result += fillRect(cx - 12, 54, 24, 1, leather.dark);

  return result;
}

// ============================================================================
// SORCERER - Dark magic wielder
// ============================================================================

/**
 * Sorcerer equipment (Enhanced v2) - darkMagic palette, shadow aura, dark energy tendrils
 */
function getSorcererEquipment() {
  const gold = EQUIPMENT_PALETTES.gold;
  // USE NEW DARK MAGIC PALETTE
  const darkMagic = EQUIPMENT_PALETTES.darkMagic;
  let result = '';
  const cx = 32;

  // SHADOW AURA PARTICLES around portrait edges
  result += pixel(0, 10, darkMagic.dark);
  result += pixel(2, 20, darkMagic.base);
  result += pixel(1, 32, darkMagic.dark);
  result += pixel(3, 45, darkMagic.base);
  result += pixel(63, 12, darkMagic.dark);
  result += pixel(61, 25, darkMagic.base);
  result += pixel(62, 38, darkMagic.dark);
  result += pixel(60, 50, darkMagic.base);

  // Ornate circlet base
  result += fillRect(cx - 15, 13, 30, 5, gold.outline);
  result += fillRect(cx - 14, 14, 28, 3, gold.dark);
  result += fillRect(cx - 13, 14, 26, 2, gold.base);
  result += fillRect(cx - 12, 14, 10, 1, gold.highlight);

  // Filigree details on circlet
  result += pixel(cx - 10, 15, gold.bright);
  result += pixel(cx + 9, 15, gold.bright);
  result += pixel(cx - 7, 14, gold.highlight);
  result += pixel(cx + 6, 14, gold.highlight);

  // Center gem with DARK MAGIC glow
  result += fillRect(cx - 4, 10, 8, 8, darkMagic.outline);
  result += fillRect(cx - 3, 11, 6, 6, darkMagic.dark);
  result += fillRect(cx - 2, 12, 4, 4, darkMagic.base);
  result += fillRect(cx - 1, 13, 2, 2, darkMagic.highlight);
  result += pixel(cx, 12, darkMagic.bright);

  // DARK ENERGY TENDRILS extending from center gem
  // Upward tendril
  result += pixel(cx, 8, darkMagic.dark);
  result += pixel(cx - 1, 6, darkMagic.base);
  result += pixel(cx + 1, 5, darkMagic.highlight);
  // Left tendril
  result += pixel(cx - 6, 12, darkMagic.dark);
  result += pixel(cx - 8, 11, darkMagic.base);
  result += pixel(cx - 10, 10, darkMagic.highlight);
  // Right tendril
  result += pixel(cx + 5, 12, darkMagic.dark);
  result += pixel(cx + 7, 11, darkMagic.base);
  result += pixel(cx + 9, 10, darkMagic.highlight);

  // Gem glow effect
  result += pixel(cx - 5, 11, darkMagic.dark);
  result += pixel(cx + 4, 11, darkMagic.dark);
  result += pixel(cx - 4, 9, darkMagic.base);
  result += pixel(cx + 3, 9, darkMagic.base);

  // Side decorations
  result += fillRect(cx - 11, 12, 4, 4, gold.base);
  result += fillRect(cx - 10, 13, 2, 2, gold.highlight);
  result += fillRect(cx + 7, 12, 4, 4, gold.base);
  result += fillRect(cx + 8, 13, 2, 2, gold.highlight);

  // Strong DARK magical aura
  const auraPalette = { dark: darkMagic.dark, mid: darkMagic.base, light: darkMagic.highlight, bright: darkMagic.bright };
  result += drawMagicAura(cx, 10, auraPalette, 'strong');

  // Elegant robes with DARK MAGIC cloth texture
  result += clothTexture(cx - 14, 46, 28, 18, darkMagic);

  // Gold trim on robes (contrast against dark)
  result += fillRect(cx - 14, 46, 3, 18, gold.dark);
  result += fillRect(cx - 13, 47, 1, 16, gold.base);
  result += fillRect(cx + 11, 46, 3, 18, gold.dark);
  result += fillRect(cx + 12, 47, 1, 16, gold.base);

  // Central robe seam with gold buttons
  result += fillRect(cx - 1, 48, 2, 16, darkMagic.outline);
  result += pixel(cx, 52, gold.highlight);
  result += pixel(cx, 56, gold.highlight);
  result += pixel(cx, 60, gold.highlight);

  return result;
}

// ============================================================================
// NINJA - Shadow assassin
// ============================================================================

/**
 * Ninja equipment (Enhanced v2) - Clan symbol, kunai, shuriken, smoke bomb
 */
function getNinjaEquipment() {
  const darkCloth = EQUIPMENT_PALETTES.darkSteel;
  const steel = EQUIPMENT_PALETTES.steel;
  let result = '';
  const cx = 32;

  // Head wrap with cloth texture
  result += clothTexture(cx - 14, 8, 28, 16, darkCloth);
  result += fillRect(cx - 14, 7, 28, 1, darkCloth.outline);

  // Face mask covering everything below eyes
  result += clothTexture(cx - 13, 30, 26, 20, darkCloth);

  // Mask folds for realism
  result += fillRect(cx - 8, 34, 1, 12, darkCloth.shadow);
  result += fillRect(cx + 7, 34, 1, 12, darkCloth.shadow);
  result += fillRect(cx - 4, 36, 1, 10, darkCloth.highlight);
  result += fillRect(cx + 3, 36, 1, 10, darkCloth.highlight);

  // Eye slit area - darker background for contrast
  result += fillRect(cx - 13, 24, 26, 6, '#0a0a10');
  result += fillRect(cx - 12, 25, 24, 4, darkCloth.outline);

  // Forehead protector (metal plate)
  result += fillRect(cx - 9, 16, 18, 5, darkCloth.outline);
  result += fillRect(cx - 8, 17, 16, 3, '#4a4a50');
  result += fillRect(cx - 7, 17, 14, 2, '#6a6a70');

  // CLAN SYMBOL on forehead protector (spiral pattern)
  result += drawSymbol(cx, 18, 'spiral', '#3a3a40', '#5a5a60');

  // Dark outfit with subtle texture
  result += clothTexture(cx - 12, 48, 24, 16, darkCloth);

  // Collar wrap
  result += fillRect(cx - 10, 48, 20, 4, darkCloth.dark);
  result += fillRect(cx - 8, 49, 16, 2, darkCloth.base);

  // VISIBLE KUNAI HANDLE at right shoulder
  result += fillRect(cx + 12, 50, 3, 10, '#3a3030');  // Handle
  result += fillRect(cx + 13, 51, 1, 8, '#5a4040');   // Handle highlight
  result += fillRect(cx + 12, 49, 3, 2, '#8a8a90');   // Blade guard
  result += pixel(cx + 13, 49, '#b0b0b8');            // Guard shine

  // VISIBLE SHURIKEN at left shoulder
  result += pixel(cx - 14, 52, steel.base);           // Center
  result += pixel(cx - 16, 52, steel.dark);           // Left point
  result += pixel(cx - 12, 52, steel.dark);           // Right point
  result += pixel(cx - 14, 50, steel.dark);           // Top point
  result += pixel(cx - 14, 54, steel.dark);           // Bottom point
  // Diagonal points
  result += pixel(cx - 16, 50, steel.outline);
  result += pixel(cx - 12, 50, steel.outline);
  result += pixel(cx - 16, 54, steel.outline);
  result += pixel(cx - 12, 54, steel.outline);
  // Center shine
  result += pixel(cx - 14, 52, steel.bright);

  // SMOKE BOMB POUCH at belt
  result += fillRect(cx - 6, 56, 5, 6, darkCloth.dark);
  result += fillRect(cx - 5, 57, 3, 4, darkCloth.base);
  // Smoke bomb visible
  result += pixelCircle(cx - 4, 59, 2, '#505050');
  result += pixel(cx - 4, 58, '#707070');

  return result;
}

// ============================================================================
// ALCHEMIST - Master transmuter
// ============================================================================

/**
 * Alchemist equipment - Heavy goggles, protective gear, vials
 */
function getAlchemistEquipment() {
  const leather = EQUIPMENT_PALETTES.leather;
  const steel = EQUIPMENT_PALETTES.steel;
  let result = '';
  const cx = 32;

  // Heavy goggle strap
  result += clothTexture(cx - 16, 18, 32, 4, leather);

  // Large round goggle frames
  result += fillRect(cx - 13, 14, 12, 14, steel.outline);
  result += fillRect(cx + 1, 14, 12, 14, steel.outline);
  result += fillRect(cx - 12, 15, 10, 12, steel.dark);
  result += fillRect(cx + 2, 15, 10, 12, steel.dark);

  // Large goggle lenses (green tinted)
  result += pixelEllipse(cx - 7, 21, 4, 5, '#103020');
  result += pixelEllipse(cx + 7, 21, 4, 5, '#103020');
  result += pixelEllipse(cx - 7, 21, 3, 4, '#206040');
  result += pixelEllipse(cx + 7, 21, 3, 4, '#206040');

  // Lens reflection
  result += fillRect(cx - 10, 17, 3, 3, '#40a060');
  result += pixel(cx - 9, 18, '#60c080');
  result += fillRect(cx + 7, 17, 3, 3, '#40a060');
  result += pixel(cx + 8, 18, '#60c080');

  // Goggle adjustment knobs
  result += fillRect(cx - 14, 20, 2, 3, steel.base);
  result += fillRect(cx + 12, 20, 2, 3, steel.base);

  // Protective hood with texture
  result += clothTexture(cx - 16, 4, 32, 14, leather);
  result += fillRect(cx - 16, 3, 32, 1, leather.outline);

  // Hood stitching detail
  result += fillRect(cx - 14, 8, 1, 8, leather.dark);
  result += fillRect(cx + 13, 8, 1, 8, leather.dark);

  // Heavy apron
  result += clothTexture(cx - 14, 44, 28, 20, leather);

  // Apron stains (chemical residue)
  result += pixel(cx - 8, 50, '#206040');
  result += pixel(cx - 7, 51, '#206040');
  result += pixel(cx + 4, 52, '#602040');
  result += pixel(cx + 5, 53, '#602040');
  result += pixel(cx - 2, 56, '#404060');

  // Heavy tool belt
  result += fillRect(cx - 16, 52, 32, 4, leather.outline);
  result += fillRect(cx - 15, 53, 30, 2, leather.dark);

  // Vials on belt with liquid colors
  // Green vial
  result += fillRect(cx - 12, 48, 4, 7, '#103020');
  result += fillRect(cx - 11, 49, 2, 5, '#206040');
  result += pixel(cx - 11, 49, '#40a060');
  result += fillRect(cx - 12, 47, 4, 2, steel.base);  // Cork

  // Red vial
  result += fillRect(cx - 6, 48, 4, 7, '#301010');
  result += fillRect(cx - 5, 49, 2, 5, '#602020');
  result += pixel(cx - 5, 49, '#a04040');
  result += fillRect(cx - 6, 47, 4, 2, steel.base);

  // Blue vial
  result += fillRect(cx + 2, 48, 4, 7, '#102030');
  result += fillRect(cx + 3, 49, 2, 5, '#203060');
  result += pixel(cx + 3, 49, '#4060a0');
  result += fillRect(cx + 2, 47, 4, 2, steel.base);

  // Yellow vial
  result += fillRect(cx + 8, 48, 4, 7, '#302010');
  result += fillRect(cx + 9, 49, 2, 5, '#606020');
  result += pixel(cx + 9, 49, '#a0a040');
  result += fillRect(cx + 8, 47, 4, 2, steel.base);

  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Get equipment overlay for a class
 * @param {string} className - Class name
 * @returns {string} SVG elements for equipment
 */
function getClassEquipment(className) {
  const equipment = {
    warrior: getWarriorEquipment,
    wizard: getWizardEquipment,
    monk: getMonkEquipment,
    chemist: getChemistEquipment,
    berserker: getBerserkerEquipment,
    sorcerer: getSorcererEquipment,
    ninja: getNinjaEquipment,
    alchemist: getAlchemistEquipment
  };

  const generator = equipment[className];
  return generator ? generator() : '';
}

module.exports = {
  getWarriorEquipment,
  getWizardEquipment,
  getMonkEquipment,
  getChemistEquipment,
  getBerserkerEquipment,
  getSorcererEquipment,
  getNinjaEquipment,
  getAlchemistEquipment,
  getClassEquipment
};
