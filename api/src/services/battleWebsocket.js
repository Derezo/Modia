/**
 * Battle WebSocket Service - Handles real-time battle event broadcasting
 */

// Lazy-load websocket to avoid circular dependency
let _websocket = null;
function getWebsocket() {
  if (!_websocket) {
    _websocket = require('../websocket/index');
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
function joinBattle(battleId, userId) {
  const roomName = `battle:${battleId}`;

  if (!battleRooms.has(battleId)) {
    battleRooms.set(battleId, new Set());
  }
  battleRooms.get(battleId).add(userId);

  // Also add to WebSocket room system
  const { rooms } = getWebsocket();
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
function leaveBattle(battleId, userId) {
  const roomName = `battle:${battleId}`;

  if (battleRooms.has(battleId)) {
    battleRooms.get(battleId).delete(userId);
    if (battleRooms.get(battleId).size === 0) {
      battleRooms.delete(battleId);
    }
  }

  // Remove from WebSocket room
  const { rooms } = getWebsocket();
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
function broadcastStateUpdate(battleId, state, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
function broadcastUnitMoved(battleId, unitId, from, to, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
function broadcastActionExecuted(battleId, actorId, actionType, result, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
function broadcastTurnChanged(battleId, activeUnitIndex, turn, excludeUserId = null, activeUnitId = null, turnPredictions = null) {
  const roomName = `battle:${battleId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
 * Broadcast battle end event
 * @param {number} battleId - Battle ID
 * @param {string} status - 'victory' | 'defeat'
 * @param {Object} rewards - Rewards data (gold, exp, items)
 */
function broadcastBattleEnd(battleId, status, rewards = null) {
  const roomName = `battle:${battleId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
 * Send battle state to a specific user (for rejoin)
 * @param {number} userId - User ID
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 */
function sendBattleState(userId, battleId, state) {
  getWebsocket().sendToUser(userId, {
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
function broadcastEnemyActions(battleId, enemyActions, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
function cleanupBattleRoom(battleId) {
  const roomName = `battle:${battleId}`;

  if (battleRooms.has(battleId)) {
    battleRooms.delete(battleId);
  }

  const { rooms } = getWebsocket();
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

module.exports = {
  joinBattle,
  leaveBattle,
  broadcastStateUpdate,
  broadcastUnitMoved,
  broadcastActionExecuted,
  broadcastTurnChanged,
  broadcastBattleEnd,
  sendBattleState,
  broadcastEnemyActions,
  cleanupBattleRoom,
  getBattleParticipants
};
