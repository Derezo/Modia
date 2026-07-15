import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AnimatedSprite } from '../AnimatedSprite.js';

describe('AnimatedSprite vertical animation strips', () => {
  it('detects 64x512 generated strips as eight temporal frames', () => {
    const sprite = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'walk');

    assert.equal(sprite.layout, 'vertical-strip');
    assert.equal(sprite.frameWidth, 64);
    assert.equal(sprite.frameHeight, 64);
    assert.equal(sprite.frameCount, 8);
    assert.equal(sprite.directions, 8);
    assert.equal(sprite.mirrorByDirection, true);
  });

  it('selects temporal frames down the vertical axis instead of treating them as directions', () => {
    const sprite = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'attack');
    sprite.gotoFrame(5);
    sprite.setDirection(AnimatedSprite.DIRECTIONS.NORTHWEST);

    assert.deepEqual(sprite.getSourceRect(), {
      x: 0,
      y: 320,
      width: 64,
      height: 64
    });
  });

  it('mirrors west-facing strips while preserving east-facing artwork', () => {
    const sprite = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'idle');

    sprite.setDirection(AnimatedSprite.DIRECTIONS.EAST);
    assert.equal(sprite.shouldMirror(), false);

    sprite.setDirection(AnimatedSprite.DIRECTIONS.WEST);
    assert.equal(sprite.shouldMirror(), true);

    sprite.setDirection(AnimatedSprite.DIRECTIONS.SOUTHWEST);
    assert.equal(sprite.shouldMirror(), true);
  });

  it('advances all eight frames and completes non-looping actions', () => {
    const sprite = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'attack');
    for (let i = 0; i < 8; i++) sprite.advanceFrame();

    assert.equal(sprite.currentFrame, 7);
    assert.equal(sprite.isFinished(), true);
  });
});
