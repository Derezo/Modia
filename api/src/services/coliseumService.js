/**
 * Coliseum Service - Handles PvP matchmaking and queue management
 */

// Lazy-load websocket to avoid circular dependency
// websocket/index.js imports this file, so we can't destructure at top level
let _websocket = null;
function getWebsocket() {
  if (!_websocket) {
    _websocket = require('../websocket/index');
  }
  return _websocket;
}

// Matchmaking queue: Map of queueType -> Array of { userId, username, partyLevel, partySize, queuedAt }
const matchmakingQueues = new Map();

// Active matches: matchId -> { player1, player2, status, createdAt }
const activeMatches = new Map();

// Queue settings by type
const QUEUE_SETTINGS = {
  '1v1': { minPlayers: 2, maxPlayers: 2, partySize: 1 },
  '3v3': { minPlayers: 2, maxPlayers: 2, partySize: 3 },
  '5v5': { minPlayers: 2, maxPlayers: 2, partySize: 5 }
};

// Match ID counter
let matchIdCounter = 1;

/**
 * Add a player to the matchmaking queue
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {number} partyLevel - Average party level
 * @param {number} partySize - Number of characters in battle party
 * @returns {Object} Queue status
 */
function joinQueue(queueType, userId, username, partyLevel, partySize) {
  const settings = QUEUE_SETTINGS[queueType];
  if (!settings) {
    return { success: false, error: 'Invalid queue type' };
  }

  // Validate party size
  if (partySize > settings.partySize) {
    return { success: false, error: `Maximum ${settings.partySize} characters allowed for ${queueType}` };
  }

  // Initialize queue if needed
  if (!matchmakingQueues.has(queueType)) {
    matchmakingQueues.set(queueType, []);
  }

  const queue = matchmakingQueues.get(queueType);

  // Check if already in queue
  const existingIndex = queue.findIndex(p => p.userId === userId);
  if (existingIndex >= 0) {
    return {
      success: true,
      position: existingIndex + 1,
      estimatedWait: calculateEstimatedWait(queue.length, existingIndex),
      alreadyInQueue: true
    };
  }

  // Add to queue
  const queueEntry = {
    userId,
    username,
    partyLevel,
    partySize,
    queuedAt: Date.now()
  };

  queue.push(queueEntry);

  // Join coliseum room for updates
  const roomName = `coliseum:${queueType}`;
  const { rooms } = getWebsocket();
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(userId);

  // Send queue update to player
  getWebsocket().sendToUser(userId, {
    type: 'coliseum:queue_joined',
    payload: {
      queueType,
      position: queue.length,
      estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
      queueSize: queue.length
    }
  });

  // Try to create a match
  const matchResult = tryMatchmaking(queueType);

  return {
    success: true,
    position: queue.length,
    estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
    queueSize: queue.length,
    matchFound: matchResult.matched
  };
}

/**
 * Remove a player from the matchmaking queue
 * @param {string} queueType - Queue type or null for all queues
 * @param {number} userId - User ID
 * @returns {boolean} Success
 */
function leaveQueue(queueType, userId) {
  if (queueType) {
    return removeFromQueue(queueType, userId);
  }

  // Remove from all queues
  let removed = false;
  matchmakingQueues.forEach((queue, type) => {
    if (removeFromQueue(type, userId)) {
      removed = true;
    }
  });

  return removed;
}

/**
 * Remove a player from a specific queue
 */
function removeFromQueue(queueType, userId) {
  const queue = matchmakingQueues.get(queueType);
  if (!queue) return false;

  const index = queue.findIndex(p => p.userId === userId);
  if (index >= 0) {
    queue.splice(index, 1);

    // Leave coliseum room
    const roomName = `coliseum:${queueType}`;
    const { rooms } = getWebsocket();
    if (rooms.has(roomName)) {
      rooms.get(roomName).delete(userId);
    }

    // Send confirmation
    getWebsocket().sendToUser(userId, {
      type: 'coliseum:queue_left',
      payload: { queueType }
    });

    // Notify others of queue size change
    broadcastQueueUpdate(queueType);

    return true;
  }

  return false;
}

/**
 * Try to create a match from queued players
 * @param {string} queueType - Queue type
 * @returns {Object} Match result
 */
