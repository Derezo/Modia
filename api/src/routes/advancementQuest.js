/**
 * Advancement Quest Routes
 *
 * Handles guild advancement quest endpoints:
 * - GET /api/advancement/available/:characterId - Get available quests
 * - GET /api/advancement/current/:characterId - Get active quest progress
 * - POST /api/advancement/accept - Accept a quest
 * - POST /api/advancement/abandon/:characterId - Abandon current quest
 * - GET /api/advancement/boss/:characterId - Check boss trial eligibility
 * - POST /api/advancement/boss/start - Start boss trial battle
 * - GET /api/advancement/history/:characterId - Get completed quests
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { parseIntOrThrow } from '../utils/validateNumericParam.js';
import * as questService from '../services/advancementQuestService.js';
import * as guildmasterBattleService from '../services/guildmasterBattleService.js';
import * as battleService from '../services/battleService.js';
import battleWebsocket from '../services/battleWebsocket.js';
import { actionLimiter, startLimiter, readLimiter } from '../middleware/battleRateLimiter.js';
import { battleStateRepository } from '../services/battle/BattleStateRepository.js';
import {
  createBattleMapUpgradeRequiredPayload,
  createNegotiatedBattleStateSnapshot
} from '../services/messageReliability.js';
import { assertBattleMapCapabilities } from '../../../shared/battleStateProtocol.js';

const router = express.Router();

export function readAdvancementBattleMapCapabilities(req) {
  let capabilities = req.body?.battleMapCapabilities;
  if (capabilities === undefined) capabilities = req.query?.battleMapCapabilities;
  if (capabilities === undefined) capabilities = req.get?.('x-battle-map-capabilities');
  if (capabilities === undefined || capabilities === null) return capabilities;

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

function negotiateAdvancementBattleTransport(battle, clientCapabilities) {
  let negotiated;
  try {
    negotiated = createNegotiatedBattleStateSnapshot(battle, clientCapabilities);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new AppError('Invalid battle map capabilities', 400, {
      code: 'battle_map_capabilities_invalid'
    });
  }
  if (!negotiated.negotiation.compatible) {
    throw new AppError('This battle map requires a newer client', 426, {
      ...createBattleMapUpgradeRequiredPayload(negotiated.negotiation)
    });
  }
  return negotiated;
}

function throwAdvancementCapabilityError(error) {
  if (error?.negotiation) {
    throw new AppError('This battle map requires a newer client', 426, {
      ...createBattleMapUpgradeRequiredPayload(error.negotiation)
    });
  }
  throw error;
}

export function createAdvancementBattleTransportResponse(
  legacyPayload,
  battle,
  clientCapabilities
) {
  const explicitlyDeclared = clientCapabilities !== undefined
    && clientCapabilities !== null;
  if (!explicitlyDeclared && battle.battleMapSchemaVersion === 1) {
    return legacyPayload;
  }

  const negotiated = negotiateAdvancementBattleTransport(
    battle,
    clientCapabilities
  );
  const response = {
    ...legacyPayload,
    battleMapCapabilities: negotiated.negotiation,
    snapshot: negotiated.snapshot
  };
  if (battle.battleMapSchemaVersion !== 1) delete response.state;
  return response;
}

/**
 * Verify character ownership middleware
 */
