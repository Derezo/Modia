/**
 * SVG Icon Generation Utilities
 * Shared utilities, color palettes, and shape helpers for programmatic icon generation
 */

/**
 * Color palettes for consistent icon styling
 * Each palette follows: dark (outline/shadow) -> mid (main body) -> light (highlight)
 */
const PALETTES = {
  // Beast/Animal enemies (wolves, bats, etc.)
  beast: {
    dark: '#3a2a1a',
    mid: '#6b4a2a',
    light: '#8b6a4a',
    highlight: '#a08060',
    accent: '#daa520'
  },

  // Gray beasts (wolves, golems)
  grayBeast: {
    dark: '#3a3a3a',
    mid: '#5a5a5a',
    light: '#7a7a7a',
    highlight: '#9a9a9a',
    accent: '#daa520'
  },

  // Undead enemies (skeletons)
  undead: {
    dark: '#2a2a30',
    mid: '#5a5a60',
    light: '#8a8a90',
    highlight: '#b0b0b5',
    accent: '#6b2d4d'
  },

  // Nature/Forest (goblins, slimes)
  nature: {
    dark: '#2a4a2a',
    mid: '#448844',
    light: '#66aa66',
    highlight: '#88cc88',
    accent: '#3d6640'
  },

  // Slime (blue-green)
  slime: {
    dark: '#1a4a4a',
    mid: '#2a8a7a',
    light: '#4abaaa',
    highlight: '#6adaca',
    accent: '#88ffee'
  },

  // Humanoid skin tones
  humanoidSkin: {
    dark: '#6b4a2a',
    mid: '#9a7a5a',
    light: '#c0a080',
    highlight: '#d4bc98'
  },

  // Humanoid cloth (bandits, guards)
  humanoidCloth: {
    dark: '#3a3a50',
    mid: '#5a5a70',
    light: '#7a7a90',
    highlight: '#9a9aaa'
  },

  // Dark armor (dark knight, assassin)
  darkArmor: {
    dark: '#1a1a20',
    mid: '#2a2a35',
    light: '#3a3a45',
    highlight: '#4a4a55',
    accent: '#6b2d4d'
  },

  // Steel armor (palace guard)
  steelArmor: {
    dark: '#4a4a50',
    mid: '#6a6a70',
    light: '#8a8a90',
    highlight: '#aaaaaa',
    accent: '#daa520'
  },

  // Troll skin (green-brown)
  troll: {
    dark: '#3a4a2a',
    mid: '#5a6a4a',
    light: '#7a8a6a',
    highlight: '#9aaa8a',
    accent: '#8b6914'
  },

  // Purple magic
  magic: {
    dark: '#3a2a4a',
    mid: '#6a4a8a',
    light: '#9a6aba',
    highlight: '#ba8ada',
    accent: '#cc99ff'
  },

  // Spider (dark brown/black)
  spider: {
    dark: '#1a1a1a',
    mid: '#3a2a2a',
    light: '#5a4a3a',
    highlight: '#6a5a4a',
    accent: '#aa0000'
  },

  // Harpy feathers
  harpy: {
    dark: '#4a3a5a',
    mid: '#7a6a8a',
    light: '#9a8aaa',
    highlight: '#baacca',
    accent: '#daa520'
  }
};

/**
 * Create SVG wrapper with standard attributes
 * @param {string} content - SVG content (paths, shapes, etc.)
 * @param {string} viewBox - ViewBox attribute (default: '0 0 24 24')
 * @returns {string} Complete SVG markup
 */
function createSvg(content, viewBox = '0 0 24 24') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
${content}
</svg>`;
}

/**
 * Create shadow ellipse (standard for all icons)
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} rx - Radius X
 * @param {number} ry - Radius Y
 * @param {string} color - Shadow color
 * @param {number} opacity - Shadow opacity
 * @returns {string} SVG ellipse element
 */
function shadow(cx = 12, cy = 21, rx = 7, ry = 2, color = '#1a1a20', opacity = 0.3) {
  return `  <!-- Shadow -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" opacity="${opacity}"/>`;
}

/**
 * Create layered circle (dark outer -> mid -> light inner -> highlight)
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} r - Base radius
 * @param {object} palette - Color palette with dark, mid, light, highlight
 * @returns {string} SVG elements for layered circle
 */
