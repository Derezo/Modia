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
export const CATEGORY_TO_OVERLAY = {
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
  slayer: 'augment_slayer'
};

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
    const overlayId = CATEGORY_TO_OVERLAY[category];
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
