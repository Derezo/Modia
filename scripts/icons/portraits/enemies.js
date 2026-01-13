/**
 * Enemy Portrait Generators
 * Detailed portrait versions of all 16 enemy types
 */

const { PALETTES } = require('../utils');
const {
  createPortraitSvg,
  fillRect,
  pixel,
  pixelEllipse,
  background
} = require('./utils');

/**
 * Generate all enemy portraits
 * @returns {Object} Map of enemy name to SVG content
 */
function generateEnemyPortraits() {
  return {
    // Forest enemies
    goblin_warrior: generateGoblinWarriorPortrait(),
    gray_wolf: generateGrayWolfPortrait(),
    forest_slime: generateForestSlimePortrait(),

    // Cave enemies
    cave_bat: generateCaveBatPortrait(),
    giant_spider: generateGiantSpiderPortrait(),
    skeleton_warrior: generateSkeletonWarriorPortrait(),
    stone_golem: generateStoneGolemPortrait(),

    // Mountain enemies
    mountain_troll: generateMountainTrollPortrait(),
    troll_shaman: generateTrollShamanPortrait(),
    harpy: generateHarpyPortrait(),

    // Bridge enemies
    bridge_bandit: generateBridgeBanditPortrait(),
    bandit_captain: generateBanditCaptainPortrait(),
    bridge_troll: generateBridgeTrollPortrait(),

    // Palace enemies
    dark_knight: generateDarkKnightPortrait(),
    shadow_assassin: generateShadowAssassinPortrait(),
    palace_guard: generatePalaceGuardPortrait()
  };
}

// ============================================================================
// FOREST ENEMIES
// ============================================================================

function generateGoblinWarriorPortrait() {
  const p = PALETTES.nature;
  let result = background('#1a2a1a');
  const cx = 32;

  // Neck
  result += fillRect(cx - 6, 48, 12, 16, p.dark);
  result += fillRect(cx - 5, 49, 10, 15, p.mid);

  // Head shape
  result += pixelEllipse(cx, 30, 16, 18, p.dark);
  result += pixelEllipse(cx, 30, 15, 17, p.mid);
  result += pixelEllipse(cx, 29, 14, 16, p.light);

  // Pointed ears
  result += fillRect(cx - 20, 22, 6, 10, p.mid);
  result += fillRect(cx - 22, 18, 4, 8, p.mid);
  result += fillRect(cx - 23, 14, 2, 6, p.light);
  result += fillRect(cx + 14, 22, 6, 10, p.mid);
  result += fillRect(cx + 18, 18, 4, 8, p.mid);
  result += fillRect(cx + 21, 14, 2, 6, p.light);

  // Eyes (large, yellow)
  result += fillRect(cx - 10, 24, 7, 8, '#2a2a20');
  result += fillRect(cx + 3, 24, 7, 8, '#2a2a20');
  result += fillRect(cx - 9, 25, 5, 6, '#daa520');
  result += fillRect(cx + 4, 25, 5, 6, '#daa520');
  result += fillRect(cx - 8, 26, 3, 4, '#ffd700');
  result += fillRect(cx + 5, 26, 3, 4, '#ffd700');
  result += pixel(cx - 8, 25, '#ffee88');
  result += pixel(cx + 5, 25, '#ffee88');

  // Nose
  result += fillRect(cx - 3, 32, 6, 5, p.dark);
  result += fillRect(cx - 2, 33, 4, 3, p.mid);

  // Mouth with fangs
  result += fillRect(cx - 6, 40, 12, 3, '#2a1a10');
  result += fillRect(cx - 5, 38, 2, 4, '#f0e8d8');  // Left fang
  result += fillRect(cx + 3, 38, 2, 4, '#f0e8d8');  // Right fang

  // Crude armor shoulder
  result += fillRect(cx - 18, 52, 12, 12, '#4a4a3a');
  result += fillRect(cx + 6, 52, 12, 12, '#4a4a3a');
  result += fillRect(cx - 17, 53, 10, 10, '#6a6a5a');

  // Sword hint
  result += fillRect(cx + 16, 44, 3, 20, '#5a5a5a');
  result += fillRect(cx + 17, 45, 1, 18, '#8a8a8a');

  return createPortraitSvg(result);
}

