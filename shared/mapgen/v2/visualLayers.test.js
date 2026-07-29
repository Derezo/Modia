import test from 'node:test';
import assert from 'node:assert/strict';

import { validateBattleMapV2Candidate } from '../../battleMap/schema.js';
import { deriveAttemptSeed } from './Determinism.js';
import {
  generateNonblockingDecorations,
  generateVisualLayers
} from './VisualLayers.js';

const SCALE = 1_000_000;

function grid(width, height, value) {
  return Array.from(
    { length: height },
    (_, y) => Array.from(
      { length: width },
      (_, x) => typeof value === 'function' ? value(x, y) : value
    )
  );
}

function capabilities() {
  const transition = (kind, stratum, precedence, anchor = 'tile_top') => ({
    assetKey: `forest:transition:${kind}`,
    anchor,
    stratum,
    precedence
  });
  return {
    palette: 'forest',
    variants: {
      grass: { count: 3, maximumFraction: 600_000 },
      water: { count: 2, maximumFraction: 750_000 }
    },
    transitions: {
      shore: transition('shore', 10, 10),
      bank: transition('bank', 11, 10),
      route_center: transition('route-center', 20, 10),
      route_shoulder: transition('route-shoulder', 19, 10),
      route_edge: transition('route-edge', 18, 10),
      material_edge: transition('material-edge', 5, 10),
      cliff: transition('cliff', 30, 10, 'exposed_face'),
      slope: transition('slope', 40, 10, 'above_connection'),
      stairs: transition('stairs', 40, 20, 'above_connection'),
      wetness: transition('wetness', 6, 10)
    },
    decorations: {
      'ground-cover': {
        assetKey: 'forest:decoration-family:ground-cover',
        variantCount: 4,
        anchor: 'tile_top'
      },
      reeds: {
        assetKey: 'forest:decoration-family:reeds',
        variantCount: 3,
        anchor: 'tile_top'
      }
    },
    compositions: [
      { lower: 'shore', upper: 'route' },
      { lower: 'route', upper: 'slope' },
      { lower: 'cliff', upper: 'wetness' },
      { lower: 'decoration', upper: 'prop' }
    ]
  };
}

