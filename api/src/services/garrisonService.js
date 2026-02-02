/**
 * Garrison Service - Castle garrison recruitment system
 * Handles generating, refreshing, and purchasing recruits from castle garrison nodes
 *
 * Key differences from guild recruits:
 * - Garrison recruits have regional race/class weighting (70% regional, 30% random)
 * - Refreshed hourly rather than daily
 * - Each castle maintains its own recruit pool
 */

import { query, withTransaction } from '../config/database.js';
import {
  RACES,
  GENDERS,
  CLASSES,
  REGIONS,
  GARRISON_CONFIG,
  calculateStats,
  MAX_PARTY_SIZE
} from '../../../shared/constants.js';
import { generateName } from '../utils/nameGenerator.js';
import { SKILL_TREES } from '../config/skillTrees.js';

// Pricing constants (same as recruitService.js for consistency)
const BASE_RECRUIT_PRICE = 2000;
const TRAIT_BONUS_PRICE = 8000;
const SKILL_BONUS_PRICE = 750;

// Trait rarity weights: 70% common, 20% uncommon, 8% rare, 2% legendary
const TRAIT_RARITY_WEIGHTS = {
  common: 70,
  uncommon: 20,
  rare: 8,
  legendary: 2
};

// Trait count weights: 92% get 1 trait, 8% get 2 traits
const TRAIT_COUNT_WEIGHTS = {
  1: 92,
  2: 8
};

// Skill count weights: 60% get 0, 30% get 1, 10% get 2
const SKILL_COUNT_WEIGHTS = {
  0: 60,
  1: 30,
  2: 10
};

/**
 * Roll a value based on weighted probabilities
 * @param {Object} weights - { option1: weight1, option2: weight2, ... }
 * @returns {string|number} Selected option key
 */
function weightedRandom(weights) {
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (const [option, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      const num = Number(option);
      return isNaN(num) ? option : num;
    }
  }

  const firstKey = Object.keys(weights)[0];
  const num = Number(firstKey);
  return isNaN(num) ? firstKey : num;
}

/**
 * Get region data by region ID
 * @param {number} regionId - Region ID (1-5)
 * @returns {Object|null} Region data or null if not found
 */
function getRegionById(regionId) {
  for (const region of Object.values(REGIONS)) {
    if (region.id === regionId) {
      return region;
    }
  }
  return null;
}

/**
 * Get region key by region ID for class lookup
 * @param {number} regionId - Region ID (1-5)
 * @returns {string|null} Region key or null if not found
 */
function getRegionKeyById(regionId) {
  for (const [key, region] of Object.entries(REGIONS)) {
    if (region.id === regionId) {
      return key.toLowerCase();
    }
  }
  return null;
}

/**
 * Select a race based on regional weighting
 * @param {number} regionId - The region ID
 * @returns {string} Selected race
 */
function selectRaceForRegion(regionId) {
  const region = getRegionById(regionId);
  const raceWeight = GARRISON_CONFIG.raceWeight;

  if (region && Math.random() < raceWeight.regional) {
    // Use regional race
    return region.race;
  } else {
    // Random race
    const raceValues = Object.values(RACES);
    return raceValues[Math.floor(Math.random() * raceValues.length)];
  }
}

/**
 * Select a class based on regional weighting
 * @param {number} regionId - The region ID
 * @returns {string} Selected class
 */
function selectClassForRegion(regionId) {
  const regionKey = getRegionKeyById(regionId);
  const classWeight = GARRISON_CONFIG.classWeight;
  const regionalClasses = GARRISON_CONFIG.regionalClasses[regionKey];

  if (regionalClasses && Math.random() < classWeight.regional) {
    // Use regional class (pick randomly from regional options)
    return regionalClasses[Math.floor(Math.random() * regionalClasses.length)];
  } else {
    // Random class
    const classValues = Object.values(CLASSES);
    return classValues[Math.floor(Math.random() * classValues.length)];
  }
}

/**
 * Get tier 1-2 skills for a class (skills without requirements or with only tier-1 requirements at level 1)
 * @param {string} guildClass - The class to get skills for
 * @returns {Array} Array of skill objects
 */