function generateGrayWolfPortrait() {
  const p = PALETTES.grayBeast;
  let result = background('#1a1a20');
  const cx = 32;

  // Fur body/chest
  result += pixelEllipse(cx, 56, 20, 12, p.dark);
  result += pixelEllipse(cx, 56, 18, 10, p.mid);

  // Head shape (wolf snout)
  result += pixelEllipse(cx, 28, 18, 20, p.dark);
  result += pixelEllipse(cx, 28, 17, 19, p.mid);
  result += pixelEllipse(cx, 27, 16, 18, p.light);

  // Ears
  result += fillRect(cx - 16, 4, 8, 14, p.dark);
  result += fillRect(cx - 18, 2, 6, 10, p.dark);
  result += fillRect(cx - 15, 5, 6, 12, p.mid);
  result += fillRect(cx - 14, 6, 4, 8, '#d0a080');  // Inner ear

  result += fillRect(cx + 8, 4, 8, 14, p.dark);
  result += fillRect(cx + 12, 2, 6, 10, p.dark);
  result += fillRect(cx + 9, 5, 6, 12, p.mid);
  result += fillRect(cx + 10, 6, 4, 8, '#d0a080');

  // Snout
  result += pixelEllipse(cx, 38, 10, 8, p.mid);
  result += pixelEllipse(cx, 37, 9, 7, p.light);
  result += pixelEllipse(cx, 36, 8, 6, p.highlight);

  // Nose
  result += fillRect(cx - 4, 32, 8, 5, '#1a1a1a');
  result += fillRect(cx - 3, 33, 6, 3, '#2a2a2a');
  result += pixel(cx - 2, 33, '#4a4a4a');

  // Eyes (yellow predator)
  result += fillRect(cx - 12, 22, 8, 6, '#1a1a1a');
  result += fillRect(cx + 4, 22, 8, 6, '#1a1a1a');
  result += fillRect(cx - 11, 23, 6, 4, '#daa520');
  result += fillRect(cx + 5, 23, 6, 4, '#daa520');
  result += fillRect(cx - 10, 24, 3, 2, '#1a1a1a');
  result += fillRect(cx + 6, 24, 3, 2, '#1a1a1a');

  // Mouth
  result += fillRect(cx - 6, 42, 12, 2, '#1a1a1a');

  // Fur detail on chest
  result += fillRect(cx - 6, 52, 12, 12, p.highlight);
  result += fillRect(cx - 4, 54, 8, 10, '#e0e0e0');

  return createPortraitSvg(result);
}

function generateForestSlimePortrait() {
  const p = PALETTES.slime;
  let result = background('#1a2a2a');
  const cx = 32;

  // Main body blob
  result += pixelEllipse(cx, 36, 24, 22, p.dark);
  result += pixelEllipse(cx, 35, 23, 21, p.mid);
  result += pixelEllipse(cx, 34, 21, 19, p.light);

  // Top bulge
  result += pixelEllipse(cx - 6, 18, 12, 10, p.mid);
  result += pixelEllipse(cx - 6, 17, 11, 9, p.light);
  result += pixelEllipse(cx - 6, 16, 10, 8, p.highlight);

  // Shine highlights
  result += pixelEllipse(cx - 10, 14, 6, 4, p.highlight);
  result += fillRect(cx - 12, 12, 4, 3, '#ffffff');

  // Secondary shine
  result += fillRect(cx + 8, 22, 5, 4, p.highlight);
  result += pixel(cx + 9, 22, '#ffffff');

  // Eyes (cute slime eyes)
  result += fillRect(cx - 10, 30, 8, 10, '#1a2a2a');
  result += fillRect(cx + 2, 30, 8, 10, '#1a2a2a');
  result += fillRect(cx - 9, 31, 6, 8, '#2a3a3a');
  result += fillRect(cx + 3, 31, 6, 8, '#2a3a3a');

  // Eye shine
  result += fillRect(cx - 8, 32, 3, 3, '#ffffff');
  result += fillRect(cx + 4, 32, 3, 3, '#ffffff');

  // Drip detail at bottom
  result += fillRect(cx - 8, 54, 4, 8, p.mid);
  result += fillRect(cx + 4, 56, 3, 6, p.mid);

  return createPortraitSvg(result);
}

// ============================================================================
// CAVE ENEMIES
// ============================================================================

