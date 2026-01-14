/**
 * Enemy Templates
 *
 * All enemy definitions for the game.
 * Organized by difficulty tier and spawn location.
 *
 * Tiers:
 * - Tier 1: Starter enemies (forest)
 * - Tier 1-2: Cave enemies
 * - Tier 2-3: Mountain enemies
 * - Tier 2: Bridge enemies
 * - Tier 4+: Palace enemies
 */

export const ENEMY_TEMPLATES = [
  // Tier 1 - Forest (starter area)
  {
    name: 'Goblin Warrior',
    sprite_id: 'goblin_warrior',
    base_hp: 40, base_mp: 10, base_strength: 8, base_intelligence: 4, base_agility: 6,
    spawn_node_types: ['forest'], ai_type: 'aggressive',
    experience_reward: 20, gold_reward_min: 5, gold_reward_max: 15, min_difficulty_tier: 1,
    drop_table: { dropChance: 0.6, minItems: 0, maxItems: 1, rarityWeights: { common: 85, uncommon: 15 }, itemPool: [{ templateId: 1, weight: 50 }, { templateId: 12, weight: 50 }] }
  },
  {
    name: 'Gray Wolf',
    sprite_id: 'gray_wolf',
    base_hp: 35, base_mp: 5, base_strength: 10, base_intelligence: 2, base_agility: 10,
    spawn_node_types: ['forest', 'mountain'], ai_type: 'pack',
    experience_reward: 25, gold_reward_min: 3, gold_reward_max: 10, min_difficulty_tier: 1,
    drop_table: { dropChance: 0.5, minItems: 0, maxItems: 1, rarityWeights: { common: 90, uncommon: 10 }, itemPool: [{ templateId: 12, weight: 70 }, { templateId: 13, weight: 30 }] }
  },
  {
    name: 'Forest Slime',
    sprite_id: 'forest_slime',
    base_hp: 30, base_mp: 10, base_strength: 5, base_intelligence: 3, base_agility: 4,
    spawn_node_types: ['forest', 'cave'], ai_type: 'defensive',
    experience_reward: 10, gold_reward_min: 1, gold_reward_max: 5, min_difficulty_tier: 1,
    drop_table: { dropChance: 0.4, minItems: 0, maxItems: 1, rarityWeights: { common: 95, uncommon: 5 }, itemPool: [{ templateId: 12, weight: 100 }] }
  },

  // Tier 1-2 - Caves
  {
    name: 'Cave Bat',
    sprite_id: 'cave_bat',
    base_hp: 25, base_mp: 15, base_strength: 5, base_intelligence: 6, base_agility: 12,
    spawn_node_types: ['cave'], ai_type: 'hit-and-run',
    experience_reward: 15, gold_reward_min: 2, gold_reward_max: 8, min_difficulty_tier: 1,
    drop_table: { dropChance: 0.35, minItems: 0, maxItems: 1, rarityWeights: { common: 90, uncommon: 10 }, itemPool: [{ templateId: 13, weight: 100 }] }
  },
  {
    name: 'Giant Spider',
    sprite_id: 'giant_spider',
    base_hp: 45, base_mp: 20, base_strength: 10, base_intelligence: 5, base_agility: 9,
    spawn_node_types: ['cave', 'forest'], ai_type: 'ambush',
    experience_reward: 35, gold_reward_min: 8, gold_reward_max: 20, min_difficulty_tier: 2,
    drop_table: { dropChance: 0.65, minItems: 0, maxItems: 2, rarityWeights: { common: 70, uncommon: 25, rare: 5 }, itemPool: [{ templateId: 13, weight: 40 }, { templateId: 7, weight: 30 }, { templateId: 12, weight: 30 }] }
  },
  {
    name: 'Skeleton Warrior',
    sprite_id: 'skeleton_warrior',
    base_hp: 50, base_mp: 0, base_strength: 12, base_intelligence: 2, base_agility: 6,
    spawn_node_types: ['cave'], ai_type: 'tactical',
    experience_reward: 40, gold_reward_min: 10, gold_reward_max: 25, min_difficulty_tier: 2,
    drop_table: { dropChance: 0.7, minItems: 0, maxItems: 2, rarityWeights: { common: 60, uncommon: 30, rare: 10 }, itemPool: [{ templateId: 1, weight: 35 }, { templateId: 2, weight: 25 }, { templateId: 7, weight: 40 }] }
  },
  {
    name: 'Stone Golem',
    sprite_id: 'stone_golem',
    base_hp: 80, base_mp: 0, base_strength: 15, base_intelligence: 1, base_agility: 2,
    spawn_node_types: ['cave', 'mountain'], ai_type: 'defensive',
    experience_reward: 50, gold_reward_min: 15, gold_reward_max: 30, min_difficulty_tier: 2,
    drop_table: { dropChance: 0.75, minItems: 1, maxItems: 2, rarityWeights: { common: 50, uncommon: 35, rare: 15 }, itemPool: [{ templateId: 8, weight: 50 }, { templateId: 11, weight: 50 }] }
  },

  // Tier 2-3 - Mountains
  {
    name: 'Mountain Troll',
    sprite_id: 'mountain_troll',
    base_hp: 100, base_mp: 5, base_strength: 18, base_intelligence: 3, base_agility: 4,
    spawn_node_types: ['mountain', 'bridge'], ai_type: 'aggressive',
    experience_reward: 75, gold_reward_min: 25, gold_reward_max: 50, min_difficulty_tier: 3,
    drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 40, uncommon: 40, rare: 18, epic: 2 }, itemPool: [{ templateId: 2, weight: 30 }, { templateId: 3, weight: 25 }, { templateId: 8, weight: 25 }, { templateId: 15, weight: 20 }] }
  },
  {
    name: 'Troll Shaman',
    sprite_id: 'troll_shaman',
    base_hp: 70, base_mp: 50, base_strength: 10, base_intelligence: 14, base_agility: 6,
    spawn_node_types: ['mountain'], ai_type: 'support',
    experience_reward: 65, gold_reward_min: 20, gold_reward_max: 45, min_difficulty_tier: 3,
    abilities: [{ type: 'heal', power: 30 }, { type: 'debuff', effect: 'slow' }],
    drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 35, uncommon: 40, rare: 20, epic: 5 }, itemPool: [{ templateId: 4, weight: 35 }, { templateId: 5, weight: 35 }, { templateId: 13, weight: 30 }] }
  },
  {
    name: 'Harpy',
    sprite_id: 'harpy',
    base_hp: 55, base_mp: 30, base_strength: 12, base_intelligence: 8, base_agility: 14,
    spawn_node_types: ['mountain'], ai_type: 'hit-and-run',
    experience_reward: 55, gold_reward_min: 15, gold_reward_max: 35, min_difficulty_tier: 3,
    drop_table: { dropChance: 0.7, minItems: 0, maxItems: 2, rarityWeights: { common: 45, uncommon: 40, rare: 15 }, itemPool: [{ templateId: 10, weight: 40 }, { templateId: 6, weight: 30 }, { templateId: 13, weight: 30 }] }
  },

  // Tier 2 - Bridges
  {
    name: 'Bridge Bandit',
    sprite_id: 'bridge_bandit',
    base_hp: 45, base_mp: 20, base_strength: 12, base_intelligence: 8, base_agility: 8,
    spawn_node_types: ['bridge'], ai_type: 'tactical',
    experience_reward: 35, gold_reward_min: 20, gold_reward_max: 40, min_difficulty_tier: 2,
    drop_table: { dropChance: 0.75, minItems: 1, maxItems: 2, rarityWeights: { common: 55, uncommon: 35, rare: 10 }, itemPool: [{ templateId: 1, weight: 30 }, { templateId: 6, weight: 30 }, { templateId: 10, weight: 20 }, { templateId: 12, weight: 20 }] }
  },
  {
    name: 'Bandit Captain',
    sprite_id: 'bandit_captain',
    base_hp: 65, base_mp: 25, base_strength: 14, base_intelligence: 10, base_agility: 10,
    spawn_node_types: ['bridge'], ai_type: 'tactical',
    experience_reward: 55, gold_reward_min: 35, gold_reward_max: 60, min_difficulty_tier: 2,
    drop_table: { dropChance: 0.85, minItems: 1, maxItems: 3, rarityWeights: { common: 40, uncommon: 40, rare: 17, epic: 3 }, itemPool: [{ templateId: 2, weight: 25 }, { templateId: 3, weight: 20 }, { templateId: 8, weight: 25 }, { templateId: 10, weight: 15 }, { templateId: 15, weight: 15 }] }
  },
  {
    name: 'Bridge Troll',
    sprite_id: 'bridge_troll',
    base_hp: 90, base_mp: 10, base_strength: 16, base_intelligence: 4, base_agility: 5,
    spawn_node_types: ['bridge'], ai_type: 'aggressive',
    experience_reward: 70, gold_reward_min: 30, gold_reward_max: 55, min_difficulty_tier: 3,
    drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 35, uncommon: 45, rare: 18, epic: 2 }, itemPool: [{ templateId: 3, weight: 35 }, { templateId: 8, weight: 35 }, { templateId: 11, weight: 30 }] }
  },

  // Tier 4+ - Palace area
  {
    name: 'Dark Knight',
    sprite_id: 'dark_knight',
    base_hp: 120, base_mp: 30, base_strength: 20, base_intelligence: 8, base_agility: 10,
    spawn_node_types: ['palace'], ai_type: 'tactical',
    experience_reward: 120, gold_reward_min: 50, gold_reward_max: 100, min_difficulty_tier: 4,
    drop_table: { dropChance: 0.9, minItems: 1, maxItems: 3, rarityWeights: { common: 20, uncommon: 40, rare: 30, epic: 10 }, itemPool: [{ templateId: 3, weight: 30 }, { templateId: 8, weight: 30 }, { templateId: 11, weight: 25 }, { templateId: 15, weight: 15 }] }
  },
  {
    name: 'Shadow Assassin',
    sprite_id: 'shadow_assassin',
    base_hp: 75, base_mp: 40, base_strength: 16, base_intelligence: 12, base_agility: 18,
    spawn_node_types: ['palace'], ai_type: 'ambush',
    experience_reward: 100, gold_reward_min: 40, gold_reward_max: 80, min_difficulty_tier: 4,
    drop_table: { dropChance: 0.85, minItems: 1, maxItems: 2, rarityWeights: { common: 25, uncommon: 40, rare: 28, epic: 7 }, itemPool: [{ templateId: 6, weight: 40 }, { templateId: 10, weight: 35 }, { templateId: 15, weight: 25 }] }
  },
  {
    name: 'Palace Guard',
    sprite_id: 'palace_guard',
    base_hp: 100, base_mp: 20, base_strength: 16, base_intelligence: 6, base_agility: 8,
    spawn_node_types: ['palace'], ai_type: 'defensive',
    experience_reward: 90, gold_reward_min: 35, gold_reward_max: 70, min_difficulty_tier: 4,
    drop_table: { dropChance: 0.85, minItems: 1, maxItems: 2, rarityWeights: { common: 30, uncommon: 40, rare: 25, epic: 5 }, itemPool: [{ templateId: 2, weight: 30 }, { templateId: 8, weight: 35 }, { templateId: 11, weight: 35 }] }
  }
];
