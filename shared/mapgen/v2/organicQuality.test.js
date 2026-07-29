import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORGANIC_QUALITY_THRESHOLDS,
  evaluateOrganicQuality,
  measureOrganicQuality,
  resolveOrganicQualityThresholds,
  validateHydrologyIntegrity
} from './OrganicQuality.js';
import { generateBattleMapV2 } from './BattleMapGenerator.js';
import { getV2Recipe } from './RecipeRegistry.js';

function terrain(width, height, materialAt) {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => ({
      material: materialAt(x, y)
    }))
  );
}

function decorationsAcrossMacroGrid(width, height) {
  const values = [];
  for (let macroY = 0; macroY < 4; macroY++) {
    for (let macroX = 0; macroX < 4; macroX++) {
      const baseX = Math.floor(macroX * width / 4);
      const baseY = Math.floor(macroY * height / 4);
      values.push(
        { x: baseX, y: baseY },
        { x: Math.min(width - 1, baseX + 1), y: baseY },
        { x: baseX, y: Math.min(height - 1, baseY + 1) }
      );
    }
  }
  return values.map((point, index) => ({
    id: `decoration:${index}`,
    ...point
  }));
}

function representativeNaturalMap() {
  const width = 16;
  const height = 16;
  const route = [];
  for (let band = 0; band < 4; band++) {
    const y = band * 2;
    const xs = band % 2 === 0
      ? Array.from({ length: width }, (_, x) => x)
      : Array.from({ length: width }, (_, x) => width - 1 - x);
    for (const x of xs) route.push({ x, y });
    if (band < 3) route.push({ x: xs.at(-1), y: y + 1 });
  }
  return {
    mapWidth: width,
    mapHeight: height,
    terrain: terrain(width, height, (x, y) =>
      (x + Math.floor(y / 2)) % 3 === 0
        ? 'stone'
        : (x + y) % 2 === 0 ? 'grass' : 'dirt'
    ),
    decorations: decorationsAcrossMacroGrid(width, height),
    features: {
      routes: [{ id: 'route:1', centerline: route }],
      waterBodies: [{
        id: 'water:1',
        kind: 'stream',
        material: 'water',
        cells: [
          { x: 15, y: 5 },
          { x: 14, y: 5 },
          { x: 13, y: 5 }
        ],
        sourceCells: [{ x: 13, y: 5 }],
        outletCell: { x: 15, y: 5 }
      }]
    }
  };
}

const NATURAL_STREAM_RECIPE = Object.freeze({
  family: 'natural',
  hydrology: Object.freeze({ kind: 'stream', material: 'water' })
});

test('exports immutable production thresholds', () => {
  assert.deepEqual(ORGANIC_QUALITY_THRESHOLDS, {
    maximumMaterialDominance: 0.80,
    maximumUniformRectangleRatio: 0.50,
    minimumRouteTurnDensity: 0.05,
    minimumDecorationDensity: 0.15,
    minimumDecorationMacroCoverage: 10
  });
  assert.ok(Object.isFrozen(ORGANIC_QUALITY_THRESHOLDS));
});

test('resolves explicit plains and compact-map guardrails', () => {
  const map = {
    mapWidth: 10,
    mapHeight: 10,
    terrain: terrain(10, 10, () => 'grass'),
    decorations: [],
    features: { routes: [], waterBodies: [] }
  };
  const thresholds = resolveOrganicQualityThresholds(map, {
    nodeType: 'plains',
    family: 'natural',
    waterKind: 'none'
  });
  assert.deepEqual(thresholds, {
    maximumMaterialDominance: 0.92,
    maximumUniformRectangleRatio: 0.50,
    minimumRouteTurnDensity: 0,
    minimumDecorationDensity: 0.15,
    minimumDecorationMacroCoverage: 4
  });
  assert.ok(Object.isFrozen(thresholds));
});

test('representative natural fixture passes all organic and hydrology checks', () => {
  const map = representativeNaturalMap();
  for (const cell of map.features.waterBodies[0].cells) {
    map.terrain[cell.y][cell.x].material = 'water';
  }
  const result = evaluateOrganicQuality(map, NATURAL_STREAM_RECIPE);
  assert.equal(result.pass, true);
  assert.ok(Object.isFrozen(result));
  assert.ok(result.checks.every(record => record.pass));
  assert.deepEqual(
    result.checks.map(record => Object.keys(record)),
    Array.from({ length: 6 }, () =>
      ['id', 'pass', 'value', 'target', 'message']
    )
  );
  assert.deepEqual(
    result.details.map(detail => Object.keys(detail)),
    Array.from({ length: 6 }, () =>
      ['id', 'passed', 'actual', 'threshold']
    )
  );
});