function getTier1And2Skills(guildClass) {
  const classTree = SKILL_TREES[guildClass];
  if (!classTree) return [];

  const skills = [];
  const tier1SkillIds = new Set();

  // First pass: collect tier 1 skills (no requirements)
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && !skill.requires) {
        tier1SkillIds.add(skill.id);
        skills.push(skill);
      }
    }
  }

  // Second pass: collect tier 2 skills (require only tier 1 skills at level 1)
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && skill.requires) {
        const requiresOnlyTier1AtLevel1 = Object.entries(skill.requires).every(
          ([reqId, reqLevel]) => tier1SkillIds.has(reqId) && reqLevel <= 1
        );
        if (requiresOnlyTier1AtLevel1) {
          skills.push(skill);
        }
      }
    }
  }

  return skills;
}

/**
 * Get the default starter skill for a class
 * @param {string} guildClass - The class
 * @returns {string|null} Starter skill ID
 */
function getStarterSkillId(guildClass) {
  const starterSkills = {
    warrior: 'power_strike',
    wizard: 'fireball',
    monk: 'palm_strike',
    chemist: 'potion_toss'
  };
  return starterSkills[guildClass] || null;
}

/**
 * Calculate the price for a recruit based on their attributes
 * @param {Object} recruit - Recruit data with stat_variance_percent, traitCount, skillCount
 * @returns {number} Price in gold
 */
function calculateRecruitPrice(recruit) {
  let price = BASE_RECRUIT_PRICE;

  // Multiply by (1 + stat_variance_percent/100) for stat bonus
  const varianceMultiplier = 1 + (recruit.stat_variance_percent || 0) / 100;
  price = Math.floor(price * varianceMultiplier);

  // Add 8000g for each trait beyond the first
  const traitCount = recruit.traitCount || 0;
  if (traitCount > 1) {
    price += TRAIT_BONUS_PRICE * (traitCount - 1);
  }

  // Add 750g per pre-learned skill
  const skillCount = recruit.skillCount || 0;
  price += SKILL_BONUS_PRICE * skillCount;

  return Math.max(price, BASE_RECRUIT_PRICE);
}

/**
 * Generate garrison recruits for a castle node
 * @param {number} castleNodeId - The castle node ID
 * @param {number} regionId - The region ID for weighting
 * @returns {Promise<Array>} Array of generated recruits
 */
async function generateGarrisonRecruits(castleNodeId, regionId) {
  const { min, max } = GARRISON_CONFIG.recruitsPerCastle;
  const recruitCount = Math.floor(Math.random() * (max - min + 1)) + min;

  return await withTransaction(async (client) => {
    const recruits = [];

    for (let i = 0; i < recruitCount; i++) {
      const recruit = await generateRecruitWithClient(client, castleNodeId, regionId);
      recruits.push(recruit);
    }

    return recruits;
  });
}

/**
 * Internal helper to generate a recruit within an existing transaction
 * @param {Object} client - Database client
 * @param {number} castleNodeId - Castle node ID
 * @param {number} regionId - Region ID for weighting
 * @returns {Promise<Object>} Generated recruit
 */
