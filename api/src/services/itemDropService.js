/**
 * Item Drop Service - Procedural item generation and drop rolling
 */

import { query } from '../config/database.js';
import { SeededRandom } from '../config/constants.js';
import { getFishingGearByCatalogKey } from '../db/templates/fishingGear.js';

// Rarity definitions
const RARITIES = {
  common: { id: 1, name: 'Common', color: '#cccccc', statMult: [0.80, 1.00], bonusSlots: 0 },
  uncommon: { id: 2, name: 'Uncommon', color: '#1eff00', statMult: [0.90, 1.10], bonusSlots: [0, 1] },
  rare: { id: 3, name: 'Rare', color: '#0070dd', statMult: [1.00, 1.20], bonusSlots: [1, 2] },
  epic: { id: 4, name: 'Epic', color: '#a335ee', statMult: [1.10, 1.30], bonusSlots: [2, 3] },
  legendary: { id: 5, name: 'Legendary', color: '#ff8000', statMult: [1.20, 1.50], bonusSlots: [3, 4] }
};

// Material tiers by level
const MATERIAL_TIERS = [
  { minLevel: 1, maxLevel: 9, materials: ['copper', 'iron'], quality: 'Common' },
  { minLevel: 10, maxLevel: 19, materials: ['bronze', 'steel'], quality: 'Fine' },
  { minLevel: 20, maxLevel: 34, materials: ['silver', 'gold'], quality: 'Superior' },
  { minLevel: 35, maxLevel: 69, materials: ['platinum', 'electrum'], quality: 'Exceptional' },
  { minLevel: 70, maxLevel: 89, materials: ['mythril', 'adamantine'], quality: 'Masterwork' },
  { minLevel: 90, maxLevel: 256, materials: ['celestial', 'void'], quality: 'Legendary' }
];

// === EQUIPMENT PREFIX AUGMENTS ===
const PREFIX_AUGMENTS = {
  // Elemental Prefixes
  blazing: { name: 'Blazing', category: 'fire', stat: 'strength', bonus: [2, 8],
    effect: { type: 'fire_damage', value: 0.10 } },
  frozen: { name: 'Frozen', category: 'ice', stat: 'intelligence', bonus: [2, 8],
    effect: { type: 'ice_damage', value: 0.10 } },
  shocking: { name: 'Shocking', category: 'lightning', stat: 'agility', bonus: [2, 8],
    effect: { type: 'lightning_damage', value: 0.10 } },
  venomous: { name: 'Venomous', category: 'poison', stat: 'luck', bonus: [2, 6],
    effect: { type: 'poison_chance', value: 0.05 } },
  blessed: { name: 'Blessed', category: 'holy', stat: 'vitality', bonus: [2, 8],
    effect: { type: 'holy_damage', value: 0.10 } },
  shadowed: { name: 'Shadowed', category: 'dark', stat: 'agility', bonus: [2, 8],
    effect: { type: 'dark_damage', value: 0.10 } },

  // Combat Prefixes
  keen: { name: 'Keen', category: 'critical', stat: 'luck', bonus: [3, 10],
    effect: { type: 'crit_chance', value: 0.05 } },
  swift: { name: 'Swift', category: 'speed', stat: 'agility', bonus: [4, 12],
    effect: { type: 'initiative', value: 0.10 } },
  deadly: { name: 'Deadly', category: 'damage', stat: 'strength', bonus: [4, 12],
    effect: { type: 'damage_bonus', value: 0.08 } },
  mighty: { name: 'Mighty', category: 'power', stat: 'strength', bonus: [4, 12],
    effect: { type: 'physical_attack', value: 0.10 } },

  // Defensive Prefixes
  sturdy: { name: 'Sturdy', category: 'defense', stat: 'vitality', bonus: [3, 10],
    effect: { type: 'physical_defense', value: 0.08 } },
  warded: { name: 'Warded', category: 'magic_defense', stat: 'intelligence', bonus: [2, 8],
    effect: { type: 'magic_defense', value: 0.08 } },
  reinforced: { name: 'Reinforced', category: 'armor', stat: 'vitality', bonus: [3, 8],
    effect: { type: 'defense', value: 5 } },

  // Enemy-Type Prefixes
  dragonbane: { name: 'Dragonbane', category: 'dragon_slayer', stat: 'strength', bonus: [5, 15],
    effect: { type: 'damage_vs', target: 'dragon', value: 0.20 } },
  undeadbane: { name: 'Undeadbane', category: 'undead_slayer', stat: 'vitality', bonus: [5, 15],
    effect: { type: 'damage_vs', target: 'undead', value: 0.20 } },
  demonslayer: { name: 'Demonslayer', category: 'demon_slayer', stat: 'strength', bonus: [5, 15],
    effect: { type: 'damage_vs', target: 'demon', value: 0.20 } }
};

