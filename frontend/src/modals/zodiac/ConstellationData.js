/**
 * ConstellationData - Star coordinates for zodiac constellations
 *
 * Coordinates are normalized (0-1) and will be scaled to the orb size when rendering.
 */

/**
 * Zodiac sign information including Unicode symbols, elements, names, and titles.
 * @type {Object.<string, {symbol: string, element: string, name: string, title: string}>}
 */
export const ZODIAC_INFO = {
  aries: { symbol: '\u2648', element: 'fire', name: 'Aries', title: 'The Ram' },
  taurus: { symbol: '\u2649', element: 'earth', name: 'Taurus', title: 'The Bull' },
  gemini: { symbol: '\u264A', element: 'air', name: 'Gemini', title: 'The Twins' },
  cancer: { symbol: '\u264B', element: 'water', name: 'Cancer', title: 'The Crab' },
  leo: { symbol: '\u264C', element: 'fire', name: 'Leo', title: 'The Lion' },
  virgo: { symbol: '\u264D', element: 'earth', name: 'Virgo', title: 'The Maiden' },
  libra: { symbol: '\u264E', element: 'air', name: 'Libra', title: 'The Scales' },
  scorpio: { symbol: '\u264F', element: 'water', name: 'Scorpio', title: 'The Scorpion' },
  sagittarius: { symbol: '\u2650', element: 'fire', name: 'Sagittarius', title: 'The Archer' },
  capricorn: { symbol: '\u2651', element: 'earth', name: 'Capricorn', title: 'The Sea-Goat' },
  aquarius: { symbol: '\u2652', element: 'air', name: 'Aquarius', title: 'The Water Bearer' },
  pisces: { symbol: '\u2653', element: 'water', name: 'Pisces', title: 'The Fish' }
};

/**
 * Star positions and connection lines for each zodiac constellation.
 * Coordinates are normalized (0-1) and scaled during rendering.
 * @type {Object.<string, {stars: Array<{x: number, y: number, brightness: number}>, lines: Array<[number, number]>}>}
 */