async function generateRecruitWithClient(client, castleNodeId, regionId) {
  // Select race and class with regional weighting
  const race = selectRaceForRegion(regionId);
  const guildClass = selectClassForRegion(regionId);
  const genderValues = Object.values(GENDERS);
  const gender = genderValues[Math.floor(Math.random() * genderValues.length)];

  // Generate name
  const name = generateName(race, gender);

  // Calculate base stats for level 1
  const baseStats = calculateStats(race, guildClass, 1);

  // Roll variance: -15% to +15%
  const variancePercent = (Math.random() * 30) - 15;

  // Apply variance to stats
  const stats = {
    hp_max: Math.max(1, Math.round(baseStats.hpMax * (1 + variancePercent / 100))),
    mp_max: Math.max(0, Math.round(baseStats.mpMax * (1 + variancePercent / 100))),
    strength: Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100))),
    intelligence: Math.max(1, Math.round(baseStats.intelligence * (1 + variancePercent / 100))),
    agility: Math.max(1, Math.round(baseStats.agility * (1 + variancePercent / 100))),
    vitality: Math.max(1, Math.round(baseStats.vitality * (1 + variancePercent / 100))),
    luck: Math.max(1, Math.round(baseStats.luck * (1 + variancePercent / 100)))
  };

  // Roll trait count
  const traitCount = weightedRandom(TRAIT_COUNT_WEIGHTS);

  // Roll skill count
  const skillCount = weightedRandom(SKILL_COUNT_WEIGHTS);

  // Generate traits
  const traits = [];
  if (traitCount > 0) {
    const traitsResult = await client.query(
      'SELECT id, name, description, rarity, category, effect_type, effect_value FROM traits ORDER BY rarity, name'
    );

    const traitsByRarity = { common: [], uncommon: [], rare: [], legendary: [] };
    for (const trait of traitsResult.rows) {
      if (traitsByRarity[trait.rarity]) {
        traitsByRarity[trait.rarity].push(trait);
      }
    }

    const assignedTraitIds = new Set();

    for (let i = 0; i < traitCount; i++) {
      const rarity = weightedRandom(TRAIT_RARITY_WEIGHTS);
      let traitPool = (traitsByRarity[rarity] || []).filter(t => !assignedTraitIds.has(t.id));

      if (traitPool.length === 0) {
        for (const r of ['common', 'uncommon', 'rare', 'legendary']) {
          traitPool = traitsByRarity[r].filter(t => !assignedTraitIds.has(t.id));
          if (traitPool.length > 0) break;
        }
      }

      if (traitPool.length > 0) {
        const selectedTrait = traitPool[Math.floor(Math.random() * traitPool.length)];
        assignedTraitIds.add(selectedTrait.id);
        traits.push({
          id: selectedTrait.id,
          name: selectedTrait.name,
          description: selectedTrait.description,
          rarity: selectedTrait.rarity,
          category: selectedTrait.category,
          effectType: selectedTrait.effect_type,
          effectValue: parseFloat(selectedTrait.effect_value)
        });
      }
    }
  }

  // Generate skills
  const skills = [];
  if (skillCount > 0) {
    const availableSkills = getTier1And2Skills(guildClass);
    const starterSkillId = getStarterSkillId(guildClass);
    let skillPool = availableSkills.filter(s => s.id !== starterSkillId);
    if (skillPool.length === 0) skillPool = availableSkills;

    const assignedSkillIds = new Set();

    for (let i = 0; i < skillCount && skillPool.length > 0; i++) {
      const remaining = skillPool.filter(s => !assignedSkillIds.has(s.id));
      if (remaining.length === 0) break;

      const selectedSkill = remaining[Math.floor(Math.random() * remaining.length)];
      assignedSkillIds.add(selectedSkill.id);
      skills.push(selectedSkill.id);
    }
  }

  // Calculate price
  const price = calculateRecruitPrice({
    stat_variance_percent: variancePercent,
    traitCount: traits.length,
    skillCount: skills.length
  });

  // Insert recruit
  const recruitResult = await client.query(
    `INSERT INTO garrison_recruits (
      castle_node_id, name, race, class, level, experience,
      stats, traits, equipment, skills, price
    )
    VALUES ($1, $2, $3, $4, 1, 0, $5, $6, $7, $8, $9)
    RETURNING *`,
    [
      castleNodeId,
      name,
      race,
      guildClass,
      JSON.stringify(stats),
      JSON.stringify(traits),
      JSON.stringify([]), // Empty starting equipment
      JSON.stringify(skills),
      price
    ]
  );

  return recruitResult.rows[0];
}

/**
 * Get available (unpurchased) recruits for a castle
 * @param {number} castleNodeId - The castle node ID
 * @returns {Promise<Array>} Array of available recruits
 */
async function getAvailableRecruits(castleNodeId) {
  const result = await query(
    `SELECT id, castle_node_id, name, race, class, level, experience,
            stats, traits, equipment, skills, price, generated_at
     FROM garrison_recruits
     WHERE castle_node_id = $1 AND purchased_by IS NULL
     ORDER BY price ASC`,
    [castleNodeId]
  );

  return result.rows.map(recruit => ({
    id: recruit.id,
    castleNodeId: recruit.castle_node_id,
    name: recruit.name,
    race: recruit.race,
    class: recruit.class,
    level: recruit.level,
    experience: recruit.experience,
    stats: {
      hpMax: recruit.stats.hp_max || recruit.stats.hpMax,
      mpMax: recruit.stats.mp_max || recruit.stats.mpMax,
      strength: recruit.stats.strength,
      intelligence: recruit.stats.intelligence,
      agility: recruit.stats.agility,
      vitality: recruit.stats.vitality,
      luck: recruit.stats.luck
    },
    traits: recruit.traits || [],
    equipment: recruit.equipment || [],
    skills: recruit.skills || [],
    price: recruit.price,
    generatedAt: recruit.generated_at
  }));
}

