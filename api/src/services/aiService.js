/**
 * AI Service - Enemy decision making for tactical combat
 * Two-action system: each turn allows 1 move + 1 act (attack/skill)
 *
 * This service now uses utility-based AI with multi-actor lookahead
 * for sophisticated tactical decision making.
 */

// Import pathfinding for obstacle-aware movement decisions
import * as battleService from './battleService.js';
import { getManhattanDistance } from '../../../shared/pathfinding.js';

// Import new utility AI system
import { createAIForUnit, quickDecision } from './ai/index.js';

// Configuration for utility AI usage
const USE_UTILITY_AI = true;
const UTILITY_AI_TIME_BUDGET = 450; // ms
const LOOKAHEAD_IMMEDIATE_SCORE_TOLERANCE = {
  minimum: 15,
  maximum: 75,
  ratio: 0.10
};

/**
 * Check if AI debug logging is enabled via user settings
 * @param {Object} battleState - Battle state containing debugOptions
 * @returns {boolean} True if AI decision logging is enabled
 */
function isAIDebugEnabled(battleState) {
  return battleState?.debugOptions?.logAIDecisions === true;
}

/**
 * Compare quick utility and lookahead decisions on the same immediate-turn
 * scale. Lookahead's native score includes future board states and is not
 * directly comparable with quick utility, so it is allowed a bounded immediate
 * sacrifice for multi-turn planning but cannot replace a clearly better turn.
 */
function selectUtilityDecision(quickResult, lookaheadDecision, evaluator, unit, state) {
  const quickSequence = quickResult?.bestAction;
  const quickScore = Number.isFinite(quickResult?.score)
    ? quickResult.score
    : null;
  const lookaheadAction = lookaheadDecision?.action;

  if (!lookaheadAction) {
    return {
      decision: quickSequence
        ? { action: quickSequence, score: quickScore }
        : null,
      source: 'quick (lookahead failed)',
      quickScore,
      lookaheadImmediateScore: null
    };
  }

  if (!quickSequence || quickScore === null) {
    return {
      decision: lookaheadDecision,
      source: 'lookahead (quick failed)',
      quickScore,
      lookaheadImmediateScore: null
    };
  }

  const lookaheadSequence = Array.isArray(lookaheadAction)
    ? lookaheadAction
    : [lookaheadAction];
  const evaluatedLookahead = evaluator.evaluateSequence(unit, lookaheadSequence, state);
  const lookaheadImmediateScore = Number.isFinite(evaluatedLookahead?.score)
    ? evaluatedLookahead.score
    : -Infinity;
  const tolerance = Math.min(
    LOOKAHEAD_IMMEDIATE_SCORE_TOLERANCE.maximum,
    Math.max(
      LOOKAHEAD_IMMEDIATE_SCORE_TOLERANCE.minimum,
      Math.abs(quickScore) * LOOKAHEAD_IMMEDIATE_SCORE_TOLERANCE.ratio
    )
  );

  if (lookaheadImmediateScore + tolerance < quickScore) {
    return {
      decision: { action: quickSequence, score: quickScore },
      source: 'quick (lookahead below immediate utility floor)',
      quickScore,
      lookaheadImmediateScore
    };
  }

  return {
    decision: lookaheadDecision,
    source: 'lookahead',
    quickScore,
    lookaheadImmediateScore
  };
}

/**
 * Main AI decision function for two-action turns
 * Returns array of 1-2 actions: [{actionType, targetTile, skillId?}, ...]
 * @param {Object} enemy - The enemy unit making decisions
 * @param {Object} battleState - Current battle state
 * @returns {Array} Array of actions to execute in order
 */
