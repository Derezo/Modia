import express from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { actionLimiter, startLimiter, readLimiter, rejoinLimiter, rewardsLimiter, stateLimiter } from '../middleware/battleRateLimiter.js';
import { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE } from '../config/constants.js';
import * as battleService from '../services/battleService.js';
import * as battleRewardService from '../services/battleRewardService.js';
import * as aiService from '../services/aiService.js';
import * as enemyService from '../services/enemyService.js';
import battleWebsocket from '../services/battleWebsocket.js';
import { createPlayerBattleUnit } from '../services/battleUnitFactory.js';
import { validateFormationPayload } from '../services/battle/formationValidation.js';
import { deriveEncounterTerrainSeed } from '../services/battle/encounterService.js';
import {
  CURRENT_BATTLE_MAP_VERSION,
  generateBattleMap,
  selectBattleMapGenerationVersion
} from '../services/battle/battleMapGenerationService.js';
import * as traitService from '../services/traitService.js';
import * as bossService from '../services/bossService.js';
import * as battleTurnManager from '../services/battleTurnManager.js';
import { getParticipantBattleStatus } from '../services/battleOutcomeService.js';
import * as zodiacAbilityService from '../services/zodiacAbilityService.js';
import {
  cancelTurnTimer,
  completeMatch as completeColiseumMatch,
  publishColiseumMatchResultEvents
} from '../services/coliseumService.js';
import { battleStateRepository } from '../services/battle/BattleStateRepository.js';
import { battleTerminalOutbox } from '../services/battle/BattleTerminalOutbox.js';
import {
  BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
  buildPveTerminalProgressionPayload
} from '../services/battle/BattleTerminalEffects.js';
import {
  createBattleMapUpgradeRequiredPayload,
  createNegotiatedBattleStateSnapshot
} from '../services/messageReliability.js';
import {
  assertBattleMapCapabilities
} from '../../../shared/battleStateProtocol.js';
import {
  validateActionSequence,
  resetActionSequence,
  cleanupBattleSequences,
  startCleanupTimer
} from '../services/battleActionSequence.js';

const router = express.Router();

startCleanupTimer();

export function readBattleMapCapabilities(req) {
  let capabilities = req.body?.battleMapCapabilities;
  if (capabilities === undefined) capabilities = req.query?.battleMapCapabilities;
  if (capabilities === undefined) capabilities = req.get?.('x-battle-map-capabilities');
  if (capabilities === undefined || capabilities === null) {
    return capabilities;
  }
  try {
    if (typeof capabilities === 'string') capabilities = JSON.parse(capabilities);
    assertBattleMapCapabilities(capabilities);
    return capabilities;
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)) throw error;
    throw new AppError('Invalid battle map capabilities', 400, {
      code: 'battle_map_capabilities_invalid'
    });
  }
}

function throwCapabilityError(error) {
  if (error instanceof AppError) throw error;
  if (error?.negotiation) {
    throw new AppError('This battle map requires a newer client', 426, {
      ...createBattleMapUpgradeRequiredPayload(error.negotiation)
    });
  }
  // Capability declarations are parsed and structurally validated by
  // readBattleMapCapabilities before negotiation. Do not translate arbitrary
  // TypeErrors from map generation, state projection, or persistence into a
  // misleading client capability error.
  throw error;
}

const BATTLE_START_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function createBattleCreationKey(requestId, userId, nodeId) {
  const normalizedRequestId = requestId ?? randomUUID();
  if (typeof normalizedRequestId !== 'string'
    || !BATTLE_START_REQUEST_ID_PATTERN.test(normalizedRequestId)) {
    throw new AppError(
      'battleStartRequestId must be 8-128 URL-safe characters',
      400,
      { code: 'battle_start_request_id_invalid' }
    );
  }
  return `pve:${userId}:${nodeId}:${normalizedRequestId}`;
}

function requireCompatibleBattleMap(negotiation) {
  if (negotiation.compatible) return;
  throw new AppError('This battle map requires a newer client', 426, {
    ...createBattleMapUpgradeRequiredPayload(negotiation)
  });
}

export function negotiateBattleTransport(battle, clientCapabilities) {
  try {
    const negotiated = createNegotiatedBattleStateSnapshot(battle, clientCapabilities);
    requireCompatibleBattleMap(negotiated.negotiation);
    return negotiated;
  } catch (error) {
    throwCapabilityError(error);
  }
}

export function createBattleTransportResponse(
  legacyPayload,
  battle,
  clientCapabilities,
  negotiated = negotiateBattleTransport(battle, clientCapabilities)
) {
  const explicitlyDeclared = clientCapabilities !== undefined && clientCapabilities !== null;
  if (!explicitlyDeclared && battle.battleMapSchemaVersion === 1) {
    return legacyPayload;
  }

  const response = {
    ...legacyPayload,
    battleMapCapabilities: negotiated.negotiation,
    snapshot: negotiated.snapshot
  };
  if (battle.battleMapSchemaVersion === 2) {
    delete response.state;
  }
  return response;
}