function generateCaveBatPortrait() {
  const p = PALETTES.beast;
  let result = background('#0a0a10');
  const cx = 32;

  // Wings spread behind
  result += fillRect(2, 20, 14, 30, p.dark);
  result += fillRect(4, 22, 10, 26, p.mid);
  result += fillRect(48, 20, 14, 30, p.dark);
  result += fillRect(50, 22, 10, 26, p.mid);

  // Wing membrane details
  result += fillRect(6, 24, 2, 20, p.dark);
  result += fillRect(10, 26, 2, 16, p.dark);
  result += fillRect(52, 24, 2, 20, p.dark);
  result += fillRect(56, 26, 2, 16, p.dark);

  // Body
  result += pixelEllipse(cx, 38, 12, 18, p.dark);
  result += pixelEllipse(cx, 37, 11, 17, p.mid);

  // Head
  result += pixelEllipse(cx, 22, 14, 14, p.dark);
  result += pixelEllipse(cx, 21, 13, 13, p.mid);
  result += pixelEllipse(cx, 20, 12, 12, p.light);

  // Ears (large pointed)
  result += fillRect(cx - 14, 4, 8, 14, p.dark);
  result += fillRect(cx - 16, 2, 6, 10, p.dark);
  result += fillRect(cx - 13, 5, 6, 12, p.mid);

  result += fillRect(cx + 6, 4, 8, 14, p.dark);
  result += fillRect(cx + 10, 2, 6, 10, p.dark);
  result += fillRect(cx + 7, 5, 6, 12, p.mid);

  // Glowing red eyes
  result += fillRect(cx - 9, 18, 6, 5, '#400000');
  result += fillRect(cx + 3, 18, 6, 5, '#400000');
  result += fillRect(cx - 8, 19, 4, 3, '#aa0000');
  result += fillRect(cx + 4, 19, 4, 3, '#aa0000');
  result += fillRect(cx - 7, 19, 2, 2, '#ff4444');
  result += fillRect(cx + 5, 19, 2, 2, '#ff4444');

  // Nose
  result += fillRect(cx - 2, 24, 4, 3, p.dark);

  // Fangs
  result += fillRect(cx - 4, 28, 2, 4, '#f0e8d8');
  result += fillRect(cx + 2, 28, 2, 4, '#f0e8d8');

  return createPortraitSvg(result);
}

function generateGiantSpiderPortrait() {
  const p = PALETTES.spider;
  let result = background('#0a0808');
  const cx = 32;

  // Leg hints on sides
  result += fillRect(2, 30, 10, 3, p.dark);
  result += fillRect(0, 38, 12, 3, p.dark);
  result += fillRect(4, 46, 10, 3, p.dark);
  result += fillRect(52, 30, 10, 3, p.dark);
  result += fillRect(52, 38, 12, 3, p.dark);
  result += fillRect(50, 46, 10, 3, p.dark);

  // Abdomen hint
  result += pixelEllipse(cx, 54, 16, 10, p.dark);

  // Cephalothorax (main body/head)
  result += pixelEllipse(cx, 30, 20, 22, p.dark);
  result += pixelEllipse(cx, 29, 19, 21, p.mid);
  result += pixelEllipse(cx, 28, 18, 20, p.light);

  // 8 Eyes arrangement
  // Large center eyes
  result += fillRect(cx - 8, 22, 6, 8, '#1a0000');
  result += fillRect(cx + 2, 22, 6, 8, '#1a0000');
  result += fillRect(cx - 7, 23, 4, 6, p.accent);
  result += fillRect(cx + 3, 23, 4, 6, p.accent);
  result += fillRect(cx - 6, 24, 2, 3, '#ff4444');
  result += fillRect(cx + 4, 24, 2, 3, '#ff4444');

  // Small upper eyes
  result += fillRect(cx - 12, 18, 4, 4, p.accent);
  result += fillRect(cx + 8, 18, 4, 4, p.accent);

  // Tiny top eyes
  result += fillRect(cx - 6, 14, 3, 3, p.accent);
  result += fillRect(cx, 12, 3, 3, p.accent);
  result += fillRect(cx + 3, 14, 3, 3, p.accent);

  // Mandibles/Chelicerae
  result += fillRect(cx - 8, 36, 4, 12, p.dark);
  result += fillRect(cx + 4, 36, 4, 12, p.dark);
  result += fillRect(cx - 7, 37, 2, 10, p.mid);
  result += fillRect(cx + 5, 37, 2, 10, p.mid);

  // Fang tips
  result += fillRect(cx - 6, 46, 2, 4, p.light);
  result += fillRect(cx + 4, 46, 2, 4, p.light);

  return createPortraitSvg(result);
}

