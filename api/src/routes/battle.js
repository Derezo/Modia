const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE } = require('../config/constants');
const battleService = require('../services/battleService');
const aiService = require('../services/aiService');
const enemyService = require('../services/enemyService');
const itemDropService = require('../services/itemDropService');

/**
 * Process an action for any unit (player or enemy)
 * @param {Object} state - Battle state
 * @param {Object} unit - The acting unit
 * @param {string} actionType - 'move' | 'attack' | 'wait'
 * @param {Object} targetTile - { x, y } target position
 * @returns {Object} Action result
 */
function processAction(state, unit, actionType, targetTile) {
  const result = { damage: 0, moved: false };

  switch (actionType) {
    case 'move':
      if (targetTile) {
        unit.tileX = targetTile.x;
        unit.tileY = targetTile.y;
        result.moved = true;
        result.newPosition = { x: targetTile.x, y: targetTile.y };
      }
      break;

    case 'attack':
      if (targetTile) {
        const target = state.units.find(u =>
          u.tileX === targetTile.x && u.tileY === targetTile.y && u.hp > 0
        );
        if (target) {
          const hits = battleService.checkHit(unit, target);
          if (hits) {
            const damageResult = battleService.calculatePhysicalDamage(unit, target);
            target.hp = Math.max(0, target.hp - damageResult.damage);
            result.damage = damageResult.damage;
            result.isCritical = damageResult.isCritical;
            result.targetId = target.id;
          } else {
            result.missed = true;
            result.targetId = target.id;
          }
        }
      }
      break;

    case 'wait':
      // Do nothing, end turn
      break;
  }

  unit.hasActed = true;
  return result;
}

/**
 * Advance to the next living unit in turn order
 * @param {Object} state - Battle state
 */
function advanceToNextUnit(state) {
  const startIndex = state.activeUnitIndex;
  let nextIndex = (state.activeUnitIndex + 1) % state.units.length;

  // Skip dead units
  while (state.units[nextIndex].hp <= 0 && nextIndex !== startIndex) {
    nextIndex = (nextIndex + 1) % state.units.length;
  }

  // Check for new turn (wrapped around to beginning of order)
  if (nextIndex <= state.activeUnitIndex) {
    state.turn++;
    state.units.forEach(u => u.hasActed = false);
  }

  state.activeUnitIndex = nextIndex;
}

/**
 * Check if battle has ended
 * @param {Object} state - Battle state
 * @returns {string} 'active' | 'victory' | 'defeat'
 */
function checkBattleEnd(state) {
  const playerUnitsAlive = state.units.filter(u => u.type === 'player' && u.hp > 0).length;
  const enemyUnitsAlive = state.units.filter(u => u.type === 'enemy' && u.hp > 0).length;

  if (enemyUnitsAlive === 0) return 'victory';
  if (playerUnitsAlive === 0) return 'defeat';
  return 'active';
}

/**
 * Process all enemy turns until it's a player's turn or battle ends
 * @param {Object} state - Battle state
 * @param {number} maxIterations - Safety limit to prevent infinite loops
 * @returns {Array} Array of enemy actions for frontend animation
 */
