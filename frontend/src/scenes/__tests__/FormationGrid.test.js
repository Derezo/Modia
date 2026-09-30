import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// FormationGrid imports the responsive singleton, which performs lightweight
// browser setup at module evaluation time. Provide the minimal DOM surface the
// singleton needs so projection tests can run in Node.
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

const { FormationGrid } = await import('../formation/FormationGrid.js');

function createGrid(overrides = {}) {
  return new FormationGrid({
    canvas: { width: 400, height: 220 },
    gridWidth: 5,
    gridHeight: 4,
    tileWidth: 64,
    tileHeight: 32,
    ...overrides
  });
}

describe('FormationGrid projection', () => {
  it('round-trips every tile centre through the 2:1 inverse', () => {
    const grid = createGrid();

    for (let y = 0; y < grid.gridHeight; y++) {
      for (let x = 0; x < grid.gridWidth; x++) {
        const screen = grid.gridToScreen(x, y);
        assert.deepEqual(grid.screenToGrid(screen.x, screen.y), { x, y });
      }
    }
  });

  it('keeps the upper-left portions of the origin diamond in tile 0,0', () => {
    const grid = createGrid();
    const origin = grid.gridToScreen(0, 0);

    assert.deepEqual(grid.screenToGrid(origin.x - 12, origin.y), { x: 0, y: 0 });
    assert.deepEqual(grid.screenToGrid(origin.x, origin.y - 8), { x: 0, y: 0 });
    assert.equal(grid.screenToGrid(origin.x, origin.y - 17), null);
  });

  it('returns a deterministic nondecreasing isometric render order', () => {
    const order = createGrid().getCellsInRenderOrder();

    assert.equal(order.length, 20);
    for (let index = 1; index < order.length; index++) {
      const previous = order[index - 1];
      const current = order[index];
      assert.ok(previous.depth <= current.depth);
      if (previous.depth === current.depth) {
        assert.ok(
          previous.y < current.y ||
          (previous.y === current.y && previous.x < current.x)
        );
      }
    }
  });
});

describe('FormationGrid terrain sizing', () => {
  it('renders a retina terrain source into a square 64px logical sprite box', () => {
    const sprite = { width: 128, height: 128 };
    const grid = createGrid({
      assetLoader: { getTile: () => sprite }
    });
    const draws = [];
    const ctx = {
      imageSmoothingEnabled: false,
      drawImage(...args) { draws.push(args); }
    };

    grid.drawIsometricDiamond(ctx, 100, 80, false, false, false);

    assert.equal(ctx.imageSmoothingEnabled, true);
    assert.deepEqual(draws, [[sprite, 68, 48, 64, 64]]);
  });
});

describe('FormationGrid DPR logical size', () => {
  it('projects from the logical width, not the device-pixel canvas width', () => {
    // DPR 2: backing store is 800x440 while the CSS/logical size is 400x220
    const grid = createGrid({ canvas: { width: 800, height: 440 }, logicalWidth: 400, logicalHeight: 220 });
    assert.equal(grid.gridToScreen(0, 0).x, 200);
    for (let y = 0; y < grid.gridHeight; y++) {
      for (let x = 0; x < grid.gridWidth; x++) {
        const centre = grid.gridToScreen(x, y);
        assert.deepEqual(grid.screenToGrid(centre.x, centre.y), { x, y });
      }
    }
  });

  it('rescales tiles and bounds on setLogicalSize', () => {
    const grid = createGrid({ canvas: { width: 720, height: 400 } });
    grid.setLogicalSize(360, 200);
    const scale = Math.min(360 / 400, 200 / 220);
    assert.equal(grid.tileWidth, Math.round(64 * scale));
    assert.equal(grid.tileHeight, Math.round(32 * scale));
    assert.equal(grid.gridToScreen(0, 0).x, 180);
    assert.ok(grid.gridBounds.maxX <= 360 && grid.gridBounds.minX >= 0);
    const centre = grid.gridToScreen(2, 1);
    assert.deepEqual(grid.screenToGrid(centre.x, centre.y), { x: 2, y: 1 });
  });
});

describe('formation canvas sizing', async () => {
  const {
    computeFormationCanvasSize,
    MIN_FORMATION_CANVAS_WIDTH,
    MIN_FORMATION_CANVAS_HEIGHT
  } = await import('../formation/formationCanvasSize.js');

  it('fits a roomy desktop area at the capped 1.8:1 size', () => {
    assert.deepEqual(computeFormationCanvasSize({ clientWidth: 900, clientHeight: 600, isMobile: false }), { width: 576, height: 320 });
  });

  it('never returns a zero or negative size for a squeezed grid area', () => {
    for (const [w, h] of [[20, 10], [300, 40], [10, 300], [1, 1]]) {
      const size = computeFormationCanvasSize({ clientWidth: w, clientHeight: h, isMobile: true });
      assert.ok(size.width >= MIN_FORMATION_CANVAS_HEIGHT && size.height >= MIN_FORMATION_CANVAS_HEIGHT, `${w}x${h}: ${JSON.stringify(size)}`);
      assert.ok(size.width <= Math.max(MIN_FORMATION_CANVAS_WIDTH, w));
    }
  });

  it('keeps the current size while the area has not been laid out', () => {
    assert.equal(computeFormationCanvasSize({ clientWidth: 0, clientHeight: 0, isMobile: false }), null);
  });

  it('does not deduct the desktop instructions row on mobile', () => {
    const mobile = computeFormationCanvasSize({ clientWidth: 400, clientHeight: 150, isMobile: true });
    const desktop = computeFormationCanvasSize({ clientWidth: 400, clientHeight: 150, isMobile: false });
    assert.ok(mobile.height > desktop.height);
  });
});

describe('FormationGrid enemy direction label', () => {
  it('draws an opaque outlined label kept inside a narrow canvas', () => {
    const grid = createGrid({ canvas: { width: 300, height: 170 } });
    grid.setLogicalSize(300, 170);
    const drawn = [];
    const ctx = new Proxy({
      measureText: (text) => ({ width: text.length * 7 }),
      fillText: (text, x) => drawn.push({ kind: 'fill', text, x, style: ctx.fillStyle }),
      strokeText: (text, x) => drawn.push({ kind: 'stroke', text, x })
    }, {
      get(target, prop) { return prop in target ? target[prop] : () => {}; },
      set(target, prop, value) { target[prop] = value; return true; }
    });
    grid.renderFrontEdgeIndicator(ctx);

    const fill = drawn.find(d => d.kind === 'fill');
    assert.ok(drawn.some(d => d.kind === 'stroke'), 'label has an outline');
    assert.doesNotMatch(String(fill.style), /rgba\(255, 80, 80, 0?\.\d+\)/, 'label is not drawn with the pulsing glow alpha');
    assert.ok(fill.x + fill.text.length * 7 <= 300, `label ends at ${fill.x + fill.text.length * 7}`);
  });
});
