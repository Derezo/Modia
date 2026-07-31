import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GridCursor } from '../GridCursor.js';

function gridWithMask(mask) {
  return {
    width: mask[0].length,
    height: mask.length,
    isPlayable(x, y) {
      return Boolean(mask[y]?.[x]);
    },
    gridToScreenWorld(x, y) {
      return { x, y };
    },
    tileWidth: 64,
    tileHeight: 32
  };
}

describe('GridCursor V3 playable-mask navigation', () => {
  it('initializes on a playable cell and skips void cells directionally', () => {
    const cursor = new GridCursor({}, gridWithMask([
      [false, true, false, true],
      [false, false, true, false]
    ]));
    cursor.moveCooldown = 0;

    assert.deepEqual(cursor.getPosition(), { x: 1, y: 0 });
    assert.equal(cursor.move(1, 0), true);
    assert.deepEqual(cursor.getPosition(), { x: 3, y: 0 });
    assert.equal(cursor.move(0, 1), false);
    assert.deepEqual(cursor.getPosition(), { x: 3, y: 0 });
  });

  it('resolves programmatic positions and cycled units onto playable cells', () => {
    const cursor = new GridCursor({}, gridWithMask([
      [true, false, true],
      [false, true, false]
    ]));
    cursor.setPosition(1, 0);
    assert.deepEqual(cursor.getPosition(), { x: 0, y: 0 });

    cursor.cycleToUnit([{ gridX: 2, gridY: 0 }]);
    assert.deepEqual(cursor.getPosition(), { x: 2, y: 0 });
  });
});
