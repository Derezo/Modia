/**
 * Caravan-exclusive items not available in regular shops
 *
 * The merchant caravan travels between regions, offering unique goods
 * that cannot be found at standard village or city shops.
 *
 * Item Categories:
 * - Rare Consumables: More potent versions of standard potions
 * - Mystery Boxes: Random rare item containers
 * - Crafting Materials: Future crafting system components
 * - Regional Specialties: Region-locked items only available when caravan visits that region
 */

/**
 * @typedef {Object} CaravanItem
 * @property {string} id - Unique item identifier
 * @property {string} name - Display name
 * @property {string} type - Item type (consumable, material, weapon, accessory)
 * @property {string} [description] - Item description
 * @property {Object} [effect] - Consumable effect definition
 * @property {string} [equipSlot] - Equipment slot for weapons/armor
 * @property {Object} [statBonuses] - Stat bonuses for equipment
 * @property {string} [region] - Region restriction (human, elf, dwarf, orc, vampire)
 * @property {number} basePrice - Base gold cost
 */

export const CARAVAN_ITEMS = [
  // ============================================
  // Rare Consumables (more potent than apothecary)
  // ============================================
  {
    id: 'mega_potion',
    name: 'Mega-Potion',
    type: 'consumable',
    description: 'Restores 150 HP. A concentrated brew far stronger than standard potions.',
    effect: { hp_restore: 150 },
    basePrice: 150
  },
  {
    id: 'full_restore',
    name: 'Full Restore',
    type: 'consumable',
    description: 'Fully restores HP and cures all status effects. The ultimate healing draught.',
    effect: { hp_full: true, cure_all: true },
    basePrice: 300
  },
  {
    id: 'mega_ether',
    name: 'Mega-Ether',
    type: 'consumable',
    description: 'Restores 100 MP. Distilled from rare magical herbs.',
    effect: { mp_restore: 100 },
    basePrice: 200
  },
  {
    id: 'elixir_supreme',
    name: 'Supreme Elixir',
    type: 'consumable',
    description: 'Restores 200 HP and 100 MP. A legendary alchemical masterpiece.',
    effect: { hp_restore: 200, mp_restore: 100 },
    basePrice: 400
  },
  {
    id: 'revival_herb',
    name: 'Revival Herb',
    type: 'consumable',
    description: 'Revives a fallen ally with 50% HP. Extremely rare herb from distant lands.',
    effect: { revive: true, hp_percent: 50 },
    basePrice: 350
  },

  // ============================================
  // Mystery Box
  // ============================================
  {
    id: 'mystery_box',
    name: 'Mystery Box',
    type: 'consumable',
    description: 'Contains a random rare item. Could be equipment, materials, or even something legendary.',
    effect: { opens_to: 'random_rare' },
    basePrice: 500
  },
  {
    id: 'mystery_box_premium',
    name: 'Premium Mystery Box',
    type: 'consumable',
    description: 'Contains a guaranteed rare or better item. The merchant swears by its value.',
    effect: { opens_to: 'random_rare_plus' },
    basePrice: 1000
  },

  // ============================================
  // Crafting Materials (future use)
  // ============================================
  {
    id: 'dragon_scale',
    name: 'Dragon Scale',
    type: 'material',
    description: 'A shimmering scale from a dragon. Used in advanced armor crafting.',
    basePrice: 250
  },
  {
    id: 'moon_ore',
    name: 'Moon Ore',
    type: 'material',
    description: 'Ore that glows with lunar energy. Prized by enchanters.',
    basePrice: 200
  },
  {
    id: 'phoenix_ash',
    name: 'Phoenix Ash',
    type: 'material',
    description: 'Ashes from a reborn phoenix. Essential for fire enchantments.',
    basePrice: 400
  },
  {
    id: 'void_crystal',
    name: 'Void Crystal',
    type: 'material',
    description: 'A crystal infused with void energy. Dangerously powerful.',
    basePrice: 450
  },
  {
    id: 'ancient_wood',
    name: 'Ancient Wood',
    type: 'material',
    description: 'Petrified wood from trees that witnessed the First Age.',
    basePrice: 180
  },
  {
    id: 'starlight_essence',
    name: 'Starlight Essence',
    type: 'material',
    description: 'Captured starlight in liquid form. Enhances magical properties.',
    basePrice: 320
  },

  // ============================================
  // Regional Specialty Items (one per region)
  // ============================================

  // Human Kingdom (Heartlands)
  {
    id: 'knights_crest',
    name: "Knight's Crest",
    type: 'accessory',
    region: 'human',
    description: 'A badge of honor from the Human Kingdom. Worn by those who serve the crown.',
    equipSlot: 'accessory',
    statBonuses: { strength: 3, vitality: 2 },
    basePrice: 350
  },
  {
    id: 'royal_signet',
    name: 'Royal Signet Ring',
    type: 'accessory',
    region: 'human',
    description: 'A ring bearing the royal seal. Grants authority and resilience.',
    equipSlot: 'accessory',
    statBonuses: { vitality: 4, luck: 2 },
    basePrice: 420
  },

  // Elven Forest (Sylvan Reaches)
  {
    id: 'fey_bow',
    name: 'Fey Bow',
    type: 'weapon',
    region: 'elf',
    description: 'An elven bow infused with nature magic. Light as a feather, swift as the wind.',
    equipSlot: 'main_hand',
    statBonuses: { dexterity: 4, intelligence: 2 },
    basePrice: 400
  },
  {
    id: 'moonweave_cloak',
    name: 'Moonweave Cloak',
    type: 'armor',
    region: 'elf',
    description: 'A cloak woven from moonlight threads. Favored by elven rangers.',
    equipSlot: 'body',
    statBonuses: { agility: 4, intelligence: 2 },
    basePrice: 380
  },

  // Dwarven Mountains (Iron Depths)
  {
    id: 'ironforge_hammer',
    name: 'Ironforge Hammer',
    type: 'weapon',
    region: 'dwarf',
    description: 'A masterwork dwarven hammer. Each strike echoes with the might of the mountain.',
    equipSlot: 'main_hand',
    statBonuses: { strength: 5, vitality: 1 },
    basePrice: 450
  },
  {
    id: 'stonekin_shield',
    name: 'Stonekin Shield',
    type: 'weapon',
    region: 'dwarf',
    description: 'A shield carved from living stone. Unyielding in defense.',
    equipSlot: 'off_hand',
    statBonuses: { vitality: 5, strength: 1 },
    basePrice: 420
  },

  // Orcish Steppes (Bloodplains)
  {
    id: 'berserker_tusk',
    name: 'Berserker Tusk',
    type: 'accessory',
    region: 'orc',
    description: 'A war trophy that inspires rage. The previous owner fell in glorious battle.',
    equipSlot: 'accessory',
    statBonuses: { strength: 4, agility: 2 },
    basePrice: 380
  },
  {
    id: 'warchief_axe',
    name: "Warchief's Axe",
    type: 'weapon',
    region: 'orc',
    description: 'A brutal axe once wielded by a warchief. Demands respect and blood.',
    equipSlot: 'main_hand',
    statBonuses: { strength: 6 },
    basePrice: 480
  },

  // Vampire Dominion (Shadowmere)
  {
    id: 'blood_vial',
    name: 'Blood Vial',
    type: 'consumable',
    region: 'vampire',
    description: 'A vial of enchanted blood. Heals and grants temporary lifesteal.',
    effect: { hp_restore: 100, lifesteal_buff: 30 },
    basePrice: 300
  },
  {
    id: 'nightwalker_fang',
    name: 'Nightwalker Fang',
    type: 'accessory',
    region: 'vampire',
    description: 'A fang from an ancient vampire lord. Pulses with dark hunger.',
    equipSlot: 'accessory',
    statBonuses: { agility: 3, intelligence: 3 },
    basePrice: 400
  }
];

