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
    basePrice: 150,
    sprite_id: 'potion_health_large'
  },
  {
    id: 'full_restore',
    name: 'Full Restore',
    type: 'consumable',
    description: 'Fully restores HP and cures all status effects. The ultimate healing draught.',
    effect: { hp_full: true, cure_all: true },
    basePrice: 300,
    sprite_id: 'elixir_life'
  },
  {
    id: 'mega_ether',
    name: 'Mega-Ether',
    type: 'consumable',
    description: 'Restores 100 MP. Distilled from rare magical herbs.',
    effect: { mp_restore: 100 },
    basePrice: 200,
    sprite_id: 'potion_mana_large'
  },
  {
    id: 'elixir_supreme',
    name: 'Supreme Elixir',
    type: 'consumable',
    description: 'Restores 200 HP and 100 MP. A legendary alchemical masterpiece.',
    effect: { hp_restore: 200, mp_restore: 100 },
    basePrice: 400,
    sprite_id: 'elixir_life'
  },
  {
    id: 'revival_herb',
    name: 'Revival Herb',
    type: 'consumable',
    description: 'Revives a fallen ally with 50% HP. Extremely rare herb from distant lands.',
    effect: { revive: true, hp_percent: 50 },
    basePrice: 350,
    sprite_id: 'phoenix_feather'
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
    basePrice: 500,
    sprite_id: 'mystery_box'
  },
  {
    id: 'mystery_box_premium',
    name: 'Premium Mystery Box',
    type: 'consumable',
    description: 'Contains a guaranteed rare or better item. The merchant swears by its value.',
    effect: { opens_to: 'random_rare_plus' },
    basePrice: 1000,
    sprite_id: 'mystery_box_premium'
  },

  // ============================================
  // Crafting Materials (future use)
  // ============================================
  {
    id: 'dragon_scale',
    name: 'Dragon Scale',
    type: 'material',
    description: 'A shimmering scale from a dragon. Used in advanced armor crafting.',
    basePrice: 250,
    sprite_id: 'material_dragon_scale'
  },
  {
    id: 'moon_ore',
    name: 'Moon Ore',
    type: 'material',
    description: 'Ore that glows with lunar energy. Prized by enchanters.',
    basePrice: 200,
    sprite_id: 'material_moon_ore'
  },
  {
    id: 'phoenix_ash',
    name: 'Phoenix Ash',
    type: 'material',
    description: 'Ashes from a reborn phoenix. Essential for fire enchantments.',
    basePrice: 400,
    sprite_id: 'material_phoenix_ash'
  },
  {
    id: 'void_crystal',
    name: 'Void Crystal',
    type: 'material',
    description: 'A crystal infused with void energy. Dangerously powerful.',
    basePrice: 450,
    sprite_id: 'material_void_crystal'
  },
  {
    id: 'ancient_wood',
    name: 'Ancient Wood',
    type: 'material',
    description: 'Petrified wood from trees that witnessed the First Age.',
    basePrice: 180,
    sprite_id: 'material_ancient_wood'
  },
  {
    id: 'starlight_essence',
    name: 'Starlight Essence',
    type: 'material',
    description: 'Captured starlight in liquid form. Enhances magical properties.',
    basePrice: 320,
    sprite_id: 'material_starlight_essence'
  },

  // ============================================
  // Regional Specialty Items (one per region)
  // ============================================

  // Human Kingdom (Heartlands)
  {
    id: 'knights_crest',
    name: 'Knight\'s Crest',
    type: 'accessory',
    region: 'human',
    description: 'A badge of honor from the Human Kingdom. Worn by those who serve the crown.',
    equipSlot: 'accessory',
    statBonuses: { strength: 3, vitality: 2 },
    basePrice: 350,
    sprite_id: 'amulet_silver'
  },
  {
    id: 'royal_signet',
    name: 'Royal Signet Ring',
    type: 'accessory',
    region: 'human',
    description: 'A ring bearing the royal seal. Grants authority and resilience.',
    equipSlot: 'accessory',
    statBonuses: { vitality: 4, luck: 2 },
    basePrice: 420,
    sprite_id: 'ring_gem'
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
    basePrice: 400,
    sprite_id: 'bow_elven'
  },
  {
    id: 'moonweave_cloak',
    name: 'Moonweave Cloak',
    type: 'armor',
    region: 'elf',
    description: 'A cloak woven from moonlight threads. Favored by elven rangers.',
    equipSlot: 'body',
    statBonuses: { agility: 4, intelligence: 2 },
    basePrice: 380,
    sprite_id: 'robe_mage'
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
    basePrice: 450,
    sprite_id: 'mace_war'
  },
  {
    id: 'stonekin_shield',
    name: 'Stonekin Shield',
    type: 'weapon',
    region: 'dwarf',
    description: 'A shield carved from living stone. Unyielding in defense.',
    equipSlot: 'off_hand',
    statBonuses: { vitality: 5, strength: 1 },
    basePrice: 420,
    sprite_id: 'shield_tower'
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
    basePrice: 380,
    sprite_id: 'amulet_bone'
  },
  {
    id: 'warchief_axe',
    name: 'Warchief\'s Axe',
    type: 'weapon',
    region: 'orc',
    description: 'A brutal axe once wielded by a warchief. Demands respect and blood.',
    equipSlot: 'main_hand',
    statBonuses: { strength: 6 },
    basePrice: 480,
    sprite_id: 'axe_battle'
  },

  // Vampire Dominion (Shadowmere)
  {
    id: 'blood_vial',
    name: 'Blood Vial',
    type: 'consumable',
    region: 'vampire',
    description: 'A vial of enchanted blood. Heals and grants temporary lifesteal.',
    effect: { hp_restore: 100, lifesteal_buff: 30 },
    basePrice: 300,
    sprite_id: 'potion_blood'
  },
  {
    id: 'nightwalker_fang',
    name: 'Nightwalker Fang',
    type: 'accessory',
    region: 'vampire',
    description: 'A fang from an ancient vampire lord. Pulses with dark hunger.',
    equipSlot: 'accessory',
    statBonuses: { agility: 3, intelligence: 3 },
    basePrice: 400,
    sprite_id: 'amulet_crystal'
  },

  // ============================================
  // Utility Consumables
  // ============================================
  {
    id: 'waypoint_scroll',
    name: 'Waypoint Scroll',
    type: 'consumable',
    description: 'An enchanted scroll that teleports the user to the nearest castle. Single use.',
    effect: { teleport: 'nearest_castle' },
    basePrice: 200,
    sprite_id: 'scroll_magic'
  },
  {
    id: 'escape_smoke',
    name: 'Escape Smoke',
    type: 'consumable',
    description: 'A smoke bomb that guarantees escape from any non-boss battle. Cowardly but effective.',
    effect: { battle_escape: true, guaranteed: true },
    basePrice: 150,
    sprite_id: 'bomb_smoke'
  },
  {
    id: 'scouts_lens',
    name: 'Scout\'s Lens',
    type: 'consumable',
    description: 'A magical lens that reveals the fog of war in a 3-node radius around your position.',
    effect: { fog_reveal: 3 },
    basePrice: 250,
    sprite_id: 'lens_scout'
  },
  {
    id: 'stamina_tonic',
    name: 'Stamina Tonic',
    type: 'consumable',
    description: 'A refreshing brew that restores 3 stamina points. Favored by tireless travelers.',
    effect: { stamina_restore: 3 },
    basePrice: 175,
    sprite_id: 'potion_stamina'
  },
  {
    id: 'caravan_pass',
    name: 'Caravan Pass',
    type: 'consumable',
    description: 'A merchant guild token granting 10% discount on your next caravan purchase.',
    effect: { discount: 0.10, scope: 'caravan_next' },
    basePrice: 100,
    sprite_id: 'token_merchant'
  },
  {
    id: 'treasure_map',
    name: 'Treasure Map',
    type: 'consumable',
    description: 'A weathered map that marks the location of the nearest treasure node on your map.',
    effect: { mark_node: 'treasure', nearest: true },
    basePrice: 300,
    sprite_id: 'map_treasure'
  },

  // ============================================
  // Battle Buff Consumables
  // ============================================
  {
    id: 'warriors_draught',
    name: 'Warrior\'s Draught',
    type: 'consumable',
    description: 'A potent brew that surges through the muscles, granting +10 STR for 5 turns.',
    effect: { buff: { strength: 10 }, duration: 5 },
    basePrice: 180,
    sprite_id: 'potion_strength'
  },
  {
    id: 'sages_elixir',
    name: 'Sage\'s Elixir',
    type: 'consumable',
    description: 'A shimmering liquid that expands the mind, granting +10 INT for 5 turns.',
    effect: { buff: { intelligence: 10 }, duration: 5 },
    basePrice: 180,
    sprite_id: 'potion_intelligence'
  },
  {
    id: 'swiftfoot_philter',
    name: 'Swiftfoot Philter',
    type: 'consumable',
    description: 'A quicksilver tincture that enhances reflexes, granting +5 AGI for 5 turns.',
    effect: { buff: { agility: 5 }, duration: 5 },
    basePrice: 160,
    sprite_id: 'potion_agility'
  },
  {
    id: 'ironhide_brew',
    name: 'Ironhide Brew',
    type: 'consumable',
    description: 'A thick, metallic concoction that toughens skin, granting +8 VIT for 5 turns.',
    effect: { buff: { vitality: 8 }, duration: 5 },
    basePrice: 175,
    sprite_id: 'potion_vitality'
  },
  {
    id: 'fortunes_flask',
    name: 'Fortune\'s Flask',
    type: 'consumable',
    description: 'A golden elixir blessed by fate itself, granting +15 LUK for 3 turns.',
    effect: { buff: { luck: 15 }, duration: 3 },
    basePrice: 200,
    sprite_id: 'potion_luck'
  },

  // ============================================
  // Level-Scaled Equipment (Level 12-20)
  // ============================================
  {
    id: 'travelers_blade',
    name: 'Traveler\'s Blade',
    type: 'weapon',
    description: 'A versatile sword favored by caravan guards. Balanced for both offense and mobility.',
    equipSlot: 'main_hand',
    statBonuses: { strength: 10, agility: 4 },
    levelRequirement: 12,
    basePrice: 350,
    sprite_id: 'sword_travelers'
  },
  {
    id: 'wanderers_staff',
    name: 'Wanderer\'s Staff',
    type: 'weapon',
    description: 'A gnarled staff infused with the magic of distant lands. Channels both intellect and mana.',
    equipSlot: 'main_hand',
    statBonuses: { intelligence: 12, mp_max: 25 },
    levelRequirement: 14,
    basePrice: 380,
    sprite_id: 'staff_wanderer'
  },
  {
    id: 'nomad_wraps',
    name: 'Nomad\'s Wraps',
    type: 'weapon',
    description: 'Reinforced hand wraps from the desert nomads. Perfect for swift, powerful strikes.',
    equipSlot: 'main_hand',
    statBonuses: { agility: 8, strength: 6 },
    levelRequirement: 12,
    basePrice: 320,
    sprite_id: 'fist_nomad'
  },
  {
    id: 'caravan_guard_armor',
    name: 'Caravan Guard Armor',
    type: 'armor',
    description: 'Sturdy armor worn by elite caravan guards. Designed to endure the dangers of the road.',
    equipSlot: 'body',
    statBonuses: { vitality: 8, hp_max: 40 },
    levelRequirement: 15,
    basePrice: 450,
    sprite_id: 'armor_caravan'
  },
  {
    id: 'merchants_cowl',
    name: 'Merchant\'s Cowl',
    type: 'armor',
    description: 'A hooded cowl that sharpens the mind and brings good fortune. Popular among traveling traders.',
    equipSlot: 'head',
    statBonuses: { intelligence: 5, luck: 4 },
    levelRequirement: 12,
    basePrice: 200,
    sprite_id: 'helm_cowl'
  },
  {
    id: 'pathfinder_boots',
    name: 'Pathfinder Boots',
    type: 'armor',
    description: 'Boots crafted for those who spend their lives on the move. Light as air, swift as wind.',
    equipSlot: 'feet',
    statBonuses: { agility: 5 },
    levelRequirement: 12,
    basePrice: 350,
    sprite_id: 'boots_pathfinder'
  },

  // ============================================
  // Crafting Materials (Phase 3 Expansion)
  // ============================================
  {
    id: 'ethereal_dust',
    name: 'Ethereal Dust',
    type: 'material',
    description: 'Shimmering particles collected from the spirit realm. Essential for enchanting ethereal items.',
    basePrice: 280,
    sprite_id: 'material_ethereal_dust'
  },
  {
    id: 'demon_horn',
    name: 'Demon Horn',
    type: 'material',
    description: 'A fragment from a powerful demon. Radiates malevolent energy useful in dark crafting.',
    basePrice: 380,
    sprite_id: 'material_demon_horn'
  },
  {
    id: 'mermaid_scale',
    name: 'Mermaid Scale',
    type: 'material',
    description: 'An iridescent scale with natural water affinity. Prized for aquatic enchantments.',
    basePrice: 350,
    sprite_id: 'material_mermaid_scale'
  },
  {
    id: 'titan_fragment',
    name: 'Titan Fragment',
    type: 'material',
    description: 'A piece of armor from an ancient giant. Nearly indestructible when forged correctly.',
    basePrice: 420,
    sprite_id: 'material_titan_fragment'
  },

  // ============================================
  // Additional Regional Items (Phase 3 Expansion)
  // ============================================

  // Human Kingdom (Heartlands)
  {
    id: 'crown_guards_helm',
    name: 'Crown Guard\'s Helm',
    type: 'armor',
    region: 'human',
    description: 'A helm worn by the elite Crown Guard. Offers protection and inspires confidence.',
    equipSlot: 'head',
    statBonuses: { vitality: 5, hp_max: 20 },
    basePrice: 380,
    sprite_id: 'helm_crown_guard'
  },

  // Elven Forest (Sylvan Reaches)
  {
    id: 'elven_dream_catcher',
    name: 'Elven Dream Catcher',
    type: 'accessory',
    region: 'elf',
    description: 'A delicate accessory woven with moonlit threads. Enhances magical potential and mana reserves.',
    equipSlot: 'accessory',
    statBonuses: { intelligence: 5, mp_max: 20 },
    basePrice: 360,
    sprite_id: 'amulet_dreamcatcher'
  },

  // Dwarven Mountains (Iron Depths)
  {
    id: 'deepforge_gauntlets',
    name: 'Deepforge Gauntlets',
    type: 'armor',
    region: 'dwarf',
    description: 'Gauntlets forged in the deepest dwarven smithies. Blend raw power with ironclad defense.',
    equipSlot: 'hands',
    statBonuses: { strength: 4, vitality: 3 },
    basePrice: 340,
    sprite_id: 'gloves_deepforge'
  },

  // Orcish Steppes (Bloodplains)
  {
    id: 'trophy_necklace',
    name: 'Trophy Necklace',
    type: 'accessory',
    region: 'orc',
    description: 'A necklace strung with the fangs of defeated enemies. Inspires fear and deadly precision.',
    equipSlot: 'accessory',
    statBonuses: { strength: 5, crit_chance: 5 },
    basePrice: 400,
    sprite_id: 'amulet_trophy'
  },

  // Vampire Dominion (Shadowmere)
  {
    id: 'nightstalker_cloak',
    name: 'Nightstalker Cloak',
    type: 'armor',
    region: 'vampire',
    description: 'A cloak woven from shadows. Grants supernatural agility and the ability to evade attacks.',
    equipSlot: 'body',
    statBonuses: { agility: 6, evasion: 5 },
    basePrice: 420,
    sprite_id: 'armor_nightstalker'
  },

  // Palace (Neutral/Central)
  {
    id: 'palace_emblem',
    name: 'Palace Emblem',
    type: 'accessory',
    region: 'palace',
    description: 'A prestigious emblem granted only to those who have earned the favor of the Palace. Enhances all attributes.',
    equipSlot: 'accessory',
    statBonuses: { strength: 2, agility: 2, intelligence: 2, vitality: 2, luck: 2 },
    basePrice: 600,
    sprite_id: 'emblem_palace'
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
  // Mystery boxes (ultra-rare)
  mystery_box: { min: 1, max: 1 },
  mystery_box_premium: { min: 1, max: 1 },

  // Rare consumables
  full_restore: { min: 2, max: 3 },
  revival_herb: { min: 1, max: 2 },

  // Utility consumables (moderate stock)
  waypoint_scroll: { min: 2, max: 4 },
  escape_smoke: { min: 2, max: 5 },
  scouts_lens: { min: 2, max: 4 },
  stamina_tonic: { min: 3, max: 5 },
  caravan_pass: { min: 2, max: 3 },
  treasure_map: { min: 2, max: 4 },

  // Battle buff consumables (moderate stock)
  warriors_draught: { min: 2, max: 4 },
  sages_elixir: { min: 2, max: 4 },
  swiftfoot_philter: { min: 2, max: 4 },
  ironhide_brew: { min: 2, max: 4 },
  fortunes_flask: { min: 2, max: 3 },

  // Level-scaled equipment (ultra-rare - 1 per refresh)
  travelers_blade: { min: 1, max: 1 },
  wanderers_staff: { min: 1, max: 1 },
  nomad_wraps: { min: 1, max: 1 },
  caravan_guard_armor: { min: 1, max: 1 },
  merchants_cowl: { min: 1, max: 1 },
  pathfinder_boots: { min: 1, max: 1 },

  // Crafting materials (limited stock)
  ethereal_dust: { min: 1, max: 2 },
  demon_horn: { min: 1, max: 2 },
  mermaid_scale: { min: 1, max: 2 },
  titan_fragment: { min: 1, max: 2 }
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

/**
 * Calculate a staggered refresh offset based on local seed
 * This allows different caravan nodes to refresh at different times,
 * creating variety in caravan availability across the world.
 *
 * @param {number} localSeed - A seed value unique to the caravan location (e.g., nodeId)
 * @returns {number} Offset in milliseconds (0 to 47 hours)
 */
export function calculateRefreshOffset(localSeed) {
  return (localSeed % 48) * 60 * 60 * 1000; // 0-47 hours offset
}