async function verifyCharacterOwnership(req, res, next) {
  const characterId = parseInt(req.params.characterId, 10);

  if (!characterId || isNaN(characterId) || characterId <= 0) {
    throw new AppError('Valid characterId is required', 400);
  }

  const result = await query(
    'SELECT id, user_id FROM characters WHERE id = $1',
    [characterId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (result.rows[0].user_id !== req.user.userId) {
    throw new AppError('Not authorized to access this character', 403);
  }

  req.characterId = characterId;
  next();
}

// GET /api/advancement/available/:characterId - Get available quests for character
router.get('/available/:characterId', authenticate, readLimiter, asyncHandler(verifyCharacterOwnership), asyncHandler(async (req, res) => {
  const quests = await questService.getAvailableQuests(req.characterId);

  res.json({
    characterId: req.characterId,
    availableQuests: quests.map(q => ({
      id: q.id,
      guildId: q.guild_id,
      tier: q.tier,
      questName: q.quest_name,
      questDescription: q.quest_description,
      targetClass: q.target_class,
      prerequisiteClass: q.prerequisite_class,
      materialRequirements: q.material_requirements,
      enemyRequirements: q.enemy_requirements,
      nodeRequirements: q.node_requirements,
      rewards: {
        gold: q.gold_reward,
        xp: q.xp_reward,
        title: q.title_reward
      },
      guildmasterName: q.guildmaster_name
    }))
  });
}));

// GET /api/advancement/current/:characterId - Get active quest progress
router.get('/current/:characterId', authenticate, readLimiter, asyncHandler(verifyCharacterOwnership), asyncHandler(async (req, res) => {
  const progress = await questService.getQuestProgress(req.characterId);

  if (!progress) {
    return res.json({
      characterId: req.characterId,
      hasActiveQuest: false,
      quest: null
    });
  }

  res.json({
    characterId: req.characterId,
    hasActiveQuest: true,
    quest: progress
  });
}));

// POST /api/advancement/accept - Accept a quest
router.post('/accept', authenticate, actionLimiter, asyncHandler(async (req, res) => {
  const { characterId, questTemplateId, nodeId } = req.body;

  // Finding 44: Validate numeric inputs to prevent 500 from pg errors
  if (!characterId || !questTemplateId) {
    throw new AppError('characterId and questTemplateId are required', 400);
  }
  const parsedCharacterId = parseIntOrThrow(characterId, 'characterId');
  const parsedQuestTemplateId = parseIntOrThrow(questTemplateId, 'questTemplateId');
  const nodeIdError = questService.getAdvancementNodeIdError(nodeId);
  if (nodeIdError) {
    throw new AppError(nodeIdError, 400);
  }

  // Verify ownership
  const charResult = await query(
    'SELECT id, user_id, name FROM characters WHERE id = $1',
    [parsedCharacterId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (charResult.rows[0].user_id !== req.user.userId) {
    throw new AppError('Not authorized to access this character', 403);
  }

  // Domain rejections are AppErrors (400/404/409) from the service; anything
  // else (pg, TypeError) reaches the error handler as a logged, generic 500
  const result = await questService.acceptQuest(
    parsedCharacterId,
    parsedQuestTemplateId,
    nodeId
  );

  res.json({
    success: true,
    message: `${charResult.rows[0].name} has accepted the quest: ${result.template.quest_name}`,
    quest: {
      id: result.quest.id,
      questName: result.template.quest_name,
      questDescription: result.template.quest_description,
      targetClass: result.template.target_class,
      tier: result.template.tier
    }
  });
}));

// POST /api/advancement/abandon/:characterId - Abandon current quest
router.post('/abandon/:characterId', authenticate, actionLimiter, asyncHandler(verifyCharacterOwnership), asyncHandler(async (req, res) => {
  let abandoned;
  try {
    abandoned = await questService.abandonQuest(req.characterId);
  } catch (error) {
    if (error?.code === 'ADVANCEMENT_QUEST_BATTLE_ACTIVE') {
      throw new AppError(error.message, 409);
    }
    throw error;
  }

  if (!abandoned) {
    throw new AppError('No active quest to abandon', 400);
  }

  res.json({
    success: true,
    message: 'Quest abandoned. You can start a new advancement quest at any time.'
  });
}));

// GET /api/advancement/boss/:characterId - Check boss trial eligibility
router.get('/boss/:characterId', authenticate, readLimiter, asyncHandler(verifyCharacterOwnership), asyncHandler(async (req, res) => {
  const eligibility = await questService.canStartBossTrial(req.characterId);

  res.json({
    characterId: req.characterId,
    ...eligibility
  });
}));

// POST /api/advancement/boss/start - Start boss trial battle
router.post('/boss/start', authenticate, startLimiter, asyncHandler(async (req, res) => {
  const { characterId, nodeId } = req.body;
  const battleMapCapabilities = readAdvancementBattleMapCapabilities(req);

  // Finding 44: Validate numeric input
  if (!characterId) {
    throw new AppError('characterId is required', 400);
  }
  const parsedCharacterId = parseIntOrThrow(characterId, 'characterId');
  const nodeIdError = questService.getAdvancementNodeIdError(nodeId);
  if (nodeIdError) {
    throw new AppError(nodeIdError, 400);
  }

  // Verify ownership
  const charResult = await query(
    `SELECT id, user_id, name, class, level, current_node_id
     FROM characters
     WHERE id = $1`,
    [parsedCharacterId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (charResult.rows[0].user_id !== req.user.userId) {
    throw new AppError('Not authorized to access this character', 403);
  }

  const character = charResult.rows[0];

  // Check eligibility
  const eligibility = await questService.canStartBossTrial(parsedCharacterId);

  if (!eligibility.eligible) {
    throw new AppError(eligibility.reason, 400);
  }

  const nodeCheck = await query(
    `SELECT id, node_type, guild_class
     FROM world_nodes
     WHERE id = $1`,
    [nodeId]
  );
  const locationError = questService.getAdvancementGuildLocationError(
    character,
    nodeCheck.rows[0],
    nodeId,
    eligibility.guildId
  );
  if (locationError) {
    throw new AppError(locationError, 400);
  }

  const targetClass = eligibility.targetClass;

  // Generate guildmaster battle
  let battleConfig;
  try {
    const transportOptions = {
      clientCapabilities: battleMapCapabilities
    };
    battleConfig = await guildmasterBattleService.generateGuildmasterBattle(
      { id: parsedCharacterId, level: character.level || 10 },
      targetClass,
      nodeId,
      {
        ...transportOptions,
        advancementQuestId: eligibility.questId,
        bossConfig: eligibility.bossConfig
      }
    );
  } catch (error) {
    throwAdvancementCapabilityError(error);
  }

  // Initialize CT and determine first actor
  battleService.initializeCT(battleConfig.initialState.units);
  battleService.advanceToNextActor(battleConfig.initialState);
  battleConfig.initialState.turnPredictions = battleService.predictTurnOrder(battleConfig.initialState, 10);

  // Create battle record
  let battleId;
  try {
    battleId = await guildmasterBattleService.createGuildmasterBattleRecord(
      battleConfig,
      req.user.userId
    );
  } catch (error) {
    if (
      error?.code === 'ADVANCEMENT_BATTLE_ALREADY_ACTIVE'
      || error?.code === 'ADVANCEMENT_BATTLE_STATE_CHANGED'
    ) {
      throw new AppError(error.message, 409);
    }
    throw error;
  }
  const battleEnvelope = await battleStateRepository.loadBattleForParticipant(
    battleId,
    req.user.userId,
    { requireActive: true }
  );

  // Join battle WebSocket room
  battleWebsocket.joinBattle(battleId, req.user.userId);

  // Get available actions for first actor if player
  const firstUnit = battleConfig.initialState.units.find(u => u.id === battleConfig.initialState.activeUnitId);
  const availableActions = firstUnit?.type === 'player'
    ? battleService.getAvailableActions(firstUnit, battleConfig.initialState)
    : null;

  res.json(createAdvancementBattleTransportResponse({
    success: true,
    message: `Boss trial against ${battleConfig.guildmaster.name} has begun!`,
    battleId,
    characterId: parsedCharacterId,
    targetClass,
    mapSeed: battleConfig.mapSeed,
    mapWidth: battleEnvelope.mapWidth,
    mapHeight: battleEnvelope.mapHeight,
    nodeType: 'guild', // Critical: frontend needs this for terrain generation
    state: battleEnvelope.state,
    stateRevision: battleEnvelope.stateRevision,
    guildmaster: {
      name: battleConfig.guildmaster.name,
      title: battleConfig.guildmaster.title,
      currentPhase: battleConfig.guildmaster.currentPhase,
      maxPhases: battleConfig.guildmaster.maxPhases
    },
    availableActions
  }, battleEnvelope, battleMapCapabilities));
}));

// GET /api/advancement/history/:characterId - Get completed quests
router.get('/history/:characterId', authenticate, readLimiter, asyncHandler(verifyCharacterOwnership), asyncHandler(async (req, res) => {
  const completed = await questService.getCompletedQuests(req.characterId);

  res.json({
    characterId: req.characterId,
    completedQuests: completed.map(q => ({
      questId: q.id,
      questName: q.quest_name,
      targetClass: q.target_class,
      tier: q.tier,
      completedAt: q.completed_at
    }))
  });
}));

export default router;
