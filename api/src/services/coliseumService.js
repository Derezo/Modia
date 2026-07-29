/**
 * @module coliseumService
 * @description Re-export wrapper for the coliseum PvP system.
 *
 * This file provides backwards compatibility by re-exporting all public
 * functions from the modularized coliseum/ directory.
 *
 * Module structure:
 * - coliseum/constants.js     - Shared constants and state maps
 * - coliseum/matchmaking.js   - Queue management and PPR-based matching
 * - coliseum/matchLifecycle.js - Match creation, ready check, start, completion
 * - coliseum/turnTimer.js     - Turn timing, timeout handling, forfeit
 * - coliseum/queueBroadcaster.js - WebSocket notifications for queues
 * - coliseum/statistics.js    - Leaderboards, match history, snapshots
 *
 * @see coliseum/index.js - Main aggregator module
 */

// Re-export everything from the coliseum module
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
  getPlayerRank,

  // Test cleanup
  _resetForTests
} from './coliseum/index.js';

// Default export for backwards compatibility
export { default } from './coliseum/index.js';
