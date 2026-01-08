const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { CLASS_ADVANCEMENT, ADVANCEMENT_LEVEL_REQUIREMENT, calculateStats } = require('../config/constants');
const { SKILL_TREES } = require('../config/skillTrees');

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
    'SELECT id, class, experience FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];

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
    xpPool: character.experience || 0,
    skills
  });
}));

// POST /api/skills/learn - Learn or level up a skill
router.post('/learn', authenticate, asyncHandler(async (req, res) => {
  const { characterId, skillId, levels = 1 } = req.body;

  // Verify character ownership
  const charResult = await query(
    'SELECT id, class, experience, level FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];
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

  // Check max level
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

  // Calculate XP cost
  let totalCost = 0;
  for (let i = currentLevel; i < newLevel; i++) {
    // Cost increases with each level
    totalCost += Math.floor(skillDef.baseCost * Math.pow(1.2, i));
  }

  // Check if character has enough XP
  if (character.experience < totalCost) {
    throw new AppError(`Not enough XP. Need ${totalCost}, have ${character.experience}`, 400);
  }

  await withTransaction(async (client) => {
    // Deduct XP
    await client.query(
      'UPDATE characters SET experience = experience - $1 WHERE id = $2',
      [totalCost, characterId]
    );

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
    'SELECT experience FROM characters WHERE id = $1',
    [characterId]
  );

  res.json({
    success: true,
    skill: {
      id: skillId,
      name: skillDef.name,
      level: newLevel
    },
    xpSpent: totalCost,
    xpRemaining: updatedChar.rows[0].experience
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

// GET /api/skills/advancement/:characterId - Check advancement eligibility
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
  const advancedClass = CLASS_ADVANCEMENT[currentClass];

  // Check if already advanced (advanced classes don't have further advancement)
  if (!advancedClass) {
    return res.json({
      eligible: false,
      reason: 'Already in an advanced guild or no advancement path available',
      currentClass,
      advancedClass: null
    });
  }

  // Check level requirement
  const meetsLevel = character.level >= ADVANCEMENT_LEVEL_REQUIREMENT;

  const advancedTree = SKILL_TREES[advancedClass];

  res.json({
    eligible: meetsLevel,
    reason: meetsLevel ? 'Eligible for advancement' : `Requires level ${ADVANCEMENT_LEVEL_REQUIREMENT} (current: ${character.level})`,
    currentClass,
    advancedClass,
    advancedGuildName: advancedTree?.name || advancedClass,
    advancedGuildDescription: advancedTree?.description || '',
    levelRequired: ADVANCEMENT_LEVEL_REQUIREMENT,
    currentLevel: character.level
  });
}));

// POST /api/skills/advance - Advance to advanced guild
router.post('/advance', authenticate, asyncHandler(async (req, res) => {
  const { characterId } = req.body;

  // Verify character ownership
  const charResult = await query(
    'SELECT id, name, class, level, race, in_battle FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];

  // Check if in battle
  if (character.in_battle) {
    throw new AppError('Cannot advance guild while in battle', 400);
  }

  const currentClass = character.class;
  const advancedClass = CLASS_ADVANCEMENT[currentClass];

  // Check if advancement path exists
  if (!advancedClass) {
    throw new AppError('No advancement path available for this class', 400);
  }

  // Check level requirement
  if (character.level < ADVANCEMENT_LEVEL_REQUIREMENT) {
    throw new AppError(`Requires level ${ADVANCEMENT_LEVEL_REQUIREMENT} (current: ${character.level})`, 400);
  }

  // Calculate new stats with advanced class growth
  const newStats = calculateStats(character.race, advancedClass, character.level);

  await withTransaction(async (client) => {
    // Update character class and recalculate stats
    await client.query(
      `UPDATE characters
       SET class = $1,
           hp_max = $2,
           hp_current = LEAST(hp_current, $2),
           mp_max = $3,
           mp_current = LEAST(mp_current, $3),
           strength = $4,
           intelligence = $5,
           agility = $6,
           vitality = $7
       WHERE id = $8`,
      [
        advancedClass,
        newStats.hpMax,
        newStats.mpMax,
        newStats.strength,
        newStats.intelligence,
        newStats.agility,
        newStats.vitality,
        characterId
      ]
    );
  });

  // Get updated character
  const updatedResult = await query(
    'SELECT * FROM characters WHERE id = $1',
    [characterId]
  );

  const advancedTree = SKILL_TREES[advancedClass];

  res.json({
    success: true,
    message: `${character.name} has advanced to the ${advancedTree?.name || advancedClass}!`,
    character: updatedResult.rows[0],
    newGuild: {
      id: advancedClass,
      name: advancedTree?.name || advancedClass,
      description: advancedTree?.description || ''
    }
  });
}));

module.exports = { router, SKILL_TREES };