// === EQUIPMENT SUFFIX AUGMENTS ===
const SUFFIX_AUGMENTS = {
  // Elemental Suffixes (different effects than prefixes)
  flames: { name: 'of Flames', category: 'fire', stat: 'strength', bonus: [2, 8],
    effect: { type: 'burn_chance', value: 0.03, duration: 2 } },
  frost: { name: 'of Frost', category: 'ice', stat: 'intelligence', bonus: [2, 8],
    effect: { type: 'slow_chance', value: 0.05, duration: 1 } },
  thunder: { name: 'of Thunder', category: 'lightning', stat: 'agility', bonus: [2, 8],
    effect: { type: 'stun_chance', value: 0.03 } },
  venom: { name: 'of Venom', category: 'poison', stat: 'luck', bonus: [2, 6],
    effect: { type: 'poison_dot', value: 0.02, duration: 3 } },
  light: { name: 'of Light', category: 'holy', stat: 'vitality', bonus: [2, 8],
    effect: { type: 'heal_on_hit', value: 0.02 } },
  darkness: { name: 'of Darkness', category: 'dark', stat: 'agility', bonus: [2, 8],
    effect: { type: 'lifesteal', value: 0.03 } },

  // Stat Suffixes
  might: { name: 'of Might', category: 'strength', stat: 'strength', bonus: [4, 12],
    effect: { type: 'stat_bonus', stat: 'strength' } },
  wisdom: { name: 'of Wisdom', category: 'intelligence', stat: 'intelligence', bonus: [4, 12],
    effect: { type: 'stat_bonus', stat: 'intelligence' } },
  swiftness: { name: 'of Swiftness', category: 'agility', stat: 'agility', bonus: [4, 12],
    effect: { type: 'stat_bonus', stat: 'agility' } },
  fortitude: { name: 'of Fortitude', category: 'vitality', stat: 'vitality', bonus: [4, 12],
    effect: { type: 'stat_bonus', stat: 'vitality' } },
  fortune: { name: 'of Fortune', category: 'luck', stat: 'luck', bonus: [3, 10],
    effect: { type: 'stat_bonus', stat: 'luck' } },

  // Support Suffixes
  vitality: { name: 'of Vitality', category: 'hp', stat: 'vitality', bonus: [3, 10],
    effect: { type: 'hp_max_bonus', value: 0.10 } },
  sorcery: { name: 'of Sorcery', category: 'mp', stat: 'intelligence', bonus: [3, 10],
    effect: { type: 'mp_max_bonus', value: 0.10 } },
  mending: { name: 'of Mending', category: 'regen', stat: 'vitality', bonus: [3, 8],
    effect: { type: 'hp_regen', value: 0.02 } },
  the_sage: { name: 'of the Sage', category: 'mp_regen', stat: 'intelligence', bonus: [3, 8],
    effect: { type: 'mp_regen', value: 0.03 } },

  // Combat Suffixes
  precision: { name: 'of Precision', category: 'accuracy', stat: 'luck', bonus: [3, 10],
    effect: { type: 'crit_damage', value: 0.15 } },
  lethality: { name: 'of Lethality', category: 'crit', stat: 'strength', bonus: [4, 12],
    effect: { type: 'crit_damage', value: 0.25 } },

  // Defensive Suffixes
  the_bulwark: { name: 'of the Bulwark', category: 'block', stat: 'vitality', bonus: [3, 10],
    effect: { type: 'block_chance', value: 0.05 } },
  warding: { name: 'of Warding', category: 'spell_resist', stat: 'intelligence', bonus: [2, 8],
    effect: { type: 'magic_resist', value: 0.08 } },
  the_guardian: { name: 'of the Guardian', category: 'protection', stat: 'vitality', bonus: [4, 10],
    effect: { type: 'damage_reduction', value: 0.05 } }
};