function generateSkeletonWarriorPortrait() {
  const p = PALETTES.undead;
  let result = background('#1a1a20');
  const cx = 32;

  // Neck vertebrae
  result += fillRect(cx - 4, 46, 8, 18, p.dark);
  result += fillRect(cx - 3, 48, 6, 14, p.mid);
  result += fillRect(cx - 2, 50, 4, 4, p.light);
  result += fillRect(cx - 2, 56, 4, 4, p.light);

  // Skull
  result += pixelEllipse(cx, 26, 16, 20, p.dark);
  result += pixelEllipse(cx, 25, 15, 19, p.mid);
  result += pixelEllipse(cx, 24, 14, 18, p.light);

  // Eye sockets
  result += fillRect(cx - 10, 20, 8, 10, p.dark);
  result += fillRect(cx + 2, 20, 8, 10, p.dark);
  result += fillRect(cx - 9, 21, 6, 8, '#1a1a20');
  result += fillRect(cx + 3, 21, 6, 8, '#1a1a20');

  // Eye glow
  result += fillRect(cx - 8, 23, 4, 4, p.accent);
  result += fillRect(cx + 4, 23, 4, 4, p.accent);
  result += fillRect(cx - 7, 24, 2, 2, '#aa4466');
  result += fillRect(cx + 5, 24, 2, 2, '#aa4466');

  // Nasal cavity
  result += fillRect(cx - 2, 32, 4, 6, p.dark);
  result += fillRect(cx - 1, 33, 2, 4, '#1a1a20');

  // Teeth
  result += fillRect(cx - 8, 40, 16, 4, p.highlight);
  result += fillRect(cx - 7, 41, 2, 2, p.dark);
  result += fillRect(cx - 4, 41, 2, 2, p.dark);
  result += fillRect(cx - 1, 41, 2, 2, p.dark);
  result += fillRect(cx + 2, 41, 2, 2, p.dark);
  result += fillRect(cx + 5, 41, 2, 2, p.dark);

  // Sword behind
  result += fillRect(4, 56, 4, 8, '#4a4a4a');
  result += fillRect(5, 52, 2, 8, '#6a6a6a');
  result += fillRect(6, 10, 2, 44, '#5a5a5a');
  result += fillRect(7, 12, 1, 40, '#8a8a8a');

  // Sword crossguard
  result += fillRect(2, 50, 10, 4, '#8b6914');
  result += fillRect(3, 51, 8, 2, '#daa520');

  return createPortraitSvg(result);
}

function generateStoneGolemPortrait() {
  const p = {
    dark: '#4a4a3a',
    mid: '#6a6a5a',
    light: '#8a8a7a',
    highlight: '#aaa99a'
  };
  let result = background('#2a2a20');
  const cx = 32;

  // Shoulder/body mass
  result += fillRect(6, 46, 52, 18, p.dark);
  result += fillRect(8, 48, 48, 16, p.mid);

  // Angular rocky head
  result += fillRect(cx - 16, 8, 32, 40, p.dark);
  result += fillRect(cx - 15, 10, 30, 36, p.mid);
  result += fillRect(cx - 14, 12, 28, 32, p.light);

  // Cracks/texture
  result += fillRect(cx - 10, 14, 2, 12, p.dark);
  result += fillRect(cx + 6, 18, 2, 16, p.dark);
  result += fillRect(cx - 12, 30, 8, 2, p.dark);
  result += fillRect(cx + 4, 34, 10, 2, p.dark);

  // Glowing eyes
  result += fillRect(cx - 12, 22, 10, 8, '#1a1008');
  result += fillRect(cx + 2, 22, 10, 8, '#1a1008');
  result += fillRect(cx - 11, 23, 8, 6, '#aa6600');
  result += fillRect(cx + 3, 23, 8, 6, '#aa6600');
  result += fillRect(cx - 10, 24, 6, 4, '#ffaa00');
  result += fillRect(cx + 4, 24, 6, 4, '#ffaa00');

  // Glow effect
  result += fillRect(cx - 9, 25, 4, 2, '#ffdd44');
  result += fillRect(cx + 5, 25, 4, 2, '#ffdd44');

  // Mouth crack
  result += fillRect(cx - 8, 38, 16, 4, p.dark);
  result += fillRect(cx - 6, 36, 2, 2, p.dark);
  result += fillRect(cx + 4, 36, 2, 2, p.dark);

  return createPortraitSvg(result);
}

// ============================================================================
// MOUNTAIN ENEMIES
// ============================================================================

