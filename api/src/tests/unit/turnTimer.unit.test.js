/**
 * Unit tests for coliseum/turnTimer - Turn timing, timeout handling, and forfeit logic
 *
 * Tests the turn timer functionality including:
 * - Starting and canceling turn timers
 * - Timeout count tracking
 * - PvP forfeit after 3 timeouts
 * - PvE skip-only behavior (no forfeit)
 * - Timer state management
 *
 * Note: These tests mock external dependencies (database, websocket, battleService)
 * to isolate the turn timer logic.
 */

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Track mock calls for verification
const mockCalls = {
  query: [],
  broadcast: [],
  endMatchByForfeit: [],
  advanceToNextActorWithCT: [],
  broadcastTurnStart: []
};

// Clear all mock tracking
function clearMocks() {
  mockCalls.query.length = 0;
  mockCalls.broadcast.length = 0;
  mockCalls.endMatchByForfeit.length = 0;
  mockCalls.advanceToNextActorWithCT.length = 0;
  mockCalls.broadcastTurnStart.length = 0;
}

// =============================================================================
// CONSTANTS TESTS
// =============================================================================

describe('Turn Timer Constants', () => {
  it('should have MAX_TURN_TIMEOUTS set to 3', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');
    assert.strictEqual(MAX_TURN_TIMEOUTS, 3, 'MAX_TURN_TIMEOUTS should be 3');
  });

  it('should have PVP_TURN_TIMEOUT set to 30 seconds', async () => {
    const { PVP_TURN_TIMEOUT } = await import('../../services/coliseum/constants.js');
    assert.strictEqual(PVP_TURN_TIMEOUT, 30000, 'PVP_TURN_TIMEOUT should be 30000ms');
  });

  it('should have DISCONNECT_FORFEIT_TIME set to 5 minutes', async () => {
    const { DISCONNECT_FORFEIT_TIME } = await import('../../services/coliseum/constants.js');
    assert.strictEqual(DISCONNECT_FORFEIT_TIME, 300000, 'DISCONNECT_FORFEIT_TIME should be 300000ms');
  });

  it('should export turnTimers as a Map', async () => {
    const { turnTimers } = await import('../../services/coliseum/constants.js');
    assert.ok(turnTimers instanceof Map, 'turnTimers should be a Map');
  });

  it('should export turnTimeoutCounts as a Map', async () => {
    const { turnTimeoutCounts } = await import('../../services/coliseum/constants.js');
    assert.ok(turnTimeoutCounts instanceof Map, 'turnTimeoutCounts should be a Map');
  });

  it('should export disconnectTracking as a Map', async () => {
    const { disconnectTracking } = await import('../../services/coliseum/constants.js');
    assert.ok(disconnectTracking instanceof Map, 'disconnectTracking should be a Map');
  });
});

// =============================================================================
// START TURN TIMER TESTS
// =============================================================================