function layeredCircle(cx, cy, r, palette) {
  const { dark, mid, light, highlight } = palette;
  return `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark}"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.85}" fill="${mid}"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.65}" fill="${light}"/>
  <circle cx="${cx - r * 0.2}" cy="${cy - r * 0.2}" r="${r * 0.25}" fill="${highlight || '#fff'}" opacity="0.5"/>`;
}

/**
 * Create layered ellipse (for heads, bodies)
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} rx - Radius X
 * @param {number} ry - Radius Y
 * @param {object} palette - Color palette
 * @returns {string} SVG elements for layered ellipse
 */
function layeredEllipse(cx, cy, rx, ry, palette) {
  const { dark, mid, light } = palette;
  return `  <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${dark}"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.9}" ry="${ry * 0.9}" fill="${mid}"/>
  <ellipse cx="${cx}" cy="${cy - ry * 0.1}" rx="${rx * 0.8}" ry="${ry * 0.8}" fill="${light}"/>`;
}

/**
 * Create skull shape for undead enemies
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} scale - Scale factor
 * @param {object} palette - Color palette (default: undead)
 * @returns {string} SVG elements for skull
 */
function skull(cx, cy, scale = 1, palette = PALETTES.undead) {
  const s = scale;
  return `  <!-- Skull -->
  <ellipse cx="${cx}" cy="${cy}" rx="${5 * s}" ry="${6 * s}" fill="${palette.dark}"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${4.5 * s}" ry="${5.5 * s}" fill="${palette.mid}"/>
  <ellipse cx="${cx}" cy="${cy - 0.5 * s}" rx="${4 * s}" ry="${5 * s}" fill="${palette.light}"/>
  <!-- Eye sockets -->
  <ellipse cx="${cx - 1.5 * s}" cy="${cy - 1 * s}" rx="${1.2 * s}" ry="${1.5 * s}" fill="${palette.dark}"/>
  <ellipse cx="${cx + 1.5 * s}" cy="${cy - 1 * s}" rx="${1.2 * s}" ry="${1.5 * s}" fill="${palette.dark}"/>
  <!-- Eye glow -->
  <circle cx="${cx - 1.5 * s}" cy="${cy - 1 * s}" r="${0.5 * s}" fill="${palette.accent}" opacity="0.7"/>
  <circle cx="${cx + 1.5 * s}" cy="${cy - 1 * s}" r="${0.5 * s}" fill="${palette.accent}" opacity="0.7"/>
  <!-- Nose hole -->
  <path d="M${cx} ${cy + 1 * s}l${-0.5 * s} ${1 * s}l${1 * s} 0z" fill="${palette.dark}"/>
  <!-- Teeth -->
  <path d="M${cx - 2.5 * s} ${cy + 3 * s}h${5 * s}" fill="none" stroke="${palette.highlight}" stroke-width="${0.6 * s}"/>
  <path d="M${cx - 2 * s} ${cy + 2.5 * s}v${1 * s}" fill="none" stroke="${palette.dark}" stroke-width="${0.3 * s}"/>
  <path d="M${cx} ${cy + 2.5 * s}v${1 * s}" fill="none" stroke="${palette.dark}" stroke-width="${0.3 * s}"/>
  <path d="M${cx + 2 * s} ${cy + 2.5 * s}v${1 * s}" fill="none" stroke="${palette.dark}" stroke-width="${0.3 * s}"/>`;
}

/**
 * Create simple sword shape
 * @param {number} x - Start X
 * @param {number} y - Start Y
 * @param {number} length - Blade length
 * @param {number} angle - Rotation angle in degrees
 * @returns {string} SVG elements for sword
 */
function sword(x, y, length, angle = 45) {
  const rad = (angle * Math.PI) / 180;
  const ex = x + Math.cos(rad) * length;
  const ey = y + Math.sin(rad) * length;
  const gx = x + Math.cos(rad) * 2;
  const gy = y + Math.sin(rad) * 2;

  return `  <!-- Sword -->
  <line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" stroke="#5a5a5a" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="${x + 0.3}" y1="${y + 0.3}" x2="${ex}" y2="${ey}" stroke="#a0a0a0" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="${x + 0.5}" y1="${y + 0.5}" x2="${ex - 0.5}" y2="${ey - 0.5}" stroke="#d0d0d0" stroke-width="0.5" stroke-linecap="round"/>
  <!-- Crossguard -->
  <circle cx="${gx}" cy="${gy}" r="1.5" fill="#8b6914"/>
  <circle cx="${gx}" cy="${gy}" r="1" fill="#daa520"/>`;
}

