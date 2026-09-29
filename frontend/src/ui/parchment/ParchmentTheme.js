/**
 * ParchmentTheme - CSS variables and color constants for the parchment UI theme
 *
 * Provides a consistent medieval manuscript aesthetic across all parchment components.
 * Colors are warm tans, browns, and sepia tones reminiscent of aged paper.
 *
 * Usage:
 *   import { PARCHMENT_COLORS, injectParchmentTheme } from './ParchmentTheme.js';
 *   injectParchmentTheme(); // Call once at app initialization
 */

/**
 * Core color palette for parchment components
 */
export const PARCHMENT_COLORS = {
  // Background tones (light to dark)
  light: '#d4c4a8',
  mid: '#c9b899',
  dark: '#bfae8a',

  // Border colors
  border: '#8b7355',
  borderDark: '#6b5344',
  borderLight: '#a08565',

  // Text colors
  text: {
    primary: '#2d2418',
    secondary: '#5a4a3a',
    muted: '#7a6a5a',
    inverse: '#f0e8d8'
  },

  // Semantic state colors (muted to fit parchment aesthetic)
  state: {
    success: '#4a7548',
    error: '#8b4444',
    warning: '#c9a227',
    info: '#4a6088'
  },

  // Additional accent colors
  accent: {
    burgundy: '#6b2d3d',  // Primary accent for text highlights, headers, and decorations
    copper: '#b87333',    // Secondary accent, good for borders and highlights
    ink: '#1a1a2e'        // Dark accent for shadows and emphasis
  },

  // Element/skill type colors (muted to fit parchment aesthetic)
  element: {
    fire: { bg: 'rgba(180, 80, 60, 0.15)', border: '#a85040', text: '#8b4030', icon: '🔥' },
    ice: { bg: 'rgba(70, 130, 180, 0.15)', border: '#4080a0', text: '#305070', icon: '❄️' },
    lightning: { bg: 'rgba(180, 160, 60, 0.15)', border: '#a09030', text: '#706020', icon: '⚡' },
    wind: { bg: 'rgba(120, 180, 160, 0.15)', border: '#609080', text: '#406050', icon: '💨' },
    earth: { bg: 'rgba(140, 120, 80, 0.15)', border: '#8a7040', text: '#604830', icon: '🪨' },
    water: { bg: 'rgba(70, 130, 160, 0.15)', border: '#407090', text: '#305060', icon: '💧' },
    light: { bg: 'rgba(200, 180, 100, 0.15)', border: '#b0a050', text: '#807030', icon: '✨' },
    dark: { bg: 'rgba(80, 70, 100, 0.15)', border: '#504060', text: '#403050', icon: '🌑' },
    passive: { bg: 'rgba(70, 140, 90, 0.15)', border: '#4a8050', text: '#3a6040', icon: '🛡️' },
    physical: { bg: 'rgba(140, 100, 70, 0.15)', border: '#8a6040', text: '#604030', icon: '⚔️' }
  },

  // Shadow and overlay
  shadow: 'rgba(0, 0, 0, 0.3)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  highlight: 'rgba(255, 255, 255, 0.3)'
};

/**
 * Typography settings for parchment components
 */
export const PARCHMENT_TYPOGRAPHY = {
  fontFamily: '\'Georgia\', \'Times New Roman\', serif',
  fontFamilyMono: '\'Consolas\', \'Monaco\', monospace',

  sizes: {
    xs: '10px',
    sm: '12px',
    base: '14px',
    lg: '16px',
    xl: '18px',
    xxl: '24px'
  },

  weights: {
    normal: '400',
    bold: '700'
  },

  lineHeight: '1.4'
};

/**
 * Spacing values for consistent layout
 */
export const PARCHMENT_SPACING = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  xxl: '24px'
};

/**
 * Border radius values
 */
export const PARCHMENT_RADIUS = {
  sm: '2px',
  md: '4px',
  lg: '6px'
};

/**
 * Color constants for the World Map HUD panel
 * Used by WorldMapHUDPanel and its segments (Stamina, Travel, Zodiac)
 */
