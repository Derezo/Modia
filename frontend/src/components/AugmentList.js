/**
 * AugmentList - the one presentation for an item's augments.
 *
 * Used wherever an item's augments are listed in a detail view (item detail
 * modal, shop detail panel, equip modal, marketplace sell and listing panels)
 * so every screen shows the same line: icon, bold augment name, its effect,
 * a note when the stat roll is already counted in the stats above, and a
 * short muted "not yet active" tag for effects the server does not apply.
 *
 * @example
 *   el.innerHTML = renderAugmentList(item.augments);
 */

import { Icon } from './Icon.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS
} from '../ui/parchment/ParchmentTheme.js';
import { describeAugment, resolveAugmentIconName } from '../utils/statDisplay.js';
import { escapeHtml, escapeHtmlAttribute } from '../utils/escapeHtml.js';

const STYLE_ID = 'augment-list-styles';

/**
 * Inject the shared augment line styles once per page.
 */
export function injectAugmentListStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .item-detail-augments {
      display: flex;
      flex-direction: column;
      gap: ${PARCHMENT_SPACING.xs};
    }

    .item-detail-augment {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.sm};
      padding: ${PARCHMENT_SPACING.xs};
      background: ${PARCHMENT_COLORS.dark};
      border-radius: ${PARCHMENT_RADIUS.sm};
      text-align: left;
    }

    .item-detail-augment-icon {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: rgba(61, 41, 20, 0.55);
    }

    .item-detail-augment-text {
      flex: 1;
      min-width: 0;
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      line-height: 1.35;
      color: ${PARCHMENT_COLORS.text.primary};
    }

    .item-detail-augment-name {
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      color: ${PARCHMENT_COLORS.text.secondary};
    }

    /* Informational: the stat is already summed into the stats above */
    .item-detail-augment-stat {
      color: ${PARCHMENT_COLORS.text.secondary};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
    }

    .item-detail-augment--inactive .item-detail-augment-effect {
      color: ${PARCHMENT_COLORS.text.muted};
    }

    .item-detail-augment-tag {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      font-style: italic;
      color: ${PARCHMENT_COLORS.text.muted};
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Render one augment line.
 * @param {Object|string} aug - Augment object or category string
 * @returns {string} HTML
 */
export function renderAugmentLine(aug) {
  const iconName = resolveAugmentIconName(aug);
  const { name, effect: effectText, statText, active } = describeAugment(aug);
  const inactive = typeof aug === 'object' && aug !== null && !active;
  // A stat_bonus augment's whole effect, and a rolled augment's stat roll,
  // are already summed into the stats. Name the augment and point up instead
  // of printing the same number a second time.
  const isStatBonus = typeof aug === 'object' && aug?.effect?.type === 'stat_bonus';
  const includedAbove = isStatBonus || Boolean(statText);
  const effect = isStatBonus ? '' : effectText;
  const label = name || (isStatBonus ? 'Stat bonus' : '');
  if (!label && !effect) return '';

  return `
      <div class="item-detail-augment${inactive ? ' item-detail-augment--inactive' : ''}">
        <span class="item-detail-augment-icon">
          ${Icon.html('augments', iconName, { size: 'sm', title: label || effectText }) || ''}
        </span>
        <span class="item-detail-augment-text">
          ${label ? `<span class="item-detail-augment-name">${escapeHtml(label)}</span>${effect ? ': ' : ''}` : ''}
          ${effect ? `<span class="item-detail-augment-effect">${escapeHtml(effect)}</span>` : ''}
          ${includedAbove ? ` <span class="item-detail-augment-stat" title="${escapeHtmlAttribute(statText || effectText)}, already counted in the stats above">(${effect ? 'stat bonus ' : ''}included above)</span>` : ''}
        </span>
        ${inactive && effect ? '<span class="item-detail-augment-tag" title="This effect is shown for reference and is not yet applied in combat">not yet active</span>' : ''}
      </div>
    `;
}

/**
 * Render a list of augments (empty string when there are none).
 * Injects the shared styles on first use.
 * @param {Array<Object|string>} augments - Augments
 * @returns {string} HTML
 */
export function renderAugmentList(augments) {
  if (!Array.isArray(augments) || augments.length === 0) return '';
  injectAugmentListStyles();
  const lines = augments.map(renderAugmentLine).filter(Boolean).join('');
  return lines ? `<div class="item-detail-augments">${lines}</div>` : '';
}

export default renderAugmentList;
