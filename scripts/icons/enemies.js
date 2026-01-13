/**
 * Enemy Icon Generators
 * Programmatic SVG generation for all 16 enemy types
 */

const {
  PALETTES,
  createSvg,
  shadow,
  layeredEllipse,
  skull,
  sword,
  eyes,
  glowingEyes,
  pointedEars,
  batWings,
  helmet,
  hood
} = require('./utils');

/**
 * Generate all enemy icons
 * @returns {Object} Map of enemy name to SVG content
 */
function generateEnemyIcons() {
  return {
    // Forest enemies
    goblin_warrior: generateGoblinWarrior(),
    gray_wolf: generateGrayWolf(),
    forest_slime: generateForestSlime(),

    // Cave enemies
    cave_bat: generateCaveBat(),
    giant_spider: generateGiantSpider(),
    skeleton_warrior: generateSkeletonWarrior(),
    stone_golem: generateStoneGolem(),

    // Mountain enemies
    mountain_troll: generateMountainTroll(),
    troll_shaman: generateTrollShaman(),
    harpy: generateHarpy(),

    // Bridge enemies
    bridge_bandit: generateBridgeBandit(),
    bandit_captain: generateBanditCaptain(),
    bridge_troll: generateBridgeTroll(),

    // Palace enemies
    dark_knight: generateDarkKnight(),
    shadow_assassin: generateShadowAssassin(),
    palace_guard: generatePalaceGuard()
  };
}

// ============================================================================
// FOREST ENEMIES
// ============================================================================

/**
 * Goblin Warrior - Green goblin face with pointed ears, yellow eyes, small sword
 */
function generateGoblinWarrior() {
  const p = PALETTES.nature;
  return createSvg(`
${shadow()}

  <!-- Goblin head -->
  <ellipse cx="12" cy="10" rx="6" ry="5" fill="${p.dark}"/>
  <ellipse cx="12" cy="10" rx="5.5" ry="4.5" fill="${p.mid}"/>
  <ellipse cx="12" cy="9.5" rx="5" ry="4" fill="${p.light}"/>

${pointedEars(12, 8, 12, p)}

${eyes(12, 9, 6, 1.5, '#ffd700', '#2a2a2a')}

  <!-- Nose -->
  <ellipse cx="12" cy="11.5" rx="1" ry="0.7" fill="${p.dark}"/>

  <!-- Mouth with fangs -->
  <path d="M9 13c2 1 4 1 6 0" fill="none" stroke="${p.dark}" stroke-width="0.8"/>
  <path d="M10 12.5l-0.3 1.5" fill="none" stroke="#f0e8d8" stroke-width="0.8" stroke-linecap="round"/>
  <path d="M14 12.5l0.3 1.5" fill="none" stroke="#f0e8d8" stroke-width="0.8" stroke-linecap="round"/>

  <!-- Small sword -->
  <line x1="16" y1="14" x2="21" y2="19" stroke="#5a5a5a" stroke-width="2" stroke-linecap="round"/>
  <line x1="16.3" y1="14.3" x2="20.5" y2="18.5" stroke="#a0a0a0" stroke-width="1" stroke-linecap="round"/>
  <circle cx="16" cy="14" r="1.2" fill="#8b6914"/>
  <circle cx="16" cy="14" r="0.7" fill="#daa520"/>
`);
}

/**
 * Gray Wolf - Wolf head silhouette with yellow predator eyes
 */
