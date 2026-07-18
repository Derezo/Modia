import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AnimatedSprite } from '../AnimatedSprite.js';
import {
  IDLE_FRAME_DURATION_MS,
  IDLE_FRAME_RATE,
  advanceIdleFrame
} from '../CharacterAnimationTiming.js';

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

  it('holds subtle idle poses for two seconds while action timing stays fast', () => {
    const idle = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'idle');
    const walk = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'walk');

    assert.equal(IDLE_FRAME_DURATION_MS, 2000);
    assert.equal(idle.frameRate, IDLE_FRAME_RATE);
    idle.update(1.999);
    assert.equal(idle.currentFrame, 0);
    idle.update(0.001);
    assert.equal(idle.currentFrame, 1);
    assert.equal(walk.frameRate, 12);
  });

  it('advances and wraps all eight world-map idle poses with stable remainder timing', () => {
    assert.deepEqual(advanceIdleFrame(0, 0, 13999), { frame: 6, elapsedMs: 1999 });
    assert.deepEqual(advanceIdleFrame(6, 1999, 1), { frame: 7, elapsedMs: 0 });
    assert.deepEqual(advanceIdleFrame(7, 0, 2000), { frame: 0, elapsedMs: 0 });
  });

  it('advances all eight frames and completes non-looping actions', () => {
    const sprite = AnimatedSprite.createForAnimation({ width: 64, height: 512 }, 'attack');
    for (let i = 0; i < 8; i++) sprite.advanceFrame();

    assert.equal(sprite.currentFrame, 7);
    assert.equal(sprite.isFinished(), true);
  });
});
