/**
 * Enemy Portrait Generators
 * Enhanced detailed portrait versions of all 16 enemy types
 * Using 5-tier palettes and texture patterns for visual depth
 */

const {
  createPortraitSvg,
  fillRect,
  pixel,
  pixelEllipse,
  background,
  furTexture,
  stoneTexture,
  clothTexture,
  ditherPattern,
  drawGlowingEyes,
  drawBeastFangs,
  drawClaws,
  drawHorns,
  drawBatWing,
  drawFeatheredWing,
  drawHelmet,
  drawShoulderArmor
} = require('./utils');

// ============================================================================
// ENEMY-SPECIFIC 5-TIER PALETTES
// ============================================================================

const ENEMY_PALETTES = {
  // Tier 1 - Forest
  goblin: {
    outline: '#1a2a1a',
    shadow: '#3a4a2a',
    base: '#5a7a4a',
    highlight: '#7a9a6a',
    bright: '#9aba8a'
  },
  wolf: {
    outline: '#1a1a20',
    shadow: '#3a3a40',
    base: '#5a5a60',
    highlight: '#7a7a80',
    bright: '#9a9aa0'
  },
  slime: {
    outline: '#1a4a3a',
    shadow: '#2a6a5a',
    base: '#4a9a7a',
    highlight: '#6aba9a',
    bright: '#8adaba'
  },

  // Tier 2 - Cave
  bat: {
    outline: '#1a0a10',
    shadow: '#3a2a30',
    base: '#5a4a50',
    highlight: '#7a6a70',
    bright: '#9a8a90'
  },
  spider: {
    outline: '#0a0808',
    shadow: '#2a1818',
    base: '#4a3030',
    highlight: '#6a4848',
    bright: '#8a6060'
  },
  bone: {
    outline: '#5a5040',
    shadow: '#7a7060',
    base: '#a09880',
    highlight: '#c8c0a8',
    bright: '#f0e8d8'
  },
  stone: {
    outline: '#3a3a30',
    shadow: '#5a5a4a',
    base: '#7a7a6a',
    highlight: '#9a9a8a',
    bright: '#babaa8'
  },

  // Tier 3 - Mountain
  troll: {
    outline: '#2a3a2a',
    shadow: '#4a5a3a',
    base: '#6a7a5a',
    highlight: '#8a9a7a',
    bright: '#aaba9a'
  },
  harpy: {
    outline: '#3a2a3a',
    shadow: '#5a4a5a',
    base: '#7a6a7a',
    highlight: '#9a8a9a',
    bright: '#baabba'
  },

  // Tier 4 - Bridge
  bandit: {
    outline: '#2a1a10',
    shadow: '#4a3020',
    base: '#6a4830',
    highlight: '#8a6040',
    bright: '#a07850'
  },
  bridgeTroll: {
    outline: '#1a2a2a',
    shadow: '#3a4a4a',
    base: '#5a6a6a',
    highlight: '#7a8a8a',
    bright: '#9aaaaa'
  },

  // Tier 5 - Palace
  darkArmor: {
    outline: '#0a0a10',
    shadow: '#1a1a25',
    base: '#2a2a35',
    highlight: '#3a3a45',
    bright: '#4a4a55'
  },
  royalArmor: {
    outline: '#3a3a40',
    shadow: '#5a5a60',
    base: '#7a7a80',
    highlight: '#9a9aa0',
    bright: '#babac0'
  },
  gold: {
    outline: '#6a4a10',
    shadow: '#8b6914',
    base: '#b08820',
    highlight: '#daa520',
    bright: '#ffd700'
  }
};