async function loadBattleNodeMetadata(nodeId) {
  if (nodeId === null || nodeId === undefined) {
    return { nodeType: null, nodeName: null };
  }
  const result = await query(
    'SELECT node_type, name FROM world_nodes WHERE id = $1',
    [nodeId]
  );
  return {
    nodeType: result.rows[0]?.node_type ?? null,
    nodeName: result.rows[0]?.name ?? null
  };
}

async function loadOpponentUsername(battle, userId) {
  const opponentId = String(battle.player1Id) === String(userId)
    ? battle.player2Id
    : battle.player1Id;
  if (opponentId === null || opponentId === undefined) return null;
  const result = await query(
    'SELECT username FROM users WHERE id = $1',
    [opponentId]
  );
  return result.rows[0]?.username ?? null;
}

async function loadParticipantBattleOr404(battleId, userId, options = {}) {
  try {
    return await battleStateRepository.loadBattleForParticipant(
      battleId,
      userId,
      options
    );
  } catch (error) {
    if (error?.code === 'BATTLE_NOT_FOUND') {
      throw new AppError('Battle not found or you do not have access', 404);
    }
    throw error;
  }
}

async function consumeBattleInventoryItem(client, inventoryId, userId) {
  if (inventoryId === null || inventoryId === undefined) return;
  const itemCheck = await client.query(
    `SELECT quantity
     FROM character_items
     WHERE id = $1 AND user_id = $2
     FOR UPDATE`,
    [inventoryId, userId]
  );
  if (itemCheck.rows.length === 0 || itemCheck.rows[0].quantity < 1) {
    throw new AppError('Consumable inventory changed - please retry', 409, {
      code: 'battle_consumable_conflict'
    });
  }
  if (itemCheck.rows[0].quantity > 1) {
    await client.query(
      'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
      [inventoryId]
    );
  } else {
    await client.query(
      'DELETE FROM character_items WHERE id = $1',
      [inventoryId]
    );
  }
}

async function commitBattleActionState(command, {
  userId,
  consumedInventoryId = null,
  bossState = null
} = {}) {
  return withTransaction(async client => {
    const committed = await battleStateRepository.commitBattleState(
      command,
      { client }
    );
    if (committed.idempotent) return committed;

    await consumeBattleInventoryItem(client, consumedInventoryId, userId);
    if (bossState) {
      await bossService.saveBossEncounter(
        { ...bossState, battleId: command.battleId },
        { client }
      );
    }
    return committed;
  });
}

// ============================================================================
// BATTLE END HELPER (for async processing)
// ============================================================================

/**
 * Handle battle end - calculate rewards and update database.
 * Delegates reward calculation and distribution to battleRewardService.
 *
 * @param {number} battleId - Battle ID
 * @param {string} status - 'victory' | 'defeat'
 * @param {Object} state - Final battle state
 * @param {number} userId - User ID who owns the battle
 * @param {Object} battleEndResult - Result from checkBattleEnd() with winningTeamId
 * @returns {Object} Rewards data if victory
 */
