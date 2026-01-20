import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { GUILD_ADVANCEMENT_TIERS, ADVANCEMENT_QUEST_MIN_LEVEL } from '../config/constants.js';
import { SKILL_TREES } from '../config/skillTrees.js';
import {
  calculateLevelFromSpentXP,
  getLevelProgress,
  calculateLevelUpStatGains
} from '../services/characterLevelService.js';
import { scaleSkillAttributes, getSkillScalingPreview } from '../config/skillScaling.js';
import { calculateStats } from '../../../shared/constants.js';

const router = express.Router();

// GET /api/skills/tree/:guildId - Get skill tree for a guild
router.get('/tree/:guildId', authenticate, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  const tree = SKILL_TREES[guildId.toLowerCase()];
  if (!tree) {
    throw new AppError('Guild not found', 404);
  }

  res.json(tree);
}));

// GET /api/characters/:characterId/skills - Get character's learned skills
router.get('/characters/:characterId/skills', authenticate, asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Verify character ownership
  const charResult = await query(
    'SELECT id, class, level, experience, spent_xp FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];
  const spentXP = character.spent_xp || 0;
  const calculatedLevel = calculateLevelFromSpentXP(spentXP);
  const levelProgress = getLevelProgress(spentXP, calculatedLevel);

  // Get learned skills (from character_skills table if it exists, otherwise empty)
  let skills = {};
  try {
    const skillsResult = await query(
      'SELECT skill_id, level FROM character_skills WHERE character_id = $1',
      [characterId]
    );
    skills = skillsResult.rows.reduce((acc, row) => {
      acc[row.skill_id] = row.level;
      return acc;
    }, {});
  } catch (err) {
    // Table might not exist yet, return empty skills
    console.log('character_skills table not found, returning empty skills');
  }

  res.json({
    characterId: parseInt(characterId, 10),
    class: character.class,
    level: character.level,
    xpPool: character.experience || 0,
    spentXP,
    levelProgress: {
      currentLevel: calculatedLevel,
      xpIntoLevel: levelProgress.current,
      xpNeededForNext: levelProgress.needed,
      percentToNext: Math.round(levelProgress.percent * 100),
      isMaxLevel: levelProgress.isMaxLevel
    },
    skills
  });
}));

