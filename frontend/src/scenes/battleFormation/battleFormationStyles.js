/**
 * @module battleFormationStyles
 * @description CSS stylesheet for BattleFormationScene component.
 *
 * Includes responsive layouts for desktop, tablet, and mobile views,
 * styling for roster characters, enemy cards, countdown timer,
 * and mobile bottom sheet.
 *
 * @see BattleFormationScene.js - Main scene that injects these styles
 */
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentBorder
} from '../../ui/parchment/index.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

/**
 * Returns the complete CSS stylesheet for BattleFormationScene.
 * @returns {string} CSS stylesheet content
 */
export function getBattleFormationStyles() {
  return `
      /* ========== LAYOUT ========== */

      .bf-formation-header {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: ${P.shadow};
        border-bottom: ${getParchmentBorder()};
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.lg};
      }

      .bf-formation-header--mobile {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
      }

      .bf-back-btn {
        background: ${P.shadow};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        color: ${P.text.muted};
        cursor: pointer;
        transition: all 0.2s;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .bf-back-btn:hover {
        background: rgba(139, 115, 85, 0.3);
        color: ${P.text.inverse};
      }

      .bf-back-icon {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      }

      .bf-header-titles {
        flex: 1;
      }

      .bf-battle-title-animated {
        margin: 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        background: linear-gradient(90deg, ${P.accent.burgundy} 0%, ${P.accent.copper} 25%, ${P.accent.burgundy} 50%, ${P.accent.copper} 75%, ${P.accent.burgundy} 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: bf-shimmer-gold 3s linear infinite;
        text-transform: uppercase;
        letter-spacing: 2px;
      }

      .bf-battle-title--mobile {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      }

      @keyframes bf-shimmer-gold {
        0% { background-position: 0% center; }
        100% { background-position: 200% center; }
      }

      .bf-node-name {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        margin-top: ${PARCHMENT_SPACING.xs};
      }

      /* ========== COUNTDOWN TIMER (COLISEUM) ========== */

      .bf-countdown-timer {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: rgba(0, 0, 0, 0.4);
        border-radius: ${PARCHMENT_RADIUS.lg};
        margin-left: auto;
      }

      .bf-countdown-timer.urgent {
        background: rgba(139, 0, 0, 0.4);
        animation: bf-pulse-urgent 0.5s ease-in-out infinite;
      }

      .bf-timer-label {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      .bf-timer-value {
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        min-width: 2ch;
        text-align: center;
      }

      .bf-countdown-timer.urgent .bf-timer-value {
        color: ${P.state.error};
      }

      @keyframes bf-pulse-urgent {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      /* ========== MAIN CONTENT (DESKTOP) ========== */

      .bf-formation-main {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      /* Side Drawer */
      .bf-formation-drawer {
        width: 280px;
        min-width: 280px;
        max-width: 280px;
        background: rgba(0, 0, 0, 0.4);
        border-right: ${getParchmentBorder()};
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .bf-drawer-header {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderDark};
      }

      .bf-drawer-title {
        /* The drawer is a dark translucent panel: light text to be legible */
        color: ${P.text.inverse};
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .bf-drawer-roster {
        flex: 1;
        padding: ${PARCHMENT_SPACING.md};
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .bf-drawer-divider {
        height: 2px;
        background: linear-gradient(90deg, transparent, ${P.border}, transparent);
        margin: ${PARCHMENT_SPACING.sm} 0;
      }

      .bf-drawer-detail {
        padding: ${PARCHMENT_SPACING.md};
        min-height: 120px;
      }

      /* Center Content */
      .bf-formation-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* ========== ENEMY SECTION ========== */

      .bf-enemy-section {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: rgba(139, 0, 0, 0.15);
        border-bottom: 1px solid ${P.state.error};
      }

      .bf-enemy-section--mobile {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        overflow-x: auto;
      }

      .bf-enemy-label {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .bf-enemy-roster {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        justify-content: center;
        flex-wrap: wrap;
      }

      .bf-enemy-roster--mobile {
        flex-wrap: nowrap;
        justify-content: flex-start;
      }

      .bf-enemy-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: ${PARCHMENT_SPACING.sm};
        background: ${P.shadow};
        border: 2px solid ${P.state.error};
        border-radius: ${PARCHMENT_RADIUS.lg};
        min-width: 70px;
        transition: all 0.2s;
      }

      .bf-enemy-card.bf-threat-boss {
        border-color: #8b0000;
        box-shadow: 0 0 10px rgba(139, 0, 0, 0.4);
      }

      .bf-enemy-portrait {
        position: relative;
        width: 40px;
        height: 40px;
        background: rgba(139, 0, 0, 0.4);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: ${PARCHMENT_SPACING.xs};
        overflow: hidden;
      }

      .bf-enemy-icon {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .bf-enemy-portrait-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
      }

      .bf-boss-indicator {
        position: absolute;
        top: -4px;
        right: -4px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        color: #ff0000;
      }

      .bf-enemy-info {
        text-align: center;
      }

      .bf-enemy-name {
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        white-space: nowrap;
      }

      .bf-enemy-level {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: var(--font-size-sm, 12px);
      }

      .bf-threat-aura {
        position: absolute;
        inset: -4px;
        border-radius: ${PARCHMENT_RADIUS.lg};
        border: 2px solid rgba(255, 0, 0, 0.3);
        animation: bf-threat-pulse 2s ease-in-out infinite;
        pointer-events: none;
      }

      @keyframes bf-threat-pulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
      }

      .bf-enemy-unknown {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-style: italic;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* ========== GRID AREA ========== */

      .bf-grid-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.lg};
      }

      .bf-grid-area--mobile {
        padding: ${PARCHMENT_SPACING.sm};
      }

      #bf-formation-grid-canvas {
        border-radius: ${PARCHMENT_RADIUS.lg};
        max-width: 100%;
        /* Finding 79: Canvas size is set dynamically via ResizeObserver */
      }

      .bf-grid-instructions {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        margin-top: ${PARCHMENT_SPACING.md};
        text-align: center;
      }

      /* ========== START SECTION ========== */

      .bf-start-section {
        padding: ${PARCHMENT_SPACING.lg};
        display: flex;
        justify-content: center;
        background: ${P.shadow};
        border-top: 1px solid ${P.borderDark};
      }

      .bf-start-section--mobile {
        padding: ${PARCHMENT_SPACING.md};
        position: sticky;
        bottom: 0;
      }

      /* ========== ROSTER CHARACTERS ========== */

      .bf-roster-char {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: ${P.shadow};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        cursor: pointer;
        transition: all 0.2s;
      }

      .bf-roster-char:hover {
        background: rgba(139, 115, 85, 0.3);
        border-color: ${P.borderLight};
      }

      .bf-roster-char.selected {
        border-color: ${P.accent.burgundy};
        background: rgba(107, 45, 61, 0.1);
      }

      .bf-roster-char.placed {
        opacity: 0.6;
      }

      .bf-roster-char.placed .bf-roster-portrait {
        filter: grayscale(0.5);
      }

      .bf-roster-portrait {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: ${PARCHMENT_RADIUS.md};
        overflow: hidden;
        border: ${getParchmentBorder()};
      }

      .bf-roster-portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        image-rendering: pixelated;
      }

      .bf-roster-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      }

      .bf-placed-check {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 16px;
        height: 16px;
        background: ${P.state.success};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${P.text.inverse};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .bf-roster-name {
        flex: 1;
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bf-all-placed {
        color: ${P.state.success};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        text-align: center;
        padding: ${PARCHMENT_SPACING.lg};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      /* ========== MOBILE BOTTOM SHEET ========== */

      .bf-bottom-sheet {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(20, 20, 35, 0.95);
        border-top: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg} ${PARCHMENT_RADIUS.lg} 0 0;
        transform: translateY(calc(100% - 48px));
        transition: transform 0.3s ease;
        max-height: 60vh;
        z-index: 100;
      }

      .bf-bottom-sheet.expanded {
        transform: translateY(0);
      }

      .bf-sheet-handle {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        cursor: pointer;
      }

      .bf-handle-bar {
        width: 40px;
        height: 4px;
        background: ${P.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        margin: 0 auto;
      }

      .bf-sheet-title {
        flex: 1;
        color: ${P.text.primary};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-align: center;
      }

      .bf-sheet-content {
        padding: 0 ${PARCHMENT_SPACING.lg} ${PARCHMENT_SPACING.lg};
        overflow-y: auto;
        max-height: calc(60vh - 48px);
      }

      /* ========== RESPONSIVE ========== */

      /* Mobile breakpoint (<600px) - use CSS vars from responsive singleton */
      @media (max-width: 600px) {
        .bf-formation-drawer {
          display: none;
        }

        .bf-formation-header {
          padding: var(--space-sm, 8px) var(--space-md, 12px);
          gap: var(--space-sm, 8px);
        }

        .bf-back-btn {
          min-height: var(--touch-target, 44px);
          min-width: var(--touch-target, 44px);
          padding: var(--space-sm, 8px);
        }

        .bf-enemy-roster {
          justify-content: flex-start;
          flex-wrap: nowrap;
          overflow-x: auto;
          padding-bottom: ${PARCHMENT_SPACING.sm};
          -webkit-overflow-scrolling: touch;
        }

        .bf-enemy-card {
          flex-shrink: 0;
          min-width: var(--touch-target, 44px);
          padding: var(--space-sm, 8px);
        }

        .bf-roster-char {
          min-height: var(--touch-target, 44px);
          padding: var(--space-sm, 8px) var(--space-md, 12px);
        }

        .bf-roster-portrait {
          width: var(--touch-target, 44px);
          height: var(--touch-target, 44px);
        }

        .bf-roster-name {
          font-size: var(--font-size-md, 14px);
        }

        .bf-start-section--mobile {
          padding: var(--space-md, 12px);
        }

        .bf-bottom-sheet {
          max-height: 70vh;
        }

        .bf-sheet-handle {
          min-height: var(--touch-target, 44px);
          padding: var(--space-md, 12px) var(--space-lg, 16px);
        }

        .bf-sheet-content {
          padding: 0 var(--space-md, 12px) var(--space-md, 12px);
          max-height: calc(70vh - var(--touch-target, 44px));
        }

        .bf-grid-area--mobile {
          padding: var(--space-sm, 8px);
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .bf-enemy-section--mobile {
          padding: var(--space-sm, 8px) var(--space-md, 12px);
        }

        .bf-countdown-timer {
          padding: var(--space-xs, 4px) var(--space-sm, 8px);
        }

        .bf-timer-label {
          font-size: var(--font-size-sm, 12px);
        }

        .bf-timer-value {
          font-size: var(--font-size-lg, 18px);
        }
      }

      /* Tablet breakpoint (600-900px) */
      @media (min-width: 601px) and (max-width: 900px) {
        .bf-formation-drawer {
          width: 240px;
          min-width: 240px;
          max-width: 240px;
        }

        .bf-roster-portrait {
          width: var(--touch-target, 40px);
          height: var(--touch-target, 40px);
        }
      }
    `;
}
