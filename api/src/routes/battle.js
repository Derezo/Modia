import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { actionLimiter, startLimiter, readLimiter, rejoinLimiter, rewardsLimiter, stateLimiter } from '../middleware/battleRateLimiter.js';
import { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE, MAX_GOLD } from '../config/constants.js';
import * as battleService from '../services/battleService.js';
import * as aiService from '../services/aiService.js';
import * as enemyService from '../services/enemyService.js';
import * as itemDropService from '../services/itemDropService.js';
import battleWebsocket from '../services/battleWebsocket.js';
import { createPlayerBattleUnit } from '../services/battleUnitFactory.js';
import * as traitService from '../services/traitService.js';
import * as advancementQuestService from '../services/advancementQuestService.js';
import * as dailyQuestService from '../services/dailyQuestService.js';
import * as bossService from '../services/bossService.js';
import * as battleTurnManager from '../services/battleTurnManager.js';
import { generateTerrain } from '../../../shared/mapGeneration.js';
import * as zodiacAbilityService from '../services/zodiacAbilityService.js';

const router = express.Router();

// ============================================================================
// BATTLE END HELPER (for async processing)
// ============================================================================

/**
 * Handle battle end - calculate rewards and update database
 * @param {number} battleId - Battle ID
 * @param {string} status - 'victory' | 'defeat'
 * @param {Object} state - Final battle state
 * @param {number} userId - User ID who owns the battle
 * @param {Object} battleEndResult - Result from checkBattleEnd() with winningTeamId
 * @returns {Object} Rewards data if victory
 */
