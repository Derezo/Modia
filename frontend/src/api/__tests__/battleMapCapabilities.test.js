import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.WebSocket = { OPEN: 1 };

const { GameWebSocket } = await import('../websocket.js');
const { MessageReliabilityManager } = await import('../messageReliability.js');

describe('battle map WebSocket capabilities', () => {
  it('declares capabilities on joins and uses the root sync envelope', () => {
    const socket = new GameWebSocket('ws://example.test');
    const sent = [];
    socket.ws = {
      readyState: WebSocket.OPEN,
      send(value) { sent.push(JSON.parse(value)); }
    };

    socket.joinBattleRoom(10);
    socket.requestBattleSync(10);

    assert.equal(sent[0].type, 'join_battle');
    assert.equal(sent[0].payload.battleId, 10);
    assert.deepEqual(sent[0].payload.battleMapCapabilities.supportedBattleMapSchemaVersions, [1, 2]);
    assert.equal(sent[1].type, 'battle:request_sync');
    assert.equal(sent[1].battleId, 10);
    assert.deepEqual(sent[1].battleMapCapabilities.supportedMutableStateProtocolVersions, [1]);
    assert.equal(Object.hasOwn(sent[1], 'payload'), false);
  });

  it('declares capabilities on every Coliseum queue join path', () => {
    const socket = new GameWebSocket('ws://example.test');
    const sent = [];
    socket.ws = {
      readyState: WebSocket.OPEN,
      send(value) { sent.push(JSON.parse(value)); }
    };

    socket.joinColiseumQueue([11]);
    socket.joinColiseumQueueWithDetails('1v1', 12, 1);
    socket.send('coliseum_queue_join', {
      queueType: '1v1',
      partyLevel: 12,
      partySize: 1
    });

    assert.equal(sent.length, 3);
    for (const message of sent) {
      assert.equal(message.type, 'coliseum_queue_join');
      assert.deepEqual(
        message.payload.battleMapCapabilities.supportedBattleMapSchemaVersions,
        [1, 2]
      );
      assert.deepEqual(
        message.payload.battleMapCapabilities.supportedMutableStateProtocolVersions,
        [1]
      );
    }
  });

  it('preserves explicitly supplied Coliseum capabilities', () => {
    const socket = new GameWebSocket('ws://example.test');
    const sent = [];
    const legacyCapabilities = {
      supportedBattleMapSchemaVersions: [1],
      supportedHashVersions: [],
      supportedMutableStateProtocolVersions: [1],
      cachedMaps: []
    };
    socket.ws = {
      readyState: WebSocket.OPEN,
      send(value) { sent.push(JSON.parse(value)); }
    };

    socket.send('coliseum_queue_join', {
      queueType: '1v1',
      battleMapCapabilities: legacyCapabilities
    });

    assert.deepEqual(
      sent[0].payload.battleMapCapabilities,
      legacyCapabilities
    );
  });

  it('includes capabilities in reliability gap recovery', () => {
    const sent = [];
    const capabilities = {
      supportedBattleMapSchemaVersions: [1, 2],
      supportedHashVersions: ['hash'],
      supportedMutableStateProtocolVersions: [1],
      cachedMaps: []
    };
    const reliability = new MessageReliabilityManager(
      message => sent.push(message),
      { getBattleMapCapabilities: () => capabilities }
    );

    reliability.requestResync('battle-1');

    assert.deepEqual(sent, [{
      type: 'battle:request_sync',
      battleId: 'battle-1',
      battleMapCapabilities: capabilities
    }]);
  });
});