function processEnemyTurns(state, maxIterations = 50) {
  const enemyActions = [];
  let iterations = 0;

  while (iterations < maxIterations) {
    const activeUnit = state.units[state.activeUnitIndex];

    // Stop if it's a player's turn
    if (activeUnit.type === 'player') {
      break;
    }

    // Stop if unit is dead (shouldn't happen, but safety check)
    if (activeUnit.hp <= 0) {
      advanceToNextUnit(state);
      iterations++;
      continue;
    }

    // Get AI decision
    const decision = aiService.decideAction(activeUnit, state);

    // Process the enemy action
    const result = processAction(state, activeUnit, decision.actionType, decision.targetTile);

    // Record this action for frontend animation
    enemyActions.push({
      unitId: activeUnit.id,
      unitName: activeUnit.name,
      actionType: decision.actionType,
      targetTile: decision.targetTile,
      result
    });

    // Check if battle ended
    const battleStatus = checkBattleEnd(state);
    if (battleStatus !== 'active') {
      break;
    }

    // Advance to next unit
    advanceToNextUnit(state);
    iterations++;
  }

  return enemyActions;
}

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

  // Check if already in battle - if so, return existing battle data for rejoin
  if (party.some(c => c.in_battle)) {
    // Look for existing active battle
    const existingBattle = await query(
      `SELECT b.id, b.battle_type, b.battle_state, b.map_seed, b.map_width, b.map_height,
              wn.node_type, wn.name as node_name
       FROM battles b
       JOIN world_nodes wn ON b.node_id = wn.id
       WHERE b.player1_id = $1 AND b.status = 'active'
       ORDER BY b.started_at DESC
       LIMIT 1`,
      [req.user.userId]
    );

    if (existingBattle.rows.length > 0) {
      // Return existing battle for rejoin
      const battle = existingBattle.rows[0];
      return res.json({
        battleId: battle.id,
        battleType: battle.battle_type,
        mapSeed: battle.map_seed,
        mapWidth: battle.map_width,
        mapHeight: battle.map_height,
        nodeType: battle.node_type,
        nodeName: battle.node_name,
        state: battle.battle_state,
        rejoined: true
      });
    }

    // Corrupted state: in_battle=true but no active battle found - reset and continue
    await query(
      'UPDATE characters SET in_battle = false WHERE user_id = $1',
      [req.user.userId]
    );
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
      tileX: 1 + (idx % 3),
      tileY: 13 + Math.floor(idx / 3) * 2,
      hasActed: false,
      statusEffects: []
    }))
  };

  // Generate enemies from templates
  const enemies = await enemyService.generateEncounter(currentNodeId, party);
  initialState.units.push(...enemies);

  // Sort units by initiative (agility)
  initialState.units.sort((a, b) => b.agility - a.agility);

  // Create battle record
  const battleResult = await query(
    `INSERT INTO battles (battle_type, status, node_id, battle_state, map_seed, map_width, map_height, player1_id)
     VALUES ('pve', 'active', $1, $2, $3, 32, 32, $4)
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
    mapWidth: 32,
    mapHeight: 32,
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

  // Process player action using helper
  const result = processAction(state, activeUnit, actionType, targetTile);

  // Check if battle ended from player action
  let battleStatus = checkBattleEnd(state);

  // Process enemy turns if battle is still active
  let enemyActions = [];
  if (battleStatus === 'active') {
    // Advance to next unit
    advanceToNextUnit(state);

    // Process all enemy turns until it's a player's turn again
    enemyActions = processEnemyTurns(state);

    // Check if battle ended after enemy turns
    battleStatus = checkBattleEnd(state);
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
      const players = state.units.filter(u => u.type === 'player');
      const partyLevel = Math.floor(
        players.reduce((sum, u) => sum + (u.level || 1), 0) / players.length
      ) || 1;

      // Get node info for rewards calculation
      const nodeResult = await query(
        'SELECT difficulty_tier, node_type FROM world_nodes WHERE id = (SELECT node_id FROM battles WHERE id = $1)',
        [battleId]
      );
      const difficultyTier = nodeResult.rows[0]?.difficulty_tier || 1;
      const nodeType = nodeResult.rows[0]?.node_type || 'forest';

      // Calculate rewards using service
      const gold = battleService.calculateGoldReward(enemies, difficultyTier);
      const exp = battleService.calculateExperienceReward(enemies, partyLevel);

      // Roll item drops from each enemy
      const droppedItems = [];
      for (const enemy of enemies) {
        const drops = await itemDropService.rollDrops(enemy, difficultyTier, nodeType);
        droppedItems.push(...drops);
      }

      // Get party leader for item storage
      const partyLeaderResult = await query(
        'SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1',
        [req.user.userId]
      );
      const partyLeaderId = partyLeaderResult.rows[0]?.id;

      // Use transaction for rewards distribution
      await withTransaction(async (client) => {
        // Update battle record
        const rewardsData = {
          gold,
          experience: exp,
          items: itemDropService.formatDropsForResponse(droppedItems)
        };
        await client.query(
          'UPDATE battles SET rewards = $1, ended_at = NOW() WHERE id = $2',
          [JSON.stringify(rewardsData), battleId]
        );

        // Award gold to user
        await client.query(
          'UPDATE users SET gold = gold + $1 WHERE id = $2',
          [gold, req.user.userId]
        );

        // Distribute XP to battle party characters
        const xpPerCharacter = Math.floor(exp / players.length);
        await client.query(
          `UPDATE characters
           SET experience = experience + $1
           WHERE user_id = $2 AND party_slot <= $3 AND party_slot IS NOT NULL`,
          [xpPerCharacter, req.user.userId, MAX_BATTLE_PARTY_SIZE]
        );

        // Store dropped items in party leader's inventory
        if (partyLeaderId) {
          for (const item of droppedItems) {
            await itemDropService.storeDroppedItem(partyLeaderId, item, client);
          }
        }
      });

      result.rewards = {
        gold,
        experience: exp,
        items: itemDropService.formatDropsForResponse(droppedItems)
      };
    }
  }

  res.json({
    state,
    actionResult: result,
    enemyActions,
    battleStatus
  });
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