// === CONSUMABLE AUGMENTS ===
const CONSUMABLE_AUGMENTS = {
  // Potency Augments (Prefix-only)
  potent: { prefix: 'Potent', suffix: null, category: 'potency',
    effect: { type: 'effect_multiplier', value: 1.25 } },
  concentrated: { prefix: 'Concentrated', suffix: null, category: 'concentration',
    effect: { type: 'effect_multiplier', value: 1.50 } },
  empowered: { prefix: 'Empowered', suffix: null, category: 'empowerment',
    effect: { type: 'effect_multiplier', value: 2.0 } },

  // Duration Augments (Suffix-only)
  mending: { prefix: null, suffix: 'of Mending', category: 'hot_minor',
    effect: { type: 'hot', value: 5, duration: 3 } },
  restoration: { prefix: null, suffix: 'of Restoration', category: 'hot_major',
    effect: { type: 'hot', value: 10, duration: 5 } },
  regeneration: { prefix: null, suffix: 'of Regeneration', category: 'hot_percent',
    effect: { type: 'hot_percent', value: 0.03, duration: 5 } },

  // Mana Augments
  arcane: { prefix: 'Arcane', suffix: null, category: 'mp_bonus',
    effect: { type: 'mp_bonus', value: 15 } },
  sorcery: { prefix: null, suffix: 'of Sorcery', category: 'mp_regen',
    effect: { type: 'mp_regen', value: 5, duration: 3 } },
  channeling: { prefix: null, suffix: 'of Channeling', category: 'spell_cost',
    effect: { type: 'spell_cost_reduction', value: 0.20, duration: 3 } },

  // Cleansing Augments (Prefix-only)
  purifying: { prefix: 'Purifying', suffix: null, category: 'cleanse_minor',
    effect: { type: 'cleanse', targets: ['poison', 'burn'] } },
  sanctified: { prefix: 'Sanctified', suffix: null, category: 'cleanse_major',
    effect: { type: 'cleanse', targets: ['curse', 'silence', 'blind'] } },
  absolute: { prefix: 'Absolute', suffix: null, category: 'cleanse_all',
    effect: { type: 'cleanse', targets: 'all' } },

  // Buff Augments (Suffix-only)
  fortitude: { prefix: null, suffix: 'of Fortitude', category: 'buff_vit',
    effect: { type: 'buff', stat: 'vitality', value: 5, duration: 5 } },
  might: { prefix: null, suffix: 'of Might', category: 'buff_str',
    effect: { type: 'buff', stat: 'strength', value: 5, duration: 5 } },
  insight: { prefix: null, suffix: 'of Insight', category: 'buff_int',
    effect: { type: 'buff', stat: 'intelligence', value: 5, duration: 5 } },
  alacrity: { prefix: null, suffix: 'of Alacrity', category: 'buff_agi',
    effect: { type: 'buff', stat: 'agility', value: 5, duration: 5 } },

  // Revival Augments
  blessed: { prefix: 'Blessed', suffix: null, category: 'revive_bonus',
    effect: { type: 'revive_hp_bonus', value: 0.25 } },
  divine: { prefix: 'Divine', suffix: null, category: 'revive_full',
    effect: { type: 'revive_full', value: true } },
  grace: { prefix: null, suffix: 'of Grace', category: 'revive_immunity',
    effect: { type: 'revive_immunity', duration: 2 } },

  // Specialty Augments (Suffix-only)
  swiftness: { prefix: null, suffix: 'of Swiftness', category: 'instant',
    effect: { type: 'instant', value: true } },
  sharing: { prefix: null, suffix: 'of Sharing', category: 'aoe',
    effect: { type: 'aoe', radius: 1 } }
};