export const HUD_COLORS = {
  // Frame colors for clean wood border with subtle brass accent
  frame: {
    outer: '#3d2914',           // Dark wood
    inner: '#5a4030',           // Mid wood for bevel
    accent: '#8b7355',          // Muted brass/bronze
  },

  // Panel background
  panel: {
    background: 'rgba(60, 45, 30, 0.92)',
    divider: 'rgba(139, 115, 85, 0.5)',
  },

  // Stamina bar colors
  stamina: {
    full: '#ffd700',
    mid: '#daa520',
    low: '#b8860b',
    empty: 'rgba(0, 0, 0, 0.5)',
    shimmer: 'rgba(255, 255, 255, 0.4)',
    wave: 'rgba(255, 223, 128, 0.3)',
  },

  // Zodiac crystal colors
  zodiac: {
    collected: '#ffd700',
    empty: 'rgba(139, 115, 85, 0.3)',
    glow: 'rgba(255, 215, 0, 0.6)',
    pulse: 'rgba(255, 215, 0, 0.8)',
  },

  // Element colors for zodiac signs
  element: {
    fire: { primary: '#FF8C00', secondary: '#DC143C', glow: 'rgba(255, 140, 0, 0.5)' },
    earth: { primary: '#50C878', secondary: '#8B4513', glow: 'rgba(80, 200, 120, 0.5)' },
    air: { primary: '#87CEEB', secondary: '#C0C0C0', glow: 'rgba(135, 206, 235, 0.5)' },
    water: { primary: '#000080', secondary: '#7851A9', glow: 'rgba(120, 81, 169, 0.5)' },
  },

  // Travel bar colors
  travel: {
    fill: '#daa520',
    background: 'rgba(0, 0, 0, 0.5)',
    text: '#c4a574',
  }
};

const STYLE_ID = 'parchment-theme-styles';

/**
 * Inject CSS custom properties into the document root
 * Only injects once, checking for existing style tag by ID
 */
