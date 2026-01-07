/**
 * Item Drop Service - Procedural item generation and drop rolling
 */

const { query } = require('../config/database');

// Seeded random number generator (Mulberry32)
class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }
}

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

// Augment definitions
const AUGMENTS = {
  fire: { prefix: 'Blazing', suffix: 'of Flames', stat: 'strength', bonus: [2, 8] },
  ice: { prefix: 'Frozen', suffix: 'of Frost', stat: 'intelligence', bonus: [2, 8] },
  lightning: { prefix: 'Shocking', suffix: 'of Thunder', stat: 'agility', bonus: [2, 8] },
  life: { prefix: 'Vital', suffix: 'of Life', stat: 'vitality', bonus: [3, 10] },
  fortune: { prefix: 'Lucky', suffix: 'of Fortune', stat: 'luck', bonus: [3, 12] },
  power: { prefix: 'Mighty', suffix: 'of Power', stat: 'strength', bonus: [4, 12] },
  wisdom: { prefix: 'Wise', suffix: 'of Wisdom', stat: 'intelligence', bonus: [4, 12] },
  swift: { prefix: 'Swift', suffix: 'of Swiftness', stat: 'agility', bonus: [4, 12] }
};

/**
 * Roll drops from enemy's drop_table
 * @param {Object} enemy - The enemy unit with dropTable
 * @param {number} difficultyTier - Node difficulty tier
 * @param {string} terrainType - Node terrain type
 * @returns {Array} Array of dropped items
 */
async function rollDrops(enemy, difficultyTier, terrainType) {
  const dropTable = enemy.dropTable || {};
  const drops = [];

  // Check if anything drops at all
  const dropChance = dropTable.dropChance || 0.5;
  const difficultyBonus = (difficultyTier - 1) * 0.05; // +5% per tier above 1
  const adjustedDropChance = Math.min(1.0, dropChance + difficultyBonus);

  if (Math.random() > adjustedDropChance) {
    return drops; // No drops this time
  }

  // Determine number of items to drop
  const minItems = dropTable.minItems || 0;
  const maxItems = dropTable.maxItems || 1;
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
 * Generate a procedural item from template
 * @param {number} templateId - Item template ID
 * @param {number} seed - Generation seed for deterministic results
 * @param {number} targetLevel - Target level for scaling
 * @param {string} forcedRarity - Force a specific rarity
 * @returns {Promise<Object|null>} Generated item or null
 */
async function generateItem(templateId, seed, targetLevel, forcedRarity) {
  // Get template from database
  const result = await query(
    `SELECT id, name, item_type, equipment_slot, stat_bonuses, level_requirement, base_price, rarity
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

  // Roll augments
  const augments = [];
  const augmentKeys = Object.keys(AUGMENTS);

  for (let i = 0; i < bonusSlots; i++) {
    const augmentKey = rng.pick(augmentKeys);
    const augment = AUGMENTS[augmentKey];
    const [minBonus, maxBonus] = augment.bonus;
    const bonusValue = rng.nextInt(minBonus, maxBonus);

    augments.push({
      type: augmentKey,
      prefix: augment.prefix,
      suffix: augment.suffix,
      stat: augment.stat,
      value: bonusValue
    });

    // Add to bonus stats
    bonusStats[augment.stat] = (bonusStats[augment.stat] || 0) + bonusValue;
  }

  // Generate name
  const generatedName = generateItemName(template.name, material, materialTier.quality, augments);

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
    modifications: {
      generationSeed: seed,
      material,
      rarity: rarityInfo.id,
      baseStats: scaledStats,
      bonusStats,
      augments,
      generatedName
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
 */
function generateItemName(baseName, material, quality, augments) {
  const parts = [];

  // Add quality prefix if rare or above
  if (quality !== 'Common' && quality !== 'Fine') {
    parts.push(quality);
  }

  // Add first augment prefix
  if (augments.length > 0) {
    parts.push(augments[0].prefix);
  }

  // Add material
  parts.push(capitalizeFirst(material));

  // Add base name (stripped of generic material references)
  const strippedName = baseName
    .replace(/^(Rusty|Iron|Steel|Bronze|Silver|Gold|Mythril)\s+/i, '');
  parts.push(strippedName);

  // Add last augment suffix
  if (augments.length > 1) {
    parts.push(augments[augments.length - 1].suffix);
  }

  return parts.join(' ');
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Store dropped item in character inventory
 * @param {number} characterId - Character to receive item
 * @param {Object} item - Generated item
 * @param {Object} client - Database client (for transactions)
 */
async function storeDroppedItem(characterId, item, client) {
  const queryFn = client ? client.query.bind(client) : query;

  await queryFn(
    `INSERT INTO character_items (character_id, item_template_id, quantity, modifications)
     VALUES ($1, $2, 1, $3)`,
    [characterId, item.templateId, JSON.stringify(item.modifications)]
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
    value: item.value
  }));
}

module.exports = {
  rollDrops,
  generateItem,
  storeDroppedItem,
  calculateDropChance,
  formatDropsForResponse,
  RARITIES,
  MATERIAL_TIERS,
  AUGMENTS
};
