/**
 * AI Service - Enemy decision making for tactical combat
 * Two-action system: each turn allows 1 move + 1 act (attack/skill)
 *
 * This service now uses utility-based AI with multi-actor lookahead
 * for sophisticated tactical decision making.
 */

// Import pathfinding for obstacle-aware movement decisions
const battleService = require('./battleService');

// Import new utility AI system
const { UtilityAI, createAIForUnit, quickDecision } = require('./ai');

// Configuration for utility AI usage
const USE_UTILITY_AI = true;
const UTILITY_AI_TIME_BUDGET = 450; // ms

/**
 * Main AI decision function (legacy - returns single action)
 * @deprecated Use decideTurnActions instead
 */
function decideAction(enemy, battleState) {
  const aiType = enemy.aiType || 'aggressive';

  switch (aiType) {
    case 'aggressive':
      return aggressiveAI(enemy, battleState);
    case 'defensive':
      return defensiveAI(enemy, battleState);
    case 'support':
      return supportAI(enemy, battleState);
    case 'tactical':
      return tacticalAI(enemy, battleState);
    case 'pack':
      return packAI(enemy, battleState);
    case 'hit-and-run':
      return hitAndRunAI(enemy, battleState);
    case 'ambush':
      return ambushAI(enemy, battleState);
    default:
      return aggressiveAI(enemy, battleState);
  }
}

/**
 * Main AI decision function for two-action turns
 * Returns array of 1-2 actions: [{actionType, targetTile, skillId?}, ...]
 * @param {Object} enemy - The enemy unit making decisions
 * @param {Object} battleState - Current battle state
 * @returns {Array} Array of actions to execute in order
 */
function decideTurnActions(enemy, battleState) {
  // Try utility AI first if enabled
  if (USE_UTILITY_AI) {
    try {
      const actions = utilityAIDecision(enemy, battleState);
      if (actions && actions.length > 0) {
        return actions;
      }
    } catch (error) {
      console.error('[AI] Utility AI failed, falling back to legacy:', error.message);
    }
  }

  // Fall back to legacy AI patterns
  return legacyDecideTurnActions(enemy, battleState);
}

/**
 * Utility AI decision making
 * Uses sophisticated utility-based scoring with multi-actor lookahead
 * @param {Object} enemy - The enemy unit
 * @param {Object} battleState - Current battle state
 * @returns {Array} Actions array in legacy format
 */
