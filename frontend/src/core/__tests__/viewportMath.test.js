import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_VIEWPORT,
  FLUID_VIEWPORT_LIMITS,
  computeLogicalViewport,
  computeContainScale,
  computeCanvasInsets
} from '../viewportMath.js';

describe('computeLogicalViewport', () => {
  it('keeps every non-fluid scene at exactly 800x600 regardless of container', () => {
    for (const [w, h] of [[390, 844], [1440, 900], [800, 600], [2560, 1080]]) {
      assert.deepEqual(computeLogicalViewport(w, h), { width: 800, height: 600 });
      assert.deepEqual(computeLogicalViewport(w, h, { fluid: false }), FIXED_VIEWPORT);
    }
  });

  it('widens a landscape fluid viewport and keeps the height at 600', () => {
    assert.deepEqual(computeLogicalViewport(1440, 900, { fluid: true }), { width: 960, height: 600 });
    assert.deepEqual(computeLogicalViewport(1920, 1080, { fluid: true }), { width: 1067, height: 600 });
    // Landscape phone
    assert.deepEqual(computeLogicalViewport(844, 390, { fluid: true }), { width: 1298, height: 600 });
  });

  it('gives a portrait phone a taller logical height at width 800', () => {
    assert.deepEqual(computeLogicalViewport(390, 844, { fluid: true }), { width: 800, height: 1731 });
  });

  it('matches the fixed viewport for an exact 4:3 container', () => {
    assert.deepEqual(computeLogicalViewport(1024, 768, { fluid: true }), { width: 800, height: 600 });
  });

  it('clamps extreme aspect ratios (then letterboxes)', () => {
    assert.deepEqual(computeLogicalViewport(5000, 600, { fluid: true }), {
      width: FLUID_VIEWPORT_LIMITS.maxWidth, height: 600
    });
    assert.deepEqual(computeLogicalViewport(200, 2000, { fluid: true }), {
      width: 800, height: FLUID_VIEWPORT_LIMITS.maxHeight
    });
  });

  it('falls back to the fixed viewport for a zero-size container', () => {
    assert.deepEqual(computeLogicalViewport(0, 0, { fluid: true }), { width: 800, height: 600 });
    assert.deepEqual(computeLogicalViewport(NaN, 500, { fluid: true }), { width: 800, height: 600 });
  });

  it('fills the container (no letterbox) for in-range fluid aspects', () => {
    for (const [w, h] of [[1440, 900], [390, 844], [844, 390], [1280, 720]]) {
      const logical = computeLogicalViewport(w, h, { fluid: true });
      const scale = computeContainScale(w, h, logical.width, logical.height);
      assert.ok(Math.abs(logical.width * scale - w) <= 1, `${w}x${h} width fills`);
      assert.ok(Math.abs(logical.height * scale - h) <= 1, `${w}x${h} height fills`);
    }
  });
});

describe('computeContainScale', () => {
  it('reproduces the fixed-scene letterbox scale', () => {
    assert.equal(computeContainScale(390, 844, 800, 600), 390 / 800);
    assert.equal(computeContainScale(1440, 900, 800, 600), 1.5);
  });

  it('returns 1 for an unmeasured container', () => {
    assert.equal(computeContainScale(0, 0, 800, 600), 1);
  });
});

describe('computeCanvasInsets', () => {
  it('measures the pillarbox gutters on desktop', () => {
    // 1440x900 viewport, 1200x900 canvas centred
    const insets = computeCanvasInsets({ left: 120, top: 0, right: 1320, bottom: 900 }, 1440, 900);
    assert.deepEqual(insets, { top: 0, left: 120, right: 120, bottom: 0, width: 1200, height: 900 });
  });

  it('measures the letterbox bands on a phone', () => {
    const insets = computeCanvasInsets({ left: 0, top: 276.75, right: 390, bottom: 569.25 }, 390, 844);
    assert.equal(insets.top, 277);
    assert.equal(insets.bottom, 275);
    assert.equal(insets.right, 0);
  });

  it('never reports negative insets', () => {
    const insets = computeCanvasInsets({ left: -5, top: -5, right: 810, bottom: 610 }, 800, 600);
    assert.deepEqual([insets.top, insets.left, insets.right, insets.bottom], [0, 0, 0, 0]);
  });
});
