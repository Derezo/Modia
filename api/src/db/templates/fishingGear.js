/**
 * Canonical fishing gear catalog shared by fishing, caravans, and fixed drops.
 */

function rod(key, name, bigCatchLandingRate, basePrice, rarityId, policy) {
  const catalogName = key.replace(/_rod$/, '');
  return Object.freeze({
    key,
    id: key,
    catalogKey: `fishing:rod:${catalogName}`,
    name,
    type: 'key_item',
    itemType: 'key_item',
    description: `${name} lands a Big Catch ${Math.round(bigCatchLandingRate * 100)}% of the time after a successful reel.`,
    bigCatchLandingRate,
    rarityId,
    isTradeable: false,
    statBonuses: Object.freeze({
      fishing_tool: 'rod',
      big_catch_rate: bigCatchLandingRate
    }),
    basePrice,
    sprite_id: `fishing_rod_${catalogName}`,
    ...policy
  });
}

function tackle(key, name, waitReduction, basePrice, rarityId, policy) {
  return Object.freeze({
    key,
    id: key,
    catalogKey: `fishing:tackle:${key}`,
    name,
    type: 'material',
    itemType: 'material',
    description: `${name} reduces the wait for a bite by ${Math.round(waitReduction * 100)}%.`,
    waitReduction,
    rarityId,
    isTradeable: false,
    statBonuses: Object.freeze({
      fishing_tackle: true,
      wait_reduction: waitReduction
    }),
    basePrice,
    sprite_id: `fishing_tackle_${key}`,
    ...policy
  });
}

export const RODS = Object.freeze([
  rod('weathered_rod', 'Weathered Rod', 0.10, 40, 1, {
    alwaysStock: true,
    unlimitedStock: true,
    stock: null
  }),
  rod('riverwood_rod', 'Riverwood Rod', 0.20, 250, 2, {
    inclusionChance: 0.60,
    stock: 3
  }),
  rod('silverline_rod', 'Silverline Rod', 0.50, 1250, 4, {
    inclusionChance: 0.30,
    stock: 2
  }),
  rod('runebound_rod', 'Runebound Rod', 0.85, 5000, 5, {
    inclusionChance: 0.10,
    stock: 1
  })
]);

export const TACKLE = Object.freeze([
  tackle('earthworm', 'Earthworm', 0.15, 1, 1, {
    alwaysStock: true,
    unlimitedStock: true,
    stock: null
  }),
  tackle('slime_slug', 'Slime Slug', 0.30, 3, 2, {
    inclusionChance: 0.70
  }),
  tackle('gilded_spinner', 'Gilded Spinner', 0.50, 10, 3, {
    inclusionChance: 0.30
  }),
  tackle('abyssal_lure', 'Abyssal Lure', 0.75, 40, 5, {
    inclusionChance: 0.10
  })
]);

export const FISHING_GEAR = Object.freeze([...RODS, ...TACKLE]);

const RODS_BY_KEY = new Map(
  RODS.flatMap(item => [
    [item.key, item],
    [item.catalogKey.slice('fishing:rod:'.length), item]
  ])
);
const TACKLE_BY_KEY = new Map(TACKLE.map(item => [item.key, item]));
const GEAR_BY_CATALOG_KEY = new Map(FISHING_GEAR.map(item => [item.catalogKey, item]));

function normalizeKey(value, namespace) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  const prefix = `fishing:${namespace}:`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

export function getRodByKey(key) {
  return RODS_BY_KEY.get(normalizeKey(key, 'rod')) || null;
}

export function getTackleByKey(key) {
  return TACKLE_BY_KEY.get(normalizeKey(key, 'tackle')) || null;
}

export function getFishingGearByCatalogKey(catalogKey) {
  return GEAR_BY_CATALOG_KEY.get(catalogKey) || null;
}

export function materializeFishingGearItem(gear) {
  if (!gear) return null;
  return {
    ...gear,
    itemId: gear.id,
    effect: null,
    equipSlot: null,
    statBonuses: gear.statBonuses || {},
    levelRequirement: 1
  };
}

export const FISHING_GEAR_ITEMS = Object.freeze(
  FISHING_GEAR.map(materializeFishingGearItem).map(Object.freeze)
);
