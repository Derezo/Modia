/**
 * NPC Item Service - Generates consumable items for NPC inventories
 *
 * Uses the same item definitions as player consumables (DB templates).
 * effectValue is ABSOLUTE (e.g., 50 = restore 50 HP flat).
 *
 * Tier-based item generation:
 *
 * Humanoid NPCs (goblin, bandit, dark knight):
 *   - Tier 1-2: 1 item (Health Potion)
 *   - Tier 3-4: 2 items (Hi-Potion + chance for Mana Potion)
 *   - Tier 5: 3 items (Hi-Potion, Mana Potion, chance for Elixir)
 *
 * Beast/Animal NPCs (wolf, spider, bat):
 *   - Tier 1-3: No items (0% chance)
 *   - Tier 4: 10% chance for 1 healing item
 *   - Tier 5: 25% chance for 1-2 items
 *
 * Boss Enemies (any archetype at tier 5 or marked as boss):
 *   - Always have items
 *   - Higher quality items
 */

/**
 * Item definitions matching DB item_templates canonical effectTypes.
 * These mirror the actual database records so NPC items behave identically to player items.
 */
const NPC_ITEM_TABLES = {
  health_potion: {
    itemId: 12,
    name: 'Health Potion',
    effectType: 'heal_hp',
    effectValue: 50
  },
  hi_potion: {
    itemId: 29,
    name: 'Hi-Potion',
    effectType: 'heal_hp',
    effectValue: 150
  },
  mana_potion: {
    itemId: 13,
    name: 'Mana Potion',
    effectType: 'heal_mp',
    effectValue: 30
  },
  hi_ether: {
    itemId: 30,
    name: 'Hi-Ether',
    effectType: 'heal_mp',
    effectValue: 80
  },
  elixir: {
    itemId: 31,
    name: 'Elixir',
    effectType: 'heal_both',
    effectValue: 100
  }
};

/**
 * Archetypes considered "intelligent" and always have items
 */
const INTELLIGENT_ARCHETYPES = ['humanoid', 'demon', 'undead', 'construct'];

/**
 * Archetypes considered "beast" with rare item chance
 */
const BEAST_ARCHETYPES = ['beast', 'insect', 'plant', 'elemental'];

/**
 * Generate items for an NPC based on their template and difficulty tier
 *
 * @param {Object} template - Enemy template with archetype info
 * @param {number} enemyLevel - The enemy's level
 * @param {number} difficultyTier - Node difficulty tier (1-5)
 * @returns {Array} Array of consumable items for this NPC
 */
function generateNpcItems(template, enemyLevel, difficultyTier) {
  const items = [];
  const archetype = template.archetype || 'beast';
  const isIntelligent = INTELLIGENT_ARCHETYPES.includes(archetype);
  const isBeast = BEAST_ARCHETYPES.includes(archetype);
  const isBoss = template.isBoss || difficultyTier >= 5;
  const isDragon = archetype === 'dragon';

  // Dragons always have a hoard with items
  if (isDragon) {
    return generateDragonItems(difficultyTier);
  }

  // Intelligent NPCs (humanoids, demons, undead, constructs) always have items
  if (isIntelligent || isBoss) {
    return generateIntelligentNpcItems(difficultyTier, isBoss);
  }

  // Beasts rarely have items (from eaten adventurers)
  if (isBeast) {
    return generateBeastItems(difficultyTier);
  }

  // Default: no items
  return items;
}

/**
 * Generate items for intelligent NPCs (humanoids, demons, etc.)
 *
 * @param {number} tier - Difficulty tier
 * @param {boolean} isBoss - Whether this is a boss enemy
 * @returns {Array} Items array
 */
function generateIntelligentNpcItems(tier, isBoss) {
  const items = [];

  // Healing item (always present)
  if (tier >= 3 || isBoss) {
    items.push({ ...NPC_ITEM_TABLES.hi_potion, quantity: 1 });
  } else {
    items.push({ ...NPC_ITEM_TABLES.health_potion, quantity: 1 });
  }

  // MP item (tier 3+ or boss)
  if (tier >= 3 || isBoss) {
    const mpChance = 0.3 + tier * 0.1; // 40% at tier 3, 50% at tier 4, 60% at tier 5
    if (Math.random() < mpChance || isBoss) {
      if (tier >= 4 || isBoss) {
        items.push({ ...NPC_ITEM_TABLES.hi_ether, quantity: 1 });
      } else {
        items.push({ ...NPC_ITEM_TABLES.mana_potion, quantity: 1 });
      }
    }
  }

  // Elixir (tier 5 bosses only, 20% chance)
  if (isBoss && tier >= 5 && Math.random() < 0.2) {
    items.push({ ...NPC_ITEM_TABLES.elixir, quantity: 1 });
  }

  return items;
}

/**
 * Generate rare items for beast enemies
 *
 * @param {number} tier - Difficulty tier
 * @returns {Array} Items array (often empty)
 */
function generateBeastItems(tier) {
  const items = [];

  // Tier 1-3: No items
  if (tier <= 3) {
    return items;
  }

  // Tier 4: 10% chance
  // Tier 5: 25% chance
  const itemChance = tier >= 5 ? 0.25 : 0.1;

  if (Math.random() < itemChance) {
    // Found in the belly of the beast!
    items.push({ ...NPC_ITEM_TABLES.health_potion, quantity: 1 });

    // At tier 5, small chance for a second item
    if (tier >= 5 && Math.random() < 0.3) {
      items.push({ ...NPC_ITEM_TABLES.mana_potion, quantity: 1 });
    }
  }

  return items;
}

/**
 * Generate items from a dragon's hoard
 *
 * @param {number} tier - Difficulty tier
 * @returns {Array} Items array
 */
function generateDragonItems(tier) {
  const items = [];

  // Dragons always have good items
  items.push({ ...NPC_ITEM_TABLES.hi_potion, quantity: 1 });

  if (tier >= 3) {
    items.push({ ...NPC_ITEM_TABLES.hi_ether, quantity: 1 });
  }

  // High tier dragons might have elixir
  if (tier >= 4 && Math.random() < 0.3 + (tier - 4) * 0.2) {
    items.push({ ...NPC_ITEM_TABLES.elixir, quantity: 1 });
  }

  return items;
}

export {
  generateNpcItems,
  generateIntelligentNpcItems,
  generateBeastItems,
  generateDragonItems,
  NPC_ITEM_TABLES,
  INTELLIGENT_ARCHETYPES,
  BEAST_ARCHETYPES
};
