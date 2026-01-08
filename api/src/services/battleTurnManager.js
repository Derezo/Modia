/**
 * Battle Turn Manager - Handles async turn processing with visualization delays
 *
 * This service manages the server-side turn loop, including:
 * - Enemy turn processing with intent visualization
 * - Turn transitions with proper timing for animations
 * - Async processing so HTTP responses return immediately
 */

const battleWebsocket = require('./battleWebsocket');
const { query } = require('../config/database');

// Animation timing constants (ms) - sync with BATTLE_ANIMATIONS.md
const TIMING = {
  TURN_START_DELAY: 300,      // Time for camera pan to active unit
  INTENT_MOVEMENT: 500,       // Show movement range highlight
  INTENT_PATH: 300,           // Show path to target position
  MOVE_ANIMATION: 500,        // Movement animation per tile
  INTENT_ATTACK: 400,         // Show attack range highlight
  INTENT_TARGET: 300,         // Show target tile pulse
  ATTACK_ANIMATION: 600,      // Attack animation duration
  DAMAGE_POPUP: 1200,         // Damage number display
  TURN_END_BUFFER: 200        // Buffer before next turn
};

/**
 * Process enemy turns asynchronously with visualization delays
 * @param {number} battleId - Battle ID
 * @param {Object} state - Current battle state
 * @param {Object} aiService - AI service for enemy decisions
 * @param {Object} battleService - Battle service for action processing
 * @returns {Promise<Object>} Updated state and battle status
 */
async function processEnemyTurnsAsync(battleId, state, aiService, battleService) {
  const enemyActions = [];
  let battleStatus = 'active';

  // Process enemy turns until it's a player's turn again
  while (battleStatus === 'active') {
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    if (!activeUnit || activeUnit.type !== 'enemy') {
      // It's a player's turn - stop processing
      break;
    }

    // Broadcast turn start for this enemy
    const turnPredictions = battleService.predictTurnOrder(state, 10);
    battleWebsocket.broadcastTurnStart(battleId, activeUnit, 'enemy', turnPredictions);

    // Wait for camera pan
    await delay(TIMING.TURN_START_DELAY);

    // Process this enemy's turn with visualization
    const actionResult = await processEnemyTurnWithVisualization(
      battleId,
      state,
      activeUnit,
      aiService,
      battleService
    );

    enemyActions.push(actionResult);

    // Check if battle ended
    battleStatus = battleService.checkBattleEnd(state);

    if (battleStatus !== 'active') {
      break;
    }

    // Advance to next unit
    battleService.advanceToNextActorWithCT(state);

    // Update state in database
    await updateBattleState(battleId, state);

    // Small buffer before next turn
    await delay(TIMING.TURN_END_BUFFER);
  }

  return { state, battleStatus, enemyActions };
}

/**
 * Process a single enemy turn with proper visualization delays
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 * @param {Object} enemy - Active enemy unit
 * @param {Object} aiService - AI service
 * @param {Object} battleService - Battle service
 * @returns {Promise<Object>} Action result
 */