function utilityAIDecision(enemy, battleState) {
  const ai = createAIForUnit(enemy, {
    timeBudgetMs: UTILITY_AI_TIME_BUDGET,
    maxRounds: 2, // 2 rounds lookahead for performance
    useLookahead: true
  });

  const decision = ai.decideTurnActions(enemy, battleState);

  if (!decision || !decision.action) {
    return null;
  }

  // Convert utility AI action format to legacy format
  return convertToLegacyFormat(decision.action, enemy, battleState);
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
function convertSingleAction(action, enemy, battleState) {
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
    const newDistance = Math.abs(moveTile.x - target.tileX) + Math.abs(moveTile.y - target.tileY);
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

  // Low HP: retreat first, then attack if in range after retreat
  if (enemy.hp < enemy.maxHp * 0.4) {
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      actions.push({ actionType: 'move', targetTile: retreatTile });

      // Check if any player is in range after retreat
      if (nearestPlayer) {
        const newDist = Math.abs(retreatTile.x - nearestPlayer.tileX) + Math.abs(retreatTile.y - nearestPlayer.tileY);
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
    const distAfterMove = Math.abs(currentPos.x - nearestPlayer.tileX) + Math.abs(currentPos.y - nearestPlayer.tileY);
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
      const newDist = Math.abs(moveTile.x - nearestPlayer.tileX) + Math.abs(moveTile.y - nearestPlayer.tileY);
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
    const newDist = Math.abs(moveTile.x - target.tileX) + Math.abs(moveTile.y - target.tileY);
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
    const newDist = Math.abs(moveTile.x - targetPlayer.tileX) + Math.abs(moveTile.y - targetPlayer.tileY);
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
    const newDist = Math.abs(moveTile.x - nearestPlayer.tileX) + Math.abs(moveTile.y - nearestPlayer.tileY);
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
      const newDist = Math.abs(currentPos.x - nearestPlayer.tileX) + Math.abs(currentPos.y - nearestPlayer.tileY);
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
    const newDist = Math.abs(moveTile.x - target.tileX) + Math.abs(moveTile.y - target.tileY);
    if (newDist <= attackRange) {
      actions.push({
        actionType: 'attack',
        targetTile: { x: target.tileX, y: target.tileY }
      });
    }
  }

  return actions.length > 0 ? actions : [{ actionType: 'wait' }];
}

// ==================== Legacy Single-Action AI Functions ====================

/**
 * Aggressive AI: Target lowest defense, charge forward
 */
function aggressiveAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return { actionType: 'wait' };

  // Find lowest defense target
  const target = players.reduce((lowest, p) =>
    (getDefense(p) < getDefense(lowest)) ? p : lowest
  );

  // Check if in attack range
  const distance = manhattanDistance(enemy, target);
  const attackRange = enemy.attackRange || 1;

  if (distance <= attackRange) {
    return {
      actionType: 'attack',
      targetTile: { x: target.tileX, y: target.tileY }
    };
  }

  // Move toward target
  const moveTile = getMoveTowardTarget(enemy, target, battleState);
  if (moveTile) {
    return {
      actionType: 'move',
      targetTile: moveTile
    };
  }

  return { actionType: 'wait' };
}

/**
 * Defensive AI: Protect allies, retreat at low HP
 */
function defensiveAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  const allies = getAliveEnemies(battleState).filter(e => e.id !== enemy.id);

  // Check if low HP - retreat
  if (enemy.hp < enemy.maxHp * 0.4) {
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      return { actionType: 'move', targetTile: retreatTile };
    }
  }

  // Check for wounded ally to protect
  const woundedAlly = allies.find(a => a.hp < a.maxHp * 0.5);
  if (woundedAlly) {
    // Position between ally and nearest player
    const nearestPlayer = findClosestUnit(woundedAlly, players);
    if (nearestPlayer) {
      const protectTile = getProtectTile(woundedAlly, nearestPlayer, battleState);
      if (protectTile && manhattanDistance(enemy, protectTile) > 0) {
        return { actionType: 'move', targetTile: protectTile };
      }
    }
  }

  // If in range, attack nearest player
  const nearestPlayer = findClosestUnit(enemy, players);
  if (nearestPlayer && manhattanDistance(enemy, nearestPlayer) <= (enemy.attackRange || 1)) {
    return {
      actionType: 'attack',
      targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
    };
  }

  // Move toward nearest player cautiously
  if (nearestPlayer) {
    const moveTile = getMoveTowardTarget(enemy, nearestPlayer, battleState, 2);
    if (moveTile) {
      return { actionType: 'move', targetTile: moveTile };
    }
  }

  return { actionType: 'wait' };
}

/**
 * Support AI: Heal allies, debuff players, stay back
 */
function supportAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  const allies = getAliveEnemies(battleState);

  // Check for wounded ally to heal
  const woundedAlly = allies.find(a => a.hp < a.maxHp * 0.6);
  if (woundedAlly && enemy.abilities?.some(a => a.type === 'heal')) {
    return {
      actionType: 'skill',
      skillId: 'heal',
      targetTile: { x: woundedAlly.tileX, y: woundedAlly.tileY }
    };
  }

  // Try to debuff strongest player
  const strongestPlayer = players.reduce((strongest, p) =>
    (p.strength > strongest.strength) ? p : strongest
  , players[0]);

  if (strongestPlayer && enemy.abilities?.some(a => a.type === 'debuff')) {
    const hasDebuff = strongestPlayer.statusEffects?.length > 0;
    if (!hasDebuff && manhattanDistance(enemy, strongestPlayer) <= 3) {
      return {
        actionType: 'skill',
        skillId: 'debuff',
        targetTile: { x: strongestPlayer.tileX, y: strongestPlayer.tileY }
      };
    }
  }

  // Maintain distance from players
  const nearestPlayer = findClosestUnit(enemy, players);
  if (nearestPlayer && manhattanDistance(enemy, nearestPlayer) < 3) {
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      return { actionType: 'move', targetTile: retreatTile };
    }
  }

  // If no other action, basic attack if in range
  if (nearestPlayer && manhattanDistance(enemy, nearestPlayer) <= (enemy.attackRange || 1)) {
    return {
      actionType: 'attack',
      targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY }
    };
  }

  return { actionType: 'wait' };
}