export function injectParchmentTheme() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      /* Parchment background colors */
      --parchment-light: ${PARCHMENT_COLORS.light};
      --parchment-mid: ${PARCHMENT_COLORS.mid};
      --parchment-dark: ${PARCHMENT_COLORS.dark};

      /* Parchment border colors */
      --parchment-border: ${PARCHMENT_COLORS.border};
      --parchment-border-dark: ${PARCHMENT_COLORS.borderDark};
      --parchment-border-light: ${PARCHMENT_COLORS.borderLight};

      /* Parchment text colors */
      --parchment-text-primary: ${PARCHMENT_COLORS.text.primary};
      --parchment-text-secondary: ${PARCHMENT_COLORS.text.secondary};
      --parchment-text-muted: ${PARCHMENT_COLORS.text.muted};
      --parchment-text-inverse: ${PARCHMENT_COLORS.text.inverse};

      /* Parchment state colors */
      --parchment-success: ${PARCHMENT_COLORS.state.success};
      --parchment-error: ${PARCHMENT_COLORS.state.error};
      --parchment-warning: ${PARCHMENT_COLORS.state.warning};
      --parchment-info: ${PARCHMENT_COLORS.state.info};

      /* Parchment accents */
      --parchment-burgundy: ${PARCHMENT_COLORS.accent.burgundy};
      --parchment-copper: ${PARCHMENT_COLORS.accent.copper};
      --parchment-ink: ${PARCHMENT_COLORS.accent.ink};

      /* Parchment effects */
      --parchment-shadow: ${PARCHMENT_COLORS.shadow};
      --parchment-overlay: ${PARCHMENT_COLORS.overlay};
      --parchment-highlight: ${PARCHMENT_COLORS.highlight};

      /* Parchment typography */
      --parchment-font: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      --parchment-font-mono: ${PARCHMENT_TYPOGRAPHY.fontFamilyMono};

      /* Parchment spacing */
      --parchment-spacing-xs: ${PARCHMENT_SPACING.xs};
      --parchment-spacing-sm: ${PARCHMENT_SPACING.sm};
      --parchment-spacing-md: ${PARCHMENT_SPACING.md};
      --parchment-spacing-lg: ${PARCHMENT_SPACING.lg};
      --parchment-spacing-xl: ${PARCHMENT_SPACING.xl};
      --parchment-spacing-xxl: ${PARCHMENT_SPACING.xxl};

      /* Parchment radius */
      --parchment-radius-sm: ${PARCHMENT_RADIUS.sm};
      --parchment-radius-md: ${PARCHMENT_RADIUS.md};
      --parchment-radius-lg: ${PARCHMENT_RADIUS.lg};
    }
  `;

  document.head.appendChild(style);
}

/**
 * Get a CSS gradient string for parchment backgrounds
 * @param {string} direction - CSS gradient direction (default: 'to bottom')
 * @returns {string} CSS gradient value
 */
export function getParchmentGradient(direction = 'to bottom') {
  return `linear-gradient(${direction}, ${PARCHMENT_COLORS.light} 0%, ${PARCHMENT_COLORS.mid} 50%, ${PARCHMENT_COLORS.dark} 100%)`;
}

/**
 * Get a CSS gradient string with paper texture overlay effect
 * @param {string} direction - CSS gradient direction (default: 'to bottom')
 * @returns {string} CSS gradient value with texture
 */
export function getParchmentGradientTextured(direction = 'to bottom') {
  return `
    linear-gradient(135deg, rgba(180, 160, 130, 0.1) 0%, transparent 50%),
    linear-gradient(225deg, rgba(100, 80, 60, 0.1) 0%, transparent 50%),
    linear-gradient(${direction}, ${PARCHMENT_COLORS.light} 0%, ${PARCHMENT_COLORS.mid} 50%, ${PARCHMENT_COLORS.dark} 100%)
  `.trim();
}

/**
 * Get the standard parchment border style
 * @param {number} width - Border width in pixels (default: 2)
 * @returns {string} CSS border value
 */
export function getParchmentBorder(width = 2) {
  return `${width}px solid ${PARCHMENT_COLORS.border}`;
}

/**
 * Get a darker variant of the parchment border
 * @param {number} width - Border width in pixels (default: 2)
 * @returns {string} CSS border value
 */
export function getParchmentBorderDark(width = 2) {
  return `${width}px solid ${PARCHMENT_COLORS.borderDark}`;
}

/**
 * Get the standard parchment box shadow
 * @param {boolean} elevated - Whether to use elevated (larger) shadow
 * @returns {string} CSS box-shadow value
 */
export function getParchmentShadow(elevated = false) {
  const baseShadow = elevated
    ? '0 8px 24px rgba(0, 0, 0, 0.4)'
    : '0 3px 8px rgba(0, 0, 0, 0.3)';

  return `${baseShadow}, inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -1px 0 rgba(0, 0, 0, 0.1)`;
}

/**
 * Get an inset shadow for recessed elements
 * @returns {string} CSS box-shadow value
 */
export function getParchmentInsetShadow() {
  return 'inset 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 -1px 0 rgba(255, 255, 255, 0.2)';
}

/**
 * Get text shadow for readable text on parchment
 * @returns {string} CSS text-shadow value
 */
export function getParchmentTextShadow() {
  return '0 1px 0 rgba(255, 255, 255, 0.3)';
}

/**
 * Get complete CSS properties for a standard parchment panel
 * Use this for consistent panel styling across scenes
 * @returns {string} CSS properties block
 */
export function getParchmentPanelCSS() {
  return `
    background: ${getParchmentGradient()};
    border: ${getParchmentBorder()};
    box-shadow: ${getParchmentShadow()};
    border-radius: ${PARCHMENT_RADIUS.md};
    color: ${PARCHMENT_COLORS.text.primary};
    font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
  `.trim();
}

/**
 * Get complete CSS properties for a standard parchment input
 * @param {Object} options - Optional style overrides
 * @param {boolean} options.focused - Include focus state styles
 * @returns {string} CSS properties block
 */
export function getParchmentInputCSS(options = {}) {
  const base = `
    background: ${PARCHMENT_COLORS.light};
    border: 1px solid ${PARCHMENT_COLORS.border};
    border-radius: ${PARCHMENT_RADIUS.sm};
    color: ${PARCHMENT_COLORS.text.primary};
    padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
    font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
    outline: none;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  `.trim();

  if (options.focused) {
    return `${base}
    border-color: ${PARCHMENT_COLORS.borderDark};
    box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.2);`;
  }

  return base;
}

/**
 * Get complete CSS properties for a parchment button
 * @param {string} variant - 'primary' | 'secondary' | 'danger' | 'ghost'
 * @returns {string} CSS properties block
 */
export function getParchmentButtonCSS(variant = 'primary') {
  const base = `
    font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
    font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    border-radius: ${PARCHMENT_RADIUS.md};
    padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.lg};
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
    text-decoration: none;
    display: inline-block;
  `.trim();

  const variants = {
    primary: `
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.border} 0%, ${PARCHMENT_COLORS.borderDark} 100%);
      color: ${PARCHMENT_COLORS.text.inverse};
      border: 1px solid ${PARCHMENT_COLORS.borderDark};
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    `.trim(),
    secondary: `
      background: ${PARCHMENT_COLORS.light};
      color: ${PARCHMENT_COLORS.text.primary};
      border: 1px solid ${PARCHMENT_COLORS.border};
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    `.trim(),
    danger: `
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.state.error} 0%, #6b3333 100%);
      color: ${PARCHMENT_COLORS.text.inverse};
      border: 1px solid #6b3333;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    `.trim(),
    ghost: `
      background: transparent;
      color: ${PARCHMENT_COLORS.text.primary};
      border: 1px solid transparent;
      box-shadow: none;
    `.trim()
  };

  return `${base}\n${variants[variant] || variants.primary}`;
}