function generateGrayWolf() {
  const p = PALETTES.grayBeast;
  return createSvg(`
${shadow(12, 21, 8, 2)}

  <!-- Wolf head shape -->
  <path d="M6 14c0-5 3-9 6-9s6 4 6 9c0 3-2 5-6 6s-6-3-6-6z" fill="${p.dark}"/>
  <path d="M7 14c0-4 2.5-8 5-8s5 4 5 8c0 2.5-1.5 4-5 5s-5-2.5-5-5z" fill="${p.mid}"/>
  <path d="M8 13c0-3 2-6 4-6s4 3 4 6c0 2-1 3-4 4s-4-2-4-4z" fill="${p.light}"/>

  <!-- Ears -->
  <path d="M8 5l-2-4 3 4z" fill="${p.dark}"/>
  <path d="M16 5l2-4-3 4z" fill="${p.dark}"/>
  <path d="M8.5 5.5l-1.3-2.5 1.8 2.5z" fill="${p.mid}"/>
  <path d="M15.5 5.5l1.3-2.5-1.8 2.5z" fill="${p.mid}"/>

  <!-- Snout -->
  <ellipse cx="12" cy="16" rx="3" ry="2" fill="${p.mid}"/>
  <ellipse cx="12" cy="15.5" rx="2.5" ry="1.5" fill="${p.light}"/>

  <!-- Nose -->
  <ellipse cx="12" cy="14.5" rx="1.5" ry="1" fill="#2a2a2a"/>
  <ellipse cx="11.7" cy="14.3" rx="0.4" ry="0.25" fill="#4a4a4a"/>

  <!-- Eyes -->
  <ellipse cx="9" cy="10" rx="1.5" ry="2" fill="#2a2a2a"/>
  <ellipse cx="15" cy="10" rx="1.5" ry="2" fill="#2a2a2a"/>
  <ellipse cx="9" cy="10" rx="0.8" ry="1.2" fill="#daa520"/>
  <ellipse cx="15" cy="10" rx="0.8" ry="1.2" fill="#daa520"/>
  <circle cx="9" cy="10" r="0.4" fill="#2a2a2a"/>
  <circle cx="15" cy="10" r="0.4" fill="#2a2a2a"/>
`);
}

/**
 * Forest Slime - Blob shape with shine highlight
 */
function generateForestSlime() {
  const p = PALETTES.slime;
  return createSvg(`
${shadow(12, 20, 7, 2)}

  <!-- Slime body -->
  <ellipse cx="12" cy="14" rx="8" ry="6" fill="${p.dark}"/>
  <ellipse cx="12" cy="13.5" rx="7.5" ry="5.5" fill="${p.mid}"/>
  <ellipse cx="12" cy="13" rx="6.5" ry="4.5" fill="${p.light}"/>

  <!-- Top bulge -->
  <ellipse cx="10" cy="10" rx="4" ry="3" fill="${p.mid}"/>
  <ellipse cx="10" cy="9.5" rx="3.5" ry="2.5" fill="${p.light}"/>

  <!-- Shine highlights -->
  <ellipse cx="8" cy="8" rx="2" ry="1.5" fill="${p.highlight}" opacity="0.6"/>
  <circle cx="7" cy="7" r="1" fill="#fff" opacity="0.5"/>

  <!-- Eyes (cute slime eyes) -->
  <ellipse cx="9" cy="12" rx="1.5" ry="2" fill="#1a2a2a"/>
  <ellipse cx="14" cy="12" rx="1.5" ry="2" fill="#1a2a2a"/>
  <circle cx="9.3" cy="11.5" r="0.6" fill="#fff" opacity="0.7"/>
  <circle cx="14.3" cy="11.5" r="0.6" fill="#fff" opacity="0.7"/>
`);
}

// ============================================================================
// CAVE ENEMIES
// ============================================================================

/**
 * Cave Bat - Bat silhouette with spread wings
 */