function tryMatchmaking(queueType) {
  const settings = QUEUE_SETTINGS[queueType];
  const queue = matchmakingQueues.get(queueType);

  if (!queue || queue.length < settings.minPlayers) {
    return { matched: false };
  }

  // Simple matchmaking: match first two players in queue
  // TODO: Add skill-based matchmaking using partyLevel

  const player1 = queue.shift();
  const player2 = queue.shift();

  if (!player1 || !player2) {
    // Put player back if only one available
    if (player1) queue.unshift(player1);
    if (player2) queue.unshift(player2);
    return { matched: false };
  }

  // Create match
  const matchId = matchIdCounter++;
  const match = {
    id: matchId,
    queueType,
    player1: {
      userId: player1.userId,
      username: player1.username,
      partyLevel: player1.partyLevel,
      ready: false
    },
    player2: {
      userId: player2.userId,
      username: player2.username,
      partyLevel: player2.partyLevel,
      ready: false
    },
    status: 'pending',
    createdAt: Date.now(),
    readyDeadline: Date.now() + 30000 // 30 seconds to ready up
  };

  activeMatches.set(matchId, match);

  // Notify both players of match found
  const matchPayload = {
    matchId,
    queueType,
    readyDeadline: match.readyDeadline
  };

  getWebsocket().sendToUser(player1.userId, {
    type: 'coliseum:match_found',
    payload: {
      ...matchPayload,
      opponent: {
        username: player2.username,
        partyLevel: player2.partyLevel
      }
    }
  });

  getWebsocket().sendToUser(player2.userId, {
    type: 'coliseum:match_found',
    payload: {
      ...matchPayload,
      opponent: {
        username: player1.username,
        partyLevel: player1.partyLevel
      }
    }
  });

  // Update queue for remaining players
  broadcastQueueUpdate(queueType);

  // Set timeout for ready check
  setTimeout(() => checkMatchReady(matchId), 31000);

  return { matched: true, matchId };
}

/**
 * Player ready confirmation
 * @param {number} matchId - Match ID
 * @param {number} userId - User ID
 * @returns {Object} Result
 */
function playerReady(matchId, userId) {
  const match = activeMatches.get(matchId);
  if (!match) {
    return { success: false, error: 'Match not found' };
  }

  if (match.status !== 'pending') {
    return { success: false, error: 'Match is not in pending state' };
  }

  // Mark player as ready
  if (match.player1.userId === userId) {
    match.player1.ready = true;
  } else if (match.player2.userId === userId) {
    match.player2.ready = true;
  } else {
    return { success: false, error: 'You are not in this match' };
  }

  // Check if both ready
  if (match.player1.ready && match.player2.ready) {
    match.status = 'ready';

    // Notify both players match is ready to start
    const readyPayload = {
      matchId,
      status: 'ready',
      startIn: 3000 // 3 second countdown
    };

    getWebsocket().sendToUser(match.player1.userId, {
      type: 'coliseum:match_ready',
      payload: readyPayload
    });

    getWebsocket().sendToUser(match.player2.userId, {
      type: 'coliseum:match_ready',
      payload: readyPayload
    });

    // Schedule match start
    setTimeout(() => startMatch(matchId), 3000);
  } else {
    // Notify opponent that player is ready
    const opponentId = match.player1.userId === userId
      ? match.player2.userId
      : match.player1.userId;

    getWebsocket().sendToUser(opponentId, {
      type: 'coliseum:opponent_ready',
      payload: { matchId }
    });
  }

  return { success: true, bothReady: match.player1.ready && match.player2.ready };
}

/**
 * Check if match is ready (called after timeout)
 */
