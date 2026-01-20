/**
 * NPC Item Service - Generates consumable items for NPC inventories
 *
 * Tier-based item generation:
 *
 * Humanoid NPCs (goblin, bandit, dark knight):
 *   - Tier 1-2: 1 item (healing potion)
 *   - Tier 3-4: 2 items (healing potion + chance for MP potion)
 *   - Tier 5: 3 items (hi-potion, MP potion, chance for elixir)
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
 * Item definitions for NPC use
 * effectValue is a PERCENTAGE (e.g., 25 = restore 25% of max)
 * This matches battleService.processAction implementation
 */
const NPC_ITEM_TABLES = {
  healing_potion: {
    itemId: 'healing_potion',
    name: 'Healing Potion',
    effectType: 'hp_restore',
    effectValue: 25  // Restore 25% HP
  },
  hi_potion: {
    itemId: 'hi_potion',
    name: 'Hi-Potion',
    effectType: 'hp_restore',
    effectValue: 50  // Restore 50% HP
  },
  mp_potion: {
    itemId: 'mp_potion',
    name: 'Ether',
    effectType: 'mp_restore',
    effectValue: 25  // Restore 25% MP
  },
  hi_ether: {
    itemId: 'hi_ether',
    name: 'Hi-Ether',
    effectType: 'mp_restore',
    effectValue: 50  // Restore 50% MP
  },
  elixir: {
    itemId: 'elixir',
    name: 'Elixir',
    effectType: 'elixir',
    effectValue: 50  // Restore 50% of both HP and MP
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
    items.push({ ...NPC_ITEM_TABLES.healing_potion, quantity: 1 });
  }

  // MP item (tier 3+ or boss)
  if (tier >= 3 || isBoss) {
    const mpChance = 0.3 + tier * 0.1; // 40% at tier 3, 50% at tier 4, 60% at tier 5
    if (Math.random() < mpChance || isBoss) {
      if (tier >= 4 || isBoss) {
        items.push({ ...NPC_ITEM_TABLES.hi_ether, quantity: 1 });
      } else {
        items.push({ ...NPC_ITEM_TABLES.mp_potion, quantity: 1 });
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
    items.push({ ...NPC_ITEM_TABLES.healing_potion, quantity: 1 });

    // At tier 5, small chance for a second item
    if (tier >= 5 && Math.random() < 0.3) {
      items.push({ ...NPC_ITEM_TABLES.mp_potion, quantity: 1 });
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

/**
 * Check if an NPC should use an item
 * Called by AI when deciding actions
 *
 * @param {Object} unit - The NPC unit
 * @param {Array} items - Available items
 * @returns {Object|null} Item to use and target, or null if no item should be used
 */
function shouldUseItem(unit, items) {
  if (!items || items.length === 0) {
    return null;
  }

  // Check HP items
  const hpPercent = unit.hp / unit.maxHp;
  if (hpPercent < 0.4) {
    const healingItem = items.find(
      item => item.effectType === 'hp_restore' && item.quantity > 0
    );
    if (healingItem) {
      return {
        item: healingItem,
        target: unit,
        reason: 'low_hp'
      };
    }
  }

  // Check MP items (for units with skills that need MP)
  if (unit.skills && unit.skills.length > 0) {
    const mpPercent = unit.mp / unit.maxMp;
    if (mpPercent < 0.3) {
      const mpItem = items.find(
        item => item.effectType === 'mp_restore' && item.quantity > 0
      );
      if (mpItem) {
        return {
          item: mpItem,
          target: unit,
          reason: 'low_mp'
        };
      }
    }
  }

  // Check elixir (only when both HP and MP are low)
  if (hpPercent < 0.5) {
    const mpPercent = unit.mp / unit.maxMp;
    if (mpPercent < 0.5) {
      const elixir = items.find(
        item => item.effectType === 'elixir' && item.quantity > 0
      );
      if (elixir) {
        return {
          item: elixir,
          target: unit,
          reason: 'critical'
        };
      }
    }
  }

  return null;
}

/**
 * Use an item from the NPC's inventory
 * Decrements the quantity and returns the effect value
 *
 * @param {Object} item - Item to use
 * @param {Object} unit - Unit using the item
 * @returns {Object} Effect result
 */
function useNpcItem(item, unit) {
  if (item.quantity <= 0) {
    return { error: 'Item out of stock' };
  }

  // Decrement quantity
  item.quantity--;

  // Calculate effect
  switch (item.effectType) {
    case 'hp_restore': {
      const hpRestored = Math.min(item.effectValue, unit.maxHp - unit.hp);
      unit.hp += hpRestored;
      return { hpRestored, newHp: unit.hp };
    }

    case 'mp_restore': {
      const mpRestored = Math.min(item.effectValue, unit.maxMp - unit.mp);
      unit.mp += mpRestored;
      return { mpRestored, newMp: unit.mp };
    }

    case 'elixir': {
      // Restore percentage of both HP and MP
      const hpAmount = Math.floor(unit.maxHp * item.effectValue);
      const mpAmount = Math.floor(unit.maxMp * item.effectValue);
      const actualHp = Math.min(hpAmount, unit.maxHp - unit.hp);
      const actualMp = Math.min(mpAmount, unit.maxMp - unit.mp);
      unit.hp += actualHp;
      unit.mp += actualMp;
      return { hpRestored: actualHp, mpRestored: actualMp, newHp: unit.hp, newMp: unit.mp };
    }

    default:
      return { error: 'Unknown item effect type' };
  }
}

export {
  generateNpcItems,
  generateIntelligentNpcItems,
  generateBeastItems,
  generateDragonItems,
  shouldUseItem,
  useNpcItem,
  NPC_ITEM_TABLES,
  INTELLIGENT_ARCHETYPES,
  BEAST_ARCHETYPES
};