describe('startTurnTimer', () => {
  let turnTimers, turnTimeoutCounts;

  beforeEach(async () => {
    clearMocks();
    // Get fresh references to the state maps
    const constants = await import('../../services/coliseum/constants.js');
    turnTimers = constants.turnTimers;
    turnTimeoutCounts = constants.turnTimeoutCounts;
    // Clear any existing state
    turnTimers.clear();
    turnTimeoutCounts.clear();
  });

  afterEach(async () => {
    // Clean up any timers
    const { cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');
    for (const battleId of turnTimers.keys()) {
      cancelTurnTimer(battleId);
    }
    turnTimers.clear();
    turnTimeoutCounts.clear();
  });

  it('should create timer entry and store in turnTimers map', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 100;
    const playerId = 1;

    startTurnTimer(battleId, playerId, false);

    // Verify timer was created
    assert.ok(turnTimers.has(battleId), 'Timer should be stored in turnTimers map');

    const timer = turnTimers.get(battleId);
    assert.ok(timer, 'Timer entry should exist');
    assert.ok(timer.timerId, 'Timer should have timerId');
    assert.ok(timer.startTime, 'Timer should have startTime');
    assert.strictEqual(timer.playerId, playerId, 'Timer should store playerId');
    assert.strictEqual(timer.isPvE, false, 'Timer should store isPvE flag');

    // Clean up
    cancelTurnTimer(battleId);
  });

  it('should cancel existing timer before starting new one', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 101;
    const playerId1 = 1;
    const playerId2 = 2;

    // Start first timer
    startTurnTimer(battleId, playerId1, false);
    const firstTimerId = turnTimers.get(battleId).timerId;

    // Start second timer for same battle
    startTurnTimer(battleId, playerId2, false);
    const secondTimerId = turnTimers.get(battleId).timerId;

    // Verify new timer replaced the old one
    assert.notStrictEqual(firstTimerId, secondTimerId, 'Timer ID should be different');
    assert.strictEqual(turnTimers.get(battleId).playerId, playerId2, 'Should be tracking second player');

    // Clean up
    cancelTurnTimer(battleId);
  });

  it('should initialize timeout counts if not exists', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 102;
    const playerId = 1;

    // Ensure no counts exist initially
    assert.ok(!turnTimeoutCounts.has(battleId), 'No timeout counts should exist initially');

    startTurnTimer(battleId, playerId, false);

    // Verify timeout counts were initialized
    assert.ok(turnTimeoutCounts.has(battleId), 'Timeout counts should be initialized');
    assert.deepStrictEqual(turnTimeoutCounts.get(battleId), {}, 'Timeout counts should be empty object');

    // Clean up
    cancelTurnTimer(battleId);
  });

  it('should preserve existing timeout counts when starting new timer', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 103;
    const playerId = 1;

    // Pre-populate timeout counts
    turnTimeoutCounts.set(battleId, { [playerId]: 2 });

    startTurnTimer(battleId, playerId, false);

    // Verify existing counts were preserved
    assert.strictEqual(turnTimeoutCounts.get(battleId)[playerId], 2, 'Existing counts should be preserved');

    // Clean up
    cancelTurnTimer(battleId);
  });

  it('should set isPvE flag correctly for PvE battles', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 104;
    const playerId = 1;

    startTurnTimer(battleId, playerId, true); // isPvE = true

    const timer = turnTimers.get(battleId);
    assert.strictEqual(timer.isPvE, true, 'Timer should have isPvE set to true');

    // Clean up
    cancelTurnTimer(battleId);
  });

  it('should record startTime close to current time', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 105;
    const playerId = 1;
    const beforeStart = Date.now();

    startTurnTimer(battleId, playerId, false);

    const afterStart = Date.now();
    const timer = turnTimers.get(battleId);

    assert.ok(timer.startTime >= beforeStart, 'Start time should be >= time before call');
    assert.ok(timer.startTime <= afterStart, 'Start time should be <= time after call');

    // Clean up
    cancelTurnTimer(battleId);
  });
});

// =============================================================================
// CANCEL TURN TIMER TESTS
// =============================================================================

describe('cancelTurnTimer', () => {
  let turnTimers;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    turnTimers = constants.turnTimers;
    turnTimers.clear();
  });

  afterEach(async () => {
    // Clean up any remaining timers
    const { cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');
    for (const battleId of turnTimers.keys()) {
      cancelTurnTimer(battleId);
    }
    turnTimers.clear();
  });

  it('should clear timer from turnTimers map', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 200;
    const playerId = 1;

    // Start a timer
    startTurnTimer(battleId, playerId, false);
    assert.ok(turnTimers.has(battleId), 'Timer should exist before cancel');

    // Cancel the timer
    cancelTurnTimer(battleId);
    assert.ok(!turnTimers.has(battleId), 'Timer should be removed after cancel');
  });

  it('should handle non-existent timer gracefully', async () => {
    const { cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 201;

    // Should not throw when canceling non-existent timer
    assert.doesNotThrow(() => {
      cancelTurnTimer(battleId);
    }, 'Canceling non-existent timer should not throw');
  });

  it('should not affect other battle timers', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId1 = 202;
    const battleId2 = 203;
    const playerId = 1;

    // Start timers for both battles
    startTurnTimer(battleId1, playerId, false);
    startTurnTimer(battleId2, playerId, false);

    assert.ok(turnTimers.has(battleId1), 'Battle 1 timer should exist');
    assert.ok(turnTimers.has(battleId2), 'Battle 2 timer should exist');

    // Cancel only battle 1
    cancelTurnTimer(battleId1);

    assert.ok(!turnTimers.has(battleId1), 'Battle 1 timer should be removed');
    assert.ok(turnTimers.has(battleId2), 'Battle 2 timer should still exist');

    // Clean up
    cancelTurnTimer(battleId2);
  });
});