test('swamp identity gates reject near-dry, obstacle-free output', () => {
  const map = representativeNaturalMap();
  const body = map.features.waterBodies[0];
  body.kind = 'wetland';
  body.outletCell = null;
  map.obstacles = [];
  for (const cell of body.cells) {
    map.terrain[cell.y][cell.x].material = 'water';
  }

  const result = evaluateOrganicQuality(map, getV2Recipe('swamp'));
  const checks = new Map(result.checks.map(record => [record.id, record]));

  assert.equal(result.metrics.hydrologyCoverage, 3 / (16 * 16));
  assert.equal(result.metrics.blockingObstacleCount, 0);
  assert.equal(checks.get('organic.recipe-hydrology-coverage').pass, false);
  assert.equal(checks.get('organic.recipe-blocking-ecology').pass, false);
  assert.equal(result.pass, false);
});

test('swamp permits a necessary direct route while retaining identity gates', () => {
  const map = representativeNaturalMap();
  const recipe = getV2Recipe('swamp');
  const thresholds = resolveOrganicQualityThresholds(map, recipe);

  assert.equal(thresholds.minimumRouteTurnDensity, 0);
  assert.equal(thresholds.minimumHydrologyCoverage, 25_000);
  assert.equal(thresholds.minimumBlockingObstacleCount, 2);
});

test('swamp seed 63 produces a valid wet and blocked standard map', async () => {
  const map = await generateBattleMapV2({
    terrainSeed: 63,
    nodeType: 'swamp',
    mapWidth: 32,
    mapHeight: 32,
    mode: 'pve'
  });
  const waterTiles = new Set(
    map.features.waterBodies.flatMap(body =>
      body.cells.map(cell => `${cell.x},${cell.y}`)
    )
  );
  const metrics = measureOrganicQuality(map);
  const quality = evaluateOrganicQuality(map, getV2Recipe('swamp'));

  assert.equal(waterTiles.size, 31);
  assert.equal(metrics.hydrologyCoverage, 31 / (32 * 32));
  assert.equal(metrics.blockingObstacleCount, 16);
  assert.equal(metrics.routeTurnCount, 0);
  assert.equal(metrics.routeTurnOpportunityCount, 44);
  assert.equal(quality.pass, true);
});

test('synthetic uniform and under-decorated natural fixture is rejected', () => {
  const width = 10;
  const height = 10;
  const map = {
    mapWidth: width,
    mapHeight: height,
    terrain: terrain(width, height, () => 'grass'),
    decorations: [{ x: 1, y: 1 }],
    features: {
      routes: [{
        centerline: Array.from({ length: width }, (_, x) => ({ x, y: 5 }))
      }],
      waterBodies: []
    }
  };
  const result = evaluateOrganicQuality(map, {
    family: 'natural',
    hydrology: { kind: 'none', material: 'water' }
  });
  assert.equal(result.pass, false);
  assert.equal(result.metrics.materialDominance, 1);
  assert.equal(result.metrics.largestUniformRectangleRatio, 1);
  assert.equal(result.metrics.routeTurnDensity, 0);
  assert.equal(result.metrics.decorationDensity, 0.01);
  assert.equal(result.metrics.decorationMacroCoverage, 1);
  assert.deepEqual(
    result.checks.slice(0, 5).map(record => record.pass),
    [false, false, false, false, false]
  );
});

test('histogram finds the exact largest uniform rectangle', () => {
  const materials = [
    ['a', 'a', 'b', 'b', 'b'],
    ['a', 'a', 'b', 'b', 'b'],
    ['c', 'c', 'b', 'b', 'b'],
    ['c', 'c', 'd', 'd', 'd']
  ];
  const metrics = measureOrganicQuality({
    mapWidth: 5,
    mapHeight: 4,
    terrain: terrain(5, 4, (x, y) => materials[y][x]),
    decorations: [],
    features: { routes: [], waterBodies: [] }
  }, { family: 'natural', waterKind: 'none' });
  assert.equal(metrics.largestUniformRectangleArea, 9);
  assert.equal(metrics.largestUniformRectangleRatio, 9 / 20);
});

test('non-natural geometry records are explicit skipped passes', () => {
  const map = {
    mapWidth: 4,
    mapHeight: 4,
    terrain: terrain(4, 4, () => 'stone'),
    decorations: [],
    features: { routes: [], waterBodies: [] }
  };
  const result = evaluateOrganicQuality(map, {
    family: 'constructed',
    waterKind: 'none'
  });
  assert.equal(result.pass, true);
  assert.ok(result.checks.slice(0, 5).every(record =>
    record.pass &&
    record.value === 'skipped' &&
    record.target === 'natural-family-only'
  ));
});

