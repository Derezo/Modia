import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { devicePixelRatio: 1 };

const {
  BattleGrid,
  renderBattleSceneBackdrop
} = await import('../BattleGrid.js');
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

  it('routes a player through a living ally while opponents and occupied goals block', () => {
    const grid = createGrid(4, 1);
    const units = new Map([
      ['player', {
        id: 'player',
        gridX: 0,
        gridY: 0,
        hp: 10,
        type: 'player',
        teamId: 'blue'
      }],
      ['ally', {
        id: 'ally',
        gridX: 1,
        gridY: 0,
        hp: 10,
        type: 'enemy',
        teamId: 'blue'
      }],
      ['opponent', {
        id: 'opponent',
        gridX: 3,
        gridY: 0,
        hp: 10,
        type: 'player',
        teamId: 'red'
      }]
    ]);
    const pathfinding = new BattlePathfinding(grid, units);

    assert.deepEqual(pathfinding.getReachableTiles(0, 0, 3), [
      { x: 2, y: 0, z: 0, cost: 2 }
    ]);
    assert.deepEqual(pathfinding.findPath(0, 0, 2, 0), [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    ]);
    assert.equal(pathfinding.findPath(0, 0, 1, 0), null);
    assert.equal(pathfinding.findPath(0, 0, 3, 0), null);
    assert.equal(pathfinding.isValidMove(1, 0), false);
    assert.equal(pathfinding.isValidMove(3, 0), false);
  });

  it('uses projected legacy types when an enemy crosses an ally', () => {
    const grid = createGrid(4, 1);
    const units = new Map([
      ['enemy-mover', {
        id: 'enemy-mover',
        gridX: 0,
        gridY: 0,
        hp: 10,
        type: 'enemy'
      }],
      ['enemy-ally', {
        id: 'enemy-ally',
        gridX: 1,
        gridY: 0,
        hp: 10,
        type: 'enemy'
      }],
      ['player-opponent', {
        id: 'player-opponent',
        gridX: 3,
        gridY: 0,
        hp: 10,
        type: 'player'
      }]
    ]);
    const pathfinding = new BattlePathfinding(grid, units);

    assert.deepEqual(pathfinding.findPath(0, 0, 2, 0), [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    ]);
    assert.equal(pathfinding.findPath(0, 0, 1, 0), null);
    assert.equal(pathfinding.findPath(0, 0, 3, 0), null);
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

  it('uses V3 obstacle cells for collision while rendering only at the anchor', () => {
    const grid = createGrid(4, 1);
    const obstacle = {
      id: 'obstacle:fallen-tree',
      kind: 'fallen-tree',
      cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
      blocking: true,
      movementCost: 0,
      anchor: { x: 2, y: 0 }
    };
    grid.setObstacles([obstacle]);
    const traversal = grid.createTraversalView();

    assert.equal(grid.getObstacle(1, 0), null, 'footprint cells do not duplicate rendering');
    assert.equal(grid.getObstacle(2, 0).id, obstacle.id);
    assert.equal(traversal.obstacles[0][1].id, obstacle.id);
    assert.equal(traversal.obstacles[0][2].id, obstacle.id);
    assert.equal(grid.isWalkable(1, 0), false);
    assert.equal(grid.isWalkable(2, 0), false);

    assert.throws(
      () => grid.setObstacles([
        obstacle,
        {
          ...obstacle,
          id: 'obstacle:rock',
          cells: [{ x: 2, y: 0 }]
        }
      ]),
      error => (
        error.code === 'INVALID_BATTLE_MAP_V3_TOPOLOGY' &&
        /multiple blocking obstacles occupy 2,0/.test(error.message)
      )
    );
  });

  it('enforces V3 traversable:false connections in both directions', () => {
    const grid = createGrid(2, 1);
    grid.setElevation([[0, 2]], 'discrete');
    grid.setElevationConnections([{
      id: 'connection:cliff',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      direction: 'e',
      kind: 'cliff',
      heightDelta: 2,
      traversable: false,
      bidirectional: false
    }]);
    const traversal = grid.createTraversalView([], {
      canTraverseElevation: () => true
    });

    assert.equal(
      traversal.elevationConnections[0][0].e.traversable,
      false
    );
    assert.equal(
      traversal.elevationConnections[0][1].w.traversable,
      false
    );
    assert.equal(grid.isWalkable(1, 0, { from: { x: 0, y: 0 } }), false);
    assert.equal(grid.isWalkable(0, 0, { from: { x: 1, y: 0 } }), false);
  });

  it('filters attack, AoE, and selectable tiles through the V3 playable mask', () => {
    const grid = createGrid(3, 2);
    grid.setMasks(
      [[true, true, true], [true, true, true]],
      [[true, false, true], [false, true, false]]
    );
    const pathfinding = new BattlePathfinding(grid, new Map());

    assert.deepEqual(
      pathfinding.getAttackableTiles(0, 0, 2).map(tile => [tile.x, tile.y]),
      [[1, 1], [2, 0]]
    );
    assert.deepEqual(
      pathfinding.getAoETiles(1, 0, 1, 'circle').map(tile => [tile.x, tile.y]),
      [[0, 0], [1, 1], [2, 0]]
    );
    assert.equal(pathfinding.isValidMove(1, 0), false);
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

  it('does not expose rendered V3 scene-only cells to hit testing', () => {
    const grid = createGrid(2, 1);
    grid.setMasks([[true, true]], [[true, false]]);
    const sceneOnlyCenter = grid.gridToScreen(1, 0);

    assert.equal(
      grid.getTileAtScreen(sceneOnlyCenter.x, sceneOnlyCenter.y),
      null
    );
    assert.deepEqual(
      grid.getTileAtScreen(
        sceneOnlyCenter.x,
        sceneOnlyCenter.y,
        null,
        true
      ),
      []
    );
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

  it('renders the V3 scene silhouette while skipping void cells', () => {
    const grid = createGrid(2, 2);
    grid.setMasks(
      [[true, false], [true, true]],
      [[true, false], [true, true]]
    );
    const order = [];
    grid.renderTileUnified = (_ctx, _sx, _sy, x, y) => order.push(`${x},${y}`);

    grid.render({});

    assert.deepEqual(order, ['0,0', '0,1', '1,1']);
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

  it('does not apply the universal legacy edge skirt to V3 masks', () => {
    const grid = createGrid(1, 1);
    grid.setElevation([[2]], 'discrete');
    grid.setMasks([[true]], [[true]]);
    let rendered = false;
    grid.renderTexturedWall = () => {
      rendered = true;
    };
    grid.assetLoader = { getWallTexture: () => ({ width: 128, height: 32 }) };

    grid.renderUnifiedWalls({}, 100, 80, 0, 0, 2, 'stone', 'forest');

    assert.equal(rendered, false);
  });

  it('sorts V3 surfaces, layers, units, and props by shared base contact', () => {
    const grid = createGrid(1, 1);
    const renderer = (id, stratum, width = 256, height = 128) => ({
      id,
      width,
      height,
      pivot: { x: width / 2, y: height / 2 },
      anchor: { x: width / 2, y: height / 2 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width, height },
      occlusionBounds: { x: 0, y: 0, width, height },
      stratum
    });
    const asset = key => ({ key });
    const surface = asset('surface');
    const route = asset('route');
    const obstacle = asset('obstacle');
    grid.setMasks([[true]], [[true]]);
    grid.setBattleMapV3RenderData({
      visualCells: [[{ surface, overlays: [] }]],
      surfaceRenderers: [[renderer('surface', 'surface')]],
      layers: [[[
        {
          asset: route,
          category: 'route',
          renderer: renderer('route', 'route'),
          direction: null,
          routeTopology: {
            neighbors: ['e', 'w'],
            textureSeed: 31,
            width: 2,
            visualSeed: 17
          }
        }
      ]]],
      obstacleLayers: [{
        asset: obstacle,
        renderer: renderer('obstacle', 'obstacle', 192, 256),
        direction: null,
        record: { id: 'obstacle' },
        cell: { x: 0, y: 0 }
      }],
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      }
    });
    grid.setAssetLoader({
      getBattleMapV3Asset(reference) {
        const dimensions = reference.key === 'obstacle'
          ? { width: 192, height: 256 }
          : { width: 256, height: 128 };
        return { id: reference.key, ...dimensions };
      }
    });
    const order = [];
    grid.renderTileHighlight = () => order.push('highlight');
    let routeClips = 0;
    let routeCurves = 0;
    const routeJoins = [];
    const routeFills = [];
    const routeDraws = [];
    const alphaStack = [];
    const filterStack = [];
    const ctx = {
      globalAlpha: 1,
      filter: 'none',
      save() {
        alphaStack.push(this.globalAlpha);
        filterStack.push(this.filter);
      },
      restore() {
        this.globalAlpha = alphaStack.pop();
        this.filter = filterStack.pop();
      },
      translate() {},
      scale() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() { routeCurves++; },
      ellipse(_x, _y, radiusX, radiusY) {
        routeJoins.push({ radiusX, radiusY });
      },
      fill() {
        routeFills.push({
          color: this.fillStyle,
          alpha: this.globalAlpha
        });
      },
      clip() { routeClips++; },
      drawImage(image) {
        order.push(image.id);
        if (image.id === 'route') {
          routeDraws.push({
            alpha: this.globalAlpha,
            filter: this.filter
          });
        }
      }
    };
    grid.render(ctx, { '0,0': 'rgba(30, 120, 220, 0.5)' }, null, {
      entities: [{ gridX: 0, gridY: 0, getRenderDepth: () => 0 }],
      renderEntity: () => order.push('unit')
    });

    assert.deepEqual(
      order,
      ['surface', 'route', 'highlight', 'unit', 'obstacle']
    );
    assert.equal(routeClips, 0, 'the exact authored route sprite is not clipped');
    assert.deepEqual(routeFills, [
      { color: '#a08352', alpha: 0.18 },
      { color: '#80613d', alpha: 0.32 }
    ]);
    assert.deepEqual(routeDraws, [{
      alpha: 1,
      filter: 'brightness(101%) saturate(96%)'
    }]);
    assert.ok(routeCurves >= 4, 'both underpaint passes follow curved topology');
    assert.equal(routeJoins.length, 2);
    assert.ok(routeJoins[0].radiusX > routeJoins[1].radiusX);
    for (const join of routeJoins) {
      assert.equal(
        join.radiusY,
        join.radiusX / 2,
        'route joins follow the 2:1 isometric projection'
      );
    }

    const defaultRouteFills = structuredClone(routeFills);
    const defaultRouteJoins = structuredClone(routeJoins);
    const defaultRouteDraws = structuredClone(routeDraws);
    order.length = 0;
    routeFills.length = 0;
    routeJoins.length = 0;
    routeDraws.length = 0;
    grid.battleMapV3RenderData.renderProfileId = 'non-fallen-oak-profile';
    grid.render(ctx, { '0,0': 'rgba(30, 120, 220, 0.5)' }, null, {
      entities: [{ gridX: 0, gridY: 0, getRenderDepth: () => 0 }],
      renderEntity: () => order.push('unit')
    });

    assert.deepEqual(
      order,
      ['surface', 'route', 'highlight', 'unit', 'obstacle']
    );
    assert.deepEqual(routeFills, defaultRouteFills);
    assert.deepEqual(routeJoins, defaultRouteJoins);
    assert.deepEqual(routeDraws, defaultRouteDraws);

    order.length = 0;
    routeFills.length = 0;
    routeJoins.length = 0;
    routeDraws.length = 0;
    grid.battleMapV3RenderData.renderProfileId =
      'forest-heartlands-fallen-oak-v1';
    grid.render(ctx, { '0,0': 'rgba(30, 120, 220, 0.5)' }, null, {
      entities: [{ gridX: 0, gridY: 0, getRenderDepth: () => 0 }],
      renderEntity: () => order.push('unit')
    });

    assert.deepEqual(
      order,
      ['surface', 'route', 'highlight', 'unit', 'obstacle'],
      'the fallen-oak route treatment preserves painter order'
    );
    assert.deepEqual(routeFills, [
      { color: '#ad8b57', alpha: 0.16 },
      { color: '#8a6b42', alpha: 0.22 }
    ]);
    assert.equal(routeJoins.length, 2);
    assert.ok(routeJoins[0].radiusX > defaultRouteJoins[0].radiusX);
    assert.ok(routeJoins[1].radiusX > defaultRouteJoins[1].radiusX);
    assert.deepEqual(routeDraws, [{
      alpha: 0.18,
      filter: 'brightness(89%) saturate(60%)'
    }]);
  });

  it('bridges the complete elevation gap for a north-facing connection', () => {
    const grid = createGrid(2, 2);
    const bridge = grid.getBattleMapV3ConnectionBridge({
      direction: 'n',
      record: { heightDelta: 1 }
    }, 100, 80);

    assert.deepEqual(bridge, {
      points: [
        { x: 100, y: 64 },
        { x: 132, y: 80 },
        { x: 132, y: 64 },
        { x: 100, y: 48 }
      ],
      midpoint: { x: 116, y: 64 },
      lowMidpoint: { x: 116, y: 72 },
      highMidpoint: { x: 116, y: 56 }
    });
  });

  it('uses terrain-derived legacy connection fill with no raw brown fallback', () => {
    const grid = createGrid(2, 1);
    const renderer = {
      category: 'surface',
      width: 256,
      height: 128,
      pivot: { x: 128, y: 64 },
      anchor: { x: 128, y: 64 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width: 256, height: 128 },
      occlusionBounds: { x: 0, y: 0, width: 0, height: 0 },
      stratum: 'surface'
    };
    const asset = { key: 'surface' };
    grid.setMasks([[true, true]], [[true, true]]);
    grid.setBattleMapV3RenderData({
      visualCells: [[
        { surface: asset, overlays: [] },
        { surface: asset, overlays: [] }
      ]],
      surfaceRenderers: [[renderer, renderer]],
      layers: [[[], []]],
      obstacleLayers: [],
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      }
    });
    grid.setAssetLoader({
      getBattleMapV3Asset: () => ({ width: 256, height: 128 })
    });
    const fills = [];
    const gradient = { addColorStop() {} };
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      fill() { fills.push(this.fillStyle); },
      clip() {},
      translate() {},
      scale() {},
      drawImage() {},
      stroke() {},
      createLinearGradient() { return gradient; }
    };
    const layer = {
      asset,
      renderer,
      category: 'elevation-slope',
      direction: 'e',
      authoredDirectional: false,
      record: {
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        heightDelta: 1
      }
    };
    grid.renderBattleMapV3Slope(ctx, layer, 100, 80, 1);
    grid.renderBattleMapV3LegacyConnectionUnderlay(
      ctx,
      { ...layer, category: 'elevation-connection' },
      100,
      80,
      1
    );

    assert.ok(fills.includes(grid.getTerrainColor('grass')));
    assert.ok(!fills.includes('#493a25'));
    assert.ok(!fills.includes('#4b3522'));
  });

  it('underlays every authored slope and stair with exact regional terrain', () => {
    const grid = createGrid(3, 3);
    const surfaceRenderer = {
      category: 'surface',
      width: 256,
      height: 128,
      pivot: { x: 128, y: 64 },
      anchor: { x: 128, y: 64 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width: 256, height: 128 },
      occlusionBounds: { x: 0, y: 0, width: 256, height: 128 },
      stratum: 'surface'
    };
    const connectionRenderer = {
      category: 'connection-stairs',
      width: 256,
      height: 192,
      pivot: { x: 128, y: 128 },
      anchor: { x: 128, y: 128 },
      footprint: { x: 0, y: 0, width: 1, height: 2 },
      drawBounds: { x: 0, y: 0, width: 256, height: 192 },
      occlusionBounds: { x: 0, y: 0, width: 256, height: 192 },
      stratum: 'connection'
    };
    const foundation = { key: 'regional-surface-0' };
    grid.setBattleMapV3RenderData({
      visualCells: Array.from({ length: 3 }, () => Array(3).fill(null)),
      surfaceRenderers: Array.from({ length: 3 }, () => Array(3).fill(null)),
      layers: Array.from(
        { length: 3 },
        () => Array.from({ length: 3 }, () => [])
      ),
      obstacleLayers: [],
      surfaceFoundation: {
        asset: foundation,
        renderer: surfaceRenderer
      },
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      }
    });
    grid.setAssetLoader({
      getBattleMapV3Asset(reference) {
        return reference.key === foundation.key
          ? { id: reference.key, width: 256, height: 128 }
          : { id: reference.key, width: 256, height: 192 };
      }
    });

    const specs = [
      ['elevation-slope', 'e', { x: 0, y: 1 }, { x: 1, y: 1 }],
      ['elevation-slope', 'w', { x: 2, y: 1 }, { x: 1, y: 1 }],
      ['elevation-connection', 'n', { x: 1, y: 1 }, { x: 1, y: 0 }],
      ['elevation-connection', 's', { x: 1, y: 1 }, { x: 1, y: 2 }]
    ];
    const alphaStack = [];
    const filterStack = [];
    const draws = [];
    const fills = [];
    const ctx = {
      globalAlpha: 1,
      filter: 'none',
      save() {
        alphaStack.push(this.globalAlpha);
        filterStack.push(this.filter);
      },
      restore() {
        this.globalAlpha = alphaStack.pop();
        this.filter = filterStack.pop();
      },
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      fill() { fills.push(this.fillStyle); },
      clip() {},
      createLinearGradient() {
        return { addColorStop() {} };
      },
      translate() {},
      scale() {},
      drawImage(image) { draws.push(image.id); }
    };
    for (const [category, direction, from, to] of specs) {
      const asset = { key: `${category}:${direction}` };
      const layer = {
        asset,
        renderer: {
          ...connectionRenderer,
          category: category === 'elevation-slope'
            ? 'connection-slope'
            : 'connection-stairs'
        },
        category,
        direction,
        authoredDirectional: true,
        record: {
          kind: category === 'elevation-slope' ? 'slope' : 'stairs',
          from,
          to,
          heightDelta: 1
        }
      };
      assert.equal(
        grid.getBattleMapV3ConnectionBridge(layer, 100, 80).points.length,
        4
      );
      grid.renderBattleMapV3Asset(ctx, layer, 100, 80);
    }

    assert.deepEqual(draws, specs.flatMap(([category, direction]) => [
      foundation.key,
      foundation.key,
      foundation.key,
      `${category}:${direction}`
    ]));
    assert.equal(
      fills.filter(fill => fill === grid.getTerrainColor('grass')).length,
      specs.length
    );
    assert.ok(fills.every(fill =>
      typeof fill !== 'string' ||
      !['#ffffff', '#D7C5A9', '#C9D8D8', '#9DB8C4'].includes(fill)
    ));
  });

  it('bridges camera-facing elevation faces with level-aware moss earth', () => {
    const grid = createGrid(2, 2);
    const renderer = {
      width: 256,
      height: 256,
      pivot: { x: 128, y: 192 },
      anchor: { x: 128, y: 192 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width: 256, height: 256 },
      occlusionBounds: { x: 32, y: 16, width: 192, height: 176 },
      stratum: 'boundary'
    };
    const asset = { key: 'earth-face' };
    grid.setBattleMapV3RenderData({
      visualCells: [[null, null], [null, null]],
      surfaceRenderers: [[null, null], [null, null]],
      layers: [[[], []], [[], []]],
      obstacleLayers: [],
      renderProfileId: 'legacy-forest-profile',
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      }
    });
    grid.setAssetLoader({
      getBattleMapV3Asset: () => ({ id: 'face', width: 256, height: 256 })
    });
    const eastLayer = {
      asset,
      renderer,
      category: 'boundary',
      direction: 'e',
      authoredDirectional: true,
      record: { kind: 'elevation-face', levelOffset: 2 }
    };
    assert.deepEqual(
      grid.getBattleMapV3ElevationFaceBridge(eastLayer, 100, 80),
      {
        levelOffset: 2,
        points: [
          { x: 132, y: 80 },
          { x: 100, y: 96 },
          { x: 100, y: 128 },
          { x: 132, y: 112 }
        ],
        topMidpoint: { x: 116, y: 88 },
        bottomMidpoint: { x: 116, y: 120 }
      }
    );

    const events = [];
    const colors = [];
    const strokes = [];
    const gradient = {
      addColorStop(_offset, color) { colors.push(color); }
    };
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      fill() { events.push('bridge'); },
      clip() {},
      stroke() { strokes.push(this.strokeStyle); },
      createLinearGradient() { return gradient; },
      translate() {},
      scale() {},
      drawImage() { events.push('face'); }
    };
    grid.renderBattleMapV3Asset(ctx, eastLayer, 100, 80);
    assert.deepEqual(events, ['bridge', 'face', 'face']);
    assert.deepEqual(colors, ['#655d3d', '#735a3c', '#684b34']);
    assert.deepEqual(strokes, [
      'rgba(76, 52, 31, 0.36)',
      'rgba(133, 124, 73, 0.28)',
      'rgba(76, 52, 31, 0.36)',
      'rgba(133, 124, 73, 0.28)'
    ]);
    assert.ok(colors.every(color => !['#000000', '#493a25', '#4b3522'].includes(color)));

    events.length = 0;
    grid.battleMapV3RenderData.renderProfileId =
      'forest-heartlands-fallen-oak-v1';
    grid.renderBattleMapV3Asset(ctx, eastLayer, 100, 80);
    assert.deepEqual(
      events,
      ['bridge', 'face'],
      'the fallen-oak profile draws the elevation face only inside its clipped bridge'
    );

    events.length = 0;
    grid.renderBattleMapV3Asset(ctx, {
      ...eastLayer,
      record: { kind: 'biome-edge' }
    }, 100, 80);
    assert.deepEqual(events, ['face'], 'biome edges never receive an earth bridge');

    events.length = 0;
    const northFace = {
      ...eastLayer,
      direction: 'n',
      record: { kind: 'elevation-face', levelOffset: 2 }
    };
    assert.doesNotThrow(() =>
      grid.renderBattleMapV3Asset(ctx, northFace, 100, 80)
    );
    assert.deepEqual(events, ['face']);
    assert.deepEqual(
      grid.getBattleMapV3AssetGeometry(northFace, 100, 80).pivotOrigin,
      { x: 100, y: 80 },
      'rear elevation faces use their authored generic boundary anchor'
    );
  });

  it('keeps authored V2 surfaces upright with only subtle tone variation', () => {
    const grid = createGrid(2, 1);
    const renderer = {
      category: 'surface',
      width: 256,
      height: 128,
      pivot: { x: 128, y: 64 },
      anchor: { x: 128, y: 64 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width: 256, height: 128 },
      occlusionBounds: { x: 0, y: 0, width: 256, height: 128 },
      stratum: 'surface'
    };
    const foundation = { key: 'surface-variant-0' };
    const first = { key: 'surface-variant-1' };
    const second = { key: 'surface-variant-2' };
    grid.setElevation([[0, 2]], 'discrete');
    grid.setBattleMapV3RenderData({
      visualCells: [[
        { surface: first, overlays: [] },
        { surface: second, overlays: [] }
      ]],
      surfaceRenderers: [[renderer, renderer]],
      layers: [[[], []]],
      obstacleLayers: [],
      surfaceFoundation: {
        asset: foundation,
        renderer
      },
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      }
    });
    grid.setAssetLoader({
      getBattleMapV3Asset: reference => ({
        id: reference.key,
        width: 256,
        height: 128
      })
    });
    const alphaStack = [];
    const filterStack = [];
    const scales = [];
    const filters = [];
    const draws = [];
    const ctx = {
      globalAlpha: 1,
      imageSmoothingEnabled: false,
      filter: 'none',
      save() {
        alphaStack.push(this.globalAlpha);
        filterStack.push(this.filter);
      },
      restore() {
        this.globalAlpha = alphaStack.pop();
        this.filter = filterStack.pop();
      },
      translate() {},
      scale(x, y) {
        scales.push({ x, y });
        filters.push(this.filter);
      },
      drawImage(image) {
        draws.push({ id: image.id, alpha: this.globalAlpha });
      }
    };
    grid.renderBattleMapV3Tile(ctx, 100, 80, 0, 0);
    grid.renderBattleMapV3Tile(ctx, 132, 80, 1, 0);

    assert.deepEqual(scales, [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 }
    ]);
    assert.deepEqual(draws.map(draw => draw.id), [
      foundation.key,
      first.key,
      foundation.key,
      second.key
    ]);
    assert.deepEqual(
      draws.filter(draw => draw.id === foundation.key).map(draw => draw.alpha),
      [1, 1]
    );
    assert.ok(
      draws.filter(draw => draw.id !== foundation.key)
        .every(draw => draw.alpha >= 0.36 && draw.alpha <= 0.5)
    );
    for (const filter of filters) {
      const [, brightness, saturation] =
        /brightness\((\d+)%\) saturate\((\d+)%\)/.exec(filter) ?? [];
      assert.ok(Number(brightness) >= 98 && Number(brightness) <= 102);
      assert.ok(Number(saturation) >= 103 && Number(saturation) <= 109);
      const [, hueRotate] = /hue-rotate\((\d+)deg\)/.exec(filter) ?? [];
      assert.ok(Number(hueRotate) >= 4 && Number(hueRotate) <= 20);
    }

    draws.length = 0;
    grid.battleMapV3RenderData.renderProfileId =
      'forest-heartlands-fallen-oak-v1';
    grid.battleMapV3RenderData.surfaceFoundation = null;
    grid.renderBattleMapV3Tile(ctx, 100, 80, 0, 0);
    assert.deepEqual(
      draws,
      [{ id: first.key, alpha: 1 }],
      'foundation-free fallen-oak semantic surfaces remain fully opaque'
    );
  });

  it('includes a larger asymmetric surface foundation in V3 world bounds', () => {
    const grid = createGrid(1, 1);
    const asset = { key: 'selected-surface' };
    const foundationAsset = { key: 'foundation-surface' };
    const renderer = {
      category: 'surface',
      width: 256,
      height: 128,
      pivot: { x: 128, y: 64 },
      anchor: { x: 128, y: 64 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width: 256, height: 128 },
      occlusionBounds: { x: 0, y: 0, width: 256, height: 128 },
      stratum: 'surface'
    };
    const foundationRenderer = {
      ...renderer,
      width: 400,
      height: 240,
      pivot: { x: 220, y: 140 },
      anchor: { x: 200, y: 120 },
      drawBounds: { x: 0, y: 0, width: 400, height: 240 },
      occlusionBounds: { x: 0, y: 0, width: 400, height: 240 }
    };
    grid.setMasks([[true]], [[true]]);
    grid.setBattleMapV3RenderData({
      visualCells: [[{ surface: asset, overlays: [] }]],
      surfaceRenderers: [[renderer]],
      layers: [[[]]],
      obstacleLayers: [],
      surfaceFoundation: {
        asset: foundationAsset,
        renderer: foundationRenderer
      },
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      }
    });
    const world = grid.gridToScreenWorld(0, 0);
    const foundationGeometry = grid.getBattleMapV3AssetGeometry({
      asset: foundationAsset,
      renderer: foundationRenderer,
      category: 'surface',
      direction: null
    }, world.x, world.y);
    const dimensions = grid.getBattleMapV3PixelDimensions();

    assert.equal(dimensions.worldMinX, foundationGeometry.drawBounds.x);
    assert.equal(dimensions.worldMinY, foundationGeometry.drawBounds.y);
    assert.equal(
      dimensions.worldMaxX,
      foundationGeometry.drawBounds.x + foundationGeometry.drawBounds.width
    );
    assert.equal(
      dimensions.worldMaxY,
      foundationGeometry.drawBounds.y + foundationGeometry.drawBounds.height
    );
    assert.deepEqual(grid.getMapCenter(), {
      x: dimensions.worldMinX + dimensions.width / 2,
      y: dimensions.worldMinY + dimensions.height / 2
    });
  });

  it('orders organic rear canopy before actors and front skirts after them', () => {
    const grid = createGrid(1, 1);
    const renderer = (stratum, width = 256, height = 128) => ({
      width,
      height,
      pivot: { x: width / 2, y: height / 2 },
      anchor: { x: width / 2, y: height / 2 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      drawBounds: { x: 0, y: 0, width, height },
      occlusionBounds: { x: 0, y: 0, width: 0, height: 0 },
      stratum
    });
    const surface = { key: 'surface' };
    const rear = { key: 'rear' };
    const front = { key: 'front' };
    grid.setMasks([[true]], [[true]]);
    grid.setBattleMapV3RenderData({
      visualCells: [[{ surface, overlays: [] }]],
      surfaceRenderers: [[renderer('surface')]],
      layers: [[[
        {
          asset: rear,
          category: 'boundary',
          renderer: renderer('boundary', 192, 256),
          direction: 'n',
          exteriorStratum: 'rear-canopy',
          record: { kind: 'biome-edge' }
        },
        {
          asset: front,
          category: 'boundary',
          renderer: renderer('boundary', 192, 256),
          direction: 's',
          exteriorStratum: 'front-skirt',
          record: { kind: 'biome-edge' }
        }
      ]]],
      obstacleLayers: [],
      renderProfile: {
        sourcePixelScale: 4,
        tileWidth: 64,
        tileHeight: 32,
        elevationStep: 16
      },
      scene: {
        silhouette: 'organic-island',
        exterior: 'forest-canopy',
        backdrop: {
          kind: 'sky-gradient',
          topColor: '#6688AA',
          horizonColor: '#AACCDE',
          bottomColor: '#DDEEFF',
          hazeColor: '#EEF8FF'
        }
      }
    });
    const order = [];
    grid.setAssetLoader({
      getBattleMapV3Asset(reference) {
        return {
          id: reference.key,
          width: reference.key === 'surface' ? 256 : 192,
          height: reference.key === 'surface' ? 128 : 256
        };
      }
    });
    const ctx = {
      globalAlpha: 1,
      save() {},
      restore() {},
      translate() {},
      scale() {},
      drawImage(image) { order.push(image.id); }
    };
    grid.render(ctx, {}, null, {
      entities: [{ gridX: 0, gridY: 0, getRenderDepth: () => 0 }],
      renderEntity: () => order.push('unit')
    });
    assert.deepEqual(order, ['surface', 'rear', 'unit', 'front']);
  });
});

