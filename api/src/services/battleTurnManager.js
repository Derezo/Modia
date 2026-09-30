/**
 * Battle Turn Manager - Handles async turn processing with visualization delays
 *
 * This service manages the server-side turn loop, including:
 * - Enemy turn processing with intent visualization
 * - Turn transitions with proper timing for animations
 * - Async processing so HTTP responses return immediately
 */

import battleWebsocket from './battleWebsocket.js';
import { battleStateRepository } from './battle/BattleStateRepository.js';
import { getBattleStatusString, getUnitTeamId } from './battle/index.js';
import { startTurnTimer } from './coliseumService.js';
import { getAvailableActions } from './battle/actionProcessor.js';
import { checkAllBossTransitions, saveBossEncounter } from './bossService.js';

/**
 * Check if AI debug logging is enabled via user settings in battle state
 * @param {Object} state - Battle state containing debugOptions
 * @returns {boolean} True if AI decision logging is enabled
 */
function isAIDebugEnabled(state) {
  return state?.debugOptions?.logAIDecisions === true;
}

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

// A battle can be resumed by battle start, /current, and action completion.
// Keep those recovery paths from running the same AI turn concurrently. The
// supported deployment is a singleton process; repository CAS still protects
// writes if that topology changes, but presentation would also need a
// distributed lease before enabling multiple API workers.
const activeEnemyTurnJobs = new Map();

/**
 * Process enemy turns asynchronously with visualization delays
 * @param {number} battleId - Battle ID
 * @param {Object} state - Current battle state
 * @param {Object} aiService - AI service for enemy decisions
 * @param {Object} battleService - Battle service for action processing
 * @param {number} expectedRevision - Revision of the supplied battle state
 * @returns {Promise<Object>} Updated state and battle status
 */
async function processEnemyTurnsAsync(
  battleId,
  state,
  aiService,
  battleService,
  expectedRevision
) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('expectedRevision must be a non-negative safe integer');
  }

  const jobKey = String(battleId);
  if (activeEnemyTurnJobs.has(jobKey)) {
    console.log(
      '[AsyncTurnManager] Enemy turn processing already active for battle',
      battleId,
      '- skipping duplicate trigger'
    );
    return {
      skipped: true,
      reason: 'already_processing'
    };
  }

  const jobToken = {};
  activeEnemyTurnJobs.set(jobKey, jobToken);
  try {
    // Every launcher supplies the snapshot that caused it to schedule work, but
    // another trigger/action may win before this async job starts. Always begin
    // from the latest persisted revision.
    const authoritativeBattle = await battleStateRepository.loadBattle(battleId);
    if (authoritativeBattle.status !== 'active') {
      return {
        skipped: true,
        reason: 'battle_not_active'
      };
    }
    if (authoritativeBattle.stateRevision !== expectedRevision) {
      console.log(
        '[AsyncTurnManager] Scheduled revision',
        expectedRevision,
        'advanced to',
        authoritativeBattle.stateRevision,
        'before processing battle',
        battleId
      );
    }

    return await processEnemyTurnsFromState(
      battleId,
      authoritativeBattle.state,
      aiService,
      battleService,
      authoritativeBattle.stateRevision
    );
  } finally {
    if (activeEnemyTurnJobs.get(jobKey) === jobToken) {
      activeEnemyTurnJobs.delete(jobKey);
    }
  }
}

/**
 * Run boss phase transitions for the current state and sync the boss units'
 * display fields. Returns entries with a snapshot of each boss state, to be
 * announced and persisted by flushBossPhaseTransitions once the enemy turn
 * that caused them has committed.
 * @param {Object} state - Battle state (bossStates changed in place)
 * @returns {Array<{transition: Object, bossState: Object|null}>}
 */
function collectBossPhaseTransitions(state) {
  const collected = [];
  for (const transition of checkAllBossTransitions(state)) {
    console.log(`[AsyncTurnManager] Boss ${transition.bossName} transitioned to phase ${transition.toPhase}`);
    const bossUnit = state.units.find(u => String(u.id) === String(transition.unitId));
    const bossState = state.bossStates?.[transition.unitId] ?? null;
    if (bossUnit && bossState) {
      bossUnit.currentPhase = bossState.currentPhase;
      bossUnit.phaseName = transition.phaseName;
    }
    collected.push({ transition, bossState: bossState ? structuredClone(bossState) : null });
  }
  return collected;
}

