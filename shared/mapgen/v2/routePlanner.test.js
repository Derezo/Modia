import test from 'node:test';
import assert from 'node:assert/strict';

import { createTraversalView } from '../../traversal.js';
import { getV2Recipe } from './RecipeRegistry.js';
import {
  buildRouteAnchorGraph,
  createRouteReconciliationRepair,
  findLeastCostRoute,
  planFeatureRoutes
} from './RoutePlanner.js';

function grid(width, height, value) {
  return Array.from(
    { length: height },
    (_, y) => Array.from(
      { length: width },
      (_, x) => typeof value === 'function' ? value(x, y) : value
    )
  );
}

function traversal(width, height, {
  terrain = grid(width, height, 'grass'),
  obstacles = grid(width, height, null),
  elevation = grid(width, height, 0)
} = {}) {
  return createTraversalView({
    terrain,
    obstacles,
    elevation,
    elevationConnections: grid(width, height, null),
    units: [],
    dimensions: { width, height },
    movementPolicy: {
      canTraverseObstacle: ({ obstacle }) => obstacle !== 'wall'
    }
  });
}

function searchPair(options) {
  const astar = findLeastCostRoute({ ...options, algorithm: 'astar', cleanup: false });
  const dijkstra = findLeastCostRoute({
    ...options,
    algorithm: 'dijkstra',
    cleanup: false
  });
  return { astar, dijkstra };
}

test('A* cost matches Dijkstra for every built-in route cost term', () => {
  const width = 9;
  const height = 7;
  const view = traversal(width, height);
  const waterMask = grid(width, height, false);
  const bankMask = grid(width, height, false);
  const crossings = [];
  const roughness = grid(width, height, 0);
  const levels = grid(width, height, 0);
  const preferredMask = grid(width, height, false);
  const coreMask = grid(width, height, false);

  for (let x = 2; x <= 6; x++) {
    roughness[3][x] = 1_000_000;
    bankMask[2][x] = true;
    preferredMask[4][x] = true;
  }
  waterMask[3][4] = true;
  crossings.push({ id: 'crossing:center', cells: [{ x: 4, y: 3 }] });
  levels[3][5] = 1;
  coreMask[3][7] = true;

  const common = {
    start: { x: 1, y: 3 },
    goal: { x: 7, y: 3 },
    traversalView: view,
    fields: { roughness },
    hydrology: {
      waterMask,
      bankMask,
      crossingCandidates: crossings
    },
    spawnLayout: { coreMask },
    elevationLevels: levels,
    preferredMask,
    maximumSlope: 1,
    maximumWaterCrossingLength: 2
  };
  const models = [
    { slopePenalty: 4000 },
    { waterPenalty: 9000 },
    { bankPenalty: 3000 },
    { roughnessPenalty: 6000 },
    { headingChangePenalty: 2500, scoreCurvature: true },
    { preferredBonus: 900 },
    { crossingBonus: 900 },
    {
      slopePenalty: 2100,
      waterPenalty: 6200,
      bankPenalty: 750,
      roughnessPenalty: 1700,
      protectedPenalty: 800,
      headingChangePenalty: 650,
      preferredBonus: 600,
      crossingBonus: 500,
      scoreCurvature: true
    }
  ];

  for (const costModel of models) {
    const { astar, dijkstra } = searchPair({ ...common, costModel });
    assert.equal(
      astar.searchCost,
      dijkstra.searchCost,
      `cost model ${JSON.stringify(costModel)}`
    );
  }
});