function generateCaveBat() {
  const p = PALETTES.beast;
  return createSvg(`
${shadow(12, 20, 6, 1.5)}

  <!-- Body -->
  <ellipse cx="12" cy="12" rx="3" ry="4" fill="${p.dark}"/>
  <ellipse cx="12" cy="11.5" rx="2.5" ry="3.5" fill="${p.mid}"/>

${batWings(12, 10, 9, p)}

  <!-- Ears -->
  <path d="M10 7l-1-3 2 2z" fill="${p.dark}"/>
  <path d="M14 7l1-3-2 2z" fill="${p.dark}"/>

  <!-- Face -->
  <ellipse cx="12" cy="10" rx="2" ry="1.5" fill="${p.mid}"/>

  <!-- Eyes (red glowing) -->
  <circle cx="10.5" cy="9.5" r="0.8" fill="#660000"/>
  <circle cx="13.5" cy="9.5" r="0.8" fill="#660000"/>
  <circle cx="10.5" cy="9.5" r="0.5" fill="#ff3333"/>
  <circle cx="13.5" cy="9.5" r="0.5" fill="#ff3333"/>
  <circle cx="10.3" cy="9.3" r="0.2" fill="#ff8888"/>
  <circle cx="13.3" cy="9.3" r="0.2" fill="#ff8888"/>

  <!-- Fangs -->
  <path d="M11 12l-0.3 1.5" stroke="#f0e8d8" stroke-width="0.6" stroke-linecap="round"/>
  <path d="M13 12l0.3 1.5" stroke="#f0e8d8" stroke-width="0.6" stroke-linecap="round"/>
`);
}

/**
 * Giant Spider - Spider face with 8 eyes and mandibles
 */
function generateGiantSpider() {
  const p = PALETTES.spider;
  return createSvg(`
${shadow(12, 21, 7, 1.5)}

  <!-- Abdomen hint -->
  <ellipse cx="12" cy="17" rx="5" ry="3" fill="${p.dark}"/>

  <!-- Cephalothorax (head) -->
  <ellipse cx="12" cy="11" rx="6" ry="5" fill="${p.dark}"/>
  <ellipse cx="12" cy="10.5" rx="5.5" ry="4.5" fill="${p.mid}"/>
  <ellipse cx="12" cy="10" rx="4.5" ry="3.5" fill="${p.light}"/>

  <!-- 8 Eyes (2 large center, 6 small around) -->
  <!-- Large center eyes -->
  <circle cx="10" cy="9" r="1.5" fill="#1a0000"/>
  <circle cx="14" cy="9" r="1.5" fill="#1a0000"/>
  <circle cx="10" cy="9" r="1" fill="${p.accent}"/>
  <circle cx="14" cy="9" r="1" fill="${p.accent}"/>
  <circle cx="9.7" cy="8.7" r="0.4" fill="#ff6666"/>

  <!-- Small eyes row 1 -->
  <circle cx="8" cy="8" r="0.8" fill="${p.accent}"/>
  <circle cx="16" cy="8" r="0.8" fill="${p.accent}"/>

  <!-- Small eyes row 2 -->
  <circle cx="9" cy="6.5" r="0.6" fill="${p.accent}" opacity="0.8"/>
  <circle cx="12" cy="6" r="0.6" fill="${p.accent}" opacity="0.8"/>
  <circle cx="15" cy="6.5" r="0.6" fill="${p.accent}" opacity="0.8"/>

  <!-- Mandibles/Chelicerae -->
  <path d="M10 13q-1 2-0.5 4" fill="none" stroke="${p.dark}" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M14 13q1 2 0.5 4" fill="none" stroke="${p.dark}" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="9.5" cy="17" r="0.8" fill="${p.mid}"/>
  <circle cx="14.5" cy="17" r="0.8" fill="${p.mid}"/>

  <!-- Leg hints -->
  <path d="M6 10l-3 3" stroke="${p.dark}" stroke-width="1"/>
  <path d="M6 12l-4 1" stroke="${p.dark}" stroke-width="1"/>
  <path d="M18 10l3 3" stroke="${p.dark}" stroke-width="1"/>
  <path d="M18 12l4 1" stroke="${p.dark}" stroke-width="1"/>
`);
}

/**
 * Skeleton Warrior - Skull with crossed sword
 */