function decideTurnActions(enemy, battleState) {
  const aiDebug = isAIDebugEnabled(battleState);
  if (aiDebug) {
    console.log('[AI] === Decision Start ===');
    console.log('[AI] Unit:', enemy.name, '| Pattern:', enemy.aiType || 'aggressive', '| Pos:', `(${enemy.tileX},${enemy.tileY})`, '| HP:', `${enemy.hp}/${enemy.maxHp}`);
  }

  // Try utility AI first if enabled
  if (USE_UTILITY_AI) {
    try {
      const actions = utilityAIDecision(enemy, battleState, aiDebug);
      if (actions && actions.length > 0) {
        if (aiDebug) {
          const actionSummary = actions.map(a => {
            if (a.actionType === 'move') return `move(${a.targetTile?.x},${a.targetTile?.y})`;
            if (a.actionType === 'attack') return `attack(${a.targetTile?.x},${a.targetTile?.y})`;
            if (a.actionType === 'skill') return `skill:${a.skillId}(${a.targetTile?.x},${a.targetTile?.y})`;
            return a.actionType;
          }).join(' -> ');
          console.log('[AI] Decision: Utility AI |', actionSummary);
          console.log('[AI] === Decision End ===');
        }
        return actions;
      }
    } catch (error) {
      if (aiDebug) {
        console.error('[AI] Fallback: Utility AI failed -', error.message);
      }
    }
  }

  // Fall back to legacy AI patterns
  if (aiDebug) {
    console.log('[AI] Fallback: Using legacy pattern -', enemy.aiType || 'aggressive');
  }
  const legacyActions = legacyDecideTurnActions(enemy, battleState);
  if (aiDebug) {
    const actionSummary = legacyActions.map(a => {
      if (a.actionType === 'move') return `move(${a.targetTile?.x},${a.targetTile?.y})`;
      if (a.actionType === 'attack') return `attack(${a.targetTile?.x},${a.targetTile?.y})`;
      if (a.actionType === 'skill') return `skill:${a.skillId}(${a.targetTile?.x},${a.targetTile?.y})`;
      return a.actionType;
    }).join(' -> ');
    console.log('[AI] Decision: Legacy AI |', actionSummary);
    console.log('[AI] === Decision End ===');
  }
  return legacyActions;
}

/**
 * Utility AI decision making
 * Uses sophisticated utility-based scoring with multi-actor lookahead.
 * Now handles action sequences (move + action) for two-action turns.
 * Falls back to quick (no-lookahead) decision if lookahead gives suboptimal results.
 * @param {Object} enemy - The enemy unit
 * @param {Object} battleState - Current battle state
 * @param {boolean} aiDebug - Whether to enable debug logging
 * @returns {Array} Actions array in legacy format
 */
function utilityAIDecision(enemy, battleState, aiDebug = false) {
  // First get a quick decision without lookahead as baseline
  // quickDecision now returns sequences (arrays of actions)
  const quickResult = quickDecision(enemy, battleState, enemy.aiType || 'aggressive');

  // Then try lookahead for potentially better multi-turn planning
  const ai = createAIForUnit(enemy, {
    timeBudgetMs: UTILITY_AI_TIME_BUDGET,
    maxRounds: 2, // 2 rounds lookahead for performance
    useLookahead: true,
    debug: aiDebug // Pass debug flag to utility AI
  });

  const lookaheadDecision = ai.decideTurnActions(enemy, battleState);

  const selection = selectUtilityDecision(
    quickResult,
    lookaheadDecision,
    ai.evaluator,
    enemy,
    battleState
  );
  const bestDecision = selection.decision;
  const decisionSource = selection.source;

  if (aiDebug) {
    console.log('[AI] Source:', decisionSource, '| Score:', bestDecision?.score?.toFixed?.(1) ?? bestDecision?.score);
    if (selection.quickScore !== null && selection.lookaheadImmediateScore !== null) {
      console.log(
        '[AI] Immediate comparison: quick=' +
        selection.quickScore.toFixed(1) +
        ' vs lookahead=' +
        selection.lookaheadImmediateScore.toFixed(1)
      );
    }
  }

  if (!bestDecision || !bestDecision.action) {
    return null;
  }

  // Convert utility AI action format to legacy format
  return convertToLegacyFormat(bestDecision.action, enemy, battleState);
}

/**
 * Convert utility AI action to legacy action format
 * @param {Object} action - Utility AI action
 * @param {Object} enemy - Acting unit
 * @param {Object} battleState - Battle state
 * @returns {Array} Legacy format actions
 */
