import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { GUILD_ADVANCEMENT_TIERS, ADVANCEMENT_QUEST_MIN_LEVEL } from '../config/constants.js';
import {
  SKILL_TREES,
  buildTrainingSkillTree,
  findSkillInTrainingTree
} from '../config/skillTrees.js';
import {
  calculateLevelFromSpentXP,
  getLevelProgress,
  calculateLevelUpStatGains
} from '../services/characterLevelService.js';
import { scaleSkillAttributes } from '../config/skillScaling.js';
import { calculateStats } from '../../../shared/constants.js';

const router = express.Router();

export function validateSkillLearningLevels(levels) {
  if (!Number.isSafeInteger(levels) || levels <= 0) {
    throw new AppError('Levels must be a positive safe integer', 400);
  }

  return levels;
}

export async function learnSkillWithClient(client, {
  characterId,
  userId,
  skillId,
  levels
}) {
  validateSkillLearningLevels(levels);

  const charResult = await client.query(
    `SELECT id, class, race, experience, level, spent_xp,
            strength, intelligence, agility, vitality, luck,
            hp_current, mp_current, hp_max, mp_max, in_battle
     FROM characters
     WHERE id = $1 AND user_id = $2
     FOR UPDATE`,
    [characterId, userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];
  if (character.in_battle) {
    throw new AppError('Cannot learn skills during battle', 400);
  }
  const guildTree = buildTrainingSkillTree(character.class);

  if (!guildTree) {
    throw new AppError('Character class not found', 400);
  }

  const skillDef = findSkillInTrainingTree(character.class, skillId);

  if (!skillDef) {
    throw new AppError('Skill not found in guild tree', 404);
  }

  const relevantSkillIds = [
    skillId,
    ...Object.keys(skillDef.requires || {})
  ];
  const skillsResult = await client.query(
    `SELECT skill_id, level
     FROM character_skills
     WHERE character_id = $1
       AND skill_id = ANY($2::text[])
     FOR UPDATE`,
    [characterId, relevantSkillIds]
  );
  const learnedLevels = new Map(
    skillsResult.rows.map(row => [row.skill_id, Number(row.level)])
  );
  const currentLevel = learnedLevels.get(skillId) || 0;
  const newLevel = currentLevel + levels;

  if (newLevel > skillDef.maxLevel) {
    throw new AppError(`Skill is already at max level (${skillDef.maxLevel})`, 400);
  }

  for (const [reqSkillId, reqLevel] of Object.entries(skillDef.requires || {})) {
    const prereqLevel = learnedLevels.get(reqSkillId) || 0;
    if (prereqLevel < reqLevel) {
      throw new AppError(`Requires ${reqSkillId} at level ${reqLevel}`, 400);
    }
  }

  const MAX_SAFE_COST = Number.MAX_SAFE_INTEGER;
  let totalCost = 0;
  for (let i = currentLevel; i < newLevel; i++) {
    const levelCost = Math.floor(skillDef.baseCost * Math.pow(i + 1, 1.5));
    if (totalCost + levelCost > MAX_SAFE_COST) {
      throw new AppError('Cost calculation overflow - please level up in smaller increments', 400);
    }
    totalCost += levelCost;
  }

  const currentExperience = Number(character.experience) || 0;
  if (currentExperience < totalCost) {
    throw new AppError(`Not enough XP. Need ${totalCost}, have ${currentExperience}`, 400);
  }

  const currentSpentXP = Number(character.spent_xp) || 0;
  const levelBeforeSpending = calculateLevelFromSpentXP(currentSpentXP);
  const newSpentXP = currentSpentXP + totalCost;
  const levelAfterSpending = calculateLevelFromSpentXP(newSpentXP);
  const levelsGained = levelAfterSpending - levelBeforeSpending;
  const statGains = levelsGained > 0
    ? calculateLevelUpStatGains(levelBeforeSpending, levelAfterSpending, character.class)
    : null;
  const levelUpData = statGains
    ? {
      oldLevel: levelBeforeSpending,
      newLevel: levelAfterSpending,
      levelsGained,
      statGains
    }
    : null;

  let hpMax = character.hp_max;
  let mpMax = character.mp_max;
  let hpCurrent = character.hp_current;
  let mpCurrent = character.mp_current;

  if (statGains) {
    const newStats = calculateStats(character.race, character.class, levelAfterSpending);
    const hpDelta = newStats.hpMax - character.hp_max;
    const mpDelta = newStats.mpMax - character.mp_max;
    hpMax = newStats.hpMax;
    mpMax = newStats.mpMax;
    hpCurrent = Math.min(character.hp_current + hpDelta, hpMax);
    mpCurrent = Math.min(character.mp_current + mpDelta, mpMax);
  }

  const updatedChar = await client.query(
    `UPDATE characters
     SET experience = $1,
         spent_xp = $2,
         level = $3,
         strength = strength + $4,
         intelligence = intelligence + $5,
         agility = agility + $6,
         vitality = vitality + $7,
         luck = luck + $8,
         hp_max = $9,
         mp_max = $10,
         hp_current = $11,
         mp_current = $12
     WHERE id = $13
     RETURNING experience, spent_xp, level,
               strength, intelligence, agility, vitality, luck`,
    [
      currentExperience - totalCost,
      newSpentXP,
      levelAfterSpending,
      statGains?.str || 0,
      statGains?.int || 0,
      statGains?.agi || 0,
      statGains?.vit || 0,
      statGains?.luck || 0,
      hpMax,
      mpMax,
      hpCurrent,
      mpCurrent,
      characterId
    ]
  );

  const skillResult = await client.query(
    `INSERT INTO character_skills (character_id, skill_id, level)
     VALUES ($1, $2, $3)
     ON CONFLICT (character_id, skill_id)
     DO UPDATE SET level = character_skills.level + EXCLUDED.level
     RETURNING level`,
    [characterId, skillId, levels]
  );

  const updated = updatedChar.rows[0];
  const learnedLevel = Number(skillResult.rows[0].level);
  const calculatedLevel = calculateLevelFromSpentXP(updated.spent_xp);
  const newLevelProgress = getLevelProgress(updated.spent_xp, calculatedLevel);

  return {
    skillDef,
    newLevel: learnedLevel,
    totalCost,
    updated,
    calculatedLevel,
    newLevelProgress,
    levelUpData
  };
}

// GET /api/skills/tree/:guildId - Get skill tree for a guild
router.get('/tree/:guildId', authenticate, asyncHandler(async (req, res) => {
  const { guildId } = req.params;

  const tree = buildTrainingSkillTree(guildId);
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
  validateSkillLearningLevels(levels);
  const {
    skillDef,
    newLevel,
    totalCost,
    updated,
    calculatedLevel,
    newLevelProgress,
    levelUpData
  } = await withTransaction(client => learnSkillWithClient(client, {
    characterId,
    userId: req.user.userId,
    skillId,
    levels
  }));

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
      currentLevel: calculatedLevel,
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
router.post('/advance', authenticate, asyncHandler(async (_req, _res) => {
  throw new AppError(
    'Direct advancement has been replaced with quest-based advancement. ' +
    'Visit your guild hall and complete an advancement quest to advance your class.',
    400
  );
}));

export { router, SKILL_TREES };
export default router;