// Glow palettes for eyes
const GLOW_PALETTES = {
  red: { dark: '#400000', mid: '#aa0000', light: '#ff4444', bright: '#ff8888' },
  yellow: { dark: '#403000', mid: '#aa8800', light: '#ffcc00', bright: '#ffee66' },
  orange: { dark: '#401800', mid: '#aa4400', light: '#ff8800', bright: '#ffaa44' },
  purple: { dark: '#200040', mid: '#6600aa', light: '#aa44ff', bright: '#cc88ff' },
  green: { dark: '#004020', mid: '#00aa44', light: '#44ff88', bright: '#88ffaa' },
  blue: { dark: '#001040', mid: '#0044aa', light: '#4488ff', bright: '#88aaff' }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function drawWarPaint(cx, y, color) {
  let result = '';
  // Diagonal stripes across cheeks
  result += fillRect(cx - 14, y, 3, 2, color);
  result += fillRect(cx - 12, y + 2, 3, 2, color);
  result += fillRect(cx - 10, y + 4, 3, 2, color);
  result += fillRect(cx + 7, y, 3, 2, color);
  result += fillRect(cx + 9, y + 2, 3, 2, color);
  result += fillRect(cx + 11, y + 4, 3, 2, color);
  return result;
}

function drawScar(x, y, length, color) {
  let result = '';
  result += fillRect(x, y, 2, length, color);
  result += pixel(x - 1, y + 2, color);
  result += pixel(x + 2, y + length - 2, color);
  return result;
}

function drawRunes(x, y, w, h, color) {
  let result = '';
  // Simple rune patterns
  result += fillRect(x + 2, y + 2, 1, h - 4, color);
  result += fillRect(x + 2, y + 2, 3, 1, color);
  result += fillRect(x + w - 5, y + 3, 1, h - 6, color);
  result += fillRect(x + w - 6, y + h - 4, 3, 1, color);
  return result;
}

function drawParticles(cx, y, count, color) {
  let result = '';
  const positions = [
    [-12, -4], [10, -6], [-8, 8], [14, 4], [-6, -8], [8, 10]
  ];
  for (let i = 0; i < Math.min(count, positions.length); i++) {
    result += pixel(cx + positions[i][0], y + positions[i][1], color);
  }
  return result;
}

// ============================================================================
// TIER 1 - FOREST ENEMIES
// ============================================================================

function generateGoblinWarriorPortrait() {
  const p = ENEMY_PALETTES.goblin;
  let result = background('#1a2a1a');
  const cx = 32;

  // Crude iron helmet
  result += fillRect(cx - 14, 8, 28, 16, '#3a3a30');
  result += fillRect(cx - 13, 9, 26, 14, '#4a4a40');
  result += fillRect(cx - 12, 10, 24, 12, '#5a5a50');
  // Helmet nose guard
  result += fillRect(cx - 2, 22, 4, 10, '#4a4a40');
  result += fillRect(cx - 1, 23, 2, 8, '#5a5a50');

  // Neck with armor collar
  result += fillRect(cx - 6, 48, 12, 16, p.shadow);
  result += fillRect(cx - 5, 49, 10, 14, p.base);

  // Head shape
  result += pixelEllipse(cx, 30, 15, 17, p.outline);
  result += pixelEllipse(cx, 29, 14, 16, p.shadow);
  result += pixelEllipse(cx, 28, 13, 15, p.base);

  // Pointed ears (larger, more prominent)
  result += fillRect(cx - 22, 20, 8, 12, p.shadow);
  result += fillRect(cx - 24, 16, 6, 10, p.base);
  result += fillRect(cx - 25, 12, 3, 6, p.highlight);
  result += fillRect(cx + 14, 20, 8, 12, p.shadow);
  result += fillRect(cx + 18, 16, 6, 10, p.base);
  result += fillRect(cx + 22, 12, 3, 6, p.highlight);

  // War paint
  result += drawWarPaint(cx, 26, '#8b0000');

  // Eyes (large, yellow, menacing)
  result += fillRect(cx - 10, 24, 7, 8, '#1a1a10');
  result += fillRect(cx + 3, 24, 7, 8, '#1a1a10');
  result += fillRect(cx - 9, 25, 5, 6, '#daa520');
  result += fillRect(cx + 4, 25, 5, 6, '#daa520');
  result += fillRect(cx - 8, 26, 3, 4, '#ffd700');
  result += fillRect(cx + 5, 26, 3, 4, '#ffd700');
  result += pixel(cx - 8, 25, '#ffee88');
  result += pixel(cx + 5, 25, '#ffee88');
  // Angry brow
  result += fillRect(cx - 10, 22, 6, 2, p.shadow);
  result += fillRect(cx + 4, 22, 6, 2, p.shadow);

  // Nose (large, flat)
  result += fillRect(cx - 4, 32, 8, 6, p.shadow);
  result += fillRect(cx - 3, 33, 6, 4, p.base);
  result += fillRect(cx - 2, 36, 2, 2, p.outline);
  result += fillRect(cx + 1, 36, 2, 2, p.outline);

  // Mouth with fangs
  result += fillRect(cx - 7, 40, 14, 4, '#2a1a10');
  result += fillRect(cx - 6, 38, 2, 5, '#f0e8d8');
  result += fillRect(cx + 4, 38, 2, 5, '#f0e8d8');

  // Weapon scar on face
  result += drawScar(cx + 8, 28, 8, '#5a4030');

  // Crude shoulder armor
  result += fillRect(cx - 20, 52, 14, 12, '#4a4a3a');
  result += fillRect(cx - 19, 53, 12, 10, '#5a5a4a');
  result += fillRect(cx + 6, 52, 14, 12, '#4a4a3a');
  result += fillRect(cx + 7, 53, 12, 10, '#5a5a4a');

  // Sword handle visible
  result += fillRect(cx + 18, 44, 4, 20, '#5a4030');
  result += fillRect(cx + 19, 46, 2, 16, '#7a6050');
  result += fillRect(cx + 17, 42, 8, 3, '#4a4a4a');

  return createPortraitSvg(result);
}

function generateGrayWolfPortrait() {
  const p = ENEMY_PALETTES.wolf;
  let result = background('#1a1a20');
  const cx = 32;

  // Fur body/chest with texture
  result += furTexture(cx - 18, 50, 36, 14, p);

  // Head shape (wolf snout)
  result += pixelEllipse(cx, 28, 18, 20, p.outline);
  result += pixelEllipse(cx, 27, 17, 19, p.shadow);
  result += pixelEllipse(cx, 26, 16, 18, p.base);
  result += pixelEllipse(cx, 24, 12, 14, p.highlight);

  // Fur texture on head
  result += furTexture(cx - 10, 10, 20, 8, p);

  // Ears (alert, pointed)
  result += fillRect(cx - 18, 2, 10, 16, p.outline);
  result += fillRect(cx - 17, 3, 8, 14, p.shadow);
  result += fillRect(cx - 16, 4, 6, 12, p.base);
  result += fillRect(cx - 15, 5, 4, 8, '#c09070'); // Inner ear

  result += fillRect(cx + 8, 2, 10, 16, p.outline);
  result += fillRect(cx + 9, 3, 8, 14, p.shadow);
  result += fillRect(cx + 10, 4, 6, 12, p.base);
  result += fillRect(cx + 11, 5, 4, 8, '#c09070');

  // Snout with fur detail
  result += pixelEllipse(cx, 38, 11, 9, p.shadow);
  result += pixelEllipse(cx, 37, 10, 8, p.base);
  result += pixelEllipse(cx, 36, 9, 7, p.highlight);
  result += pixelEllipse(cx, 35, 8, 6, p.bright);

  // Wet nose
  result += fillRect(cx - 4, 32, 8, 5, '#1a1a1a');
  result += fillRect(cx - 3, 33, 6, 3, '#2a2a2a');
  result += pixel(cx - 2, 33, '#4a4a4a');
  result += pixel(cx + 1, 33, '#4a4a4a');

  // Fierce eyes (yellow predator)
  result += drawGlowingEyes(cx, 24, 16, GLOW_PALETTES.yellow, 'medium');

  // Snarl - exposed teeth
  result += fillRect(cx - 8, 42, 16, 4, '#1a1a1a');
  result += fillRect(cx - 6, 42, 2, 3, '#f0e8d8');
  result += fillRect(cx - 3, 42, 2, 2, '#f0e8d8');
  result += fillRect(cx + 1, 42, 2, 2, '#f0e8d8');
  result += fillRect(cx + 4, 42, 2, 3, '#f0e8d8');

  // Chest fur detail (white patch)
  result += fillRect(cx - 8, 52, 16, 12, p.bright);
  result += fillRect(cx - 6, 54, 12, 10, '#e8e8e8');

  // Fur tufts
  result += fillRect(cx - 20, 34, 4, 6, p.highlight);
  result += fillRect(cx + 16, 34, 4, 6, p.highlight);

  return createPortraitSvg(result);
}

function generateForestSlimePortrait() {
  const p = ENEMY_PALETTES.slime;
  let result = background('#1a2a2a');
  const cx = 32;

  // Main body blob (translucent effect with multiple layers)
  result += pixelEllipse(cx, 38, 26, 24, p.outline);
  result += pixelEllipse(cx, 37, 25, 23, p.shadow);
  result += pixelEllipse(cx, 36, 24, 22, p.base);
  result += pixelEllipse(cx, 34, 20, 18, p.highlight);

  // Inner glow/core
  result += pixelEllipse(cx, 32, 12, 10, p.bright);

  // Top bulge (pseudopod)
  result += pixelEllipse(cx - 6, 16, 14, 12, p.shadow);
  result += pixelEllipse(cx - 6, 15, 13, 11, p.base);
  result += pixelEllipse(cx - 6, 14, 12, 10, p.highlight);
  result += pixelEllipse(cx - 6, 12, 8, 6, p.bright);

  // Major shine highlights
  result += pixelEllipse(cx - 12, 12, 6, 4, p.bright);
  result += fillRect(cx - 14, 10, 5, 4, '#ffffff');
  result += pixel(cx - 12, 9, '#ffffff');

  // Secondary shines
  result += fillRect(cx + 10, 20, 6, 5, p.bright);
  result += fillRect(cx + 11, 21, 3, 3, '#ffffff');
  result += fillRect(cx - 18, 28, 4, 3, p.bright);

  // Particles inside body
  result += pixel(cx - 8, 28, p.outline);
  result += pixel(cx + 6, 32, p.outline);
  result += pixel(cx - 4, 38, p.outline);
  result += pixel(cx + 10, 26, p.outline);

  // Eyes (cute but slightly menacing)
  result += fillRect(cx - 12, 28, 10, 12, '#1a2a2a');
  result += fillRect(cx + 2, 28, 10, 12, '#1a2a2a');
  result += fillRect(cx - 11, 29, 8, 10, '#2a3a3a');
  result += fillRect(cx + 3, 29, 8, 10, '#2a3a3a');
  // Eye shine
  result += fillRect(cx - 10, 30, 4, 4, '#ffffff');
  result += fillRect(cx + 4, 30, 4, 4, '#ffffff');
  result += pixel(cx - 9, 31, '#ffffff');
  result += pixel(cx + 5, 31, '#ffffff');

  // Dripping tendrils at bottom
  result += fillRect(cx - 10, 56, 5, 8, p.base);
  result += fillRect(cx - 9, 58, 3, 6, p.highlight);
  result += fillRect(cx + 5, 58, 4, 6, p.base);
  result += fillRect(cx + 6, 60, 2, 4, p.highlight);
  result += fillRect(cx - 2, 54, 3, 10, p.base);
  result += fillRect(cx - 1, 56, 1, 8, p.highlight);

  // Small bubbles
  result += pixelEllipse(cx + 14, 42, 3, 3, p.highlight);
  result += pixel(cx + 13, 41, '#ffffff');

  return createPortraitSvg(result);
}

// ============================================================================
// TIER 2 - CAVE ENEMIES
// ============================================================================

function generateCaveBatPortrait() {
  const p = ENEMY_PALETTES.bat;
  let result = background('#0a0a10');
  const cx = 32;

  // Wings spread behind with membrane detail
  result += drawBatWing(2, 18, 'left', { dark: p.outline, mid: p.shadow, light: p.base });
  result += drawBatWing(62, 18, 'right', { dark: p.outline, mid: p.shadow, light: p.base });

  // Body
  result += pixelEllipse(cx, 40, 14, 20, p.outline);
  result += pixelEllipse(cx, 39, 13, 19, p.shadow);
  result += pixelEllipse(cx, 38, 12, 18, p.base);

  // Head
  result += pixelEllipse(cx, 22, 14, 14, p.outline);
  result += pixelEllipse(cx, 21, 13, 13, p.shadow);
  result += pixelEllipse(cx, 20, 12, 12, p.base);
  result += pixelEllipse(cx, 18, 8, 8, p.highlight);

  // Large pointed ears
  result += fillRect(cx - 16, 2, 10, 16, p.outline);
  result += fillRect(cx - 18, 0, 8, 12, p.shadow);
  result += fillRect(cx - 15, 3, 8, 14, p.shadow);
  result += fillRect(cx - 14, 4, 6, 12, p.base);
  result += fillRect(cx - 13, 6, 4, 8, '#c09070'); // Inner ear

  result += fillRect(cx + 6, 2, 10, 16, p.outline);
  result += fillRect(cx + 10, 0, 8, 12, p.shadow);
  result += fillRect(cx + 7, 3, 8, 14, p.shadow);
  result += fillRect(cx + 8, 4, 6, 12, p.base);
  result += fillRect(cx + 9, 6, 4, 8, '#c09070');

  // Glowing red eyes
  result += drawGlowingEyes(cx, 20, 12, GLOW_PALETTES.red, 'medium');

  // Nose (leaf-shaped, bat-like)
  result += fillRect(cx - 3, 24, 6, 4, p.outline);
  result += fillRect(cx - 2, 25, 4, 2, p.shadow);

  // Prominent fangs
  result += drawBeastFangs(cx, 28, 5, 6);

  // Ultrasonic screech effect (sound waves)
  result += pixel(cx - 18, 26, p.highlight);
  result += pixel(cx - 20, 28, p.base);
  result += pixel(cx - 22, 30, p.shadow);
  result += pixel(cx + 17, 26, p.highlight);
  result += pixel(cx + 19, 28, p.base);
  result += pixel(cx + 21, 30, p.shadow);

  // Claws on wing tips
  result += drawClaws(6, 46, 2, 'down');
  result += drawClaws(52, 46, 2, 'down');

  return createPortraitSvg(result);
}

function generateGiantSpiderPortrait() {
  const p = ENEMY_PALETTES.spider;
  let result = background('#0a0808');
  const cx = 32;

  // Leg hints on sides with hair texture
  for (let i = 0; i < 3; i++) {
    const ly = 26 + i * 10;
    result += fillRect(0, ly, 14, 4, p.outline);
    result += fillRect(2, ly + 1, 10, 2, p.shadow);
    // Hair on legs
    result += pixel(4, ly, p.base);
    result += pixel(8, ly, p.base);
    result += pixel(6, ly + 3, p.base);

    result += fillRect(50, ly, 14, 4, p.outline);
    result += fillRect(52, ly + 1, 10, 2, p.shadow);
    result += pixel(54, ly, p.base);
    result += pixel(58, ly, p.base);
    result += pixel(56, ly + 3, p.base);
  }

  // Abdomen hint (hairy texture)
  result += pixelEllipse(cx, 56, 18, 10, p.outline);
  result += pixelEllipse(cx, 55, 16, 8, p.shadow);
  // Hair texture on abdomen
  for (let i = 0; i < 6; i++) {
    result += pixel(cx - 12 + i * 5, 52, p.base);
    result += pixel(cx - 10 + i * 4, 58, p.base);
  }

  // Cephalothorax (main body/head)
  result += pixelEllipse(cx, 30, 22, 24, p.outline);
  result += pixelEllipse(cx, 29, 21, 23, p.shadow);
  result += pixelEllipse(cx, 28, 20, 22, p.base);
  result += pixelEllipse(cx, 26, 16, 18, p.highlight);

  // Hair texture on body
  for (let i = 0; i < 8; i++) {
    result += pixel(cx - 14 + i * 4, 14 + (i % 3) * 2, p.bright);
  }

  // 8 Eyes arrangement (proper cluster)
  // Main pair (large)
  result += fillRect(cx - 9, 22, 8, 10, '#1a0000');
  result += fillRect(cx + 1, 22, 8, 10, '#1a0000');
  result += fillRect(cx - 8, 23, 6, 8, GLOW_PALETTES.red.mid);
  result += fillRect(cx + 2, 23, 6, 8, GLOW_PALETTES.red.mid);
  result += fillRect(cx - 7, 24, 4, 5, GLOW_PALETTES.red.light);
  result += fillRect(cx + 3, 24, 4, 5, GLOW_PALETTES.red.light);
  result += pixel(cx - 6, 25, GLOW_PALETTES.red.bright);
  result += pixel(cx + 4, 25, GLOW_PALETTES.red.bright);

  // Secondary pair (medium, above main)
  result += fillRect(cx - 14, 18, 5, 5, '#1a0000');
  result += fillRect(cx + 9, 18, 5, 5, '#1a0000');
  result += fillRect(cx - 13, 19, 3, 3, GLOW_PALETTES.red.mid);
  result += fillRect(cx + 10, 19, 3, 3, GLOW_PALETTES.red.mid);

  // Top row (small, 4 eyes)
  result += fillRect(cx - 8, 14, 4, 4, '#1a0000');
  result += fillRect(cx - 2, 12, 4, 4, '#1a0000');
  result += fillRect(cx + 4, 14, 4, 4, '#1a0000');
  result += fillRect(cx - 7, 15, 2, 2, GLOW_PALETTES.red.mid);
  result += fillRect(cx - 1, 13, 2, 2, GLOW_PALETTES.red.mid);
  result += fillRect(cx + 5, 15, 2, 2, GLOW_PALETTES.red.mid);

  // Mandibles/Chelicerae (larger, more menacing)
  result += fillRect(cx - 10, 36, 6, 16, p.outline);
  result += fillRect(cx + 4, 36, 6, 16, p.outline);
  result += fillRect(cx - 9, 37, 4, 14, p.shadow);
  result += fillRect(cx + 5, 37, 4, 14, p.shadow);
  result += fillRect(cx - 8, 38, 2, 12, p.base);
  result += fillRect(cx + 6, 38, 2, 12, p.base);

  // Fang tips (venomous)
  result += fillRect(cx - 8, 50, 3, 5, p.highlight);
  result += fillRect(cx + 5, 50, 3, 5, p.highlight);
  result += pixel(cx - 7, 54, '#8aff8a'); // Venom drip
  result += pixel(cx + 6, 54, '#8aff8a');

  return createPortraitSvg(result);
}

function generateSkeletonWarriorPortrait() {
  const p = ENEMY_PALETTES.bone;
  let result = background('#1a1a20');
  const cx = 32;

  // Rusted armor fragments on shoulders
  result += fillRect(cx - 22, 50, 16, 14, '#4a3020');
  result += fillRect(cx - 21, 51, 14, 12, '#5a4030');
  result += fillRect(cx - 20, 52, 6, 4, '#6a5040');
  result += fillRect(cx + 6, 50, 16, 14, '#4a3020');
  result += fillRect(cx + 7, 51, 14, 12, '#5a4030');
  result += fillRect(cx + 12, 52, 6, 4, '#6a5040');

  // Neck vertebrae
  result += fillRect(cx - 4, 44, 8, 20, p.outline);
  result += fillRect(cx - 3, 46, 6, 16, p.shadow);
  result += fillRect(cx - 2, 48, 4, 5, p.base);
  result += fillRect(cx - 2, 54, 4, 5, p.base);
  result += fillRect(cx - 2, 60, 4, 4, p.base);

  // Skull with cracks
  result += pixelEllipse(cx, 26, 17, 21, p.outline);
  result += pixelEllipse(cx, 25, 16, 20, p.shadow);
  result += pixelEllipse(cx, 24, 15, 19, p.base);
  result += pixelEllipse(cx, 22, 12, 15, p.highlight);

  // Skull cracks
  result += fillRect(cx - 10, 10, 2, 14, p.outline);
  result += fillRect(cx - 8, 8, 1, 4, p.outline);
  result += fillRect(cx + 6, 14, 2, 10, p.outline);
  result += fillRect(cx + 8, 18, 1, 6, p.outline);
  result += fillRect(cx - 2, 6, 1, 8, p.outline);

  // Eye sockets (hollow with glow)
  result += fillRect(cx - 11, 20, 9, 11, p.outline);
  result += fillRect(cx + 2, 20, 9, 11, p.outline);
  result += fillRect(cx - 10, 21, 7, 9, '#1a1a20');
  result += fillRect(cx + 3, 21, 7, 9, '#1a1a20');

  // Eye glow
  result += drawGlowingEyes(cx, 25, 14, GLOW_PALETTES.purple, 'small');

  // Nasal cavity
  result += fillRect(cx - 2, 32, 4, 7, p.outline);
  result += fillRect(cx - 1, 33, 2, 5, '#1a1a20');

  // Teeth (more detailed)
  result += fillRect(cx - 9, 40, 18, 5, p.bright);
  for (let i = 0; i < 6; i++) {
    result += fillRect(cx - 8 + i * 3, 41, 1, 3, p.outline);
  }

  // Sword behind with rust
  result += fillRect(4, 54, 5, 10, '#3a3030'); // Handle
  result += fillRect(5, 52, 3, 8, '#4a4040');
  result += fillRect(5, 8, 3, 46, '#4a4a4a'); // Blade
  result += fillRect(6, 10, 1, 42, '#6a6a6a');
  // Rust spots
  result += pixel(5, 20, '#6a4030');
  result += pixel(7, 30, '#6a4030');
  result += pixel(6, 40, '#5a3020');

  // Crossguard
  result += fillRect(1, 48, 12, 5, '#6a5020');
  result += fillRect(2, 49, 10, 3, '#8a7030');

  return createPortraitSvg(result);
}

function generateStoneGolemPortrait() {
  const p = ENEMY_PALETTES.stone;
  let result = background('#2a2a20');
  const cx = 32;

  // Shoulder/body mass with stone texture
  result += stoneTexture(4, 46, 56, 18, p, 0);

  // Angular rocky head
  result += fillRect(cx - 18, 6, 36, 42, p.outline);
  result += fillRect(cx - 17, 8, 34, 38, p.shadow);
  result += fillRect(cx - 16, 10, 32, 34, p.base);
  result += fillRect(cx - 14, 12, 28, 28, p.highlight);

  // Major cracks
  result += fillRect(cx - 12, 12, 2, 16, p.outline);
  result += fillRect(cx - 10, 14, 1, 4, p.outline);
  result += fillRect(cx + 8, 16, 2, 20, p.outline);
  result += fillRect(cx + 10, 22, 1, 8, p.outline);
  result += fillRect(cx - 14, 28, 10, 2, p.outline);
  result += fillRect(cx + 6, 32, 12, 2, p.outline);

  // Glowing rune inscriptions
  result += drawRunes(cx - 6, 8, 12, 16, '#ffaa00');

  // Moss growth (green patches)
  result += fillRect(cx - 16, 38, 6, 4, '#3a5a3a');
  result += fillRect(cx - 15, 39, 4, 2, '#4a6a4a');
  result += fillRect(cx + 12, 42, 5, 3, '#3a5a3a');

  // Glowing eyes
  result += drawGlowingEyes(cx, 24, 18, GLOW_PALETTES.orange, 'large');

  // Additional eye glow effect
  result += pixel(cx - 14, 22, GLOW_PALETTES.orange.light);
  result += pixel(cx + 13, 22, GLOW_PALETTES.orange.light);

  // Mouth crack
  result += fillRect(cx - 10, 38, 20, 5, p.outline);
  result += fillRect(cx - 8, 36, 2, 2, p.outline);
  result += fillRect(cx + 6, 36, 2, 2, p.outline);
  // Inner glow in mouth
  result += fillRect(cx - 8, 39, 16, 2, GLOW_PALETTES.orange.dark);

  return createPortraitSvg(result);
}

// ============================================================================
// TIER 3 - MOUNTAIN ENEMIES
// ============================================================================

function generateMountainTrollPortrait() {
  const p = ENEMY_PALETTES.troll;
  let result = background('#2a3a2a');
  const cx = 32;

  // Thick neck/shoulders
  result += fillRect(2, 48, 60, 16, p.outline);
  result += fillRect(4, 50, 56, 14, p.shadow);
  result += fillRect(6, 52, 52, 12, p.base);

  // Large brutish head
  result += pixelEllipse(cx, 28, 24, 26, p.outline);
  result += pixelEllipse(cx, 27, 23, 25, p.shadow);
  result += pixelEllipse(cx, 26, 22, 24, p.base);
  result += pixelEllipse(cx, 24, 18, 20, p.highlight);

  // Heavy brow (more prominent)
  result += fillRect(cx - 22, 16, 44, 8, p.outline);
  result += fillRect(cx - 21, 17, 42, 6, p.shadow);
  result += fillRect(cx - 20, 18, 40, 4, p.base);

  // Warts/bumps texture
  result += pixelEllipse(cx - 16, 20, 3, 3, p.shadow);
  result += pixelEllipse(cx + 14, 22, 3, 3, p.shadow);
  result += pixelEllipse(cx - 8, 36, 2, 2, p.shadow);
  result += pixelEllipse(cx + 12, 34, 2, 2, p.shadow);
  result += pixel(cx - 14, 32, p.highlight);
  result += pixel(cx + 10, 30, p.highlight);

  // Ears
  result += fillRect(cx - 26, 22, 7, 12, p.shadow);
  result += fillRect(cx - 25, 23, 5, 10, p.base);
  result += fillRect(cx - 24, 25, 3, 6, p.highlight);
  result += fillRect(cx + 19, 22, 7, 12, p.shadow);
  result += fillRect(cx + 20, 23, 5, 10, p.base);
  result += fillRect(cx + 21, 25, 3, 6, p.highlight);

  // Small angry eyes
  result += fillRect(cx - 14, 24, 8, 6, '#1a1a1a');
  result += fillRect(cx + 6, 24, 8, 6, '#1a1a1a');
  result += fillRect(cx - 13, 25, 6, 4, '#884400');
  result += fillRect(cx + 7, 25, 6, 4, '#884400');
  result += fillRect(cx - 12, 26, 4, 2, '#aa6600');
  result += fillRect(cx + 8, 26, 4, 2, '#aa6600');

  // Big nose
  result += fillRect(cx - 6, 30, 12, 10, p.shadow);
  result += fillRect(cx - 5, 31, 10, 8, p.base);
  result += fillRect(cx - 4, 36, 3, 4, p.outline);
  result += fillRect(cx + 1, 36, 3, 4, p.outline);

  // Large tusks
  result += fillRect(cx - 14, 40, 5, 14, '#e0d0b8');
  result += fillRect(cx - 16, 48, 4, 10, '#e0d0b8');
  result += fillRect(cx - 13, 41, 3, 12, '#f0e8d8');
  result += pixel(cx - 14, 53, '#ffffff');

  result += fillRect(cx + 9, 40, 5, 14, '#e0d0b8');
  result += fillRect(cx + 12, 48, 4, 10, '#e0d0b8');
  result += fillRect(cx + 10, 41, 3, 12, '#f0e8d8');
  result += pixel(cx + 13, 53, '#ffffff');

  return createPortraitSvg(result);
}

function generateTrollShamanPortrait() {
  const p = ENEMY_PALETTES.troll;
  const magic = GLOW_PALETTES.purple;
  let result = background('#2a2a3a');
  const cx = 32;

  // Staff on side
  result += fillRect(52, 0, 5, 64, '#4a3020');
  result += fillRect(53, 2, 3, 60, '#6a5040');

  // Magic orb on staff
  result += pixelEllipse(54, 10, 9, 9, magic.dark);
  result += pixelEllipse(54, 9, 8, 8, magic.mid);
  result += pixelEllipse(54, 8, 7, 7, magic.light);
  result += pixelEllipse(54, 6, 4, 4, magic.bright);
  result += fillRect(52, 4, 4, 4, '#ffffff');

  // Arcane symbols around orb
  result += pixel(46, 6, magic.light);
  result += pixel(48, 10, magic.mid);
  result += pixel(44, 12, magic.light);
  result += pixel(60, 8, magic.mid);
  result += pixel(62, 12, magic.light);

  // Body with bone decorations
  result += fillRect(6, 50, 42, 14, p.shadow);
  result += fillRect(8, 52, 38, 12, p.base);

  // Bone necklace
  result += fillRect(cx - 18, 48, 5, 4, '#e0d8c8');
  result += fillRect(cx - 11, 50, 4, 4, '#e0d8c8');
  result += fillRect(cx - 4, 48, 5, 4, '#e0d8c8');
  result += fillRect(cx + 3, 50, 4, 4, '#e0d8c8');
  result += fillRect(cx + 10, 48, 5, 4, '#e0d8c8');

  // Smaller wiser head
  result += pixelEllipse(cx - 4, 30, 19, 21, p.outline);
  result += pixelEllipse(cx - 4, 29, 18, 20, p.shadow);
  result += pixelEllipse(cx - 4, 28, 17, 19, p.base);
  result += pixelEllipse(cx - 4, 26, 14, 16, p.highlight);

  // Wise squinting eyes with magic glow
  result += fillRect(cx - 16, 26, 10, 4, p.outline);
  result += fillRect(cx - 2, 26, 10, 4, p.outline);
  result += fillRect(cx - 15, 27, 8, 2, magic.mid);
  result += fillRect(cx - 1, 27, 8, 2, magic.mid);
  result += pixel(cx - 14, 27, magic.light);
  result += pixel(cx, 27, magic.light);

  // Big nose
  result += fillRect(cx - 9, 32, 8, 6, p.shadow);
  result += fillRect(cx - 8, 33, 6, 4, p.base);
  result += fillRect(cx - 7, 36, 2, 2, p.outline);
  result += fillRect(cx - 4, 36, 2, 2, p.outline);

  // Small tusks
  result += fillRect(cx - 14, 40, 3, 8, '#f0e8d8');
  result += fillRect(cx, 40, 3, 8, '#f0e8d8');

  // Spiritual aura particles
  result += drawParticles(cx - 4, 20, 6, magic.light);

  // Feathers in hair
  result += fillRect(cx - 18, 10, 3, 12, '#aa4444');
  result += fillRect(cx - 17, 12, 1, 8, '#cc6666');
  result += fillRect(cx + 8, 8, 3, 14, '#4444aa');
  result += fillRect(cx + 9, 10, 1, 10, '#6666cc');

  return createPortraitSvg(result);
}

function generateHarpyPortrait() {
  const p = ENEMY_PALETTES.harpy;
  const skin = { outline: '#7a5a4a', shadow: '#9a7a6a', base: '#ba9a8a', highlight: '#dabab0', bright: '#f0d8d0' };
  let result = background('#3a3a4a');
  const cx = 32;

  // Feathered wings on sides with layered feathers
  result += drawFeatheredWing(2, 22, 'left', { dark: p.outline, mid: p.shadow, light: p.base, highlight: p.highlight });
  result += drawFeatheredWing(62, 22, 'right', { dark: p.outline, mid: p.shadow, light: p.base, highlight: p.highlight });

  // Feathered head/hair
  result += fillRect(cx - 18, 2, 36, 20, p.outline);
  result += fillRect(cx - 16, 4, 32, 16, p.shadow);
  result += fillRect(cx - 14, 6, 28, 12, p.base);
  result += fillRect(cx - 12, 8, 24, 8, p.highlight);

  // Head feathers (plume)
  result += fillRect(cx - 14, -2, 5, 10, p.shadow);
  result += fillRect(cx - 13, 0, 3, 6, p.base);
  result += fillRect(cx + 9, -2, 5, 10, p.shadow);
  result += fillRect(cx + 10, 0, 3, 6, p.base);
  result += fillRect(cx - 3, -4, 6, 12, p.highlight);
  result += fillRect(cx - 2, -2, 4, 8, p.bright);

  // Face
  result += pixelEllipse(cx, 32, 15, 17, skin.outline);
  result += pixelEllipse(cx, 31, 14, 16, skin.shadow);
  result += pixelEllipse(cx, 30, 13, 15, skin.base);
  result += pixelEllipse(cx, 28, 10, 12, skin.highlight);

  // Fierce eyes
  result += fillRect(cx - 9, 26, 7, 6, '#1a1a1a');
  result += fillRect(cx + 2, 26, 7, 6, '#1a1a1a');
  result += fillRect(cx - 8, 27, 5, 4, '#daa520');
  result += fillRect(cx + 3, 27, 5, 4, '#daa520');
  result += fillRect(cx - 7, 28, 3, 2, '#ffd700');
  result += fillRect(cx + 4, 28, 3, 2, '#ffd700');
  result += pixel(cx - 7, 27, '#ffffff');
  result += pixel(cx + 4, 27, '#ffffff');

  // Angry eyebrows
  result += fillRect(cx - 10, 24, 7, 2, skin.shadow);
  result += fillRect(cx + 3, 24, 7, 2, skin.shadow);

  // Sharp nose/beak hint
  result += fillRect(cx - 3, 34, 6, 8, skin.shadow);
  result += fillRect(cx - 2, 35, 4, 6, skin.base);
  result += fillRect(cx - 2, 40, 4, 3, '#4a3a2a');
  result += fillRect(cx - 1, 42, 2, 2, '#3a2a1a');

  // Mouth
  result += fillRect(cx - 5, 44, 10, 2, skin.shadow);

  // Talons visible at bottom
  result += drawClaws(8, 56, 3, 'down');
  result += drawClaws(48, 56, 3, 'down');

  return createPortraitSvg(result);
}

// ============================================================================
// TIER 4 - BRIDGE ENEMIES
// ============================================================================

function generateBridgeBanditPortrait() {
  const p = ENEMY_PALETTES.bandit;
  const skin = { outline: '#5a3a2a', shadow: '#8a6a4a', base: '#b0906a', highlight: '#d0b08a', bright: '#e8c8a8' };
  let result = background('#2a2a30');
  const cx = 32;

  // Hood
  result += fillRect(cx - 20, 2, 40, 26, p.outline);
  result += fillRect(cx - 18, 4, 36, 22, p.shadow);
  result += fillRect(cx - 16, 6, 32, 18, p.base);

  // Hood shadow
  result += fillRect(cx - 14, 16, 28, 10, '#1a1a20');

  // Face with visible details
  result += pixelEllipse(cx, 34, 13, 15, skin.outline);
  result += pixelEllipse(cx, 33, 12, 14, skin.shadow);
  result += pixelEllipse(cx, 32, 11, 13, skin.base);

  // Scar on face
  result += drawScar(cx + 4, 26, 10, '#aa7766');

  // Eyes in shadow of hood (menacing)
  result += fillRect(cx - 9, 26, 6, 5, '#1a1a20');
  result += fillRect(cx + 3, 26, 6, 5, '#1a1a20');
  result += fillRect(cx - 8, 27, 4, 3, '#888888');
  result += fillRect(cx + 4, 27, 4, 3, '#888888');
  result += pixel(cx - 7, 27, '#aaaaaa');
  result += pixel(cx + 5, 27, '#aaaaaa');

  // Mask/bandana over lower face
  result += fillRect(cx - 13, 32, 26, 16, '#3a2020');
  result += fillRect(cx - 12, 33, 24, 14, '#5a3030');
  result += fillRect(cx - 11, 34, 22, 12, '#4a2828');
  // Bandana knot
  result += fillRect(cx + 10, 36, 4, 6, '#3a2020');

  // Cloak with cloth texture
  result += clothTexture(cx - 18, 46, 36, 18, p);

  // Stolen jewelry hint (gold earring)
  result += fillRect(cx - 16, 30, 2, 3, '#daa520');
  result += pixel(cx - 16, 33, '#ffd700');

  // Dagger visible
  result += fillRect(cx + 16, 40, 3, 16, '#5a5a5a');
  result += fillRect(cx + 17, 42, 1, 12, '#8a8a8a');
  result += fillRect(cx + 15, 38, 5, 3, '#6a5020');
  result += fillRect(cx + 16, 39, 3, 1, '#8a7030');

  return createPortraitSvg(result);
}

function generateBanditCaptainPortrait() {
  const p = ENEMY_PALETTES.bandit;
  const skin = { outline: '#5a3a2a', shadow: '#8a6a4a', base: '#b0906a', highlight: '#d0b08a', bright: '#e8c8a8' };
  let result = background('#2a2a30');
  const cx = 32;

  // Fancy hat with more detail
  result += fillRect(cx - 20, 10, 40, 10, '#2a2a3a');
  result += fillRect(cx - 18, 11, 36, 8, '#3a3a4a');
  result += fillRect(cx - 16, 12, 32, 6, '#4a4a5a');

  // Hat top (wider, more impressive)
  result += fillRect(cx - 14, 2, 28, 12, '#2a2a3a');
  result += fillRect(cx - 12, 3, 24, 10, '#3a3a4a');
  result += fillRect(cx - 10, 4, 20, 8, '#4a4a5a');

  // Fancy feather
  result += fillRect(cx + 10, -2, 5, 18, '#aa2222');
  result += fillRect(cx + 11, 0, 3, 14, '#cc4444');
  result += fillRect(cx + 12, 2, 1, 10, '#ee6666');
  // Second smaller feather
  result += fillRect(cx + 8, 2, 3, 12, '#22aa22');
  result += fillRect(cx + 9, 4, 1, 8, '#44cc44');

  // Face
  result += pixelEllipse(cx, 34, 15, 17, skin.outline);
  result += pixelEllipse(cx, 33, 14, 16, skin.shadow);
  result += pixelEllipse(cx, 32, 13, 15, skin.base);
  result += pixelEllipse(cx, 30, 10, 12, skin.highlight);

  // Confident eyes
  result += fillRect(cx - 10, 28, 7, 6, '#ffffff');
  result += fillRect(cx + 3, 28, 7, 6, '#ffffff');
  result += fillRect(cx - 9, 29, 5, 4, '#4a3a2a');
  result += fillRect(cx + 4, 29, 5, 4, '#4a3a2a');
  result += pixel(cx - 8, 29, '#ffffff');
  result += pixel(cx + 5, 29, '#ffffff');

  // Arched eyebrows
  result += fillRect(cx - 10, 26, 7, 2, '#3a2a1a');
  result += fillRect(cx + 3, 26, 7, 2, '#3a2a1a');

  // Nose
  result += fillRect(cx - 2, 34, 4, 5, skin.shadow);
  result += fillRect(cx - 1, 35, 2, 3, skin.base);

  // Confident smirk with gold tooth
  result += fillRect(cx - 5, 42, 12, 3, '#4a2020');
  result += pixel(cx + 5, 41, '#4a2020');
  result += pixel(cx + 2, 42, '#ffd700'); // Gold tooth

  // Goatee
  result += fillRect(cx - 3, 44, 6, 8, '#3a2a1a');
  result += fillRect(cx - 2, 48, 4, 6, '#3a2a1a');
  result += fillRect(cx - 1, 52, 2, 4, '#3a2a1a');

  // Scar
  result += drawScar(cx + 8, 30, 8, '#aa7766');

  // Fine clothes with gold trim
  result += fillRect(cx - 16, 48, 32, 16, p.shadow);
  result += fillRect(cx - 14, 50, 28, 14, '#4a3030');
  result += fillRect(cx - 3, 48, 6, 16, '#8b6914'); // Gold trim
  result += fillRect(cx - 2, 50, 4, 14, '#daa520');

  // Gold ring on visible hand
  result += fillRect(cx - 18, 58, 4, 4, skin.base);
  result += pixel(cx - 17, 59, '#ffd700');

  return createPortraitSvg(result);
}

function generateBridgeTrollPortrait() {
  const p = ENEMY_PALETTES.bridgeTroll;
  let result = background('#1a2a2a');
  const cx = 32;

  // Massive shoulders (water-worn, darker)
  result += fillRect(-2, 44, 68, 20, p.outline);
  result += fillRect(0, 46, 64, 18, p.shadow);
  result += fillRect(2, 48, 60, 16, p.base);

  // Very large head
  result += pixelEllipse(cx, 26, 28, 28, p.outline);
  result += pixelEllipse(cx, 25, 27, 27, p.shadow);
  result += pixelEllipse(cx, 24, 26, 26, p.base);
  result += pixelEllipse(cx, 22, 22, 22, p.highlight);

  // Water-worn texture (smoother with algae)
  result += fillRect(cx - 20, 16, 8, 6, '#3a5a4a'); // Algae patch
  result += fillRect(cx + 14, 20, 6, 4, '#3a5a4a');
  result += fillRect(cx - 8, 38, 4, 3, '#3a5a4a');

  // Barnacles
  result += pixelEllipse(cx - 16, 32, 3, 3, '#6a6a5a');
  result += pixelEllipse(cx + 18, 28, 2, 2, '#6a6a5a');
  result += pixelEllipse(cx - 12, 44, 2, 2, '#6a6a5a');
  result += pixelEllipse(cx + 14, 42, 3, 3, '#6a6a5a');

  // Very heavy brow
  result += fillRect(cx - 26, 12, 52, 10, p.outline);
  result += fillRect(cx - 25, 13, 50, 8, p.shadow);
  result += fillRect(cx - 24, 14, 48, 6, p.base);

  // Tiny angry eyes
  result += fillRect(cx - 16, 22, 8, 5, '#1a1a1a');
  result += fillRect(cx + 8, 22, 8, 5, '#1a1a1a');
  result += fillRect(cx - 15, 23, 6, 3, '#664422');
  result += fillRect(cx + 9, 23, 6, 3, '#664422');
  result += pixel(cx - 14, 23, '#886644');
  result += pixel(cx + 10, 23, '#886644');

  // Huge nose
  result += fillRect(cx - 8, 28, 16, 12, p.shadow);
  result += fillRect(cx - 7, 29, 14, 10, p.base);
  result += fillRect(cx - 5, 36, 4, 4, p.outline);
  result += fillRect(cx + 1, 36, 4, 4, p.outline);

  // Massive tusks
  result += fillRect(cx - 16, 38, 6, 18, '#d0c8b8');
  result += fillRect(cx - 18, 48, 5, 14, '#d0c8b8');
  result += fillRect(cx - 15, 39, 4, 16, '#e0d8c8');
  result += pixel(cx - 17, 61, '#f0e8d8');

  result += fillRect(cx + 10, 38, 6, 18, '#d0c8b8');
  result += fillRect(cx + 13, 48, 5, 14, '#d0c8b8');
  result += fillRect(cx + 11, 39, 4, 16, '#e0d8c8');
  result += pixel(cx + 14, 61, '#f0e8d8');

  // Water dripping
  result += pixel(cx - 22, 50, '#6a9aba');
  result += pixel(cx - 22, 54, '#6a9aba');
  result += pixel(cx + 20, 52, '#6a9aba');

  return createPortraitSvg(result);
}

// ============================================================================
// TIER 5 - PALACE ENEMIES
// ============================================================================

function generateDarkKnightPortrait() {
  const p = ENEMY_PALETTES.darkArmor;
  let result = background('#0a0a10');
  const cx = 32;

  // Shoulder armor with ornate engravings
  result += drawShoulderArmor(cx, 46, 'plate', p);

  // Ornate engravings on shoulders
  result += fillRect(cx - 20, 50, 2, 8, GLOW_PALETTES.purple.dark);
  result += fillRect(cx - 18, 52, 1, 4, GLOW_PALETTES.purple.mid);
  result += fillRect(cx + 18, 50, 2, 8, GLOW_PALETTES.purple.dark);
  result += fillRect(cx + 19, 52, 1, 4, GLOW_PALETTES.purple.mid);

  // Helmet with dark style
  result += drawHelmet(cx, 6, 'dark', p);

  // Neck guard
  result += fillRect(cx - 12, 44, 24, 8, p.outline);
  result += fillRect(cx - 10, 45, 20, 6, p.shadow);
  result += fillRect(cx - 8, 46, 16, 4, p.base);

  // Dark aura effect (more prominent)
  result += pixel(cx - 20, 18, GLOW_PALETTES.purple.mid);
  result += pixel(cx - 22, 22, GLOW_PALETTES.purple.dark);
  result += pixel(cx - 18, 26, GLOW_PALETTES.purple.mid);
  result += pixel(cx + 19, 20, GLOW_PALETTES.purple.mid);
  result += pixel(cx + 21, 24, GLOW_PALETTES.purple.dark);
  result += pixel(cx + 17, 28, GLOW_PALETTES.purple.mid);
  result += pixel(cx - 16, 42, GLOW_PALETTES.purple.dark);
  result += pixel(cx + 15, 40, GLOW_PALETTES.purple.dark);

  // Wisp trails
  result += fillRect(cx - 24, 30, 3, 1, GLOW_PALETTES.purple.dark);
  result += fillRect(cx + 21, 32, 3, 1, GLOW_PALETTES.purple.dark);

  return createPortraitSvg(result);
}

function generateShadowAssassinPortrait() {
  const p = ENEMY_PALETTES.darkArmor;
  let result = background('#050508');
  const cx = 32;

  // Shadow tendrils (background effect)
  for (let i = 0; i < 8; i++) {
    const tx = 4 + i * 8;
    const ty = 50 + (i % 3) * 4;
    result += fillRect(tx, ty, 2, 14, '#0a0a10');
    result += fillRect(tx + 1, ty + 2, 1, 10, '#101018');
  }

  // Dark void body (barely visible)
  result += pixelEllipse(cx, 48, 18, 16, '#080810');
  result += pixelEllipse(cx, 47, 16, 14, '#0a0a12');

  // Hood (larger, more dramatic, merging with void)
  result += fillRect(cx - 22, 0, 44, 34, p.outline);
  result += fillRect(cx - 20, 2, 40, 30, p.shadow);
  result += fillRect(cx - 18, 4, 36, 26, p.base);
  result += fillRect(cx - 16, 6, 32, 22, p.highlight);

  // Deep hood shadow (absolute darkness)
  result += fillRect(cx - 14, 14, 28, 20, '#050508');

  // Face completely in shadow (only void)
  result += pixelEllipse(cx, 32, 12, 14, '#050508');

  // Glowing eyes (piercing through darkness)
  result += drawGlowingEyes(cx, 28, 14, GLOW_PALETTES.red, 'medium');

  // Additional eye glow (reflection in darkness)
  result += pixel(cx - 10, 26, GLOW_PALETTES.red.dark);
  result += pixel(cx + 9, 26, GLOW_PALETTES.red.dark);

  // Mask/scarf (barely visible)
  result += fillRect(cx - 12, 36, 24, 12, '#0a0a12');
  result += fillRect(cx - 10, 38, 20, 8, '#101018');

  // Visible daggers (crossed, more prominent)
  result += fillRect(2, 48, 3, 16, '#4a4a4a');
  result += fillRect(3, 50, 1, 12, '#6a6a6a');
  result += fillRect(4, 52, 1, 8, '#8a8a8a');
  result += fillRect(0, 46, 6, 3, '#3a3030');

  result += fillRect(59, 48, 3, 16, '#4a4a4a');
  result += fillRect(60, 50, 1, 12, '#6a6a6a');
  result += fillRect(59, 52, 1, 8, '#8a8a8a');
  result += fillRect(58, 46, 6, 3, '#3a3030');

  // Shadow wisps around figure
  result += pixel(cx - 24, 42, GLOW_PALETTES.purple.dark);
  result += pixel(cx - 26, 46, p.highlight);
  result += pixel(cx - 22, 50, GLOW_PALETTES.purple.dark);
  result += pixel(cx + 23, 44, GLOW_PALETTES.purple.dark);
  result += pixel(cx + 25, 48, p.highlight);
  result += pixel(cx + 21, 52, GLOW_PALETTES.purple.dark);

  // Particles of darkness
  result += pixel(cx - 8, 10, p.highlight);
  result += pixel(cx + 10, 8, p.highlight);
  result += pixel(cx - 12, 18, p.base);
  result += pixel(cx + 14, 16, p.base);

  // Dark outfit (barely visible form)
  result += fillRect(cx - 16, 44, 32, 20, '#080810');
  result += fillRect(cx - 14, 46, 28, 18, '#0a0a12');

  return createPortraitSvg(result);
}

function generatePalaceGuardPortrait() {
  const p = ENEMY_PALETTES.royalArmor;
  const gold = ENEMY_PALETTES.gold;
  let result = background('#2a2a30');
  const cx = 32;

  // Shoulder armor (polished, regal)
  result += drawShoulderArmor(cx, 48, 'plate', p);

  // Gold trim on shoulders
  result += fillRect(cx - 22, 50, 2, 10, gold.shadow);
  result += fillRect(cx - 21, 51, 1, 8, gold.base);
  result += fillRect(cx + 20, 50, 2, 10, gold.shadow);
  result += fillRect(cx + 21, 51, 1, 8, gold.base);

  // Guard helmet
  result += drawHelmet(cx, 4, 'guard', p);

  // Golden trim band (more prominent)
  result += fillRect(cx - 15, 16, 30, 5, gold.shadow);
  result += fillRect(cx - 14, 17, 28, 3, gold.base);
  result += fillRect(cx - 12, 18, 24, 1, gold.highlight);

  // Visor slit (stern eyes visible)
  result += fillRect(cx - 11, 30, 22, 4, p.outline);
  result += fillRect(cx - 9, 31, 18, 2, '#1a1a20');
  // Eyes behind visor
  result += fillRect(cx - 7, 31, 4, 2, '#4a3020');
  result += fillRect(cx + 3, 31, 4, 2, '#4a3020');
  result += pixel(cx - 6, 31, '#ffffff');
  result += pixel(cx + 4, 31, '#ffffff');

  // Golden rivets
  result += fillRect(cx - 15, 34, 4, 4, gold.shadow);
  result += fillRect(cx - 14, 35, 2, 2, gold.base);
  result += pixel(cx - 13, 35, gold.highlight);
  result += fillRect(cx + 11, 34, 4, 4, gold.shadow);
  result += fillRect(cx + 12, 35, 2, 2, gold.base);
  result += pixel(cx + 13, 35, gold.highlight);

  // Royal emblem on forehead (more detailed)
  result += fillRect(cx - 5, 20, 10, 10, gold.outline);
  result += fillRect(cx - 4, 21, 8, 8, gold.shadow);
  result += fillRect(cx - 3, 22, 6, 6, gold.base);
  result += fillRect(cx - 2, 23, 4, 4, gold.highlight);
  result += pixel(cx, 24, gold.bright);

  // Neck guard with gold trim
  result += fillRect(cx - 10, 42, 20, 8, p.shadow);
  result += fillRect(cx - 8, 43, 16, 6, p.base);
  result += fillRect(cx - 6, 44, 12, 2, gold.shadow);
  result += fillRect(cx - 5, 44, 10, 1, gold.base);

  // Polished armor shine
  result += pixel(cx - 8, 26, '#ffffff');
  result += pixel(cx + 6, 28, '#ffffff');
  result += pixel(cx - 12, 52, '#ffffff');
  result += pixel(cx + 14, 54, '#ffffff');

  return createPortraitSvg(result);
}

// ============================================================================
// EXPORTS
// ============================================================================

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

module.exports = { generateEnemyPortraits, ENEMY_PALETTES, GLOW_PALETTES };