test('open hydrology requires an in-body edge outlet and matching final terrain', () => {
  const map = representativeNaturalMap();
  const body = map.features.waterBodies[0];
  for (const cell of body.cells) map.terrain[cell.y][cell.x].material = 'water';
  body.outletCell = { x: 14, y: 5 };
  map.terrain[5][13].material = 'grass';
  const integrity = validateHydrologyIntegrity(map, NATURAL_STREAM_RECIPE);
  assert.equal(integrity.valid, false);
  assert.deepEqual(integrity.issues, [
    'outlet-not-on-edge',
    'terrain-material-mismatch'
  ]);
});

test('hydrology permits only bounded material-matching route overlays', () => {
  const map = representativeNaturalMap();
  const body = map.features.waterBodies[0];
  for (const cell of body.cells) map.terrain[cell.y][cell.x].material = 'water';
  map.features.routes = [{
    id: 'route:crossing',
    material: 'dirt',
    width: 2,
    centerline: [{ x: 13, y: 4 }, { x: 13, y: 5 }, { x: 13, y: 6 }]
  }];
  map.terrain[5][13].material = 'dirt';
  let integrity = validateHydrologyIntegrity(map, NATURAL_STREAM_RECIPE);
  assert.equal(integrity.valid, true);
  assert.equal(integrity.overlaidBodyCellCount, 1);

  map.terrain[5][14].material = 'stone';
  integrity = validateHydrologyIntegrity(map, NATURAL_STREAM_RECIPE);
  assert.equal(integrity.valid, false);
  assert.equal(integrity.overlaidBodyCellCount, 1);
  assert.deepEqual(integrity.issues, ['terrain-material-mismatch']);
});

test('pool hydrology permits a null outlet but retains body membership rules', () => {
  const map = {
    mapWidth: 5,
    mapHeight: 5,
    terrain: terrain(5, 5, (x, y) =>
      y === 2 && x >= 1 && x <= 3 ? 'water' : 'stone'
    ),
    features: {
      routes: [],
      waterBodies: [{
        id: 'pool:1',
        kind: 'pools',
        material: 'water',
        cells: [{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }],
        sourceCells: [{ x: 2, y: 2 }],
        outletCell: null
      }]
    },
    decorations: []
  };
  const integrity = validateHydrologyIntegrity(map, {
    family: 'subterranean',
    hydrology: { kind: 'pools', material: 'water' }
  });
  assert.deepEqual(integrity.issues, []);
  assert.equal(integrity.valid, true);
});

test('hydrology rejects duplicates, disconnected cells, invalid membership, and none bodies', () => {
  const map = {
    mapWidth: 4,
    mapHeight: 4,
    terrain: terrain(4, 4, () => 'water'),
    features: {
      waterBodies: [{
        kind: 'none',
        material: 'water',
        cells: [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 3, y: 3 },
          { x: 7, y: 7 }
        ],
        sourceCells: [{ x: 1, y: 1 }],
        outletCell: { x: 2, y: 2 }
      }]
    }
  };
  const integrity = validateHydrologyIntegrity(map, {
    family: 'constructed',
    waterKind: 'none'
  });
  assert.equal(integrity.valid, false);
  assert.deepEqual(integrity.issues, [
    'bodies-unexpected-for-none',
    'body-cell-duplicate',
    'body-cell-out-of-bounds',
    'body-not-four-connected',
    'outlet-not-in-body',
    'source-not-in-body'
  ]);
});

test('measurements and issue ordering are invariant to feature scan order', () => {
  const map = representativeNaturalMap();
  for (const cell of map.features.waterBodies[0].cells) {
    map.terrain[cell.y][cell.x].material = 'water';
  }
  const reverse = {
    ...map,
    decorations: [...map.decorations].reverse(),
    features: {
      routes: [...map.features.routes].reverse().map(route => ({
        ...route,
        centerline: [...route.centerline].reverse()
      })),
      waterBodies: [...map.features.waterBodies].reverse().map(body => ({
        ...body,
        cells: [...body.cells].reverse(),
        sourceCells: [...body.sourceCells].reverse()
      }))
    }
  };
  assert.deepEqual(
    evaluateOrganicQuality(reverse, NATURAL_STREAM_RECIPE),
    evaluateOrganicQuality(map, NATURAL_STREAM_RECIPE)
  );
});
