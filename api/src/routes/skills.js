const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// Skill definitions by guild (class)
const SKILL_TREES = {
  warrior: {
    name: 'Warrior Guild',
    description: 'Masters of physical combat and defense',
    branches: [
      {
        name: 'Offense',
        skills: [
          { id: 'power_strike', name: 'Power Strike', description: 'A powerful melee attack dealing 150% damage', maxLevel: 10, baseCost: 50, type: 'active', icon: '⚔️' },
          { id: 'cleave', name: 'Cleave', description: 'Attack all adjacent enemies', maxLevel: 10, baseCost: 100, type: 'active', icon: '🗡️', requires: { power_strike: 3 } },
          { id: 'rage', name: 'Rage', description: 'Increase attack by 20% for 3 turns', maxLevel: 5, baseCost: 150, type: 'active', icon: '😤', requires: { cleave: 5 } }
        ]
      },
      {
        name: 'Defense',
        skills: [
          { id: 'shield_bash', name: 'Shield Bash', description: 'Stun enemy for 1 turn', maxLevel: 10, baseCost: 50, type: 'active', icon: '🛡️' },
          { id: 'fortify', name: 'Fortify', description: 'Increase defense by 30% for 3 turns', maxLevel: 5, baseCost: 100, type: 'active', icon: '🏰', requires: { shield_bash: 3 } },
          { id: 'taunt', name: 'Taunt', description: 'Force enemies to attack you', maxLevel: 5, baseCost: 150, type: 'active', icon: '📣', requires: { fortify: 3 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'warrior_strength', name: 'Warrior Strength', description: '+5% STR per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '💪' },
          { id: 'iron_skin', name: 'Iron Skin', description: '+5% VIT per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🛡️' }
        ]
      }
    ]
  },
  wizard: {
    name: 'Wizard Guild',
    description: 'Masters of arcane magic',
    branches: [
      {
        name: 'Fire',
        skills: [
          { id: 'fireball', name: 'Fireball', description: 'Launch a ball of fire', maxLevel: 10, baseCost: 50, type: 'active', icon: '🔥' },
          { id: 'inferno', name: 'Inferno', description: 'Burn all enemies', maxLevel: 10, baseCost: 150, type: 'active', icon: '🌋', requires: { fireball: 5 } }
        ]
      },
      {
        name: 'Ice',
        skills: [
          { id: 'ice_shard', name: 'Ice Shard', description: 'Pierce with ice', maxLevel: 10, baseCost: 50, type: 'active', icon: '❄️' },
          { id: 'blizzard', name: 'Blizzard', description: 'Freeze all enemies', maxLevel: 10, baseCost: 150, type: 'active', icon: '🌨️', requires: { ice_shard: 5 } }
        ]
      },
      {
        name: 'Lightning',
        skills: [
          { id: 'lightning_bolt', name: 'Lightning Bolt', description: 'Strike with lightning', maxLevel: 10, baseCost: 50, type: 'active', icon: '⚡' },
          { id: 'chain_lightning', name: 'Chain Lightning', description: 'Lightning that jumps between enemies', maxLevel: 10, baseCost: 150, type: 'active', icon: '⛈️', requires: { lightning_bolt: 5 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'wizard_intellect', name: 'Wizard Intellect', description: '+5% INT per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🧠' },
          { id: 'mana_flow', name: 'Mana Flow', description: '+5% MP per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '💧' }
        ]
      }
    ]
  },
  monk: {
    name: 'Monk Guild',
    description: 'Masters of martial arts and inner peace',
    branches: [
      {
        name: 'Strikes',
        skills: [
          { id: 'palm_strike', name: 'Palm Strike', description: 'Quick palm attack', maxLevel: 10, baseCost: 50, type: 'active', icon: '🤚' },
          { id: 'flying_kick', name: 'Flying Kick', description: 'Aerial kick attack', maxLevel: 10, baseCost: 100, type: 'active', icon: '🦶', requires: { palm_strike: 3 } },
          { id: 'thousand_fists', name: 'Thousand Fists', description: 'Rapid succession of attacks', maxLevel: 5, baseCost: 200, type: 'active', icon: '👊', requires: { flying_kick: 5 } }
        ]
      },
      {
        name: 'Spirit',
        skills: [
          { id: 'meditation', name: 'Meditation', description: 'Recover HP and MP', maxLevel: 10, baseCost: 50, type: 'active', icon: '🧘' },
          { id: 'inner_peace', name: 'Inner Peace', description: 'Remove negative status effects', maxLevel: 5, baseCost: 100, type: 'active', icon: '☮️', requires: { meditation: 3 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'monk_agility', name: 'Monk Agility', description: '+5% AGI per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🏃' },
          { id: 'chi_flow', name: 'Chi Flow', description: '+2% HP regen per level', maxLevel: 10, baseCost: 50, type: 'passive', icon: '☯️' }
        ]
      }
    ]
  },
  chemist: {
    name: 'Chemist Guild',
    description: 'Masters of potions and alchemy',
    branches: [
      {
        name: 'Healing',
        skills: [
          { id: 'potion_toss', name: 'Potion Toss', description: 'Throw healing potion', maxLevel: 10, baseCost: 50, type: 'active', icon: '🧪' },
          { id: 'mega_potion', name: 'Mega Potion', description: 'Heal entire party', maxLevel: 5, baseCost: 150, type: 'active', icon: '💉', requires: { potion_toss: 5 } }
        ]
      },
      {
        name: 'Offense',
        skills: [
          { id: 'acid_flask', name: 'Acid Flask', description: 'Throw corrosive acid', maxLevel: 10, baseCost: 50, type: 'active', icon: '⚗️' },
          { id: 'poison_cloud', name: 'Poison Cloud', description: 'Create a cloud of poison', maxLevel: 10, baseCost: 100, type: 'active', icon: '☠️', requires: { acid_flask: 3 } }
        ]
      },
      {
        name: 'Utility',
        skills: [
          { id: 'smoke_bomb', name: 'Smoke Bomb', description: 'Escape or confuse', maxLevel: 5, baseCost: 50, type: 'active', icon: '💨' },
          { id: 'haste_potion', name: 'Haste Potion', description: 'Increase ally speed', maxLevel: 5, baseCost: 100, type: 'active', icon: '⏱️' }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'chemist_luck', name: 'Chemist Luck', description: '+5% LCK per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🍀' },
          { id: 'efficient_mixing', name: 'Efficient Mixing', description: 'Item effects +10% per level', maxLevel: 10, baseCost: 50, type: 'passive', icon: '📈' }
        ]
      }
    ]
  }
};

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
    characterId,
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
    skillCount: tree.branches.reduce((sum, b) => sum + b.skills.length, 0)
  }));

  res.json({ guilds });
}));

module.exports = router;
