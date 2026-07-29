/**
 * @module coliseum
 * @description Aggregates all coliseum PvP system exports.
 *
 * This is the main entry point for the coliseum module. It re-exports all
 * public functions from the sub-modules for backwards compatibility.
 *
 * Module structure:
 * - constants.js     - Shared constants and state maps
 * - matchmaking.js   - Queue management and PPR-based matching
 * - matchLifecycle.js - Match creation, ready check, start, completion
 * - turnTimer.js     - Turn timing, timeout handling, forfeit
 * - queueBroadcaster.js - WebSocket notifications for queues
 * - statistics.js    - Leaderboards, match history, snapshots
 */

// Constants and settings
import {
  QUEUE_SETTINGS,
  PVP_TURN_TIMEOUT,
  DISCONNECT_FORFEIT_TIME,
  MAX_TURN_TIMEOUTS,
  turnTimers,
  turnTimeoutCounts,
  disconnectTracking,
  matchmakingQueues,
  activeMatches,
  matchReadyTimers,
  matchStartTimers,
  formationTimers,
  pendingFormations,
  _resetWebsocketCache
} from './constants.js';

// Queue management
import {
  joinQueue,
  leaveQueue,
  cleanupPlayer,
  arePlayersMatchable,
  tryMatchmaking
} from './matchmaking.js';

// Match lifecycle
import {
  createMatch,
  playerReady,
  cancelMatch,
  completeMatch,
  publishColiseumMatchResultEvents,
  submitFormation,
  applyQueueBan,
  checkQueueBan
} from './matchLifecycle.js';

// Turn timer management
import {
  startTurnTimer,
  cancelTurnTimer,
  handlePlayerDisconnect,
  handlePlayerReconnect,
  endMatchByForfeit,
  handleSurrender
} from './turnTimer.js';

// Queue broadcasting
import {
  getQueueStatus,
  getAllQueueStatuses,
  getQueuePlayers,
  broadcastQueueUpdate,
  broadcastGlobalQueueStatus,
  broadcastQueuePlayersUpdate,
  calculateEstimatedWait,
  obfuscateUserId
} from './queueBroadcaster.js';

// Statistics and history
import {
  captureTeamSnapshots,
  calculateMatchStats,
  getLeaderboard,
  getMatchHistory,
  getMatchDetails,
  getPlayerRank
} from './statistics.js';

// Re-export everything
export {
  // Constants
  QUEUE_SETTINGS,
  PVP_TURN_TIMEOUT,
  DISCONNECT_FORFEIT_TIME,
  MAX_TURN_TIMEOUTS,

  // Queue management
  joinQueue,
  leaveQueue,
  cleanupPlayer,
  arePlayersMatchable,
  tryMatchmaking,

  // Match lifecycle
  createMatch,
  playerReady,
  cancelMatch,
  completeMatch,
  publishColiseumMatchResultEvents,
  submitFormation,
  applyQueueBan,
  checkQueueBan,

  // Turn timer
  startTurnTimer,
  cancelTurnTimer,
  handlePlayerDisconnect,
  handlePlayerReconnect,
  endMatchByForfeit,
  handleSurrender,

  // Queue broadcasting
  getQueueStatus,
  getAllQueueStatuses,
  getQueuePlayers,
  broadcastQueueUpdate,
  broadcastGlobalQueueStatus,
  broadcastQueuePlayersUpdate,
  calculateEstimatedWait,
  obfuscateUserId,

  // Statistics
  captureTeamSnapshots,
  calculateMatchStats,
  getLeaderboard,
  getMatchHistory,
  getMatchDetails,
  getPlayerRank
};

/**
 * Reset all internal state and cancel all timers (for test cleanup)
 * @private - Only for testing
 */
export function _resetForTests() {
  // Cancel match ready timers
  for (const timerId of matchReadyTimers.values()) {
    clearTimeout(timerId);
  }
  matchReadyTimers.clear();

  // Cancel match start timers
  for (const timerId of matchStartTimers.values()) {
    clearTimeout(timerId);
  }
  matchStartTimers.clear();

  // Cancel formation timers
  for (const timerId of formationTimers.values()) {
    clearTimeout(timerId);
  }
  formationTimers.clear();

  // Clear pending formations
  pendingFormations.clear();

  // Cancel turn timers
  for (const timer of turnTimers.values()) {
    clearTimeout(timer.timerId);
  }
  turnTimers.clear();

  // Cancel disconnect tracking timers
  for (const tracking of disconnectTracking.values()) {
    for (const playerTracking of Object.values(tracking)) {
      if (playerTracking.timerId) {
        clearTimeout(playerTracking.timerId);
      }
    }
  }
  disconnectTracking.clear();

  // Clear remaining state
  turnTimeoutCounts.clear();
  matchmakingQueues.clear();
  activeMatches.clear();

  // Reset the websocket cache to ensure clean state for next test
  _resetWebsocketCache();
}

// Default export for backwards compatibility with `import coliseumService from`
export default {
  // Queue management
  joinQueue,
  leaveQueue,
  cleanupPlayer,

  // Match lifecycle
  playerReady,
  completeMatch,
  submitFormation,
  checkQueueBan,

  // Queue status
  getQueueStatus,
  getAllQueueStatuses,
  getQueuePlayers,
  broadcastGlobalQueueStatus,

  // Turn timer
  startTurnTimer,
  cancelTurnTimer,

  // Constants
  QUEUE_SETTINGS,
  PVP_TURN_TIMEOUT,

  // Test cleanup
  _resetForTests
};
