/**
 * Class Equipment Overlays
 * Equipment and accessories for each character class
 */

const {
  EQUIPMENT_PALETTES,
  fillRect,
  pixel
} = require('./utils');

/**
 * Warrior equipment - Steel helmet with nose guard
 */
function getWarriorEquipment() {
  const steel = EQUIPMENT_PALETTES.steel;
  let result = '';
  const cx = 32;

  // Helmet dome
  result += fillRect(cx - 14, 8, 28, 16, steel.outline);
  result += fillRect(cx - 13, 9, 26, 14, steel.dark);
  result += fillRect(cx - 12, 10, 24, 12, steel.base);
  result += fillRect(cx - 10, 10, 10, 8, steel.highlight);

  // Helmet rim
  result += fillRect(cx - 15, 22, 30, 3, steel.outline);
  result += fillRect(cx - 14, 22, 28, 2, steel.dark);

  // Nose guard
  result += fillRect(cx - 2, 22, 4, 14, steel.outline);
  result += fillRect(cx - 1, 23, 2, 12, steel.base);

  // Cheek guards
  result += fillRect(cx - 14, 24, 4, 12, steel.dark);
  result += fillRect(cx + 10, 24, 4, 12, steel.dark);
  result += fillRect(cx - 13, 25, 2, 10, steel.base);
  result += fillRect(cx + 11, 25, 2, 10, steel.base);

  // Shoulder armor hints
  result += fillRect(cx - 20, 52, 10, 12, steel.dark);
  result += fillRect(cx + 10, 52, 10, 12, steel.dark);
  result += fillRect(cx - 19, 53, 8, 10, steel.base);
  result += fillRect(cx + 11, 53, 8, 10, steel.base);

  return result;
}

/**
 * Wizard equipment - Pointed hat and magical aura
 */
function getWizardEquipment() {
  const cloth = EQUIPMENT_PALETTES.cloth;
  const magic = EQUIPMENT_PALETTES.magic;
  let result = '';
  const cx = 32;

  // Wide brim
  result += fillRect(cx - 18, 16, 36, 4, cloth.outline);
  result += fillRect(cx - 17, 17, 34, 2, cloth.dark);
  result += fillRect(cx - 16, 17, 32, 1, cloth.base);

  // Pointed cone
  result += fillRect(cx - 10, 4, 20, 4, cloth.outline);
  result += fillRect(cx - 12, 8, 24, 4, cloth.outline);
  result += fillRect(cx - 14, 12, 28, 5, cloth.outline);

  result += fillRect(cx - 9, 5, 18, 3, cloth.dark);
  result += fillRect(cx - 11, 9, 22, 3, cloth.dark);
  result += fillRect(cx - 13, 13, 26, 3, cloth.dark);

  result += fillRect(cx - 8, 5, 8, 2, cloth.highlight);
  result += fillRect(cx - 10, 9, 10, 2, cloth.highlight);

  // Hat tip
  result += fillRect(cx - 4, 0, 8, 4, cloth.outline);
  result += fillRect(cx - 3, 1, 6, 2, cloth.dark);

  // Star decoration
  result += pixel(cx + 6, 10, magic.bright);
  result += pixel(cx + 5, 11, magic.highlight);
  result += pixel(cx + 7, 11, magic.highlight);
  result += pixel(cx + 6, 12, magic.highlight);

  // Magical glow around edges
  result += pixel(cx - 18, 18, magic.highlight);
  result += pixel(cx + 17, 18, magic.highlight);
  result += pixel(cx - 4, 0, magic.bright);

  // Robe collar
  result += fillRect(cx - 10, 50, 20, 14, cloth.dark);
  result += fillRect(cx - 8, 52, 16, 12, cloth.base);

  return result;
}

/**
 * Monk equipment - Simple headband
 */
function getMonkEquipment() {
  const cloth = EQUIPMENT_PALETTES.leather;
  let result = '';
  const cx = 32;

  // Headband
  result += fillRect(cx - 14, 16, 28, 4, cloth.outline);
  result += fillRect(cx - 13, 17, 26, 2, cloth.dark);
  result += fillRect(cx - 12, 17, 24, 1, cloth.base);

  // Headband knot/tie on side
  result += fillRect(cx + 12, 14, 4, 8, cloth.dark);
  result += fillRect(cx + 13, 15, 2, 6, cloth.base);

  // Trailing band
  result += fillRect(cx + 14, 20, 3, 12, cloth.dark);
  result += fillRect(cx + 15, 21, 2, 10, cloth.base);

  // Simple robe collar
  result += fillRect(cx - 8, 50, 16, 14, cloth.dark);
  result += fillRect(cx - 6, 52, 12, 12, cloth.base);

  return result;
}