async function handleBattleEnd(
  battleId,
  status,
  state,
  userId,
  battleEndResult = null,
  {
    expectedRevision,
    consumedInventoryId = null,
    commandIdentity = `terminal:${battleId}:${expectedRevision}`,
    publish = true
  } = {}
) {
  let rewards = null;
  let committedUpdate = null;
  let committedState = state;
  let committedStateRevision = expectedRevision;
  let presentationEvents = [];

  // For PvP battles, include player IDs and winning team so each player gets
  // their perspective. The persisted lifecycle has one canonical winner.
  const isPvP = (
    state.battleType === 'pvp' || state.battleType === 'pvp_coliseum'
  ) && state.player1Id && state.player2Id;
  const pvpInfo = isPvP && battleEndResult?.winningTeamId ? {
    player1Id: state.player1Id,
    player2Id: state.player2Id,
    winningTeamId: battleEndResult.winningTeamId
  } : null;

  if (isPvP && !battleEndResult?.winningTeamId) {
    throw new AppError('PvP battle ended without a winning team', 409, {
      code: 'battle_winner_missing'
    });
  }

  if (state.battleType === 'pvp_coliseum') {
    const winnerId = battleEndResult.winningTeamId === 1
      ? state.player1Id
      : state.player2Id;
    const loserId = battleEndResult.winningTeamId === 1
      ? state.player2Id
      : state.player1Id;
    const completion = await completeColiseumMatch(
      battleId,
      winnerId,
      loserId,
      'victory',
      false,
      {
        finalState: state,
        expectedRevision,
        consumedInventoryId,
        actingUserId: userId,
        publish
      }
    );
    committedUpdate = completion?.commit?.update ?? null;
    committedState = completion?.commit?.envelope?.state ?? state;
    committedStateRevision =
      completion?.commit?.envelope?.stateRevision ?? expectedRevision;
    presentationEvents = completion?.presentationEvents ?? [];
  } else if (!isPvP && status === 'victory') {
    // Drop rolling occurs before the transaction, but only the reward record
    // returned by the transaction is ever sent to clients. An ambiguous retry
    // therefore replays the stored outcome instead of a newly rolled response.
    const rewardsData = await battleRewardService.computeRewards(state, battleId);
    const completion = await withTransaction(async client => {
      const distributed = await battleRewardService.distributeRewards(
        userId,
        rewardsData,
        battleId,
        { finalState: state, client }
      );
      if (!distributed.idempotent) {
        await consumeBattleInventoryItem(client, consumedInventoryId, userId);
        await bossService.cleanupBossEncounter(battleId, { client });
        const leaderResult = await client.query(
          `SELECT id
           FROM characters
           WHERE user_id = $1 AND party_slot = 1
           LIMIT 1`,
          [userId]
        );
        const partyLeaderId = leaderResult.rows[0]?.id;
        if (!partyLeaderId) {
          throw new Error(
            `Cannot enqueue terminal progression for battle ${battleId}: `
            + `user ${userId} has no party leader`
          );
        }
        await battleTerminalOutbox.enqueue(client, {
          battleId,
          eventType: BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
          payload: buildPveTerminalProgressionPayload({
            battleId,
            partyLeaderId,
            rewardsData,
            isAdvancementBattle:
              distributed.envelope?.isAdvancementBattle ?? false,
            challengerCharacterId:
              distributed.envelope?.challengerCharacterId ?? null
          })
        });
      }
      return distributed;
    });
    committedUpdate = completion.update;
    committedState = completion.envelope?.state ?? state;
    committedStateRevision =
      completion.envelope?.stateRevision ?? expectedRevision;
    rewards = completion.rewards;
  } else {
    const terminalStatus = isPvP ? 'victory' : status;
    const winnerId = isPvP
      ? (battleEndResult.winningTeamId === 1 ? state.player1Id : state.player2Id)
      : null;
    const completion = await withTransaction(async client => {
      const committed = await battleStateRepository.commitBattleState({
        battleId,
        expectedRevision,
        commandType: 'battle_complete',
        idempotencyKey: commandIdentity,
        flatState: state,
        lifecycle: {
          status: terminalStatus,
          winnerId,
          endedAt: new Date().toISOString()
        },
        allowedStatuses: ['active']
      }, { client });
      await battleRewardService.clearAdvancementChallengerStatus(
        client,
        committed.envelope
      );
      if (!committed.idempotent) {
        await consumeBattleInventoryItem(client, consumedInventoryId, userId);
        const participantIds = isPvP
          ? [state.player1Id, state.player2Id]
          : [userId];
        await client.query(
          `UPDATE characters SET in_battle = false
           WHERE user_id = ANY($1::int[]) AND party_slot <= $2`,
          [participantIds, MAX_BATTLE_PARTY_SIZE]
        );
        await bossService.cleanupBossEncounter(battleId, { client });
      }
      return committed;
    });
    committedUpdate = completion.update;
    committedState = completion.envelope?.state ?? state;
    committedStateRevision =
      completion.envelope?.stateRevision ?? expectedRevision;
  }

  // Authoritative deltas and lifecycle events are emitted only after every
  // database side effect above commits.
  if (publish && state.battleType !== 'pvp_coliseum') {
    if (committedUpdate) {
      await battleWebsocket.broadcastStateUpdate(battleId, committedUpdate);
    }
    await battleWebsocket.broadcastBattleEnd(battleId, status, rewards, pvpInfo);
  }

  if (publish) {
    const participants = battleWebsocket.getBattleParticipants(battleId);
    for (const participantId of participants) {
      battleWebsocket.leaveBattle(battleId, participantId);
    }
    cleanupBattleSequences(battleId);
  }

  return {
    rewards,
    state: committedState,
    stateRevision: committedStateRevision,
    committedUpdate,
    pvpInfo,
    presentationEvents
  };
}

/**
 * Consume the revisioned enemy-turn result and complete terminal state through
 * the repository before publishing lifecycle side effects.
 */