function generateSkeletonWarrior() {
  return createSvg(`
${shadow()}

${skull(12, 10, 1, PALETTES.undead)}

  <!-- Sword behind -->
  <line x1="4" y1="18" x2="12" y2="6" stroke="#4a4a4a" stroke-width="2" stroke-linecap="round"/>
  <line x1="4.3" y1="17.7" x2="11.7" y2="6.3" stroke="#7a7a7a" stroke-width="1" stroke-linecap="round"/>

  <!-- Crossguard -->
  <ellipse cx="10" cy="9" rx="2" ry="0.8" fill="#8b6914" transform="rotate(-60 10 9)"/>
  <ellipse cx="10" cy="9" rx="1.5" ry="0.5" fill="#daa520" transform="rotate(-60 10 9)"/>
`);
}

/**
 * Stone Golem - Rocky face with glowing eyes
 */
function generateStoneGolem() {
  const p = {
    dark: '#4a4a3a',
    mid: '#6a6a5a',
    light: '#8a8a7a',
    highlight: '#aaa99a'
  };
  return createSvg(`
${shadow(12, 21, 8, 2)}

  <!-- Rocky head shape (angular) -->
  <path d="M6 8l2-5h8l2 5v8l-2 4h-8l-2-4z" fill="${p.dark}"/>
  <path d="M7 8.5l1.5-4h7l1.5 4v7l-1.5 3.5h-7l-1.5-3.5z" fill="${p.mid}"/>
  <path d="M8 9l1-3h6l1 3v5.5l-1 3h-6l-1-3z" fill="${p.light}"/>

  <!-- Cracks/texture -->
  <path d="M9 6l1 4" stroke="${p.dark}" stroke-width="0.5"/>
  <path d="M15 7l-2 5" stroke="${p.dark}" stroke-width="0.5"/>
  <path d="M7 12h3" stroke="${p.dark}" stroke-width="0.5"/>

${glowingEyes(12, 10, 5, 1.5, '#ffaa00')}

  <!-- Mouth (crack) -->
  <path d="M9 15h6" stroke="${p.dark}" stroke-width="1.5"/>
  <path d="M10 14.5l1 1.5" stroke="${p.dark}" stroke-width="0.5"/>
  <path d="M14 14.5l-1 1.5" stroke="${p.dark}" stroke-width="0.5"/>
`);
}

// ============================================================================
// MOUNTAIN ENEMIES
// ============================================================================

/**
 * Mountain Troll - Brutish face with tusks
 */
function generateMountainTroll() {
  const p = PALETTES.troll;
  return createSvg(`
${shadow(12, 21, 8, 2)}

  <!-- Large brutish head -->
  <ellipse cx="12" cy="11" rx="8" ry="7" fill="${p.dark}"/>
  <ellipse cx="12" cy="10.5" rx="7.5" ry="6.5" fill="${p.mid}"/>
  <ellipse cx="12" cy="10" rx="6.5" ry="5.5" fill="${p.light}"/>

  <!-- Heavy brow -->
  <path d="M5 8q7-3 14 0" fill="${p.dark}"/>
  <path d="M6 8.5q6-2.5 12 0" fill="${p.mid}"/>

  <!-- Small angry eyes under brow -->
  <circle cx="9" cy="10" r="1.2" fill="#2a2a2a"/>
  <circle cx="15" cy="10" r="1.2" fill="#2a2a2a"/>
  <circle cx="9" cy="10" r="0.6" fill="#884400"/>
  <circle cx="15" cy="10" r="0.6" fill="#884400"/>

  <!-- Big nose -->
  <ellipse cx="12" cy="13" rx="2" ry="1.5" fill="${p.dark}"/>
  <ellipse cx="12" cy="12.8" rx="1.7" ry="1.2" fill="${p.mid}"/>
  <circle cx="10.5" cy="13" r="0.5" fill="${p.dark}"/>
  <circle cx="13.5" cy="13" r="0.5" fill="${p.dark}"/>

  <!-- Tusks -->
  <path d="M8 16l-1 3" stroke="#f0e8d8" stroke-width="2" stroke-linecap="round"/>
  <path d="M16 16l1 3" stroke="#f0e8d8" stroke-width="2" stroke-linecap="round"/>
  <path d="M8.2 16.2l-0.8 2.5" stroke="#ddd8c8" stroke-width="1" stroke-linecap="round"/>
  <path d="M15.8 16.2l0.8 2.5" stroke="#ddd8c8" stroke-width="1" stroke-linecap="round"/>

  <!-- Ears -->
  <ellipse cx="4" cy="10" rx="2" ry="3" fill="${p.mid}"/>
  <ellipse cx="20" cy="10" rx="2" ry="3" fill="${p.mid}"/>
  <ellipse cx="4.3" cy="10" rx="1.3" ry="2" fill="${p.light}"/>
  <ellipse cx="19.7" cy="10" rx="1.3" ry="2" fill="${p.light}"/>
`);
}