export const CONSTELLATION_DATA = {
  aries: {
    stars: [
      { x: 0.3, y: 0.4, brightness: 1.0 },
      { x: 0.4, y: 0.45, brightness: 0.8 },
      { x: 0.5, y: 0.5, brightness: 0.6 },
      { x: 0.6, y: 0.55, brightness: 0.5 }
    ],
    lines: [[0, 1], [1, 2], [2, 3]]
  },
  taurus: {
    stars: [
      { x: 0.35, y: 0.5, brightness: 1.0 },
      { x: 0.45, y: 0.35, brightness: 0.7 },
      { x: 0.55, y: 0.45, brightness: 0.6 },
      { x: 0.5, y: 0.55, brightness: 0.5 },
      { x: 0.6, y: 0.6, brightness: 0.5 }
    ],
    lines: [[0, 2], [2, 1], [0, 3], [3, 4]]
  },
  gemini: {
    stars: [
      { x: 0.3, y: 0.3, brightness: 1.0 },
      { x: 0.35, y: 0.35, brightness: 0.9 },
      { x: 0.4, y: 0.5, brightness: 0.6 },
      { x: 0.5, y: 0.55, brightness: 0.5 },
      { x: 0.6, y: 0.5, brightness: 0.5 },
      { x: 0.65, y: 0.6, brightness: 0.4 }
    ],
    lines: [[0, 2], [2, 3], [1, 4], [4, 5]]
  },
  cancer: {
    stars: [
      { x: 0.4, y: 0.4, brightness: 0.7 },
      { x: 0.5, y: 0.45, brightness: 0.6 },
      { x: 0.55, y: 0.5, brightness: 0.5 },
      { x: 0.45, y: 0.55, brightness: 0.6 }
    ],
    lines: [[0, 1], [1, 2], [1, 3]]
  },
  leo: {
    stars: [
      { x: 0.3, y: 0.5, brightness: 1.0 },
      { x: 0.35, y: 0.4, brightness: 0.8 },
      { x: 0.45, y: 0.35, brightness: 0.7 },
      { x: 0.55, y: 0.4, brightness: 0.6 },
      { x: 0.65, y: 0.5, brightness: 0.7 },
      { x: 0.5, y: 0.55, brightness: 0.5 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [5, 0]]
  },
  virgo: {
    stars: [
      { x: 0.5, y: 0.5, brightness: 1.0 },
      { x: 0.4, y: 0.4, brightness: 0.7 },
      { x: 0.45, y: 0.35, brightness: 0.6 },
      { x: 0.55, y: 0.4, brightness: 0.6 },
      { x: 0.6, y: 0.55, brightness: 0.5 }
    ],
    lines: [[0, 1], [1, 2], [0, 3], [3, 4]]
  },
  libra: {
    stars: [
      { x: 0.4, y: 0.5, brightness: 0.8 },
      { x: 0.5, y: 0.4, brightness: 0.8 },
      { x: 0.6, y: 0.5, brightness: 0.7 },
      { x: 0.5, y: 0.6, brightness: 0.6 }
    ],
    lines: [[0, 1], [1, 2], [0, 3], [2, 3]]
  },
  scorpio: {
    stars: [
      { x: 0.3, y: 0.4, brightness: 1.0 },
      { x: 0.35, y: 0.45, brightness: 0.8 },
      { x: 0.4, y: 0.5, brightness: 0.7 },
      { x: 0.5, y: 0.55, brightness: 0.6 },
      { x: 0.6, y: 0.6, brightness: 0.6 },
      { x: 0.65, y: 0.55, brightness: 0.5 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
  },
  sagittarius: {
    stars: [
      { x: 0.3, y: 0.5, brightness: 0.8 },
      { x: 0.4, y: 0.45, brightness: 0.7 },
      { x: 0.5, y: 0.5, brightness: 0.8 },
      { x: 0.55, y: 0.4, brightness: 0.7 },
      { x: 0.6, y: 0.55, brightness: 0.6 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4]]
  },
  capricorn: {
    stars: [
      { x: 0.35, y: 0.45, brightness: 0.7 },
      { x: 0.45, y: 0.4, brightness: 0.8 },
      { x: 0.55, y: 0.45, brightness: 0.6 },
      { x: 0.6, y: 0.55, brightness: 0.5 },
      { x: 0.5, y: 0.6, brightness: 0.6 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]
  },
  aquarius: {
    stars: [
      { x: 0.3, y: 0.4, brightness: 0.7 },
      { x: 0.4, y: 0.45, brightness: 0.8 },
      { x: 0.5, y: 0.4, brightness: 0.7 },
      { x: 0.55, y: 0.5, brightness: 0.6 },
      { x: 0.6, y: 0.55, brightness: 0.5 },
      { x: 0.65, y: 0.6, brightness: 0.5 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]
  },
  pisces: {
    stars: [
      { x: 0.3, y: 0.5, brightness: 0.6 },
      { x: 0.4, y: 0.45, brightness: 0.7 },
      { x: 0.5, y: 0.5, brightness: 0.6 },
      { x: 0.55, y: 0.55, brightness: 0.5 },
      { x: 0.6, y: 0.5, brightness: 0.6 },
      { x: 0.65, y: 0.45, brightness: 0.5 }
    ],
    lines: [[0, 1], [1, 2], [2, 3], [2, 4], [4, 5]]
  }
};

/**
 * Color definitions for each element type (fire, earth, air, water).
 * @type {Object.<string, {primary: string, secondary: string, glow: string, star: string}>}
 */
export const ELEMENT_COLORS = {
  fire: { primary: '#FF8C00', secondary: '#DC143C', glow: 'rgba(255, 140, 0, 0.5)', star: '#FFD700' },
  earth: { primary: '#50C878', secondary: '#8B4513', glow: 'rgba(80, 200, 120, 0.5)', star: '#ADFF2F' },
  air: { primary: '#87CEEB', secondary: '#C0C0C0', glow: 'rgba(135, 206, 235, 0.5)', star: '#FFFFFF' },
  water: { primary: '#4169E1', secondary: '#7851A9', glow: 'rgba(120, 81, 169, 0.5)', star: '#E0FFFF' }
};

/** Get constellation data for a zodiac sign */
export function getConstellation(sign) {
  return CONSTELLATION_DATA[sign] || CONSTELLATION_DATA.aries;
}

/** Get zodiac info (symbol, element, name, title) */
export function getZodiacInfo(sign) {
  return ZODIAC_INFO[sign] || ZODIAC_INFO.aries;
}

/** Get element colors for a zodiac sign */
export function getElementColors(sign) {
  const info = ZODIAC_INFO[sign];
  return ELEMENT_COLORS[info?.element || 'fire'];
}
