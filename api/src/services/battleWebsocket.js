/**
 * Battle WebSocket Service - Handles real-time battle event broadcasting
 */

// Lazy-load websocket to avoid circular dependency
let _websocket = null;
async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('../websocket/index.js');
  }
  return _websocket;
}

// Track battle rooms: battleId -> Set of userIds
const battleRooms = new Map();

/**
 * Join a user to a battle room
 * @param {number} battleId - Battle ID
 * @param {number} userId - User ID
 */
async function joinBattle(battleId, userId) {
  const roomName = `battle:${battleId}`;

  if (!battleRooms.has(battleId)) {
    battleRooms.set(battleId, new Set());
  }
  battleRooms.get(battleId).add(userId);

  // Also add to WebSocket room system
  const ws = await getWebsocket();
  const { rooms } = ws;
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(userId);
}

/**
 * Remove a user from a battle room
 * @param {number} battleId - Battle ID
 * @param {number} userId - User ID
 */
async function leaveBattle(battleId, userId) {
  const roomName = `battle:${battleId}`;

  if (battleRooms.has(battleId)) {
    battleRooms.get(battleId).delete(userId);
    if (battleRooms.get(battleId).size === 0) {
      battleRooms.delete(battleId);
    }
  }

  // Remove from WebSocket room
  const ws = await getWebsocket();
  const { rooms } = ws;
  if (rooms.has(roomName)) {
    rooms.get(roomName).delete(userId);
    if (rooms.get(roomName).size === 0) {
      rooms.delete(roomName);
    }
  }
}

/**
 * Broadcast battle state update to all participants
 * @param {number} battleId - Battle ID
 * @param {Object} state - Full battle state
 * @param {number} excludeUserId - Optional user to exclude from broadcast
 */