function fixture(width = 17, height = 11, terrainSeed = 88421) {
  const regionId = 'region:grove';
  const terrain = grid(width, height, (x, y) => ({
    material: x === Math.floor(width / 2) ? 'water' : 'grass',
    movementCost: 1,
    passable: true,
    regionId
  }));
  const elevation = grid(width, height, 0);
  const fields = {
    materialDetail: grid(width, height, (x, y) =>
      Math.floor(((x + y) / Math.max(1, width + height - 2)) * 2 * SCALE - SCALE)
    ),
    moisture: grid(width, height, x =>
      Math.floor((x / Math.max(1, width - 1)) * 2 * SCALE - SCALE)
    ),
    disturbance: grid(width, height, (_, y) =>
      Math.floor((y / Math.max(1, height - 1)) * SCALE - SCALE / 2)
    ),
    roughness: grid(width, height, (x, y) =>
      Math.floor((((x * 3 + y * 2) % 9) - 4) * SCALE / 5)
    ),
    height: grid(width, height, (_, y) =>
      Math.floor((y / Math.max(1, height - 1)) * 2 * SCALE - SCALE)
    )
  };
  const waterX = Math.floor(width / 2);
  const waterCells = Array.from({ length: height }, (_, y) => ({ x: waterX, y }));
  const featureMask = grid(width, height, x => x === waterX);
  const bankMask = grid(width, height, x =>
    x === waterX - 1 || x === waterX + 1
  );
  const wetnessMask = grid(width, height, x => Math.abs(x - waterX) <= 2);
  const routeY = Math.floor(height / 2);
  const centerline = Array.from({ length: width }, (_, x) => ({ x, y: routeY }));
  const centerlineMask = grid(width, height, (_, y) => y === routeY);
  const pathMask = grid(width, height, (_, y) => y === routeY);
  const shoulderMask = grid(width, height, (_, y) =>
    y === routeY - 1 || y === routeY + 1
  );
  return {
    width,
    height,
    attemptSeed: deriveAttemptSeed(terrainSeed, 2, 0),
    recipe: {
      renderPalette: 'forest',
      decorationFamilies: ['ground-cover', 'reeds'],
      ecology: { decorationDensity: 180_000 }
    },
    terrain,
    elevation,
    fields,
    regions: {
      regionIdGrid: grid(width, height, regionId),
      kindGrid: grid(width, height, 'grove'),
      regions: [{
        id: regionId,
        kind: 'grove',
        material: 'grass',
        bounds: { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
        area: width * height,
        adjacentRegionIds: [],
        parentFeatureId: null
      }]
    },
    hydrology: {
      featureMask,
      waterMask: featureMask,
      bankMask,
      wetnessMask,
      lavaMask: grid(width, height, false),
      waterBodies: [{
        id: 'water:main',
        kind: 'stream',
        material: 'water',
        bounds: { minX: waterX, minY: 0, maxX: waterX, maxY: height - 1 },
        cells: waterCells,
        sourceCells: [waterCells[0]],
        outletCell: waterCells.at(-1),
        parentRegionId: regionId
      }]
    },
    routes: {
      masks: {
        centerlineMask,
        pathMask,
        shoulderMask
      },
      features: [{
        id: 'route:main',
        kind: 'path',
        material: 'dirt',
        centerline,
        width: 1,
        required: true,
        anchorFeatureIds: []
      }]
    },
    ecology: {
      blockingMask: grid(width, height, false),
      obstacles: [],
      decorations: []
    },
    elevationConnections: []
  };
}

function isolatedFraction(records, width, height) {
  const values = grid(width, height, null);
  records.forEach(record => {
    values[record.y][record.x] = record.variantIndex;
  });
  let isolated = 0;
  for (const record of records) {
    const neighbors = [
      values[record.y - 1]?.[record.x],
      values[record.y + 1]?.[record.x],
      values[record.y]?.[record.x - 1],
      values[record.y]?.[record.x + 1]
    ].filter(value => value !== undefined && value !== null);
    if (neighbors.length > 0 &&
        neighbors.every(value => value !== record.variantIndex)) {
      isolated++;
    }
  }
  return isolated / records.length;
}

function alignedUniformPatchCount(records, width, height, patchSize) {
  const values = grid(width, height, null);
  records.forEach(record => {
    values[record.y][record.x] = record.variantIndex;
  });
  let uniform = 0;
  let total = 0;
  for (let y = 0; y + patchSize <= height; y += patchSize) {
    for (let x = 0; x + patchSize <= width; x += patchSize) {
      const variants = new Set();
      for (let dy = 0; dy < patchSize; dy++) {
        for (let dx = 0; dx < patchSize; dx++) {
          variants.add(values[y + dy][x + dx]);
        }
      }
      total++;
      if (variants.size === 1) uniform++;
    }
  }
  return { uniform, total };
}

function diagnostics() {
  return {
    resolvedRecipe: {
      recipeId: 'visual-test',
      recipeVersion: '1',
      renderPalette: 'forest',
      quantization: { scale: SCALE, rounding: 'floor' },
      parameters: []
    },
    attempt: 0,
    streamVersion: 'bmg-v2-streams-v1',
    hashVersion: 'sha256-cjson-v1',
    algorithms: [],
    hardValidation: { valid: true, checks: [] },
    tacticalValidation: { passed: true, checks: [] },
    qualityMetrics: { score: 1, metrics: [] }
  };
}

test('correlated variants are continuous, bounded, and scan-order deterministic', () => {
  const input = fixture(29, 17);
  input.terrain = grid(input.width, input.height, () => ({
    material: 'grass',
    movementCost: 1,
    passable: true,
    regionId: 'region:grove'
  }));
  input.hydrology = {
    featureMask: grid(input.width, input.height, false),
    bankMask: grid(input.width, input.height, false),
    wetnessMask: grid(input.width, input.height, false),
    lavaMask: grid(input.width, input.height, false),
    waterBodies: []
  };
  input.routes = { masks: {}, features: [] };
  const rowMajor = generateVisualLayers({
    ...input,
    capabilities: capabilities(),
    parameters: {
      decorationDensity: 180_000,
      decorationClusterSize: 4,
      variantPatchSize: 4
    }
  });
  const reverse = generateVisualLayers({
    ...input,
    capabilities: capabilities(),
    scanOrder: 'reverse',
    parameters: {
      decorationDensity: 180_000,
      decorationClusterSize: 4,
      variantPatchSize: 4
    }
  });

  assert.deepEqual(reverse, rowMajor);
  assert.equal(rowMajor.variants.length, input.width * input.height);
  assert.ok(isolatedFraction(rowMajor.variants, input.width, input.height) < 0.1);
  const counts = new Map();
  rowMajor.variants.forEach(record => {
    counts.set(record.variantIndex, (counts.get(record.variantIndex) ?? 0) + 1);
  });
  assert.ok(Math.max(...counts.values()) <=
    Math.ceil(rowMajor.variants.length * 0.6));
  const alignedPatches = alignedUniformPatchCount(
    rowMajor.variants,
    input.width,
    input.height,
    4
  );
  assert.ok(alignedPatches.uniform < alignedPatches.total);
  assert.equal(
    rowMajor.decorations.length,
    Math.floor(input.width * input.height * 0.18)
  );
  const unclustered = generateVisualLayers({
    ...input,
    capabilities: capabilities(),
    parameters: {
      decorationDensity: 180_000,
      decorationClusterSize: 1,
      variantPatchSize: 4
    }
  });
  assert.notDeepEqual(unclustered.decorations, rowMajor.decorations);
});

test('irregular variant patches remain deterministic across corpus seeds', () => {
  const outputs = [];
  for (const terrainSeed of [0, 997]) {
    const input = fixture(29, 17, terrainSeed);
    input.terrain = grid(input.width, input.height, () => ({
      material: 'grass',
      movementCost: 1,
      passable: true,
      regionId: 'region:grove'
    }));
    input.hydrology = {
      featureMask: grid(input.width, input.height, false),
      bankMask: grid(input.width, input.height, false),
      wetnessMask: grid(input.width, input.height, false),
      lavaMask: grid(input.width, input.height, false),
      waterBodies: []
    };
    input.routes = { masks: {}, features: [] };
    const parameters = {
      decorationDensity: 0,
      decorationClusterSize: 4,
      variantPatchSize: 4
    };
    const rowMajor = generateVisualLayers({
      ...input,
      capabilities: capabilities(),
      parameters
    });
    const reverse = generateVisualLayers({
      ...input,
      capabilities: capabilities(),
      scanOrder: 'reverse',
      parameters
    });
    const alignedPatches = alignedUniformPatchCount(
      rowMajor.variants,
      input.width,
      input.height,
      4
    );

    assert.deepEqual(reverse, rowMajor, `variant seed ${terrainSeed}`);
    assert.ok(alignedPatches.uniform < alignedPatches.total);
    outputs.push(rowMajor.variants);
  }
  assert.notDeepEqual(outputs[0], outputs[1]);
});

test('semantic masks use final neighbors, stable feature IDs, and declared compositions', () => {
  const input = fixture(7, 5);
  const waterX = Math.floor(input.width / 2);
  const routeY = Math.floor(input.height / 2);
  input.elevation[1][1] = 1;
  input.hydrology.wetnessMask[1][1] = true;
  input.elevationConnections.push({
    id: 'connection:ramp',
    from: { x: 4, y: routeY },
    to: { x: 5, y: routeY },
    kind: 'ramp',
    direction: 'e',
    elevationDelta: 0,
    bidirectional: true,
    featureId: 'route:main'
  });
  const result = generateVisualLayers({
    ...input,
    capabilities: capabilities(),
    parameters: { decorationDensity: 0 }
  });
  const reverse = generateVisualLayers({
    ...input,
    capabilities: capabilities(),
    scanOrder: 'reverse',
    parameters: { decorationDensity: 0 }
  });

  assert.deepEqual(reverse.transitions, result.transitions);
  const shore = result.transitions.find(record =>
    record.kind === 'shore' && record.x === waterX && record.y === 1
  );
  assert.equal(shore.directionMask, 10);
  assert.equal(shore.featureId, 'water:main');
  const routeEdge = result.transitions.find(record =>
    record.kind === 'route_edge' && record.x === waterX && record.y === routeY
  );
  assert.equal(routeEdge.directionMask, 5);
  assert.equal(routeEdge.featureId, 'route:main');
  const cliff = result.transitions.find(record =>
    record.kind === 'cliff' && record.x === 1 && record.y === 1
  );
  assert.equal(cliff.directionMask, 15);
  const slope = result.transitions.find(record =>
    record.kind === 'slope' && record.x === 4 && record.y === routeY
  );
  assert.equal(slope.directionMask, 2);
  assert.equal(slope.featureId, 'route:main');
  assert.deepEqual(
    [...result.transitions].sort((a, b) =>
      a.y - b.y || a.x - b.x || a.stratum - b.stratum ||
      a.precedence - b.precedence || a.kind.localeCompare(b.kind)
    ),
    result.transitions
  );
});

test('protected and reserved masks suppress overlays/decorations and reset variants', () => {
  const input = fixture(13, 9);
  const protectedMask = grid(input.width, input.height, false);
  const reservationMask = grid(input.width, input.height, false);
  protectedMask[2][2] = true;
  reservationMask[3][3] = true;
  const result = generateVisualLayers({
    ...input,
    protectedMask,
    reservationMask,
    capabilities: capabilities(),
    parameters: { decorationDensity: 900_000 }
  });

  for (const { x, y } of [{ x: 2, y: 2 }, { x: 3, y: 3 }]) {
    assert.equal(
      result.variants.find(record => record.x === x && record.y === y)
        .variantIndex,
      0
    );
    assert.equal(
      result.transitions.some(record => record.x === x && record.y === y),
      false
    );
    assert.equal(
      result.decorations.some(record => record.x === x && record.y === y),
      false
    );
  }
});

test('decorations are schema-incapable of collision and prop overlap is explicit', () => {
  const input = fixture(1, 1);
  input.terrain = [[{
    material: 'grass',
    movementCost: 1,
    passable: true,
    regionId: 'region:grove'
  }]];
  input.regions.regionIdGrid = [['region:grove']];
  input.regions.kindGrid = [['grove']];
  input.fields = {
    materialDetail: [[0]],
    moisture: [[SCALE]],
    disturbance: [[0]],
    roughness: [[0]],
    height: [[0]]
  };
  input.hydrology = {
    featureMask: [[false]],
    bankMask: [[false]],
    wetnessMask: [[false]],
    lavaMask: [[false]],
    waterBodies: []
  };
  input.routes = { masks: {}, features: [] };
  input.ecology = {
    blockingMask: [[true]],
    obstacles: [{
      id: 'obstacle:test',
      x: 0,
      y: 0,
      kind: 'tree',
      assetKey: 'forest:obstacle-family:tree',
      blocking: true,
      movementCost: 0,
      featureId: 'region:grove'
    }],
    decorations: []
  };
  const records = generateNonblockingDecorations({
    ...input,
    capabilities: capabilities(),
    parameters: {
      decorationDensity: SCALE,
      decorationFamilies: ['ground-cover']
    }
  });
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]), [
    'id', 'x', 'y', 'kind', 'assetKey', 'variantIndex', 'anchor', 'featureId'
  ]);
  assert.equal(Object.hasOwn(records[0], 'blocking'), false);
  assert.equal(Object.hasOwn(records[0], 'passable'), false);

  const missingComposition = capabilities();
  missingComposition.compositions = missingComposition.compositions.filter(
    item => item.lower !== 'decoration'
  );
  assert.throws(
    () => generateNonblockingDecorations({
      ...input,
      capabilities: missingComposition,
      parameters: {
        decorationDensity: SCALE,
        decorationFamilies: ['ground-cover']
      }
    }),
    /Missing visual composition capability decoration\+prop/
  );
});