function generateMountainTrollPortrait() {
  const p = PALETTES.troll;
  let result = background('#2a3a2a');
  const cx = 32;

  // Thick neck/shoulders
  result += fillRect(4, 48, 56, 16, p.dark);
  result += fillRect(6, 50, 52, 14, p.mid);

  // Large brutish head
  result += pixelEllipse(cx, 28, 22, 24, p.dark);
  result += pixelEllipse(cx, 27, 21, 23, p.mid);
  result += pixelEllipse(cx, 26, 20, 22, p.light);

  // Heavy brow
  result += fillRect(cx - 20, 18, 40, 6, p.dark);
  result += fillRect(cx - 19, 19, 38, 4, p.mid);

  // Ears
  result += fillRect(cx - 24, 24, 6, 10, p.mid);
  result += fillRect(cx - 23, 25, 4, 8, p.light);
  result += fillRect(cx + 18, 24, 6, 10, p.mid);
  result += fillRect(cx + 19, 25, 4, 8, p.light);

  // Small angry eyes
  result += fillRect(cx - 12, 24, 6, 5, '#1a1a1a');
  result += fillRect(cx + 6, 24, 6, 5, '#1a1a1a');
  result += fillRect(cx - 11, 25, 4, 3, '#884400');
  result += fillRect(cx + 7, 25, 4, 3, '#884400');

  // Big nose
  result += fillRect(cx - 5, 30, 10, 8, p.dark);
  result += fillRect(cx - 4, 31, 8, 6, p.mid);
  result += fillRect(cx - 3, 34, 2, 3, p.dark);
  result += fillRect(cx + 1, 34, 2, 3, p.dark);

  // Tusks
  result += fillRect(cx - 12, 40, 4, 10, '#f0e8d8');
  result += fillRect(cx - 13, 46, 3, 6, '#f0e8d8');
  result += fillRect(cx - 11, 41, 2, 8, '#e8e0d0');
  result += fillRect(cx + 8, 40, 4, 10, '#f0e8d8');
  result += fillRect(cx + 10, 46, 3, 6, '#f0e8d8');
  result += fillRect(cx + 9, 41, 2, 8, '#e8e0d0');

  return createPortraitSvg(result);
}

function generateTrollShamanPortrait() {
  const p = PALETTES.troll;
  const m = PALETTES.magic;
  let result = background('#2a2a3a');
  const cx = 32;

  // Staff on side
  result += fillRect(52, 0, 4, 64, '#5a4030');
  result += fillRect(53, 2, 2, 60, '#7a6050');

  // Magic orb on staff
  result += pixelEllipse(54, 10, 8, 8, m.dark);
  result += pixelEllipse(54, 9, 7, 7, m.mid);
  result += pixelEllipse(54, 8, 6, 6, m.light);
  result += fillRect(52, 6, 4, 4, m.highlight);

  // Sparkles
  result += pixel(48, 4, m.accent);
  result += pixel(60, 8, m.accent);
  result += pixel(50, 14, m.accent);

  // Body
  result += fillRect(8, 50, 40, 14, p.dark);
  result += fillRect(10, 52, 36, 12, p.mid);

  // Smaller wiser head
  result += pixelEllipse(cx - 4, 30, 18, 20, p.dark);
  result += pixelEllipse(cx - 4, 29, 17, 19, p.mid);
  result += pixelEllipse(cx - 4, 28, 16, 18, p.light);

  // Wise squinting eyes
  result += fillRect(cx - 14, 26, 8, 3, p.dark);
  result += fillRect(cx - 2, 26, 8, 3, p.dark);
  result += fillRect(cx - 13, 27, 6, 1, m.mid);
  result += fillRect(cx - 1, 27, 6, 1, m.mid);

  // Big nose
  result += fillRect(cx - 7, 32, 6, 5, p.dark);
  result += fillRect(cx - 6, 33, 4, 3, p.mid);

  // Small tusks
  result += fillRect(cx - 12, 40, 3, 6, '#f0e8d8');
  result += fillRect(cx + 1, 40, 3, 6, '#f0e8d8');

  // Bone necklace
  result += fillRect(cx - 16, 48, 4, 3, '#e0d8c8');
  result += fillRect(cx - 10, 50, 3, 3, '#e0d8c8');
  result += fillRect(cx - 4, 48, 4, 3, '#e0d8c8');
  result += fillRect(cx + 2, 50, 3, 3, '#e0d8c8');

  return createPortraitSvg(result);
}

