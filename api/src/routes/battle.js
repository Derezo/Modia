import express from 'express';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { actionLimiter, startLimiter, readLimiter, rejoinLimiter, rewardsLimiter, stateLimiter } from '../middleware/battleRateLimiter.js';
import {
  BATTLE_NODE_TYPES,
  MAX_BATTLE_PARTY_SIZE,
  MAX_PARTY_SIZE
} from '../config/constants.js';
import * as battleService from '../services/battleService.js';
import * as battleRewardService from '../services/battleRewardService.js';
import * as aiService from '../services/aiService.js';
import * as enemyService from '../services/enemyService.js';
import battleWebsocket from '../services/battleWebsocket.js';
import { createPlayerBattleUnit } from '../services/battleUnitFactory.js';
import { validateFormationPayload } from '../services/battle/formationValidation.js';
import { getParticipantAvailableActions } from
  '../services/battle/participantActionAvailability.js';
import { createPlayerHandoffCoordinator } from
  '../services/battle/playerHandoffCoordinator.js';
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
import {
  BattleStateConflictError,
  BattleStateIdempotencyError,
  battleStateRepository
} from '../services/battle/BattleStateRepository.js';
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
import { battleMapV2ToFlatState } from '../../../shared/index.js';
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
const BATTLE_ACTION_COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PLAYER_ACTION_COMMAND_TYPE = 'player_action';
const PLAYER_ACTION_TYPES = new Set(['move', 'attack', 'skill', 'item', 'wait']);
const { notifyPlayerTurnIfCurrent } = createPlayerHandoffCoordinator({
  loadBattle: battleId => battleStateRepository.loadBattle(battleId),
  notifyPlayerTurn: (...args) => battleTurnManager.notifyPlayerTurn(...args)
});

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

function createBattleActionCommand({
  battleId,
  userId,
  commandId,
  actionType,
  unitId,
  targetTile,
  skillId,
  inventoryId,
  stateRevision
}) {
  if (commandId !== undefined && commandId !== null) {
    if (typeof commandId !== 'string'
      || !BATTLE_ACTION_COMMAND_ID_PATTERN.test(commandId)) {
      throw new AppError(
        'commandId must be 1-128 URL-safe characters',
        400,
        { code: 'battle_command_id_invalid' }
      );
    }
  }
  if (stateRevision !== undefined && stateRevision !== null
    && (!Number.isSafeInteger(stateRevision) || stateRevision < 0)) {
    throw new AppError(
      'stateRevision must be a nonnegative safe integer',
      400,
      { code: 'battle_state_revision_invalid' }
    );
  }

  // actionSequence is reset when a client rejoins and therefore cannot name a
  // durable receipt. Only an explicit commandId is replayable; legacy requests
  // receive a fresh one-shot identity for each submission.
  const identity = commandId !== undefined && commandId !== null
    ? `command:${commandId}`
    : `legacy:${randomUUID()}`;

  return {
    commandId: commandId ?? null,
    commandType: PLAYER_ACTION_COMMAND_TYPE,
    idempotencyKey: `player:${userId}:${identity}`,
    idempotencyRequest: {
      battleId: String(battleId),
      userId: String(userId),
      actionType: actionType ?? null,
      unitId: unitId ?? null,
      targetTile: targetTile ?? null,
      skillId: skillId ?? null,
      inventoryId: inventoryId ?? null,
      stateRevision: stateRevision ?? null
    }
  };
}

function createBattleActionRecovery(battle, userId) {
  const state = battleService.withBattleStateVisualIdentities(battle.state);
  return {
    state,
    availableActions: getParticipantAvailableActions(battle, state, userId),
    stateRevision: battle.stateRevision
  };
}

async function materializeBattleActionReceipt(receipt, battle) {
  const state = battle.battleMapSchemaVersion === 2
    ? await battleMapV2ToFlatState(battle.map, receipt.mutableState)
    : { ...receipt.mutableState, ...battle.map };
  return battleService.withBattleStateVisualIdentities(state);
}

async function sendBattleActionReplay(res, receipt, battle, commandId, userId) {
  const replayMetadata = receipt.replayMetadata;
  if (!replayMetadata) {
    throw new AppError('Battle command result cannot be replayed', 409, {
      code: 'battle_command_replay_unavailable',
      ...createBattleActionRecovery(battle, userId)
    });
  }
  return res.json({
    state: await materializeBattleActionReceipt(receipt, battle),
    actionResult: replayMetadata.actionResult,
    battleStatus: replayMetadata.battleStatus,
    turnContinues: replayMetadata.turnContinues,
    availableActions: replayMetadata.availableActions,
    stateRevision: receipt.stateRevision,
    commandId
  });
}