/**
 * Create eye pair
 * @param {number} cx - Center X between eyes
 * @param {number} cy - Eye Y position
 * @param {number} spacing - Distance between eye centers
 * @param {number} size - Eye size
 * @param {string} eyeColor - Iris/pupil color
 * @param {string} scleraColor - White of eye (or socket color)
 * @returns {string} SVG elements for eyes
 */
function eyes(cx, cy, spacing = 4, size = 1.5, eyeColor = '#daa520', scleraColor = '#2a2a2a') {
  const lx = cx - spacing / 2;
  const rx = cx + spacing / 2;
  return `  <!-- Eyes -->
  <ellipse cx="${lx}" cy="${cy}" rx="${size}" ry="${size * 1.2}" fill="${scleraColor}"/>
  <ellipse cx="${rx}" cy="${cy}" rx="${size}" ry="${size * 1.2}" fill="${scleraColor}"/>
  <circle cx="${lx}" cy="${cy}" r="${size * 0.5}" fill="${eyeColor}"/>
  <circle cx="${rx}" cy="${cy}" r="${size * 0.5}" fill="${eyeColor}"/>
  <circle cx="${lx - size * 0.15}" cy="${cy - size * 0.15}" r="${size * 0.2}" fill="#fff" opacity="0.6"/>
  <circle cx="${rx - size * 0.15}" cy="${cy - size * 0.15}" r="${size * 0.2}" fill="#fff" opacity="0.6"/>`;
}

/**
 * Create glowing eyes (for menacing creatures)
 * @param {number} cx - Center X between eyes
 * @param {number} cy - Eye Y position
 * @param {number} spacing - Distance between eye centers
 * @param {number} size - Eye size
 * @param {string} glowColor - Glow color
 * @returns {string} SVG elements for glowing eyes
 */
function glowingEyes(cx, cy, spacing = 4, size = 1.2, glowColor = '#ff4444') {
  const lx = cx - spacing / 2;
  const rx = cx + spacing / 2;
  return `  <!-- Glowing Eyes -->
  <circle cx="${lx}" cy="${cy}" r="${size * 1.5}" fill="${glowColor}" opacity="0.3"/>
  <circle cx="${rx}" cy="${cy}" r="${size * 1.5}" fill="${glowColor}" opacity="0.3"/>
  <circle cx="${lx}" cy="${cy}" r="${size}" fill="${glowColor}"/>
  <circle cx="${rx}" cy="${cy}" r="${size}" fill="${glowColor}"/>
  <circle cx="${lx}" cy="${cy}" r="${size * 0.5}" fill="#fff" opacity="0.7"/>
  <circle cx="${rx}" cy="${cy}" r="${size * 0.5}" fill="#fff" opacity="0.7"/>`;
}

/**
 * Create pointed ears (for goblins, trolls)
 * @param {number} headCx - Head center X
 * @param {number} earY - Ear Y position
 * @param {number} headWidth - Width of head for ear positioning
 * @param {object} palette - Color palette
 * @returns {string} SVG elements for pointed ears
 */
function pointedEars(headCx, earY, headWidth, palette) {
  const lx = headCx - headWidth / 2;
  const rx = headCx + headWidth / 2;
  return `  <!-- Pointed Ears -->
  <path d="M${lx} ${earY}l-3-4 2 5z" fill="${palette.mid}"/>
  <path d="M${rx} ${earY}l3-4-2 5z" fill="${palette.mid}"/>
  <path d="M${lx + 0.5} ${earY + 0.5}l-2-3 1.5 3.5z" fill="${palette.light}"/>
  <path d="M${rx - 0.5} ${earY + 0.5}l2-3-1.5 3.5z" fill="${palette.light}"/>`;
}

/**
 * Create bat wings
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} span - Wing span (half)
 * @param {object} palette - Color palette
 * @returns {string} SVG elements for bat wings
 */
