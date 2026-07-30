import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildBattleLogEntry, getActionName } from '../battleLog.js';

describe('Zodiac battle log names', () => {
  it('uses the server-provided readable ability name', () => {
    assert.equal(
      getActionName('zodiac_ability', { abilityName: 'Dreamwave' }),
      'Dreamwave'
    );
    const entry = buildBattleLogEntry({
      actor: { id: 'player', name: 'Player', type: 'player' },
      actionType: 'zodiac_ability',
      target: { id: 'enemy', name: 'Enemy', type: 'enemy' },
      result: { abilityName: 'Venom Sting' },
      turnCounter: 2
    });
    assert.equal(entry.action.name, 'Venom Sting');
    assert.equal(entry.target.name, 'Enemy');
  });
});