async function throwBattleActionCommitError(error, battleId, userId) {
  const idempotencyConflict = error instanceof BattleStateIdempotencyError
    || error?.code === 'BATTLE_IDEMPOTENCY_CONFLICT';
  const stateConflict = error instanceof BattleStateConflictError
    || error?.code === 'BATTLE_STATE_CONFLICT';
  if (!idempotencyConflict && !stateConflict) {
    throw error;
  }
  const battle = await loadParticipantBattleOr404(battleId, userId);
  throw new AppError(
    idempotencyConflict
      ? 'commandId was already used for a different action'
      : 'Battle state has changed - please retry',
    409,
    {
      code: idempotencyConflict
        ? 'battle_command_id_conflict'
        : 'battle_state_conflict',
      ...createBattleActionRecovery(battle, userId)
    }
  );
}

function requireCompatibleBattleMap(negotiation) {
  if (negotiation.compatible) return;
  throw new AppError('This battle map requires a newer client', 426, {
    ...createBattleMapUpgradeRequiredPayload(negotiation)
  });
}

async function loadPveBattleParty(queryFn, userId) {
  return queryFn(
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
    [userId, MAX_PARTY_SIZE]
  );
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
    commandType = 'battle_complete',
    idempotencyRequest,
    replayMetadata,
    publish = true
  } = {}
) {
  let rewards = null;
  let committedUpdate = null;
  let committedState = state;
  let committedStateRevision = expectedRevision;
  let presentationEvents = [];
  let commandReceipt = null;

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
        battleCommand: idempotencyRequest === undefined ? null : {
          commandType,
          idempotencyKey: commandIdentity,
          idempotencyRequest,
          replayMetadata
        },
        publish
      }
    );
    commandReceipt = completion?.commit ?? null;
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
    const terminalReplayMetadata = replayMetadata === undefined ? undefined : {
      ...replayMetadata,
      actionResult: {
        ...replayMetadata.actionResult,
        rewards: {
          gold: rewardsData.gold,
          experience: rewardsData.experience,
          items: rewardsData.items
        }
      }
    };
    const completion = await withTransaction(async client => {
      const distributed = await battleRewardService.distributeRewards(
        userId,
        rewardsData,
        battleId,
        {
          finalState: state,
          client,
          battleCommand: idempotencyRequest === undefined ? null : {
            commandType,
            idempotencyKey: commandIdentity,
            idempotencyRequest,
            replayMetadata: terminalReplayMetadata
          }
        }
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
    commandReceipt = completion.commandReceipt ?? null;
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
        commandType,
        idempotencyKey: commandIdentity,
        idempotencyRequest,
        replayMetadata,
        flatState: state,
        lifecycle: {
          status: terminalStatus,
          winnerId,
          endedAt: new Date().toISOString()
        },
        allowedStatuses: ['active']
      }, { client });
      if (!committed.idempotent) {
        await battleRewardService.clearAdvancementChallengerStatus(
          client,
          committed.envelope
        );
        await consumeBattleInventoryItem(client, consumedInventoryId, userId);
        if (isPvP) {
          await client.query(
            `UPDATE characters SET in_battle = false
             WHERE user_id = ANY($1::int[]) AND party_slot <= $2`,
            [[state.player1Id, state.player2Id], MAX_BATTLE_PARTY_SIZE]
          );
        } else {
          const playerCharacterIds = [...new Set(
            (state.units ?? [])
              .filter(unit => unit.type === 'player')
              .map(unit => Number(unit.characterId ?? unit.id))
              .filter(characterId => Number.isSafeInteger(characterId) && characterId > 0)
          )];
          if (playerCharacterIds.length > 0) {
            await client.query(
              `UPDATE characters SET in_battle = false
               WHERE user_id = $1 AND id = ANY($2::int[])`,
              [userId, playerCharacterIds]
            );
          }
        }
        await bossService.cleanupBossEncounter(battleId, { client });
      }
      return committed;
    });
    commandReceipt = completion;
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
    stateRevision: commandReceipt?.stateRevision ?? committedStateRevision,
    committedUpdate,
    pvpInfo,
    presentationEvents,
    idempotent: commandReceipt?.idempotent ?? false,
    mutableState: commandReceipt?.mutableState,
    baseStateRevision: commandReceipt?.baseStateRevision,
    replayMetadata: commandReceipt?.replayMetadata
  };
}

