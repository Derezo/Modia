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
  TURN_START_DELAY: 500,      // Time for camera pan to active unit
  INTENT_MOVEMENT: 600,       // Show movement range highlight
  INTENT_PATH: 400,           // Show path to target position
  MOVE_ANIMATION: 400,        // Movement animation per tile
  INTENT_ATTACK: 500,         // Show attack range highlight
  INTENT_TARGET: 400,         // Show target tile pulse
  ATTACK_ANIMATION: 600,      // Attack animation duration
  DAMAGE_POPUP: 800,          // Damage number display
  TURN_END_BUFFER: 300        // Buffer before next turn
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
  let iterations = 0;
  const maxIterations = 50; // Safety limit

  console.log('[AsyncTurnManager] Starting enemy turn processing for battle', battleId);

  // Process enemy turns until it's a player's turn again
  while (battleStatus === 'active' && iterations < maxIterations) {
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    if (!activeUnit) {
      console.log('[AsyncTurnManager] No active unit found, advancing');
      battleService.advanceToNextActorWithCT(state);
      iterations++;
      continue;
    }

    if (activeUnit.type !== 'enemy') {
      // It's a player's turn - stop processing
      console.log('[AsyncTurnManager] Player turn detected, stopping');
      break;
    }

    if (activeUnit.hp <= 0) {
      // Dead enemy, skip
      battleService.advanceToNextActorWithCT(state);
      iterations++;
      continue;
    }

    console.log('[AsyncTurnManager] Processing turn for', activeUnit.name, 'at', activeUnit.tileX, activeUnit.tileY);

    // Broadcast turn start for this enemy
    const turnPredictions = battleService.predictTurnOrder(state, 10);
    battleWebsocket.broadcastTurnStart(battleId, {
      id: activeUnit.id,
      name: activeUnit.name,
      position: { x: activeUnit.tileX, y: activeUnit.tileY }
    }, 'enemy', turnPredictions);

    // Wait for camera pan
    await delay(TIMING.TURN_START_DELAY);

    // Process this enemy's turn with visualization
    const actionResults = await processEnemyTurnWithVisualization(
      battleId,
      state,
      activeUnit,
      aiService,
      battleService
    );

    enemyActions.push(...actionResults);

    // Check if battle ended
    battleStatus = battleService.checkBattleEnd(state);

    if (battleStatus !== 'active') {
      console.log('[AsyncTurnManager] Battle ended with status:', battleStatus);
      break;
    }

    // Advance to next unit
    battleService.advanceToNextActorWithCT(state);

    // Update state in database
    await updateBattleState(battleId, state);

    // Small buffer before next turn
    await delay(TIMING.TURN_END_BUFFER);

    iterations++;
  }

  console.log('[AsyncTurnManager] Finished processing', enemyActions.length, 'enemy actions');

  return { state, battleStatus, enemyActions };
}

/**
 * Process a single enemy turn with proper visualization delays
 * Uses the two-action turn system: move + act
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 * @param {Object} enemy - Active enemy unit
 * @param {Object} aiService - AI service
 * @param {Object} battleService - Battle service
 * @returns {Promise<Array>} Array of action results
 */
