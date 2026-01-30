/**
 * Icon category configuration - Single source of truth (CommonJS version)
 * Maps icon subcategories to ID prefixes for normalization.
 *
 * Icon metadata uses full IDs (e.g., 'action_attack') but files are saved
 * with stripped names ('attack.png') in category subdirectories.
 *
 * Subcategories are plural (actions, augments) but prefixes are singular
 * (action_, augment_), so we need this mapping table.
 */
const ICON_PREFIX_MAP = {
  actions: 'action_',
  augments: 'augment_',
  status: 'status_',
  menu: 'menu_',
  resources: 'resource_',
  zodiac: 'zodiac_'
};

const ICON_SUBCATEGORIES = Object.keys(ICON_PREFIX_MAP);

/**
 * Normalize icon ID by stripping category prefix to match file naming convention.
 *
 * @param {string} id - Icon ID from metadata (e.g., 'action_attack')
 * @param {string} subcategory - Icon subcategory (e.g., 'actions', 'augments')
 * @returns {string} Normalized ID without prefix (e.g., 'attack')
 */
function normalizeIconId(id, subcategory) {
  const prefix = ICON_PREFIX_MAP[subcategory];
  if (prefix && id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }
  return id;
}

module.exports = {
  ICON_PREFIX_MAP,
  ICON_SUBCATEGORIES,
  normalizeIconId
};
