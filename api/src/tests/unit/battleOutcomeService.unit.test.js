import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getParticipantBattleStatus,
  getParticipantBattleView
} from '../../services/battleOutcomeService.js';

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

describe('getParticipantBattleView', () => {
  it('personalizes both modern and legacy terminal state for the Coliseum loser', () => {
    const view = getParticipantBattleView({
      battleType: 'pvp_coliseum',
      status: 'victory',
      player1Id: 10,
      player2Id: 20,
      winnerId: 10,
      rewards: { gold: 5 },
      mutableState: { status: 'victory', rewards: { gold: 5 }, units: [] },
      state: { status: 'victory', rewards: { gold: 5 }, terrain: [['grass']] }
    }, 20);

    assert.equal(view.mutableState.status, 'defeat');
    assert.equal(view.state.status, 'defeat');
    assert.equal(view.mutableState.rewards, null);
    assert.equal(view.state.rewards, null);
  });

  it('preserves shared PvE outcomes and rewards', () => {
    const rewards = { gold: 5 };
    const view = getParticipantBattleView({
      battleType: 'pve',
      status: 'victory',
      player1Id: 10,
      player2Id: null,
      winnerId: 10,
      rewards,
      mutableState: { status: 'victory', rewards },
      state: { status: 'victory', rewards }
    }, 10);

    assert.equal(view.mutableState.status, 'victory');
    assert.deepEqual(view.mutableState.rewards, rewards);
  });
});
