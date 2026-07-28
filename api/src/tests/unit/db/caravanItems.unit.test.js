import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateRefreshOffset } from '../../../db/templates/caravanItems.js';

describe('calculateRefreshOffset', () => {
  it('maps every signed local seed to a nonnegative 48-hour window', () => {
    const hour = 60 * 60 * 1000;
    for (const seed of [-2147483648, -49, -48, -47, -1, 0, 1, 47, 48, 2147483647]) {
      const offset = calculateRefreshOffset(seed);
      assert.ok(offset >= 0 && offset < 48 * hour, `seed ${seed}`);
      assert.equal(offset % hour, 0, `seed ${seed}`);
    }
  });

  it('retains the established offsets for nonnegative seeds', () => {
    const hour = 60 * 60 * 1000;
    assert.equal(calculateRefreshOffset(0), 0);
    assert.equal(calculateRefreshOffset(47), 47 * hour);
    assert.equal(calculateRefreshOffset(48), 0);
  });
});
