import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { devicePixelRatio: 1 };

const { BattleGrid } = await import('../BattleGrid.js');
const { BattlePathfinding } = await import('../BattlePathfinding.js');

function createGrid(width = 2, height = 2) {
  const grid = new BattleGrid({ width: 640, height: 480 }, width, height);
  grid.setTerrain(Array.from({ length: height }, () => Array(width).fill('grass')));
  grid.setElevation(Array.from({ length: height }, () => Array(width).fill(0)), 'discrete');
  grid.setTileVariants(Array.from({ length: height }, () => Array(width).fill(0)));
  grid.setObstacles(Array.from({ length: height }, () => Array(width).fill(null)));
  return grid;
}

describe('BattleGrid elevation contract', () => {
  it('infers a legacy integer grid as discrete at grid scope', () => {
    const grid = createGrid();
    grid.setElevation([[0, 1], [-1, 2]], 'auto');

    assert.equal(grid.elevationFormat, 'discrete');
    assert.equal(grid.getElevation(0, 0), 0);
    assert.equal(grid.getElevation(1, 0), 1);
  });

  it('infers generated fractional grids as normalized', () => {
    const grid = createGrid();
    grid.setElevation([[0.33, 0.54], [0.14, 0.66]], 'auto');

    assert.equal(grid.elevationFormat, 'normalized');
    assert.deepEqual([
      grid.getElevation(0, 0),
      grid.getElevation(1, 0),
      grid.getElevation(0, 1),
      grid.getElevation(1, 1)
    ], [0, 1, -1, 2]);
  });

  it('keeps legacy levels 0 and 1 semantic in client 3D pathfinding', () => {
    const grid = createGrid(2, 1);
    grid.setElevation([[0, 1]], 'auto');
    const pathfinding = new BattlePathfinding(grid, new Map());

    const reachable = pathfinding.getReachableTiles(0, 0, 3);
    const path = pathfinding.findPath(0, 0, 1, 0);

    assert.deepEqual(
      reachable.map(tile => ({ x: tile.x, y: tile.y, z: tile.z })),
      [{ x: 1, y: 0, z: 1 }]
    );
    assert.deepEqual(path.map(tile => tile.z), [0, 1]);
  });
});

describe('BattleGrid elevated hit testing', () => {
  it('finds a raised top-edge tile when the flat inverse is out of bounds', () => {
    const grid = createGrid(1, 1);
    grid.setElevation([[1]], 'discrete');
    const center = grid.gridToScreen(0, 0);
    const point = {
      x: center.x,
      y: center.y - grid.tileHeight / 2 + 1
    };

    assert.deepEqual(grid.getTileAtScreen(point.x, point.y), { x: 0, y: 0 });
  });

  it('uses castle-themed sprites for guild battles', () => {
    const grid = createGrid(1, 1);
    grid.nodeType = 'guild';

    assert.equal(grid.getSpriteBiome(), 'castle');
  });
});

describe('BattleGrid unified painter queue', () => {
  it('places an entity after its terrain row and before foreground terrain', () => {
    const grid = createGrid();
    const order = [];
    grid.renderTileUnified = (_ctx, _sx, _sy, x, y) => order.push(`tile:${x},${y}`);

    grid.render({}, {}, null, {
      entities: [{ getRenderDepth: () => 0, gridX: 0, gridY: 0 }],
      renderEntity: () => order.push('unit')
    });

    assert.deepEqual(order, [
      'tile:0,0',
      'unit',
      'tile:1,0',
      'tile:0,1',
      'tile:1,1'
    ]);
  });

  it('draws an elevated tile before a flat tile on the same depth row', () => {
    const grid = createGrid();
    grid.setElevation([[0, 0], [2, 0]], 'discrete');
    const order = [];
    grid.renderTileUnified = (_ctx, _sx, _sy, x, y) => order.push(`${x},${y}`);

    grid.render({});

    assert.ok(order.indexOf('0,1') < order.indexOf('1,0'));
  });

  it('computes only exposed camera-facing wall heights', () => {
    const grid = createGrid();
    grid.setElevation([[2, 0], [1, 0]], 'discrete');
    let exposure;
    grid.renderTexturedWall = (_ctx, _x, _y, left, right) => {
      exposure = { left, right };
    };
    grid.assetLoader = { getWallTexture: () => ({ width: 128, height: 32 }) };

    grid.renderUnifiedWalls({}, 100, 80, 0, 0, 2, 'stone', 'forest');

    assert.deepEqual(exposure, { left: 16, right: 32 });
  });
});

describe('BattleGrid retina source rendering', () => {
  it('draws a 128px source into the canonical 64px logical box', () => {
    const grid = createGrid(1, 1);
    const sprite = { width: 128, height: 128 };
    grid.assetLoader = { getTile: () => sprite };
    grid.renderTerrainDiamond = () => {};
    const calls = [];
    const ctx = {
      imageSmoothingEnabled: false,
      drawImage(...args) { calls.push(args); }
    };

    grid.renderUnifiedFloor(ctx, 100, 80, 'grass', 'forest', 0);

    assert.equal(ctx.imageSmoothingEnabled, true);
    assert.deepEqual(calls, [[sprite, 68, 48, 64, 64]]);
  });
});
