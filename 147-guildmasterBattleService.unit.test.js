import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { positionUnits } from '../../services/guildmasterBattleService.js';

describe('guildmaster battle tactical positions', () => {
  it('uses canonical tile coordinates inside the protected formation strips', () => {
    const players = [{ id: 'player' }];
    const enemies = [
      { id: 'guildmaster' },
      { id: 'disciple_1' },
      { id: 'disciple_2' },
      { id: 'disciple_3' }
    ];

    positionUnits(players, enemies, 32, 32);

    assert.deepEqual(
      players.map(({ tileX, tileY }) => ({ tileX, tileY })),
      [{ tileX: 2, tileY: 16 }]
    );
    assert.deepEqual(
      enemies.map(({ tileX, tileY }) => ({ tileX, tileY })),
      [
        { tileX: 27, tileY: 16 },
        { tileX: 25, tileY: 18 },
        { tileX: 25, tileY: 14 },
        { tileX: 25, tileY: 20 }
      ]
    );
    for (const unit of [...players, ...enemies]) {
      assert.equal('x' in unit, false);
      assert.equal('y' in unit, false);
    }
  });
});