/**
 * Troll Shaman - Troll with staff/magic glow
 */
function generateTrollShaman() {
  const p = PALETTES.troll;
  const m = PALETTES.magic;
  return createSvg(`
${shadow()}

  <!-- Troll head (smaller, wiser look) -->
  <ellipse cx="10" cy="11" rx="6" ry="5.5" fill="${p.dark}"/>
  <ellipse cx="10" cy="10.5" rx="5.5" ry="5" fill="${p.mid}"/>
  <ellipse cx="10" cy="10" rx="4.5" ry="4" fill="${p.light}"/>

  <!-- Wise squinting eyes -->
  <path d="M7 9q1.5 1 3 0" fill="none" stroke="${p.dark}" stroke-width="1.5"/>
  <path d="M11 9q1.5 1 3 0" fill="none" stroke="${p.dark}" stroke-width="1.5"/>
  <circle cx="8.5" cy="9.5" r="0.4" fill="#6a4a8a"/>
  <circle cx="12.5" cy="9.5" r="0.4" fill="#6a4a8a"/>

  <!-- Big nose -->
  <ellipse cx="10" cy="12" rx="1.5" ry="1" fill="${p.dark}"/>

  <!-- Small tusks -->
  <path d="M7 14l-0.3 1.5" stroke="#f0e8d8" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M13 14l0.3 1.5" stroke="#f0e8d8" stroke-width="1.2" stroke-linecap="round"/>

  <!-- Staff -->
  <line x1="18" y1="3" x2="18" y2="20" stroke="#5a4030" stroke-width="2"/>
  <line x1="18.3" y1="4" x2="18.3" y2="19" stroke="#7a6050" stroke-width="1"/>

  <!-- Magic orb on staff -->
  <circle cx="18" cy="4" r="3" fill="${m.dark}" opacity="0.5"/>
  <circle cx="18" cy="4" r="2.5" fill="${m.mid}"/>
  <circle cx="18" cy="4" r="1.8" fill="${m.light}"/>
  <circle cx="17.5" cy="3.5" r="0.8" fill="${m.highlight}" opacity="0.7"/>

  <!-- Magic sparkles -->
  <circle cx="16" cy="2" r="0.4" fill="${m.accent}"/>
  <circle cx="20" cy="5" r="0.3" fill="${m.accent}"/>
  <circle cx="19" cy="2.5" r="0.25" fill="${m.accent}"/>
`);
}

/**
 * Harpy - Bird-woman face with feathers
 */