/**
 * Chemist equipment - Goggles and bandana
 */
function getChemistEquipment() {
  const leather = EQUIPMENT_PALETTES.leather;
  const steel = EQUIPMENT_PALETTES.steel;
  let result = '';
  const cx = 32;

  // Goggles strap
  result += fillRect(cx - 16, 22, 32, 3, leather.dark);
  result += fillRect(cx - 15, 23, 30, 1, leather.base);

  // Goggle frames
  result += fillRect(cx - 10, 20, 8, 8, steel.outline);
  result += fillRect(cx + 2, 20, 8, 8, steel.outline);

  // Goggle lenses (blue tinted)
  result += fillRect(cx - 9, 21, 6, 6, '#1a3050');
  result += fillRect(cx + 3, 21, 6, 6, '#1a3050');
  result += fillRect(cx - 8, 22, 4, 4, '#3060a0');
  result += fillRect(cx + 4, 22, 4, 4, '#3060a0');

  // Lens shine
  result += pixel(cx - 8, 22, '#80b0e0');
  result += pixel(cx + 4, 22, '#80b0e0');

  // Bandana/head covering
  result += fillRect(cx - 14, 10, 28, 10, leather.outline);
  result += fillRect(cx - 13, 11, 26, 8, leather.dark);
  result += fillRect(cx - 12, 12, 24, 6, leather.base);
  result += fillRect(cx - 10, 12, 10, 4, leather.highlight);

  // Apron/work clothes
  result += fillRect(cx - 10, 50, 20, 14, leather.dark);
  result += fillRect(cx - 8, 52, 16, 12, leather.base);

  // Belt with pouches
  result += fillRect(cx - 12, 58, 24, 3, leather.outline);
  result += fillRect(cx - 14, 56, 4, 8, leather.dark);
  result += fillRect(cx + 10, 56, 4, 8, leather.dark);

  return result;
}

/**
 * Berserker equipment - Horned helmet and war paint
 */
function getBerserkerEquipment() {
  const steel = EQUIPMENT_PALETTES.steel;
  const leather = EQUIPMENT_PALETTES.leather;
  let result = '';
  const cx = 32;

  // Helmet base (cruder than warrior)
  result += fillRect(cx - 13, 12, 26, 12, steel.outline);
  result += fillRect(cx - 12, 13, 24, 10, steel.dark);
  result += fillRect(cx - 10, 14, 20, 8, steel.base);

  // Horns
  result += fillRect(cx - 16, 6, 4, 10, '#f0e8d0');
  result += fillRect(cx - 18, 2, 3, 8, '#f0e8d0');
  result += fillRect(cx - 19, 0, 2, 4, '#e0d8c0');

  result += fillRect(cx + 12, 6, 4, 10, '#f0e8d0');
  result += fillRect(cx + 15, 2, 3, 8, '#f0e8d0');
  result += fillRect(cx + 17, 0, 2, 4, '#e0d8c0');

  // War paint (red streaks on face)
  result += fillRect(cx - 8, 30, 2, 10, '#a02020');
  result += fillRect(cx + 6, 30, 2, 10, '#a02020');
  result += fillRect(cx - 6, 32, 1, 6, '#a02020');
  result += fillRect(cx + 5, 32, 1, 6, '#a02020');

  // Fur collar
  result += fillRect(cx - 14, 48, 28, 8, leather.dark);
  result += fillRect(cx - 12, 50, 24, 6, leather.base);
  // Fur texture
  result += pixel(cx - 10, 50, leather.highlight);
  result += pixel(cx - 6, 52, leather.highlight);
  result += pixel(cx + 4, 51, leather.highlight);
  result += pixel(cx + 8, 50, leather.highlight);

  return result;
}

/**
 * Sorcerer equipment - Ornate circlet and magical aura
 */