test('visual output is frozen-schema valid on a non-square candidate', () => {
  const input = fixture(11, 7);
  const visual = generateVisualLayers({
    ...input,
    capabilities: capabilities()
  });
  const candidate = {
    battleMapSchemaVersion: 2,
    terrainGenerationVersion: 2,
    terrainSeed: 88421,
    mapWidth: input.width,
    mapHeight: input.height,
    nodeType: 'forest',
    biome: 'forest',
    archetype: 'grove',
    elevationFormat: 'normalized',
    terrain: input.terrain,
    elevation: input.elevation,
    elevationConnections: input.elevationConnections,
    obstacles: [],
    spawnLayout: {
      slots: [],
      protectedZones: [],
      stagingRegions: [],
      exits: [],
      minimumApproachExits: 0
    },
    variants: visual.variants,
    transitions: visual.transitions,
    decorations: visual.decorations,
    features: {
      regions: input.regions.regions,
      waterBodies: input.hydrology.waterBodies,
      routes: input.routes.features,
      clearings: [],
      structures: []
    },
    diagnostics: diagnostics()
  };
  const validation = validateBattleMapV2Candidate(candidate);
  assert.equal(validation.valid, true, validation.errors.join('\n'));
});

test('invalid dimensions and absent injected capabilities fail hard', () => {
  const input = fixture(9, 6);
  assert.throws(
    () => generateVisualLayers({
      ...input,
      capabilities: {
        ...capabilities(),
        variants: { water: { count: 2, maximumFraction: 750_000 } }
      }
    }),
    /Missing visual variant capability for material: grass/
  );
  assert.throws(
    () => generateVisualLayers({
      ...input,
      fields: {
        ...input.fields,
        moisture: grid(input.width - 1, input.height, 0)
      },
      capabilities: capabilities()
    }),
    /exact 9x6 row-major grid/
  );
  assert.throws(
    () => generateVisualLayers({
      ...input,
      capabilities: {
        ...capabilities(),
        transitions: {
          ...capabilities().transitions,
          shore: undefined
        }
      }
    }),
    /Missing visual transition capability for kind: shore/
  );
});