async function processEnemyTurnWithVisualization(battleId, state, enemy, aiService, battleService) {
  const actionResults = [];

  // Initialize turn state for enemy
  battleService.initializeTurnState(enemy);

  // Get AI decisions for the full turn (returns array of 1-2 actions)
  const decisions = aiService.decideTurnActions(enemy, state);

  console.log('[AsyncTurnManager]', enemy.name, 'decisions:', JSON.stringify(decisions));

  // Process each action in the enemy's turn
  for (const decision of decisions) {
    // Skip if wait (ends turn)
    if (decision.actionType === 'wait') {
      console.log('[AsyncTurnManager]', enemy.name, 'chose to wait');
      battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'wait', {});
      await delay(TIMING.TURN_END_BUFFER);
      break;
    }

    if (decision.actionType === 'move' && decision.targetTile) {
      // === MOVEMENT PHASE ===
      console.log('[AsyncTurnManager]', enemy.name, 'moving to', decision.targetTile);

      // Show movement range highlight
      const movementRange = getMovementRangeTiles(enemy, state, battleService);
      if (movementRange.length > 0) {
        battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'movement_range',
          movementRange,
          TIMING.INTENT_MOVEMENT
        );
        await delay(TIMING.INTENT_MOVEMENT);
      }

      // Show path to target
      const pathTiles = getPathToTarget(enemy, decision.targetTile, state);
      if (pathTiles.length > 0) {
        battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'target_path',
          pathTiles,
          TIMING.INTENT_PATH
        );
        await delay(TIMING.INTENT_PATH);
      }

      // Execute movement via processAction
      const moveResult = battleService.processAction(
        state,
        enemy,
        'move',
        decision.targetTile,
        null
      );

      if (!moveResult.error) {
        // Broadcast unit moved
        battleWebsocket.broadcastUnitMoved(
          battleId,
          enemy.id,
          { x: moveResult.oldPosition?.x || enemy.tileX, y: moveResult.oldPosition?.y || enemy.tileY },
          { x: decision.targetTile.x, y: decision.targetTile.y }
        );

        actionResults.push({
          unitId: enemy.id,
          unitName: enemy.name,
          actionType: 'move',
          targetTile: decision.targetTile,
          result: moveResult
        });

        // Wait for movement animation
        const pathLength = pathTiles.length || 1;
        await delay(TIMING.MOVE_ANIMATION * Math.min(pathLength, 4));
      }

    } else if (decision.actionType === 'attack' && decision.targetTile) {
      // === ATTACK PHASE ===
      console.log('[AsyncTurnManager]', enemy.name, 'attacking', decision.targetTile);

      // Show attack range highlight
      const attackRange = getAttackRangeTiles(enemy, state, battleService);
      if (attackRange.length > 0) {
        battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'attack_range',
          attackRange,
          TIMING.INTENT_ATTACK
        );
        await delay(TIMING.INTENT_ATTACK);
      }

      // Show target tile
      battleWebsocket.broadcastIntentHighlight(
        battleId,
        enemy.id,
        'target_tile',
        [decision.targetTile],
        TIMING.INTENT_TARGET
      );
      await delay(TIMING.INTENT_TARGET);

      // Execute attack via processAction
      const attackResult = battleService.processAction(
        state,
        enemy,
        'attack',
        decision.targetTile,
        null
      );

      if (!attackResult.error) {
        // Broadcast action executed
        battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'attack', {
          targetTile: decision.targetTile,
          ...attackResult
        });

        actionResults.push({
          unitId: enemy.id,
          unitName: enemy.name,
          actionType: 'attack',
          targetTile: decision.targetTile,
          result: attackResult
        });

        // Wait for attack animation
        await delay(TIMING.ATTACK_ANIMATION + TIMING.DAMAGE_POPUP);
      }

      // Check if battle ended after this action
      const battleStatus = battleService.checkBattleEnd(state);
      if (battleStatus !== 'active') {
        break;
      }

    } else if (decision.actionType === 'skill' && decision.targetTile) {
      // === SKILL PHASE ===
      console.log('[AsyncTurnManager]', enemy.name, 'using skill', decision.skillId);

      // Show attack range (skill range)
      const skillRange = getAttackRangeTiles(enemy, state, battleService);
      if (skillRange.length > 0) {
        battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'attack_range',
          skillRange,
          TIMING.INTENT_ATTACK
        );
        await delay(TIMING.INTENT_ATTACK);
      }

      // Show target tile(s)
      battleWebsocket.broadcastIntentHighlight(
        battleId,
        enemy.id,
        'target_tile',
        [decision.targetTile],
        TIMING.INTENT_TARGET
      );
      await delay(TIMING.INTENT_TARGET);

      // Execute skill via processAction
      const skillResult = battleService.processAction(
        state,
        enemy,
        'skill',
        decision.targetTile,
        decision.skillId
      );

      if (!skillResult.error) {
        battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'skill', {
          skillId: decision.skillId,
          targetTile: decision.targetTile,
          ...skillResult
        });

        actionResults.push({
          unitId: enemy.id,
          unitName: enemy.name,
          actionType: 'skill',
          targetTile: decision.targetTile,
          skillId: decision.skillId,
          result: skillResult
        });

        await delay(TIMING.ATTACK_ANIMATION + TIMING.DAMAGE_POPUP);
      }

      // Check if battle ended
      const battleStatus = battleService.checkBattleEnd(state);
      if (battleStatus !== 'active') {
        break;
      }
    }
  }

  return actionResults;
}