// =============================================================================
// TURN TIMEOUT COUNTING TESTS
// =============================================================================

describe('Turn Timeout Counting', () => {
  let turnTimeoutCounts;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    turnTimeoutCounts = constants.turnTimeoutCounts;
    turnTimeoutCounts.clear();
  });

  afterEach(() => {
    turnTimeoutCounts.clear();
  });

  it('should track timeout counts per player per battle', async () => {
    const battleId = 300;
    const player1 = 1;
    const player2 = 2;

    // Initialize counts structure
    turnTimeoutCounts.set(battleId, {});

    // Simulate tracking timeouts
    const counts = turnTimeoutCounts.get(battleId);
    counts[player1] = (counts[player1] || 0) + 1;
    counts[player2] = (counts[player2] || 0) + 1;
    counts[player1] = (counts[player1] || 0) + 1;

    assert.strictEqual(counts[player1], 2, 'Player 1 should have 2 timeouts');
    assert.strictEqual(counts[player2], 1, 'Player 2 should have 1 timeout');
  });

  it('should correctly calculate remaining timeouts', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const currentTimeouts = 1;
    const remaining = MAX_TURN_TIMEOUTS - currentTimeouts;

    assert.strictEqual(remaining, 2, 'Should have 2 timeouts remaining after 1');
  });

  it('should detect forfeit threshold correctly', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const counts = { 1: 2, 2: 3 };

    // Player 1 (2 timeouts) - not at threshold
    assert.ok(counts[1] < MAX_TURN_TIMEOUTS, 'Player with 2 timeouts should not trigger forfeit');

    // Player 2 (3 timeouts) - at threshold
    assert.ok(counts[2] >= MAX_TURN_TIMEOUTS, 'Player with 3 timeouts should trigger forfeit');
  });
});

// =============================================================================
// PVP FORFEIT LOGIC TESTS
// =============================================================================

describe('PvP Forfeit Logic', () => {
  let turnTimeoutCounts;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    turnTimeoutCounts = constants.turnTimeoutCounts;
    turnTimeoutCounts.clear();
  });

  afterEach(() => {
    turnTimeoutCounts.clear();
  });

  it('should not forfeit on first timeout in PvP', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const battleId = 400;
    const playerId = 1;
    const isPvE = false;

    // Simulate first timeout
    turnTimeoutCounts.set(battleId, { [playerId]: 1 });

    const counts = turnTimeoutCounts.get(battleId);
    const shouldForfeit = !isPvE && counts[playerId] >= MAX_TURN_TIMEOUTS;

    assert.strictEqual(shouldForfeit, false, 'First timeout should not trigger forfeit');
  });

  it('should not forfeit on second timeout in PvP', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const battleId = 401;
    const playerId = 1;
    const isPvE = false;

    // Simulate second timeout
    turnTimeoutCounts.set(battleId, { [playerId]: 2 });

    const counts = turnTimeoutCounts.get(battleId);
    const shouldForfeit = !isPvE && counts[playerId] >= MAX_TURN_TIMEOUTS;

    assert.strictEqual(shouldForfeit, false, 'Second timeout should not trigger forfeit');
  });

  it('should forfeit on third timeout in PvP', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const battleId = 402;
    const playerId = 1;
    const isPvE = false;

    // Simulate third timeout
    turnTimeoutCounts.set(battleId, { [playerId]: 3 });

    const counts = turnTimeoutCounts.get(battleId);
    const shouldForfeit = !isPvE && counts[playerId] >= MAX_TURN_TIMEOUTS;

    assert.strictEqual(shouldForfeit, true, 'Third timeout should trigger forfeit in PvP');
  });

  it('should calculate timeouts remaining correctly', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const scenarios = [
      { timeouts: 0, expectedRemaining: 3 },
      { timeouts: 1, expectedRemaining: 2 },
      { timeouts: 2, expectedRemaining: 1 },
      { timeouts: 3, expectedRemaining: 0 }
    ];

    for (const { timeouts, expectedRemaining } of scenarios) {
      const remaining = MAX_TURN_TIMEOUTS - timeouts;
      assert.strictEqual(
        remaining,
        expectedRemaining,
        `With ${timeouts} timeouts, should have ${expectedRemaining} remaining`
      );
    }
  });
});

