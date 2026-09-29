/**
 * ItemStatRows - the one presentation for an item's stats and consumable effects.
 *
 * Every item detail view (item detail modal, equip modal comparison cards,
 * shop detail panel, marketplace sell / listing panels and buyer listing
 * cards) renders its stat block through this module, so the same item reads
 * the same everywhere:
 *   - full stat names in canonical order (getItemStatRows)
 *   - the summed base + bonus amount, with "(+10 base +3 bonus)" when an
 *     augment bonus adds to a base value
 *   - consumable effects (hp_restore and similar) as "Effect" rows, never as
 *     stats (formatItemEffects)
 * Augments are listed separately with renderAugmentList (AugmentList.js).
 *
 * @example
 *   el.innerHTML = renderItemStatRows(item);
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_SPACING,
  PARCHMENT_TYPOGRAPHY
} from '../ui/parchment/ParchmentTheme.js';
import { getItemStatRows, formatItemEffects } from '../utils/statDisplay.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const STYLE_ID = 'item-stat-rows-styles';

/**
 * Inject the shared stat row styles once per page.
 */
export function injectItemStatRowStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .item-stat-rows {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      display: flex;
      flex-direction: column;
      gap: 2px;
      text-align: left;
    }

    .item-stat-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: ${PARCHMENT_SPACING.sm};
      padding: 2px 0;
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      line-height: 1.35;
    }

    .item-stat-label {
      color: ${PARCHMENT_COLORS.text.secondary};
    }

    .item-stat-value {
      color: ${PARCHMENT_COLORS.state.success};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .item-stat-value--negative {
      color: ${PARCHMENT_COLORS.state.error};
    }

    .item-stat-breakdown {
      margin-left: ${PARCHMENT_SPACING.xs};
      color: ${PARCHMENT_COLORS.text.muted};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      font-weight: normal;
    }

    .item-stat-row--effect .item-stat-value {
      color: ${PARCHMENT_COLORS.text.primary};
      font-weight: normal;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Normalize text for the "description already says this" check.
 * @param {string} text - Text
 * @returns {string} Lowercase words
 */
function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

/**
 * Effect lines for an item, skipping any line its description already
 * states word for word ("Restores 50 HP when consumed." + "Restores 50 HP").
 * @param {Object} item - Item
 * @returns {string[]} Effect lines
 */
export function getItemEffectLines(item) {
  const description = normalizeText(item?.description);
  return formatItemEffects(item).filter(line => !(description && description.includes(normalizeText(line))));
}

/**
 * Render an item's stat rows followed by its consumable effect rows.
 * Injects the shared styles on first use.
 * @param {Object|null} item - Item in any API shape
 * @returns {string} HTML, or '' when the item has neither
 */
export function renderItemStatRows(item) {
  if (!item) return '';
  const statRows = getItemStatRows(item).map(({ label, amount, breakdown, negative, flag }) => `
      <div class="item-stat-row">
        <span class="item-stat-label">${escapeHtml(label)}</span>
        ${flag ? '' : `<span class="item-stat-value${negative ? ' item-stat-value--negative' : ''}">${escapeHtml(amount)}${breakdown ? `<span class="item-stat-breakdown">${escapeHtml(breakdown)}</span>` : ''}</span>`}
      </div>`);
  const effectRows = getItemEffectLines(item).map(line => `
      <div class="item-stat-row item-stat-row--effect">
        <span class="item-stat-label">Effect</span>
        <span class="item-stat-value">${escapeHtml(line)}</span>
      </div>`);
  const rows = [...statRows, ...effectRows];
  if (rows.length === 0) return '';
  injectItemStatRowStyles();
  return `<div class="item-stat-rows">${rows.join('')}</div>`;
}

export default renderItemStatRows;