/**
 * Purchase a garrison recruit and create a new character
 * @param {number} userId - The user ID purchasing
 * @param {number} recruitId - The recruit ID to purchase
 * @param {string} characterName - Optional new name for the character
 * @returns {Promise<Object>} The new character and transaction details
 */
async function purchaseRecruit(userId, recruitId, characterName = null) {
  return await withTransaction(async (client) => {
    // Get recruit with FOR UPDATE lock
    const recruitResult = await client.query(
      `SELECT gr.*, wn.id as castle_node_id, wn.region_id
       FROM garrison_recruits gr
       JOIN world_nodes wn ON gr.castle_node_id = wn.id
       WHERE gr.id = $1
       FOR UPDATE`,
      [recruitId]
    );

    if (recruitResult.rows.length === 0) {
      throw new Error('Recruit not found');
    }

    const recruit = recruitResult.rows[0];

    if (recruit.purchased_by !== null) {
      throw new Error('Recruit has already been purchased');
    }

    // Get user gold with lock
    const userResult = await client.query(
      'SELECT gold FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const userGold = userResult.rows[0].gold;

    if (userGold < recruit.price) {
      throw new Error(`Not enough gold. Need ${recruit.price}, have ${userGold}`);
    }

    // Check character count limit
    const countResult = await client.query(
      'SELECT COUNT(*) as count FROM characters WHERE user_id = $1',
      [userId]
    );

    if (parseInt(countResult.rows[0].count, 10) >= MAX_PARTY_SIZE) {
      throw new Error(`Cannot have more than ${MAX_PARTY_SIZE} characters`);
    }

    // Find next available party slot
    const slotResult = await client.query(
      `SELECT COALESCE(MAX(party_slot), 0) + 1 as next_slot
       FROM characters WHERE user_id = $1 AND party_slot IS NOT NULL`,
      [userId]
    );
    const nextSlot = Math.min(slotResult.rows[0].next_slot, MAX_PARTY_SIZE);

    // Parse stats from JSONB
    const stats = recruit.stats;

    // Use provided name or recruit's original name
    const finalName = characterName || recruit.name;

    // Create character from recruit
    const characterResult = await client.query(
      `INSERT INTO characters (
        user_id, name, race, class, gender, level, experience,
        hp_current, hp_max, mp_current, mp_max,
        strength, intelligence, agility, vitality, luck,
        party_slot, current_node_id
      )
      VALUES ($1, $2, $3, $4, 'other', $5, $6, $7, $7, $8, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        userId,
        finalName,
        recruit.race,
        recruit.class,
        recruit.level,
        recruit.experience || 0,
        stats.hp_max,
        stats.mp_max,
        stats.strength,
        stats.intelligence,
        stats.agility,
        stats.vitality,
        stats.luck,
        nextSlot <= MAX_PARTY_SIZE ? nextSlot : null,
        recruit.castle_node_id
      ]
    );

    const character = characterResult.rows[0];

    // Copy traits to character_traits (traits stored as JSONB array in recruit)
    const traits = recruit.traits || [];
    for (const trait of traits) {
      await client.query(
        'INSERT INTO character_traits (character_id, trait_id) VALUES ($1, $2)',
        [character.id, trait.id]
      );
    }

    // Grant skills (skills stored as JSONB array of skill IDs)
    const skills = recruit.skills || [];
    for (const skillId of skills) {
      await client.query(
        `INSERT INTO character_skills (character_id, skill_id, level)
         VALUES ($1, $2, 1)
         ON CONFLICT (character_id, skill_id) DO NOTHING`,
        [character.id, skillId]
      );
    }

    // Grant starter skill
    const starterSkillId = getStarterSkillId(recruit.class);
    if (starterSkillId) {
      await client.query(
        `INSERT INTO character_skills (character_id, skill_id, level)
         VALUES ($1, $2, 1)
         ON CONFLICT (character_id, skill_id) DO NOTHING`,
        [character.id, starterSkillId]
      );
    }

    // Deduct gold from user
    await client.query(
      'UPDATE users SET gold = gold - $1 WHERE id = $2',
      [recruit.price, userId]
    );

    // Mark recruit as purchased
    await client.query(
      'UPDATE garrison_recruits SET purchased_by = $1, purchased_at = CURRENT_TIMESTAMP WHERE id = $2',
      [userId, recruitId]
    );

    // Get final character data with traits and skills
    const finalTraitsResult = await client.query(
      `SELECT t.id, t.name, t.description, t.category, t.rarity, t.effect_type, t.effect_value
       FROM character_traits ct
       JOIN traits t ON ct.trait_id = t.id
       WHERE ct.character_id = $1`,
      [character.id]
    );

    const finalSkillsResult = await client.query(
      'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
      [character.id]
    );

    return {
      character: {
        ...character,
        traits: finalTraitsResult.rows.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          rarity: t.rarity,
          effectType: t.effect_type,
          effectValue: parseFloat(t.effect_value)
        })),
        skills: finalSkillsResult.rows.map(s => ({
          skillId: s.skill_id,
          level: s.level
        }))
      },
      goldSpent: recruit.price,
      remainingGold: userGold - recruit.price
    };
  });
}

/**
 * Refresh all garrison recruits across all castles
 * Deletes unpurchased recruits and regenerates for each castle
 * @returns {Promise<Object>} Summary of refresh operation
 */
async function refreshAllGarrisons() {
  return await withTransaction(async (client) => {
    // Delete all unpurchased recruits
    const deleteResult = await client.query(
      'DELETE FROM garrison_recruits WHERE purchased_by IS NULL'
    );
    const deletedCount = deleteResult.rowCount;

    // Get all castle nodes
    const castleResult = await client.query(
      'SELECT id, region_id FROM world_nodes WHERE node_type = \'castle\''
    );

    let totalGenerated = 0;

    // Regenerate recruits for each castle
    for (const castle of castleResult.rows) {
      const { min, max } = GARRISON_CONFIG.recruitsPerCastle;
      const recruitCount = Math.floor(Math.random() * (max - min + 1)) + min;

      for (let i = 0; i < recruitCount; i++) {
        await generateRecruitWithClient(client, castle.id, castle.region_id);
        totalGenerated++;
      }
    }

    return {
      deletedCount,
      castleCount: castleResult.rows.length,
      totalGenerated
    };
  });
}

/**
 * Check if a castle's garrison needs refresh and trigger if stale
 * Lazy refresh - checks on access rather than scheduled job
 * @param {number} castleNodeId - The castle node ID
 * @returns {Promise<boolean>} True if refresh was performed
 */
async function checkAndRefreshIfStale(castleNodeId) {
  // Get castle info
  const castleResult = await query(
    'SELECT id, region_id FROM world_nodes WHERE id = $1 AND node_type = \'castle\'',
    [castleNodeId]
  );

  if (castleResult.rows.length === 0) {
    return false; // Not a castle node
  }

  const castle = castleResult.rows[0];

  // Check for existing recruits and their age
  const recruitResult = await query(
    `SELECT generated_at FROM garrison_recruits
     WHERE castle_node_id = $1 AND purchased_by IS NULL
     ORDER BY generated_at DESC
     LIMIT 1`,
    [castleNodeId]
  );

  const now = new Date();

  // If no recruits exist, generate them
  if (recruitResult.rows.length === 0) {
    await generateGarrisonRecruits(castleNodeId, castle.region_id);
    return true;
  }

  // Check if recruits are past the hour mark (stale)
  const generatedAt = new Date(recruitResult.rows[0].generated_at);
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);

  // If generated before the current hour started, refresh
  if (generatedAt < currentHour) {
    // Delete stale recruits and regenerate
    await withTransaction(async (client) => {
      await client.query(
        'DELETE FROM garrison_recruits WHERE castle_node_id = $1 AND purchased_by IS NULL',
        [castleNodeId]
      );

      const { min, max } = GARRISON_CONFIG.recruitsPerCastle;
      const recruitCount = Math.floor(Math.random() * (max - min + 1)) + min;

      for (let i = 0; i < recruitCount; i++) {
        await generateRecruitWithClient(client, castleNodeId, castle.region_id);
      }
    });

    return true;
  }

  return false;
}

export {
  generateGarrisonRecruits,
  getAvailableRecruits,
  purchaseRecruit,
  refreshAllGarrisons,
  checkAndRefreshIfStale,
  calculateRecruitPrice,
  // Export for testing
  BASE_RECRUIT_PRICE,
  TRAIT_BONUS_PRICE,
  SKILL_BONUS_PRICE,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  SKILL_COUNT_WEIGHTS
};
