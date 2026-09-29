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
  getV3MinimapLayout,
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

  it('paints only the V3 render-mask silhouette cells', () => {
    let moves = 0;
    let fills = 0;
    const ctx = {
      fillRect() {},
      beginPath() {},
      rect() {},
      clip() {},
      save() {},
      restore() {},
      strokeRect() {},
      fillText() {},
      moveTo() { moves++; },
      lineTo() {},
      closePath() {},
      fill() { fills++; }
    };
    renderMinimap({
      ctx,
      units: new Map(),
      camera: { x: 0, y: 0, zoom: 1 },
      grid: {
        tileWidth: 64,
        tileHeight: 32,
        battleMapV3RenderData: {},
        getMapPixelDimensions: () => ({
          width: 64,
          height: 32,
          worldMinX: -32,
          worldMinY: -16,
          worldMaxX: 32,
          worldMaxY: 16,
          offsetX: 32,
          offsetY: 16
        }),
        getRenderedWorldCells: () => [
          { x: 2, y: 3, worldX: 0, worldY: 0 }
        ]
      },
      targetWidth: 200,
      targetHeight: 100
    });
    assert.equal(moves, 1);
    assert.equal(fills, 1);
  });

  it('derives V3 frame, transform, and viewport bounds from tile diamonds', () => {
    const layout = getV3MinimapLayout({
      renderedCells: [
        { worldX: 0, worldY: 0 },
        { worldX: 64, worldY: 32 }
      ],
      tileWidth: 64,
      tileHeight: 32,
      targetWidth: 200
    });

    assert.deepEqual(layout.mapDim, {
      worldMinX: -32,
      worldMinY: -16,
      worldMaxX: 96,
      worldMaxY: 48,
      width: 128,
      height: 64,
      offsetX: 32,
      offsetY: 16
    });
    assert.equal(layout.scale, 110 / 128);
    assert.deepEqual(
      {
        x: layout.minimapX,
        y: layout.minimapY,
        width: layout.minimapWidth,
        height: layout.minimapHeight
      },
      { x: 70, y: 10, width: 120, height: 65 }
    );
    assert.deepEqual(getMinimapViewportRect({
      camera: { x: 32, y: 16, zoom: 1 },
      mapDim: layout.mapDim,
      targetWidth: 200,
      targetHeight: 100,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
      scale: layout.scale
    }), { x: 75, y: 15, width: 110, height: 55 });
  });

  it('keeps V3 units and viewport aligned to the silhouette despite tall art bounds', () => {
    const arcs = [];
    const strokes = [];
    const labels = [];
    const ctx = {
      fillRect() {},
      beginPath() {},
      rect() {},
      clip() {},
      save() {},
      restore() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      arc(...args) { arcs.push(args); },
      strokeRect(...args) { strokes.push(args); },
      fillText(...args) { labels.push(args); }
    };
    const unit = {
      teamId: 1,
      screenX: 0,
      screenY: 0,
      isSelected: false,
      isAlive: () => true
    };
    renderMinimap({
      ctx,
      units: new Map([['player', unit]]),
      camera: { x: 32, y: 16, zoom: 1 },
      grid: {
        tileWidth: 64,
        tileHeight: 32,
        battleMapV3RenderData: {},
        // Any access would indicate V3 was framed by art bounds rather than
        // its rendered-cell silhouette.
        getMapPixelDimensions: () => { throw new Error('unexpected art bounds'); },
        getRenderedWorldCells: () => [
          { x: 0, y: 0, worldX: 0, worldY: 0 },
          { x: 1, y: 0, worldX: 64, worldY: 32 }
        ]
      },
      targetWidth: 200,
      targetHeight: 100
    });

    assert.deepEqual(arcs, [[102.5, 28.75, 3, 0, Math.PI * 2]]);
    assert.deepEqual(strokes, [
      [75, 15, 110, 55],
      [70, 10, 120, 65]
    ]);
    // Top-aligned 5px below the frame's bottom edge (10 + 65), clear of
    // its 2px border.
    assert.deepEqual(labels, [['Arrows: Pan | Space: Re-center', 190, 80]]);
    assert.equal(ctx.textAlign, 'right');
    assert.equal(ctx.textBaseline, 'top');
  });

  it('retains the 120px square legacy frame when no V3 silhouette is available', () => {
    assert.equal(getV3MinimapLayout({
      renderedCells: [], tileWidth: 64, tileHeight: 32, targetWidth: 200
    }), null);
  });

  it('clips organic islands to their tile silhouette and outlines exposed edges', () => {
    const calls = {
      clips: 0,
      outlines: 0,
      rectangles: 0,
      fills: 0
    };
    const ctx = {
      fillRect() { calls.rectangles++; },
      beginPath() {},
      rect() {},
      clip() { calls.clips++; },
      save() {},
      restore() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() { calls.fills++; },
      stroke() { calls.outlines++; },
      strokeRect() { calls.rectangles++; },
      fillText() {}
    };
    renderMinimap({
      ctx,
      units: new Map(),
      camera: { x: 1000, y: 1000, zoom: 1 },
      grid: {
        tileWidth: 64,
        tileHeight: 32,
        battleMapV3RenderData: {
          scene: { silhouette: 'organic-island' }
        },
        getRenderedWorldCells: () => [
          { x: 0, y: 0, worldX: 0, worldY: 0 },
          { x: 1, y: 0, worldX: 32, worldY: 16 }
        ]
      },
      targetWidth: 200,
      targetHeight: 100
    });

    assert.equal(calls.rectangles, 0, 'organic framing has no oversized box');
    assert.equal(calls.clips, 1);
    assert.equal(calls.outlines, 1);
    assert.equal(calls.fills, 1);
  });

  it('retains rectangular framing for architectural platforms', () => {
    let rectangleStrokes = 0;
    const ctx = {
      fillRect() {},
      beginPath() {},
      rect() {},
      clip() {},
      save() {},
      restore() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      strokeRect() { rectangleStrokes++; },
      fillText() {}
    };
    renderMinimap({
      ctx,
      units: new Map(),
      camera: { x: 1000, y: 1000, zoom: 1 },
      grid: {
        tileWidth: 64,
        tileHeight: 32,
        battleMapV3RenderData: {
          scene: { silhouette: 'rectangular-platform' }
        },
        getRenderedWorldCells: () => [
          { x: 0, y: 0, worldX: 0, worldY: 0 }
        ]
      },
      targetWidth: 200,
      targetHeight: 100
    });
    assert.equal(rectangleStrokes, 1);
  });
});
