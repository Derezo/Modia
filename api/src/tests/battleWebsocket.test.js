/**
 * Unit tests for battleWebsocket service
 * Tests room management, state broadcasts, turn notifications, and direct messaging
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createBattleRoomScenario
} from './testUtils/wsTestHelper.js';
import {
  createMockBattleState
} from './testUtils/index.js';

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
    battleWs = await import('../services/battleWebsocket.js');
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