async function broadcastStateUpdate(battleId, state, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:state_update',
    payload: {
      battleId,
      state,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Broadcast unit movement event
 * @param {number} battleId - Battle ID
 * @param {number} unitId - Unit that moved
 * @param {Object} from - Previous position { x, y }
 * @param {Object} to - New position { x, y }
 * @param {number} excludeUserId - Optional user to exclude
 */
async function broadcastUnitMoved(battleId, unitId, from, to, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:unit_moved',
    payload: {
      battleId,
      unitId,
      from,
      to,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Broadcast action execution result
 * @param {number} battleId - Battle ID
 * @param {number} actorId - Unit that performed action
 * @param {string} actionType - Type of action (attack, skill, wait)
 * @param {Object} result - Action result (damage, missed, etc.)
 * @param {number} excludeUserId - Optional user to exclude
 */
async function broadcastActionExecuted(battleId, actorId, actionType, result, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:action_executed',
    payload: {
      battleId,
      actorId,
      actionType,
      result,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Broadcast turn change event
 * @param {number} battleId - Battle ID
 * @param {number} activeUnitIndex - New active unit index
 * @param {number} turn - Current turn number
 * @param {number} excludeUserId - Optional user to exclude
 * @param {string} activeUnitId - ID of the active unit (CT system)
 * @param {Array} turnPredictions - Predicted next 10 turns
 */
async function broadcastTurnChanged(battleId, activeUnitIndex, turn, excludeUserId = null, activeUnitId = null, turnPredictions = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:turn_changed',
    payload: {
      battleId,
      activeUnitIndex,
      activeUnitId,
      turn,
      turnPredictions,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Broadcast turn start event (new protocol - triggers camera pan)
 * @param {number} battleId - Battle ID
 * @param {Object} unit - Active unit info { id, name, type, position }
 * @param {string} unitType - 'player_local' | 'player_remote' | 'enemy'
 * @param {Array} turnPredictions - Predicted next 10 turns
 */
async function broadcastTurnStart(battleId, unit, unitType, turnPredictions = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:turn_start',
    payload: {
      battleId,
      unitId: unit.id,
      unitName: unit.name,
      unitType,
      position: unit.position,
      turnPredictions,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast intent highlight for enemy visualization
 * @param {number} battleId - Battle ID
 * @param {string} unitId - Unit showing intent
 * @param {string} highlightType - 'movement_range' | 'attack_range' | 'target_path' | 'target_tile' | 'aoe'
 * @param {Array} tiles - Array of { x, y } tile positions
 * @param {number} duration - How long to show highlight (ms)
 */
async function broadcastIntentHighlight(battleId, unitId, highlightType, tiles, duration = 500) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:intent_highlight',
    payload: {
      battleId,
      unitId,
      highlightType,
      tiles,
      duration,
      timestamp: Date.now()
    }
  });
}

/**
 * Send "your turn" notification to a specific player
 * @param {number} userId - User whose turn it is
 * @param {number} battleId - Battle ID
 * @param {string} unitId - Active unit ID
 * @param {Object} state - Current battle state
 * @param {Array} availableActions - List of available actions
 */
async function sendYourTurn(userId, battleId, unitId, state, availableActions = ['move', 'attack', 'skill', 'item', 'wait']) {
  const ws = await getWebsocket();
  ws.sendToUser(userId, {
    type: 'battle:your_turn',
    payload: {
      battleId,
      unitId,
      state,
      availableActions,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast player disconnection
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Disconnected player's user ID
 * @param {string} playerName - Disconnected player's name
 */
async function broadcastPlayerDisconnected(battleId, playerId, playerName) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:player_disconnected',
    payload: {
      battleId,
      playerId,
      playerName,
      timestamp: Date.now()
    }
  }, playerId);  // Don't send to the disconnected player
}

/**
 * Broadcast player reconnection
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Reconnected player's user ID
 * @param {string} playerName - Reconnected player's name
 */
async function broadcastPlayerReconnected(battleId, playerId, playerName) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:player_reconnected',
    payload: {
      battleId,
      playerId,
      playerName,
      timestamp: Date.now()
    }
  });
}

/**
 * Send full state sync to a specific user (for reconnection)
 * @param {number} userId - User to sync
 * @param {number} battleId - Battle ID
 * @param {Object} state - Full battle state
 * @param {string} reason - 'reconnect' | 'resync' | 'initial'
 */
async function sendStateSync(userId, battleId, state, reason = 'reconnect') {
  const ws = await getWebsocket();
  ws.sendToUser(userId, {
    type: 'battle:state_sync',
    payload: {
      battleId,
      state,
      reason,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast battle end event
 * @param {number} battleId - Battle ID
 * @param {string} status - 'victory' | 'defeat'
 * @param {Object} rewards - Rewards data (gold, exp, items)
 */
async function broadcastBattleEnd(battleId, status, rewards = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:end',
    payload: {
      battleId,
      status,
      rewards,
      timestamp: Date.now()
    }
  });

  // Clean up battle room after broadcast
  setTimeout(() => {
    cleanupBattleRoom(battleId);
  }, 5000);
}

/**
 * Broadcast boss phase transition to all participants
 * @param {number} battleId - Battle ID
 * @param {Object} transition - Phase transition data
 */
async function broadcastPhaseTransition(battleId, transition) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:phase_transition',
    payload: {
      battleId,
      ...transition,
      timestamp: Date.now()
    }
  });
}

/**
 * Send battle state to a specific user (for rejoin)
 * @param {number} userId - User ID
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 */
async function sendBattleState(userId, battleId, state) {
  const ws = await getWebsocket();
  ws.sendToUser(userId, {
    type: 'battle:state_update',
    payload: {
      battleId,
      state,
      rejoined: true,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast enemy actions batch (for animation sequencing)
 * @param {number} battleId - Battle ID
 * @param {Array} enemyActions - Array of enemy action results
 * @param {number} excludeUserId - Optional user to exclude
 */
async function broadcastEnemyActions(battleId, enemyActions, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:enemy_actions',
    payload: {
      battleId,
      actions: enemyActions,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Clean up battle room
 * @param {number} battleId - Battle ID
 */
async function cleanupBattleRoom(battleId) {
  const roomName = `battle:${battleId}`;

  if (battleRooms.has(battleId)) {
    battleRooms.delete(battleId);
  }

  const ws = await getWebsocket();
  const { rooms } = ws;
  if (rooms.has(roomName)) {
    rooms.delete(roomName);
  }
}

/**
 * Get users in a battle room
 * @param {number} battleId - Battle ID
 * @returns {Set<number>} Set of user IDs
 */
function getBattleParticipants(battleId) {
  return battleRooms.get(battleId) || new Set();
}

export {
  // Room management
  joinBattle,
  leaveBattle,
  cleanupBattleRoom,
  getBattleParticipants,

  // State updates
  broadcastStateUpdate,
  sendBattleState,
  sendStateSync,

  // Turn-based protocol (new)
  broadcastTurnStart,
  broadcastTurnChanged,
  broadcastIntentHighlight,
  sendYourTurn,

  // Action events
  broadcastUnitMoved,
  broadcastActionExecuted,
  broadcastEnemyActions,

  // Battle lifecycle
  broadcastBattleEnd,
  broadcastPhaseTransition,
  broadcastPlayerDisconnected,
  broadcastPlayerReconnected
};

export default {
  joinBattle,
  leaveBattle,
  cleanupBattleRoom,
  getBattleParticipants,
  broadcastStateUpdate,
  sendBattleState,
  sendStateSync,
  broadcastTurnStart,
  broadcastTurnChanged,
  broadcastIntentHighlight,
  sendYourTurn,
  broadcastUnitMoved,
  broadcastActionExecuted,
  broadcastEnemyActions,
  broadcastBattleEnd,
  broadcastPhaseTransition,
  broadcastPlayerDisconnected,
  broadcastPlayerReconnected
};