// Quality prefixes by rarity (equipment)
const EQUIPMENT_QUALITY_PREFIXES = {
  common: null,
  uncommon: 'Fine',
  rare: 'Superior',
  epic: 'Exalted',
  legendary: 'Divine'
};

// Quality prefixes by rarity (consumables)
const CONSUMABLE_QUALITY_PREFIXES = {
  common: null,
  uncommon: 'Fine',
  rare: 'Superior',
  epic: 'Exceptional',
  legendary: 'Supreme'
};

// Stat-based suffix fallbacks (when no augment suffix assigned)
const STAT_SUFFIXES = {
  strength: 'of Might',
  intelligence: 'of Wisdom',
  agility: 'of Swiftness',
  vitality: 'of Fortitude',
  luck: 'of Fortune',
  hp_max: 'of Vitality',
  mp_max: 'of Sorcery'
};

// Legacy export for backwards compatibility
const AUGMENTS = { ...PREFIX_AUGMENTS, ...SUFFIX_AUGMENTS };

/**
 * Roll drops from enemy's drop_table
 * @param {Object} enemy - The enemy unit with dropTable
 * @param {number} difficultyTier - Node difficulty tier
 * @param {string} terrainType - Node terrain type
 * @returns {Array} Array of dropped items
 */
async function rollDrops(enemy, difficultyTier, _terrainType) {
  const dropTable = enemy.dropTable || {};
  const drops = rollFixedDrops(enemy);

  // Fixed drops are independent. Only ordinary loot uses difficulty bonuses.
  const dropChance = dropTable.dropChance ?? 0.5;
  const difficultyBonus = (difficultyTier - 1) * 0.05; // +5% per tier above 1
  const adjustedDropChance = Math.min(1.0, dropChance + difficultyBonus);

  if (Math.random() > adjustedDropChance) {
    return drops;
  }

  // Determine number of items to drop
  const minItems = dropTable.minItems ?? 0;
  const maxItems = dropTable.maxItems ?? 1;
  const itemCount = Math.floor(Math.random() * (maxItems - minItems + 1)) + minItems;

  if (itemCount === 0 || !dropTable.itemPool || dropTable.itemPool.length === 0) {
    return drops;
  }

  // Roll each item
  for (let i = 0; i < itemCount; i++) {
    // Select item from pool using weighted random
    const templateId = selectFromWeightedPool(dropTable.itemPool);
    if (!templateId) continue;

    // Roll rarity
    const rarity = rollRarity(dropTable.rarityWeights || { common: 100 });

    // Generate the item
    const generationSeed = Math.floor(Math.random() * 1000000);
    const item = await generateItem(templateId, generationSeed, enemy.level || 1, rarity);

    if (item) {
      drops.push(item);
    }
  }

  return drops;
}

/**
 * Roll canonical fixed drops without procedural rarity, augments, or tier bonuses.
 *
 * @param {Object} enemy - Enemy unit with a dropTable
 * @param {Function} random - Injectable random source for deterministic tests
 * @returns {Array<Object>} Fixed drop reward records
 */
