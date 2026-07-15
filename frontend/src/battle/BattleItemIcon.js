/**
 * Shared adapter between battle item DTOs and the canonical ItemIcon.
 *
 * Battle inventory entries are consumables but older payloads do not include
 * an itemType field. Loot rewards do include itemType. Keeping that one legacy
 * fallback here prevents the selection UIs and canvas outro from drifting back
 * to name-based icon guesses.
 */
import { ItemIcon } from '../components/ItemIcon.js';

/**
 * @param {Object} item
 * @param {string} fallbackItemType
 * @returns {string}
 */
export function getBattleItemType(item = {}, fallbackItemType = 'consumable') {
  return item.itemType || item.item_type || item.type || fallbackItemType;
}

/**
 * Render a battle item with the canonical DOM item component.
 *
 * @param {Object} item
 * @param {Object} options
 * @param {'sm'|'md'|'lg'|'xl'} [options.size='sm']
 * @param {string} [options.className='battle-item-icon']
 * @param {string} [options.fallbackItemType='consumable']
 * @returns {string}
 */
export function renderBattleItemIcon(item = {}, options = {}) {
  const {
    size = 'sm',
    className = 'battle-item-icon',
    fallbackItemType = 'consumable'
  } = options;

  return ItemIcon.html({
    item,
    itemType: getBattleItemType(item, fallbackItemType),
    size,
    className
  });
}

/**
 * Resolve the canonical source for canvas-based battle item rendering.
 *
 * @param {Object} item
 * @param {Object} options
 * @param {'sm'|'md'|'lg'|'xl'} [options.size='md']
 * @param {string} [options.fallbackItemType='consumable']
 * @returns {string|null}
 */
export function getBattleItemIconSrc(item = {}, options = {}) {
  const {
    size = 'md',
    fallbackItemType = 'consumable'
  } = options;

  return ItemIcon.getSrc({
    item,
    itemType: getBattleItemType(item, fallbackItemType),
    size
  });
}

/**
 * Resolve a composited source for canvas battle renderers. This keeps augment
 * overlays on loot cards without duplicating ItemIcon's category rules.
 * @param {Object} item
 * @param {Object} options
 * @param {'sm'|'md'|'lg'|'xl'} [options.size='md']
 * @param {string} [options.fallbackItemType='consumable']
 * @returns {Promise<string|null>}
 */
export function getBattleItemCompositeSrc(item = {}, options = {}) {
  const {
    size = 'md',
    fallbackItemType = 'consumable'
  } = options;

  return ItemIcon.getCompositeSrc({
    item,
    itemType: getBattleItemType(item, fallbackItemType),
    size
  });
}
