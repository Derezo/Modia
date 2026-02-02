/**
 * Recruit Service - Guild recruitment system
 * Handles generating, refreshing, and purchasing recruits from guild nodes
 */

import { query, withTransaction } from '../config/database.js';
import { RACES, GENDERS, calculateStats, MAX_PARTY_SIZE } from '../config/constants.js';
import { generateName } from '../utils/nameGenerator.js';
import { SKILL_TREES } from '../config/skillTrees.js';
import { findSkillDefinition, validateSkillPrerequisites } from '../utils/skillValidation.js';
import {
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  ADDITIONAL_SKILL_COUNT_WEIGHTS,
  weightedRandom,
  calculateRecruitPrice,
  getStarterSkillId
} from '../utils/recruitmentUtils.js';

/**
 * Get tier 1-2 skills for a class (skills without requirements or with only tier-1 requirements)
 * @param {string} guildClass - The class to get skills for
 * @returns {Array} Array of skill objects with tier information
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
        skills.push({ ...skill, tier: 1 });
      }
    }
  }

  // Second pass: collect tier 2 skills (require only tier 1 skills AT LEVEL 1)
  // Recruits get skills at level 1, so we can only include skills whose
  // prerequisites can be satisfied at level 1
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && skill.requires) {
        // Check if all requirements are tier 1 skills AND require level 1 or less
        const requiresOnlyTier1AtLevel1 = Object.entries(skill.requires).every(
          ([reqId, reqLevel]) => tier1SkillIds.has(reqId) && reqLevel <= 1
        );
        if (requiresOnlyTier1AtLevel1) {
          skills.push({ ...skill, tier: 2 });
        }
      }
    }
  }

  return skills;
}

/**
 * Generate a single recruit for a guild node
 * @param {number} nodeId - The guild node ID
 * @param {string} guildClass - The class this guild teaches
 * @param {boolean} isEmergency - If true, cap traits at 1
 * @returns {Promise<Object>} The created recruit
 */