function rollFixedDrops(enemy, random = Math.random) {
  const fixedDrops = enemy?.dropTable?.fixedDrops;
  if (!Array.isArray(fixedDrops)) return [];

  const drops = [];
  for (const fixedDrop of fixedDrops) {
    const gear = getFishingGearByCatalogKey(fixedDrop?.catalogKey);
    const chance = Number(fixedDrop?.chance);
    if (!gear || !Number.isFinite(chance) || chance <= 0) continue;
    if (Number(random()) >= Math.min(1, chance)) continue;

    const rarityName = getRarityName(gear.rarityId);
    const rarity = RARITIES[rarityName];
    drops.push({
      templateId: null,
      catalogKey: gear.catalogKey,
      fixedDrop: true,
      templateName: gear.name,
      generatedName: gear.name,
      itemType: gear.itemType,
      equipmentSlot: null,
      rarity: rarityName,
      rarityId: rarity.id,
      rarityColor: rarity.color,
      levelRequirement: 1,
      baseStats: {},
      bonusStats: {},
      augments: [],
      material: null,
      quality: null,
      generationSeed: null,
      value: gear.basePrice,
      spriteId: gear.sprite_id,
      modifications: {
        catalogKey: gear.catalogKey,
        fishingTackleKey: gear.key,
        fixedDrop: true,
        generatedName: gear.name,
        spriteId: gear.sprite_id
      }
    });
  }

  return drops;
}

/**
 * Select item from weighted pool
 * @param {Array} pool - Array of { templateId, weight }
 * @returns {number|null} Selected templateId or null
 */
function selectFromWeightedPool(pool) {
  const totalWeight = pool.reduce((sum, item) => sum + (item.weight || 1), 0);
  let random = Math.random() * totalWeight;

  for (const item of pool) {
    random -= (item.weight || 1);
    if (random <= 0) {
      return item.templateId;
    }
  }

  return pool[0]?.templateId || null;
}

/**
 * Roll rarity based on weights
 * @param {Object} weights - { common: 75, uncommon: 20, rare: 5 }
 * @returns {string} Rarity name
 */
function rollRarity(weights) {
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (const [rarity, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      return rarity;
    }
  }

  return 'common';
}

/**
 * Generate augments for an item with category-based duplicate prevention
 * @param {SeededRandom} rng - Random number generator
 * @param {number} bonusSlots - Number of augment slots
 * @param {boolean} isConsumable - Whether this is a consumable item
 * @returns {Array} Array of augment objects
 */
function generateAugments(rng, bonusSlots, isConsumable) {
  const augments = [];
  const usedCategories = new Set();

  if (isConsumable) {
    // Consumable augments use a different system
    const augmentKeys = Object.keys(CONSUMABLE_AUGMENTS);

    for (let i = 0; i < bonusSlots; i++) {
      // Filter to augments with unused categories
      const availableKeys = augmentKeys.filter(key => {
        return !usedCategories.has(CONSUMABLE_AUGMENTS[key].category);
      });

      if (availableKeys.length === 0) continue;

      // Slot 0 prefers prefix augments, slot 1+ prefers suffix
      const preferPrefix = i === 0 ? 0.7 : 0.3;

      // Filter by prefix/suffix preference
      let filteredKeys = availableKeys;
      if (rng.next() < preferPrefix) {
        const prefixKeys = availableKeys.filter(key => CONSUMABLE_AUGMENTS[key].prefix !== null);
        if (prefixKeys.length > 0) filteredKeys = prefixKeys;
      } else {
        const suffixKeys = availableKeys.filter(key => CONSUMABLE_AUGMENTS[key].suffix !== null);
        if (suffixKeys.length > 0) filteredKeys = suffixKeys;
      }

      const augmentKey = rng.pick(filteredKeys);
      const augment = CONSUMABLE_AUGMENTS[augmentKey];

      usedCategories.add(augment.category);

      augments.push({
        key: augmentKey,
        type: augment.prefix ? 'prefix' : 'suffix',
        name: augment.prefix || augment.suffix,
        category: augment.category,
        effect: augment.effect
      });
    }
  } else {
    // Equipment augments use PREFIX_AUGMENTS and SUFFIX_AUGMENTS pools
    for (let i = 0; i < bonusSlots; i++) {
      // Slot 0 prefers prefixes (70%), slot 1+ prefers suffixes (70%)
      const preferPrefix = i === 0 ? 0.7 : 0.3;
      const isPrefix = rng.next() < preferPrefix;

      const pool = isPrefix ? PREFIX_AUGMENTS : SUFFIX_AUGMENTS;
      const poolKeys = Object.keys(pool).filter(key => {
        // Exclude categories already used (prevents "Blazing...of Flames")
        return !usedCategories.has(pool[key].category);
      });

      if (poolKeys.length === 0) continue;

      const augmentKey = rng.pick(poolKeys);
      const augment = pool[augmentKey];

      // Mark this category as used
      usedCategories.add(augment.category);

      const [minBonus, maxBonus] = augment.bonus;
      const bonusValue = rng.nextInt(minBonus, maxBonus);

      augments.push({
        key: augmentKey,
        type: isPrefix ? 'prefix' : 'suffix',
        name: augment.name,
        category: augment.category,
        stat: augment.stat,
        value: bonusValue,
        effect: augment.effect
      });
    }
  }

  return augments;
}

