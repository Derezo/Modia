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
    gold: '#c9a227',
    copper: '#b87333',
    ink: '#1a1a2e'
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
  fontFamily: "'Georgia', 'Times New Roman', serif",
  fontFamilyMono: "'Consolas', 'Monaco', monospace",

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
      --parchment-gold: ${PARCHMENT_COLORS.accent.gold};
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

export default {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  injectParchmentTheme,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentBorderDark,
  getParchmentShadow,
  getParchmentInsetShadow,
  getParchmentTextShadow
};