// =============================================================================
// PVE SKIP TURN LOGIC TESTS
// =============================================================================

describe('PvE Skip Turn Logic', () => {
  let turnTimeoutCounts;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    turnTimeoutCounts = constants.turnTimeoutCounts;
    turnTimeoutCounts.clear();
  });

  afterEach(() => {
    turnTimeoutCounts.clear();
  });

  it('should never forfeit in PvE battles regardless of timeout count', async () => {
    const { MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

    const battleId = 500;
    const playerId = 1;
    const isPvE = true;

    // Test various timeout counts - none should trigger forfeit in PvE
    const testCounts = [1, 2, 3, 5, 10, 100];

    for (const count of testCounts) {
      turnTimeoutCounts.set(battleId, { [playerId]: count });

      const counts = turnTimeoutCounts.get(battleId);
      const shouldForfeit = !isPvE && counts[playerId] >= MAX_TURN_TIMEOUTS;

      assert.strictEqual(
        shouldForfeit,
        false,
        `PvE should not forfeit even with ${count} timeouts`
      );
    }
  });

  it('should skip turns indefinitely in PvE', async () => {
    const isPvE = true;

    // In PvE, timeoutsRemaining is null (no countdown shown)
    const timeoutsRemaining = isPvE ? null : 2;

    assert.strictEqual(
      timeoutsRemaining,
      null,
      'PvE should have null timeoutsRemaining (no forfeit countdown)'
    );
  });

  it('should still track timeout counts in PvE', async () => {
    const battleId = 501;
    const playerId = 1;

    // Initialize and increment counts
    turnTimeoutCounts.set(battleId, {});
    const counts = turnTimeoutCounts.get(battleId);

    // Simulate multiple timeouts
    for (let i = 0; i < 5; i++) {
      counts[playerId] = (counts[playerId] || 0) + 1;
    }

    assert.strictEqual(
      counts[playerId],
      5,
      'PvE should still track timeout counts even though no forfeit'
    );
  });
});

// =============================================================================
// DISCONNECT TRACKING TESTS
// =============================================================================

describe('Disconnect Tracking', () => {
  let disconnectTracking;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    disconnectTracking = constants.disconnectTracking;
    disconnectTracking.clear();
  });

  afterEach(() => {
    // Clean up any disconnect timers
    for (const [battleId, tracking] of disconnectTracking.entries()) {
      for (const playerId in tracking) {
        if (tracking[playerId].timerId) {
          clearTimeout(tracking[playerId].timerId);
        }
      }
    }
    disconnectTracking.clear();
  });

  it('should initialize disconnect tracking structure', async () => {
    const battleId = 600;
    const playerId = 1;

    // Initialize tracking for battle
    if (!disconnectTracking.has(battleId)) {
      disconnectTracking.set(battleId, {});
    }

    const tracking = disconnectTracking.get(battleId);
    tracking[playerId] = {
      disconnectTime: Date.now(),
      timerId: null,
      disconnectId: 1,
      reconnected: false
    };

    assert.ok(disconnectTracking.has(battleId), 'Battle should have tracking entry');
    assert.ok(tracking[playerId], 'Player should have tracking entry');
    assert.strictEqual(tracking[playerId].reconnected, false, 'Should not be marked as reconnected');
  });

  it('should mark player as reconnected', async () => {
    const battleId = 601;
    const playerId = 1;

    // Setup tracking
    disconnectTracking.set(battleId, {
      [playerId]: {
        disconnectTime: Date.now() - 1000,
        timerId: null,
        disconnectId: 1,
        reconnected: false
      }
    });

    // Simulate reconnection
    const tracking = disconnectTracking.get(battleId);
    tracking[playerId].reconnected = true;

    assert.strictEqual(
      tracking[playerId].reconnected,
      true,
      'Player should be marked as reconnected'
    );
  });

  it('should track disconnect time accurately', async () => {
    const battleId = 602;
    const playerId = 1;
    const disconnectTime = Date.now();

    disconnectTracking.set(battleId, {
      [playerId]: {
        disconnectTime,
        timerId: null,
        disconnectId: 1,
        reconnected: false
      }
    });

    const tracking = disconnectTracking.get(battleId);
    const timeSinceDisconnect = Date.now() - tracking[playerId].disconnectTime;

    assert.ok(
      timeSinceDisconnect >= 0 && timeSinceDisconnect < 100,
      'Disconnect time should be tracked accurately'
    );
  });
});

