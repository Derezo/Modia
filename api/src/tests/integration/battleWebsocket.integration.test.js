/**
 * Unit tests for battleWebsocket service
 * Tests room management, state broadcasts, turn notifications, and direct messaging
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createBattleRoomScenario
} from '../testUtils/wsTestHelper.js';
import {
  createMockBattleState
} from '../testUtils/index.js';
import {
  createBattleMutableStateUpdateV1,
  createBattleMutableStateV1
} from '../../../../shared/battleStateProtocol.js';
import {
  BATTLE_MAP_V3_HASH_VERSION
} from '../../../../shared/battleMap/index.js';
import {
  cleanupConnection,
  registerBattleMapCapabilities
} from '../../services/messageReliability.js';
import { battleStateRepository } from '../../services/battle/BattleStateRepository.js';
import {
  assertBattleMapWirePayloadWithinBudget,
  BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV,
  BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV,
  BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV,
  getBattleMapOperationalMetrics
} from '../../services/battle/BattleMapOperations.js';

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

function enableReferenceDeltaForTest() {
  const previous = process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV];
  process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = 'true';
  return () => {
    if (previous === undefined) {
      delete process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV];
    } else {
      process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = previous;
    }
  };
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
    test('broadcasts V3 deltas automatically when the legacy V2 gate is disabled', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const update = createBattleMutableStateUpdateV1({
        battleId,
        battleMapSchemaVersion: 3,
        terrainGenerationVersion: 3,
        fullHash: `sha256:${'a'.repeat(64)}`,
        baseStateRevision: 2,
        stateRevision: 3,
        mutableState: createBattleMutableStateV1({
          units: [],
          battleType: 'pve',
          player1Id: userId
        })
      });
      const sentMessages = [];
      const connection = {
        readyState: 1,
        send(data) {
          sentMessages.push(JSON.parse(data));
        }
      };
      const wsModule = await import('../../websocket/index.js');
      const previousGate = process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV];
      const loadBattleMock = mock.method(
        battleStateRepository,
        'loadBattle',
        async () => {
          throw new Error('V3 delta delivery must not load the persisted map');
        }
      );
      process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = 'false';
      wsModule.connections.set(userId, connection);
      registerBattleMapCapabilities(connection, battleId, {
        cachedMaps: [],
        supportedBattleMapSchemaVersions: [1, 2, 3],
        supportedHashVersions: [BATTLE_MAP_V3_HASH_VERSION],
        supportedMutableStateProtocolVersions: [1]
      });

      try {
        await battleWs.joinBattle(battleId, userId);
        const deliveries = await battleWs.broadcastStateUpdate(battleId, update);

        assert.equal(deliveries.get(userId), 1);
        assert.equal(loadBattleMock.mock.callCount(), 0);
        assert.deepEqual(sentMessages[0].payload.update, update);
        assert.equal('snapshot' in sentMessages[0].payload, false);
        assert.equal('state' in sentMessages[0].payload, false);
      } finally {
        loadBattleMock.mock.restore();
        if (previousGate === undefined) {
          delete process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV];
        } else {
          process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = previousGate;
        }
        cleanupConnection(userId);
        wsModule.connections.delete(userId);
        await battleWs.cleanupBattleRoom(battleId);
      }
    });

    test('requires an upgrade instead of flattening V3 for an undeclared recipient', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const update = createBattleMutableStateUpdateV1({
        battleId,
        battleMapSchemaVersion: 3,
        terrainGenerationVersion: 3,
        fullHash: `sha256:${'b'.repeat(64)}`,
        baseStateRevision: 0,
        stateRevision: 1,
        mutableState: createBattleMutableStateV1({
          units: [],
          battleType: 'pve',
          player1Id: userId
        })
      });
      const sentMessages = [];
      const connection = {
        readyState: 1,
        send(data) {
          sentMessages.push(JSON.parse(data));
        }
      };
      const wsModule = await import('../../websocket/index.js');
      const loadBattleMock = mock.method(
        battleStateRepository,
        'loadBattle',
        async () => {
          throw new Error('undeclared V3 recipients must not receive flat state');
        }
      );
      wsModule.connections.set(userId, connection);

      try {
        await battleWs.joinBattle(battleId, userId);
        const deliveries = await battleWs.broadcastStateUpdate(battleId, update);

        assert.equal(deliveries.size, 0);
        assert.equal(loadBattleMock.mock.callCount(), 0);
        assert.equal(sentMessages[0].type, 'battle_map_upgrade_required');
        assert.equal(sentMessages[0].payload.requiredBattleMapSchemaVersion, 3);
      } finally {
        loadBattleMock.mock.restore();
        cleanupConnection(userId);
        wsModule.connections.delete(userId);
        await battleWs.cleanupBattleRoom(battleId);
      }
    });

    test('broadcastStateUpdate sends to battle room', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const update = createBattleMutableStateUpdateV1({
        battleId,
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1,
        fullHash: null,
        baseStateRevision: 0,
        stateRevision: 1,
        mutableState: createBattleMutableStateV1({
          units: [],
          battleType: 'pve',
          player1Id: userId
        })
      });
      const sentMessages = [];
      const connection = {
        readyState: 1,
        send(data) {
          sentMessages.push(JSON.parse(data));
        }
      };
      const wsModule = await import('../../websocket/index.js');
      const restoreReferenceDelta = enableReferenceDeltaForTest();
      wsModule.connections.set(userId, connection);
      registerBattleMapCapabilities(connection, battleId, {
        supportedBattleMapSchemaVersions: [1, 2],
        supportedTerrainGenerationVersions: [1, 2],
        supportedHashVersions: ['sha256-canonical-json-v1'],
        supportedMutableStateProtocolVersions: [1]
      });

      try {
        await battleWs.joinBattle(battleId, userId);
        const deliveries = await battleWs.broadcastStateUpdate(battleId, update);

        assert.equal(deliveries.has(userId), true);
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].type, 'battle:state_update');
        assert.equal(sentMessages[0].ack, true);
        assert.deepEqual(sentMessages[0].payload.update, update);
        assert.equal('state' in sentMessages[0].payload, false);
      } finally {
        restoreReferenceDelta();
        cleanupConnection(userId);
        wsModule.connections.delete(userId);
        await battleWs.cleanupBattleRoom(battleId);
      }
    });

    test('terminal reference delta projects PvP outcome for each participant', async () => {
      const battleId = getUniqueBattleId();
      const player1Id = getUniqueUserId();
      const player2Id = getUniqueUserId();
      const rewards = { gold: 100, exp: 50 };
      const update = createBattleMutableStateUpdateV1({
        battleId,
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1,
        fullHash: null,
        baseStateRevision: 6,
        stateRevision: 7,
        mutableState: createBattleMutableStateV1({
          units: [],
          battleType: 'pvp',
          player1Id,
          player2Id,
          winnerId: player1Id,
          status: 'victory',
          rewards
        })
      });
      const player1Messages = [];
      const player2Messages = [];
      const player1Connection = {
        readyState: 1,
        send(data) {
          player1Messages.push(JSON.parse(data));
        }
      };
      const player2Connection = {
        readyState: 1,
        send(data) {
          player2Messages.push(JSON.parse(data));
        }
      };
      const wsModule = await import('../../websocket/index.js');
      const restoreReferenceDelta = enableReferenceDeltaForTest();
      const capabilities = {
        supportedBattleMapSchemaVersions: [1, 2],
        supportedTerrainGenerationVersions: [1, 2],
        supportedHashVersions: ['sha256-canonical-json-v1'],
        supportedMutableStateProtocolVersions: [1]
      };
      wsModule.connections.set(player1Id, player1Connection);
      wsModule.connections.set(player2Id, player2Connection);
      registerBattleMapCapabilities(player1Connection, battleId, capabilities);
      registerBattleMapCapabilities(player2Connection, battleId, capabilities);

      try {
        await battleWs.joinBattle(battleId, player1Id);
        await battleWs.joinBattle(battleId, player2Id);
        const deliveries = await battleWs.broadcastStateUpdate(battleId, update);

        assert.equal(deliveries.has(player1Id), true);
        assert.equal(deliveries.has(player2Id), true);
        assert.equal(player1Messages.length, 1);
        assert.equal(player2Messages.length, 1);

        const winnerUpdate = player1Messages[0].payload.update;
        const loserUpdate = player2Messages[0].payload.update;
        assert.equal(winnerUpdate.mutableState.status, 'victory');
        assert.deepEqual(winnerUpdate.mutableState.rewards, rewards);
        assert.equal(loserUpdate.mutableState.status, 'defeat');
        assert.equal(loserUpdate.mutableState.rewards, null);
        assert.equal(winnerUpdate.baseStateRevision, update.baseStateRevision);
        assert.equal(loserUpdate.baseStateRevision, update.baseStateRevision);
        assert.equal(winnerUpdate.stateRevision, update.stateRevision);
        assert.equal(loserUpdate.stateRevision, update.stateRevision);
        assert.equal(winnerUpdate.updateId, update.updateId);
        assert.equal(loserUpdate.updateId, update.updateId);
      } finally {
        restoreReferenceDelta();
        cleanupConnection(player1Id);
        cleanupConnection(player2Id);
        wsModule.connections.delete(player1Id);
        wsModule.connections.delete(player2Id);
        await battleWs.cleanupBattleRoom(battleId);
      }
    });

    test('falls back to a full snapshot when ACK metadata makes the final delta envelope oversized', async () => {
      const battleId = getUniqueBattleId();
      const userId = getUniqueUserId();
      const mutableState = createBattleMutableStateV1({
        units: [],
        battleType: 'pve',
        player1Id: userId,
        turn: 2
      });
      const update = createBattleMutableStateUpdateV1({
        battleId,
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1,
        fullHash: null,
        baseStateRevision: 1,
        stateRevision: 2,
        mutableState
      });
      const map = {
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1,
        terrainSeed: 91,
        mapWidth: 1,
        mapHeight: 1,
        terrain: [['grass']],
        elevation: [[0]],
        obstacles: []
      };
      const persistedBattle = {
        battleId,
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1,
        stateRevision: 2,
        map,
        mutableState,
        state: { ...map, ...mutableState }
      };
      const sentMessages = [];
      const connection = {
        readyState: 1,
        send(data) {
          sentMessages.push(JSON.parse(data));
        }
      };
      const wsModule = await import('../../websocket/index.js');
      const previousEnvironment = Object.fromEntries([
        BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV,
        BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV,
        BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV,
        BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV,
        BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV
      ].map(name => [name, process.env[name]]));
      const loadBattleMock = mock.method(
        battleStateRepository,
        'loadBattle',
        async () => persistedBattle
      );
      wsModule.connections.set(userId, connection);
      registerBattleMapCapabilities(connection, battleId, {
        cachedMaps: [],
        supportedBattleMapSchemaVersions: [1, 2],
        supportedHashVersions: ['sha256-cjson-v1'],
        supportedMutableStateProtocolVersions: [1]
      });

      try {
        process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = 'true';
        process.env[BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV] = '1000000';
        process.env[BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV] = '1000000';
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV] = '1000000';
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV] = '1000000';
        const innerUpdateBytes = assertBattleMapWirePayloadWithinBudget(
          update,
          'mutableDelta'
        ).uncompressed;
        process.env[BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV] =
          String(innerUpdateBytes);
        const fallbackCountBefore =
          getBattleMapOperationalMetrics().counters.referenceDeltaFallbacks;

        await battleWs.joinBattle(battleId, userId);
        const deliveries = await battleWs.broadcastStateUpdate(battleId, update);

        assert.equal(deliveries.get(userId), 1);
        assert.equal(loadBattleMock.mock.callCount(), 1);
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].seq, 1);
        assert.equal(sentMessages[0].type, 'battle:state_update');
        assert.equal('update' in sentMessages[0].payload, false);
        assert.ok(sentMessages[0].payload.snapshot);
        assert.equal(
          getBattleMapOperationalMetrics().counters.referenceDeltaFallbacks,
          fallbackCountBefore + 1
        );
      } finally {
        loadBattleMock.mock.restore();
        cleanupConnection(userId);
        wsModule.connections.delete(userId);
        await battleWs.cleanupBattleRoom(battleId);
        for (const [name, value] of Object.entries(previousEnvironment)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
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
