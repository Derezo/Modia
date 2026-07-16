import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getParticipantBattleStatus } from '../../services/battleOutcomeService.js';

describe('getParticipantBattleStatus', () => {
  it('preserves shared PvE and co-op outcomes', () => {
    assert.equal(getParticipantBattleStatus({
      status: 'defeat',
      userId: 2,
      player1Id: 1,
      player2Id: 2,
      isHeadToHead: false
    }), 'defeat');
  });

  it('maps a pre-finalizer team-2 win to each head-to-head player', () => {
    const battle = {
      status: 'defeat',
      player1Id: 10,
      player2Id: 20,
      isHeadToHead: true
    };

    assert.equal(getParticipantBattleStatus({ ...battle, userId: 10 }), 'defeat');
    assert.equal(getParticipantBattleStatus({ ...battle, userId: 20 }), 'victory');
  });

  it('uses the persisted winner after Coliseum finalization', () => {
    const battle = {
      status: 'victory',
      player1Id: 10,
      player2Id: 20,
      winnerId: 20,
      isHeadToHead: true
    };

    assert.equal(getParticipantBattleStatus({ ...battle, userId: 10 }), 'defeat');
    assert.equal(getParticipantBattleStatus({ ...battle, userId: 20 }), 'victory');
  });

  it('does not reinterpret active or non-participant state', () => {
    assert.equal(getParticipantBattleStatus({
      status: 'active',
      userId: 20,
      player1Id: 10,
      player2Id: 20,
      isHeadToHead: true
    }), 'active');
    assert.equal(getParticipantBattleStatus({
      status: 'victory',
      userId: 30,
      player1Id: 10,
      player2Id: 20,
      isHeadToHead: true
    }), 'victory');
  });
});