function batWings(cx, cy, span, palette) {
  return `  <!-- Wings -->
  <!-- Left wing -->
  <path d="M${cx - 1} ${cy}
    Q${cx - span * 0.5} ${cy - span * 0.3} ${cx - span} ${cy - span * 0.2}
    Q${cx - span * 0.7} ${cy + span * 0.1} ${cx - span * 0.5} ${cy + span * 0.3}
    Q${cx - span * 0.3} ${cy + span * 0.1} ${cx - 1} ${cy}
    Z" fill="${palette.dark}"/>
  <path d="M${cx - 1} ${cy}
    Q${cx - span * 0.5} ${cy - span * 0.25} ${cx - span * 0.9} ${cy - span * 0.15}
    L${cx - span * 0.6} ${cy + span * 0.05}
    Q${cx - span * 0.3} ${cy} ${cx - 1} ${cy}
    Z" fill="${palette.mid}"/>
  <!-- Right wing -->
  <path d="M${cx + 1} ${cy}
    Q${cx + span * 0.5} ${cy - span * 0.3} ${cx + span} ${cy - span * 0.2}
    Q${cx + span * 0.7} ${cy + span * 0.1} ${cx + span * 0.5} ${cy + span * 0.3}
    Q${cx + span * 0.3} ${cy + span * 0.1} ${cx + 1} ${cy}
    Z" fill="${palette.dark}"/>
  <path d="M${cx + 1} ${cy}
    Q${cx + span * 0.5} ${cy - span * 0.25} ${cx + span * 0.9} ${cy - span * 0.15}
    L${cx + span * 0.6} ${cy + span * 0.05}
    Q${cx + span * 0.3} ${cy} ${cx + 1} ${cy}
    Z" fill="${palette.mid}"/>`;
}

/**
 * Create helmet shape
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} width - Helmet width
 * @param {number} height - Helmet height
 * @param {object} palette - Color palette
 * @param {boolean} hasVisor - Include visor slit
 * @returns {string} SVG elements for helmet
 */
function helmet(cx, cy, width, height, palette, hasVisor = true) {
  const hw = width / 2;
  const hh = height / 2;
  let visor = '';
  if (hasVisor) {
    visor = `
  <!-- Visor slit -->
  <path d="M${cx - hw * 0.6} ${cy + hh * 0.1}h${width * 0.6}" fill="none" stroke="${palette.dark}" stroke-width="1.5"/>`;
  }
  return `  <!-- Helmet -->
  <ellipse cx="${cx}" cy="${cy - hh * 0.2}" rx="${hw}" ry="${hh}" fill="${palette.dark}"/>
  <ellipse cx="${cx}" cy="${cy - hh * 0.25}" rx="${hw * 0.9}" ry="${hh * 0.9}" fill="${palette.mid}"/>
  <ellipse cx="${cx}" cy="${cy - hh * 0.3}" rx="${hw * 0.75}" ry="${hh * 0.75}" fill="${palette.light}"/>
  <!-- Highlight -->
  <ellipse cx="${cx - hw * 0.2}" cy="${cy - hh * 0.5}" rx="${hw * 0.3}" ry="${hh * 0.2}" fill="${palette.highlight}" opacity="0.5"/>${visor}`;
}

/**
 * Create hood shape
 * @param {number} cx - Center X
 * @param {number} cy - Center Y (top of hood)
 * @param {number} width - Hood width at base
 * @param {object} palette - Color palette
 * @returns {string} SVG elements for hood
 */
function hood(cx, cy, width, palette) {
  const hw = width / 2;
  return `  <!-- Hood -->
  <path d="M${cx} ${cy - 2}
    Q${cx - hw * 0.3} ${cy} ${cx - hw} ${cy + 8}
    L${cx - hw * 0.3} ${cy + 10}
    Q${cx} ${cy + 6} ${cx + hw * 0.3} ${cy + 10}
    L${cx + hw} ${cy + 8}
    Q${cx + hw * 0.3} ${cy} ${cx} ${cy - 2}
    Z" fill="${palette.dark}"/>
  <path d="M${cx} ${cy - 1}
    Q${cx - hw * 0.25} ${cy + 1} ${cx - hw * 0.85} ${cy + 7}
    L${cx - hw * 0.25} ${cy + 9}
    Q${cx} ${cy + 5.5} ${cx + hw * 0.25} ${cy + 9}
    L${cx + hw * 0.85} ${cy + 7}
    Q${cx + hw * 0.25} ${cy + 1} ${cx} ${cy - 1}
    Z" fill="${palette.mid}"/>`;
}

module.exports = {
  PALETTES,
  createSvg,
  shadow,
  layeredCircle,
  layeredEllipse,
  skull,
  sword,
  eyes,
  glowingEyes,
  pointedEars,
  batWings,
  helmet,
  hood
};