describe('BattleGrid scene backdrop', () => {
  it('renders the pinned production gradient and atmosphere before map art', () => {
    const gradients = [];
    const fills = [];
    const makeGradient = kind => {
      const stops = [];
      const gradient = {
        kind,
        stops,
        addColorStop(offset, color) { stops.push([offset, color]); }
      };
      gradients.push(gradient);
      return gradient;
    };
    const ctx = {
      save() {},
      restore() {},
      fillRect() { fills.push(this.fillStyle); },
      createLinearGradient() { return makeGradient('linear'); },
      createRadialGradient() { return makeGradient('radial'); }
    };
    const scene = {
      silhouette: 'organic-island',
      exterior: 'forest-canopy',
      backdrop: {
        kind: 'sky-gradient',
        topColor: '#6688AA',
        horizonColor: '#AACCDE',
        bottomColor: '#DDEEFF',
        hazeColor: '#EEF8FF'
      }
    };
    renderBattleSceneBackdrop(ctx, { width: 800, height: 600, scene });

    assert.deepEqual(gradients[0].stops, [
      [0, '#6688AA'],
      [0.58, '#AACCDE'],
      [1, '#DDEEFF']
    ]);
    assert.deepEqual(gradients[1].stops, [
      [0, '#EEF8FF66'],
      [0.55, '#EEF8FF20'],
      [1, '#EEF8FF00']
    ]);
    assert.deepEqual(fills, gradients);
    assert.ok(!gradients[0].stops.some(([, color]) => color === '#000000'));
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

describe('BattleGrid grid lines setting', () => {
  function strokeCounter() {
    let strokes = 0;
    const ctx = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'stroke') return () => { strokes++; };
        return () => {};
      },
      set() { return true; }
    });
    return { ctx, count: () => strokes };
  }

  it('outlines a playable tile only when grid lines are enabled', () => {
    const grid = createGrid();
    const off = strokeCounter();
    grid.showGridLines = false;
    grid.renderTileGridLine(off.ctx, 100, 100, 0, 0);
    assert.equal(off.count(), 0);

    const on = strokeCounter();
    grid.showGridLines = true;
    grid.renderTileGridLine(on.ctx, 100, 100, 0, 0);
    assert.equal(on.count(), 1);
  });

  it('keeps movement highlights when grid lines are disabled', () => {
    const grid = createGrid();
    grid.showGridLines = false;
    const drawn = [];
    grid.renderTileHighlight = (_ctx, _x, _y, color) => drawn.push(color);
    const noopCtx = new Proxy({}, { get: () => () => {}, set: () => true });
    grid.render(noopCtx, { '0,0': 'rgba(0, 128, 255, 0.4)' }, null, {});
    assert.deepEqual(drawn, ['rgba(0, 128, 255, 0.4)']);
  });
});
