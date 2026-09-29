import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placeNodeOverlay } from '../overlayPlacement.js';

// 390x844 phone, letterboxed 390x292 canvas in the middle of the screen
const phoneCanvas = { left: 0, top: 276, right: 390, bottom: 568 };
const desktopCanvas = { left: 120, top: 0, right: 1320, bottom: 900 };

describe('placeNodeOverlay', () => {
  it('places below the node when it fits', () => {
    const p = placeNodeOverlay({
      nodeX: 600, nodeY: 300, nodeSize: 20, width: 160, height: 150, bounds: desktopCanvas, gap: 12
    });
    assert.equal(p.above, false);
    assert.equal(p.top, 332);
    assert.equal(p.centerX, 600);
  });

  it('flips above when below does not fit but above does', () => {
    const p = placeNodeOverlay({
      nodeX: 600, nodeY: 850, nodeSize: 20, width: 160, height: 150, bounds: desktopCanvas, gap: 12
    });
    assert.equal(p.above, true);
    assert.equal(p.top, 850 - 20 - 12 - 150);
  });

  it('on a short phone canvas never flips up into the letterbox band', () => {
    // Node near the top of the canvas: above would land above canvas.top.
    const p = placeNodeOverlay({
      nodeX: 195, nodeY: 300, nodeSize: 15, width: 180, height: 200, bounds: phoneCanvas, gap: 12, margin: 10
    });
    assert.equal(p.above, false, 'more room below, so stay below');
    assert.ok(p.top >= phoneCanvas.top + 10, 'top edge stays inside the canvas');
  });

  it('clamps inside the canvas when neither side fits', () => {
    const p = placeNodeOverlay({
      nodeX: 195, nodeY: 540, nodeSize: 15, width: 180, height: 200, bounds: phoneCanvas, gap: 12, margin: 10
    });
    assert.equal(p.above, true, 'more room above the node');
    assert.ok(p.top >= phoneCanvas.top + 10);
    assert.ok(p.top + 200 <= phoneCanvas.bottom - 10 + 1e-9);
  });

  it('clamps horizontally to the canvas, not the viewport gutter', () => {
    const right = placeNodeOverlay({
      nodeX: 1310, nodeY: 300, nodeSize: 20, width: 160, height: 100, bounds: desktopCanvas, margin: 10
    });
    assert.equal(right.centerX, 1320 - 10 - 80);
    const left = placeNodeOverlay({
      nodeX: 125, nodeY: 300, nodeSize: 20, width: 160, height: 100, bounds: desktopCanvas, margin: 10
    });
    assert.equal(left.centerX, 120 + 10 + 80);
  });

  it('centres an overlay wider than the canvas', () => {
    const p = placeNodeOverlay({
      nodeX: 20, nodeY: 400, nodeSize: 10, width: 500, height: 50, bounds: phoneCanvas
    });
    assert.equal(p.centerX, 195);
  });
});

describe('placeNodeOverlay side placement', () => {
  const bounds = { left: 0, top: 0, right: 1440, bottom: 900 };

  it('sits beside the node when a tall overlay fits neither below nor above', () => {
    const placement = placeNodeOverlay({
      nodeX: 700, nodeY: 450, nodeSize: 30, width: 180, height: 700,
      bounds, gap: 12, margin: 10, allowSide: true
    });
    assert.equal(placement.side, 'right');
    const left = placement.centerX - 90;
    assert.ok(left >= 700 + 30 + 12, 'does not cover the node horizontally');
  });

  it('keeps the old clamped placement unless side placement is allowed', () => {
    const placement = placeNodeOverlay({
      nodeX: 700, nodeY: 450, nodeSize: 30, width: 180, height: 700, bounds
    });
    assert.equal(placement.side, undefined);
    assert.equal(placement.centerX, 700);
  });
});