test('cleanup emits neither immediate backtracking nor avoidable one-tile caps', () => {
  const width = 11;
  const height = 8;
  const obstacles = grid(width, height, null);
  for (let x = 3; x <= 7; x++) obstacles[3][x] = 'wall';
  obstacles[3][5] = null;
  const result = findLeastCostRoute({
    start: { x: 1, y: 4 },
    goal: { x: 9, y: 4 },
    traversalView: traversal(width, height, { obstacles }),
    maximumSlope: 1,
    maximumWaterCrossingLength: 2,
    costModel: {
      headingChangePenalty: 1000,
      scoreCurvature: true
    }
  });

  const key = point => `${point.x},${point.y}`;
  for (let index = 2; index < result.centerline.length; index++) {
    assert.notEqual(key(result.centerline[index]), key(result.centerline[index - 2]));
  }
  const direction = (from, to) => `${to.x - from.x},${to.y - from.y}`;
  const opposite = value => value.split(',').map(Number).map(n => -n).join(',');
  for (let index = 0; index + 3 < result.centerline.length; index++) {
    const first = direction(result.centerline[index], result.centerline[index + 1]);
    const third = direction(result.centerline[index + 2], result.centerline[index + 3]);
    assert.notEqual(first, opposite(third));
  }
});

test('constructed anchor graphs add stable deliberate loops', () => {
  const anchors = [
    { id: 'west', x: 1, y: 3 },
    { id: 'north', x: 5, y: 1 },
    { id: 'east', x: 9, y: 3 },
    { id: 'south', x: 5, y: 6 }
  ];
  const graph = buildRouteAnchorGraph({
    anchors,
    dimensions: { width: 11, height: 8 },
    family: 'constructed'
  });
  assert.equal(graph.edges.length, 4);
  assert.equal(graph.edges.filter(edge => edge.loop).length, 1);
  assert.deepEqual(
    graph,
    buildRouteAnchorGraph({
      anchors: [...anchors].reverse(),
      dimensions: { width: 11, height: 8 },
      family: 'constructed'
    })
  );
});

test('arena anchor graphs retain a deliberate loop for tactical route parity', () => {
  const graph = buildRouteAnchorGraph({
    anchors: [
      { id: 'north-west', x: 2, y: 2 },
      { id: 'north-east', x: 8, y: 2 },
      { id: 'south-east', x: 8, y: 7 },
      { id: 'south-west', x: 2, y: 7 }
    ],
    dimensions: { width: 11, height: 10 },
    family: 'arena'
  });

  assert.equal(graph.edges.length, 4);
  assert.equal(graph.edges.filter(edge => edge.loop).length, 1);
});

