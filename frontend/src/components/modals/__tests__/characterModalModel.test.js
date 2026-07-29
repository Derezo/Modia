import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveAvailableSkillXp } from '../characterModalModel.js';

describe('character modal training XP', () => {
  it('preserves an authoritative zero XP pool', () => {
    assert.equal(
      resolveAvailableSkillXp(
        { xpPool: 0 },
        { experience: 20, spent_xp: 100 }
      ),
      0
    );
  });

  it('uses remaining character experience without subtracting spent XP again', () => {
    assert.equal(
      resolveAvailableSkillXp(
        {},
        { experience: 20, spent_xp: 100 }
      ),
      20
    );
  });

  it('normalizes malformed and negative values to zero', () => {
    assert.equal(resolveAvailableSkillXp({ availableXp: 'invalid' }), 0);
    assert.equal(resolveAvailableSkillXp({ availableXp: -5 }), 0);
  });
});