function convertToLegacyFormat(action, enemy, battleState) {
  const actions = [];

  // Handle array of actions (move + act sequence)
  if (Array.isArray(action)) {
    for (const a of action) {
      const converted = convertSingleAction(a, enemy, battleState);
      if (converted) actions.push(converted);
    }
    return actions.length > 0 ? actions : [{ actionType: 'wait' }];
  }

  // Single action
  const converted = convertSingleAction(action, enemy, battleState);
  return converted ? [converted] : [{ actionType: 'wait' }];
}

/**
 * Convert a single utility AI action to legacy format
 * @param {Object} action - Single utility AI action
 * @param {Object} enemy - Acting unit
 * @param {Object} battleState - Battle state
 * @returns {Object} Legacy format action
 */
function convertSingleAction(action, enemy, _battleState) {
  switch (action.type) {
    case 'move':
      return {
        actionType: 'move',
        targetTile: action.position
      };

    case 'attack':
      // Handle both target formats: {x, y} from getTargetsInRange or {tileX, tileY} from full unit
      return {
        actionType: 'attack',
        targetTile: {
          x: action.target.x ?? action.target.tileX,
          y: action.target.y ?? action.target.tileY
        }
      };

    case 'skill':
      // Handle both target formats: {x, y} from getTargetsInRange or {tileX, tileY} from full unit
      return {
        actionType: 'skill',
        skillId: action.skillId || action.skill?.id,
        targetTile: action.target
          ? {
            x: action.target.x ?? action.target.tileX,
            y: action.target.y ?? action.target.tileY
          }
          : { x: enemy.tileX, y: enemy.tileY }
      };

    case 'wait':
      return { actionType: 'wait' };

    case 'item':
      // Handle item usage (for NPCs with consumables)
      return {
        actionType: 'item',
        itemId: action.itemId || action.item?.itemId,
        targetTile: action.target
          ? {
            x: action.target.x ?? action.target.tileX,
            y: action.target.y ?? action.target.tileY
          }
          : { x: enemy.tileX, y: enemy.tileY }
      };

    default:
      return null;
  }
}

/**
 * Legacy AI decision function (fallback)
 * @param {Object} enemy - The enemy unit
 * @param {Object} battleState - Current battle state
 * @returns {Array} Actions array
 */
function legacyDecideTurnActions(enemy, battleState) {
  const aiType = enemy.aiType || 'aggressive';

  switch (aiType) {
    case 'aggressive':
      return aggressiveTurnAI(enemy, battleState);
    case 'defensive':
      return defensiveTurnAI(enemy, battleState);
    case 'support':
      return supportTurnAI(enemy, battleState);
    case 'tactical':
      return tacticalTurnAI(enemy, battleState);
    case 'pack':
      return packTurnAI(enemy, battleState);
    case 'hit-and-run':
      return hitAndRunTurnAI(enemy, battleState);
    case 'ambush':
      return ambushTurnAI(enemy, battleState);
    default:
      return aggressiveTurnAI(enemy, battleState);
  }
}

// ==================== Two-Action AI Functions ====================

/**
 * Aggressive Turn AI: Move toward target, then attack
 * Strategy: Get close and deal damage
 */
function aggressiveTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return [{ actionType: 'wait' }];

  // Find lowest defense target
  const target = players.reduce((lowest, p) =>
    (getDefense(p) < getDefense(lowest)) ? p : lowest
  );

  const distance = manhattanDistance(enemy, target);
  const attackRange = enemy.attackRange || 1;

  // If already in attack range: attack first (can reposition after if needed)
  if (distance <= attackRange) {
    actions.push({
      actionType: 'attack',
      targetTile: { x: target.tileX, y: target.tileY }
    });
    // Optionally move to better position after attacking
    // (For aggressive AI, we typically don't retreat, so just return)
    return actions;
  }

  // Not in range: move first, then attack if possible
  const moveTile = getMoveTowardTarget(enemy, target, battleState);
  if (moveTile) {
    actions.push({ actionType: 'move', targetTile: moveTile });

    // Check if we're now in attack range after the move
    const newDistance = getManhattanDistance(moveTile.x, moveTile.y, target.tileX, target.tileY);
    if (newDistance <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: target.tileX, y: target.tileY }
      });
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