function generateHarpy() {
  const p = PALETTES.harpy;
  const skin = PALETTES.humanoidSkin;
  return createSvg(`
${shadow()}

  <!-- Feathered head/hair -->
  <path d="M5 8q7-6 14 0l-2 3q-5-2-10 0z" fill="${p.dark}"/>
  <path d="M6 8.5q6-5 12 0l-1.5 2q-4.5-1.5-9 0z" fill="${p.mid}"/>
  <path d="M7 9q5-4 10 0l-1 1.5q-4-1-8 0z" fill="${p.light}"/>

  <!-- Face -->
  <ellipse cx="12" cy="12" rx="5" ry="4.5" fill="${skin.dark}"/>
  <ellipse cx="12" cy="11.8" rx="4.5" ry="4" fill="${skin.mid}"/>
  <ellipse cx="12" cy="11.5" rx="4" ry="3.5" fill="${skin.light}"/>

  <!-- Fierce eyes -->
${eyes(12, 11, 5, 1.3, '#daa520', '#2a2a2a')}

  <!-- Sharp nose/beak hint -->
  <path d="M12 13l-1 2h2z" fill="${skin.dark}"/>
  <path d="M12 13.2l-0.7 1.5h1.4z" fill="${skin.mid}"/>

  <!-- Mouth -->
  <path d="M10 16q2 0.5 4 0" fill="none" stroke="${skin.dark}" stroke-width="0.6"/>

  <!-- Wing feathers on sides -->
  <path d="M3 10l-1 4 3-2z" fill="${p.mid}"/>
  <path d="M4 11l-1 3 2.5-1.5z" fill="${p.light}"/>
  <path d="M21 10l1 4-3-2z" fill="${p.mid}"/>
  <path d="M20 11l1 3-2.5-1.5z" fill="${p.light}"/>

  <!-- Decorative feathers -->
  <path d="M7 6l-2-3" stroke="${p.accent}" stroke-width="1" stroke-linecap="round"/>
  <path d="M17 6l2-3" stroke="${p.accent}" stroke-width="1" stroke-linecap="round"/>
`);
}

// ============================================================================
// BRIDGE ENEMIES
// ============================================================================

/**
 * Bridge Bandit - Masked face with hood
 */
function generateBridgeBandit() {
  const p = PALETTES.humanoidCloth;
  const skin = PALETTES.humanoidSkin;
  return createSvg(`
${shadow()}

${hood(12, 4, 14, p)}

  <!-- Face (lower half visible) -->
  <ellipse cx="12" cy="14" rx="4" ry="3" fill="${skin.dark}"/>
  <ellipse cx="12" cy="13.8" rx="3.5" ry="2.7" fill="${skin.mid}"/>

  <!-- Mask/bandana over nose -->
  <path d="M6 12h12v4q-6 2-12 0z" fill="#3a2020"/>
  <path d="M7 12.5h10v3q-5 1.5-10 0z" fill="#5a3030"/>

  <!-- Eyes in shadow of hood -->
  <ellipse cx="9" cy="10" rx="1.3" ry="1" fill="#1a1a20"/>
  <ellipse cx="15" cy="10" rx="1.3" ry="1" fill="#1a1a20"/>
  <circle cx="9" cy="10" r="0.5" fill="#888"/>
  <circle cx="15" cy="10" r="0.5" fill="#888"/>

  <!-- Dagger hint -->
  <line x1="18" y1="15" x2="22" y2="19" stroke="#5a5a5a" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="18.2" y1="15.2" x2="21.5" y2="18.5" stroke="#8a8a8a" stroke-width="0.8" stroke-linecap="round"/>
`);
}

/**
 * Bandit Captain - Bandit with feathered hat
 */
function generateBanditCaptain() {
  const p = PALETTES.humanoidCloth;
  const skin = PALETTES.humanoidSkin;
  return createSvg(`
${shadow()}

  <!-- Hat base -->
  <ellipse cx="12" cy="8" rx="8" ry="3" fill="#2a2a3a"/>
  <ellipse cx="12" cy="7.5" rx="7.5" ry="2.5" fill="#3a3a4a"/>

  <!-- Hat top -->
  <path d="M6 8q0-5 6-5t6 5" fill="#2a2a3a"/>
  <path d="M7 7.5q0-4 5-4t5 4" fill="#3a3a4a"/>

  <!-- Feather -->
  <path d="M16 3q4 1 5 5" fill="none" stroke="#aa2222" stroke-width="2" stroke-linecap="round"/>
  <path d="M16.5 3.5q3.5 1 4 4" fill="none" stroke="#cc4444" stroke-width="1" stroke-linecap="round"/>

  <!-- Face -->
  <ellipse cx="12" cy="13" rx="5" ry="4.5" fill="${skin.dark}"/>
  <ellipse cx="12" cy="12.8" rx="4.5" ry="4" fill="${skin.mid}"/>
  <ellipse cx="12" cy="12.5" rx="4" ry="3.5" fill="${skin.light}"/>

  <!-- Confident eyes -->
${eyes(12, 12, 5, 1.2, '#4a3a2a', '#fff')}

  <!-- Smirk -->
  <path d="M10 15q2 1.5 5 0" fill="none" stroke="${skin.dark}" stroke-width="0.7"/>

  <!-- Goatee -->
  <path d="M11 17l1 2 1-2" fill="#3a2a1a"/>

  <!-- Scar -->
  <path d="M15 11l1.5 3" stroke="#aa7766" stroke-width="0.6"/>
`);
}

