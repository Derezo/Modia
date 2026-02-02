/**
 * Icon category configuration - Single source of truth (CommonJS version)
 *
 * Icon ID Convention (Post-Cleanup):
 * - Metadata IDs are UNPREFIXED: 'attack', 'poison', 'inventory'
 * - File names are UNPREFIXED: 'attack.webp', 'poison.webp', 'inventory.webp'
 * - Files are organized in subcategory directories: /icons/png/32/actions/attack.webp
 *
 * This module provides:
 * - ICON_PREFIX_MAP: For adding prefixes when external systems need them
 * - prefixIconId(): Add category prefix to an ID
 * - normalizeIconId(): Identity function (IDs are already unprefixed)
 *
 * Historical Note:
 * Previously, metadata IDs were prefixed (action_attack) but files were unprefixed.
 * This required normalizeIconId() to strip prefixes for path resolution.
 * After the Phase 5 cleanup, IDs are now unprefixed in metadata, simplifying the system.
 */

/**
 * Maps subcategory names to their ID prefixes.
 * Used by prefixIconId() when external systems need prefixed IDs.
 */
const ICON_PREFIX_MAP = {
  actions: 'action_',
  augments: 'augment_',
  status: 'status_',
  menu: 'menu_',
  resources: 'resource_',
  zodiac: 'zodiac_'
};

/**
 * List of valid icon subcategories.
 */
const ICON_SUBCATEGORIES = Object.keys(ICON_PREFIX_MAP);

/**
 * Add category prefix to an icon ID.
 * Use this when external systems expect prefixed IDs (e.g., legacy APIs, game logic).
 *
 * @param {string} id - Unprefixed icon ID (e.g., 'attack')
 * @param {string} subcategory - Icon subcategory (e.g., 'actions', 'status')
 * @returns {string} Prefixed ID (e.g., 'action_attack')
 *
 * @example
 * prefixIconId('attack', 'actions')  // Returns 'action_attack'
 * prefixIconId('poison', 'status')   // Returns 'status_poison'
 */
function prefixIconId(id, subcategory) {
  const prefix = ICON_PREFIX_MAP[subcategory];
  if (prefix && !id.startsWith(prefix)) {
    return prefix + id;
  }
  return id;
}

/**
 * Normalize icon ID for path resolution.
 *
 * After the Phase 5 cleanup, metadata IDs are already unprefixed,
 * so this function is now an identity function. It's retained for
 * backward compatibility with existing code that calls it.
 *
 * @param {string} id - Icon ID from metadata (now unprefixed)
 * @param {string} _subcategory - Icon subcategory (unused, kept for API compatibility)
 * @returns {string} The same ID (already unprefixed)
 *
 * @deprecated Since metadata IDs are now unprefixed, this function is a no-op.
 *             New code should use the ID directly without calling this function.
 *
 * @example
 * // Pre-cleanup: normalizeIconId('action_attack', 'actions') returned 'attack'
 * // Post-cleanup: normalizeIconId('attack', 'actions') returns 'attack'
 */
function normalizeIconId(id, _subcategory) {
  // Identity function - IDs are already unprefixed in metadata
  return id;
}

module.exports = {
  ICON_PREFIX_MAP,
  ICON_SUBCATEGORIES,
  prefixIconId,
  normalizeIconId
};
