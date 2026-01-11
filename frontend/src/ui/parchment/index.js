/**
 * Parchment UI Components
 *
 * Medieval manuscript-styled UI components for Modia's game interface.
 *
 * Usage:
 *   import { ParchmentPanel, PARCHMENT_COLORS, injectParchmentTheme } from './ui/parchment/index.js';
 */

export {
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
  getParchmentTextShadow,
  // CSS generation utilities for consistent styling
  getParchmentPanelCSS,
  getParchmentInputCSS,
  getParchmentButtonCSS,
  getParchmentCardCSS,
  getParchmentHeaderCSS,
  getParchmentMutedTextCSS
} from './ParchmentTheme.js';

export { ParchmentPanel } from './ParchmentPanel.js';
export { ParchmentButton } from './ParchmentButton.js';
export { ParchmentInput } from './ParchmentInput.js';
export { ParchmentDropdown } from './ParchmentDropdown.js';
export { ParchmentModal } from './ParchmentModal.js';
export { ParchmentToastManager, parchmentToast } from './ParchmentToast.js';
export { ProfileDropdown } from './ProfileDropdown.js';
