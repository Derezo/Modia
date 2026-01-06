const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE } = require('../config/constants');
const battleService = require('../services/battleService');
const aiService = require('../services/aiService');

// POST /api/battle/start - Start PvE battle at current node
router.post('/start', authenticate, asyncHandler(async (req, res) => {
  // Get user's battle party and current node
  const partyResult = await query(
    `SELECT c.id, c.name, c.race, c.class, c.level,
            c.hp_current, c.hp_max, c.mp_current, c.mp_max,
            c.strength, c.intelligence, c.agility, c.vitality, c.luck,
            c.current_node_id, c.in_battle
     FROM characters c
     WHERE c.user_id = $1 AND c.party_slot <= $2 AND c.party_slot IS NOT NULL
     ORDER BY c.party_slot ASC`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  if (partyResult.rows.length === 0) {
    throw new AppError('No battle party set', 400);
  }

  const party = partyResult.rows;

  // Check if already in battle
  if (party.some(c => c.in_battle)) {
    throw new AppError('Already in a battle', 400);
  }

  // Check if any party member has 0 HP
  if (party.some(c => c.hp_current <= 0)) {
    throw new AppError('Cannot battle with incapacitated characters', 400);
  }

  const currentNodeId = party[0].current_node_id;

  // Get node info
  const nodeResult = await query(
    'SELECT node_type, difficulty_tier, local_seed FROM world_nodes WHERE id = $1',
    [currentNodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Current location not found', 400);
  }

  const node = nodeResult.rows[0];

  // Verify this is a battle node
  if (!BATTLE_NODE_TYPES.includes(node.node_type)) {
    throw new AppError('Cannot battle at this location', 400);
  }

  // Generate battle map seed
  const mapSeed = Math.floor(Math.random() * 1000000);

  // Create initial battle state
  const initialState = {
    turn: 1,
    phase: 'player_turn',
    activeUnitIndex: 0,
    units: party.map((char, idx) => ({
      id: char.id,
      type: 'player',
      name: char.name,
      class: char.class,
      hp: char.hp_current,
      maxHp: char.hp_max,
      mp: char.mp_current,
      maxMp: char.mp_max,
      strength: char.strength,
      intelligence: char.intelligence,
      agility: char.agility,
      tileX: idx % 2,
      tileY: 6 + Math.floor(idx / 2),
      hasActed: false,
      statusEffects: []
    }))
  };

  // Add enemies based on difficulty
  const enemyCount = Math.min(node.difficulty_tier + 2, 5);
  for (let i = 0; i < enemyCount; i++) {
    const baseLevel = Math.max(1, party[0].level - 2 + node.difficulty_tier);
    initialState.units.push({
      id: `enemy_${i}`,
      type: 'enemy',
      name: `${node.node_type.charAt(0).toUpperCase() + node.node_type.slice(1)} ${['Goblin', 'Wolf', 'Slime', 'Skeleton', 'Bandit'][i % 5]}`,
      class: 'monster',
      hp: 50 + baseLevel * 10,
      maxHp: 50 + baseLevel * 10,
      mp: 20,
      maxMp: 20,
      strength: 8 + baseLevel,
      intelligence: 5 + baseLevel,
      agility: 6 + baseLevel,
      tileX: 6 + (i % 2),
      tileY: i,
      hasActed: false,
      statusEffects: []
    });
  }

  // Sort units by initiative (agility)
  initialState.units.sort((a, b) => b.agility - a.agility);

  // Create battle record
  const battleResult = await query(
    `INSERT INTO battles (battle_type, status, node_id, battle_state, map_seed, map_width, map_height, player1_id)
     VALUES ('pve', 'active', $1, $2, $3, 8, 8, $4)
     RETURNING id`,
    [currentNodeId, JSON.stringify(initialState), mapSeed, req.user.userId]
  );

  const battleId = battleResult.rows[0].id;

  // Mark characters as in battle
  await query(
    `UPDATE characters SET in_battle = true
     WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  res.status(201).json({
    battleId,
    mapSeed,
    mapWidth: 8,
    mapHeight: 8,
    state: initialState
  });
}));

// GET /api/battle/current - Get current battle state
router.get('/current', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT b.id, b.battle_type, b.battle_state, b.map_seed, b.map_width, b.map_height,
            wn.node_type, wn.name as node_name
     FROM battles b
     JOIN world_nodes wn ON b.node_id = wn.id
     WHERE b.player1_id = $1 AND b.status = 'active'
     ORDER BY b.started_at DESC
     LIMIT 1`,
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('No active battle', 404);
  }

  const battle = result.rows[0];

  res.json({
    battleId: battle.id,
    battleType: battle.battle_type,
    mapSeed: battle.map_seed,
    mapWidth: battle.map_width,
    mapHeight: battle.map_height,
    nodeType: battle.node_type,
    nodeName: battle.node_name,
    state: battle.battle_state
  });
}));

// POST /api/battle/action - Submit battle action
router.post('/action', authenticate, asyncHandler(async (req, res) => {
  const { battleId, actionType, unitId, targetTile, skillId } = req.body;

  // Get battle
  const battleResult = await query(
    `SELECT id, battle_state FROM battles
     WHERE id = $1 AND player1_id = $2 AND status = 'active'`,
    [battleId, req.user.userId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found or not active', 404);
  }

  const state = battleResult.rows[0].battle_state;
  const activeUnit = state.units[state.activeUnitIndex];

  // Validate it's the player's turn
  if (activeUnit.type !== 'player' || activeUnit.id !== unitId) {
    throw new AppError('Not this unit\'s turn', 400);
  }

  // Process action (simplified for MVP)
  let result = { damage: 0, moved: false };

  switch (actionType) {
    case 'move':
      if (targetTile) {
        activeUnit.tileX = targetTile.x;
        activeUnit.tileY = targetTile.y;
        result.moved = true;
      }
      break;

    case 'attack':
      // Find target at position
      const target = state.units.find(u =>
        u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
      );
      if (target) {
        // Check hit
        const hits = battleService.checkHit(activeUnit, target);
        if (hits) {
          // Calculate damage using proper formula
          const damageResult = battleService.calculatePhysicalDamage(activeUnit, target);
          target.hp = Math.max(0, target.hp - damageResult.damage);
          result.damage = damageResult.damage;
          result.isCritical = damageResult.isCritical;
          result.targetId = target.id;
        } else {
          result.missed = true;
          result.targetId = target.id;
        }
      }
      break;

    case 'wait':
      // Do nothing, end turn
      break;
  }

  activeUnit.hasActed = true;

  // Advance to next unit
  let nextIndex = (state.activeUnitIndex + 1) % state.units.length;
  while (state.units[nextIndex].hp <= 0 && nextIndex !== state.activeUnitIndex) {
    nextIndex = (nextIndex + 1) % state.units.length;
  }

  // Check for new turn
  if (nextIndex <= state.activeUnitIndex) {
    state.turn++;
    state.units.forEach(u => u.hasActed = false);
  }

  state.activeUnitIndex = nextIndex;

  // Check win/lose conditions
  const playerUnitsAlive = state.units.filter(u => u.type === 'player' && u.hp > 0).length;
  const enemyUnitsAlive = state.units.filter(u => u.type === 'enemy' && u.hp > 0).length;

  let battleStatus = 'active';
  if (enemyUnitsAlive === 0) {
    battleStatus = 'victory';
  } else if (playerUnitsAlive === 0) {
    battleStatus = 'defeat';
  }

  // Update battle state
  await query(
    'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
    [JSON.stringify(state), battleStatus, battleId]
  );

  // If battle ended, update characters
  if (battleStatus !== 'active') {
    await query(
      `UPDATE characters SET in_battle = false
       WHERE user_id = $1 AND party_slot <= $2`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );

    // Calculate rewards for victory
    if (battleStatus === 'victory') {
      const enemies = state.units.filter(u => u.type === 'enemy');
      const partyLevel = Math.floor(
        state.units.filter(u => u.type === 'player').reduce((sum, u) => sum + (u.level || 1), 0) /
        state.units.filter(u => u.type === 'player').length
      ) || 1;

      // Get node difficulty for gold calculation
      const nodeResult = await query(
        'SELECT difficulty_tier FROM world_nodes WHERE id = (SELECT node_id FROM battles WHERE id = $1)',
        [battleId]
      );
      const difficultyTier = nodeResult.rows[0]?.difficulty_tier || 1;

      // Calculate rewards using service
      const gold = battleService.calculateGoldReward(enemies, difficultyTier);
      const exp = battleService.calculateExperienceReward(enemies, partyLevel);

      // Use transaction for rewards distribution
      await withTransaction(async (client) => {
        // Update battle record
        await client.query(
          'UPDATE battles SET rewards = $1, ended_at = NOW() WHERE id = $2',
          [JSON.stringify({ gold, experience: exp }), battleId]
        );

        // Award gold to user
        await client.query(
          'UPDATE users SET gold = gold + $1 WHERE id = $2',
          [gold, req.user.userId]
        );

        // Distribute XP to battle party characters
        const xpPerCharacter = Math.floor(exp / state.units.filter(u => u.type === 'player').length);
        await client.query(
          `UPDATE characters
           SET experience = experience + $1
           WHERE user_id = $2 AND party_slot <= $3 AND party_slot IS NOT NULL`,
          [xpPerCharacter, req.user.userId, MAX_BATTLE_PARTY_SIZE]
        );
      });

      result.rewards = { gold, experience: exp };
    }
  }

  res.json({
    state,
    actionResult: result,
    battleStatus
  });
}));

// POST /api/battle/flee - Attempt to flee battle
router.post('/flee', authenticate, asyncHandler(async (req, res) => {
  const { battleId } = req.body;

  const battleResult = await query(
    `SELECT id FROM battles
     WHERE id = $1 AND player1_id = $2 AND status = 'active'`,
    [battleId, req.user.userId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found or not active', 404);
  }

  // 50% flee chance (can be made more complex)
  const fleeSuccess = Math.random() > 0.5;

  if (fleeSuccess) {
    await query(
      'UPDATE battles SET status = $1, ended_at = NOW() WHERE id = $2',
      ['fled', battleId]
    );

    await query(
      `UPDATE characters SET in_battle = false
       WHERE user_id = $1 AND party_slot <= $2`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );

    res.json({ success: true, message: 'Escaped successfully!' });
  } else {
    res.json({ success: false, message: 'Failed to escape!' });
  }
}));

// GET /api/battle/rewards - Get rewards after victory
router.get('/rewards/:battleId', authenticate, asyncHandler(async (req, res) => {
  const { battleId } = req.params;

  const result = await query(
    `SELECT rewards FROM battles
     WHERE id = $1 AND player1_id = $2 AND status = 'victory'`,
    [battleId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Battle not found or not a victory', 404);
  }

  res.json({ rewards: result.rows[0].rewards });
}));

module.exports = router;