/**
 * Defensive Turn AI: Protect allies or retreat, then attack if safe
 * Strategy: Prioritize survival and ally protection
 */
function defensiveTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  const allies = getAliveEnemies(battleState).filter(e => e.id !== enemy.id);
  const nearestPlayer = findClosestUnit(enemy, players);
  const attackRange = enemy.attackRange || 1;

  if (isAIDebugEnabled(battleState)) {
    console.log('[AI] Defensive:', enemy.name, '| players:', players.length, '| nearest:', nearestPlayer?.name, '| range:', attackRange, '| move:', enemy.movement);
  }

  // Low HP: retreat first, then attack if in range after retreat
  if (enemy.hp < enemy.maxHp * 0.4) {
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      actions.push({ actionType: 'move', targetTile: retreatTile });

      // Check if any player is in range after retreat
      if (nearestPlayer) {
        const newDist = getManhattanDistance(retreatTile.x, retreatTile.y, nearestPlayer.tileX, nearestPlayer.tileY);
        if (newDist <= attackRange) {
          actions.push({
            actionType: 'attack',
            targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
          });
        }
      }
      return actions;
    }
  }

  // Protect wounded ally: move to protect position
  const woundedAlly = allies.find(a => a.hp < a.maxHp * 0.5);
  if (woundedAlly && nearestPlayer) {
    const protectTile = getProtectTile(woundedAlly, nearestPlayer, battleState);
    if (protectTile && manhattanDistance(enemy, protectTile) > 0) {
      actions.push({ actionType: 'move', targetTile: protectTile });
    }
  }

  // Attack if in range (either from original position or after moving)
  const currentPos = actions.length > 0 && actions[0].actionType === 'move'
    ? actions[0].targetTile
    : { x: enemy.tileX, y: enemy.tileY };

  if (nearestPlayer) {
    const distAfterMove = getManhattanDistance(currentPos.x, currentPos.y, nearestPlayer.tileX, nearestPlayer.tileY);
    if (distAfterMove <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
      });
    }
  }

  // If no actions yet, move toward nearest player cautiously
  if (actions.length === 0 && nearestPlayer) {
    const moveTile = getMoveTowardTarget(enemy, nearestPlayer, battleState, 2);
    if (moveTile) {
      actions.push({ actionType: 'move', targetTile: moveTile });
      const newDist = getManhattanDistance(moveTile.x, moveTile.y, nearestPlayer.tileX, nearestPlayer.tileY);
      if (newDist <= attackRange) {
        actions.push({
          actionType: 'attack',
          targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
        });
      }
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

/**
 * Support Turn AI: Heal/debuff first, then maintain distance
 * Strategy: Support allies and disrupt enemies while staying safe
 */
function supportTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  const allies = getAliveEnemies(battleState);
  const nearestPlayer = findClosestUnit(enemy, players);

  // Priority 1: Heal wounded ally
  const woundedAlly = allies.find(a => a.hp < a.maxHp * 0.6);
  if (woundedAlly && enemy.abilities?.some(a => a.type === 'heal')) {
    actions.push({
      actionType: 'skill',
      skillId: 'heal',
      targetTile: { x: woundedAlly.tileX, y: woundedAlly.tileY }
    });
  }

  // Priority 2: Debuff strongest player (if no heal needed)
  if (actions.length === 0) {
    const strongestPlayer = players.reduce((strongest, p) =>
      (p.strength > strongest.strength) ? p : strongest
    , players[0]);

    if (strongestPlayer && enemy.abilities?.some(a => a.type === 'debuff')) {
      const hasDebuff = strongestPlayer.statusEffects?.length > 0;
      if (!hasDebuff && manhattanDistance(enemy, strongestPlayer) <= 3) {
        actions.push({
          actionType: 'skill',
          skillId: 'debuff',
          targetTile: { x: strongestPlayer.tileX, y: strongestPlayer.tileY }
        });
      }
    }
  }

  // After acting (or if no action taken), maintain distance
  if (nearestPlayer && manhattanDistance(enemy, nearestPlayer) < 3) {
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      actions.push({ actionType: 'move', targetTile: retreatTile });
    }
  }

  // If no other actions, basic attack if in range
  if (actions.length === 0 && nearestPlayer && manhattanDistance(enemy, nearestPlayer) <= (enemy.attackRange || 1)) {
    actions.push({
      actionType: 'attack',
      targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
    });
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

/**
 * Tactical Turn AI: Move to optimal position, then attack weakest target
 * Strategy: Smart positioning and target prioritization
 */
function tacticalTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return [{ actionType: 'wait' }];

  const attackRange = enemy.attackRange || 1;

  // Find weakened target (lowest HP percentage)
  const weakenedTarget = players.reduce((weakest, p) => {
    const currentRatio = p.hp / p.maxHp;
    const weakestRatio = weakest.hp / weakest.maxHp;
    return currentRatio < weakestRatio ? p : weakest;
  });

  // Find best target considering distance and HP
  let bestTarget = null;
  let bestScore = -Infinity;

  for (const player of players) {
    const distance = manhattanDistance(enemy, player);
    const hpRatio = player.hp / player.maxHp;
    const score = (1 - hpRatio) * 50 + (10 - distance) * 10;
    if (score > bestScore) {
      bestScore = score;
      bestTarget = player;
    }
  }

  const target = bestTarget || weakenedTarget;
  const distance = manhattanDistance(enemy, target);

  // If in range, attack first
  if (distance <= attackRange) {
    actions.push({
      actionType: 'attack',
      targetTile: { x: target.tileX, y: target.tileY }
    });
    // Move to reposition after attack (tactical repositioning)
    return actions;
  }

  // Not in range: move first, then attack
  const moveTile = getMoveTowardTarget(enemy, target, battleState);
  if (moveTile) {
    actions.push({ actionType: 'move', targetTile: moveTile });
    const newDist = getManhattanDistance(moveTile.x, moveTile.y, target.tileX, target.tileY);
    if (newDist <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: target.tileX, y: target.tileY }
      });
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

/**
 * Pack Turn AI: Coordinate with allies, move together and attack same target
 * Strategy: Swarm a single target as a group
 */
function packTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  const allies = getAliveEnemies(battleState).filter(e => e.id !== enemy.id);

  if (players.length === 0) return [{ actionType: 'wait' }];

  const attackRange = enemy.attackRange || 1;

  // Find the player that most allies are attacking/near
  let targetPlayer = null;
  let maxAlliesNearby = 0;

  for (const player of players) {
    const alliesNear = allies.filter(a => manhattanDistance(a, player) <= 2).length;
    if (alliesNear > maxAlliesNearby) {
      maxAlliesNearby = alliesNear;
      targetPlayer = player;
    }
  }

  if (!targetPlayer) {
    targetPlayer = findClosestUnit(enemy, players);
  }

  if (!targetPlayer) return [{ actionType: 'wait' }];

  const distance = manhattanDistance(enemy, targetPlayer);

  // If in range, attack first
  if (distance <= attackRange) {
    actions.push({
      actionType: 'attack',
      targetTile: { x: targetPlayer.tileX, y: targetPlayer.tileY }
    });
    return actions;
  }

  // Move toward target, then attack if in range
  const moveTile = getMoveTowardTarget(enemy, targetPlayer, battleState);
  if (moveTile) {
    actions.push({ actionType: 'move', targetTile: moveTile });
    const newDist = getManhattanDistance(moveTile.x, moveTile.y, targetPlayer.tileX, targetPlayer.tileY);
    if (newDist <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: targetPlayer.tileX, y: targetPlayer.tileY }
      });
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