/**
 * Bridge Troll - Large troll face (similar to mountain but darker)
 */
function generateBridgeTroll() {
  const p = {
    dark: '#3a4a3a',
    mid: '#4a5a4a',
    light: '#5a6a5a',
    highlight: '#6a7a6a'
  };
  return createSvg(`
${shadow(12, 21, 9, 2)}

  <!-- Very large brutish head -->
  <ellipse cx="12" cy="11" rx="9" ry="8" fill="${p.dark}"/>
  <ellipse cx="12" cy="10.5" rx="8.5" ry="7.5" fill="${p.mid}"/>
  <ellipse cx="12" cy="10" rx="7.5" ry="6.5" fill="${p.light}"/>

  <!-- Very heavy brow -->
  <path d="M4 7q8-4 16 0" fill="${p.dark}"/>
  <path d="M5 7.5q7-3.5 14 0" fill="${p.mid}"/>

  <!-- Tiny angry eyes deep under brow -->
  <circle cx="8" cy="10" r="1" fill="#2a2a2a"/>
  <circle cx="16" cy="10" r="1" fill="#2a2a2a"/>
  <circle cx="8" cy="10" r="0.5" fill="#aa4400"/>
  <circle cx="16" cy="10" r="0.5" fill="#aa4400"/>

  <!-- Huge nose -->
  <ellipse cx="12" cy="13" rx="2.5" ry="2" fill="${p.dark}"/>
  <ellipse cx="12" cy="12.8" rx="2" ry="1.5" fill="${p.mid}"/>
  <circle cx="10.5" cy="13.5" r="0.6" fill="${p.dark}"/>
  <circle cx="13.5" cy="13.5" r="0.6" fill="${p.dark}"/>

  <!-- Large tusks -->
  <path d="M7 16l-2 4" stroke="#e0d8c8" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M17 16l2 4" stroke="#e0d8c8" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M7.3 16.3l-1.6 3.2" stroke="#f0e8d8" stroke-width="1.2" stroke-linecap="round"/>
  <path d="M16.7 16.3l1.6 3.2" stroke="#f0e8d8" stroke-width="1.2" stroke-linecap="round"/>

  <!-- Warts -->
  <circle cx="6" cy="12" r="0.8" fill="${p.dark}"/>
  <circle cx="18" cy="11" r="0.6" fill="${p.dark}"/>
`);
}

// ============================================================================
// PALACE ENEMIES
// ============================================================================

/**
 * Dark Knight - Dark helmet with glowing visor
 */
function generateDarkKnight() {
  const p = PALETTES.darkArmor;
  return createSvg(`
${shadow()}

${helmet(12, 11, 12, 10, p, false)}

  <!-- Visor (T-shaped, glowing) -->
  <path d="M7 10h10" stroke="#1a0010" stroke-width="2"/>
  <path d="M12 10v4" stroke="#1a0010" stroke-width="2"/>

  <!-- Visor glow -->
  <path d="M7.5 10h9" stroke="${p.accent}" stroke-width="1" opacity="0.8"/>
  <path d="M12 10.5v3" stroke="${p.accent}" stroke-width="1" opacity="0.8"/>

  <!-- Helmet crest -->
  <path d="M12 2v4" stroke="${p.mid}" stroke-width="3"/>
  <path d="M12 2v4" stroke="${p.light}" stroke-width="1.5"/>

  <!-- Shoulder armor hints -->
  <ellipse cx="4" cy="18" rx="3" ry="2" fill="${p.dark}"/>
  <ellipse cx="20" cy="18" rx="3" ry="2" fill="${p.dark}"/>
  <ellipse cx="4" cy="17.7" rx="2.5" ry="1.5" fill="${p.mid}"/>
  <ellipse cx="20" cy="17.7" rx="2.5" ry="1.5" fill="${p.mid}"/>

  <!-- Dark aura -->
  <circle cx="12" cy="12" r="11" fill="none" stroke="${p.accent}" stroke-width="0.5" opacity="0.3"/>
`);
}

