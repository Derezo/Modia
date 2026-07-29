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

  it('uses persisted directional connections and obstacle occupancy', () => {
    const grid = createGrid(3, 1);
    grid.setElevation([[0, 2, 2]], 'discrete');
    grid.setElevationConnections([[
      { e: { type: 'slope', levels: 2 } },
      { w: { type: 'slope', levels: 2 } },
      null
    ]]);
    grid.setObstacles([[
      null,
      null,
      { type: 'rocks', passable: false }
    ]]);
    const pathfinding = new BattlePathfinding(grid, new Map());

    assert.deepEqual(
      pathfinding.findPath(0, 0, 1, 0),
      [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 2 }]
    );
    assert.equal(pathfinding.findPath(0, 0, 2, 0), null);
    assert.equal(grid.isWalkable(2, 0), false);
  });

  it('does not allow ordinary paths onto occupied destinations', () => {
    const grid = createGrid(2, 1);
    const units = new Map([[
      'enemy',
      { gridX: 1, gridY: 0, hp: 10 }
    ]]);
    const pathfinding = new BattlePathfinding(grid, units);

    assert.equal(pathfinding.findPath(0, 0, 1, 0), null);
  });

  it('routes through a dead unit without exposing its tile as a destination', () => {
    const grid = createGrid(3, 1);
    const units = new Map([[
      'corpse',
      { gridX: 1, gridY: 0, hp: 0 }
    ]]);
    const pathfinding = new BattlePathfinding(grid, units);

    assert.deepEqual(pathfinding.getReachableTiles(0, 0, 2), [
      { x: 2, y: 0, z: 0, cost: 2 }
    ]);
    assert.deepEqual(pathfinding.findPath(0, 0, 2, 0), [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    ]);
    assert.equal(pathfinding.findPath(0, 0, 1, 0), null);
    assert.equal(pathfinding.isValidMove(1, 0), false);
  });

  it('hydrates BattleMapV2 terrain, obstacles, and connections', () => {
    const grid = createGrid(3, 1);
    grid.setTerrain([[
      { material: 'grass', movementCost: 1, passable: true, regionId: 'r1' },
      { material: 'stone', movementCost: 2, passable: true, regionId: 'r1' },
      { material: 'grass', movementCost: 1, passable: true, regionId: 'r1' }
    ]]);
    grid.setElevation([[0.5, 0.75, 0.75]], 'normalized');
    grid.setElevationConnections([{
      id: 'connection:ramp',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      kind: 'ramp',
      direction: 'e',
      elevationDelta: 0.25,
      bidirectional: true,
      featureId: 'route:main'
    }]);
    grid.setObstacles([{
      id: 'obstacle:tree',
      x: 2,
      y: 0,
      kind: 'tree',
      assetKey: 'forest/tree',
      blocking: true,
      movementCost: 0,
      featureId: 'r1'
    }]);
    const pathfinding = new BattlePathfinding(grid, new Map());

    assert.equal(grid.getTerrain(1, 0), 'stone');
    assert.equal(grid.getObstacle(2, 0).type, 'tree');
    assert.deepEqual(pathfinding.getReachableTiles(0, 0, 3), [
      { x: 1, y: 0, z: 3, cost: 2 }
    ]);
    assert.deepEqual(pathfinding.findPath(0, 0, 1, 0), [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 3 }
    ]);
    assert.equal(pathfinding.findPath(0, 0, 2, 0), null);
    assert.equal(grid.isWalkable(2, 0), false);
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

describe('BattleGrid V2 visual layers', () => {
  it('normalizes flat variant records into deterministic row-major lookup', () => {
    const grid = createGrid(3, 2);

    grid.setTileVariants([
      { id: 'variant:1:2', x: 2, y: 1, material: 'grass', variantIndex: 3 },
      { id: 'variant:0:0', x: 0, y: 0, material: 'grass', variantIndex: 2 }
    ]);

    assert.equal(grid.semanticVariants, true);
    assert.deepEqual(grid.tileVariants, [
      [2, 0, 0],
      [0, 0, 3]
    ]);
    assert.equal(grid.getTileVariant(2, 1), 3);
  });

  it('uses the authoritative V2 render palette for special node recipes', () => {
    const grid = createGrid(1, 1);
    grid.nodeType = 'dwarven_mine';
    grid.setTileVariants([
      { id: 'variant:0:0', x: 0, y: 0, material: 'stone', variantIndex: 0 }
    ]);

    assert.equal(grid.getSpriteBiome(), 'cave');
  });

  it('stores and renders transitions by stratum, precedence, kind, and id', () => {
    const grid = createGrid(1, 1);
    grid.setTransitions([
      {
        id: 'z',
        x: 0,
        y: 0,
        kind: 'wetness',
        directionMask: 1,
        assetKey: 'forest:transition:wetness',
        anchor: 'tile_top',
        stratum: 20,
        precedence: 1
      },
      {
        id: 'b',
        x: 0,
        y: 0,
        kind: 'shore',
        directionMask: 2,
        assetKey: 'forest:transition:shore',
        anchor: 'tile_top',
        stratum: 10,
        precedence: 2
      },
      {
        id: 'a',
        x: 0,
        y: 0,
        kind: 'bank',
        directionMask: 4,
        assetKey: 'forest:transition:bank',
        anchor: 'tile_top',
        stratum: 10,
        precedence: 2
      }
    ]);
    grid.assetLoader = {
      getBattleMapV2Asset: assetKey => ({
        type: 'code-native',
        assetKey,
        color: '#fff',
        lineWidth: 1,
        alpha: 1
      })
    };
    const order = [];
    grid.renderCodeNativeTransition = (_ctx, _x, _y, record) => {
      order.push(record.id);
    };

    grid.renderSemanticTransitions({}, 100, 80, 0, 0, 'tile_top');

    assert.deepEqual(grid.getTransitions(0, 0).map(record => record.id), [
      'a',
      'b',
      'z'
    ]);
    assert.deepEqual(order, ['a', 'b', 'z']);
  });

  it('orders decorations deterministically and renders them before props', () => {
    const grid = createGrid(1, 1);
    grid.setDecorations([
      {
        id: 'decoration:z',
        x: 0,
        y: 0,
        kind: 'reeds',
        assetKey: 'forest:decoration-family:reeds',
        variantIndex: 1,
        anchor: 'tile_top'
      },
      {
        id: 'decoration:a',
        x: 0,
        y: 0,
        kind: 'ground-cover',
        assetKey: 'forest:decoration-family:ground-cover',
        variantIndex: 0,
        anchor: 'below_prop'
      }
    ]);
    grid.assetLoader = {
      getBattleMapV2Asset: assetKey => ({
        type: 'code-native',
        assetKey,
        color: '#fff',
        accentColor: null,
        alpha: 1,
        radius: 1
      })
    };
    const order = [];
    grid.renderCodeNativeDecoration = (_ctx, _x, _y, record) => {
      order.push(record.id);
    };
    grid.renderObstacleAt = () => order.push('prop');

    grid.renderDecorations({}, 100, 80, 0, 0);
    grid.renderObstacleAt({}, 100, 80, { type: 'tree' });

    assert.deepEqual(order, [
      'decoration:a',
      'decoration:z',
      'prop'
    ]);
  });

  it('renders exact directional slope and stair assets in tile-top order', () => {
    const grid = createGrid(2, 1);
    grid.nodeType = 'forest';
    grid.setElevationConnections([
      {
        id: 'connection:slope',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        kind: 'ramp',
        direction: 'e',
        elevationDelta: 1,
        bidirectional: true
      },
      {
        id: 'connection:stairs',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        kind: 'stairs',
        direction: 'e',
        elevationDelta: 1,
        bidirectional: true
      }
    ]);
    const slope = { id: 'slope' };
    const stairs = { id: 'stairs' };
    const lookups = [];
    grid.assetLoader = {
      getSlopeSprite(...args) {
        lookups.push(args);
        return args[3].kind === 'stairs' ? stairs : slope;
      }
    };
    const draws = [];
    const ctx = {
      drawImage(sprite) { draws.push(sprite.id); }
    };

    grid.renderElevationConnections(ctx, 100, 80, 0, 0, 'forest');

    assert.deepEqual(lookups, [
      ['forest', 'east', 1, { kind: 'slope', exact: true }],
      ['forest', 'east', 2, { kind: 'stairs', exact: true }]
    ]);
    assert.deepEqual(draws, ['slope', 'stairs']);
  });

  it('anchors every signed connection on its low endpoint toward high ground', () => {
    const directions = {
      n: { dx: 0, dy: -1, reverse: 'south' },
      e: { dx: 1, dy: 0, reverse: 'west' },
      s: { dx: 0, dy: 1, reverse: 'north' },
      w: { dx: -1, dy: 0, reverse: 'east' }
    };
    const names = {
      n: 'north',
      e: 'east',
      s: 'south',
      w: 'west'
    };

    for (const [direction, { dx, dy, reverse }] of Object.entries(directions)) {
      for (const elevationDelta of [-1, 1]) {
        const grid = createGrid(3, 3);
        grid.setElevationConnections([{
          id: `connection:${direction}:${elevationDelta}`,
          from: { x: 1, y: 1 },
          to: { x: 1 + dx, y: 1 + dy },
          kind: 'slope',
          direction,
          elevationDelta,
          bidirectional: true
        }]);
        const calls = [];
        grid.assetLoader = {
          getSlopeSprite(...args) {
            calls.push(args);
            return {};
          }
        };
        const low = elevationDelta < 0
          ? { x: 1 + dx, y: 1 + dy }
          : { x: 1, y: 1 };

        grid.renderElevationConnections(
          { drawImage() {} },
          100,
          80,
          low.x,
          low.y,
          'forest'
        );

        assert.deepEqual(calls, [[
          'forest',
          elevationDelta < 0 ? reverse : names[direction],
          1,
          { kind: 'slope', exact: true }
        ]]);
      }
    }
  });

  it('does not render ledges or cliffs as traversable slopes', () => {
    const grid = createGrid(2, 1);
    grid.setElevationConnections([
      {
        id: 'connection:cliff',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        kind: 'cliff',
        direction: 'e',
        elevationDelta: 1,
        bidirectional: false
      },
      {
        id: 'connection:ledge',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        kind: 'ledge',
        direction: 'e',
        elevationDelta: 1,
        bidirectional: false
      }
    ]);
    grid.assetLoader = {
      getSlopeSprite() {
        throw new Error('non-traversable connection requested slope art');
      }
    };

    grid.renderElevationConnections(
      { drawImage() {} },
      100,
      80,
      0,
      0,
      'forest'
    );
  });

  it('projects exposed-face transitions onto visible wall geometry', () => {
    const grid = createGrid(2, 1);
    grid.setElevation([[1, 0]], 'discrete');
    const calls = [];
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo(...args) { calls.push(['moveTo', ...args]); },
      lineTo(...args) { calls.push(['lineTo', ...args]); },
      stroke() {}
    };

    grid.renderCodeNativeTransition(
      ctx,
      100,
      80,
      {
        x: 0,
        y: 0,
        anchor: 'exposed_face',
        directionMask: 2
      },
      {
        color: '#fff',
        lineWidth: 2,
        alpha: 1
      }
    );

    assert.deepEqual(calls, [
      ['moveTo', 132, 89],
      ['lineTo', 100, 105]
    ]);
  });

  it('resolves V2 exposed faces and obstacle families by exact asset key', () => {
    const grid = createGrid(1, 1);
    grid.setTileVariants([
      { id: 'variant:0:0', x: 0, y: 0, material: 'grass', variantIndex: 0 }
    ]);
    const wall = { id: 'wall', width: 64, height: 16 };
    const rock = { id: 'rock', width: 32, height: 32 };
    const calls = [];
    grid.assetLoader = {
      getBattleMapV2Asset: (assetKey, options) => {
        calls.push([assetKey, options]);
        return assetKey.includes(':face:') ? wall : rock;
      },
      getObstacle: () => {
        throw new Error('V2 must not use legacy obstacle fallback');
      }
    };
    grid.renderTexturedWall = (
      _ctx,
      _screenX,
      _screenY,
      _left,
      _right,
      texture
    ) => assert.equal(texture, wall);
    const ctx = {
      save() {},
      restore() {},
      drawImage() {},
      globalAlpha: 1
    };

    grid.renderUnifiedWalls(ctx, 32, 32, 0, 0, 1, 'grass', 'forest');
    grid.renderObstacleAt(ctx, 32, 32, {
      id: 'obstacle:rock:0:0',
      assetKey: 'forest:obstacle-family:rock',
      type: 'rock'
    });

    assert.deepEqual(calls, [
      ['forest:face:stone', undefined],
      [
        'forest:obstacle-family:rock',
        {
          selectionKey: 'obstacle:rock:0:0',
          expectedPalette: 'forest'
        }
      ]
    ]);
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

  it('uses the exact code-native V2 dirt color as the floor underlay', () => {
    const grid = createGrid(1, 1);
    grid.setTileVariants([
      { id: 'variant:0:0', x: 0, y: 0, variantIndex: 0 }
    ]);
    grid.assetLoader = {
      getBattleMapV2Asset: () => ({
        type: 'code-native',
        color: '#765632'
      })
    };
    const calls = [];
    grid.renderTerrainDiamond = (...args) => calls.push(args);
    grid.renderCodeNativeSurface = () => {};

    grid.renderUnifiedFloor({}, 100, 80, 'dirt', 'forest', 0);

    assert.deepEqual(calls, [[
      {},
      100,
      80,
      'dirt',
      false,
      '#765632'
    ]]);
  });
});