/**
 * Hit-and-Run Turn AI: Attack then retreat (key: attack FIRST, then move away)
 * Strategy: Strike and fade, never stay close
 */
function hitAndRunTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return [{ actionType: 'wait' }];

  const nearestPlayer = findClosestUnit(enemy, players);
  const distToNearest = manhattanDistance(enemy, nearestPlayer);
  const attackRange = enemy.attackRange || 1;

  // If in attack range: ATTACK FIRST, then retreat
  if (distToNearest <= attackRange) {
    actions.push({
      actionType: 'attack',
      targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
    });

    // Retreat after attacking
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      actions.push({ actionType: 'move', targetTile: retreatTile });
    }
    return actions;
  }

  // Not in range: move closer cautiously
  const moveTile = getMoveTowardTarget(enemy, nearestPlayer, battleState, 2);
  if (moveTile) {
    actions.push({ actionType: 'move', targetTile: moveTile });
    // Check if now in range after move
    const newDist = getManhattanDistance(moveTile.x, moveTile.y, nearestPlayer.tileX, nearestPlayer.tileY);
    if (newDist <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
      });
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

/**
 * Ambush Turn AI: Wait hidden, then spring ambush attack
 * Strategy: High damage surprise attack, then switch to tactical
 */
function ambushTurnAI(enemy, battleState) {
  const actions = [];
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return [{ actionType: 'wait' }];

  const nearestPlayer = findClosestUnit(enemy, players);
  const distToNearest = manhattanDistance(enemy, nearestPlayer);
  const attackRange = enemy.attackRange || 1;

  // If still hidden (hasn't attacked yet this battle)
  if (enemy.isHidden && !enemy.hasAmbushed) {
    // Wait for a player to come within ambush range (2 tiles)
    if (distToNearest <= 2) {
      // Move to attack position if needed
      if (distToNearest > attackRange) {
        const moveTile = getMoveTowardTarget(enemy, nearestPlayer, battleState);
        if (moveTile) {
          actions.push({ actionType: 'move', targetTile: moveTile, stayHidden: true });
        }
      }

      // Spring the ambush with attack
      const currentPos = actions.length > 0 ? actions[0].targetTile : { x: enemy.tileX, y: enemy.tileY };
      const newDist = getManhattanDistance(currentPos.x, currentPos.y, nearestPlayer.tileX, nearestPlayer.tileY);
      if (newDist <= attackRange) {
        actions.push({
          actionType: 'attack',
          targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY },
          isAmbush: true,
          revealHidden: true
        });
      }

      return actions.length > 0 ? actions : [{ actionType: 'wait', stayHidden: true }];
    }

    // Stay hidden and wait
    return [{ actionType: 'wait', stayHidden: true }];
  }

  // After ambush or if revealed, switch to tactical behavior
  const weakestPlayer = players.reduce((weakest, p) => {
    const currentRatio = p.hp / p.maxHp;
    const weakestRatio = weakest.hp / weakest.maxHp;
    return currentRatio < weakestRatio ? p : weakest;
  });

  const target = weakestPlayer;
  const distance = manhattanDistance(enemy, target);

  if (distance <= attackRange) {
    actions.push({
      actionType: 'attack',
      targetTile: { x: target.tileX, y: target.tileY }
    });
    return actions;
  }

  // Move toward target, then attack if in range
  const moveTile = getMoveTowardTarget(enemy, target, battleState);
  if (moveTile) {
    actions.push({ actionType: 'move', targetTile: moveTile });
    const newDist = getManhattanDistance(moveTile.x, moveTile.y, target.tileX, target.tileY);
    if (newDist <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: target.tileX, y: target.tileY }
      });
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

