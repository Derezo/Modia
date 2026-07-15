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
