/**
 * @module coliseum/constants
 * @description Shared constants and state maps for the coliseum PvP system.
 *
 * This module centralizes all configuration values and in-memory state used
 * across coliseum modules to avoid circular dependencies.
 */

// PvP Turn Timer Constants
export const PVP_TURN_TIMEOUT = 30000;          // 30 seconds per turn
export const DISCONNECT_FORFEIT_TIME = 300000;  // 5 minutes to reconnect
export const MAX_TURN_TIMEOUTS = 3;             // 3 timeouts = forfeit

// PPR Matchmaking Constants
export const INITIAL_PPR_RANGE = 0.15;          // Initial +/- 15% PPR range
export const PPR_RANGE_EXPANSION = 0.05;        // Expand by 5% every 30 seconds
export const PPR_EXPANSION_INTERVAL = 30000;    // 30 seconds

// Queue settings by type
export const QUEUE_SETTINGS = {
  '1v1': { minPlayers: 2, maxPlayers: 2, partySize: 1 },
  '3v3': { minPlayers: 2, maxPlayers: 2, partySize: 3 },
  '5v5': { minPlayers: 2, maxPlayers: 2, partySize: 5 }
};

// Formation Selection Constants
export const FORMATION_SELECTION_TIMEOUT = 20000;  // 20 seconds to select formation
export const FORMATION_TIMEOUT_BAN_DURATION = 5 * 60 * 1000;  // 5 minutes ban

// =============================================================================
// In-Memory State Maps
// =============================================================================

// Turn timer tracking: battleId -> { timerId, startTime, playerId, isPvE }
export const turnTimers = new Map();

// Turn timeout counts: battleId -> { [playerId]: count }
export const turnTimeoutCounts = new Map();

// Disconnect tracking: battleId -> { [playerId]: { disconnectTime, timerId, disconnectId, reconnected } }
export const disconnectTracking = new Map();

// Matchmaking queue: Map of queueType -> Array of { userId, username, partyLevel, partySize, ppr, queuedAt }
export const matchmakingQueues = new Map();

// Active matches: matchId -> { player1, player2, status, createdAt, battleId, queueType, ... }
export const activeMatches = new Map();

// Match ready check timers: matchId -> timerId (for the 31s ready timeout)
export const matchReadyTimers = new Map();

// Match start timers: matchId -> timerId (for the 3s start delay)
export const matchStartTimers = new Map();

// Formation selection tracking: matchId -> timerId (for 20s formation timeout)
export const formationTimers = new Map();

// Pending formations: matchId -> { [userId]: { formation: {...}, submittedAt: timestamp } }
export const pendingFormations = new Map();

// Match ID counter (mutable)
export const matchIdCounter = { value: 1 };

// =============================================================================
// Lazy-loaded WebSocket module
// =============================================================================

let _websocket = null;

/**
 * Get the websocket module (lazy-loaded to avoid circular dependency)
 * @returns {Promise<Object>} The websocket module
 */
export async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('../../websocket/index.js');
  }
  return _websocket;
}

/**
 * Reset the websocket cache (for test isolation)
 * Clears the cached module reference so tests start fresh
 */
export function _resetWebsocketCache() {
  _websocket = null;
}