// ==================== Utility Functions ====================

function getAlivePlayers(battleState) {
  return battleState.units.filter(u => u.type === 'player' && u.hp > 0);
}

function getAliveEnemies(battleState) {
  return battleState.units.filter(u => u.type === 'enemy' && u.hp > 0);
}

function getDefense(unit) {
  return unit.vitality || unit.agility / 2 || 10;
}

/**
 * Calculate Manhattan distance between two units
 * Wrapper around shared getManhattanDistance for object-based calls
 * @param {Object} a - First unit with tileX, tileY properties
 * @param {Object} b - Second unit with tileX, tileY properties
 * @returns {number} Manhattan distance
 */
function manhattanDistance(a, b) {
  return getManhattanDistance(a.tileX, a.tileY, b.tileX, b.tileY);
}

function findClosestUnit(from, targets) {
  let closest = null;
  let closestDist = Infinity;

  for (const target of targets) {
    const dist = manhattanDistance(from, target);
    if (dist < closestDist) {
      closestDist = dist;
      closest = target;
    }
  }

  return closest;
}

function getMoveTowardTarget(enemy, target, battleState, maxMove = 3) {
  const movement = enemy.movement || maxMove;
  let bestTile = null;
  let bestDistance = manhattanDistance(enemy, target);

  // Check all tiles within movement range
  for (let dx = -movement; dx <= movement; dx++) {
    for (let dy = -movement; dy <= movement; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > movement) continue;
      if (dx === 0 && dy === 0) continue;

      const x = enemy.tileX + dx;
      const y = enemy.tileY + dy;

      // Check if tile is valid (bounds, not occupied, passable terrain)
      if (!isValidMove(x, y, battleState)) continue;

      // Check if tile is actually reachable via pathfinding (considers obstacles in path)
      if (!isReachable(enemy, x, y, battleState)) continue;

      const dist = getManhattanDistance(x, y, target.tileX, target.tileY);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestTile = { x, y };
      }
    }
  }

  return bestTile;
}