function generateHarpyPortrait() {
  const p = PALETTES.harpy;
  const skin = PALETTES.humanoidSkin;
  let result = background('#3a3a4a');
  const cx = 32;

  // Feathered wings on sides
  result += fillRect(2, 24, 12, 40, p.dark);
  result += fillRect(4, 26, 8, 36, p.mid);
  result += fillRect(6, 28, 4, 32, p.light);
  result += fillRect(50, 24, 12, 40, p.dark);
  result += fillRect(52, 26, 8, 36, p.mid);
  result += fillRect(54, 28, 4, 32, p.light);

  // Feather details
  result += fillRect(2, 30, 4, 6, p.light);
  result += fillRect(2, 40, 4, 6, p.light);
  result += fillRect(58, 30, 4, 6, p.light);
  result += fillRect(58, 40, 4, 6, p.light);

  // Feathered head/hair
  result += fillRect(cx - 16, 4, 32, 18, p.dark);
  result += fillRect(cx - 14, 6, 28, 14, p.mid);
  result += fillRect(cx - 12, 8, 24, 10, p.light);

  // Head feathers
  result += fillRect(cx - 12, 0, 4, 8, p.mid);
  result += fillRect(cx + 8, 0, 4, 8, p.mid);
  result += fillRect(cx - 2, 0, 4, 6, p.accent);

  // Face
  result += pixelEllipse(cx, 30, 14, 16, skin.dark);
  result += pixelEllipse(cx, 29, 13, 15, skin.mid);
  result += pixelEllipse(cx, 28, 12, 14, skin.light);

  // Fierce eyes
  result += fillRect(cx - 8, 24, 6, 5, '#1a1a1a');
  result += fillRect(cx + 2, 24, 6, 5, '#1a1a1a');
  result += fillRect(cx - 7, 25, 4, 3, '#daa520');
  result += fillRect(cx + 3, 25, 4, 3, '#daa520');
  result += pixel(cx - 6, 25, '#ffffff');
  result += pixel(cx + 4, 25, '#ffffff');

  // Sharp nose/beak hint
  result += fillRect(cx - 2, 32, 4, 6, skin.dark);
  result += fillRect(cx - 1, 33, 2, 4, skin.mid);
  result += fillRect(cx - 1, 38, 2, 2, '#4a3a2a');

  // Mouth
  result += fillRect(cx - 4, 40, 8, 2, skin.dark);

  return createPortraitSvg(result);
}

// ============================================================================
// BRIDGE ENEMIES
// ============================================================================

function generateBridgeBanditPortrait() {
  const p = PALETTES.humanoidCloth;
  const skin = PALETTES.humanoidSkin;
  let result = background('#2a2a30');
  const cx = 32;

  // Hood
  result += fillRect(cx - 18, 4, 36, 24, p.dark);
  result += fillRect(cx - 16, 6, 32, 20, p.mid);
  result += fillRect(cx - 14, 8, 28, 16, p.light);

  // Hood shadow
  result += fillRect(cx - 12, 18, 24, 8, '#1a1a20');

  // Face in shadow
  result += pixelEllipse(cx, 34, 12, 14, skin.dark);
  result += pixelEllipse(cx, 33, 11, 13, skin.mid);

  // Eyes in shadow of hood
  result += fillRect(cx - 8, 26, 5, 4, '#1a1a20');
  result += fillRect(cx + 3, 26, 5, 4, '#1a1a20');
  result += fillRect(cx - 7, 27, 3, 2, '#888888');
  result += fillRect(cx + 4, 27, 3, 2, '#888888');

  // Mask/bandana over lower face
  result += fillRect(cx - 12, 32, 24, 14, '#3a2020');
  result += fillRect(cx - 11, 33, 22, 12, '#5a3030');
  result += fillRect(cx - 10, 34, 20, 10, '#4a2828');

  // Cloak
  result += fillRect(cx - 16, 46, 32, 18, p.dark);
  result += fillRect(cx - 14, 48, 28, 16, p.mid);

  // Dagger hint
  result += fillRect(cx + 14, 42, 2, 14, '#5a5a5a');
  result += fillRect(cx + 15, 44, 1, 10, '#8a8a8a');
  result += fillRect(cx + 13, 42, 4, 2, '#6a5020');

  return createPortraitSvg(result);
}

function generateBanditCaptainPortrait() {
  const p = PALETTES.humanoidCloth;
  const skin = PALETTES.humanoidSkin;
  let result = background('#2a2a30');
  const cx = 32;

  // Fancy hat
  result += fillRect(cx - 18, 12, 36, 8, '#2a2a3a');
  result += fillRect(cx - 16, 13, 32, 6, '#3a3a4a');

  // Hat top
  result += fillRect(cx - 12, 4, 24, 10, '#2a2a3a');
  result += fillRect(cx - 10, 5, 20, 8, '#3a3a4a');

  // Feather
  result += fillRect(cx + 10, 0, 4, 14, '#aa2222');
  result += fillRect(cx + 11, 2, 2, 10, '#cc4444');
  result += fillRect(cx + 12, 4, 1, 6, '#ee6666');

  // Face
  result += pixelEllipse(cx, 32, 14, 16, skin.dark);
  result += pixelEllipse(cx, 31, 13, 15, skin.mid);
  result += pixelEllipse(cx, 30, 12, 14, skin.light);

  // Confident eyes
  result += fillRect(cx - 9, 26, 6, 5, '#ffffff');
  result += fillRect(cx + 3, 26, 6, 5, '#ffffff');
  result += fillRect(cx - 8, 27, 4, 3, '#4a3a2a');
  result += fillRect(cx + 4, 27, 4, 3, '#4a3a2a');
  result += pixel(cx - 7, 27, '#ffffff');
  result += pixel(cx + 5, 27, '#ffffff');

  // Eyebrows
  result += fillRect(cx - 9, 24, 6, 2, '#3a2a1a');
  result += fillRect(cx + 3, 24, 6, 2, '#3a2a1a');

  // Nose
  result += fillRect(cx - 2, 32, 4, 4, skin.dark);

  // Smirk
  result += fillRect(cx - 4, 40, 10, 2, '#4a2020');
  result += pixel(cx + 5, 39, '#4a2020');

  // Goatee
  result += fillRect(cx - 2, 42, 4, 6, '#3a2a1a');
  result += fillRect(cx - 1, 46, 2, 4, '#3a2a1a');

  // Scar
  result += fillRect(cx + 6, 30, 2, 6, '#aa7766');

  // Fine clothes
  result += fillRect(cx - 14, 46, 28, 18, p.dark);
  result += fillRect(cx - 12, 48, 24, 16, '#4a3030');
  result += fillRect(cx - 2, 48, 4, 16, '#6a5020');  // Gold trim

  return createPortraitSvg(result);
}