function getSorcererEquipment() {
  const gold = EQUIPMENT_PALETTES.gold;
  const magic = EQUIPMENT_PALETTES.magic;
  let result = '';
  const cx = 32;

  // Ornate circlet base
  result += fillRect(cx - 14, 14, 28, 4, gold.outline);
  result += fillRect(cx - 13, 15, 26, 2, gold.dark);
  result += fillRect(cx - 12, 15, 24, 1, gold.base);

  // Center gem
  result += fillRect(cx - 3, 12, 6, 6, magic.outline);
  result += fillRect(cx - 2, 13, 4, 4, magic.dark);
  result += fillRect(cx - 1, 14, 2, 2, magic.highlight);
  result += pixel(cx - 1, 13, magic.bright);

  // Side decorations
  result += fillRect(cx - 10, 13, 3, 3, gold.base);
  result += fillRect(cx + 7, 13, 3, 3, gold.base);
  result += pixel(cx - 9, 14, gold.highlight);
  result += pixel(cx + 8, 14, gold.highlight);

  // Magical aura/glow effect
  result += pixel(cx, 10, magic.bright);
  result += pixel(cx - 2, 11, magic.highlight);
  result += pixel(cx + 2, 11, magic.highlight);
  result += pixel(cx - 4, 10, magic.base);
  result += pixel(cx + 4, 10, magic.base);

  // Elegant robes
  result += fillRect(cx - 12, 48, 24, 16, magic.dark);
  result += fillRect(cx - 10, 50, 20, 14, magic.base);

  // Gold trim on robes
  result += fillRect(cx - 12, 48, 2, 16, gold.base);
  result += fillRect(cx + 10, 48, 2, 16, gold.base);
  result += fillRect(cx - 2, 50, 4, 14, gold.dark);

  return result;
}

/**
 * Ninja equipment - Face mask covering lower face
 */
function getNinjaEquipment() {
  const cloth = EQUIPMENT_PALETTES.darkSteel;
  let result = '';
  const cx = 32;

  // Head wrap/hood
  result += fillRect(cx - 14, 8, 28, 16, cloth.outline);
  result += fillRect(cx - 13, 9, 26, 14, cloth.dark);
  result += fillRect(cx - 12, 10, 24, 12, cloth.base);
  result += fillRect(cx - 10, 10, 10, 8, cloth.highlight);

  // Face mask (covers nose and below)
  result += fillRect(cx - 12, 30, 24, 18, cloth.outline);
  result += fillRect(cx - 11, 31, 22, 16, cloth.dark);
  result += fillRect(cx - 10, 32, 20, 14, cloth.base);

  // Eye slit area (leave eyes visible)
  result += fillRect(cx - 12, 24, 24, 6, cloth.outline);
  result += fillRect(cx - 11, 25, 22, 4, cloth.dark);

  // Forehead protector/plate
  result += fillRect(cx - 8, 16, 16, 4, cloth.highlight);
  result += fillRect(cx - 7, 17, 14, 2, '#4a4a50');

  // Dark outfit
  result += fillRect(cx - 10, 48, 20, 16, cloth.dark);
  result += fillRect(cx - 8, 50, 16, 14, cloth.base);

  return result;
}

/**
 * Alchemist equipment - Heavy goggles and protective gear
 */
function getAlchemistEquipment() {
  const leather = EQUIPMENT_PALETTES.leather;
  const steel = EQUIPMENT_PALETTES.steel;
  let result = '';
  const cx = 32;

  // Heavy goggles - larger than chemist
  result += fillRect(cx - 14, 18, 28, 3, leather.dark);

  // Large round goggle frames
  result += fillRect(cx - 12, 16, 10, 12, steel.outline);
  result += fillRect(cx + 2, 16, 10, 12, steel.outline);

  // Goggle lenses (green tinted for alchemy)
  result += fillRect(cx - 11, 17, 8, 10, '#103020');
  result += fillRect(cx + 3, 17, 8, 10, '#103020');
  result += fillRect(cx - 10, 18, 6, 8, '#206040');
  result += fillRect(cx + 4, 18, 6, 8, '#206040');

  // Lens shine
  result += fillRect(cx - 10, 18, 2, 2, '#40a060');
  result += fillRect(cx + 4, 18, 2, 2, '#40a060');

  // Protective hood/hat
  result += fillRect(cx - 15, 6, 30, 12, leather.outline);
  result += fillRect(cx - 14, 7, 28, 10, leather.dark);
  result += fillRect(cx - 13, 8, 26, 8, leather.base);
  result += fillRect(cx - 11, 8, 12, 5, leather.highlight);

  // Heavy apron
  result += fillRect(cx - 12, 46, 24, 18, leather.dark);
  result += fillRect(cx - 10, 48, 20, 16, leather.base);

  // Tool belt with vials
  result += fillRect(cx - 14, 54, 28, 3, leather.outline);

  // Vials on belt
  result += fillRect(cx - 10, 50, 3, 6, '#206040');  // Green vial
  result += fillRect(cx - 4, 50, 3, 6, '#602020');   // Red vial
  result += fillRect(cx + 2, 50, 3, 6, '#203060');   // Blue vial
  result += fillRect(cx + 8, 50, 3, 6, '#606020');   // Yellow vial

  return result;
}

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