/**
 * Tactical AI: Focus weakened targets, use terrain
 */
function tacticalAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return { actionType: 'wait' };

  // Find weakened target (lowest HP percentage)
  const weakenedTarget = players.reduce((weakest, p) => {
    const currentRatio = p.hp / p.maxHp;
    const weakestRatio = weakest.hp / weakest.maxHp;
    return currentRatio < weakestRatio ? p : weakest;
  });

  // Prioritize finishing off low HP targets
  if (weakenedTarget.hp < weakenedTarget.maxHp * 0.3) {
    if (manhattanDistance(enemy, weakenedTarget) <= (enemy.attackRange || 1)) {
      return {
        actionType: 'attack',
        targetTile: { x: weakenedTarget.tileX, y: weakenedTarget.tileY }
      };
    }
    // Move to finish them
    const moveTile = getMoveTowardTarget(enemy, weakenedTarget, battleState);
    if (moveTile) {
      return { actionType: 'move', targetTile: moveTile };
    }
  }

  // Otherwise, find best target considering distance and HP
  let bestTarget = null;
  let bestScore = -Infinity;

  for (const player of players) {
    const distance = manhattanDistance(enemy, player);
    const hpRatio = player.hp / player.maxHp;
    // Score: prefer close targets with lower HP
    const score = (1 - hpRatio) * 50 + (10 - distance) * 10;
    if (score > bestScore) {
      bestScore = score;
      bestTarget = player;
    }
  }

  if (bestTarget) {
    if (manhattanDistance(enemy, bestTarget) <= (enemy.attackRange || 1)) {
      return {
        actionType: 'attack',
        targetTile: { x: bestTarget.tileX, y: bestTarget.tileY }
      };
    }
    const moveTile = getMoveTowardTarget(enemy, bestTarget, battleState);
    if (moveTile) {
      return { actionType: 'move', targetTile: moveTile };
    }
  }

  return { actionType: 'wait' };
}

/**
 * Pack AI: Group up with allies, attack together
 */
function packAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  const allies = getAliveEnemies(battleState).filter(e => e.id !== enemy.id);

  if (players.length === 0) return { actionType: 'wait' };

  // Find the player that most allies are attacking
  let targetPlayer = null;
  let maxAlliesNearby = 0;

  for (const player of players) {
    const alliesNear = allies.filter(a => manhattanDistance(a, player) <= 2).length;
    if (alliesNear > maxAlliesNearby) {
      maxAlliesNearby = alliesNear;
      targetPlayer = player;
    }
  }

  // If no coordination yet, find closest player
  if (!targetPlayer) {
    targetPlayer = findClosestUnit(enemy, players);
  }

  if (targetPlayer) {
    if (manhattanDistance(enemy, targetPlayer) <= (enemy.attackRange || 1)) {
      return {
        actionType: 'attack',
        targetTile: { x: targetPlayer.tileX, y: targetPlayer.tileY }
      };
    }

    // Move toward target
    const moveTile = getMoveTowardTarget(enemy, targetPlayer, battleState);
    if (moveTile) {
      return { actionType: 'move', targetTile: moveTile };
    }
  }

  return { actionType: 'wait' };
}

/**
 * Hit-and-Run AI: Attack then retreat to safe distance
 * Good for: bats, harpies, fast creatures
 */
function hitAndRunAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return { actionType: 'wait' };

  const nearestPlayer = findClosestUnit(enemy, players);
  const distToNearest = manhattanDistance(enemy, nearestPlayer);
  const attackRange = enemy.attackRange || 1;
  const preferredDistance = 3; // Wants to stay this far away

  // If close enough to attack, attack then retreat
  if (distToNearest <= attackRange) {
    // Check if we just attacked (hasActed would be true after attack)
    // If we can still move after attacking, we should retreat
    return {
      actionType: 'attack',
      targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY },
      // Signal to battle handler that we want to retreat after attacking
      retreatAfter: true
    };
  }

  // If too close but can't attack, retreat
  if (distToNearest < preferredDistance) {
    const retreatTile = getRetreatTile(enemy, battleState);
    if (retreatTile) {
      return { actionType: 'move', targetTile: retreatTile };
    }
  }

  // If at good distance or far away, approach cautiously
  if (distToNearest > attackRange) {
    // Move toward target but not too aggressively
    const moveTile = getMoveTowardTarget(enemy, nearestPlayer, battleState, 2);
    if (moveTile) {
      // Don't move if it would put us too close
      const newDist = Math.abs(moveTile.x - nearestPlayer.tileX) + Math.abs(moveTile.y - nearestPlayer.tileY);
      if (newDist >= attackRange) {
        return { actionType: 'move', targetTile: moveTile };
      }
    }
  }

  // If nothing else, wait
  return { actionType: 'wait' };
}

/**
 * Ambush AI: Wait hidden, strike with bonus damage when opportunity arises
 * Good for: spiders, assassins, lurking predators
 */
function ambushAI(enemy, battleState) {
  const players = getAlivePlayers(battleState);
  if (players.length === 0) return { actionType: 'wait' };

  const nearestPlayer = findClosestUnit(enemy, players);
  const distToNearest = manhattanDistance(enemy, nearestPlayer);
  const attackRange = enemy.attackRange || 1;

  // If still hidden (hasn't attacked yet this battle)
  if (enemy.isHidden && !enemy.hasAmbushed) {
    // Wait for a player to come within ambush range (2 tiles)
    if (distToNearest <= 2) {
      // Spring the ambush! Attack with bonus damage
      if (distToNearest <= attackRange) {
        return {
          actionType: 'attack',
          targetTile: { x: nearestPlayer.tileX, y: nearestPlayer.tileY },
          isAmbush: true, // Signal +100% damage
          revealHidden: true
        };
      }
      // Move to attack position
      const moveTile = getMoveTowardTarget(enemy, nearestPlayer, battleState);
      if (moveTile) {
        return { actionType: 'move', targetTile: moveTile, stayHidden: true };
      }
    }
    // Stay hidden and wait
    return { actionType: 'wait', stayHidden: true };
  }

  // After ambush or if revealed, switch to tactical behavior
  // Find weakest target
  const weakestPlayer = players.reduce((weakest, p) => {
    const currentRatio = p.hp / p.maxHp;
    const weakestRatio = weakest.hp / weakest.maxHp;
    return currentRatio < weakestRatio ? p : weakest;
  });

  if (manhattanDistance(enemy, weakestPlayer) <= attackRange) {
    return {
      actionType: 'attack',
      targetTile: { x: weakestPlayer.tileX, y: weakestPlayer.tileY }
    };
  }

  // Move toward weakest target
  const moveTile = getMoveTowardTarget(enemy, weakestPlayer, battleState);
  if (moveTile) {
    return { actionType: 'move', targetTile: moveTile };
  }

  return { actionType: 'wait' };
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

function manhattanDistance(a, b) {
  return Math.abs(a.tileX - b.tileX) + Math.abs(a.tileY - b.tileY);
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

      const dist = Math.abs(x - target.tileX) + Math.abs(y - target.tileY);
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
        Math.abs(x - p.tileX) + Math.abs(y - p.tileY)
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

  // Check if tile is occupied by living unit
  const occupied = battleState.units.some(u =>
    u.tileX === x && u.tileY === y && u.hp > 0
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

module.exports = {
  // Primary entry point (uses utility AI with fallback)
  decideTurnActions,
  // Utility AI specific
  utilityAIDecision,
  convertToLegacyFormat,
  // Two-action turn system (legacy patterns)
  legacyDecideTurnActions,
  aggressiveTurnAI,
  defensiveTurnAI,
  supportTurnAI,
  tacticalTurnAI,
  packTurnAI,
  hitAndRunTurnAI,
  ambushTurnAI,
  // Legacy single-action (deprecated)
  decideAction,
  aggressiveAI,
  defensiveAI,
  supportAI,
  tacticalAI,
  packAI,
  hitAndRunAI,
  ambushAI,
  // Utility functions
  getAlivePlayers,
  getAliveEnemies,
  findClosestUnit,
  manhattanDistance,
  isValidMove,
  isReachable,
  // Configuration
  USE_UTILITY_AI
};
