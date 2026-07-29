import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canParticipantControlActiveUnit,
  getParticipantAvailableActions
} from '../../../services/battle/participantActionAvailability.js';

function createFixture({
  status = 'active',
  battleType = 'pve',
  player2Id = null,
  ownerId = 11
} = {}) {
  const activeUnit = {
    id: 'player-1',
    type: 'player',
    ownerId,
    moveUsed: true,
    actUsed: true,
    statusEffects: []
  };
  return {
    battle: { status, battleType, player2Id },
    state: {
      status,
      battleType,
      player2Id,
      activeUnitId: activeUnit.id,
      units: [activeUnit]
    }
  };
}

describe('participant action availability', () => {
  it('returns complete action flags only to the active unit owner', () => {
    const { battle, state } = createFixture();

    assert.equal(canParticipantControlActiveUnit(battle, state, 11), true);
    assert.deepEqual(getParticipantAvailableActions(battle, state, 11), {
      canMove: false,
      canAct: false,
      canWait: true,
      turnPhase: 'ready',
      movement: null,
      attacks: null,
      skills: null,
      items: null
    });
    assert.equal(getParticipantAvailableActions(battle, state, 12), null);
  });

  it('does not expose actions for terminal or ownerless multiplayer state', () => {
    const terminal = createFixture({ status: 'victory' });
    assert.equal(
      getParticipantAvailableActions(terminal.battle, terminal.state, 11),
      null
    );

    const multiplayer = createFixture({
      battleType: 'pvp',
      player2Id: 12,
      ownerId: null
    });
    assert.equal(
      getParticipantAvailableActions(multiplayer.battle, multiplayer.state, 11),
      null
    );
  });

  it('supports ownerless legacy solo battles', () => {
    const { battle, state } = createFixture({ ownerId: null });
    assert.equal(canParticipantControlActiveUnit(battle, state, 11), true);
  });
});
