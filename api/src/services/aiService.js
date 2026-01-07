/**
 * AI Service - Enemy decision making for tactical combat
 */

/**
 * Main AI decision function
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

      if (isValidMove(x, y, battleState)) {
        const dist = Math.abs(x - target.tileX) + Math.abs(y - target.tileY);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestTile = { x, y };
        }
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

      if (isValidMove(x, y, battleState)) {
        const minDistToPlayer = Math.min(...players.map(p =>
          Math.abs(x - p.tileX) + Math.abs(y - p.tileY)
        ));

        if (minDistToPlayer > bestDistance) {
          bestDistance = minDistToPlayer;
          bestTile = { x, y };
        }
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

  return !occupied;
}

module.exports = {
  decideAction,
  aggressiveAI,
  defensiveAI,
  supportAI,
  tacticalAI,
  packAI,
  hitAndRunAI,
  ambushAI,
  getAlivePlayers,
  getAliveEnemies,
  findClosestUnit,
  manhattanDistance,
  isValidMove
};
