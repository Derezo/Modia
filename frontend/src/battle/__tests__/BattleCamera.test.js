import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BattleCamera } from '../BattleCamera.js';

describe('BattleCamera zoom-aware bounds', () => {
  it('centres a map when the zoomed-out viewport is larger on both axes', () => {
    const camera = new BattleCamera(400, 300);
    camera.setBoundsFromWorld(-500, 0, 500, 500);
    camera.centerOn(-400, 50, true);

    camera.setZoom(0.3);

    assert.equal(camera.minX, 0);
    assert.equal(camera.maxX, 0);
    assert.equal(camera.minY, 250);
    assert.equal(camera.maxY, 250);
    assert.deepEqual(
      { x: camera.targetX, y: camera.targetY },
      { x: 0, y: 250 }
    );
  });

  it('centres only the axis that fully fits while retaining useful pan bounds', () => {
    const camera = new BattleCamera(400, 300);
    camera.setBoundsFromWorld(-500, 0, 500, 500);

    camera.setZoom(0.5);

    assert.deepEqual(
      { minX: camera.minX, maxX: camera.maxX, minY: camera.minY, maxY: camera.maxY },
      { minX: -100, maxX: 100, minY: 250, maxY: 250 }
    );
  });
});

describe('BattleCamera pan gesture distance', () => {
  it('tracks pointer motion before interpolation and while camera bounds are clamped', () => {
    const camera = new BattleCamera(400, 300);
    camera.setBoundsFromWorld(-100, -100, 100, 100);
    camera.startPan(10, 20);
    camera.updatePan(40, 60);

    assert.equal(camera.x, 0, 'camera interpolation has not advanced yet');
    assert.equal(camera.getPanDistance(), 50);
  });
});

describe('BattleCamera turn transition callbacks', () => {
  it('settles a superseded transition callback instead of dropping it', () => {
    const camera = new BattleCamera(400, 300);
    camera.setBoundsFromWorld(-1000, -1000, 1000, 1000);
    let first = 0;
    let second = 0;
    camera.startTurnTransition(100, 100, () => { first++; }, 500);
    camera.startTurnTransition(200, 200, () => { second++; }, 500);
    assert.equal(first, 1, 'the replaced transition resolves');
    assert.equal(second, 0);
    camera.update(600);
    assert.equal(second, 1);
    assert.equal(first, 1, 'settled exactly once');
  });

  it('settles the callback when the player takes manual control', () => {
    const camera = new BattleCamera(400, 300);
    camera.setBoundsFromWorld(-1000, -1000, 1000, 1000);
    let done = 0;
    camera.startTurnTransition(100, 100, () => { done++; }, 500);
    camera.startPan(0, 0);
    camera.updatePan(50, 50);
    assert.equal(done, 1);
  });
});