async function handleBattleEnd(battleId, status, state, userId, battleEndResult = null) {
  // Update characters to no longer be in battle
  await query(
    `UPDATE characters SET in_battle = false
     WHERE user_id = $1 AND party_slot <= $2`,
    [userId, MAX_BATTLE_PARTY_SIZE]
  );

  let rewards = null;

  // Calculate rewards for victory
  if (status === 'victory') {
    const enemies = state.units.filter(u => u.type === 'enemy');
    const players = state.units.filter(u => u.type === 'player');
    const partyLevel = Math.floor(
      players.reduce((sum, u) => sum + (u.level || 1), 0) / players.length
    ) || 1;

    // Get node info for rewards calculation and clearance
    const nodeResult = await query(
      `SELECT wn.id as node_id, wn.difficulty_tier, wn.node_type
       FROM world_nodes wn
       WHERE wn.id = (SELECT node_id FROM battles WHERE id = $1)`,
      [battleId]
    );
    const nodeId = nodeResult.rows[0]?.node_id;
    const difficultyTier = nodeResult.rows[0]?.difficulty_tier || 1;
    const nodeType = nodeResult.rows[0]?.node_type || 'forest';

    // Check if this is an advancement battle (guild boss trial)
    const advancementCheck = await query(
      `SELECT is_advancement_battle, challenger_character_id
       FROM battles WHERE id = $1`,
      [battleId]
    );
    const isAdvancementBattle = advancementCheck.rows[0]?.is_advancement_battle;
    const challengerCharacterId = advancementCheck.rows[0]?.challenger_character_id;

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
      [userId]
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
        [gold, MAX_GOLD, userId]
      );

      // Distribute XP to battle party characters
      const xpPerCharacter = Math.floor(exp / players.length);
      await client.query(
        `UPDATE characters
         SET experience = experience + $1
         WHERE user_id = $2 AND party_slot <= $3 AND party_slot IS NOT NULL`,
        [xpPerCharacter, userId, MAX_BATTLE_PARTY_SIZE]
      );

      // Store dropped items in user's shared inventory
      for (const item of droppedItems) {
        await itemDropService.storeDroppedItem(userId, item, client);
      }

      // Clear combat node on victory (allows player to pass through in future)
      if (nodeId && BATTLE_NODE_TYPES.includes(nodeType)) {
        await client.query(
          `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, node_id) DO NOTHING`,
          [userId, nodeId, battleId]
        );
      }
    });

    // Update quest progress (outside transaction for non-critical updates)
    if (partyLeaderId) {
      // Track enemy kills
      for (const enemy of enemies) {
        const enemyType = enemy.archetype || enemy.type || enemy.name;
        if (enemyType) {
          try {
            await advancementQuestService.updateEnemyProgress(partyLeaderId, enemyType);
          } catch (err) {
            console.warn(`Quest progress update failed for enemy ${enemyType}:`, err.message);
          }
        }
      }

      // Track node visits
      if (nodeId && nodeType) {
        try {
          await advancementQuestService.updateNodeProgress(partyLeaderId, nodeId, nodeType);
        } catch (err) {
          console.warn(`Quest progress update failed for node ${nodeId}:`, err.message);
        }
      }

      // Track material collection from dropped items
      for (const item of droppedItems) {
        if (item.templateId) {
          try {
            await advancementQuestService.updateMaterialProgress(partyLeaderId, item.templateId);
          } catch (err) {
            console.warn(`Quest progress update failed for item ${item.templateId}:`, err.message);
          }
        }
      }

      // Daily/Weekly quest progress hooks (fire-and-forget pattern)
      // Track enemy kills
      dailyQuestService.updateProgress(partyLeaderId, 'kill_enemies', enemies.length, {})
        .catch(err => console.warn('[Quest] kill_enemies progress failed:', err.message));

      // Track battle completion
      dailyQuestService.updateProgress(partyLeaderId, 'complete_battles', 1, {
        tier: difficultyTier
      }).catch(err => console.warn('[Quest] complete_battles progress failed:', err.message));

      // Track gold earned
      if (gold > 0) {
        dailyQuestService.updateProgress(partyLeaderId, 'gold_earned', gold, {})
          .catch(err => console.warn('[Quest] gold_earned progress failed:', err.message));
      }

      // Check if this was a party battle (multiple users)
      const uniqueOwners = new Set(players.map(p => p.ownerId || p.userId).filter(Boolean));
      if (uniqueOwners.size > 1) {
        dailyQuestService.updateProgress(partyLeaderId, 'party_battles', 1, {})
          .catch(err => console.warn('[Quest] party_battles progress failed:', err.message));
      }
    }

    // Handle advancement battle quest completion
    let advancementResult = null;
    if (isAdvancementBattle && challengerCharacterId) {
      try {
        advancementResult = await advancementQuestService.completeQuest(
          challengerCharacterId,
          battleId
        );
        console.log(`[Battle] Advancement quest completed for character ${challengerCharacterId}`);
      } catch (err) {
        console.error('[Battle] Advancement quest completion failed:', err);
        advancementResult = { error: err.message };
      }
    }

    rewards = {
      gold,
      experience: exp,
      items: itemDropService.formatDropsForResponse(droppedItems),
      advancementComplete: advancementResult
    };
  }

  // Broadcast battle end via WebSocket
  // For PvP battles, include player IDs and winning team so each player gets their perspective
  const isPvP = state.battleType === 'pvp' && state.player1Id && state.player2Id;
  const pvpInfo = isPvP && battleEndResult?.winningTeamId ? {
    player1Id: state.player1Id,
    player2Id: state.player2Id,
    winningTeamId: battleEndResult.winningTeamId
  } : null;

  if (isPvP) {
    console.log(`[Battle] PvP battle end - battleId=${battleId}, winningTeamId=${battleEndResult?.winningTeamId}, player1=${state.player1Id}, player2=${state.player2Id}`);
  }

  battleWebsocket.broadcastBattleEnd(battleId, status, rewards, pvpInfo);

  // Leave battle room (for all users in battle)
  const participants = battleWebsocket.getBattleParticipants(battleId);
  for (const participantId of participants) {
    battleWebsocket.leaveBattle(battleId, participantId);
  }

  // Clean up boss encounter records
  bossService.cleanupBossEncounter(battleId).catch(err => {
    console.error('[Battle] Failed to cleanup boss encounter:', err);
  });

  return rewards;
}

