/**
 * @module overlayMapping
 * @description Maps backend augment categories to visual overlay IDs for item compositing.
 *
 * This module provides the mapping between augment categories defined in the backend
 * item system and the overlay assets used for visual representation.
 */

/**
 * Maps augment category names to overlay asset IDs.
 * Backend augment categories -> overlay file IDs in ai-image-metadata/overlays/augments.json
 */
export const CATEGORY_TO_OVERLAY = Object.freeze({
  // Elemental augments
  fire: 'augment_fire',
  ice: 'augment_ice',
  lightning: 'augment_lightning',
  poison: 'augment_poison',
  holy: 'augment_holy',
  dark: 'augment_dark',
  earth: 'augment_earth',
  wind: 'augment_wind',

  // Combat effect augments
  critical: 'augment_critical',
  lifesteal: 'augment_lifesteal',
  speed: 'augment_speed',
  pierce: 'augment_pierce',
  stun: 'augment_stun',
  chain: 'augment_chain',

  // Special augments
  arcane: 'augment_arcane',
  fortune: 'augment_fortune',
  vitality: 'augment_vitality',
  slayer: 'augment_slayer',

  // Equipment category aliases
  damage: 'augment_critical',
  power: 'augment_critical',
  defense: 'augment_earth',
  physical_defense: 'augment_earth',
  magic_defense: 'augment_arcane',
  magical_defense: 'augment_arcane',
  armor: 'augment_earth',
  dragon_slayer: 'augment_slayer',
  undead_slayer: 'augment_slayer',
  demon_slayer: 'augment_slayer',
  strength: 'augment_critical',
  intelligence: 'augment_arcane',
  agility: 'augment_speed',
  luck: 'augment_fortune',
  hp: 'augment_vitality',
  mp: 'augment_arcane',
  mana: 'augment_arcane',
  regen: 'augment_vitality',
  healing: 'augment_vitality',
  heal: 'augment_vitality',
  hot: 'augment_vitality',
  mp_regen: 'augment_arcane',
  accuracy: 'augment_critical',
  crit: 'augment_critical',
  block: 'augment_earth',
  spell_resist: 'augment_arcane',
  magic_resist: 'augment_arcane',
  magical_resist: 'augment_arcane',
  resist: 'augment_arcane',
  protection: 'augment_earth',

  // Consumable category aliases
  potency: 'augment_arcane',
  concentration: 'augment_arcane',
  empowerment: 'augment_arcane',
  empowered: 'augment_arcane',
  hot_minor: 'augment_vitality',
  hot_major: 'augment_vitality',
  hot_percent: 'augment_vitality',
  mp_bonus: 'augment_arcane',
  spell: 'augment_arcane',
  spell_cost: 'augment_arcane',
  cleanse: 'augment_holy',
  cleanse_minor: 'augment_holy',
  cleanse_major: 'augment_holy',
  cleanse_all: 'augment_holy',
  buff_vit: 'augment_vitality',
  buff_str: 'augment_critical',
  buff_int: 'augment_arcane',
  buff_agi: 'augment_speed',
  revive: 'augment_holy',
  revive_bonus: 'augment_holy',
  revive_full: 'augment_holy',
  revive_immunity: 'augment_holy',
  instant: 'augment_speed',
  aoe: 'augment_chain'
});

/**
 * Priority order for overlay selection when items have multiple augments.
 * Lower number = higher priority (displayed on top).
 */
export const OVERLAY_PRIORITY = {
  // Elemental effects have highest visual priority
  augment_fire: 1,
  augment_ice: 2,
  augment_lightning: 3,
  augment_holy: 4,
  augment_dark: 5,
  augment_poison: 6,
  augment_earth: 7,
  augment_wind: 8,

  // Combat effects
  augment_critical: 10,
  augment_lifesteal: 11,
  augment_pierce: 12,
  augment_stun: 13,
  augment_chain: 14,
  augment_speed: 15,

  // Special augments (lowest priority)
  augment_arcane: 20,
  augment_fortune: 21,
  augment_vitality: 22,
  augment_slayer: 23
};

/**
 * The complete set of authored augment overlay IDs.
 * These are safe to pass to getAssetPath and correspond one-to-one with files.
 */
export const CANONICAL_AUGMENT_OVERLAY_IDS = Object.freeze(
  Object.keys(OVERLAY_PRIORITY)
);

const CANONICAL_AUGMENT_OVERLAY_ID_SET = new Set(CANONICAL_AUGMENT_OVERLAY_IDS);

/**
 * Normalize a category or canonical overlay ID without accepting path syntax.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeAugmentToken(value) {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized && /^[a-z0-9_]+$/.test(normalized) ? normalized : null;
}

/**
 * Resolve a backend augment category or canonical overlay ID to an authored ID.
 * Unknown and path-like values return null so callers never request them.
 *
 * @param {unknown} augment
 * @returns {string|null}
 */
export function resolveAugmentOverlay(augment) {
  const normalized = normalizeAugmentToken(augment);
  if (!normalized) return null;
  if (CANONICAL_AUGMENT_OVERLAY_ID_SET.has(normalized)) return normalized;

  return Object.prototype.hasOwnProperty.call(CATEGORY_TO_OVERLAY, normalized)
    ? CATEGORY_TO_OVERLAY[normalized]
    : null;
}

/**
 * Resolve and deduplicate a list of augment categories while preserving order.
 *
 * @param {unknown} augments
 * @returns {string[]}
 */
export function resolveAugmentOverlays(augments) {
  if (!Array.isArray(augments)) return [];

  const resolved = [];
  const seen = new Set();
  for (const augment of augments) {
    const overlayId = resolveAugmentOverlay(augment);
    if (overlayId && !seen.has(overlayId)) {
      seen.add(overlayId);
      resolved.push(overlayId);
    }
  }
  return resolved;
}

/**
 * Gets the primary overlay ID for an item based on its augments.
 * When multiple augments exist, returns the one with highest priority (lowest number).
 *
 * @param {string[]} augmentCategories - Array of augment category names from backend
 * @returns {string|null} The overlay ID to use, or null if no matching overlays
 *
 * @example
 * getPrimaryOverlay(['fire', 'critical']); // Returns 'augment_fire' (priority 1)
 * getPrimaryOverlay(['speed', 'fortune']); // Returns 'augment_speed' (priority 15)
 * getPrimaryOverlay([]); // Returns null
 */
export function getPrimaryOverlay(augmentCategories) {
  if (!augmentCategories || augmentCategories.length === 0) {
    return null;
  }

  let bestOverlay = null;
  let bestPriority = Infinity;

  for (const category of augmentCategories) {
    const overlayId = resolveAugmentOverlay(category);
    if (overlayId) {
      const priority = OVERLAY_PRIORITY[overlayId] ?? Infinity;
      if (priority < bestPriority) {
        bestPriority = priority;
        bestOverlay = overlayId;
      }
    }
  }

  return bestOverlay;
}