// POST /api/skills/learn - Learn or level up a skill
router.post('/learn', authenticate, asyncHandler(async (req, res) => {
  const { characterId, skillId, levels = 1 } = req.body;

  // Verify character ownership and get full character data
  const charResult = await query(
    'SELECT id, class, race, experience, level, spent_xp, strength, intelligence, agility, vitality, luck FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];
  const currentSpentXP = character.spent_xp || 0;
  const guildTree = SKILL_TREES[character.class];

  if (!guildTree) {
    throw new AppError('Character class not found', 400);
  }

  // Find the skill in the tree
  let skillDef = null;
  for (const branch of guildTree.branches) {
    const found = branch.skills.find(s => s.id === skillId);
    if (found) {
      skillDef = found;
      break;
    }
  }

  if (!skillDef) {
    throw new AppError('Skill not found in guild tree', 404);
  }

  // Get current skill level
  let currentLevel = 0;
  try {
    const currentResult = await query(
      'SELECT level FROM character_skills WHERE character_id = $1 AND skill_id = $2',
      [characterId, skillId]
    );
    if (currentResult.rows.length > 0) {
      currentLevel = currentResult.rows[0].level;
    }
  } catch (err) {
    // Table might not exist, will be created below
  }

  const newLevel = currentLevel + levels;

  // Check max level (now 100 for all skills)
  if (newLevel > skillDef.maxLevel) {
    throw new AppError(`Skill is already at max level (${skillDef.maxLevel})`, 400);
  }

  // Check prerequisites
  if (skillDef.requires) {
    for (const [reqSkillId, reqLevel] of Object.entries(skillDef.requires)) {
      let prereqLevel = 0;
      try {
        const prereqResult = await query(
          'SELECT level FROM character_skills WHERE character_id = $1 AND skill_id = $2',
          [characterId, reqSkillId]
        );
        if (prereqResult.rows.length > 0) {
          prereqLevel = prereqResult.rows[0].level;
        }
      } catch (err) {
        // Prerequisite not met
      }

      if (prereqLevel < reqLevel) {
        throw new AppError(`Requires ${reqSkillId} at level ${reqLevel}`, 400);
      }
    }
  }

  // Calculate XP cost with polynomial growth (more achievable than exponential)
  // Cost formula: baseCost * level^1.5 (polynomial growth)
  // Example: baseCost 50 → L10: 1,581 XP, L50: 17,678 XP, L100: 50,000 XP
  const MAX_SAFE_COST = Number.MAX_SAFE_INTEGER;
  let totalCost = 0;
  for (let i = currentLevel; i < newLevel; i++) {
    // Polynomial: baseCost * (level + 1)^1.5
    // Using (i + 1) so level 0→1 costs baseCost * 1^1.5 = baseCost
    const levelCost = Math.floor(skillDef.baseCost * Math.pow(i + 1, 1.5));
    if (totalCost + levelCost > MAX_SAFE_COST) {
      throw new AppError('Cost calculation overflow - please level up in smaller increments', 400);
    }
    totalCost += levelCost;
  }

  // Check if character has enough XP
  if (character.experience < totalCost) {
    throw new AppError(`Not enough XP. Need ${totalCost}, have ${character.experience}`, 400);
  }

  // Calculate level before and after spending XP
  const levelBeforeSpending = calculateLevelFromSpentXP(currentSpentXP);
  const newSpentXP = currentSpentXP + totalCost;
  const levelAfterSpending = calculateLevelFromSpentXP(newSpentXP);

  // Prepare level-up data if character will level up
  let levelUpData = null;
  let statGains = null;

  if (levelAfterSpending > levelBeforeSpending) {
    statGains = calculateLevelUpStatGains(levelBeforeSpending, levelAfterSpending, character.class);
    levelUpData = {
      oldLevel: levelBeforeSpending,
      newLevel: levelAfterSpending,
      levelsGained: levelAfterSpending - levelBeforeSpending,
      statGains
    };
  }

  await withTransaction(async (client) => {
    // Deduct XP from pool and add to spent_xp
    await client.query(
      'UPDATE characters SET experience = experience - $1, spent_xp = spent_xp + $1 WHERE id = $2',
      [totalCost, characterId]
    );

    // Apply stat gains if character leveled up
    if (statGains) {
      // Calculate new HP/MP based on race, class, and new level
      const newStats = calculateStats(character.race, character.class, levelAfterSpending);

      // Get current HP/MP values
      const currentResult = await client.query(
        'SELECT hp_current, mp_current, hp_max, mp_max FROM characters WHERE id = $1',
        [characterId]
      );
      const { hp_current, mp_current, hp_max, mp_max } = currentResult.rows[0];

      // Calculate new current HP/MP:
      // - Gain the delta HP/MP from the level up (healing on level up)
      // - Cap at new max values
      const hpDelta = newStats.hpMax - hp_max;
      const mpDelta = newStats.mpMax - mp_max;
      const newHpCurrent = Math.min(hp_current + hpDelta, newStats.hpMax);
      const newMpCurrent = Math.min(mp_current + mpDelta, newStats.mpMax);

      await client.query(`
        UPDATE characters
        SET level = $1,
            strength = strength + $2,
            intelligence = intelligence + $3,
            agility = agility + $4,
            vitality = vitality + $5,
            luck = luck + $6,
            hp_max = $7,
            mp_max = $8,
            hp_current = $9,
            mp_current = $10
        WHERE id = $11
      `, [
        levelAfterSpending,
        statGains.str,
        statGains.int,
        statGains.agi,
        statGains.vit,
        statGains.luck,
        newStats.hpMax,
        newStats.mpMax,
        newHpCurrent,
        newMpCurrent,
        characterId
      ]);
    }

    // Update or insert skill
    await client.query(`
      INSERT INTO character_skills (character_id, skill_id, level)
      VALUES ($1, $2, $3)
      ON CONFLICT (character_id, skill_id)
      DO UPDATE SET level = $3
    `, [characterId, skillId, newLevel]);
  });

  // Get updated character info
  const updatedChar = await query(
    'SELECT experience, spent_xp, level, strength, intelligence, agility, vitality, luck FROM characters WHERE id = $1',
    [characterId]
  );

  const updated = updatedChar.rows[0];
  const newLevelProgress = getLevelProgress(updated.spent_xp, updated.level);

  // Get scaled skill attributes for the new level
  const scaledSkill = scaleSkillAttributes(skillDef, newLevel);

  res.json({
    success: true,
    skill: {
      id: skillId,
      name: skillDef.name,
      level: newLevel,
      maxLevel: skillDef.maxLevel,
      scaledAttributes: {
        power: scaledSkill.power,
        effectChance: scaledSkill.effectChance,
        effectDuration: scaledSkill.effectDuration,
        healPercent: scaledSkill.healPercent,
        range: scaledSkill.range,
        aoeRadius: scaledSkill.aoeRadius
      }
    },
    xpSpent: totalCost,
    xpRemaining: updated.experience,
    spentXP: updated.spent_xp,
    levelProgress: {
      currentLevel: updated.level,
      xpIntoLevel: newLevelProgress.current,
      xpNeededForNext: newLevelProgress.needed,
      percentToNext: Math.round(newLevelProgress.percent * 100),
      isMaxLevel: newLevelProgress.isMaxLevel
    },
    levelUp: levelUpData
  });
}));

// GET /api/guilds - Get all available guilds
router.get('/guilds', authenticate, asyncHandler(async (req, res) => {
  const guilds = Object.entries(SKILL_TREES).map(([id, tree]) => ({
    id,
    name: tree.name,
    description: tree.description,
    branchCount: tree.branches.length,
    skillCount: tree.branches.reduce((sum, b) => sum + b.skills.length, 0),
    advancedFrom: tree.advancedFrom || null,
    isAdvanced: !!tree.advancedFrom
  }));

  res.json({ guilds });
}));

// GET /api/skills/advancement/:characterId - Get advancement tiers for character's guild
// Advancement now requires completing quests - use /api/advancement/* endpoints
router.get('/advancement/:characterId', authenticate, asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Verify character ownership
  const charResult = await query(
    'SELECT id, name, class, level, race FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];
  const currentClass = character.class;
  const baseClasses = ['warrior', 'wizard', 'monk', 'chemist'];

  // Determine which guild this class belongs to
  let guildId = null;
  if (baseClasses.includes(currentClass)) {
    guildId = currentClass;
  } else {
    // Check if current class is in any advancement tier
    for (const [guild, tiers] of Object.entries(GUILD_ADVANCEMENT_TIERS)) {
      if (tiers.includes(currentClass)) {
        guildId = guild;
        break;
      }
    }
  }

  if (!guildId) {
    return res.json({
      eligible: false,
      reason: 'Unknown class - no advancement path available',
      currentClass,
      availableTiers: []
    });
  }

  const tiers = GUILD_ADVANCEMENT_TIERS[guildId];
  const currentTierIndex = tiers.indexOf(currentClass);

  // Check level requirement for quest eligibility
  const meetsLevel = character.level >= ADVANCEMENT_QUEST_MIN_LEVEL;

  // Build tier info with skill trees
  const availableTiers = tiers.map((tierClass, index) => {
    const tree = SKILL_TREES[tierClass];
    return {
      tier: index + 1,
      classId: tierClass,
      className: tree?.name || tierClass,
      description: tree?.description || '',
      isCompleted: currentTierIndex >= index,
      isCurrent: currentClass === tierClass
    };
  });

  res.json({
    eligible: meetsLevel && currentTierIndex < tiers.length - 1,
    reason: !meetsLevel
      ? `Requires level ${ADVANCEMENT_QUEST_MIN_LEVEL} (current: ${character.level})`
      : currentTierIndex >= tiers.length - 1
        ? 'Already at maximum advancement tier'
        : 'Visit your guild hall to start an advancement quest',
    currentClass,
    guildId,
    currentTier: baseClasses.includes(currentClass) ? 0 : currentTierIndex + 1,
    maxTier: tiers.length,
    availableTiers,
    levelRequired: ADVANCEMENT_QUEST_MIN_LEVEL,
    currentLevel: character.level,
    questSystemInfo: 'Class advancement now requires completing guild quests. Visit a guild node to begin.'
  });
}));

// POST /api/skills/advance - DEPRECATED: Use quest-based advancement
// Advancement now requires completing quests via /api/advancement/* endpoints
router.post('/advance', authenticate, asyncHandler(async (req, res) => {
  throw new AppError(
    'Direct advancement has been replaced with quest-based advancement. ' +
    'Visit your guild hall and complete an advancement quest to advance your class.',
    400
  );
}));

export { router, SKILL_TREES };
export default router;