async function generateRecruit(nodeId, guildClass, isEmergency = false) {
  // Random race and gender
  const raceValues = Object.values(RACES);
  const genderValues = Object.values(GENDERS);
  const race = raceValues[Math.floor(Math.random() * raceValues.length)];
  const gender = genderValues[Math.floor(Math.random() * genderValues.length)];

  // Generate name using nameGenerator
  const name = generateName(race, gender);

  // Calculate base stats for level 1
  const baseStats = calculateStats(race, guildClass, 1);

  // Roll overall variance: -15% to +15%
  const variancePercent = (Math.random() * 30) - 15; // -15 to +15

  // Apply variance to each stat
  const variedStats = {
    hpMax: Math.round(baseStats.hpMax * (1 + variancePercent / 100)),
    mpMax: Math.round(baseStats.mpMax * (1 + variancePercent / 100)),
    strength: Math.round(baseStats.strength * (1 + variancePercent / 100)),
    intelligence: Math.round(baseStats.intelligence * (1 + variancePercent / 100)),
    agility: Math.round(baseStats.agility * (1 + variancePercent / 100)),
    vitality: Math.round(baseStats.vitality * (1 + variancePercent / 100)),
    luck: Math.round(baseStats.luck * (1 + variancePercent / 100))
  };

  // Ensure minimum values
  variedStats.hpMax = Math.max(1, variedStats.hpMax);
  variedStats.mpMax = Math.max(0, variedStats.mpMax);
  variedStats.strength = Math.max(1, variedStats.strength);
  variedStats.intelligence = Math.max(1, variedStats.intelligence);
  variedStats.agility = Math.max(1, variedStats.agility);
  variedStats.vitality = Math.max(1, variedStats.vitality);
  variedStats.luck = Math.max(1, variedStats.luck);

  // Roll trait count
  let traitCount = weightedRandom(TRAIT_COUNT_WEIGHTS);
  if (isEmergency) {
    traitCount = Math.min(1, traitCount); // Cap at 1 for emergency
  }

  // Roll additional skill count (beyond the guaranteed starter skill)
  const additionalSkillCount = weightedRandom(ADDITIONAL_SKILL_COUNT_WEIGHTS);

  // Generate XP pool (50-150)
  const xpPool = Math.floor(Math.random() * 101) + 50; // 50 to 150

  // Use transaction to insert recruit, traits, and skills
  return await withTransaction(async (client) => {
    // Determine traits first (for price calculation)
    const assignedTraits = []; // Array of { id, rarity }

    if (traitCount > 0) {
      // Get all traits grouped by rarity
      const traitsResult = await client.query(
        'SELECT id, name, rarity FROM traits ORDER BY rarity, name'
      );

      const traitsByRarity = {
        common: [],
        uncommon: [],
        rare: [],
        legendary: []
      };

      for (const trait of traitsResult.rows) {
        if (traitsByRarity[trait.rarity]) {
          traitsByRarity[trait.rarity].push(trait);
        }
      }

      const assignedTraitIds = new Set();

      for (let i = 0; i < traitCount; i++) {
        // Roll rarity
        const rarity = weightedRandom(TRAIT_RARITY_WEIGHTS);
        let traitPool = traitsByRarity[rarity] || [];

        // Filter out already assigned traits
        traitPool = traitPool.filter(t => !assignedTraitIds.has(t.id));

        // If pool is empty, try other rarities
        if (traitPool.length === 0) {
          for (const r of ['common', 'uncommon', 'rare', 'legendary']) {
            traitPool = traitsByRarity[r].filter(t => !assignedTraitIds.has(t.id));
            if (traitPool.length > 0) break;
          }
        }

        if (traitPool.length > 0) {
          const selectedTrait = traitPool[Math.floor(Math.random() * traitPool.length)];
          assignedTraitIds.add(selectedTrait.id);
          assignedTraits.push({ id: selectedTrait.id, rarity: selectedTrait.rarity });
        }
      }
    }

    // Determine skills (starter + additional)
    const assignedSkills = []; // Array of { id, tier, level }
    const starterSkillId = getStarterSkillId(guildClass);

    // Always add the starter skill (Tier 1, Level 1)
    if (starterSkillId) {
      assignedSkills.push({ id: starterSkillId, tier: 1, level: 1 });
    }

    // Add additional skills if any
    if (additionalSkillCount > 0) {
      const availableSkills = getTier1And2Skills(guildClass);

      // Filter out starter skill from additional skill pool
      let skillPool = availableSkills.filter(s => s.id !== starterSkillId);
      if (skillPool.length === 0) {
        skillPool = availableSkills; // Fall back to including starter if no other options
      }

      const assignedSkillIds = new Set(assignedSkills.map(s => s.id));

      for (let i = 0; i < additionalSkillCount && skillPool.length > 0; i++) {
        // Filter out already assigned skills
        const remaining = skillPool.filter(s => !assignedSkillIds.has(s.id));
        if (remaining.length === 0) break;

        const selectedSkill = remaining[Math.floor(Math.random() * remaining.length)];
        assignedSkillIds.add(selectedSkill.id);
        assignedSkills.push({ id: selectedSkill.id, tier: selectedSkill.tier, level: 1 });
      }
    }

    // Calculate price using the new shared utility
    const price = calculateRecruitPrice({
      stat_variance_percent: variancePercent,
      traits: assignedTraits,
      skills: assignedSkills
    });

    // Insert recruit
    const recruitResult = await client.query(
      `INSERT INTO guild_recruits (
        node_id, name, race, gender, class, level,
        hp_max, mp_max, strength, intelligence, agility, vitality, luck,
        stat_variance_percent, xp_pool, price, is_emergency_restock
      )
      VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        nodeId, name, race, gender, guildClass,
        variedStats.hpMax, variedStats.mpMax,
        variedStats.strength, variedStats.intelligence,
        variedStats.agility, variedStats.vitality, variedStats.luck,
        variancePercent, xpPool, price, isEmergency
      ]
    );

    const recruit = recruitResult.rows[0];

    // Insert traits
    for (const trait of assignedTraits) {
      await client.query(
        'INSERT INTO recruit_traits (recruit_id, trait_id) VALUES ($1, $2)',
        [recruit.id, trait.id]
      );
    }

    // Insert skills
    for (const skill of assignedSkills) {
      await client.query(
        'INSERT INTO recruit_skills (recruit_id, skill_id) VALUES ($1, $2)',
        [recruit.id, skill.id]
      );
    }

    return recruit;
  });
}

/**
 * Refresh all recruits for a guild node
 * @param {number} nodeId - The guild node ID
 * @returns {Promise<Array>} Array of new recruits
 */
async function refreshGuildRecruits(nodeId) {
  // Get guild class for this node
  const nodeResult = await query(
    'SELECT guild_class FROM world_nodes WHERE id = $1 AND node_type = $2',
    [nodeId, 'guild']
  );

  if (nodeResult.rows.length === 0) {
    throw new Error(`Node ${nodeId} is not a guild node`);
  }

  const guildClass = nodeResult.rows[0].guild_class;

  return await withTransaction(async (client) => {
    // Delete all unpurchased recruits for this node
    await client.query(
      'DELETE FROM guild_recruits WHERE node_id = $1 AND purchased_by IS NULL',
      [nodeId]
    );

    // Generate 10 new recruits
    const recruits = [];
    for (let i = 0; i < 10; i++) {
      // Use non-transactional generateRecruit but manually handle inside transaction
      const recruit = await generateRecruitWithClient(client, nodeId, guildClass, false);
      recruits.push(recruit);
    }

    // Update last_recruit_refresh timestamp
    await client.query(
      'UPDATE world_nodes SET last_recruit_refresh = CURRENT_TIMESTAMP WHERE id = $1',
      [nodeId]
    );

    return recruits;
  });
}

/**
 * Internal helper to generate recruit within existing transaction
 */
async function generateRecruitWithClient(client, nodeId, guildClass, isEmergency) {
  // Random race and gender
  const raceValues = Object.values(RACES);
  const genderValues = Object.values(GENDERS);
  const race = raceValues[Math.floor(Math.random() * raceValues.length)];
  const gender = genderValues[Math.floor(Math.random() * genderValues.length)];

  // Generate name
  const name = generateName(race, gender);

  // Calculate base stats
  const baseStats = calculateStats(race, guildClass, 1);

  // Roll variance
  const variancePercent = (Math.random() * 30) - 15;

  // Apply variance
  const variedStats = {
    hpMax: Math.max(1, Math.round(baseStats.hpMax * (1 + variancePercent / 100))),
    mpMax: Math.max(0, Math.round(baseStats.mpMax * (1 + variancePercent / 100))),
    strength: Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100))),
    intelligence: Math.max(1, Math.round(baseStats.intelligence * (1 + variancePercent / 100))),
    agility: Math.max(1, Math.round(baseStats.agility * (1 + variancePercent / 100))),
    vitality: Math.max(1, Math.round(baseStats.vitality * (1 + variancePercent / 100))),
    luck: Math.max(1, Math.round(baseStats.luck * (1 + variancePercent / 100)))
  };

  // Roll trait count
  let traitCount = weightedRandom(TRAIT_COUNT_WEIGHTS);
  if (isEmergency) traitCount = Math.min(1, traitCount);

  // Roll additional skill count (beyond the guaranteed starter skill)
  const additionalSkillCount = weightedRandom(ADDITIONAL_SKILL_COUNT_WEIGHTS);

  // XP pool
  const xpPool = Math.floor(Math.random() * 101) + 50;

  // Determine traits first (for price calculation)
  const assignedTraits = []; // Array of { id, rarity }

  if (traitCount > 0) {
    const traitsResult = await client.query(
      'SELECT id, name, rarity FROM traits ORDER BY rarity, name'
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
        assignedTraits.push({ id: selectedTrait.id, rarity: selectedTrait.rarity });
      }
    }
  }

  // Determine skills (starter + additional)
  const assignedSkills = []; // Array of { id, tier, level }
  const starterSkillId = getStarterSkillId(guildClass);

  // Always add the starter skill (Tier 1, Level 1)
  if (starterSkillId) {
    assignedSkills.push({ id: starterSkillId, tier: 1, level: 1 });
  }

  // Add additional skills if any
  if (additionalSkillCount > 0) {
    const availableSkills = getTier1And2Skills(guildClass);
    let skillPool = availableSkills.filter(s => s.id !== starterSkillId);
    if (skillPool.length === 0) skillPool = availableSkills;

    const assignedSkillIds = new Set(assignedSkills.map(s => s.id));

    for (let i = 0; i < additionalSkillCount && skillPool.length > 0; i++) {
      const remaining = skillPool.filter(s => !assignedSkillIds.has(s.id));
      if (remaining.length === 0) break;

      const selectedSkill = remaining[Math.floor(Math.random() * remaining.length)];
      assignedSkillIds.add(selectedSkill.id);
      assignedSkills.push({ id: selectedSkill.id, tier: selectedSkill.tier, level: 1 });
    }
  }

  // Calculate price using the new shared utility
  const price = calculateRecruitPrice({
    stat_variance_percent: variancePercent,
    traits: assignedTraits,
    skills: assignedSkills
  });

  // Insert recruit
  const recruitResult = await client.query(
    `INSERT INTO guild_recruits (
      node_id, name, race, gender, class, level,
      hp_max, mp_max, strength, intelligence, agility, vitality, luck,
      stat_variance_percent, xp_pool, price, is_emergency_restock
    )
    VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      nodeId, name, race, gender, guildClass,
      variedStats.hpMax, variedStats.mpMax,
      variedStats.strength, variedStats.intelligence,
      variedStats.agility, variedStats.vitality, variedStats.luck,
      variancePercent, xpPool, price, isEmergency
    ]
  );

  const recruit = recruitResult.rows[0];

  // Insert traits
  for (const trait of assignedTraits) {
    await client.query(
      'INSERT INTO recruit_traits (recruit_id, trait_id) VALUES ($1, $2)',
      [recruit.id, trait.id]
    );
  }

  // Insert skills
  for (const skill of assignedSkills) {
    await client.query(
      'INSERT INTO recruit_skills (recruit_id, skill_id) VALUES ($1, $2)',
      [recruit.id, skill.id]
    );
  }

  return recruit;
}

/**
 * Check if guild recruits need refreshing and refresh if needed
 * Uses lazy refresh - checks on access rather than scheduled job
 * @param {number} nodeId - The guild node ID
 * @returns {Promise<boolean>} True if refresh was performed, false otherwise
 */
async function checkAndRefreshIfNeeded(nodeId) {
  // Get guild node refresh info
  const nodeResult = await query(
    'SELECT recruit_refresh_hour, last_recruit_refresh FROM world_nodes WHERE id = $1 AND node_type = $2',
    [nodeId, 'guild']
  );

  if (nodeResult.rows.length === 0) {
    return false; // Not a guild node
  }

  const { recruit_refresh_hour, last_recruit_refresh } = nodeResult.rows[0];
  const now = new Date();

  // If never refreshed, needs refresh (first access)
  if (!last_recruit_refresh) {
    await refreshGuildRecruits(nodeId);
    return true;
  }

  // Calculate today's refresh time
  const lastRefresh = new Date(last_recruit_refresh);
  const todayRefreshTime = new Date(now);
  todayRefreshTime.setUTCHours(recruit_refresh_hour || 0, 0, 0, 0);

  // If we're past today's refresh time and last refresh was before it
  if (now >= todayRefreshTime && lastRefresh < todayRefreshTime) {
    await refreshGuildRecruits(nodeId);
    return true;
  }

  // Also check for yesterday's missed refresh (handles case where server was down)
  const yesterdayRefreshTime = new Date(todayRefreshTime);
  yesterdayRefreshTime.setUTCDate(yesterdayRefreshTime.getUTCDate() - 1);

  if (lastRefresh < yesterdayRefreshTime) {
    await refreshGuildRecruits(nodeId);
    return true;
  }

  return false;
}

/**
 * Spawn emergency recruits when pool is empty
 * @param {number} nodeId - The guild node ID
 * @returns {Promise<Array>} Array of emergency recruits
 */
async function spawnEmergencyRecruits(nodeId) {
  // Get guild class for this node
  const nodeResult = await query(
    'SELECT guild_class FROM world_nodes WHERE id = $1 AND node_type = $2',
    [nodeId, 'guild']
  );

  if (nodeResult.rows.length === 0) {
    throw new Error(`Node ${nodeId} is not a guild node`);
  }

  const guildClass = nodeResult.rows[0].guild_class;

  return await withTransaction(async (client) => {
    const recruits = [];

    // Generate 3 emergency recruits
    for (let i = 0; i < 3; i++) {
      const recruit = await generateRecruitWithClient(client, nodeId, guildClass, true);
      recruits.push(recruit);
    }

    return recruits;
  });
}

/**
 * Get all available (unpurchased) recruits for a guild node
 * @param {number} nodeId - The guild node ID
 * @returns {Promise<Array>} Array of recruits with traits and skills
 */
async function getAvailableRecruits(nodeId) {
  // Get recruits
  const recruitsResult = await query(
    `SELECT gr.*
     FROM guild_recruits gr
     WHERE gr.node_id = $1 AND gr.purchased_by IS NULL
     ORDER BY gr.price ASC`,
    [nodeId]
  );

  const recruits = recruitsResult.rows;

  if (recruits.length === 0) {
    return [];
  }

  // Get recruit IDs
  const recruitIds = recruits.map(r => r.id);

  // Get traits for all recruits
  const traitsResult = await query(
    `SELECT rt.recruit_id, t.id as trait_id, t.name, t.description, t.category, t.rarity, t.effect_type, t.effect_value
     FROM recruit_traits rt
     JOIN traits t ON rt.trait_id = t.id
     WHERE rt.recruit_id = ANY($1)`,
    [recruitIds]
  );

  // Get skills for all recruits
  const skillsResult = await query(
    `SELECT recruit_id, skill_id
     FROM recruit_skills
     WHERE recruit_id = ANY($1)`,
    [recruitIds]
  );

  // Map traits and skills to recruits
  const traitsByRecruit = {};
  for (const trait of traitsResult.rows) {
    if (!traitsByRecruit[trait.recruit_id]) {
      traitsByRecruit[trait.recruit_id] = [];
    }
    traitsByRecruit[trait.recruit_id].push({
      id: trait.trait_id,
      name: trait.name,
      description: trait.description,
      category: trait.category,
      rarity: trait.rarity,
      effectType: trait.effect_type,
      effectValue: parseFloat(trait.effect_value)
    });
  }

  const skillsByRecruit = {};
  for (const skill of skillsResult.rows) {
    if (!skillsByRecruit[skill.recruit_id]) {
      skillsByRecruit[skill.recruit_id] = [];
    }
    skillsByRecruit[skill.recruit_id].push(skill.skill_id);
  }

  // Combine data
  return recruits.map(recruit => ({
    id: recruit.id,
    nodeId: recruit.node_id,
    name: recruit.name,
    race: recruit.race,
    gender: recruit.gender,
    class: recruit.class,
    level: recruit.level,
    stats: {
      hpMax: recruit.hp_max,
      mpMax: recruit.mp_max,
      strength: recruit.strength,
      intelligence: recruit.intelligence,
      agility: recruit.agility,
      vitality: recruit.vitality,
      luck: recruit.luck
    },
    statVariancePercent: parseFloat(recruit.stat_variance_percent),
    xpPool: recruit.xp_pool,
    price: recruit.price,
    isEmergencyRestock: recruit.is_emergency_restock,
    traits: traitsByRecruit[recruit.id] || [],
    skills: skillsByRecruit[recruit.id] || [],
    createdAt: recruit.created_at
  }));
}

/**
 * Purchase a recruit and create a new character
 * @param {number} recruitId - The recruit to purchase
 * @param {number} userId - The user purchasing
 * @returns {Promise<Object>} The new character
 */
async function purchaseRecruit(recruitId, userId) {
  return await withTransaction(async (client) => {
    // Get recruit with FOR UPDATE lock
    const recruitResult = await client.query(
      `SELECT gr.*, wn.id as guild_node_id
       FROM guild_recruits gr
       JOIN world_nodes wn ON gr.node_id = wn.id
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

    // Create character from recruit
    const characterResult = await client.query(
      `INSERT INTO characters (
        user_id, name, race, class, gender, level, experience,
        hp_current, hp_max, mp_current, mp_max,
        strength, intelligence, agility, vitality, luck,
        party_slot, current_node_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        userId, recruit.name, recruit.race, recruit.class, recruit.gender,
        recruit.level, recruit.xp_pool, // xp_pool becomes starting experience
        recruit.hp_max, recruit.mp_max,
        recruit.strength, recruit.intelligence,
        recruit.agility, recruit.vitality, recruit.luck,
        nextSlot <= MAX_PARTY_SIZE ? nextSlot : null,
        recruit.guild_node_id // Start at the guild they were hired from
      ]
    );

    const character = characterResult.rows[0];

    // Copy traits to character_traits
    const recruitTraits = await client.query(
      'SELECT trait_id FROM recruit_traits WHERE recruit_id = $1',
      [recruitId]
    );

    for (const trait of recruitTraits.rows) {
      await client.query(
        'INSERT INTO character_traits (character_id, trait_id) VALUES ($1, $2)',
        [character.id, trait.trait_id]
      );
    }

    // Copy skills to character_skills (grant at level 1)
    // With defensive prerequisite validation to catch any invalid assignments
    const recruitSkills = await client.query(
      'SELECT skill_id FROM recruit_skills WHERE recruit_id = $1',
      [recruitId]
    );

    // Build map of all skills being granted (all at level 1) for prerequisite checking
    const grantedSkillLevels = new Map(
      recruitSkills.rows.map(s => [s.skill_id, 1])
    );

    for (const skill of recruitSkills.rows) {
      // Defensive check: validate prerequisites can be met
      const skillDef = findSkillDefinition(recruit.class, skill.skill_id);

      if (skillDef?.requires) {
        const validation = validateSkillPrerequisites(
          recruit.class,
          skill.skill_id,
          grantedSkillLevels
        );

        if (!validation.valid) {
          // Log warning but skip this skill - don't propagate invalid data
          console.warn(
            `[RecruitService] Skipping skill ${skill.skill_id} for recruit ${recruitId}: ` +
            `unmet prerequisites: ${validation.missing.map(m => `${m.skillId} level ${m.required}`).join(', ')}`
          );
          continue;
        }
      }

      await client.query(
        `INSERT INTO character_skills (character_id, skill_id, level)
         VALUES ($1, $2, 1)
         ON CONFLICT (character_id, skill_id) DO NOTHING`,
        [character.id, skill.skill_id]
      );
    }

    // Grant starter skill if not already granted
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
      'UPDATE guild_recruits SET purchased_by = $1, purchased_at = CURRENT_TIMESTAMP WHERE id = $2',
      [userId, recruitId]
    );

    // Get final character data with traits and skills
    const traitsResult = await client.query(
      `SELECT t.id, t.name, t.description, t.category, t.rarity, t.effect_type, t.effect_value
       FROM character_traits ct
       JOIN traits t ON ct.trait_id = t.id
       WHERE ct.character_id = $1`,
      [character.id]
    );

    const skillsResult = await client.query(
      'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
      [character.id]
    );

    return {
      character: {
        ...character,
        traits: traitsResult.rows.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          rarity: t.rarity,
          effectType: t.effect_type,
          effectValue: parseFloat(t.effect_value)
        })),
        skills: skillsResult.rows.map(s => ({
          skillId: s.skill_id,
          level: s.level
        }))
      },
      goldSpent: recruit.price,
      remainingGold: userGold - recruit.price
    };
  });
}

export {
  generateRecruit,
  refreshGuildRecruits,
  spawnEmergencyRecruits,
  checkAndRefreshIfNeeded,
  getAvailableRecruits,
  purchaseRecruit
};

// Re-export shared utilities for convenience and backward compatibility
export {
  RECRUIT_PRICING,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  ADDITIONAL_SKILL_COUNT_WEIGHTS,
  weightedRandom,
  calculateRecruitPrice,
  getStarterSkillId
} from '../utils/recruitmentUtils.js';