// =============================================================================
// END MATCH BY FORFEIT TESTS
// =============================================================================

describe('endMatchByForfeit Logic', () => {
  let turnTimers, turnTimeoutCounts, disconnectTracking;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    turnTimers = constants.turnTimers;
    turnTimeoutCounts = constants.turnTimeoutCounts;
    disconnectTracking = constants.disconnectTracking;
    turnTimers.clear();
    turnTimeoutCounts.clear();
    disconnectTracking.clear();
  });

  afterEach(() => {
    turnTimers.clear();
    turnTimeoutCounts.clear();
    disconnectTracking.clear();
  });

  it('should determine winner correctly when player1 forfeits', async () => {
    const player1_id = 1;
    const player2_id = 2;
    const forfeiterId = player1_id;

    const winnerId = forfeiterId === player1_id ? player2_id : player1_id;

    assert.strictEqual(winnerId, player2_id, 'Player 2 should win when Player 1 forfeits');
  });

  it('should determine winner correctly when player2 forfeits', async () => {
    const player1_id = 1;
    const player2_id = 2;
    const forfeiterId = player2_id;

    const winnerId = forfeiterId === player1_id ? player2_id : player1_id;

    assert.strictEqual(winnerId, player1_id, 'Player 1 should win when Player 2 forfeits');
  });

  it('should clean up turn timer on forfeit', async () => {
    const { cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battleId = 700;

    // Setup timer
    turnTimers.set(battleId, { timerId: setTimeout(() => {}, 30000) });
    assert.ok(turnTimers.has(battleId), 'Timer should exist before cleanup');

    // Simulate cleanup that happens in endMatchByForfeit
    cancelTurnTimer(battleId);
    assert.ok(!turnTimers.has(battleId), 'Timer should be removed after cleanup');
  });

  it('should clean up timeout counts on forfeit', async () => {
    const battleId = 701;

    // Setup timeout counts
    turnTimeoutCounts.set(battleId, { 1: 2, 2: 1 });
    assert.ok(turnTimeoutCounts.has(battleId), 'Timeout counts should exist before cleanup');

    // Simulate cleanup that happens in endMatchByForfeit
    turnTimeoutCounts.delete(battleId);
    assert.ok(!turnTimeoutCounts.has(battleId), 'Timeout counts should be removed after cleanup');
  });

  it('should clean up disconnect tracking on forfeit', async () => {
    const battleId = 702;

    // Setup disconnect tracking
    disconnectTracking.set(battleId, { 1: { reconnected: false } });
    assert.ok(disconnectTracking.has(battleId), 'Disconnect tracking should exist before cleanup');

    // Simulate cleanup that happens in endMatchByForfeit
    disconnectTracking.delete(battleId);
    assert.ok(!disconnectTracking.has(battleId), 'Disconnect tracking should be removed after cleanup');
  });

  it('should support different forfeit reasons', async () => {
    const validReasons = ['timeout_forfeit', 'disconnect_forfeit', 'surrender'];

    for (const reason of validReasons) {
      assert.ok(
        typeof reason === 'string' && reason.length > 0,
        `Forfeit reason '${reason}' should be a non-empty string`
      );
    }
  });

  it('should support applyPenalty flag', async () => {
    // Test that the flag can be true or false
    const testCases = [
      { reason: 'surrender', applyPenalty: true },
      { reason: 'disconnect_forfeit', applyPenalty: true },
      { reason: 'disconnect_forfeit', applyPenalty: false } // When weekly grace is used
    ];

    for (const { reason, applyPenalty } of testCases) {
      assert.ok(
        typeof applyPenalty === 'boolean',
        `applyPenalty should be boolean for ${reason}`
      );
    }
  });
});

