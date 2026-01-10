/**
 * NPC Skill Service - Generates and manages skills for NPCs
 *
 * Handles skill assignment for:
 * - Monster NPCs: Uses monster skill trees based on archetype
 * - Humanoid NPCs: Uses player guild skill trees
 *
 * Skills are procedurally selected and scaled based on enemy level and difficulty.
 */

import MONSTER_SKILL_TREES from '../config/monsterSkillTrees.js';
import { SKILL_TREES } from '../config/skillTrees.js';
import { pool } from '../config/database.js';

/**
 * Calculate the maximum number of skill slots for an enemy
 * Formula: 2 + floor(level/15) + floor(tier/2), capped at 6
 * @param {number} enemyLevel - The enemy's level
 * @param {number} difficultyTier - The difficulty tier (1-5)
 * @returns {number} Maximum skill slots
 */
function getMaxSkillSlots(enemyLevel, difficultyTier) {
  const baseSlots = 2;
  const levelSlots = Math.floor(enemyLevel / 15);
  const tierSlots = Math.floor(difficultyTier / 2);
  return Math.min(baseSlots + levelSlots + tierSlots, 6);
}

/**
 * Calculate the skill level for an enemy skill
 * Formula: floor(enemyLevel * 0.4) + 1 + tierBonus + variance
 * @param {number} enemyLevel - The enemy's level
 * @param {number} difficultyTier - The difficulty tier (1-5)
 * @returns {number} Skill level
 */
function calculateSkillLevel(enemyLevel, difficultyTier) {
  const baseLevel = Math.floor(enemyLevel * 0.4) + 1;
  const tierBonus = Math.floor((difficultyTier - 1) * 0.5);
  const variance = Math.floor(Math.random() * 2) - 1; // -1, 0, or 1
  return Math.max(1, Math.min(baseLevel + tierBonus + variance, 10)); // Cap at 10
}

/**
 * Scale skill power based on skill level
 * Formula: basePower * (1 + (level-1) * 0.05)
 * @param {number} basePower - The base power of the skill
 * @param {number} skillLevel - The skill's level
 * @returns {number} Scaled power
 */
function scaleSkillPower(basePower, skillLevel) {
  return Math.floor(basePower * (1 + (skillLevel - 1) * 0.05));
}

/**
 * Scale skill MP cost based on skill level
 * Formula: baseMpCost * (1 + (level-1) * 0.03)
 * @param {number} baseMpCost - The base MP cost of the skill
 * @param {number} skillLevel - The skill's level
 * @returns {number} Scaled MP cost
 */
function scaleSkillMpCost(baseMpCost, skillLevel) {
  return Math.floor(baseMpCost * (1 + (skillLevel - 1) * 0.03));
}

/**
 * Get skills from monster skill trees for an archetype
 * @param {string} archetype - Monster archetype (beast, dragon, etc.)
 * @returns {Array} Array of skill definitions
 */
function getMonsterSkillsForArchetype(archetype) {
  const tree = MONSTER_SKILL_TREES[archetype?.toLowerCase()];
  if (!tree) {
    console.warn(`[NPC Skills] No skill tree found for archetype: ${archetype}`);
    return [];
  }

  const skills = [];
  for (const branch of tree.branches) {
    for (const skill of branch.skills) {
      skills.push({
        ...skill,
        branch: branch.name.toLowerCase(),
        source: 'monster'
      });
    }
  }
  return skills;
}

/**
 * Get skills from player guild skill trees for humanoid NPCs
 * @param {string} guild - Guild name (warrior, wizard, monk, chemist)
 * @returns {Array} Array of skill definitions
 */
function getGuildSkillsForHumanoid(guild) {
  const guildTree = SKILL_TREES[guild?.toLowerCase()];
  if (!guildTree) {
    console.warn(`[NPC Skills] No guild skill tree found for: ${guild}`);
    return [];
  }

  const skills = [];
  for (const branch of guildTree.branches) {
    for (const skill of branch.skills) {
      // Only include active skills (not passives)
      if (skill.type === 'active') {
        skills.push({
          ...skill,
          branch: branch.name.toLowerCase(),
          source: 'guild'
        });
      }
    }
  }
  return skills;
}

/**
 * Filter skills based on level requirements and unlock chances
 * @param {Array} skills - Available skills
 * @param {number} enemyLevel - Enemy level
 * @param {Object} templateSkills - Map of skill_id -> template skill data
 * @returns {Array} Filtered skills that meet requirements
 */