test('feature planning is byte-stable on non-square maps and emits schema-exact routes', () => {
  const width = 15;
  const height = 9;
  const view = traversal(width, height);
  const request = {
    anchors: [
      { id: 'west-exit', featureId: 'clearing:west', x: 1, y: 4 },
      { id: 'room-north', featureId: 'structure:north', x: 7, y: 1 },
      { id: 'east-exit', featureId: 'clearing:east', x: 13, y: 4 },
      { id: 'room-south', featureId: 'structure:south', x: 7, y: 7 }
    ],
    traversalView: view,
    fields: {
      roughness: grid(width, height, (x, y) => ((x * 31 + y * 17) % 11) * 5000)
    },
    elevationLevels: grid(width, height, 0),
    requiredRegionGrid: grid(width, height, 'region:required'),
    requiredRegionIds: ['region:required'],
    recipe: getV2Recipe('dungeon'),
    attemptSeed: 14821,
    loopCount: 1,
    widthVariance: 1
  };
  const first = planFeatureRoutes(request);
  const second = planFeatureRoutes({
    ...request,
    anchors: [...request.anchors].reverse()
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.ok(first.features.length >= request.anchors.length);
  assert.equal(first.metrics.requiredRegionCoverage, 1_000_000);
  for (const feature of first.features) {
    assert.deepEqual(
      Object.keys(feature),
      ['id', 'kind', 'material', 'centerline', 'width', 'required', 'anchorFeatureIds']
    );
    assert.ok(feature.centerline.length >= 2);
  }
  assert.ok(first.routes.every(route => Number.isFinite(route.metrics.sinuosity)));
  assert.ok(first.routes.every(route => route.metrics.minimumStraightRun >= 1));
  for (const route of first.routes) {
    for (let index = 1; index < route.feature.centerline.length; index++) {
      const before = route.feature.centerline[index - 1];
      const after = route.feature.centerline[index];
      assert.ok(Math.abs(
        route.widthField[before.y][before.x] -
        route.widthField[after.y][after.x]
      ) <= 1);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      assert.equal(
        first.masks.pathMask[y][x] && first.masks.shoulderMask[y][x],
        false
      );
      assert.equal(
        first.masks.wearMask[y][x] && !first.masks.pathMask[y][x],
        false
      );
    }
  }
});

test('routes and expanded masks preserve protected cores outside declared anchors', () => {
  const width = 13;
  const height = 9;
  const coreMask = grid(width, height, false);
  for (let y = 2; y <= 6; y++) {
    for (let x = 5; x <= 7; x++) coreMask[y][x] = true;
  }
  const result = planFeatureRoutes({
    anchors: [
      { id: 'a', x: 1, y: 4 },
      { id: 'b', x: 11, y: 4 }
    ],
    traversalView: traversal(width, height),
    spawnLayout: { coreMask },
    elevationLevels: grid(width, height, 0),
    recipe: getV2Recipe('forest'),
    attemptSeed: 87,
    widthVariance: 1
  });
  for (const route of result.routes) {
    assert.ok(route.feature.centerline.every(point => !coreMask[point.y][point.x]));
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (coreMask[y][x]) {
        assert.equal(result.masks.pathMask[y][x], false);
        assert.equal(result.masks.shoulderMask[y][x], false);
      }
    }
  }
});

test('long natural routes receive a deterministic low-frequency bend', () => {
  const width = 20;
  const height = 20;
  const request = {
    anchors: [
      { id: 'east', x: 15, y: 8 },
      { id: 'west', x: 4, y: 8 }
    ],
    traversalView: traversal(width, height),
    elevationLevels: grid(width, height, 0),
    recipe: getV2Recipe('swamp'),
    attemptSeed: 106
  };
  const first = planFeatureRoutes(request);
  const second = planFeatureRoutes(request);
  const route = first.routes[0];

  assert.deepEqual(first, second);
  assert.ok(route.metrics.turnDensity >= 50_000);
  assert.ok(route.metrics.turnDensity <= 700_000);
  assert.ok(route.metrics.detourRatio <= request.recipe.tactical.maximumDetour);
  assert.ok(route.feature.centerline.some(point => point.y !== 8));
});

test('compact natural routes do not force an impossible ornamental bend', () => {
  const result = planFeatureRoutes({
    anchors: [
      { id: 'left', x: 2, y: 4 },
      { id: 'right', x: 7, y: 4 }
    ],
    traversalView: traversal(10, 10),
    elevationLevels: grid(10, 10, 0),
    recipe: getV2Recipe('forest'),
    attemptSeed: 17
  });
  assert.deepEqual(
    result.routes[0].feature.centerline,
    Array.from({ length: 6 }, (_, index) => ({ x: 2 + index, y: 4 }))
  );
});

test('water barriers are crossed only at declared candidates within crossing limits', () => {
  const width = 11;
  const height = 7;
  const waterMask = grid(width, height, false);
  for (let y = 0; y < height; y++) waterMask[y][5] = true;
  const crossingCandidates = [{
    id: 'crossing:ford',
    cells: [{ x: 5, y: 2 }]
  }];
  const result = planFeatureRoutes({
    anchors: [
      { id: 'west', x: 1, y: 4 },
      { id: 'east', x: 9, y: 4 }
    ],
    traversalView: traversal(width, height),
    hydrology: {
      waterMask,
      bankMask: grid(width, height, false),
      crossingCandidates,
      routeAnchorEvidence: [{
        fromAnchorId: 'west',
        toAnchorId: 'east',
        required: true,
        crossingCandidateIds: ['crossing:ford']
      }]
    },
    elevationLevels: grid(width, height, 0),
    recipe: getV2Recipe('bridge'),
    attemptSeed: 998,
    maximumWaterCrossingLength: 1
  });
  const route = result.routes[0];
  assert.ok(route.feature.centerline.some(point => point.x === 5 && point.y === 2));
  assert.equal(route.metrics.crossingCount, 1);
  assert.equal(route.metrics.maximumCrossingLength, 1);
  assert.ok(route.feature.centerline.every(point =>
    !waterMask[point.y][point.x] || (point.x === 5 && point.y === 2)
  ));
  for (let y = 0; y < height; y++) {
    if (y !== 2) assert.equal(result.masks.pathMask[y][5], false);
  }
});

test('hydrology point-shaped crossing candidates are valid evidence waypoints', () => {
  const width = 11;
  const height = 7;
  const waterMask = grid(width, height, false);
  for (let y = 0; y < height; y++) waterMask[y][5] = true;

  const result = planFeatureRoutes({
    anchors: [
      { id: 'west', x: 1, y: 4 },
      { id: 'east', x: 9, y: 4 }
    ],
    traversalView: traversal(width, height),
    hydrology: {
      waterMask,
      bankMask: grid(width, height, false),
      crossingCandidates: [{ id: 'crossing:point', x: 5, y: 2 }],
      routeAnchorEvidence: [{
        fromAnchorId: 'west',
        toAnchorId: 'east',
        required: true,
        crossingCandidateIds: ['crossing:point']
      }]
    },
    elevationLevels: grid(width, height, 0),
    recipe: getV2Recipe('bridge'),
    attemptSeed: 998,
    maximumWaterCrossingLength: 1
  });

  assert.ok(result.routes[0].feature.centerline.some(
    point => point.x === 5 && point.y === 2
  ));
});

test('slope routes emit reciprocal connection reconciliation requests', () => {
  const width = 9;
  const height = 5;
  const levels = grid(width, height, (x) => x >= 4 ? 1 : 0);
  const candidate = {
    id: 'connection:3,2--4,2',
    reciprocalId: 'connection:4,2--3,2',
    from: { x: 3, y: 2 },
    to: { x: 4, y: 2 }
  };
  const reciprocal = {
    id: candidate.reciprocalId,
    reciprocalId: candidate.id,
    from: candidate.to,
    to: candidate.from
  };
  const result = planFeatureRoutes({
    anchors: [
      { id: 'low', x: 1, y: 2 },
      { id: 'high', x: 7, y: 2 }
    ],
    traversalView: traversal(width, height),
    elevationLevels: levels,
    connectionCandidates: [candidate, reciprocal],
    recipe: getV2Recipe('mountain'),
    attemptSeed: 42
  });
  const requests = result.reconciliationRequests.flatMap(
    request => request.connectionRequests
  );
  assert.ok(requests.length >= 1);
  assert.ok(requests.every(request => request.bidirectional));
  assert.ok(requests.some(request => request.candidateIds.includes(candidate.id)));
  assert.ok(requests.some(request => request.candidateIds.includes(reciprocal.id)));
  assert.equal(result.validation.valid, true);

  const repair = createRouteReconciliationRepair({
    id: 'route-reconcile:test',
    elevation: [[0]],
    elevationConnections: [[null]],
    transitions: [],
    features: {}
  });
  assert.ok(Object.isFrozen(repair));
  assert.deepEqual(repair.affectedLayers, ['elevation', 'elevationConnections']);
});

test('water without a declared crossing fails explicitly without synthesizing a route', () => {
  const width = 9;
  const height = 5;
  const waterMask = grid(width, height, false);
  for (let y = 0; y < height; y++) waterMask[y][4] = true;
  assert.throws(
    () => findLeastCostRoute({
      start: { x: 1, y: 2 },
      goal: { x: 7, y: 2 },
      traversalView: traversal(width, height),
      hydrology: {
        waterMask,
        crossingCandidates: []
      }
    }),
    error => error?.code === 'ROUTE_NOT_FOUND'
  );
});
