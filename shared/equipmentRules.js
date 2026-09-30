/**
 * @module equipmentRules
 * @description The one rule for which item may go in which equipment slot,
 * and whether a character meets an item's requirements.
 *
 * Used by the server (POST /api/inventory/equip, which rejects with 400) and
 * by the client (slot pickers, Quick Equip, the GEAR upgrade badge), so the
 * client never offers an equip the server will refuse.
 */

/** Equipment slots each item_type may occupy (item_type enum -> equipment_slot enum). */
export const ITEM_TYPE_SLOTS = Object.freeze({
  weapon: Object.freeze(['main_hand', 'off_hand']),
  armor: Object.freeze(['head', 'body', 'legs', 'feet']),
  accessory: Object.freeze(['accessory'])
});

/**
 * Slots an item type may occupy.
 * @param {string} itemType - item_templates.item_type
 * @returns {readonly string[]}
 */
export function getValidSlotsForItemType(itemType) {
  return ITEM_TYPE_SLOTS[String(itemType || '').toLowerCase()] || [];
}

/**
 * Why an item cannot go in a slot, or null if it can.
 *
 * The item type must allow the slot, and an item whose template names a slot
 * must go in exactly that slot. Dual-wielding is not implemented, so a
 * main_hand weapon may not go in off_hand (it would double weapon stats).
 *
 * @param {string} itemType - item_templates.item_type
 * @param {string|null} templateSlot - item_templates.equipment_slot
 * @param {string} slotKey - Requested slot
 * @returns {null|{reason: 'type'}|{reason: 'template_slot', slot: string}}
 */
export function getSlotMismatch(itemType, templateSlot, slotKey) {
  if (!slotKey || !getValidSlotsForItemType(itemType).includes(slotKey)) {
    return { reason: 'type' };
  }
  if (templateSlot && templateSlot !== slotKey) {
    return { reason: 'template_slot', slot: templateSlot };
  }
  return null;
}

/**
 * Normalise a restriction list. node-postgres returns enum arrays
 * (class_type[], race_type[]) as the raw literal '{warrior,mage}', so that
 * form is split here rather than matched as one string.
 */
export function parseRestrictionList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== 'string' || !value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }
  return [trimmed];
}

function listIncludes(list, value) {
  const wanted = String(value || '').toLowerCase();
  return list.some(entry => String(entry).toLowerCase() === wanted);
}

/**
 * The first requirement a character fails for an item, or null.
 * Checks level, then class, then race. Class and race compare case-insensitively.
 *
 * @param {Object} requirements
 * @param {number} [requirements.level] - Minimum level (0 or missing = none)
 * @param {string[]|string} [requirements.classes] - Allowed classes (empty = any)
 * @param {string[]|string} [requirements.races] - Allowed races (empty = any)
 * @param {Object} character - { level, class, race }
 * @returns {null|{reason: 'level', level: number}|{reason: 'class', allowed: string[]}|{reason: 'race', allowed: string[]}}
 */
export function getRequirementFailure(requirements, character) {
  const level = Number(requirements?.level) || 0;
  if (level > 0 && (Number(character?.level) || 0) < level) {
    return { reason: 'level', level };
  }
  const classes = parseRestrictionList(requirements?.classes);
  if (classes.length > 0 && !listIncludes(classes, character?.class)) {
    return { reason: 'class', allowed: classes };
  }
  const races = parseRestrictionList(requirements?.races);
  if (races.length > 0 && !listIncludes(races, character?.race)) {
    return { reason: 'race', allowed: races };
  }
  return null;
}