/**
 * Announce and persist boss phase transitions of a committed enemy turn.
 * A boss_encounters write failure is logged, not thrown: the battle state
 * (which carries bossStates) is already committed, and throwing here would
 * abort the enemy loop after the fact.
 *
 * @param {number} battleId
 * @param {Array<{transition: Object, bossState: Object|null}>} pending
 * @param {Object} [deps] - Injectable for tests
 */
async function flushBossPhaseTransitions(
  battleId,
  pending,
  {
    broadcast = (id, payload) => battleWebsocket.broadcastPhaseTransition(id, payload),
    save = saveBossEncounter
  } = {}
) {
  for (const { transition, bossState } of pending) {
    try {
      await broadcast(battleId, {
        bossId: transition.unitId,
        bossName: transition.bossName,
        ...transition
      });
    } catch (error) {
      console.error('[AsyncTurnManager] Failed to broadcast boss phase transition:', error.message);
    }
    if (!bossState) continue;
    try {
      await save({ ...bossState, battleId });
    } catch (error) {
      console.error('[AsyncTurnManager] Failed to save boss encounter:', error.message);
    }
  }
}

async function processEnemyTurnsFromState(
  battleId,
  state,
  aiService,
  battleService,
  expectedRevision
) {
  state = structuredClone(state);
  let stateRevision = expectedRevision;
  let lastCommittedUpdate = null;
  const enemyActions = [];
  let battleStatus = { status: 'active', winningTeamId: null };
  let iterations = 0;
  const maxIterations = 50; // Safety limit
  // Boss phase transitions of the not-yet-committed enemy turn
  const pendingPhaseTransitions = [];

  console.log('[AsyncTurnManager] Starting enemy turn processing for battle', battleId);

  // Process enemy turns until it's a player's turn again
  while (battleStatus.status === 'active' && iterations < maxIterations) {
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    if (!activeUnit) {
      console.log('[AsyncTurnManager] No active unit found, advancing');
      battleService.advanceToNextActorWithCT(state);
      battleStatus = battleService.checkBattleEnd(state);
      if (battleStatus.status !== 'active') {
        break;
      }
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
    await battleWebsocket.broadcastTurnStart(
      battleId,
      {
        id: activeUnit.id,
        name: activeUnit.name,
        position: { x: activeUnit.tileX, y: activeUnit.tileY }
      },
      'enemy',
      turnPredictions,
      stateRevision
    );

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

    // Check for boss phase transitions after enemy action. They change
    // state.bossStates in place and are announced and persisted only after
    // this turn's state commits (see flushBossPhaseTransitions).
    pendingPhaseTransitions.push(...collectBossPhaseTransitions(state));

    // Check if battle ended. Pass actingTeamId for PvP mutual knockout handling.
    const actingTeamId = getUnitTeamId(activeUnit);
    battleStatus = battleService.checkBattleEnd(state, { actingTeamId });

    if (battleStatus.status !== 'active') {
      console.log('[AsyncTurnManager] Battle ended with status:', battleStatus.status, 'winner:', battleStatus.winningTeamId);
      break;
    }

    // Advance to next unit (applies DoT ticks in turnStartEffects)
    battleService.advanceToNextActorWithCT(state);

    // Check for boss phase transitions after DoT ticks (also held until commit)
    pendingPhaseTransitions.push(...collectBossPhaseTransitions(state));

    // DoT damage from the enemy's previous actions is still attributed to them.
    battleStatus = battleService.checkBattleEnd(state, { actingTeamId });
    if (battleStatus.status !== 'active') {
      // Turn-start damage is part of the still-uncommitted enemy-turn
      // successor. Return it to the route's normal terminal completion path
      // instead of first committing an impossible active lifecycle.
      break;
    }

    // Update state in database
    const commitResult = await updateBattleState(battleId, state, stateRevision, {
      commandType: 'enemy_turn_advance',
      idempotencyKey: `enemy-turn:${battleId}:${stateRevision}`
    });
    stateRevision = commitResult.stateRevision;
    lastCommittedUpdate = commitResult.update;
    state = structuredClone(commitResult.envelope.state);
    await battleWebsocket.broadcastStateUpdate(battleId, commitResult.update);
    await flushBossPhaseTransitions(battleId, pendingPhaseTransitions.splice(0));

    // Small buffer before next turn
    await delay(TIMING.TURN_END_BUFFER);

    iterations++;
  }

  console.log('[AsyncTurnManager] Finished processing', enemyActions.length, 'enemy actions');

  // Convert battleStatus object to string for backwards compatibility with callers
  const battleStatusString = getBattleStatusString(battleStatus);
  // Also return winningTeamId for PvP battles
  return {
    state,
    stateRevision,
    committedUpdate: lastCommittedUpdate,
    battleStatus: battleStatusString,
    battleEndResult: battleStatus, // Full result object with winningTeamId
    enemyActions,
    // Transitions from a final, uncommitted enemy turn (a terminal break).
    // Nothing was broadcast or saved for them; boss_encounters rows are
    // removed with the battle, so callers may only announce them.
    pendingPhaseTransitions
  };
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

  // Reset turn state for enemy (allows move + act this turn)
  battleService.resetTurnState(enemy);

  // Get AI decisions for the full turn (returns array of 1-2 actions)
  const decisions = aiService.decideTurnActions(enemy, state);

  if (isAIDebugEnabled(state)) {
    const actionSummary = decisions.map(d => {
      if (d.actionType === 'move') return `move(${d.targetTile?.x},${d.targetTile?.y})`;
      if (d.actionType === 'attack') return `attack(${d.targetTile?.x},${d.targetTile?.y})`;
      if (d.actionType === 'skill') return `skill:${d.skillId}(${d.targetTile?.x},${d.targetTile?.y})`;
      if (d.actionType === 'item') return `item:${d.itemId}`;
      return d.actionType;
    }).join(' -> ');
    console.log(`[AI] Execute: ${enemy.name} | ${actionSummary}`);
  }

  // Process each action in the enemy's turn
  for (const decision of decisions) {
    // Skip if wait (ends turn)
    if (decision.actionType === 'wait') {
      if (isAIDebugEnabled(state)) {
        console.log(`[AI] Action: ${enemy.name} | wait`);
      }
      await battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'wait', {});
      await delay(TIMING.TURN_END_BUFFER);
      break;
    }

    if (decision.actionType === 'move' && decision.targetTile) {
      // === MOVEMENT PHASE ===
      if (isAIDebugEnabled(state)) {
        console.log(`[AI] Action: ${enemy.name} | move (${enemy.tileX},${enemy.tileY}) -> (${decision.targetTile.x},${decision.targetTile.y})`);
      }

      // Show movement range highlight
      const movementRange = getMovementRangeTiles(enemy, state, battleService);
      if (movementRange.length > 0) {
        await battleWebsocket.broadcastIntentHighlight(
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
        await battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'target_path',
          pathTiles,
          TIMING.INTENT_PATH
        );
        await delay(TIMING.INTENT_PATH);
      }

      // Save old position BEFORE processAction updates it
      const oldPosition = { x: enemy.tileX, y: enemy.tileY };

      // Execute movement via processAction
      const moveResult = battleService.processAction(
        state,
        enemy,
        'move',
        decision.targetTile,
        null
      );

      if (moveResult.error) {
        if (isAIDebugEnabled(state)) {
          console.log(`[AI] Result: ${enemy.name} | move FAILED - ${moveResult.error}`);
        }
      } else {
        if (isAIDebugEnabled(state)) {
          console.log(`[AI] Result: ${enemy.name} | move SUCCESS (${oldPosition.x},${oldPosition.y}) -> (${decision.targetTile.x},${decision.targetTile.y})`);
        }
        // Broadcast unit moved (using saved old position)
        await battleWebsocket.broadcastUnitMoved(
          battleId,
          enemy.id,
          oldPosition,
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
      if (isAIDebugEnabled(state)) {
        const targetUnit = state.units.find(u => u.tileX === decision.targetTile.x && u.tileY === decision.targetTile.y);
        console.log(`[AI] Action: ${enemy.name} | attack -> ${targetUnit?.name || 'unknown'} at (${decision.targetTile.x},${decision.targetTile.y})`);
      }

      // Debug: Validate targetTile has valid coordinates
      if (decision.targetTile.x === undefined || decision.targetTile.y === undefined) {
        if (isAIDebugEnabled(state)) {
          console.error(`[AI] Error: ${enemy.name} | invalid targetTile - x or y undefined`);
        }
      }

      // Show attack range highlight
      const attackRange = getAttackRangeTiles(enemy, state, battleService);
      if (attackRange.length > 0) {
        await battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'attack_range',
          attackRange,
          TIMING.INTENT_ATTACK
        );
        await delay(TIMING.INTENT_ATTACK);
      }

      // Show target tile
      await battleWebsocket.broadcastIntentHighlight(
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

      if (attackResult.error) {
        if (isAIDebugEnabled(state)) {
          console.log(`[AI] Result: ${enemy.name} | attack FAILED - ${attackResult.error}`);
        }
      } else {
        if (isAIDebugEnabled(state)) {
          const isCrit = attackResult.isCritical ? ' (CRIT)' : '';
          console.log(`[AI] Result: ${enemy.name} | attack -> ${attackResult.targetName || 'target'} | damage: ${attackResult.damage}${isCrit}`);
        }
        // Broadcast action executed
        await battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'attack', {
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
      const battleEndCheck = battleService.checkBattleEnd(
        state,
        { actingTeamId: getUnitTeamId(enemy) }
      );
      if (battleEndCheck.status !== 'active') {
        break;
      }

    } else if (decision.actionType === 'skill' && decision.targetTile) {
      // === SKILL PHASE ===
      if (isAIDebugEnabled(state)) {
        const targetUnit = state.units.find(u => u.tileX === decision.targetTile.x && u.tileY === decision.targetTile.y);
        console.log(`[AI] Action: ${enemy.name} | skill:${decision.skillId} -> ${targetUnit?.name || 'area'} at (${decision.targetTile.x},${decision.targetTile.y})`);
      }

      // Show skill range (use actual skill range, not attack range)
      const skillRangeTiles = getSkillRangeTiles(enemy, state, decision.skillId);
      if (skillRangeTiles.length > 0) {
        await battleWebsocket.broadcastIntentHighlight(
          battleId,
          enemy.id,
          'attack_range',
          skillRangeTiles,
          TIMING.INTENT_ATTACK
        );
        await delay(TIMING.INTENT_ATTACK);
      }

      // Show target tile(s)
      await battleWebsocket.broadcastIntentHighlight(
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
        if (isAIDebugEnabled(state)) {
          const effectInfo = [];
          if (skillResult.damage) effectInfo.push(`damage: ${skillResult.damage}`);
          if (skillResult.healing) effectInfo.push(`healing: ${skillResult.healing}`);
          if (skillResult.statusApplied) effectInfo.push(`status: ${skillResult.statusApplied}`);
          console.log(`[AI] Result: ${enemy.name} | skill:${decision.skillId} | ${effectInfo.join(', ') || 'effect applied'}`);
        }
        await battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'skill', {
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
      } else if (isAIDebugEnabled(state)) {
        console.log(`[AI] Result: ${enemy.name} | skill FAILED - ${skillResult.error}`);
      }

      // Check if battle ended
      const battleEndCheck = battleService.checkBattleEnd(
        state,
        { actingTeamId: getUnitTeamId(enemy) }
      );
      if (battleEndCheck.status !== 'active') {
        break;
      }

    } else if (decision.actionType === 'item' && decision.itemId) {
      // === ITEM PHASE ===
      if (isAIDebugEnabled(state)) {
        const targetUnit = decision.targetTile
          ? state.units.find(u => u.tileX === decision.targetTile.x && u.tileY === decision.targetTile.y)
          : enemy;
        console.log(`[AI] Action: ${enemy.name} | item:${decision.itemId} -> ${targetUnit?.name || 'self'}`);
      }

      // Execute item via processAction
      const itemResult = battleService.processAction(
        state,
        enemy,
        'item',
        decision.targetTile || { x: enemy.tileX, y: enemy.tileY },
        decision.itemId
      );

      if (!itemResult.error) {
        if (isAIDebugEnabled(state)) {
          const effectInfo = [];
          if (itemResult.hpRestored) effectInfo.push(`HP: +${itemResult.hpRestored}`);
          if (itemResult.mpRestored) effectInfo.push(`MP: +${itemResult.mpRestored}`);
          if (itemResult.statusCured) effectInfo.push(`cured: ${itemResult.statusCured}`);
          console.log(`[AI] Result: ${enemy.name} | item:${decision.itemId} | ${effectInfo.join(', ') || 'used'}`);
        }
        await battleWebsocket.broadcastActionExecuted(battleId, enemy.id, 'item', {
          itemId: decision.itemId,
          targetTile: decision.targetTile,
          ...itemResult
        });

        actionResults.push({
          unitId: enemy.id,
          unitName: enemy.name,
          actionType: 'item',
          targetTile: decision.targetTile,
          itemId: decision.itemId,
          result: itemResult
        });

        await delay(TIMING.ATTACK_ANIMATION);
      } else if (isAIDebugEnabled(state)) {
        console.log(`[AI] Result: ${enemy.name} | item FAILED - ${itemResult.error}`);
      }
    }
  }

  return actionResults;
}

/**
 * Get movement range tiles for visualization
 * Uses terrain-aware pathfinding from battleService
 */
function getMovementRangeTiles(unit, state, battleService) {
  // Use terrain-aware Dijkstra pathfinding from battleService
  const reachableTiles = battleService.getReachableTiles(unit, state);

  // getReachableTiles returns [{x, y, cost}, ...] - we just need {x, y}
  return reachableTiles.map(tile => ({ x: tile.x, y: tile.y }));
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
 * Get skill range tiles for visualization
 * @param {Object} unit - The unit using the skill
 * @param {Object} state - Battle state
 * @param {string} skillId - The skill being used
 * @returns {Array} Array of {x, y} tiles within skill range
 */
function getSkillRangeTiles(unit, state, skillId) {
  // Get skill range from unit's skills array
  let range = 1; // Default
  if (Array.isArray(unit.skills)) {
    const skill = unit.skills.find(s => s.id === skillId);
    if (skill) {
      range = skill.range || 1;
    }
  }

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
function getPathToTarget(unit, targetTile, _state) {
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
 * @param {number} expectedRevision - Revision the update is based on
 * @param {Object} options - Repository command metadata
 * @returns {Promise<Object>} Repository commit result with a fresh envelope
 */
async function updateBattleState(
  battleId,
  state,
  expectedRevision,
  {
    commandType = 'enemy_turn_advance',
    idempotencyKey = `${commandType}:${battleId}:${expectedRevision}`
  } = {}
) {
  const result = await battleStateRepository.commitBattleState({
    battleId,
    expectedRevision,
    commandType,
    idempotencyKey,
    flatState: state,
    allowedStatuses: ['active']
  });
  const envelope = result.envelope ?? await battleStateRepository.loadBattle(battleId);

  return {
    ...result,
    envelope
  };
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
 * @param {number|null} stateRevision - Authoritative settled revision
 */
async function notifyPlayerTurn(battleId, state, stateRevision = null) {
  const activeUnit = state.units.find(u => u.id === state.activeUnitId);

  if (activeUnit && activeUnit.type === 'player') {
    const battleService = await import('./battleService.js');
    const turnPredictions = battleService.predictTurnOrder(state, 10);
    const hasOwner = activeUnit.ownerId !== null &&
      activeUnit.ownerId !== undefined;
    const availableActions = hasOwner
      ? getAvailableActions(activeUnit, state)
      : null;
    const playerUnits = state.units.filter(
      unit => unit.type === 'player' &&
        unit.ownerId !== null &&
        unit.ownerId !== undefined
    );
    const uniqueOwners = new Set(playerUnits.map(unit => unit.ownerId));
    const isPvP = state.battleType === 'pvp' ||
      state.battleType === 'pvp_coliseum';
    const isMultiplayerPvE = !isPvP && uniqueOwners.size > 1;
    const isMultiplayer = isPvP || isMultiplayerPvE;

    // Full action availability can include skills, inventory, and legal target
    // tiles. It is useful as a redundant solo-turn recovery signal, but must not
    // be broadcast to other human participants.
    const turnStartAvailability = !isMultiplayer ? availableActions : null;

    // Broadcast turn start to all
    const turnStartDeliveries = await battleWebsocket.broadcastTurnStart(
      battleId,
      {
        id: activeUnit.id,
        name: activeUnit.name,
        position: { x: activeUnit.tileX, y: activeUnit.tileY }
      },
      'player_local',  // Will be adjusted client-side based on who receives it
      turnPredictions,
      stateRevision,
      turnStartAvailability
    );

    // Send personal notification if ownerId is set (multiplayer battles)
    let yourTurnSequence = -1;
    if (hasOwner) {
      yourTurnSequence = await battleWebsocket.sendYourTurn(
        activeUnit.ownerId,
        battleId,
        activeUnit.id,
        state,
        availableActions,
        stateRevision
      );

      // Only start turn timers for multiplayer battles
      // Solo PvE battles have no turn timer (single player, no need to wait)
      if (isMultiplayer) {
        // isPvE = true for co-op PvE (turns skip but never forfeit), false for PvP (can forfeit)
        startTurnTimer(battleId, activeUnit.ownerId, isMultiplayerPvE);
      }
    }

    return {
      notified: true,
      turnStartDeliveries,
      yourTurnSequence
    };
  }

  return { notified: false };
}

export {
  processEnemyTurnsAsync,
  processEnemyTurnWithVisualization,
  collectBossPhaseTransitions,
  flushBossPhaseTransitions,
  notifyPlayerTurn,
  updateBattleState,
  TIMING
};
