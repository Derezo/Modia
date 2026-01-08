const express = require('express');
const router = express.Router();
const { query, withTransaction } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE, MAX_GOLD } = require('../config/constants');
const battleService = require('../services/battleService');
const aiService = require('../services/aiService');
const enemyService = require('../services/enemyService');
const itemDropService = require('../services/itemDropService');
const battleWebsocket = require('../services/battleWebsocket');

// GET /api/battle/preview/:nodeId - Get encounter preview for formation screen
router.get('/preview/:nodeId', authenticate, asyncHandler(async (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);

  if (isNaN(nodeId)) {
    throw new AppError('Invalid node ID', 400);
  }

  const preview = await enemyService.getEncounterPreview(nodeId);
  res.json(preview);
}));

// POST /api/battle/start - Start PvE battle at current node
router.post('/start', authenticate, asyncHandler(async (req, res) => {
  // Get optional formation from request
  const { formation } = req.body || {};

  // Get user's battle party with equipment stat bonuses
  const partyResult = await query(
    `SELECT c.id, c.name, c.race, c.class, c.level,
            c.hp_current, c.hp_max, c.mp_current, c.mp_max,
            c.strength, c.intelligence, c.agility, c.vitality, c.luck,
            c.current_node_id, c.in_battle,
            COALESCE(eq.equip_strength, 0) as equip_strength,
            COALESCE(eq.equip_intelligence, 0) as equip_intelligence,
            COALESCE(eq.equip_agility, 0) as equip_agility,
            COALESCE(eq.equip_vitality, 0) as equip_vitality,
            COALESCE(eq.equip_luck, 0) as equip_luck,
            COALESCE(eq.equip_hp, 0) as equip_hp,
            COALESCE(eq.equip_mp, 0) as equip_mp,
            COALESCE(eq.equip_attack, 0) as equip_attack,
            COALESCE(eq.equip_defense, 0) as equip_defense,
            COALESCE(eq.equip_magic_attack, 0) as equip_magic_attack,
            COALESCE(eq.equip_magic_defense, 0) as equip_magic_defense
     FROM characters c
     LEFT JOIN LATERAL (
       SELECT
         SUM(COALESCE((it.stat_bonuses->>'strength')::int, 0) + COALESCE((ci.modifications->>'strength')::int, 0)) as equip_strength,
         SUM(COALESCE((it.stat_bonuses->>'intelligence')::int, 0) + COALESCE((ci.modifications->>'intelligence')::int, 0)) as equip_intelligence,
         SUM(COALESCE((it.stat_bonuses->>'agility')::int, 0) + COALESCE((ci.modifications->>'agility')::int, 0)) as equip_agility,
         SUM(COALESCE((it.stat_bonuses->>'vitality')::int, 0) + COALESCE((ci.modifications->>'vitality')::int, 0)) as equip_vitality,
         SUM(COALESCE((it.stat_bonuses->>'luck')::int, 0) + COALESCE((ci.modifications->>'luck')::int, 0)) as equip_luck,
         SUM(COALESCE((it.stat_bonuses->>'hp')::int, 0) + COALESCE((ci.modifications->>'hp_max')::int, 0)) as equip_hp,
         SUM(COALESCE((it.stat_bonuses->>'mp')::int, 0) + COALESCE((ci.modifications->>'mp_max')::int, 0)) as equip_mp,
         SUM(COALESCE((it.stat_bonuses->>'attack')::int, 0) + COALESCE((ci.modifications->>'attack')::int, 0)) as equip_attack,
         SUM(COALESCE((it.stat_bonuses->>'defense')::int, 0) + COALESCE((ci.modifications->>'defense')::int, 0)) as equip_defense,
         SUM(COALESCE((it.stat_bonuses->>'magic_attack')::int, 0) + COALESCE((ci.modifications->>'magic_attack')::int, 0)) as equip_magic_attack,
         SUM(COALESCE((it.stat_bonuses->>'magic_defense')::int, 0) + COALESCE((ci.modifications->>'magic_defense')::int, 0)) as equip_magic_defense
       FROM character_items ci
       JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.character_id = c.id AND ci.equipped_slot IS NOT NULL
     ) eq ON true
     WHERE c.user_id = $1 AND c.party_slot <= $2 AND c.party_slot IS NOT NULL
     ORDER BY c.party_slot ASC`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  if (partyResult.rows.length === 0) {
    throw new AppError('No battle party set', 400);
  }

  const party = partyResult.rows;

  // Get learned skills for all party members
  const characterIds = party.map(c => c.id);
  const skillsResult = await query(
    `SELECT character_id, skill_id, level
     FROM character_skills
     WHERE character_id = ANY($1)`,
    [characterIds]
  );

  // Group skills by character and enhance with skill definitions
  const characterSkills = {};
  for (const row of skillsResult.rows) {
    if (!characterSkills[row.character_id]) {
      characterSkills[row.character_id] = [];
    }
    // Get character class to find skill definition
    const char = party.find(c => c.id === row.character_id);
    const skillDef = char ? battleService.getSkillDefinition(char.class, row.skill_id) : null;

    if (skillDef) {
      characterSkills[row.character_id].push({
        id: row.skill_id,
        name: skillDef.name,
        level: row.level,
        mpCost: skillDef.mpCost || 0,
        range: skillDef.range || 1,
        power: skillDef.power || 100,
        type: skillDef.type || 'active',
        effect: skillDef.effect || null,
        aoeRadius: skillDef.aoeRadius || 0,
        description: skillDef.description || ''
      });
    }
  }

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
    phase: 'active',
    activeUnitIndex: 0,
    activeUnitId: null,
    mapWidth: 32,
    mapHeight: 32,
    units: party.map((char, idx) => {
      // Use formation position if provided, otherwise default layout
      const formationPos = formation?.[char.id];
      const tileX = formationPos ? formationPos.tileX : 1 + (idx % 3);
      const tileY = formationPos ? formationPos.tileY + 12 : 13 + Math.floor(idx / 3) * 2;

      return {
        id: char.id,
        type: 'player',
        name: char.name,
        class: char.class,
        level: char.level,
        hp: char.hp_current,
        maxHp: char.hp_max + (parseInt(char.equip_hp, 10) || 0),
        mp: char.mp_current,
        maxMp: char.mp_max + (parseInt(char.equip_mp, 10) || 0),
        // Apply equipment stat bonuses to combat stats
        strength: char.strength + (parseInt(char.equip_strength, 10) || 0),
        intelligence: char.intelligence + (parseInt(char.equip_intelligence, 10) || 0),
        agility: char.agility + (parseInt(char.equip_agility, 10) || 0),
        vitality: char.vitality + (parseInt(char.equip_vitality, 10) || 0),
        luck: char.luck + (parseInt(char.equip_luck, 10) || 0),
        // Equipment-only combat bonuses
        attack: parseInt(char.equip_attack, 10) || 0,
        defense: parseInt(char.equip_defense, 10) || 0,
        magicAttack: parseInt(char.equip_magic_attack, 10) || 0,
        magicDefense: parseInt(char.equip_magic_defense, 10) || 0,
        tileX,
        tileY,
        ct: 0,
        hasActed: false,
        statusEffects: [],
        // Include learned skills for this character
        skills: characterSkills[char.id] || []
      };
    })
  };

  // Get consumable items from party leader's inventory
  const partyLeaderId = party[0].id;
  const consumablesResult = await query(
    `SELECT ci.id as inventory_id, it.id as item_id, it.name, it.item_type,
            it.effect_type, it.effect_value, it.description, ci.quantity
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.character_id = $1 AND it.item_type = 'consumable' AND ci.quantity > 0
       AND ci.equipped_slot IS NULL
     ORDER BY it.name`,
    [partyLeaderId]
  );

  // Map consumables to battle format
  initialState.consumables = consumablesResult.rows.map(item => ({
    inventoryId: item.inventory_id,
    itemId: item.item_id,
    name: item.name,
    quantity: item.quantity,
    description: item.description,
    effectType: item.effect_type,
    effectValue: item.effect_value
  }));

  // Extract character IDs from formation (only placed characters count for enemy scaling)
  const formationCharacterIds = formation ? Object.keys(formation).map(id => parseInt(id, 10)) : null;

  // Generate enemies from templates (scaled to formation characters)
  const enemies = await enemyService.generateEncounter(currentNodeId, party, formationCharacterIds);
  initialState.units.push(...enemies);

  // Initialize CT values for all units (adds initial variation)
  battleService.initializeCT(initialState.units);

  // Advance CT and find the first actor
  battleService.advanceToNextActor(initialState);

  // Generate turn predictions
  initialState.turnPredictions = battleService.predictTurnOrder(initialState, 10);

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

  // Join battle WebSocket room
  battleWebsocket.joinBattle(battleId, req.user.userId);

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

  // Migration: ensure all units have CT field (for existing battles)
  for (const unit of state.units) {
    if (typeof unit.ct !== 'number') {
      unit.ct = 0;
    }
  }

  // Get active unit using activeUnitId (or fall back to index for migration)
  let activeUnit;
  if (state.activeUnitId) {
    activeUnit = state.units.find(u => u.id === state.activeUnitId);
  }
  if (!activeUnit) {
    activeUnit = state.units[state.activeUnitIndex];
    state.activeUnitId = activeUnit?.id;
  }

  // Validate it's the player's turn
  if (!activeUnit || activeUnit.type !== 'player' || activeUnit.id !== unitId) {
    throw new AppError('Not this unit\'s turn', 400);
  }

  // Process player action using service
  const result = battleService.processAction(state, activeUnit, actionType, targetTile, skillId);

  // If there was an error (e.g., already moved, status effect), return early
  if (result.error) {
    return res.status(400).json({
      error: result.error,
      state,
      availableActions: result.availableActions
    });
  }

  // Check if battle ended from player action
  let battleStatus = battleService.checkBattleEnd(state);

  // Process enemy turns ONLY if turn is complete and battle is still active
  let enemyActions = [];
  const turnContinues = !result.turnEnded && battleStatus === 'active';

  if (result.turnEnded && battleStatus === 'active') {
    // Turn is complete - advance to next actor using CT system
    battleService.advanceToNextActorWithCT(state);

    // Process all enemy turns until it's a player's turn again
    enemyActions = battleService.processEnemyTurns(state, aiService);

    // Check if battle ended after enemy turns
    battleStatus = battleService.checkBattleEnd(state);
  }

  // Update turn predictions
  state.turnPredictions = battleService.predictTurnOrder(state, 10);

  // Update battle state
  await query(
    'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
    [JSON.stringify(state), battleStatus, battleId]
  );

  // Consume item from inventory if an item was used (with FOR UPDATE to prevent race conditions)
  if (result.consumedInventoryId) {
    await withTransaction(async (client) => {
      // Lock the row to prevent race condition with rapid item usage
      const itemCheck = await client.query(
        'SELECT quantity FROM character_items WHERE id = $1 FOR UPDATE',
        [result.consumedInventoryId]
      );
      if (itemCheck.rows.length > 0) {
        if (itemCheck.rows[0].quantity > 1) {
          await client.query(
            'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
            [result.consumedInventoryId]
          );
        } else {
          await client.query(
            'DELETE FROM character_items WHERE id = $1',
            [result.consumedInventoryId]
          );
        }
      }
    });
  }

  // Broadcast action executed via WebSocket
  battleWebsocket.broadcastActionExecuted(battleId, unitId, actionType, result, req.user.userId);

  // Broadcast enemy actions if any (only when turn completed)
  if (enemyActions && enemyActions.length > 0) {
    battleWebsocket.broadcastEnemyActions(battleId, enemyActions, req.user.userId);
  }

  // Broadcast turn changed only if turn actually ended
  if (result.turnEnded) {
    battleWebsocket.broadcastTurnChanged(
      battleId,
      state.activeUnitIndex,
      state.turn,
      req.user.userId,
      state.activeUnitId,
      state.turnPredictions
    );
  }

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

        // Award gold to user (capped at MAX_GOLD to prevent overflow)
        await client.query(
          'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
          [gold, MAX_GOLD, req.user.userId]
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

    // Broadcast battle end via WebSocket
    battleWebsocket.broadcastBattleEnd(battleId, battleStatus, result.rewards);

    // Leave battle room
    battleWebsocket.leaveBattle(battleId, req.user.userId);
  }

  res.json({
    state,
    actionResult: result,
    enemyActions,
    battleStatus,
    // Two-action turn system: indicate if turn continues
    turnContinues,
    availableActions: result.availableActions
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