function generateBridgeTrollPortrait() {
  const p = {
    dark: '#3a4a3a',
    mid: '#4a5a4a',
    light: '#5a6a5a',
    highlight: '#6a7a6a'
  };
  let result = background('#1a2a1a');
  const cx = 32;

  // Massive shoulders
  result += fillRect(0, 44, 64, 20, p.dark);
  result += fillRect(2, 46, 60, 18, p.mid);

  // Very large head
  result += pixelEllipse(cx, 26, 26, 26, p.dark);
  result += pixelEllipse(cx, 25, 25, 25, p.mid);
  result += pixelEllipse(cx, 24, 24, 24, p.light);

  // Very heavy brow
  result += fillRect(cx - 24, 14, 48, 8, p.dark);
  result += fillRect(cx - 23, 15, 46, 6, p.mid);

  // Tiny angry eyes
  result += fillRect(cx - 14, 22, 6, 4, '#1a1a1a');
  result += fillRect(cx + 8, 22, 6, 4, '#1a1a1a');
  result += fillRect(cx - 13, 23, 4, 2, '#aa4400');
  result += fillRect(cx + 9, 23, 4, 2, '#aa4400');

  // Huge nose
  result += fillRect(cx - 6, 28, 12, 10, p.dark);
  result += fillRect(cx - 5, 29, 10, 8, p.mid);
  result += fillRect(cx - 4, 34, 3, 3, p.dark);
  result += fillRect(cx + 1, 34, 3, 3, p.dark);

  // Large tusks
  result += fillRect(cx - 14, 38, 5, 14, '#e0d8c8');
  result += fillRect(cx - 16, 46, 4, 10, '#e0d8c8');
  result += fillRect(cx - 13, 39, 3, 12, '#f0e8d8');
  result += fillRect(cx + 9, 38, 5, 14, '#e0d8c8');
  result += fillRect(cx + 12, 46, 4, 10, '#e0d8c8');
  result += fillRect(cx + 10, 39, 3, 12, '#f0e8d8');

  // Warts
  result += fillRect(cx - 18, 30, 3, 3, p.dark);
  result += fillRect(cx + 16, 28, 3, 3, p.dark);
  result += fillRect(cx - 8, 18, 2, 2, p.dark);

  return createPortraitSvg(result);
}

// ============================================================================
// PALACE ENEMIES
// ============================================================================

function generateDarkKnightPortrait() {
  const p = PALETTES.darkArmor;
  let result = background('#0a0a10');
  const cx = 32;

  // Shoulder armor
  result += fillRect(2, 46, 20, 18, p.dark);
  result += fillRect(4, 48, 16, 16, p.mid);
  result += fillRect(42, 46, 20, 18, p.dark);
  result += fillRect(44, 48, 16, 16, p.mid);

  // Helmet
  result += pixelEllipse(cx, 28, 18, 24, p.dark);
  result += pixelEllipse(cx, 27, 17, 23, p.mid);
  result += pixelEllipse(cx, 26, 16, 22, p.light);

  // Helmet crest
  result += fillRect(cx - 3, 2, 6, 16, p.mid);
  result += fillRect(cx - 2, 4, 4, 12, p.light);

  // T-shaped visor glow
  result += fillRect(cx - 10, 26, 20, 4, '#1a0010');
  result += fillRect(cx - 2, 26, 4, 14, '#1a0010');

  // Visor glow
  result += fillRect(cx - 9, 27, 18, 2, p.accent);
  result += fillRect(cx - 1, 28, 2, 10, p.accent);

  // Neck guard
  result += fillRect(cx - 10, 44, 20, 6, p.dark);
  result += fillRect(cx - 8, 45, 16, 4, p.mid);

  // Dark aura effect
  result += pixel(cx - 18, 20, p.accent);
  result += pixel(cx + 17, 22, p.accent);
  result += pixel(cx - 16, 40, p.accent);
  result += pixel(cx + 15, 38, p.accent);

  return createPortraitSvg(result);
}