function filterAvailableSkills(skills, enemyLevel, templateSkills = {}) {
  return skills.filter(skill => {
    const templateData = templateSkills[skill.id];

    // Check level requirements if defined in template
    if (templateData) {
      if (enemyLevel < templateData.min_enemy_level) {
        return false;
      }
      // Check unlock chance
      if (Math.random() > templateData.unlock_chance) {
        return false;
      }
    }

    // Require skills after certain levels
    if (skill.requires) {
      // For NPCs, simplify requirements - just check if high-level skill
      const requiresLevel = Object.values(skill.requires)[0] || 0;
      if (enemyLevel < requiresLevel * 3) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Select skills for an NPC based on priority and variety
 * @param {Array} availableSkills - Skills that can be selected
 * @param {number} maxSlots - Maximum number of skills to select
 * @returns {Array} Selected skills
 */
function selectSkills(availableSkills, maxSlots) {
  if (availableSkills.length <= maxSlots) {
    return availableSkills;
  }

  // Sort by priority (higher = more likely to be selected)
  const sortedSkills = [...availableSkills].sort((a, b) => {
    const priorityA = a.priority ?? 5;
    const priorityB = b.priority ?? 5;
    return priorityB - priorityA;
  });

  const selected = [];
  const branches = new Set();

  // First pass: ensure variety by selecting from different branches
  for (const skill of sortedSkills) {
    if (selected.length >= maxSlots) break;

    if (!branches.has(skill.branch)) {
      selected.push(skill);
      branches.add(skill.branch);
    }
  }

  // Second pass: fill remaining slots with highest priority skills
  for (const skill of sortedSkills) {
    if (selected.length >= maxSlots) break;

    if (!selected.includes(skill)) {
      selected.push(skill);
    }
  }

  return selected;
}

/**
 * Create a skill object ready for use in battle
 * @param {Object} skillDef - Skill definition
 * @param {number} skillLevel - Level of the skill
 * @returns {Object} Battle-ready skill object
 */
function createBattleSkill(skillDef, skillLevel) {
  return {
    id: skillDef.id,
    name: skillDef.name,
    description: skillDef.description,
    level: skillLevel,
    power: scaleSkillPower(skillDef.power || 100, skillLevel),
    range: skillDef.range || 1,
    mpCost: scaleSkillMpCost(skillDef.mpCost || skillDef.mp_cost || 0, skillLevel),
    damageType: skillDef.damageType || skillDef.damage_type || 'physical',
    effect: skillDef.effect || null,
    effectChance: skillDef.effectChance || skillDef.effect_chance || 1.0,
    effectDuration: skillDef.effectDuration || skillDef.effect_duration || 0,
    aoeRadius: skillDef.aoeRadius || skillDef.aoe_radius || 0,
    cooldown: skillDef.cooldown || 0,
    priority: skillDef.priority ?? 5,
    source: skillDef.source || 'unknown',

    // Optional properties
    ...(skillDef.selfBuff && { selfBuff: skillDef.selfBuff }),
    ...(skillDef.buffDuration && { buffDuration: skillDef.buffDuration }),
    ...(skillDef.healPercent && { healPercent: skillDef.healPercent }),
    ...(skillDef.mpRestore && { mpRestore: skillDef.mpRestore }),
    ...(skillDef.cleanse && { cleanse: skillDef.cleanse }),
    ...(skillDef.hits && { hits: skillDef.hits }),
    ...(skillDef.chainTargets && { chainTargets: skillDef.chainTargets })
  };
}

/**
 * Generate skills for an enemy based on their template
 * Main entry point for the NPC skill system
 *
 * @param {Object} template - Enemy template from database
 * @param {number} enemyLevel - Calculated enemy level
 * @param {number} partyLevel - Average party level (for reference)
 * @param {number} difficultyTier - Node difficulty tier (1-5)
 * @returns {Array} Array of battle-ready skill objects
 */
function generateEnemySkills(template, enemyLevel, partyLevel, difficultyTier) {
  const archetype = template.archetype || 'beast';
  const guild = template.guild;
  const isHumanoid = archetype === 'humanoid' && guild;

  // Get skill pool based on enemy type
  let availableSkills;
  if (isHumanoid) {
    // Humanoid NPCs use guild skills
    availableSkills = getGuildSkillsForHumanoid(guild);
  } else {
    // Monster NPCs use monster skill trees
    availableSkills = getMonsterSkillsForArchetype(archetype);
  }

  if (availableSkills.length === 0) {
    console.warn(`[NPC Skills] No skills available for template: ${template.name}`);
    return [];
  }

  // Calculate skill parameters
  const maxSlots = getMaxSkillSlots(enemyLevel, difficultyTier);
  const skillLevel = calculateSkillLevel(enemyLevel, difficultyTier);

  // Filter skills based on requirements
  const filteredSkills = filterAvailableSkills(availableSkills, enemyLevel, {});

  // Select skills
  const selectedSkills = selectSkills(filteredSkills, maxSlots);

  // Create battle-ready skill objects
  const battleSkills = selectedSkills.map(skillDef =>
    createBattleSkill(skillDef, skillLevel)
  );

  return battleSkills;
}

/**
 * Generate skills from database template assignments
 * Used when enemy templates have specific skill assignments in enemy_template_skills
 *
 * @param {number} templateId - Enemy template ID
 * @param {number} enemyLevel - Calculated enemy level
 * @param {number} difficultyTier - Node difficulty tier
 * @returns {Promise<Array>} Array of battle-ready skill objects
 */
async function generateEnemySkillsFromDb(templateId, enemyLevel, difficultyTier) {
  try {
    // Get skill assignments from database
    const result = await pool.query(`
      SELECT ets.*, nst.*
      FROM enemy_template_skills ets
      JOIN npc_skill_templates nst ON ets.skill_id = nst.skill_id
      WHERE ets.enemy_template_id = $1
        AND ets.min_enemy_level <= $2
      ORDER BY nst.priority DESC
    `, [templateId, enemyLevel]);

    if (result.rows.length === 0) {
      return null; // Fall back to procedural generation
    }

    const maxSlots = getMaxSkillSlots(enemyLevel, difficultyTier);
    const skills = [];

    for (const row of result.rows) {
      if (skills.length >= maxSlots) break;

      // Check unlock chance
      if (Math.random() > row.unlock_chance) continue;

      // Calculate skill level using template's scaling
      const baseLevel = row.base_skill_level || 1;
      const scaling = row.level_scaling || 0.1;
      const skillLevel = Math.min(
        Math.floor(baseLevel + enemyLevel * scaling),
        10
      );

      skills.push(createBattleSkill({
        id: row.skill_id,
        name: row.name,
        description: row.description,
        power: row.power,
        range: row.range,
        mpCost: row.mp_cost,
        damageType: row.damage_type,
        effect: row.effect,
        effectChance: parseFloat(row.effect_chance),
        effectDuration: row.effect_duration,
        aoeRadius: row.aoe_radius,
        cooldown: row.cooldown,
        priority: row.priority,
        source: 'database'
      }, skillLevel));
    }

    return skills.length > 0 ? skills : null;

  } catch (error) {
    console.error('[NPC Skills] Database query failed:', error);
    return null;
  }
}

/**
 * Get skills for an enemy, trying database first, then procedural generation
 * @param {Object} template - Enemy template
 * @param {number} enemyLevel - Enemy level
 * @param {number} partyLevel - Party level
 * @param {number} difficultyTier - Difficulty tier
 * @returns {Promise<Array>} Array of battle-ready skills
 */
async function getEnemySkills(template, enemyLevel, partyLevel, difficultyTier) {
  // Try database-defined skills first
  if (template.id) {
    const dbSkills = await generateEnemySkillsFromDb(
      template.id,
      enemyLevel,
      difficultyTier
    );
    if (dbSkills && dbSkills.length > 0) {
      return dbSkills;
    }
  }

  // Fall back to procedural generation
  return generateEnemySkills(template, enemyLevel, partyLevel, difficultyTier);
}

/**
 * Check if a unit can use a skill (MP, cooldown, etc.)
 * @param {Object} unit - Battle unit
 * @param {Object} skill - Skill to check
 * @returns {Object} { canUse: boolean, reason?: string }
 */
function canUseSkill(unit, skill) {
  // Check MP
  if (skill.mpCost > 0 && unit.mp < skill.mpCost) {
    return { canUse: false, reason: 'insufficient_mp' };
  }

  // Check cooldown
  const cooldownRemaining = unit.skillCooldowns?.[skill.id] || 0;
  if (cooldownRemaining > 0) {
    return { canUse: false, reason: 'on_cooldown', cooldownRemaining };
  }

  return { canUse: true };
}

/**
 * Apply skill cost and cooldown after use
 * @param {Object} unit - Battle unit (modified in place)
 * @param {Object} skill - Used skill
 */
function applySkillCost(unit, skill) {
  // Deduct MP
  if (skill.mpCost > 0) {
    unit.mp = Math.max(0, unit.mp - skill.mpCost);
  }

  // Apply cooldown
  if (skill.cooldown > 0) {
    if (!unit.skillCooldowns) {
      unit.skillCooldowns = {};
    }
    unit.skillCooldowns[skill.id] = skill.cooldown;
  }
}

/**
 * Tick skill cooldowns at the end of a unit's turn
 * @param {Object} unit - Battle unit (modified in place)
 */
function tickSkillCooldowns(unit) {
  if (!unit.skillCooldowns) return;

  for (const skillId in unit.skillCooldowns) {
    if (unit.skillCooldowns[skillId] > 0) {
      unit.skillCooldowns[skillId]--;
    }
    if (unit.skillCooldowns[skillId] <= 0) {
      delete unit.skillCooldowns[skillId];
    }
  }
}

export {
  // Main generation functions
  generateEnemySkills,
  generateEnemySkillsFromDb,
  getEnemySkills,

  // Utility functions
  getMaxSkillSlots,
  calculateSkillLevel,
  scaleSkillPower,
  scaleSkillMpCost,
  canUseSkill,
  applySkillCost,
  tickSkillCooldowns,

  // Skill retrieval
  getMonsterSkillsForArchetype,
  getGuildSkillsForHumanoid,
  createBattleSkill
};