/**
 * Shadow Assassin - Hooded face with glowing eyes
 */
function generateShadowAssassin() {
  const p = PALETTES.darkArmor;
  return createSvg(`
${shadow()}

${hood(12, 3, 16, p)}

  <!-- Face completely in shadow -->
  <ellipse cx="12" cy="13" rx="4" ry="3.5" fill="#0a0a10"/>

${glowingEyes(12, 12, 5, 1, p.accent)}

  <!-- Mask/scarf -->
  <path d="M8 14q4 3 8 0" fill="#1a1a25"/>

  <!-- Dagger crossed -->
  <line x1="4" y1="17" x2="9" y2="12" stroke="#4a4a4a" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="20" y1="17" x2="15" y2="12" stroke="#4a4a4a" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="4.3" y1="16.7" x2="8.7" y2="12.3" stroke="#7a7a7a" stroke-width="0.8"/>
  <line x1="19.7" y1="16.7" x2="15.3" y2="12.3" stroke="#7a7a7a" stroke-width="0.8"/>

  <!-- Shadow wisps -->
  <path d="M6 18q-2 2-3 0" fill="none" stroke="${p.accent}" stroke-width="0.5" opacity="0.5"/>
  <path d="M18 18q2 2 3 0" fill="none" stroke="${p.accent}" stroke-width="0.5" opacity="0.5"/>
`);
}

/**
 * Palace Guard - Ornate golden helmet
 */
function generatePalaceGuard() {
  const p = PALETTES.steelArmor;
  const gold = { dark: '#8b6914', mid: '#daa520', light: '#ffd700', highlight: '#ffee88' };
  return createSvg(`
${shadow()}

${helmet(12, 11, 11, 9, p, true)}

  <!-- Golden crest -->
  <path d="M12 1l-2 4h4z" fill="${gold.dark}"/>
  <path d="M12 1.5l-1.5 3h3z" fill="${gold.mid}"/>
  <path d="M12 2l-1 2h2z" fill="${gold.light}"/>

  <!-- Golden trim around helmet -->
  <ellipse cx="12" cy="6" rx="5" ry="1" fill="${gold.dark}"/>
  <ellipse cx="12" cy="5.8" rx="4.5" ry="0.7" fill="${gold.mid}"/>

  <!-- Cheek guards with gold trim -->
  <path d="M5 12l-1 6h3z" fill="${p.mid}"/>
  <path d="M19 12l1 6h-3z" fill="${p.mid}"/>
  <path d="M5.3 12.5l-0.8 5h2.3z" fill="${p.light}"/>
  <path d="M18.7 12.5l0.8 5h-2.3z" fill="${p.light}"/>

  <!-- Gold rivets -->
  <circle cx="5" cy="13" r="0.7" fill="${gold.mid}"/>
  <circle cx="19" cy="13" r="0.7" fill="${gold.mid}"/>
  <circle cx="5" cy="13" r="0.4" fill="${gold.light}"/>
  <circle cx="19" cy="13" r="0.4" fill="${gold.light}"/>

  <!-- Royal emblem on forehead -->
  <circle cx="12" cy="8" r="1.5" fill="${gold.dark}"/>
  <circle cx="12" cy="8" r="1.1" fill="${gold.mid}"/>
  <circle cx="12" cy="8" r="0.6" fill="${gold.light}"/>
`);
}

module.exports = { generateEnemyIcons };
