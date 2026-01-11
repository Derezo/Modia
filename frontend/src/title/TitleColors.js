/**
 * Color palette for the title screen animation.
 * Derived from the parchment theme for visual consistency.
 */

export const TITLE_COLORS = {
  // Parchment tones (background, transitions)
  parchment: {
    light: '#d4c4a8',
    mid: '#c9b899',
    dark: '#bfae8a'
  },

  // Castle/stone colors
  stone: {
    lightest: '#9a9a8a',
    light: '#8a8a7a',
    mid: '#7a7a6a',
    dark: '#6a6a5a',
    darkest: '#5a5a4a',
    shadow: '#3a3a2a',
    mortar: '#5a5a4a'
  },

  // Water/river colors
  water: {
    deep: '#1a5276',
    mid: '#2a4a6a',
    light: '#4a6a8a',
    surface: '#3498db',
    foam: '#d4e6f1',
    sparkle: '#ffffff'
  },

  // Forest/tree colors
  forest: {
    canopyDark: '#2a4a1a',
    canopyMid: '#3a5a2a',
    canopyLight: '#4a6a3a',
    trunk: '#5a4030',
    trunkDark: '#3d2817'
  },

  // Path/road colors
  path: {
    light: '#c9a980',
    mid: '#a98960',
    dark: '#897040',
    shadow: '#5a4030'
  },

  // Wood (drawbridge, structures)
  wood: {
    light: '#6a5040',
    mid: '#5c4033',
    dark: '#3d2817',
    plank: '#5a4030'
  },

  // Metal (armor, chains, bands)
  metal: {
    light: '#9a9a9a',
    mid: '#7a7a8a',
    dark: '#5a5a6a',
    chain: '#6a6a7a',
    armor: '#8a8a9a'
  },

  // Soldier colors
  soldier: {
    armor: '#8a8a9a',
    armorDark: '#6a6a7a',
    skin: '#dab894',
    boots: '#4a3020',
    sword: '#c0c0d0',
    swordHandle: '#8b7355'
  },

  // Goblin colors
  goblin: {
    skin: '#6a8a4a',
    skinDark: '#5a7a3a',
    skinLight: '#7a9a5a',
    eyes: '#ff4444',
    cloth: '#5a4a3a',
    weapon: '#5a4030'
  },

  // Bat colors
  bat: {
    body: '#3a3a4a',
    wing: '#5a5a6a',
    wingMembrane: '#2a1a3a',
    eyes: '#ff6666'
  },

  // Slime colors
  slime: {
    body: '#4a8a4a',
    highlight: '#6aaa6a',
    dark: '#2a6a2a',
    core: '#3a7a3a',
    shine: 'rgba(255, 255, 255, 0.4)'
  },

  // Effect colors (light burst, particles)
  effects: {
    white: '#ffffff',
    gold: '#ffd700',
    goldDark: '#c9a227',
    copper: '#b87333',
    cream: '#fff8dc',
    burst: '#ffffaa',
    glow: 'rgba(255, 215, 0, 0.6)'
  },

  // Dust/particle colors
  dust: {
    light: '#d4c4a8',
    mid: '#c9b899',
    dark: '#8b7355'
  },

  // UI colors
  ui: {
    textLight: '#f0e8d8',
    textDark: '#2d2418',
    shadow: 'rgba(0, 0, 0, 0.5)'
  },

  // Flag colors
  flag: {
    primary: '#c9a227',
    secondary: '#8b0000'
  },

  // Stormy sky colors
  storm: {
    skyDark: '#2a2a3a',
    skyMid: '#3a3a4a',
    skyLight: '#4a4a5a',
    cloudDark: '#3c3c46',
    cloudMid: '#5a5a6a',
    cloudLight: '#6a6a7a',
    lightning: '#ffffff',
    lightningGlow: '#eeeeff',
    rain: '#8a9aaa',
    groundDark: '#1a2a1a',
    groundMid: '#2a3a2a',
    groundLight: '#3a4a3a'
  }
};

/**
 * Helper to create rgba version of a hex color
 */
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