/**
 * Stock quantities per item type
 * min/max define the random range for quantity generation
 */
export const CARAVAN_STOCK = {
  consumable: { min: 3, max: 5 },
  material: { min: 5, max: 10 },
  weapon: { min: 1, max: 2 },
  armor: { min: 1, max: 2 },
  accessory: { min: 1, max: 2 }
};

/**
 * Special stock limits for specific items
 * Overrides the type-based defaults
 */
export const CARAVAN_ITEM_STOCK_OVERRIDES = {
  mystery_box: { min: 1, max: 1 },
  mystery_box_premium: { min: 1, max: 1 },
  full_restore: { min: 2, max: 3 },
  revival_herb: { min: 1, max: 2 }
};

/**
 * Caravan pricing modifier (15% premium over base price)
 * Traveling merchants charge for the convenience and rarity
 */
export const CARAVAN_PRICE_MODIFIER = 1.15;

/**
 * Caravan refresh interval in milliseconds (48 hours)
 */
export const CARAVAN_REFRESH_INTERVAL = 48 * 60 * 60 * 1000;

/**
 * Get stock limits for an item
 * @param {string} itemId - Item ID to check
 * @param {string} itemType - Item type
 * @returns {{ min: number, max: number }} Stock limits
 */
export function getStockLimits(itemId, itemType) {
  if (CARAVAN_ITEM_STOCK_OVERRIDES[itemId]) {
    return CARAVAN_ITEM_STOCK_OVERRIDES[itemId];
  }
  return CARAVAN_STOCK[itemType] || { min: 1, max: 3 };
}

/**
 * Get all items available for a specific region
 * @param {string} region - Region race (human, elf, dwarf, orc, vampire)
 * @returns {Array} Items available in that region (non-regional + region-specific)
 */
export function getItemsForRegion(region) {
  return CARAVAN_ITEMS.filter(item => !item.region || item.region === region);
}

/**
 * Get all non-regional items (always available regardless of caravan location)
 * @returns {Array} Non-regional items
 */
export function getNonRegionalItems() {
  return CARAVAN_ITEMS.filter(item => !item.region);
}

/**
 * Get regional items for a specific region
 * @param {string} region - Region race
 * @returns {Array} Regional specialty items
 */
export function getRegionalItems(region) {
  return CARAVAN_ITEMS.filter(item => item.region === region);
}