async function handleProcessedEnemyTurns(
  battleId,
  enemyTurnResult,
  userId
) {
  let {
    state,
    stateRevision,
    committedUpdate,
    battleStatus,
    battleEndResult
  } = enemyTurnResult;

  if (
    committedUpdate
    && committedUpdate.stateRevision !== stateRevision
  ) {
    throw new TypeError('Enemy turn update revision does not match committed state');
  }

  if (battleStatus !== 'active') {
    const completed = await handleBattleEnd(
      battleId,
      battleStatus,
      state,
      userId,
      battleEndResult,
      {
        expectedRevision: stateRevision,
        commandIdentity:
          `enemy-turn-complete:${battleId}:${stateRevision}:${battleStatus}`
      }
    );
    state = completed.state;
    stateRevision = completed.stateRevision;
    committedUpdate = completed.committedUpdate;
  } else {
    const activeCommit = await battleTurnManager.updateBattleState(
      battleId,
      state,
      stateRevision,
      {
        commandType: 'enemy_turn_settle',
        idempotencyKey: `enemy-turn-settle:${battleId}:${stateRevision}`
      }
    );
    state = activeCommit.envelope.state;
    stateRevision = activeCommit.envelope.stateRevision;
    if (!activeCommit.idempotent) {
      committedUpdate = activeCommit.update;
      await battleWebsocket.broadcastStateUpdate(battleId, committedUpdate);
    } else {
      committedUpdate = null;
    }
    battleTurnManager.notifyPlayerTurn(battleId, state);
  }

  return {
    state,
    stateRevision,
    committedUpdate,
    battleStatus,
    battleEndResult
  };
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
  const { formation, battleStartRequestId } = req.body || {};
  const battleMapCapabilities = readBattleMapCapabilities(req);

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
  const formationValidation = validateFormationPayload(formation, {
    allowedCharacterIds: party.map(character => character.id),
    maxCharacters: MAX_BATTLE_PARTY_SIZE
  });
  if (!formationValidation.success) {
    throw new AppError(formationValidation.error, 400);
  }

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
    const skill = char
      ? battleService.resolveBattleSkill(char.class, row)
      : null;

    if (skill) {
      characterSkills[row.character_id].push(skill);
    }
  }

  // Check if already in battle - if so, return existing battle data for rejoin
  if (party.some(c => c.in_battle)) {
    const battleEnvelope = await battleStateRepository.findActiveBattleForPlayer(
      req.user.userId
    );

    if (battleEnvelope) {
      // Return existing battle for rejoin
      const nodeMetadata = await loadBattleNodeMetadata(battleEnvelope.nodeId);
      const negotiated = negotiateBattleTransport(
        battleEnvelope,
        battleMapCapabilities
      );

      // A restored BattleScene starts its client-side action counter at zero.
      // Treat this response as a new action-sequence session, just like the
      // explicit /rejoin endpoint, so the first action is not rejected as a
      // duplicate of an action submitted before the scene was restored.
      resetActionSequence(battleEnvelope.id, req.user.userId);

      return res.json(createBattleTransportResponse({
        battleId: battleEnvelope.id,
        battleType: battleEnvelope.battleType,
        mapSeed: battleEnvelope.mapSeed,
        mapWidth: battleEnvelope.mapWidth,
        mapHeight: battleEnvelope.mapHeight,
        nodeType: nodeMetadata.nodeType,
        nodeName: nodeMetadata.nodeName,
        state: battleService.withBattleStateVisualIdentities(battleEnvelope.state),
        stateRevision: battleEnvelope.stateRevision,
        rejoined: true
      }, battleEnvelope, battleMapCapabilities, negotiated));
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
    'SELECT node_type, name, difficulty_tier, local_seed FROM world_nodes WHERE id = $1',
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

  let selectedGenerationVersion;
  try {
    selectedGenerationVersion = selectBattleMapGenerationVersion({
      mode: 'pve',
      clientCapabilities: battleMapCapabilities
    });
  } catch (error) {
    throwCapabilityError(error);
  }
  const mapSeed = deriveEncounterTerrainSeed(
    node.local_seed,
    node.node_type,
    selectedGenerationVersion
  );

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
    // BattleMutableStateV1 is canonical JSON. Optional settings must collapse
    // to a real boolean instead of leaking `undefined` into the wire state.
    logAIDecisions: Boolean(
      userSettings?.developer?.enabled
      && userSettings?.developer?.battle?.logAIDecisions
    )
  };

  // Create initial battle state
  const initialState = {
    turn: 1,
    phase: 'active',
    activeUnitIndex: 0,
    activeUnitId: null,
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
  const formationCharacterIds = formationValidation.characterIds;

  // Generate enemies from templates (scaled to formation characters)
  const enemies = await enemyService.generateEncounter(currentNodeId, party, formationCharacterIds);
  initialState.units.push(...enemies);

  // Initialize boss states for any boss enemies
  initialState.bossStates = {};
  for (const enemy of enemies) {
    if (bossService.isBoss(enemy)) {
      // The durable battle ID is attached when the battle row is created.
      const bossState = bossService.initializeBossState(enemy, null);
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

  let generatedBattle;
  try {
    generatedBattle = await generateBattleMap({
      terrainSeed: mapSeed,
      nodeType: node.node_type,
      mode: 'pve',
      playerCount: initialState.units.filter(unit => unit.type === 'player').length,
      enemyCount: enemies.length,
      enemyCapacity: Math.max(1, enemies.length),
      enemyStrategy: 'formation',
      existingUnits: [],
      initialMutableState: initialState,
      allowV2: selectedGenerationVersion === CURRENT_BATTLE_MAP_VERSION,
      clientCapabilities: battleMapCapabilities
    });
  } catch (error) {
    throwCapabilityError(error);
  }

  const creationIdempotencyKey = createBattleCreationKey(
    battleStartRequestId,
    req.user.userId,
    currentNodeId
  );
  const creation = await withTransaction(async client => {
    // Serialize battle creation for a party. This closes the race where two
    // concurrent start requests both observed in_battle=false.
    await client.query(
      `SELECT id
       FROM characters
       WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL
       ORDER BY id
       FOR UPDATE`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );

    const concurrentlyCreated = await battleStateRepository.findActiveBattleForPlayer(
      req.user.userId,
      { client }
    );
    if (concurrentlyCreated) {
      return {
        created: false,
        idempotent: true,
        raced: true,
        envelope: concurrentlyCreated
      };
    }

    const result = await battleStateRepository.createBattle({
      battleType: 'pve',
      status: 'active',
      nodeId: currentNodeId,
      player1Id: req.user.userId,
      creationIdempotencyKey,
      finalMap: generatedBattle.finalMap,
      legacyFlatState: generatedBattle.legacyFlatState,
      initialMutableState: generatedBattle.mutableState
    }, { client });

    await client.query(
      `UPDATE characters SET in_battle = true
       WHERE user_id = $1 AND party_slot <= $2 AND party_slot IS NOT NULL`,
      [req.user.userId, MAX_BATTLE_PARTY_SIZE]
    );
    if (result.created) {
      for (const bossState of Object.values(generatedBattle.mutableState.bossStates ?? {})) {
        await bossService.saveBossEncounter(
          { ...bossState, battleId: result.battleId },
          { client }
        );
      }
    }
    return result;
  });

  const battleEnvelope = creation.envelope;
  const battleId = battleEnvelope.id;
  const stateRevision = battleEnvelope.stateRevision;
  const battleState = battleService.withBattleStateVisualIdentities(
    battleEnvelope.state
  );
  const responseNode = battleEnvelope.nodeId === currentNodeId
    ? { nodeType: node.node_type, nodeName: node.name }
    : await loadBattleNodeMetadata(battleEnvelope.nodeId);

  // Join battle WebSocket room
  battleWebsocket.joinBattle(battleId, req.user.userId);

  // Check if the first actor is an enemy - if so, process their turns asynchronously
  const firstActor = battleState.units.find(u => u.id === battleState.activeUnitId);
  if (creation.created && firstActor && firstActor.type === 'enemy') {
    // Async enemy turn processing - starts after response is sent via WebSocket
    setImmediate(async () => {
      try {
        const enemyTurnResult = await battleTurnManager.processEnemyTurnsAsync(
          battleId,
          battleState,
          aiService,
          battleService,
          stateRevision
        );
        await handleProcessedEnemyTurns(
          battleId,
          enemyTurnResult,
          req.user.userId
        );
      } catch (error) {
        console.error('Initial enemy turn processing error:', error);
      }
    });
  }

  // Get available actions for the first player unit (if their turn)
  const firstPlayerUnit = battleState.units.find(
    u => u.id === battleState.activeUnitId && u.type === 'player'
  );
  const availableActions = firstPlayerUnit
    ? battleService.getAvailableActions(firstPlayerUnit, battleState)
    : null;

  res.status(creation.created ? 201 : 200).json(createBattleTransportResponse({
    battleId,
    battleType: battleEnvelope.battleType,
    mapSeed: battleEnvelope.mapSeed,
    mapWidth: battleEnvelope.mapWidth,
    mapHeight: battleEnvelope.mapHeight,
    nodeType: responseNode.nodeType,
    nodeName: responseNode.nodeName,
    state: battleState,
    stateRevision,
    availableActions,
    rejoined: !creation.created
  }, battleEnvelope, battleMapCapabilities));
}));

// GET /api/battle/current - Get current battle state
router.get('/current', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const battleEnvelope = await battleStateRepository.findActiveBattleForPlayer(
    req.user.userId
  );
  if (!battleEnvelope) {
    throw new AppError('No active battle', 404);
  }

  const nodeMetadata = await loadBattleNodeMetadata(battleEnvelope.nodeId);
  const battleMapCapabilities = readBattleMapCapabilities(req);
  const negotiated = negotiateBattleTransport(
    battleEnvelope,
    battleMapCapabilities
  );
  const state = battleService.withBattleStateVisualIdentities(battleEnvelope.state);
  const battleId = battleEnvelope.id;

  // /current is the full-page refresh/login recovery path. The frontend
  // creates a fresh BattleWebSocketManager for the returned battle and its
  // action counter starts at zero, so the matching server counter must start a
  // new session as well. Socket-only reconnects use /:battleId/rejoin below.
  resetActionSequence(battleId, req.user.userId);

  // Detect PvP battles and get opponent username
  const isPvP = battleEnvelope.battleType === 'pvp'
    || battleEnvelope.battleType === 'pvp_coliseum';
  let opponentUsername = null;

  if (isPvP) {
    opponentUsername = await loadOpponentUsername(
      battleEnvelope,
      req.user.userId
    );
  }

  // Join battle WebSocket room for updates
  battleWebsocket.joinBattle(battleId, req.user.userId);

  // For PvP battles, restart turn timer if it's this player's turn
  // This handles the case where a player refreshes during their turn
  const activeUnit = state.units?.find(u => u.id === state.activeUnitId);
  if (isPvP && activeUnit && activeUnit.type === 'player' && activeUnit.ownerId === req.user.userId) {
    // Import coliseumService to restart turn timer with grace period
    const { startTurnTimer } = await import('../services/coliseumService.js');
    // Give player a grace period (5 seconds) to orient themselves after reconnection
    setTimeout(() => {
      startTurnTimer(battleId, req.user.userId, false);
    }, 5000);
    console.log(`[Battle] PvP turn timer will restart in 5s for player ${req.user.userId} (reconnection via /current)`);
  }

  // Check if it's an enemy's turn - if so, resume enemy turn processing
  if (activeUnit && activeUnit.type === 'enemy' && activeUnit.hp > 0) {
    console.log('[Battle] Resuming enemy turn processing for battle', battleId, '- active unit:', activeUnit.name);
    setImmediate(async () => {
      try {
        const enemyTurnResult = await battleTurnManager.processEnemyTurnsAsync(
          battleId,
          state,
          aiService,
          battleService,
          battleEnvelope.stateRevision
        );
        await handleProcessedEnemyTurns(
          battleId,
          enemyTurnResult,
          req.user.userId
        );
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

  res.json(createBattleTransportResponse({
    battleId: battleId,
    battleType: battleEnvelope.battleType,
    mapSeed: battleEnvelope.mapSeed,
    mapWidth: battleEnvelope.mapWidth,
    mapHeight: battleEnvelope.mapHeight,
    nodeType: isPvP ? 'arena' : nodeMetadata.nodeType,
    nodeName: nodeMetadata.nodeName,
    state: state,
    stateRevision: battleEnvelope.stateRevision,
    availableActions,
    // PvP-specific fields for reconnection
    isPvP,
    opponentUsername
  }, battleEnvelope, battleMapCapabilities, negotiated));
}));

// GET /api/battle/:battleId/rejoin - Rejoin an active battle after disconnect
router.get('/:battleId/rejoin', authenticate, rejoinLimiter, asyncHandler(async (req, res) => {
  const { battleId } = req.params;
  const battleReconnection = await import('../services/battleReconnection.js');

  const battleEnvelope = await loadParticipantBattleOr404(
    battleId,
    req.user.userId,
    {
      requireActive: true
    }
  );
  const nodeMetadata = await loadBattleNodeMetadata(battleEnvelope.nodeId);
  const battleMapCapabilities = readBattleMapCapabilities(req);
  const negotiated = negotiateBattleTransport(
    battleEnvelope,
    battleMapCapabilities
  );

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

  // Reset action sequence tracking for this user on reconnection
  // This allows the client to start fresh with sequence numbers
  resetActionSequence(parseInt(battleId), req.user.userId);

  // Get disconnected players info
  const disconnectedPlayers = battleReconnection.getDisconnectedPlayers(parseInt(battleId));

  // Get available actions for active player unit
  const battleState = battleService.withBattleStateVisualIdentities(battleEnvelope.state);
  const activePlayerUnit = battleState.units?.find(u => u.id === battleState.activeUnitId && u.type === 'player');
  const availableActions = activePlayerUnit
    ? battleService.getAvailableActions(activePlayerUnit, battleState)
    : null;

  res.json(createBattleTransportResponse({
    success: true,
    battleId: battleEnvelope.id,
    battleType: battleEnvelope.battleType,
    mapSeed: battleEnvelope.mapSeed,
    mapWidth: battleEnvelope.mapWidth,
    mapHeight: battleEnvelope.mapHeight,
    nodeType: (
      battleEnvelope.battleType === 'pvp'
      || battleEnvelope.battleType === 'pvp_coliseum'
    ) ? 'arena' : nodeMetadata.nodeType,
    nodeName: nodeMetadata.nodeName,
    state: battleState,
    stateRevision: battleEnvelope.stateRevision,
    gracePeriod: reconnectResult?.gracePeriod || 0,
    disconnectedPlayers,
    availableActions
  }, battleEnvelope, battleMapCapabilities, negotiated));
}));

// POST /api/battle/action - Submit battle action
router.post('/action', authenticate, actionLimiter, asyncHandler(async (req, res) => {
  const { battleId, actionType, unitId, targetTile, skillId, actionSequence } = req.body;

  if (battleId === undefined || battleId === null || battleId === '') {
    throw new AppError('Battle ID is required', 400, {
      code: 'battle_id_required'
    });
  }

  // Validate action sequence — reject stale or duplicate submissions
  const sequenceValidation = validateActionSequence(battleId, req.user.userId, actionSequence);
  if (!sequenceValidation.valid) {
    throw new AppError('Battle state has changed - please retry', 409);
  }

  const battle = await loadParticipantBattleOr404(
    battleId,
    req.user.userId,
    { requireActive: true }
  );
  let state = structuredClone(
    battleService.withBattleStateVisualIdentities(battle.state)
  );

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

  // Capture old position BEFORE processAction modifies the unit (for movement broadcast)
  const oldPosition = { x: activeUnit.tileX, y: activeUnit.tileY };

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

  let phaseTransitionNotification = null;
  let changedBossState = null;

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
        changedBossState = state.bossStates[targetBoss.id];
        phaseTransitionNotification = {
          bossId: targetBoss.id,
          bossName: targetBoss.name,
          ...phaseTransition
        };
      }
    }
  }

  // Check if battle ended from player action
  const battleEndResult = battleService.checkBattleEnd(state);
  const battleStatus = battleService.getBattleStatusString(battleEndResult);

  // Track if turn continues (two-action system: move + act)
  const turnContinues = !result.turnEnded && battleStatus === 'active';

  let committedPlayerState = null;
  let committedRevision = null;
  let completion = null;

  if (battleStatus === 'active') {
    if (result.turnEnded) {
      battleService.advanceToNextActorWithCT(state);
    }
    state.turnPredictions = battleService.predictTurnOrder(state, 10);

    const actionCommit = await commitBattleActionState({
      battleId,
      expectedRevision: battle.stateRevision,
      commandType: result.turnEnded ? 'player_turn_advance' : 'player_action',
      idempotencyKey:
        `${result.turnEnded ? 'player-turn' : 'player-action'}:`
        + `${battleId}:${battle.stateRevision}:${req.user.userId}:${actionSequence}`,
      flatState: state,
      lifecycle: { status: 'active' },
      allowedStatuses: ['active']
    }, {
      userId: req.user.userId,
      consumedInventoryId: result.consumedInventoryId,
      bossState: changedBossState
    });
    if (actionCommit.idempotent) {
      throw new AppError('Battle state has changed - please retry', 409);
    }
    state = structuredClone(actionCommit.envelope.state);
    committedPlayerState = state;
    committedRevision = actionCommit.envelope.stateRevision;

    // Timers and all presentation events observe only the committed successor.
    cancelTurnTimer(battleId);
    await battleWebsocket.broadcastStateUpdate(battleId, actionCommit.update);
  } else {
    state.turnPredictions = battleService.predictTurnOrder(state, 10);
    completion = await handleBattleEnd(
      battleId,
      battleStatus,
      state,
      req.user.userId,
      battleEndResult,
      {
        expectedRevision: battle.stateRevision,
        consumedInventoryId: result.consumedInventoryId,
        commandIdentity:
          `player-complete:${battleId}:${battle.stateRevision}:`
          + `${req.user.userId}:${actionSequence}`,
        publish: false
      }
    );
    state = structuredClone(completion.state);
    result.rewards = completion.rewards;
    cancelTurnTimer(battleId);
    if (completion.committedUpdate) {
      await battleWebsocket.broadcastStateUpdate(
        battleId,
        completion.committedUpdate
      );
    }
  }

  if (phaseTransitionNotification) {
    await battleWebsocket.broadcastPhaseTransition(
      battleId,
      phaseTransitionNotification
    );
  }

  // Animation events follow the authoritative revision so rollback never
  // publishes an action that did not happen.
  if (actionType === 'move' && result.moved) {
    const newPosition = { x: activeUnit.tileX, y: activeUnit.tileY };
    await battleWebsocket.broadcastUnitMoved(
      battleId,
      unitId,
      oldPosition,
      newPosition,
      req.user.userId
    );
  }
  await battleWebsocket.broadcastActionExecuted(
    battleId,
    unitId,
    actionType,
    result,
    req.user.userId
  );

  if (completion) {
    await battleWebsocket.broadcastBattleEnd(
      battleId,
      battleStatus,
      completion.rewards,
      completion.pvpInfo
    );
    await publishColiseumMatchResultEvents(completion.presentationEvents);
    const participants = battleWebsocket.getBattleParticipants(battleId);
    for (const participantId of participants) {
      await battleWebsocket.leaveBattle(battleId, participantId);
    }
    cleanupBattleSequences(battleId);
  } else if (result.turnEnded) {
    // Process enemy turns asynchronously from the exact committed revision.
    setImmediate(async () => {
      try {
        const enemyTurnResult = await battleTurnManager.processEnemyTurnsAsync(
          battleId,
          committedPlayerState,
          aiService,
          battleService,
          committedRevision
        );
        await handleProcessedEnemyTurns(
          battleId,
          enemyTurnResult,
          req.user.userId
        );
      } catch (error) {
        console.error('Async enemy turn processing error:', error);
      }
    });
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

  const battle = await loadParticipantBattleOr404(
    battleId,
    req.user.userId
  );
  if (battle.status !== 'victory') {
    throw new AppError('Battle not found or not a victory', 404);
  }

  res.json({ rewards: battle.rewards });
}));

// GET /api/battle/:id/state - Lightweight battle state for defensive polling
router.get('/:id/state', authenticate, stateLimiter, asyncHandler(async (req, res) => {
  const battleId = parseInt(req.params.id, 10);

  if (isNaN(battleId)) {
    throw new AppError('Invalid battle ID', 400);
  }

  const battle = await loadParticipantBattleOr404(
    battleId,
    req.user.userId
  );
  const battleState = battle.state;

  const storedStatus = battle.status || 'active';
  const isHeadToHead = battle.battleType === 'pvp' ||
    battle.battleType === 'pvp_coliseum' ||
    battleState.battleType === 'pvp';
  const participantStatus = getParticipantBattleStatus({
    status: storedStatus,
    userId: req.user.userId,
    player1Id: battle.player1Id,
    player2Id: battle.player2Id,
    winnerId: battle.winnerId,
    isHeadToHead
  });

  // Build lightweight state for polling
  // Note: Battle units use tileX/tileY for position (not x/y)
  // CRITICAL: Ensure positions are always valid numbers to prevent client NaN issues
  const state = {
    activeUnitId: battleState.activeUnitId || null,
    turnCount: battleState.turn || 0,
    status: participantStatus,
    rewards: participantStatus === 'victory' ? (battle.rewards || null) : null,
    units: (battleState.units || []).map(u => ({
      id: u.id,
      x: u.tileX ?? 0,
      y: u.tileY ?? 0,
      hp: u.hp ?? 0,
      mp: u.mp ?? 0,
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
  const { characterId, abilityKey, targetUnitId, actionSequence = 0 } = req.body;

  if (!characterId || !abilityKey) {
    throw new AppError('characterId and abilityKey are required', 400);
  }

  const battle = await loadParticipantBattleOr404(
    battleId,
    req.user.userId,
    { requireActive: true }
  );
  const state = structuredClone(
    battleService.withBattleStateVisualIdentities(battle.state)
  );

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

  const committed = await battleStateRepository.commitBattleState({
    battleId,
    expectedRevision: battle.stateRevision,
    commandType: 'zodiac_ability',
    idempotencyKey:
      `zodiac:${battleId}:${req.user.userId}:${characterId}:${abilityKey}:${actionSequence}`,
    flatState: state,
    allowedStatuses: ['active']
  });
  if (committed.idempotent) {
    throw new AppError('Battle state has changed - please retry', 409);
  }
  const committedState = committed.envelope.state;
  await battleWebsocket.broadcastStateUpdate(battleId, committed.update);

  // Broadcast the ability use via WebSocket
  await battleWebsocket.broadcastActionExecuted(battleId, sourceUnit.id, 'zodiac_ability', {
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
    state: committedState,
    stateRevision: committed.envelope.stateRevision
  });
}));

/**
 * GET /api/battle/:battleId/zodiac-abilities
 * Get available zodiac abilities for a character in battle
 */
router.get('/:battleId/zodiac-abilities/:characterId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const battleId = parseInt(req.params.battleId, 10);
  const characterId = parseInt(req.params.characterId, 10);

  const battle = await loadParticipantBattleOr404(
    battleId,
    req.user.userId,
    { requireActive: true }
  );
  const state = battle.state;

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