/**
 * Ensure a replayed or freshly committed turn-ending action cannot strand its
 * authoritative successor. Partial-turn and terminal receipts intentionally
 * have no successor work.
 */
async function ensureCurrentSuccessorProgress(battleId, receipt, userId) {
  const replayMetadata = receipt?.replayMetadata;
  if (replayMetadata?.battleStatus !== 'active' ||
    replayMetadata.turnContinues !== false) {
    return { ensured: false, reason: 'no_active_successor' };
  }

  const expectedState = receipt.envelope?.state ?? receipt.mutableState;
  if (!expectedState || !Number.isSafeInteger(receipt.stateRevision)) {
    return { ensured: false, reason: 'receipt_state_unavailable' };
  }

  const authoritativeBattle = await battleStateRepository.loadBattle(battleId);
  if (authoritativeBattle.status !== 'active' ||
    authoritativeBattle.stateRevision !== receipt.stateRevision ||
    String(authoritativeBattle.state.activeUnitId) !==
      String(expectedState.activeUnitId)) {
    return { ensured: false, reason: 'receipt_superseded' };
  }

  const successor = authoritativeBattle.state.units?.find(
    unit => unit.id === authoritativeBattle.state.activeUnitId
  );
  if (successor?.type === 'player') {
    const notification = await notifyPlayerTurnIfCurrent(
      battleId,
      expectedState,
      receipt.stateRevision
    );
    return {
      ensured: notification.notified,
      reason: notification.notified ? 'player_notified' : 'receipt_superseded'
    };
  }

  // Enemy and unknown successors both enter the authoritative turn loop. The
  // manager reloads once more when this callback runs and deduplicates jobs by
  // battle ID, covering concurrent fresh/replay triggers.
  setImmediate(async () => {
    try {
      const enemyTurnResult = await battleTurnManager.processEnemyTurnsAsync(
        battleId,
        authoritativeBattle.state,
        aiService,
        battleService,
        authoritativeBattle.stateRevision
      );
      await handleProcessedEnemyTurns(
        battleId,
        enemyTurnResult,
        userId
      );
    } catch (error) {
      console.error('Async enemy turn processing error:', error);
    }
  });
  return { ensured: true, reason: 'enemy_processing_scheduled' };
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
  if (enemyTurnResult?.skipped) {
    return enemyTurnResult;
  }

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
    // The final enemy advance is already the committed, broadcast player-ready
    // state. A second identical "settle" commit created an actionable window in
    // which a fast player action could advance the revision and make this
    // handoff fail. Re-read only to ensure we do not publish a stale turn notice.
    const handoff = await notifyPlayerTurnIfCurrent(
      battleId,
      state,
      stateRevision
    );
    state = handoff.state;
    stateRevision = handoff.stateRevision;
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
  // Get required formation from request
  const { formation, battleStartRequestId } = req.body || {};
  const battleMapCapabilities = readBattleMapCapabilities(req);

  // Get user's battle party with equipment stat bonuses
  const partyResult = await loadPveBattleParty(query, req.user.userId);

  if (partyResult.rows.length === 0) {
    throw new AppError('No battle party set', 400);
  }

  const party = partyResult.rows;
  const formationValidation = validateFormationPayload(formation, {
    allowedCharacterIds: party.map(character => character.id),
    maxCharacters: MAX_BATTLE_PARTY_SIZE,
    required: true
  });
  if (!formationValidation.success) {
    throw new AppError(formationValidation.error, 400);
  }

  const selectedCharacterIds = formationValidation.characterIds;

  // Check if already in battle - if so, return existing battle data for rejoin
  if (party.some(c => c.in_battle)) {
    const battleEnvelope = await battleStateRepository.findActiveBattleForPlayer(
      req.user.userId
    );

    if (battleEnvelope) {
      // Return existing battle for rejoin
      const nodeMetadata = await loadBattleNodeMetadata(battleEnvelope.nodeId);
      const battleState = battleService.withBattleStateVisualIdentities(
        battleEnvelope.state
      );
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
        state: battleState,
        stateRevision: battleEnvelope.stateRevision,
        availableActions: getParticipantAvailableActions(
          battleEnvelope,
          battleState,
          req.user.userId
        ),
        rejoined: true
      }, battleEnvelope, battleMapCapabilities, negotiated));
    }

    // A stale in_battle flag is repaired only after the lifecycle lock and a
    // second active-battle check inside the creation transaction below.
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
  const creation = await withTransaction(async client => {
    // Character deletion and Coliseum lifecycle writes use the same user-wide,
    // deterministic lock order. Lock every owned row before trusting the
    // selected formation or materializing any persisted player snapshot.
    const lockedCharacters = await client.query(
      `SELECT id, in_battle
       FROM characters
       WHERE user_id = $1
       ORDER BY id
       FOR UPDATE`,
      [req.user.userId]
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
    if (lockedCharacters.rows.some(character => character.in_battle)) {
      await client.query(
        `UPDATE characters
         SET in_battle = false
         WHERE user_id = $1 AND in_battle = true`,
        [req.user.userId]
      );
    }

    const authoritativePartyResult = await loadPveBattleParty(
      client.query.bind(client),
      req.user.userId
    );
    const authoritativeParty = authoritativePartyResult.rows;
    const authoritativeFormation = validateFormationPayload(formation, {
      allowedCharacterIds: authoritativeParty.map(character => character.id),
      maxCharacters: MAX_BATTLE_PARTY_SIZE,
      required: true
    });
    if (
      !authoritativeFormation.success
      || authoritativeFormation.characterIds.length !== selectedCharacterIds.length
      || authoritativeFormation.characterIds.some(
        characterId => !selectedCharacterIds.includes(characterId)
      )
    ) {
      throw new AppError('Selected formation changed - please retry', 409);
    }

    const authoritativeCharacterIds = authoritativeFormation.characterIds;
    const authoritativeCharacterIdSet = new Set(authoritativeCharacterIds);
    const selectedParty = authoritativeParty.filter(
      character => authoritativeCharacterIdSet.has(character.id)
    );
    if (selectedParty.length !== authoritativeCharacterIds.length) {
      throw new AppError('Selected formation changed - please retry', 409);
    }
    if (selectedParty.some(character => character.in_battle)) {
      throw new AppError('Selected characters are no longer available', 409);
    }
    if (selectedParty.some(character => character.hp_current <= 0)) {
      throw new AppError('Cannot battle with incapacitated characters', 400);
    }

    const currentNodeId = selectedParty[0].current_node_id;
    if (selectedParty.some(character => character.current_node_id !== currentNodeId)) {
      throw new AppError('Selected characters must be at the same location', 400);
    }
    const nodeResult = await client.query(
      'SELECT node_type, name, difficulty_tier, local_seed FROM world_nodes WHERE id = $1',
      [currentNodeId]
    );
    if (nodeResult.rows.length === 0) {
      throw new AppError('Current location not found', 400);
    }
    const node = nodeResult.rows[0];
    if (!BATTLE_NODE_TYPES.includes(node.node_type)) {
      throw new AppError('Cannot battle at this location', 400);
    }

    const skillsResult = await client.query(
      `SELECT character_id, skill_id, level
       FROM character_skills
       WHERE character_id = ANY($1::int[])`,
      [authoritativeCharacterIds]
    );
    const characterSkills = {};
    for (const row of skillsResult.rows) {
      if (!characterSkills[row.character_id]) {
        characterSkills[row.character_id] = [];
      }
      const character = selectedParty.find(candidate => candidate.id === row.character_id);
      const skill = character
        ? battleService.resolveBattleSkill(character.class, row)
        : null;
      if (skill) {
        characterSkills[row.character_id].push(skill);
      }
    }

    // These character-dependent reads happen only after the owned-character
    // locks. A concurrent deletion either commits first and fails formation
    // revalidation above, or waits until this battle snapshot is committed.
    const characterTraits = await traitService.loadCharacterTraits(
      authoritativeCharacterIds,
      { client }
    );
    const zodiacAbilities = await zodiacAbilityService.loadActiveZodiacAbilities(
      req.user.userId,
      { client }
    );
    const settingsResult = await client.query(
      'SELECT settings FROM user_settings WHERE user_id = $1',
      [req.user.userId]
    );
    const userSettings = settingsResult.rows[0]?.settings || {};
    const debugOptions = {
      logAIDecisions: Boolean(
        userSettings?.developer?.enabled
        && userSettings?.developer?.battle?.logAIDecisions
      )
    };

    const initialState = {
      turn: 1,
      phase: 'active',
      activeUnitIndex: 0,
      activeUnitId: null,
      debugOptions,
      units: selectedParty.map((character, index) => {
        const formationPosition = formation[character.id];
        const defaultX = 1 + (index % 3);
        const defaultY = 13 + Math.floor(index / 3) * 2;
        return createPlayerBattleUnit(
          {
            ...character,
            user_id: req.user.userId,
            equip_hp: parseInt(character.equip_hp, 10) || 0,
            equip_mp: parseInt(character.equip_mp, 10) || 0,
            equip_strength: parseInt(character.equip_strength, 10) || 0,
            equip_intelligence: parseInt(character.equip_intelligence, 10) || 0,
            equip_agility: parseInt(character.equip_agility, 10) || 0,
            equip_vitality: parseInt(character.equip_vitality, 10) || 0,
            equip_luck: parseInt(character.equip_luck, 10) || 0,
            equip_attack: parseInt(character.equip_attack, 10) || 0,
            equip_defense: parseInt(character.equip_defense, 10) || 0,
            equip_magic_attack: parseInt(character.equip_magic_attack, 10) || 0,
            equip_magic_defense: parseInt(character.equip_magic_defense, 10) || 0
          },
          {
            tileX: formationPosition.tileX,
            tileY: formationPosition.tileY + 12
          },
          characterSkills[character.id] || [],
          {
            defaultX,
            defaultY,
            traits: characterTraits[character.id] || [],
            zodiacAbilities
          }
        );
      })
    };

    const consumablesResult = await client.query(
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

    const enemies = await enemyService.generateEncounter(
      currentNodeId,
      selectedParty,
      authoritativeCharacterIds,
      { client }
    );
    initialState.units.push(...enemies);
    initialState.bossStates = {};
    for (const enemy of enemies) {
      if (bossService.isBoss(enemy)) {
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

    battleService.initializeCT(initialState.units);
    battleService.advanceToNextActor(initialState);
    initialState.turnPredictions = battleService.predictTurnOrder(initialState, 10);

    const mapSeed = deriveEncounterTerrainSeed(
      node.local_seed,
      node.node_type,
      selectedGenerationVersion
    );
    let generatedBattle;
    try {
      generatedBattle = await generateBattleMap({
        terrainSeed: mapSeed,
        nodeType: node.node_type,
        mode: 'pve',
        playerCount: selectedParty.length,
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

    const updateResult = await client.query(
      `UPDATE characters SET in_battle = true
       WHERE user_id = $1
         AND id = ANY($2::int[])
         AND party_slot IS NOT NULL
         AND party_slot <= $3
         AND hp_current > 0
         AND in_battle = false`,
      [req.user.userId, authoritativeCharacterIds, MAX_PARTY_SIZE]
    );
    if (updateResult.rowCount !== authoritativeCharacterIds.length) {
      throw new AppError('Selected characters are no longer available', 409);
    }
    if (result.created) {
      for (const bossState of Object.values(generatedBattle.mutableState.bossStates ?? {})) {
        await bossService.saveBossEncounter(
          { ...bossState, battleId: result.battleId },
          { client }
        );
      }
    }
    return {
      ...result,
      currentNodeId,
      node
    };
  });

  const battleEnvelope = creation.envelope;
  const battleId = battleEnvelope.id;
  const stateRevision = battleEnvelope.stateRevision;
  const battleState = battleService.withBattleStateVisualIdentities(
    battleEnvelope.state
  );
  const responseNode = creation.node && battleEnvelope.nodeId === creation.currentNodeId
    ? { nodeType: creation.node.node_type, nodeName: creation.node.name }
    : await loadBattleNodeMetadata(battleEnvelope.nodeId);

  // Join battle WebSocket room
  await battleWebsocket.joinBattle(battleId, req.user.userId);

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

  const availableActions = getParticipantAvailableActions(
    battleEnvelope,
    battleState,
    req.user.userId
  );

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
  await battleWebsocket.joinBattle(battleId, req.user.userId);

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

  const availableActions = getParticipantAvailableActions(
    battleEnvelope,
    state,
    req.user.userId
  );

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

  const battleState = battleService.withBattleStateVisualIdentities(battleEnvelope.state);
  const availableActions = getParticipantAvailableActions(
    battleEnvelope,
    battleState,
    req.user.userId
  );

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
  const {
    battleId,
    actionType,
    unitId,
    targetTile,
    skillId,
    inventoryId,
    actionSequence,
    commandId,
    stateRevision
  } = req.body;

  if (battleId === undefined || battleId === null || battleId === '') {
    throw new AppError('Battle ID is required', 400, {
      code: 'battle_id_required'
    });
  }

  const actionCommand = createBattleActionCommand({
    battleId,
    userId: req.user.userId,
    commandId,
    actionType,
    unitId,
    targetTile,
    skillId,
    inventoryId,
    stateRevision
  });

  const battle = await loadParticipantBattleOr404(
    battleId,
    req.user.userId
  );
  let priorReceipt;
  try {
    priorReceipt = await battleStateRepository.findCommandReceipt({
      battleId,
      idempotencyKey: actionCommand.idempotencyKey,
      commandType: actionCommand.commandType,
      idempotencyRequest: actionCommand.idempotencyRequest
    });
  } catch (error) {
    await throwBattleActionCommitError(error, battleId, req.user.userId);
  }
  if (priorReceipt) {
    await ensureCurrentSuccessorProgress(
      battleId,
      priorReceipt,
      req.user.userId
    );
    return sendBattleActionReplay(
      res,
      priorReceipt,
      battle,
      actionCommand.commandId,
      req.user.userId
    );
  }
  if (stateRevision !== undefined
    && stateRevision !== null
    && stateRevision !== battle.stateRevision) {
    throw new AppError('Battle state has changed - please retry', 409, {
      code: 'battle_state_conflict',
      ...createBattleActionRecovery(battle, req.user.userId)
    });
  }
  if (battle.status !== 'active') {
    throw new AppError('Battle is no longer active', 409, {
      code: 'battle_not_active',
      ...createBattleActionRecovery(battle, req.user.userId)
    });
  }

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
    return res.status(400).json({
      error: 'Not this unit\'s turn',
      ...createBattleActionRecovery(battle, req.user.userId)
    });
  }

  // For PvP/co-op: validate unit ownership (ownerId field)
  // If ownerId is set, only the owning player can control that unit
  if (activeUnit.ownerId !== undefined
    && activeUnit.ownerId !== null
    && String(activeUnit.ownerId) !== String(req.user.userId)) {
    return res.status(403).json({
      error: 'You do not control this unit',
      ...createBattleActionRecovery(battle, req.user.userId)
    });
  }
  if (!PLAYER_ACTION_TYPES.has(actionType)) {
    return res.status(400).json({
      error: 'Invalid action type',
      ...createBattleActionRecovery(battle, req.user.userId)
    });
  }

  // Capture old position BEFORE processAction modifies the unit (for movement broadcast)
  const oldPosition = { x: activeUnit.tileX, y: activeUnit.tileY };

  // Process player action using service
  const result = battleService.processAction(state, activeUnit, actionType, targetTile, skillId);

  // If there was an error (e.g., already moved, status effect), return early
  if (result.error) {
    return res.status(400).json({
      error: result.error,
      ...createBattleActionRecovery(battle, req.user.userId)
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
  let availableActions = battleStatus === 'active' && turnContinues
    ? result.availableActions
    : null;
  let replayMetadata = {
    actionResult: result,
    battleStatus,
    turnContinues,
    availableActions
  };

  let committedRevision = null;
  let actionCommit = null;
  let completion = null;

  if (battleStatus === 'active') {
    if (result.turnEnded) {
      battleService.advanceToNextActorWithCT(state);
      // The action receipt and immediate HTTP response must describe the
      // successor selected by CT. Scope the details to the acting participant
      // so a consecutive local turn is immediately actionable without
      // exposing another player's legal actions.
      availableActions = getParticipantAvailableActions(
        battle,
        state,
        req.user.userId
      );
      replayMetadata = {
        ...replayMetadata,
        availableActions
      };
    }
    state.turnPredictions = battleService.predictTurnOrder(state, 10);

    try {
      actionCommit = await commitBattleActionState({
        battleId,
        expectedRevision: battle.stateRevision,
        commandType: actionCommand.commandType,
        idempotencyKey: actionCommand.idempotencyKey,
        idempotencyRequest: actionCommand.idempotencyRequest,
        replayMetadata,
        flatState: state,
        lifecycle: { status: 'active' },
        allowedStatuses: ['active']
      }, {
        userId: req.user.userId,
        consumedInventoryId: result.consumedInventoryId,
        bossState: changedBossState
      });
    } catch (error) {
      await throwBattleActionCommitError(error, battleId, req.user.userId);
    }
    if (actionCommit.idempotent) {
      await ensureCurrentSuccessorProgress(
        battleId,
        actionCommit,
        req.user.userId
      );
      return sendBattleActionReplay(
        res,
        actionCommit,
        battle,
        actionCommand.commandId,
        req.user.userId
      );
    }
    state = structuredClone(actionCommit.envelope.state);
    committedRevision = actionCommit.envelope.stateRevision;

    // Timers and all presentation events observe only the committed successor.
    cancelTurnTimer(battleId);
    await battleWebsocket.broadcastStateUpdate(battleId, actionCommit.update);
  } else {
    state.turnPredictions = battleService.predictTurnOrder(state, 10);
    try {
      completion = await handleBattleEnd(
        battleId,
        battleStatus,
        state,
        req.user.userId,
        battleEndResult,
        {
          expectedRevision: battle.stateRevision,
          consumedInventoryId: result.consumedInventoryId,
          commandIdentity: actionCommand.idempotencyKey,
          commandType: actionCommand.commandType,
          idempotencyRequest: actionCommand.idempotencyRequest,
          replayMetadata,
          publish: false
        }
      );
    } catch (error) {
      await throwBattleActionCommitError(error, battleId, req.user.userId);
    }
    if (completion.idempotent) {
      return sendBattleActionReplay(
        res,
        completion,
        battle,
        actionCommand.commandId,
        req.user.userId
      );
    }
    state = structuredClone(completion.state);
    result.rewards = completion.rewards;
    replayMetadata = completion.replayMetadata ?? {
      ...replayMetadata,
      actionResult: result
    };
    cancelTurnTimer(battleId);
    if (completion.committedUpdate) {
      await battleWebsocket.broadcastStateUpdate(
        battleId,
        completion.committedUpdate
      );
    }
  }

  // Legacy actionSequence is telemetry only. Recording it
  // after business validation and durable commit prevents rejected actions
  // from consuming a sequence number.
  validateActionSequence(battleId, req.user.userId, actionSequence);

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
    await ensureCurrentSuccessorProgress(
      battleId,
      actionCommit,
      req.user.userId
    );
  }

  res.json({
    state,
    actionResult: result,
    battleStatus,
    // Two-action turn system: indicate if turn continues
    turnContinues,
    availableActions: replayMetadata.availableActions,
    stateRevision: completion?.stateRevision ?? committedRevision,
    commandId: actionCommand.commandId
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
  const activeUnit = battleState.units?.find(
    unit => unit.id === battleState.activeUnitId
  ) ?? null;
  const participantAvailableActions = participantStatus === 'active'
    ? getParticipantAvailableActions(battle, battleState, req.user.userId)
    : null;

  // Build lightweight state for polling
  // Note: Battle units use tileX/tileY for position (not x/y)
  // CRITICAL: Ensure positions are always valid numbers to prevent client NaN issues
  const state = {
    activeUnitId: battleState.activeUnitId || null,
    turnCount: battleState.turn || 0,
    stateRevision: battle.stateRevision,
    moveUsed: activeUnit?.moveUsed ?? false,
    actUsed: activeUnit?.actUsed ?? false,
    turnPhase: activeUnit?.turnPhase ?? 'ready',
    hasActed: activeUnit?.hasActed ?? false,
    availableActions: participantAvailableActions,
    status: participantStatus,
    rewards: participantStatus === 'victory' ? (battle.rewards || null) : null,
    units: (battleState.units || []).map(u => ({
      id: u.id,
      x: u.tileX ?? 0,
      y: u.tileY ?? 0,
      hp: u.hp ?? 0,
      mp: u.mp ?? 0,
      statusEffects: (u.statusEffects || []).map(e => e.type || e),
      ...(u.id === battleState.activeUnitId ? {
        moveUsed: u.moveUsed ?? false,
        actUsed: u.actUsed ?? false,
        turnPhase: u.turnPhase ?? 'ready',
        hasActed: u.hasActed ?? false
      } : {})
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
