/**
 * Shop detail panel helpers: the "Vs Equipped" comparison and the unmet
 * level requirement, from the party in game state (GET /characters rows,
 * which carry `equipment: { [slot]: { baseStats, bonusStats } }`).
 */

import { escapeHtml } from '../../utils/escapeHtml.js';
import {
  calculateStatChanges,
  formatStatChanges,
  getItemStatSources,
  matchesEquipmentSlot,
  getEquipRestriction
} from '../../utils/statDisplay.js';

/**
 * The item's level requirement when no party member meets it, else 0.
 * An unknown party (no characters loaded) is not treated as unmet.
 * @param {Object} item - Shop item (levelRequirement / level_requirement)
 * @param {Array<Object>} characters - Party characters (level)
 * @returns {number}
 */
export function getUnmetLevelRequirement(item, characters) {
  const levelRequirement = Number(item?.levelRequirement ?? item?.level_requirement) || 0;
  if (levelRequirement <= 1 || !Array.isArray(characters) || characters.length === 0) return 0;
  const highestLevel = characters.reduce((max, c) => Math.max(max, Number(c?.level) || 0), 0);
  return highestLevel < levelRequirement ? levelRequirement : 0;
}

/** Stats in the shape calculateStatChanges reads, whatever the item source. */
function asComparable(source) {
  if (!source) return null;
  return { attack: source.attack, defense: source.defense, ...getItemStatSources(source) };
}

/**
 * Per-character stat change against the gear each party member has in the
 * item's slot, for members who could equip it (the server's slot and
 * requirement rule, shared/equipmentRules.js).
 * @param {Object} item - Shop item (type, equipmentSlot, stats, requirements)
 * @param {Array<Object>} characters - GET /characters rows
 * @returns {string} HTML, or '' for non-equipment or a party without equipment data
 */
export function renderEquippedComparison(item, characters) {
  const slot = item?.equipmentSlot || item?.equipment_slot;
  if (!slot || !Array.isArray(characters)) return '';
  const withGear = characters.filter(c => c && c.equipment && typeof c.equipment === 'object');
  const inParty = withGear.filter(c => c.party_slot !== null && c.party_slot !== undefined);
  const party = inParty.length > 0 ? inParty : withGear;
  if (party.length === 0) return '';

  const candidate = asComparable(item);
  const rows = party
    .filter(c => matchesEquipmentSlot(item, slot) && !getEquipRestriction(item, c))
    .map(c => {
      const changes = formatStatChanges(
        calculateStatChanges(asComparable(c.equipment[slot]), candidate),
        { abbreviated: true }
      );
      const changeHtml = changes.length > 0
        ? changes.map(ch => `<span class="${ch.className}">${escapeHtml(ch.text)}</span>`).join(', ')
        : '<span class="stat-neutral">No change</span>';
      return `
        <div class="detail-stat-row comparison-row">
          <span class="detail-stat-label">${escapeHtml(c.name || '')}</span>
          <span class="comparison-changes">${changeHtml}</span>
        </div>
      `;
    });

  const body = rows.length > 0
    ? rows.join('')
    : '<div class="detail-stat-row comparison-row"><span class="stat-neutral">No party member can equip this</span></div>';
  return `
    <div class="detail-section-title">Vs Equipped</div>
    ${body}
  `;
}