function checkMatchReady(matchId) {
  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'pending') return;

  // Match not ready in time - cancel and return players to queue
  const notReadyUsers = [];

  if (!match.player1.ready) notReadyUsers.push(match.player1);
  if (!match.player2.ready) notReadyUsers.push(match.player2);

  // Notify and return ready player to queue
  if (match.player1.ready && !match.player2.ready) {
    getWebsocket().sendToUser(match.player1.userId, {
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason: 'Opponent did not ready' }
    });
    // Re-queue ready player at front
    const queue = matchmakingQueues.get(match.queueType) || [];
    queue.unshift({
      userId: match.player1.userId,
      username: match.player1.username,
      partyLevel: match.player1.partyLevel,
      queuedAt: Date.now()
    });
    if (!matchmakingQueues.has(match.queueType)) {
      matchmakingQueues.set(match.queueType, queue);
    }
  }

  if (match.player2.ready && !match.player1.ready) {
    getWebsocket().sendToUser(match.player2.userId, {
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason: 'Opponent did not ready' }
    });
    const queue = matchmakingQueues.get(match.queueType) || [];
    queue.unshift({
      userId: match.player2.userId,
      username: match.player2.username,
      partyLevel: match.player2.partyLevel,
      queuedAt: Date.now()
    });
    if (!matchmakingQueues.has(match.queueType)) {
      matchmakingQueues.set(match.queueType, queue);
    }
  }

  // Notify non-ready players
  for (const user of notReadyUsers) {
    getWebsocket().sendToUser(user.userId, {
      type: 'coliseum:match_cancelled',
      payload: { matchId, reason: 'Failed to ready in time' }
    });
  }

  // Remove match
  activeMatches.delete(matchId);
}

/**
 * Start the match (create battle)
 */
function startMatch(matchId) {
  const match = activeMatches.get(matchId);
  if (!match || match.status !== 'ready') return;

  match.status = 'started';

  // Notify both players with battle info
  // In a real implementation, this would create a PvP battle in the database
  const battlePayload = {
    matchId,
    status: 'started',
    battleType: 'pvp',
    // battleId would come from database
  };

  getWebsocket().sendToUser(match.player1.userId, {
    type: 'coliseum:match_started',
    payload: battlePayload
  });

  getWebsocket().sendToUser(match.player2.userId, {
    type: 'coliseum:match_started',
    payload: battlePayload
  });
}

/**
 * Calculate estimated wait time
 */
function calculateEstimatedWait(queueSize, position) {
  // Average match time ~5 minutes, so estimate based on position
  const averageMatchTime = 300; // 5 minutes in seconds
  return Math.ceil(position / 2) * averageMatchTime;
}

/**
 * Broadcast queue update to all waiting players
 */
function broadcastQueueUpdate(queueType) {
  const roomName = `coliseum:${queueType}`;
  const queue = matchmakingQueues.get(queueType) || [];

  // Send position updates to each player
  queue.forEach((player, index) => {
    getWebsocket().sendToUser(player.userId, {
      type: 'coliseum:queue_update',
      payload: {
        queueType,
        position: index + 1,
        queueSize: queue.length,
        estimatedWait: calculateEstimatedWait(queue.length, index)
      }
    });
  });
}

/**
 * Get queue status
 * @param {string} queueType - Queue type
 * @returns {Object} Queue status
 */
function getQueueStatus(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];
  return {
    queueType,
    queueSize: queue.length,
    averageWait: calculateEstimatedWait(queue.length, queue.length)
  };
}

/**
 * Get all queue statuses
 */
function getAllQueueStatuses() {
  return Object.keys(QUEUE_SETTINGS).map(type => getQueueStatus(type));
}

/**
 * Clean up player from all coliseum state (on disconnect)
 * @param {number} userId - User ID
 */
function cleanupPlayer(userId) {
  // Remove from all queues
  leaveQueue(null, userId);

  // Cancel any pending matches
  activeMatches.forEach((match, matchId) => {
    if (match.player1.userId === userId || match.player2.userId === userId) {
      if (match.status === 'pending') {
        const opponentId = match.player1.userId === userId
          ? match.player2.userId
          : match.player1.userId;

        getWebsocket().sendToUser(opponentId, {
          type: 'coliseum:match_cancelled',
          payload: { matchId, reason: 'Opponent disconnected' }
        });

        // Re-queue opponent
        const queue = matchmakingQueues.get(match.queueType) || [];
        const opponent = match.player1.userId === userId ? match.player2 : match.player1;
        queue.unshift({
          userId: opponent.userId,
          username: opponent.username,
          partyLevel: opponent.partyLevel,
          queuedAt: Date.now()
        });

        activeMatches.delete(matchId);
      }
    }
  });
}

module.exports = {
  joinQueue,
  leaveQueue,
  playerReady,
  getQueueStatus,
  getAllQueueStatuses,
  cleanupPlayer,
  QUEUE_SETTINGS
};
