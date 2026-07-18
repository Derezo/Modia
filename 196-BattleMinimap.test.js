import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0 }
});
globalThis.document = {
  createElement() { return { id: '', textContent: '' }; },
  head: { appendChild() {} }
};

const {
  getMinimapViewportRect,
  renderMinimap
} = await import('../BattleMinimap.js');

describe('BattleMinimap camera viewport', () => {
  it('intersects a fit-zoom viewport with the map bounds', () => {
    const rect = getMinimapViewportRect({
      camera: { x: 55, y: 27.5, zoom: 0.25 },
      mapDim: {
        width: 110,
        height: 55,
        worldMinX: 0,
        worldMinY: 0,
        worldMaxX: 110,
        worldMaxY: 55,
        offsetX: 0,
        offsetY: 0
      },
      targetWidth: 200,
      targetHeight: 100,
      offsetX: 75,
      offsetY: 15,
      scale: 1
    });

    assert.deepEqual(rect, { x: 75, y: 15, width: 110, height: 55 });
  });

  it('clips the viewport stroke while leaving the minimap border unclipped', () => {
    const strokes = [];
    let clipped = false;
    const ctx = {
      fillRect() {},
      beginPath() {},
      rect() {},
      clip() { clipped = true; },
      save() {},
      restore() { clipped = false; },
      strokeRect(...args) { strokes.push({ args, clipped }); },
      fillText() {}
    };
    const mapDim = {
      width: 110,
      height: 55,
      worldMinX: 0,
      worldMinY: 0,
      worldMaxX: 110,
      worldMaxY: 55,
      offsetX: 0,
      offsetY: 0
    };

    renderMinimap({
      ctx,
      units: new Map(),
      camera: { x: 55, y: 27.5, zoom: 0.25 },
      grid: { getMapPixelDimensions: () => mapDim },
      targetWidth: 200,
      targetHeight: 100
    });

    assert.deepEqual(strokes, [
      { args: [75, 15, 110, 55], clipped: true },
      { args: [70, 10, 120, 120], clipped: false }
    ]);
  });
});