function getRetreatTile(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return null;

  const movement = enemy.movement || 3;
  let bestTile = null;
  let bestDistance = 0;

  // Find tile that maximizes distance from all players
  for (let dx = -movement; dx <= movement; dx++) {
    for (let dy = -movement; dy <= movement; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > movement) continue;
      if (dx === 0 && dy === 0) continue;

      const x = enemy.tileX + dx;
      const y = enemy.tileY + dy;

      // Check if tile is valid and reachable via pathfinding
      if (!isValidMove(x, y, battleState)) continue;
      if (!isReachable(enemy, x, y, battleState)) continue;

      const minDistToPlayer = Math.min(...players.map(p =>
        getManhattanDistance(x, y, p.tileX, p.tileY)
      ));

      if (minDistToPlayer > bestDistance) {
        bestDistance = minDistToPlayer;
        bestTile = { x, y };
      }
    }
  }

  return bestTile;
}

function getProtectTile(ally, threat, battleState) {
  // Find tile between ally and threat
  const midX = Math.floor((ally.tileX + threat.tileX) / 2);
  const midY = Math.floor((ally.tileY + threat.tileY) / 2);

  // Search around midpoint for valid tile
  for (let r = 0; r <= 2; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const x = midX + dx;
        const y = midY + dy;
        if (isValidMove(x, y, battleState)) {
          return { x, y };
        }
      }
    }
  }

  return null;
}

function isValidMove(x, y, battleState) {
  // Check bounds (use map dimensions from state, default to 32x32)
  const mapWidth = battleState.mapWidth || 32;
  const mapHeight = battleState.mapHeight || 32;
  if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) return false;

  // Check if tile is occupied by any unit (dead units block movement as corpses)
  const occupied = battleState.units.some(u =>
    u.tileX === x && u.tileY === y
  );
  if (occupied) return false;

  // Check if terrain is passable
  if (battleState.terrain) {
    const terrain = battleState.terrain[y]?.[x];
    if (terrain && ['rock', 'tree', 'lava', 'cliff'].includes(terrain)) {
      return false; // Impassable terrain
    }
  }

  return true;
}

/**
 * Check if a path exists from enemy position to target tile
 * Uses actual pathfinding to account for obstacles
 */
function isReachable(enemy, targetX, targetY, battleState) {
  const movementRange = enemy.movement || 3;
  const pathCost = battleService.calculatePathCost(
    enemy.tileX, enemy.tileY,
    targetX, targetY,
    battleState,
    movementRange
  );
  return pathCost !== Infinity && pathCost <= movementRange;
}

// Export the selection helper for focused regression tests.
export { decideTurnActions, selectUtilityDecision };

export default { decideTurnActions };