/**
 * Generate a procedural item from template
 * @param {number} templateId - Item template ID
 * @param {number} seed - Generation seed for deterministic results
 * @param {number} targetLevel - Target level for scaling
 * @param {string} forcedRarity - Force a specific rarity
 * @param {Object} [client] - Optional transaction client
 * @returns {Promise<Object|null>} Generated item or null
 */
async function generateItem(templateId, seed, targetLevel, forcedRarity, client) {
  // Get template from database
  const queryFn = client ? client.query.bind(client) : query;
  const result = await queryFn(
    `SELECT id, name, item_type, equipment_slot, stat_bonuses, level_requirement, base_price, rarity, sprite_id
     FROM item_templates WHERE id = $1`,
    [templateId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const template = result.rows[0];
  const rng = new SeededRandom(seed);

  // Determine actual rarity
  const rarityName = forcedRarity || getRarityName(template.rarity);
  const rarityInfo = RARITIES[rarityName] || RARITIES.common;

  // Get material for this level
  const materialTier = MATERIAL_TIERS.find(t =>
    targetLevel >= t.minLevel && targetLevel <= t.maxLevel
  ) || MATERIAL_TIERS[0];
  const material = rng.pick(materialTier.materials);

  // Calculate stat multiplier based on rarity
  const [minMult, maxMult] = rarityInfo.statMult;
  const statMultiplier = minMult + rng.next() * (maxMult - minMult);

  // Parse and scale base stats
  const baseStats = typeof template.stat_bonuses === 'string'
    ? JSON.parse(template.stat_bonuses)
    : template.stat_bonuses || {};

  const scaledStats = {};
  for (const [stat, value] of Object.entries(baseStats)) {
    scaledStats[stat] = Math.floor(value * statMultiplier * (1 + targetLevel * 0.02));
  }

  // Generate bonus stats based on rarity
  const bonusStats = {};
  const bonusSlots = Array.isArray(rarityInfo.bonusSlots)
    ? rng.nextInt(rarityInfo.bonusSlots[0], rarityInfo.bonusSlots[1])
    : rarityInfo.bonusSlots;

  // Check if this is a consumable
  const isConsumable = template.item_type === 'consumable';

  // Roll augments using appropriate pool
  const augments = generateAugments(rng, bonusSlots, isConsumable);

  // Add augment stat bonuses to bonusStats (equipment only)
  if (!isConsumable) {
    for (const augment of augments) {
      if (augment.stat) {
        bonusStats[augment.stat] = (bonusStats[augment.stat] || 0) + augment.value;
      }
    }
  }

  // Generate name
  const generatedName = generateItemName(template, material, rarityName, augments, bonusStats, isConsumable);

  // Calculate scaled price
  const rarityPriceMultiplier = { common: 1, uncommon: 1.5, rare: 2.5, epic: 5, legendary: 10 };
  const scaledPrice = Math.floor(
    template.base_price * (rarityPriceMultiplier[rarityName] || 1) * (1 + targetLevel * 0.05)
  );

  return {
    templateId: template.id,
    templateName: template.name,
    generatedName,
    itemType: template.item_type,
    equipmentSlot: template.equipment_slot,
    rarity: rarityName,
    rarityId: rarityInfo.id,
    rarityColor: rarityInfo.color,
    levelRequirement: Math.max(template.level_requirement, Math.floor(targetLevel * 0.8)),
    baseStats: scaledStats,
    bonusStats,
    augments,
    material,
    quality: materialTier.quality,
    generationSeed: seed,
    value: scaledPrice,
    spriteId: template.sprite_id,
    modifications: {
      generationSeed: seed,
      material,
      rarity: rarityInfo.id,
      baseStats: scaledStats,
      bonusStats,
      augments,
      generatedName,
      spriteId: template.sprite_id
    }
  };
}

/**
 * Get rarity name from ID
 */
function getRarityName(rarityId) {
  const names = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  return names[rarityId - 1] || 'common';
}

/**
 * Generate procedural item name
 * @param {Object} template - Item template with name and item_type
 * @param {string} material - Material name
 * @param {string} rarity - Rarity name (common, uncommon, etc.)
 * @param {Array} augments - Array of augment objects
 * @param {Object} bonusStats - Bonus stats from augments
 * @param {boolean} isConsumable - Whether this is a consumable
 * @returns {string} Generated item name
 */
function generateItemName(template, material, rarity, augments, bonusStats, isConsumable) {
  const parts = [];

  if (isConsumable) {
    // Consumable naming: [Quality?] [Prefix Augment?] Base Name [Suffix Augment?]
    const qualityPrefix = CONSUMABLE_QUALITY_PREFIXES[rarity];
    if (qualityPrefix) parts.push(qualityPrefix);

    // Find prefix augment
    const prefixAug = augments.find(a => a.type === 'prefix');
    if (prefixAug) parts.push(prefixAug.name);

    // Base name (no material for consumables)
    parts.push(template.name);

    // Find suffix augment
    const suffixAug = augments.find(a => a.type === 'suffix');
    if (suffixAug) parts.push(suffixAug.name);

  } else {
    // Equipment naming: [Quality?] [Prefix Augment?] Material Base Name [Suffix Augment?]
    const qualityPrefix = EQUIPMENT_QUALITY_PREFIXES[rarity];
    if (qualityPrefix) parts.push(qualityPrefix);

    // Find prefix augment
    const prefixAug = augments.find(a => a.type === 'prefix');
    if (prefixAug) parts.push(prefixAug.name);

    // Material + base name (strip existing material prefixes AND suffixes)
    parts.push(capitalizeFirst(material));
    let strippedName = template.name
      .replace(/^(Rusty|Iron|Steel|Bronze|Silver|Gold|Mythril|Copper)\s+/i, '');

    // Find suffix augment OR fallback to stat suffix
    const suffixAug = augments.find(a => a.type === 'suffix');
    const hasSuffixToAdd = suffixAug || (bonusStats && Object.keys(bonusStats).length > 0);

    // Strip existing "of X" suffixes from template name if we're adding our own suffix
    if (hasSuffixToAdd) {
      strippedName = strippedName.replace(/\s+of\s+\w+$/i, '');
    }
    parts.push(strippedName);

    if (suffixAug) {
      parts.push(suffixAug.name);
    } else if (bonusStats && Object.keys(bonusStats).length > 0) {
      // Fallback: use highest bonus stat's suffix
      const sortedStats = Object.entries(bonusStats).sort((a, b) => b[1] - a[1]);
      if (sortedStats.length > 0) {
        const [highestStat] = sortedStats[0];
        if (STAT_SUFFIXES[highestStat]) {
          parts.push(STAT_SUFFIXES[highestStat]);
        }
      }
    }
  }

  return parts.filter(Boolean).join(' ');
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Store dropped item in user's shared inventory
 * @param {number} userId - User to receive item
 * @param {Object} item - Generated item
 * @param {Object} client - Database client (for transactions)
 */
async function storeDroppedItem(userId, item, client) {
  const queryFn = client ? client.query.bind(client) : query;

  if (item.fixedDrop && item.catalogKey) {
    const gear = getFishingGearByCatalogKey(item.catalogKey);
    if (!gear || gear.itemType !== 'material') {
      throw new Error(`Unknown fixed drop catalog key: ${item.catalogKey}`);
    }

    const templateResult = await queryFn(
      `INSERT INTO item_templates
       (catalog_key, name, description, item_type, equipment_slot, stat_bonuses,
        level_requirement, effect_type, effect_value, base_price, is_stackable,
        is_tradeable, rarity, sprite_id)
       VALUES ($1, $2, $3, $4, NULL, $5, 1, NULL, NULL, $6, TRUE, FALSE, $7, $8)
       ON CONFLICT (catalog_key) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         item_type = EXCLUDED.item_type,
         equipment_slot = EXCLUDED.equipment_slot,
         stat_bonuses = EXCLUDED.stat_bonuses,
         level_requirement = EXCLUDED.level_requirement,
         effect_type = EXCLUDED.effect_type,
         effect_value = EXCLUDED.effect_value,
         base_price = EXCLUDED.base_price,
         is_stackable = EXCLUDED.is_stackable,
         is_tradeable = EXCLUDED.is_tradeable,
         rarity = EXCLUDED.rarity,
         sprite_id = EXCLUDED.sprite_id
       RETURNING id`,
      [
        gear.catalogKey,
        gear.name,
        gear.description,
        gear.itemType,
        JSON.stringify(gear.statBonuses),
        gear.basePrice,
        gear.rarityId,
        gear.sprite_id
      ]
    );
    const templateId = templateResult.rows[0]?.id;
    if (templateId === null || templateId === undefined) {
      throw new Error(`Failed to resolve fixed drop template: ${item.catalogKey}`);
    }

    item.templateId = templateId;
    const existing = await queryFn(
      `SELECT id FROM character_items
       WHERE user_id = $1
         AND item_template_id = $2
         AND character_id IS NULL
         AND equipped_slot IS NULL
       LIMIT 1
       FOR UPDATE`,
      [userId, templateId]
    );

    if (existing.rows.length > 0) {
      await queryFn(
        'UPDATE character_items SET quantity = quantity + 1 WHERE id = $1',
        [existing.rows[0].id]
      );
    } else {
      await queryFn(
        `INSERT INTO character_items (user_id, item_template_id, quantity, modifications)
         VALUES ($1, $2, 1, $3)`,
        [userId, templateId, JSON.stringify(item.modifications)]
      );
    }
    return;
  }

  await queryFn(
    `INSERT INTO character_items (user_id, item_template_id, quantity, modifications)
     VALUES ($1, $2, 1, $3)`,
    [userId, item.templateId, JSON.stringify(item.modifications)]
  );
}

/**
 * Calculate adjusted drop chance
 */
function calculateDropChance(enemy, difficultyTier) {
  const baseChance = enemy.dropTable?.dropChance || 0.5;
  const difficultyBonus = (difficultyTier - 1) * 0.05;
  return Math.min(1.0, baseChance + difficultyBonus);
}

/**
 * Format dropped items for API response
 */
function formatDropsForResponse(drops) {
  return drops.map(item => ({
    name: item.generatedName,
    templateName: item.templateName,
    itemType: item.itemType,
    rarity: item.rarity,
    rarityColor: item.rarityColor,
    equipmentSlot: item.equipmentSlot,
    baseStats: item.baseStats,
    bonusStats: item.bonusStats,
    levelRequirement: item.levelRequirement,
    value: item.value,
    spriteId: item.spriteId
  }));
}

export {
  rollDrops,
  rollFixedDrops,
  generateItem,
  storeDroppedItem,
  calculateDropChance,
  formatDropsForResponse,
  RARITIES,
  MATERIAL_TIERS,
  AUGMENTS,
  CONSUMABLE_AUGMENTS
};