// ============================================================================

// GET /api/battle/preview/:nodeId - Get encounter preview for formation screen
router.get('/preview/:nodeId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);

  if (isNaN(nodeId)) {
    throw new AppError('Invalid node ID', 400);
  }

  const preview = await enemyService.getEncounterPreview(nodeId);
  res.json(preview);
}));

// POST /api/battle/start - Start PvE battle at current node
router.post('/start', authenticate, startLimiter, asyncHandler(async (req, res) => {
  // Get optional formation from request
  const { formation } = req.body || {};

  // Get user's battle party with equipment stat bonuses
  const partyResult = await query(
    `SELECT c.id, c.name, c.race, c.gender, c.class, c.level,
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

  // Generate terrain with elevation using shared module (server-side mirror of frontend)
  const mapData = generateTerrain(mapSeed, node.node_type, 32, 32, { elevation: true });
  const terrain = mapData.terrain;

  // Validate elevation data before storing in battle state
  let elevation = mapData.elevation;
  if (elevation && (!Array.isArray(elevation) || elevation.length !== 32 ||
      !elevation[0] || elevation[0].length !== 32)) {
    console.warn('[Battle] Invalid elevation data dimensions, using flat map');
    elevation = null;  // Fall back to 2D pathfinding
  }

  // Load character traits for all party members
  const characterTraits = await traitService.loadCharacterTraits(characterIds);

  // Load zodiac signature abilities for the user
  const zodiacAbilities = await zodiacAbilityService.loadActiveZodiacAbilities(req.user.userId);

  // Load user settings for debug options
  const settingsResult = await query(
    'SELECT settings FROM user_settings WHERE user_id = $1',
    [req.user.userId]
  );
  const userSettings = settingsResult.rows[0]?.settings || {};
  const debugOptions = {
    logAIDecisions: userSettings?.developer?.enabled && userSettings?.developer?.battle?.logAIDecisions
  };

  // Create initial battle state
  const initialState = {
    turn: 1,
    phase: 'active',
    activeUnitIndex: 0,
    activeUnitId: null,
    mapWidth: 32,
    mapHeight: 32,
    terrain, // Store terrain for server-side movement validation
    elevation, // Store elevation for 3D pathfinding and rendering
    debugOptions, // User's debug settings for AI logging etc.
    units: party.map((char, idx) => {
      // Use formation position if provided, otherwise default layout
      const formationPos = formation?.[char.id];
      const defaultX = 1 + (idx % 3);
      const defaultY = 13 + Math.floor(idx / 3) * 2;

      // Use BattleUnit factory for unified unit creation
      return createPlayerBattleUnit(
        {
          ...char,
          user_id: req.user.userId,
          hp_current: char.hp_current,
          hp_max: char.hp_max,
          mp_current: char.mp_current,
          mp_max: char.mp_max,
          equip_hp: parseInt(char.equip_hp, 10) || 0,
          equip_mp: parseInt(char.equip_mp, 10) || 0,
          equip_strength: parseInt(char.equip_strength, 10) || 0,
          equip_intelligence: parseInt(char.equip_intelligence, 10) || 0,
          equip_agility: parseInt(char.equip_agility, 10) || 0,
          equip_vitality: parseInt(char.equip_vitality, 10) || 0,
          equip_luck: parseInt(char.equip_luck, 10) || 0,
          equip_attack: parseInt(char.equip_attack, 10) || 0,
          equip_defense: parseInt(char.equip_defense, 10) || 0,
          equip_magic_attack: parseInt(char.equip_magic_attack, 10) || 0,
          equip_magic_defense: parseInt(char.equip_magic_defense, 10) || 0
        },
        formationPos ? { tileX: formationPos.tileX, tileY: formationPos.tileY + 12 } : null,
        characterSkills[char.id] || [],
        {
          defaultX,
          defaultY,
          traits: characterTraits[char.id] || [],
          zodiacAbilities: zodiacAbilities // Pass zodiac abilities to all player units
        }
      );
    })
  };

  // Get consumable items from shared inventory (user_id based, not character_id)
  const consumablesResult = await query(
    `SELECT ci.id as inventory_id, it.id as item_id, it.name, it.item_type,
            it.effect_type, it.effect_value, it.description, ci.quantity,
            it.sprite_id
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.user_id = $1 AND it.item_type = 'consumable' AND ci.quantity > 0
       AND ci.equipped_slot IS NULL
     ORDER BY it.name`,
    [req.user.userId]
  );

  // Map consumables to battle format
  initialState.consumables = consumablesResult.rows.map(item => ({
    inventoryId: item.inventory_id,
    itemId: item.item_id,
    name: item.name,
    quantity: item.quantity,
    description: item.description,
    effectType: item.effect_type,
    effectValue: item.effect_value,
    spriteId: item.sprite_id
  }));

  // Extract character IDs from formation (only placed characters count for enemy scaling)
  const formationCharacterIds = formation ? Object.keys(formation).map(id => parseInt(id, 10)) : null;

  // Generate enemies from templates (scaled to formation characters)
  const enemies = await enemyService.generateEncounter(currentNodeId, party, formationCharacterIds);
  initialState.units.push(...enemies);

  // Initialize boss states for any boss enemies
  initialState.bossStates = {};
  for (const enemy of enemies) {
    if (bossService.isBoss(enemy)) {
      // We don't have battleId yet, so we'll use a temporary ID
      // The actual battle ID will be assigned after insert
      const bossState = bossService.initializeBossState(enemy, 0);
      if (bossState) {
        initialState.bossStates[enemy.id] = bossState;
        enemy.isBoss = true;
        enemy.currentPhase = bossState.currentPhase;
        enemy.maxPhases = bossState.maxPhases;
        enemy.phaseName = bossState.phaseName;
      }
    }
  }

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

  // Update boss encounter records with actual battle ID
  if (Object.keys(initialState.bossStates).length > 0) {
    for (const [_unitId, bossState] of Object.entries(initialState.bossStates)) {
      bossState.battleId = battleId;
      bossService.saveBossEncounter(bossState).catch(err => {
        console.error('[Battle] Failed to save boss encounter:', err);
      });
    }
  }

  // Mark characters as in battle
  await query(
    `UPDATE characters SET in_battle = true
     WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL`,
    [req.user.userId, MAX_BATTLE_PARTY_SIZE]
  );

  // Join battle WebSocket room
  battleWebsocket.joinBattle(battleId, req.user.userId);

  // Check if the first actor is an enemy - if so, process their turns asynchronously
  const firstActor = initialState.units.find(u => u.id === initialState.activeUnitId);
  if (firstActor && firstActor.type === 'enemy') {
    // Async enemy turn processing - starts after response is sent via WebSocket
    setImmediate(async () => {
      try {
        const { state: updatedState, battleStatus, battleEndResult } =
          await battleTurnManager.processEnemyTurnsAsync(battleId, initialState, aiService, battleService);

        // Update final state
        await query(
          'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
          [JSON.stringify(updatedState), battleStatus, battleId]
        );

        if (battleStatus !== 'active') {
          await handleBattleEnd(battleId, battleStatus, updatedState, req.user.userId, battleEndResult);
        } else {
          battleTurnManager.notifyPlayerTurn(battleId, updatedState);
        }
      } catch (error) {
        console.error('Initial enemy turn processing error:', error);
      }
    });
  }

  // Get available actions for the first player unit (if their turn)
  const firstPlayerUnit = initialState.units.find(u => u.id === initialState.activeUnitId && u.type === 'player');
  const availableActions = firstPlayerUnit
    ? battleService.getAvailableActions(firstPlayerUnit, initialState)
    : null;

  res.status(201).json({
    battleId,
    mapSeed,
    mapWidth: 32,
    mapHeight: 32,
    nodeType: node.node_type, // Critical: frontend needs this for terrain generation
    state: initialState,
    availableActions
  });
}));

// GET /api/battle/current - Get current battle state
router.get('/current', authenticate, readLimiter, asyncHandler(async (req, res) => {
  // Check for active battle where user is player1, player2, or in battle_players (for PvP/coop)
  const result = await query(
    `SELECT b.id, b.battle_type, b.battle_state, b.map_seed, b.map_width, b.map_height,
            wn.node_type, wn.name as node_name
     FROM battles b
     JOIN world_nodes wn ON b.node_id = wn.id
     WHERE b.status = 'active'
       AND (b.player1_id = $1 OR b.player2_id = $1 OR
            EXISTS (SELECT 1 FROM battle_players bp WHERE bp.battle_id = b.id AND bp.user_id = $1))
     ORDER BY b.started_at DESC
     LIMIT 1`,
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('No active battle', 404);
  }

  const battle = result.rows[0];
  const state = battle.battle_state;
  const battleId = battle.id;

  // Join battle WebSocket room for updates
  battleWebsocket.joinBattle(battleId, req.user.userId);

  // Check if it's an enemy's turn - if so, resume enemy turn processing
  const activeUnit = state.units?.find(u => u.id === state.activeUnitId);
  if (activeUnit && activeUnit.type === 'enemy' && activeUnit.hp > 0) {
    console.log('[Battle] Resuming enemy turn processing for battle', battleId, '- active unit:', activeUnit.name);
    setImmediate(async () => {
      try {
        const { state: updatedState, battleStatus, battleEndResult } =
          await battleTurnManager.processEnemyTurnsAsync(battleId, state, aiService, battleService);

        // Update final state
        await query(
          'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
          [JSON.stringify(updatedState), battleStatus, battleId]
        );

        if (battleStatus !== 'active') {
          await handleBattleEnd(battleId, battleStatus, updatedState, req.user.userId, battleEndResult);
        } else {
          battleTurnManager.notifyPlayerTurn(battleId, updatedState);
        }
      } catch (error) {
        console.error('Resume enemy turn processing error:', error);
      }
    });
  }

  // Get available actions for active player unit
  const activePlayerUnit = state.units?.find(u => u.id === state.activeUnitId && u.type === 'player');
  const availableActions = activePlayerUnit
    ? battleService.getAvailableActions(activePlayerUnit, state)
    : null;

  res.json({
    battleId: battleId,
    battleType: battle.battle_type,
    mapSeed: battle.map_seed,
    mapWidth: battle.map_width,
    mapHeight: battle.map_height,
    nodeType: battle.node_type,
    nodeName: battle.node_name,
    state: state,
    availableActions
  });
}));

// GET /api/battle/:battleId/rejoin - Rejoin an active battle after disconnect
router.get('/:battleId/rejoin', authenticate, rejoinLimiter, asyncHandler(async (req, res) => {
  const { battleId } = req.params;
  const battleReconnection = await import('../services/battleReconnection.js');

  // Verify player has access to this battle
  // Use LEFT JOIN for world_nodes since PvP battles have NULL node_id
  const result = await query(
    `SELECT b.id, b.battle_type, b.battle_state, b.status, b.map_seed, b.map_width, b.map_height,
            wn.node_type, wn.name as node_name
     FROM battles b
     LEFT JOIN world_nodes wn ON b.node_id = wn.id
     WHERE b.id = $1
       AND (b.player1_id = $2 OR b.player2_id = $2 OR
            EXISTS (SELECT 1 FROM battle_players bp WHERE bp.battle_id = b.id AND bp.user_id = $2))`,
    [battleId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Battle not found or you do not have access', 404);
  }

  const battle = result.rows[0];

  if (battle.status !== 'active') {
    throw new AppError('Battle is no longer active', 400);
  }

  // Get username for reconnection notification
  const userResult = await query(
    'SELECT username FROM users WHERE id = $1',
    [req.user.userId]
  );
  const playerName = userResult.rows[0]?.username || 'Unknown';

  // Handle reconnection (clears timeout, notifies other players)
  const reconnectResult = await battleReconnection.handleReconnect(
    parseInt(battleId),
    req.user.userId,
    playerName
  );

  // Get disconnected players info
  const disconnectedPlayers = battleReconnection.getDisconnectedPlayers(parseInt(battleId));

  // Get available actions for active player unit
  const battleState = battle.battle_state;
  const activePlayerUnit = battleState.units?.find(u => u.id === battleState.activeUnitId && u.type === 'player');
  const availableActions = activePlayerUnit
    ? battleService.getAvailableActions(activePlayerUnit, battleState)
    : null;

  res.json({
    success: true,
    battleId: battle.id,
    battleType: battle.battle_type,
    mapSeed: battle.map_seed,
    mapWidth: battle.map_width,
    mapHeight: battle.map_height,
    nodeType: battle.node_type,
    nodeName: battle.node_name,
    state: battleState,
    gracePeriod: reconnectResult?.gracePeriod || 0,
    disconnectedPlayers,
    availableActions
  });
}));

// POST /api/battle/action - Submit battle action
router.post('/action', authenticate, actionLimiter, asyncHandler(async (req, res) => {
  const { battleId, actionType, unitId, targetTile, skillId } = req.body;

  // Get battle - allow both player1 AND player2 to submit actions (for PvP)
  const battleResult = await query(
    `SELECT id, battle_state, player1_id, player2_id FROM battles
     WHERE id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'active'`,
    [battleId, req.user.userId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found or not active', 404);
  }

  const battle = battleResult.rows[0];
  const state = battle.battle_state;

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

  // For PvP/co-op: validate unit ownership (ownerId field)
  // If ownerId is set, only the owning player can control that unit
  if (activeUnit.ownerId && activeUnit.ownerId !== req.user.userId) {
    throw new AppError('You do not control this unit', 403);
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

  // Check for boss phase transitions after damage dealt
  if (result.damage && result.targetType === 'enemy' && state.bossStates) {
    const targetBoss = state.units.find(u => u.id === result.targetId);
    if (targetBoss && state.bossStates[targetBoss.id]) {
      const phaseTransition = bossService.processBossDamage(
        targetBoss,
        state.bossStates[targetBoss.id],
        result.damage,
        state
      );
      if (phaseTransition) {
        result.phaseTransition = phaseTransition;
        // Update boss display info
        targetBoss.currentPhase = state.bossStates[targetBoss.id].currentPhase;
        targetBoss.phaseName = phaseTransition.phaseName;

        // Broadcast phase transition via WebSocket
        battleWebsocket.broadcastPhaseTransition(battleId, {
          bossId: targetBoss.id,
          bossName: targetBoss.name,
          ...phaseTransition
        });
      }
    }
  }

  // Check if battle ended from player action
  const battleEndResult = battleService.checkBattleEnd(state);
  const battleStatus = battleService.getBattleStatusString(battleEndResult);

  // Track if turn continues (two-action system: move + act)
  const turnContinues = !result.turnEnded && battleStatus === 'active';

  if (result.turnEnded && battleStatus === 'active') {
    // Turn is complete - advance to next actor using CT system
    battleService.advanceToNextActorWithCT(state);

    // Save state first, then spawn async processing
    await query(
      'UPDATE battles SET battle_state = $1 WHERE id = $2',
      [JSON.stringify(state), battleId]
    );

    // Process enemy turns asynchronously (don't await)
    setImmediate(async () => {
      try {
        const { state: updatedState, battleStatus: finalStatus, battleEndResult } =
          await battleTurnManager.processEnemyTurnsAsync(battleId, state, aiService, battleService);

        // Update final state and status
        await query(
          'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
          [JSON.stringify(updatedState), finalStatus, battleId]
        );

        // Handle battle end
        if (finalStatus !== 'active') {
          await handleBattleEnd(battleId, finalStatus, updatedState, req.user.userId, battleEndResult);
        } else {
          // Notify next player it's their turn
          battleTurnManager.notifyPlayerTurn(battleId, updatedState);
        }
      } catch (error) {
        console.error('Async enemy turn processing error:', error);
      }
    });
  }

  // Update turn predictions
  state.turnPredictions = battleService.predictTurnOrder(state, 10);

  // Update battle state if turn didn't end (async processing already saved state when turn ended)
  if (!result.turnEnded) {
    await query(
      'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
      [JSON.stringify(state), battleStatus, battleId]
    );
  }

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

  // Handle battle end if player's action ended the battle
  // (Enemy turn processing handles its own battle ends via async manager)
  if (battleStatus !== 'active') {
    // Save final battle state and status BEFORE handling rewards
    // This ensures the battle is marked as ended even if the client disconnects
    await query(
      'UPDATE battles SET battle_state = $1, status = $2 WHERE id = $3',
      [JSON.stringify(state), battleStatus, battleId]
    );
    result.rewards = await handleBattleEnd(battleId, battleStatus, state, req.user.userId, battleEndResult);
  }

  res.json({
    state,
    actionResult: result,
    battleStatus,
    // Two-action turn system: indicate if turn continues
    turnContinues,
    availableActions: result.availableActions
  });
}));

// GET /api/battle/rewards - Get rewards after victory
router.get('/rewards/:battleId', authenticate, rewardsLimiter, asyncHandler(async (req, res) => {
  const { battleId } = req.params;

  // Allow both player1 AND player2 to get rewards (for PvP)
  const result = await query(
    `SELECT rewards, player1_id, player2_id FROM battles
     WHERE id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'victory'`,
    [battleId, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Battle not found or not a victory', 404);
  }

  res.json({ rewards: result.rows[0].rewards });
}));

// GET /api/battle/:id/state - Lightweight battle state for defensive polling
router.get('/:id/state', authenticate, stateLimiter, asyncHandler(async (req, res) => {
  const battleId = parseInt(req.params.id, 10);

  if (isNaN(battleId)) {
    throw new AppError('Invalid battle ID', 400);
  }

  // Get battle and verify participation
  const result = await query(
    `SELECT b.id, b.battle_state, b.status, b.player1_id, b.player2_id
     FROM battles b
     WHERE b.id = $1`,
    [battleId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Battle not found', 404);
  }

  const battle = result.rows[0];
  const battleState = battle.battle_state;

  // Verify user is a participant (player1, player2, or in battle_players table for co-op)
  const isPlayer1 = battle.player1_id === req.user.userId;
  const isPlayer2 = battle.player2_id === req.user.userId;

  if (!isPlayer1 && !isPlayer2) {
    // Check battle_players table for co-op battles
    const participantCheck = await query(
      'SELECT 1 FROM battle_players WHERE battle_id = $1 AND user_id = $2',
      [battleId, req.user.userId]
    );
    if (participantCheck.rows.length === 0) {
      throw new AppError('Not a battle participant', 403);
    }
  }

  // Build lightweight state for polling
  // Note: Battle units use tileX/tileY for position (not x/y)
  const state = {
    activeUnitId: battleState.activeUnitId || null,
    turnCount: battleState.turn || 0,
    status: battle.status || 'active',
    units: (battleState.units || []).map(u => ({
      id: u.id,
      x: u.tileX,
      y: u.tileY,
      hp: u.hp,
      mp: u.mp,
      statusEffects: (u.statusEffects || []).map(e => e.type || e)
    }))
  };

  // Generate ETag for caching
  const etag = generateETag(state);

  // Check If-None-Match header for 304 response
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  res.set('ETag', etag);
  res.json(state);
}));

/**
 * Generate a simple hash-based ETag from state object
 * @param {Object} state - The state object to hash
 * @returns {string} ETag string in quotes
 */
function generateETag(state) {
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `"${hash.toString(16)}"`;
}

// ============================================================================
// ZODIAC SIGNATURE ABILITIES
// ============================================================================

/**
 * POST /api/battle/:battleId/zodiac-ability
 * Use a zodiac signature ability during battle
 * Body: { characterId, abilityKey, targetUnitId? }
 */
router.post('/:battleId/zodiac-ability', authenticate, actionLimiter, asyncHandler(async (req, res) => {
  const battleId = parseInt(req.params.battleId, 10);
  const { characterId, abilityKey, targetUnitId } = req.body;

  if (!characterId || !abilityKey) {
    throw new AppError('characterId and abilityKey are required', 400);
  }

  // Get battle and verify player is a participant
  const battleResult = await query(
    `SELECT id, battle_state, player1_id, player2_id FROM battles
     WHERE id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'active'`,
    [battleId, req.user.userId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found or not active', 404);
  }

  const battle = battleResult.rows[0];
  const state = battle.battle_state;

  // Find the source unit
  const sourceUnit = state.units.find(u =>
    u.type === 'player' && u.id === characterId && u.ownerId === req.user.userId
  );

  if (!sourceUnit) {
    throw new AppError('Character not found in battle or not controlled by you', 400);
  }

  if (sourceUnit.hp <= 0) {
    throw new AppError('Character is defeated', 400);
  }

  // Find target unit if specified
  let targetUnit = null;
  if (targetUnitId) {
    targetUnit = state.units.find(u => u.id === targetUnitId && u.hp > 0);
    if (!targetUnit) {
      throw new AppError('Target unit not found or defeated', 400);
    }
  }

  // Apply the zodiac ability
  const result = battleService.applyZodiacAbility(state, sourceUnit, abilityKey, targetUnit);

  if (!result.success) {
    throw new AppError(result.error || 'Failed to use zodiac ability', 400);
  }

  // Update battle state
  await query(
    'UPDATE battles SET battle_state = $1 WHERE id = $2',
    [JSON.stringify(state), battleId]
  );

  // Broadcast the ability use via WebSocket
  battleWebsocket.broadcastActionExecuted(battleId, sourceUnit.id, 'zodiac_ability', {
    ...result,
    unitId: sourceUnit.id,
    unitName: sourceUnit.name,
    targetId: targetUnit?.id,
    targetName: targetUnit?.name
  }, req.user.userId);

  res.json({
    success: true,
    message: result.message,
    effects: result.effects,
    abilityUsed: true,
    abilityKey,
    abilityName: result.abilityName,
    state
  });
}));

/**
 * GET /api/battle/:battleId/zodiac-abilities
 * Get available zodiac abilities for a character in battle
 */
router.get('/:battleId/zodiac-abilities/:characterId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const battleId = parseInt(req.params.battleId, 10);
  const characterId = parseInt(req.params.characterId, 10);

  // Get battle and verify player is a participant
  const battleResult = await query(
    `SELECT id, battle_state FROM battles
     WHERE id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'active'`,
    [battleId, req.user.userId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found or not active', 404);
  }

  const state = battleResult.rows[0].battle_state;

  // Find the unit
  const unit = state.units.find(u =>
    u.type === 'player' && u.id === characterId && u.ownerId === req.user.userId
  );

  if (!unit) {
    throw new AppError('Character not found in battle or not controlled by you', 400);
  }

  // Get available (unused) zodiac abilities
  const availableAbilities = battleService.getAvailableZodiacAbilities(unit);

  res.json({
    characterId,
    availableAbilities,
    usedAbilities: unit.usedZodiacAbilities || []
  });
}));

export default router;
