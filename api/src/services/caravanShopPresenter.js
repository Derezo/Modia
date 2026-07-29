import { CARAVAN_REFRESH_INTERVAL } from '../db/templates/caravanItems.js';

function asValidDate(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

/**
 * Adapt the caravan service model to the public shop contract.
 *
 * `items`/`nextRefresh` are the canonical fields shared with the other shop
 * responses and the frontend. The older caravan-specific aliases remain while
 * deployed clients roll forward.
 */
export function presentCaravanShop(caravanData, nodeId, { now = new Date() } = {}) {
  const currentTime = asValidDate(now, new Date());
  const fallbackRefresh = new Date(currentTime.getTime() + CARAVAN_REFRESH_INTERVAL);
  const nextRefresh = asValidDate(caravanData?.nextRefresh, fallbackRefresh);
  const sourceInventory = Array.isArray(caravanData?.inventory)
    ? caravanData.inventory
    : [];

  const items = sourceInventory.map(item => ({
    id: item.itemId,
    itemId: item.itemId,
    name: item.name,
    type: item.type,
    description: item.description,
    basePrice: item.basePrice,
    price: item.price,
    stock: item.quantity,
    maxStock: item.maxQuantity,
    regionalSpecialty: item.region || null,
    regional: Boolean(item.region),
    caravanExclusive: true,
    effect: item.effect || null,
    equipmentSlot: item.equipSlot || null,
    equipSlot: item.equipSlot || null,
    statBonuses: item.statBonuses || null,
    inStock: item.inStock,
    spriteId: item.spriteId || item.sprite_id || null
  }));

  return {
    isCaravan: true,
    shopType: 'caravan',
    items,
    nextRefresh: nextRefresh.toISOString(),
    nodeId,
    nodeName: caravanData?.nodeName,

    // Compatibility aliases for clients using the original caravan contract.
    inventory: items,
    refreshesIn: Math.max(0, nextRefresh.getTime() - currentTime.getTime()),
    lastRefresh: caravanData?.lastRefresh || null
  };
}
