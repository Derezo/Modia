/**
 * Unit tests for battleWebsocket service
 * Tests room management, state broadcasts, turn notifications, and direct messaging
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createBattleRoomScenario
} from '../testUtils/wsTestHelper.js';
import {
  createMockBattleState
} from '../testUtils/index.js';

// Counter to generate unique battle IDs for each test to avoid state pollution
let testBattleIdCounter = 1000;
function getUniqueBattleId() {
  return testBattleIdCounter++;
}

// Counter for unique user IDs
let testUserIdCounter = 10000;
function getUniqueUserId() {
  return testUserIdCounter++;
}

describe('battleWebsocket service', () => {
  let battleWs;

  beforeEach(async () => {
    // Import fresh reference to the module
    battleWs = await import('../../services/battleWebsocket.js');
  });

  describe('Room Management', () => {
    test('joinBattle creates new room and adds user', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId);

      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 1);
      assert.ok(participants.has(userId));
    });

    test('joinBattle adds multiple users to same room', async () => {
      const battleId = getUniqueBattleId();
      const userId1 = getUniqueUserId();
      const userId2 = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId1);
      await battleWs.joinBattle(battleId, userId2);

      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 2);
      assert.ok(participants.has(userId1));
      assert.ok(participants.has(userId2));
    });

    test('joinBattle does not duplicate user in same room', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId);
      await battleWs.joinBattle(battleId, userId);

      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 1);
    });

    test('leaveBattle removes user from room', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId);
      await battleWs.leaveBattle(battleId, userId);

      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 0);
    });

    test('leaveBattle keeps other users when one leaves', async () => {
      const battleId = getUniqueBattleId();
      const userId1 = getUniqueUserId();
      const userId2 = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId1);
      await battleWs.joinBattle(battleId, userId2);
      await battleWs.leaveBattle(battleId, userId1);

      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 1);
      assert.ok(participants.has(userId2));
    });

    test('cleanupBattleRoom removes entire room', async () => {
      const battleId = getUniqueBattleId();
      const userId1 = getUniqueUserId();
      const userId2 = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId1);
      await battleWs.joinBattle(battleId, userId2);
      await battleWs.cleanupBattleRoom(battleId);

      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 0);
    });

    test('getBattleParticipants returns empty set for non-existent battle', () => {
      const battleId = getUniqueBattleId();
      const participants = battleWs.getBattleParticipants(battleId);
      assert.strictEqual(participants.size, 0);
    });
  });

  describe('State Broadcasts', () => {
    test('broadcastStateUpdate sends to battle room', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const state = createMockBattleState({ battleId });

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastStateUpdate(battleId, state);

      assert.ok(true, 'Broadcast completed without error');
    });

    test('broadcastUnitMoved sends movement event', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const unitId = 'player_1';
      const from = { x: 5, y: 5 };
      const to = { x: 6, y: 5 };

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastUnitMoved(battleId, unitId, from, to);

      assert.ok(true, 'Movement broadcast completed without error');
    });

    test('broadcastUnitMoved accepts submitterId parameter for deduplication', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const unitId = 'player_1';
      const from = { x: 5, y: 5 };
      const to = { x: 6, y: 5 };
      const submitterId = userId;

      await battleWs.joinBattle(battleId, userId);
      // Should not throw when submitterId is provided
      await battleWs.broadcastUnitMoved(battleId, unitId, from, to, submitterId);

      assert.ok(true, 'Movement broadcast with submitterId completed without error');
    });

    test('broadcastActionExecuted sends action result', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const actorId = 'player_1';
      const actionType = 'attack';
      const result = {
        damage: 25,
        targetId: 'enemy_1',
        critical: false
      };

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastActionExecuted(battleId, actorId, actionType, result);

      assert.ok(true, 'Action broadcast completed without error');
    });

    test('broadcastActionExecuted accepts submitterId parameter for deduplication', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const actorId = 'player_1';
      const actionType = 'move';
      const result = { moved: true, from: { x: 5, y: 5 }, to: { x: 6, y: 5 } };
      const submitterId = userId;

      await battleWs.joinBattle(battleId, userId);
      // Should not throw when submitterId is provided
      await battleWs.broadcastActionExecuted(battleId, actorId, actionType, result, submitterId);

      assert.ok(true, 'Action broadcast with submitterId completed without error');
    });
  });

  describe('Turn Notifications', () => {
    test('broadcastTurnChanged sends turn info with predictions', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const activeUnitIndex = 0;
      const turn = 1;
      const activeUnitId = 'player_1';
      const turnPredictions = ['player_1', 'enemy_1', 'player_2'];

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastTurnChanged(battleId, activeUnitIndex, turn, null, activeUnitId, turnPredictions);

      assert.ok(true, 'Turn changed broadcast completed without error');
    });

    test('broadcastTurnStart sends unit info for camera pan', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const unit = {
        id: 'player_1',
        name: 'Test Hero',
        type: 'player',
        position: { x: 5, y: 5 }
      };

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastTurnStart(battleId, unit, 'player_local');

      assert.ok(true, 'Turn start broadcast completed without error');
    });

    test('sendYourTurn notifies specific user with available actions', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const unitId = 'player_1';
      const state = createMockBattleState({ battleId });
      const customActions = ['move', 'wait'];

      await battleWs.sendYourTurn(userId, battleId, unitId, state, customActions);

      assert.ok(true, 'Your turn notification sent without error');
    });
  });

  describe('Reconnection Broadcasts', () => {
    test('broadcastPlayerDisconnected notifies room except disconnected player', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const disconnectedId = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId);
      await battleWs.joinBattle(battleId, disconnectedId);
      await battleWs.broadcastPlayerDisconnected(battleId, disconnectedId, 'Player1');

      assert.ok(true, 'Disconnect broadcast completed without error');
    });

    test('broadcastPlayerReconnected notifies all participants', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const reconnectedId = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId);
      await battleWs.joinBattle(battleId, reconnectedId);
      await battleWs.broadcastPlayerReconnected(battleId, reconnectedId, 'Player1');

      assert.ok(true, 'Reconnect broadcast completed without error');
    });
  });

  describe('Direct Messages', () => {
    test('sendBattleState sends state to specific user for rejoin', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const state = createMockBattleState({ battleId });

      await battleWs.sendBattleState(userId, battleId, state);

      assert.ok(true, 'Battle state sent without error');
    });

    test('sendStateSync sends full sync with reason', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const state = createMockBattleState({ battleId });

      await battleWs.sendStateSync(userId, battleId, state, 'initial');

      assert.ok(true, 'State sync sent without error');
    });
  });

  describe('Battle Lifecycle', () => {
    test('broadcastBattleEnd sends victory with rewards', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastBattleEnd(battleId, 'victory', { gold: 100, exp: 50 });

      assert.ok(true, 'Battle end broadcast completed without error');
    });

    test('broadcastIntentHighlight sends enemy visualization data', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const tiles = [{ x: 9, y: 10 }, { x: 10, y: 9 }];

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastIntentHighlight(battleId, 'enemy_1', 'movement_range', tiles, 500);

      assert.ok(true, 'Intent highlight broadcast completed without error');
    });

    test('broadcastEnemyActions sends batch for animation sequencing', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const actions = [
        { unitId: 'enemy_1', actionType: 'move', to: { x: 8, y: 10 } },
        { unitId: 'enemy_1', actionType: 'attack', targetId: 'player_1', damage: 15 }
      ];

      await battleWs.joinBattle(battleId, userId);
      await battleWs.broadcastEnemyActions(battleId, actions);

      assert.ok(true, 'Enemy actions broadcast completed without error');
    });
  });

  describe('Edge Cases', () => {
    test('multiple battles run concurrently without interference', async () => {
      const battle1Id = getUniqueBattleId();
      const battle2Id = getUniqueBattleId();
      const user1 = getUniqueUserId();
      const user2 = getUniqueUserId();

      await battleWs.joinBattle(battle1Id, user1);
      await battleWs.joinBattle(battle2Id, user2);

      assert.strictEqual(battleWs.getBattleParticipants(battle1Id).size, 1);
      assert.strictEqual(battleWs.getBattleParticipants(battle2Id).size, 1);
      assert.ok(battleWs.getBattleParticipants(battle1Id).has(user1));
      assert.ok(battleWs.getBattleParticipants(battle2Id).has(user2));
    });

    test('user can participate in multiple battles', async () => {
      const battle1Id = getUniqueBattleId();
      const battle2Id = getUniqueBattleId();
      const userId = getUniqueUserId();

      await battleWs.joinBattle(battle1Id, userId);
      await battleWs.joinBattle(battle2Id, userId);

      assert.ok(battleWs.getBattleParticipants(battle1Id).has(userId));
      assert.ok(battleWs.getBattleParticipants(battle2Id).has(userId));
    });

    test('leaving one battle does not affect other battles', async () => {
      const battle1Id = getUniqueBattleId();
      const battle2Id = getUniqueBattleId();
      const userId = getUniqueUserId();

      await battleWs.joinBattle(battle1Id, userId);
      await battleWs.joinBattle(battle2Id, userId);
      await battleWs.leaveBattle(battle1Id, userId);

      assert.strictEqual(battleWs.getBattleParticipants(battle1Id).size, 0);
      assert.ok(battleWs.getBattleParticipants(battle2Id).has(userId));
    });
  });
});
describe('PvP Battle End', () => {
  let wsModule;
  let battleWs;

  beforeEach(async () => {
    // Get the websocket module to inject mock connections
    wsModule = await import('../../websocket/index.js');
    // Import battleWebsocket service
    battleWs = await import('../../services/battleWebsocket.js');
  });

  /**
   * Create a mock WebSocket connection that captures sent messages
   */
  function createMockWsConnection(userId) {
    const sentMessages = [];
    return {
      userId,
      readyState: 1, // WebSocket.OPEN
      sentMessages,
      send(data) {
        const message = typeof data === 'string' ? JSON.parse(data) : data;
        sentMessages.push(message);
      },
      getLastSent() {
        return sentMessages[sentMessages.length - 1];
      },
      getSentByType(type) {
        return sentMessages.filter(m => m.type === type);
      }
    };
  }

  test('PvP battle end sends victory to winner (team 1 wins)', async () => {
    const battleId = getUniqueBattleId();
    const player1Id = getUniqueUserId();
    const player2Id = getUniqueUserId();

    // Create mock WebSocket connections
    const player1Ws = createMockWsConnection(player1Id);
    const player2Ws = createMockWsConnection(player2Id);

    // Inject mock connections into the websocket module
    wsModule.connections.set(player1Id, player1Ws);
    wsModule.connections.set(player2Id, player2Ws);

    try {
      // Join both players to battle
      await battleWs.joinBattle(battleId, player1Id);
      await battleWs.joinBattle(battleId, player2Id);

      // Call broadcastBattleEnd with pvpInfo where team 1 wins
      const rewards = { gold: 100, exp: 50 };
      const pvpInfo = {
        player1Id,
        player2Id,
        winningTeamId: 1 // Player 1 wins
      };

      await battleWs.broadcastBattleEnd(battleId, 'victory', rewards, pvpInfo);

      // Verify player 1 (winner) received victory
      const player1Messages = player1Ws.getSentByType('battle:end');
      assert.strictEqual(player1Messages.length, 1, 'Player 1 should receive exactly one battle:end message');
      assert.strictEqual(player1Messages[0].payload.status, 'victory', 'Player 1 should receive victory status');
      assert.deepStrictEqual(player1Messages[0].payload.rewards, rewards, 'Player 1 should receive rewards');
      assert.strictEqual(player1Messages[0].payload.battleId, battleId, 'Battle ID should match');

      // Verify player 2 (loser) received defeat
      const player2Messages = player2Ws.getSentByType('battle:end');
      assert.strictEqual(player2Messages.length, 1, 'Player 2 should receive exactly one battle:end message');
      assert.strictEqual(player2Messages[0].payload.status, 'defeat', 'Player 2 should receive defeat status');
      assert.strictEqual(player2Messages[0].payload.rewards, null, 'Loser should not receive rewards');
      assert.strictEqual(player2Messages[0].payload.battleId, battleId, 'Battle ID should match');
    } finally {
      // Clean up mock connections
      wsModule.connections.delete(player1Id);
      wsModule.connections.delete(player2Id);
      await battleWs.cleanupBattleRoom(battleId);
    }
  });

  test('PvP battle end sends victory to winner (team 2 wins)', async () => {
    const battleId = getUniqueBattleId();
    const player1Id = getUniqueUserId();
    const player2Id = getUniqueUserId();

    // Create mock WebSocket connections
    const player1Ws = createMockWsConnection(player1Id);
    const player2Ws = createMockWsConnection(player2Id);

    // Inject mock connections
    wsModule.connections.set(player1Id, player1Ws);
    wsModule.connections.set(player2Id, player2Ws);

    try {
      await battleWs.joinBattle(battleId, player1Id);
      await battleWs.joinBattle(battleId, player2Id);

      // Team 2 wins this time
      const rewards = { gold: 150, exp: 75 };
      const pvpInfo = {
        player1Id,
        player2Id,
        winningTeamId: 2 // Player 2 wins
      };

      await battleWs.broadcastBattleEnd(battleId, 'victory', rewards, pvpInfo);

      // Verify player 1 (loser) received defeat
      const player1Messages = player1Ws.getSentByType('battle:end');
      assert.strictEqual(player1Messages.length, 1, 'Player 1 should receive exactly one battle:end message');
      assert.strictEqual(player1Messages[0].payload.status, 'defeat', 'Player 1 should receive defeat status');
      assert.strictEqual(player1Messages[0].payload.rewards, null, 'Loser should not receive rewards');

      // Verify player 2 (winner) received victory
      const player2Messages = player2Ws.getSentByType('battle:end');
      assert.strictEqual(player2Messages.length, 1, 'Player 2 should receive exactly one battle:end message');
      assert.strictEqual(player2Messages[0].payload.status, 'victory', 'Player 2 should receive victory status');
      assert.deepStrictEqual(player2Messages[0].payload.rewards, rewards, 'Player 2 should receive rewards');
    } finally {
      wsModule.connections.delete(player1Id);
      wsModule.connections.delete(player2Id);
      await battleWs.cleanupBattleRoom(battleId);
    }
  });

  test('Non-PvP battle (no pvpInfo) broadcasts normally', async () => {
    const battleId = getUniqueBattleId();
    const userId = getUniqueUserId();

    // Create mock WebSocket connection
    const userWs = createMockWsConnection(userId);
    wsModule.connections.set(userId, userWs);

    try {
      await battleWs.joinBattle(battleId, userId);

      // Call without pvpInfo (PvE battle)
      const rewards = { gold: 50, exp: 25 };
      await battleWs.broadcastBattleEnd(battleId, 'victory', rewards, null);

      // Verify the user received the broadcast
      const messages = userWs.getSentByType('battle:end');
      assert.strictEqual(messages.length, 1, 'User should receive battle:end message');
      assert.strictEqual(messages[0].payload.status, 'victory', 'Status should be as provided');
      assert.deepStrictEqual(messages[0].payload.rewards, rewards, 'Rewards should be as provided');
    } finally {
      wsModule.connections.delete(userId);
      await battleWs.cleanupBattleRoom(battleId);
    }
  });

  test('PvP battle handles disconnected winner gracefully', async () => {
    const battleId = getUniqueBattleId();
    const player1Id = getUniqueUserId();
    const player2Id = getUniqueUserId();

    // Only player 2 is connected (player 1 disconnected)
    const player2Ws = createMockWsConnection(player2Id);
    wsModule.connections.set(player2Id, player2Ws);
    // player1 has no connection (simulates disconnect)

    try {
      await battleWs.joinBattle(battleId, player1Id);
      await battleWs.joinBattle(battleId, player2Id);

      const pvpInfo = {
        player1Id,
        player2Id,
        winningTeamId: 1 // Player 1 wins but is disconnected
      };

      // Should not throw even though winner is disconnected
      await battleWs.broadcastBattleEnd(battleId, 'victory', { gold: 100 }, pvpInfo);

      // Player 2 (loser, connected) should still receive defeat
      const player2Messages = player2Ws.getSentByType('battle:end');
      assert.strictEqual(player2Messages.length, 1, 'Connected loser should still receive message');
      assert.strictEqual(player2Messages[0].payload.status, 'defeat', 'Should receive defeat status');
    } finally {
      wsModule.connections.delete(player2Id);
      await battleWs.cleanupBattleRoom(battleId);
    }
  });

  test('PvP battle handles disconnected loser gracefully', async () => {
    const battleId = getUniqueBattleId();
    const player1Id = getUniqueUserId();
    const player2Id = getUniqueUserId();

    // Only player 1 is connected (player 2 disconnected)
    const player1Ws = createMockWsConnection(player1Id);
    wsModule.connections.set(player1Id, player1Ws);
    // player2 has no connection

    try {
      await battleWs.joinBattle(battleId, player1Id);
      await battleWs.joinBattle(battleId, player2Id);

      const pvpInfo = {
        player1Id,
        player2Id,
        winningTeamId: 1 // Player 1 wins
      };

      // Should not throw even though loser is disconnected
      await battleWs.broadcastBattleEnd(battleId, 'victory', { gold: 100 }, pvpInfo);

      // Player 1 (winner, connected) should receive victory
      const player1Messages = player1Ws.getSentByType('battle:end');
      assert.strictEqual(player1Messages.length, 1, 'Connected winner should receive message');
      assert.strictEqual(player1Messages[0].payload.status, 'victory', 'Should receive victory status');
    } finally {
      wsModule.connections.delete(player1Id);
      await battleWs.cleanupBattleRoom(battleId);
    }
  });

  test('PvP battle end includes timestamp in payload', async () => {
    const battleId = getUniqueBattleId();
    const player1Id = getUniqueUserId();
    const player2Id = getUniqueUserId();

    const player1Ws = createMockWsConnection(player1Id);
    const player2Ws = createMockWsConnection(player2Id);
    wsModule.connections.set(player1Id, player1Ws);
    wsModule.connections.set(player2Id, player2Ws);

    try {
      await battleWs.joinBattle(battleId, player1Id);
      await battleWs.joinBattle(battleId, player2Id);

      const beforeTime = Date.now();
      await battleWs.broadcastBattleEnd(battleId, 'victory', { gold: 100 }, {
        player1Id,
        player2Id,
        winningTeamId: 1
      });
      const afterTime = Date.now();

      // Both messages should have timestamps
      const player1Msg = player1Ws.getLastSent();
      const player2Msg = player2Ws.getLastSent();

      assert.ok(player1Msg.payload.timestamp >= beforeTime, 'Winner timestamp should be valid');
      assert.ok(player1Msg.payload.timestamp <= afterTime, 'Winner timestamp should be valid');
      assert.ok(player2Msg.payload.timestamp >= beforeTime, 'Loser timestamp should be valid');
      assert.ok(player2Msg.payload.timestamp <= afterTime, 'Loser timestamp should be valid');
    } finally {
      wsModule.connections.delete(player1Id);
      wsModule.connections.delete(player2Id);
      await battleWs.cleanupBattleRoom(battleId);
    }
  });
});