/**
 * Get CSS for a parchment card (elevated panel with hover effects)
 * @param {Object} options - Card options
 * @param {boolean} options.selected - If card is in selected state
 * @param {boolean} options.hoverable - If card should have hover effects
 * @returns {string} CSS properties block
 */
export function getParchmentCardCSS(options = {}) {
  let css = `
    ${getParchmentPanelCSS()}
    padding: ${PARCHMENT_SPACING.md};
  `.trim();

  if (options.hoverable) {
    css += `
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;`;
  }

  if (options.selected) {
    css += `
    border-color: ${PARCHMENT_COLORS.accent.burgundy};
    box-shadow: ${getParchmentShadow(true)}, 0 0 0 2px ${PARCHMENT_COLORS.accent.burgundy};`;
  }

  return css;
}

/**
 * Get CSS for section headers in parchment UI
 * @returns {string} CSS properties block
 */
export function getParchmentHeaderCSS() {
  return `
    color: ${PARCHMENT_COLORS.text.primary};
    font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
    font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    text-shadow: ${getParchmentTextShadow()};
    margin: 0 0 ${PARCHMENT_SPACING.md} 0;
    padding-bottom: ${PARCHMENT_SPACING.sm};
    border-bottom: 1px solid ${PARCHMENT_COLORS.border};
  `.trim();
}

/**
 * Get CSS for muted/secondary text
 * @returns {string} CSS properties block
 */
export function getParchmentMutedTextCSS() {
  return `
    color: ${PARCHMENT_COLORS.text.muted};
    font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
  `.trim();
}

/**
 * Get CSS for themed scrollbars with parchment styling
 * @param {string} selector - CSS selector prefix for scoped scrollbar styles
 * @returns {string} CSS block for scrollbar styling
 */
export function getParchmentScrollbarCSS(selector = '') {
  // With a selector, style the element's own scrollbar AND its descendants'.
  // A bare "sel ::-webkit-scrollbar" only matches descendants, which left the
  // scroll containers themselves with white native scrollbars.
  const sel = (pseudo) => (selector
    ? `${selector}${pseudo}, ${selector} ${pseudo}`
    : pseudo);
  return `
    ${sel('::-webkit-scrollbar')} {
      width: 10px;
      height: 10px;
    }
    ${sel('::-webkit-scrollbar-track')} {
      background: ${PARCHMENT_COLORS.mid};
      border-radius: 5px;
    }
    ${sel('::-webkit-scrollbar-thumb')} {
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.border}, ${PARCHMENT_COLORS.borderDark});
      border-radius: 5px;
      border: 2px solid ${PARCHMENT_COLORS.mid};
    }
    ${sel('::-webkit-scrollbar-thumb:hover')} {
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.borderLight}, ${PARCHMENT_COLORS.border});
    }
    ${sel('::-webkit-scrollbar-corner')} {
      background: ${PARCHMENT_COLORS.mid};
    }
  `.trim();
}

/**
 * Get CSS for a parchment loading spinner
 * @returns {string} CSS block for spinner styling
 */
export function getParchmentSpinnerCSS() {
  return `
    .parchment-spinner {
      width: 24px;
      height: 24px;
      border: 3px solid ${PARCHMENT_COLORS.mid};
      border-top-color: ${PARCHMENT_COLORS.border};
      border-radius: 50%;
      animation: parchment-spin 0.8s linear infinite;
    }
    @keyframes parchment-spin {
      to { transform: rotate(360deg); }
    }
  `.trim();
}

export default {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  HUD_COLORS,
  injectParchmentTheme,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentBorderDark,
  getParchmentShadow,
  getParchmentInsetShadow,
  getParchmentTextShadow,
  getParchmentPanelCSS,
  getParchmentInputCSS,
  getParchmentButtonCSS,
  getParchmentCardCSS,
  getParchmentHeaderCSS,
  getParchmentMutedTextCSS,
  getParchmentScrollbarCSS,
  getParchmentSpinnerCSS
};