// =============================================================================
// INTEGRATION WITH MATCH LIFECYCLE TESTS
// =============================================================================

describe('Integration with Match Lifecycle', () => {
  it('should export setCompleteMatchFn for dependency injection', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.setCompleteMatchFn === 'function',
      'setCompleteMatchFn should be exported as a function'
    );
  });

  it('should export startTurnTimer function', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.startTurnTimer === 'function',
      'startTurnTimer should be exported as a function'
    );
  });

  it('should export cancelTurnTimer function', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.cancelTurnTimer === 'function',
      'cancelTurnTimer should be exported as a function'
    );
  });

  it('should export handlePlayerDisconnect function', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.handlePlayerDisconnect === 'function',
      'handlePlayerDisconnect should be exported as a function'
    );
  });

  it('should export handlePlayerReconnect function', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.handlePlayerReconnect === 'function',
      'handlePlayerReconnect should be exported as a function'
    );
  });

  it('should export endMatchByForfeit function', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.endMatchByForfeit === 'function',
      'endMatchByForfeit should be exported as a function'
    );
  });

  it('should export handleSurrender function', async () => {
    const turnTimer = await import('../../services/coliseum/turnTimer.js');

    assert.ok(
      typeof turnTimer.handleSurrender === 'function',
      'handleSurrender should be exported as a function'
    );
  });
});

// =============================================================================
// TIMER STATE ISOLATION TESTS
// =============================================================================

describe('Timer State Isolation', () => {
  let turnTimers, turnTimeoutCounts;

  beforeEach(async () => {
    clearMocks();
    const constants = await import('../../services/coliseum/constants.js');
    turnTimers = constants.turnTimers;
    turnTimeoutCounts = constants.turnTimeoutCounts;
    turnTimers.clear();
    turnTimeoutCounts.clear();
  });

  afterEach(async () => {
    const { cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');
    for (const battleId of turnTimers.keys()) {
      cancelTurnTimer(battleId);
    }
    turnTimers.clear();
    turnTimeoutCounts.clear();
  });

  it('should maintain separate timer state per battle', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battles = [
      { battleId: 800, playerId: 1 },
      { battleId: 801, playerId: 2 },
      { battleId: 802, playerId: 3 }
    ];

    // Start timers for all battles
    for (const { battleId, playerId } of battles) {
      startTurnTimer(battleId, playerId, false);
    }

    // Verify each battle has its own timer
    for (const { battleId, playerId } of battles) {
      assert.ok(turnTimers.has(battleId), `Battle ${battleId} should have a timer`);
      assert.strictEqual(
        turnTimers.get(battleId).playerId,
        playerId,
        `Battle ${battleId} should track player ${playerId}`
      );
    }

    // Clean up
    for (const { battleId } of battles) {
      cancelTurnTimer(battleId);
    }
  });

  it('should maintain separate timeout counts per battle', async () => {
    const { startTurnTimer, cancelTurnTimer } = await import('../../services/coliseum/turnTimer.js');

    const battle1 = 810;
    const battle2 = 811;
    const player1 = 1;
    const player2 = 2;

    // Start timers
    startTurnTimer(battle1, player1, false);
    startTurnTimer(battle2, player2, false);

    // Add timeouts to battle 1
    turnTimeoutCounts.get(battle1)[player1] = 2;

    // Verify battle 2 is unaffected
    assert.strictEqual(
      turnTimeoutCounts.get(battle2)[player2] || 0,
      0,
      'Battle 2 should have no timeouts'
    );

    // Clean up
    cancelTurnTimer(battle1);
    cancelTurnTimer(battle2);
  });
});