async function processEnemyTurnWithVisualization(battleId, state, enemy, aiService, battleService) {
  // Get AI decision
  const decision = aiService.decideAction(enemy, state);
  const result = { unitId: enemy.id, unitName: enemy.name };

  // Phase 1: Movement (if needed)
  if (decision.targetPosition &&
      (decision.targetPosition.x !== enemy.position.x ||
       decision.targetPosition.y !== enemy.position.y)) {

    // Show movement range
    const movementRange = battleService.getMovementRange(state, enemy);
    battleWebsocket.broadcastIntentHighlight(
      battleId,
      enemy.id,
      'movement_range',
      movementRange,
      TIMING.INTENT_MOVEMENT
    );
    await delay(TIMING.INTENT_MOVEMENT);

    // Show path to target
    const path = battleService.findPath(
      state,
      enemy.position,
      decision.targetPosition
    );
    if (path && path.length > 0) {
      battleWebsocket.broadcastIntentHighlight(
        battleId,
        enemy.id,
        'target_path',
        path,
        TIMING.INTENT_PATH
      );
      await delay(TIMING.INTENT_PATH);

      // Execute movement
      const oldPosition = { ...enemy.position };
      enemy.position = decision.targetPosition;
      enemy.hasMoved = true;

      battleWebsocket.broadcastUnitMoved(
        battleId,
        enemy.id,
        oldPosition,
        enemy.position
      );

      result.moved = { from: oldPosition, to: enemy.position };

      // Wait for move animation (proportional to path length)
      await delay(TIMING.MOVE_ANIMATION * Math.min(path.length, 3));
    }
  }

  // Phase 2: Action (attack, skill, or wait)
  if (decision.action === 'attack' && decision.target) {
    // Show attack range
    const attackRange = battleService.getAttackRange(state, enemy);
    battleWebsocket.broadcastIntentHighlight(
      battleId,
      enemy.id,
      'attack_range',
      attackRange,
      TIMING.INTENT_ATTACK
    );
    await delay(TIMING.INTENT_ATTACK);

    // Show target tile
    const targetUnit = state.units.find(u => u.id === decision.target);
    if (targetUnit) {
      battleWebsocket.broadcastIntentHighlight(
        battleId,
        enemy.id,
        'target_tile',
        [targetUnit.position],
        TIMING.INTENT_TARGET
      );
      await delay(TIMING.INTENT_TARGET);

      // Execute attack
      const attackResult = battleService.executeAttack(enemy, targetUnit, state);
      result.action = 'attack';
      result.targetId = decision.target;
      result.attackResult = attackResult;

      battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'attack', {
        targetId: decision.target,
        ...attackResult
      });

      // Wait for damage animation
      await delay(TIMING.ATTACK_ANIMATION + TIMING.DAMAGE_POPUP);
    }
  } else if (decision.action === 'skill' && decision.skillId && decision.target) {
    // Skill usage - similar to attack but with skill-specific handling
    const skill = getSkillById(decision.skillId);
    if (skill) {
      // Show skill range
      const skillRange = battleService.getSkillRange(state, enemy, skill);
      battleWebsocket.broadcastIntentHighlight(
        battleId,
        enemy.id,
        'attack_range',
        skillRange,
        TIMING.INTENT_ATTACK
      );
      await delay(TIMING.INTENT_ATTACK);

      // Show target(s) - could be AoE
      const targetTiles = skill.aoe
        ? battleService.getAoETiles(decision.targetTile, skill.aoeSize)
        : [decision.targetTile];

      battleWebsocket.broadcastIntentHighlight(
        battleId,
        enemy.id,
        skill.aoe ? 'aoe' : 'target_tile',
        targetTiles,
        TIMING.INTENT_TARGET
      );
      await delay(TIMING.INTENT_TARGET);

      // Execute skill
      const skillResult = battleService.executeSkill(enemy, skill, targetTiles, state);
      result.action = 'skill';
      result.skillId = decision.skillId;
      result.skillResult = skillResult;

      battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'skill', {
        skillId: decision.skillId,
        skillName: skill.name,
        ...skillResult
      });

      await delay(TIMING.ATTACK_ANIMATION + TIMING.DAMAGE_POPUP);
    }
  } else {
    // Wait action
    result.action = 'wait';
    battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'wait', {});
    await delay(TIMING.TURN_END_BUFFER);
  }

  // Mark turn as ended
  enemy.hasActed = true;

  return result;
}

/**
 * Update battle state in database
 * @param {number} battleId - Battle ID
 * @param {Object} state - Updated state
 */
async function updateBattleState(battleId, state) {
  await query(
    'UPDATE battles SET battle_state = $1 WHERE id = $2',
    [JSON.stringify(state), battleId]
  );
}

/**
 * Helper function for delays
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Placeholder for skill lookup - should use actual skill data
 * @param {string} skillId - Skill ID
 * @returns {Object|null} Skill data
 */
function getSkillById(skillId) {
  // TODO: Implement actual skill lookup from database or cache
  return null;
}

/**
 * Notify the next player that it's their turn
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 */
function notifyPlayerTurn(battleId, state) {
  const activeUnit = state.units.find(u => u.id === state.activeUnitId);

  if (activeUnit && activeUnit.type === 'player' && activeUnit.ownerId) {
    const turnPredictions = require('./battleService').predictTurnOrder(state, 10);

    // Send personal notification to the player
    battleWebsocket.sendYourTurn(
      activeUnit.ownerId,
      battleId,
      activeUnit.id,
      state,
      ['move', 'attack', 'skill', 'item', 'wait']
    );

    // Broadcast turn start to all
    battleWebsocket.broadcastTurnStart(
      battleId,
      activeUnit,
      'player_local',  // Will be adjusted client-side based on who receives it
      turnPredictions
    );
  }
}

module.exports = {
  processEnemyTurnsAsync,
  processEnemyTurnWithVisualization,
  notifyPlayerTurn,
  updateBattleState,
  TIMING
};