function generateShadowAssassinPortrait() {
  const p = PALETTES.darkArmor;
  let result = background('#0a0a10');
  const cx = 32;

  // Hood (larger, more dramatic)
  result += fillRect(cx - 20, 2, 40, 30, p.dark);
  result += fillRect(cx - 18, 4, 36, 26, p.mid);
  result += fillRect(cx - 16, 6, 32, 22, p.light);

  // Deep hood shadow
  result += fillRect(cx - 14, 16, 28, 16, '#0a0a10');

  // Face completely in shadow
  result += pixelEllipse(cx, 32, 10, 12, '#0a0a10');

  // Glowing eyes
  result += fillRect(cx - 8, 28, 5, 4, p.accent);
  result += fillRect(cx + 3, 28, 5, 4, p.accent);
  result += fillRect(cx - 7, 29, 3, 2, '#aa4466');
  result += fillRect(cx + 4, 29, 3, 2, '#aa4466');

  // Mask/scarf
  result += fillRect(cx - 10, 36, 20, 10, '#1a1a25');
  result += fillRect(cx - 8, 38, 16, 6, '#2a2a35');

  // Daggers crossed
  result += fillRect(4, 50, 2, 14, '#4a4a4a');
  result += fillRect(5, 52, 1, 10, '#7a7a7a');
  result += fillRect(58, 50, 2, 14, '#4a4a4a');
  result += fillRect(59, 52, 1, 10, '#7a7a7a');

  // Shadow wisps
  result += pixel(cx - 22, 44, p.accent);
  result += pixel(cx - 20, 48, p.accent);
  result += pixel(cx + 21, 46, p.accent);
  result += pixel(cx + 19, 50, p.accent);

  // Dark outfit
  result += fillRect(cx - 14, 44, 28, 20, p.dark);
  result += fillRect(cx - 12, 46, 24, 18, p.mid);

  return createPortraitSvg(result);
}

function generatePalaceGuardPortrait() {
  const p = PALETTES.steelArmor;
  const gold = {
    dark: '#8b6914',
    mid: '#daa520',
    light: '#ffd700',
    highlight: '#ffee88'
  };
  let result = background('#2a2a30');
  const cx = 32;

  // Shoulder armor
  result += fillRect(4, 48, 18, 16, p.dark);
  result += fillRect(6, 50, 14, 14, p.mid);
  result += fillRect(8, 52, 10, 10, p.light);
  result += fillRect(42, 48, 18, 16, p.dark);
  result += fillRect(44, 50, 14, 14, p.mid);
  result += fillRect(46, 52, 10, 10, p.light);

  // Helmet
  result += pixelEllipse(cx, 26, 16, 22, p.dark);
  result += pixelEllipse(cx, 25, 15, 21, p.mid);
  result += pixelEllipse(cx, 24, 14, 20, p.light);
  result += pixelEllipse(cx, 22, 10, 14, p.highlight);

  // Golden crest
  result += fillRect(cx - 4, 0, 8, 12, gold.dark);
  result += fillRect(cx - 3, 2, 6, 8, gold.mid);
  result += fillRect(cx - 2, 4, 4, 4, gold.light);

  // Golden trim band
  result += fillRect(cx - 14, 12, 28, 4, gold.dark);
  result += fillRect(cx - 13, 13, 26, 2, gold.mid);

  // Visor slit
  result += fillRect(cx - 10, 28, 20, 3, p.dark);
  result += fillRect(cx - 8, 29, 16, 1, '#1a1a20');

  // Cheek guards
  result += fillRect(cx - 16, 30, 6, 14, p.mid);
  result += fillRect(cx - 15, 32, 4, 10, p.light);
  result += fillRect(cx + 10, 30, 6, 14, p.mid);
  result += fillRect(cx + 11, 32, 4, 10, p.light);

  // Gold rivets
  result += fillRect(cx - 14, 32, 3, 3, gold.mid);
  result += fillRect(cx + 11, 32, 3, 3, gold.mid);
  result += fillRect(cx - 13, 33, 1, 1, gold.light);
  result += fillRect(cx + 12, 33, 1, 1, gold.light);

  // Royal emblem on forehead
  result += fillRect(cx - 4, 18, 8, 8, gold.dark);
  result += fillRect(cx - 3, 19, 6, 6, gold.mid);
  result += fillRect(cx - 2, 20, 4, 4, gold.light);

  return createPortraitSvg(result);
}

module.exports = { generateEnemyPortraits };