/**
 * Get movement range tiles for visualization
 */
function getMovementRangeTiles(unit, state, battleService) {
  const range = battleService.getMovementRange(unit);
  const tiles = [];

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (Math.abs(dx) + Math.abs(dy) <= range && (dx !== 0 || dy !== 0)) {
        const x = unit.tileX + dx;
        const y = unit.tileY + dy;
        // Check bounds and occupancy
        if (x >= 0 && x < (state.mapWidth || 32) &&
            y >= 0 && y < (state.mapHeight || 32)) {
          const occupied = state.units.some(u => u.tileX === x && u.tileY === y && u.hp > 0);
          if (!occupied) {
            tiles.push({ x, y });
          }
        }
      }
    }
  }

  return tiles;
}

/**
 * Get attack range tiles for visualization
 */
function getAttackRangeTiles(unit, state, battleService) {
  const range = battleService.getAttackRange(unit);
  const tiles = [];

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (Math.abs(dx) + Math.abs(dy) <= range && (dx !== 0 || dy !== 0)) {
        const x = unit.tileX + dx;
        const y = unit.tileY + dy;
        if (x >= 0 && x < (state.mapWidth || 32) &&
            y >= 0 && y < (state.mapHeight || 32)) {
          tiles.push({ x, y });
        }
      }
    }
  }

  return tiles;
}

/**
 * Get path tiles from unit to target (simple line)
 */
function getPathToTarget(unit, targetTile, state) {
  const path = [];
  let currentX = unit.tileX;
  let currentY = unit.tileY;

  while (currentX !== targetTile.x || currentY !== targetTile.y) {
    if (currentX < targetTile.x) currentX++;
    else if (currentX > targetTile.x) currentX--;

    if (currentY < targetTile.y) currentY++;
    else if (currentY > targetTile.y) currentY--;

    path.push({ x: currentX, y: currentY });

    // Safety limit
    if (path.length > 20) break;
  }

  return path;
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
 * Notify the next player that it's their turn
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 */
function notifyPlayerTurn(battleId, state) {
  const activeUnit = state.units.find(u => u.id === state.activeUnitId);

  if (activeUnit && activeUnit.type === 'player') {
    const battleService = require('./battleService');
    const turnPredictions = battleService.predictTurnOrder(state, 10);

    // Broadcast turn start to all
    battleWebsocket.broadcastTurnStart(
      battleId,
      {
        id: activeUnit.id,
        name: activeUnit.name,
        position: { x: activeUnit.tileX, y: activeUnit.tileY }
      },
      'player_local',  // Will be adjusted client-side based on who receives it
      turnPredictions
    );

    // Send personal notification if ownerId is set
    if (activeUnit.ownerId) {
      battleWebsocket.sendYourTurn(
        activeUnit.ownerId,
        battleId,
        activeUnit.id,
        state,
        ['move', 'attack', 'skill', 'item', 'wait']
      );
    }
  }
}

module.exports = {
  processEnemyTurnsAsync,
  processEnemyTurnWithVisualization,
  notifyPlayerTurn,
  updateBattleState,
  TIMING
};
