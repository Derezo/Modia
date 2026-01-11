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
import * as questService from '../services/advancementQuestService.js';
import * as guildmasterBattleService from '../services/guildmasterBattleService.js';
import * as battleService from '../services/battleService.js';
import battleWebsocket from '../services/battleWebsocket.js';
import { actionLimiter, startLimiter, readLimiter } from '../middleware/battleRateLimiter.js';

const router = express.Router();

/**
 * Verify character ownership middleware
 */
async function verifyCharacterOwnership(req, res, next) {
  const characterId = parseInt(req.params.characterId || req.body.characterId, 10);

  if (!characterId || isNaN(characterId)) {
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
  const { characterId, questTemplateId } = req.body;

  if (!characterId || !questTemplateId) {
    throw new AppError('characterId and questTemplateId are required', 400);
  }

  // Verify ownership
  const charResult = await query(
    'SELECT id, user_id, name FROM characters WHERE id = $1',
    [characterId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (charResult.rows[0].user_id !== req.user.userId) {
    throw new AppError('Not authorized to access this character', 403);
  }

  try {
    const result = await questService.acceptQuest(characterId, questTemplateId);

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
  } catch (error) {
    throw new AppError(error.message, 400);
  }
}));

// POST /api/advancement/abandon/:characterId - Abandon current quest
router.post('/abandon/:characterId', authenticate, actionLimiter, asyncHandler(verifyCharacterOwnership), asyncHandler(async (req, res) => {
  const abandoned = await questService.abandonQuest(req.characterId);

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
  const { characterId } = req.body;

  if (!characterId) {
    throw new AppError('characterId is required', 400);
  }

  // Verify ownership
  const charResult = await query(
    'SELECT id, user_id, name, level, current_node_id FROM characters WHERE id = $1',
    [characterId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (charResult.rows[0].user_id !== req.user.userId) {
    throw new AppError('Not authorized to access this character', 403);
  }

  const character = charResult.rows[0];

  // Validate character is at a guild node
  const nodeCheck = await query(
    'SELECT id, node_type FROM world_nodes WHERE id = $1',
    [character.current_node_id]
  );

  if (nodeCheck.rows.length === 0) {
    throw new AppError('Character location not found', 400);
  }

  if (nodeCheck.rows[0].node_type !== 'guild') {
    throw new AppError('You must be at a guild to start the boss trial', 400);
  }

  // Check eligibility
  const eligibility = await questService.canStartBossTrial(characterId);

  if (!eligibility.eligible) {
    throw new AppError(eligibility.reason, 400);
  }

  const targetClass = eligibility.targetClass;

  // Generate guildmaster battle
  const battleConfig = await guildmasterBattleService.generateGuildmasterBattle(
    { id: characterId, level: character.level || 10 },
    targetClass,
    character.current_node_id
  );

  // Initialize CT and determine first actor
  battleService.initializeCT(battleConfig.initialState.units);
  battleService.advanceToNextActor(battleConfig.initialState);
  battleConfig.initialState.turnPredictions = battleService.predictTurnOrder(battleConfig.initialState, 10);

  // Create battle record
  const battleId = await guildmasterBattleService.createGuildmasterBattleRecord(battleConfig, req.user.userId);

  // Join battle WebSocket room
  battleWebsocket.joinBattle(battleId, req.user.userId);

  // Get available actions for first actor if player
  const firstUnit = battleConfig.initialState.units.find(u => u.id === battleConfig.initialState.activeUnitId);
  const availableActions = firstUnit?.type === 'player'
    ? battleService.getAvailableActions(firstUnit, battleConfig.initialState)
    : null;

  res.json({
    success: true,
    message: `Boss trial against ${battleConfig.guildmaster.name} has begun!`,
    battleId,
    characterId,
    targetClass,
    mapSeed: battleConfig.mapSeed,
    mapWidth: 32,
    mapHeight: 32,
    state: battleConfig.initialState,
    guildmaster: {
      name: battleConfig.guildmaster.name,
      title: battleConfig.guildmaster.title,
      currentPhase: battleConfig.guildmaster.currentPhase,
      maxPhases: battleConfig.guildmaster.maxPhases
    },
    availableActions
  });
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
