import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveAttemptSeed } from './Determinism.js';
import { compileFeasibilityProfile } from './Feasibility.js';
import { generateLandscapeFieldSet } from './LandscapeFields.js';
import {
  applyStructuredRegionOverlays,
  generateTerrainRegions,
  refineMaskWithCellularAutomata
} from './Regions.js';
import { getV2Recipe } from './RecipeRegistry.js';
import { resolveSpawnLayout } from './SpawnLayoutContract.js';

function fixture(nodeType = 'forest', width = 27, height = 15) {
  const request = {
    nodeType,
    mode: 'pve',
    mapWidth: width,
    mapHeight: height,
    playerCount: 5,
    enemyCapacity: 8
  };
  const recipe = getV2Recipe(nodeType);
  const feasibility = compileFeasibilityProfile(request);
  const spawnLayout = resolveSpawnLayout(request);
  const fields = generateLandscapeFieldSet({
    width,
    height,
    attemptSeed: deriveAttemptSeed(73019, 2, 0),
    recipe,
    feasibility
  });
  return { width, height, recipe, fields, spawnLayout };
}

function componentSizes(kindGrid) {
  const height = kindGrid.length;
  const width = kindGrid[0].length;
  const visited = Array.from({ length: height }, () => Array(width).fill(false));
  const sizes = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x]) continue;
      const kind = kindGrid[y][x];
      const queue = [{ x, y }];
      visited[y][x] = true;
      let size = 0;
      for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        size++;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height ||
              visited[ny][nx] || kindGrid[ny][nx] !== kind) continue;
          visited[ny][nx] = true;
          queue.push({ x: nx, y: ny });
        }
      }
      sizes.push(size);
    }
  }
  return sizes;
}

test('natural regions are non-square, scan-order invariant, and minimum-sized', () => {
  const options = fixture('forest', 29, 17);
  const rowMajor = generateTerrainRegions(options);
  const reverse = generateTerrainRegions({ ...options, scanOrder: 'reverse' });
  assert.deepEqual(rowMajor, reverse);
  assert.equal(rowMajor.materialGrid.length, 17);
  assert.ok(rowMajor.materialGrid.every(row => row.length === 29));
  assert.ok(
    componentSizes(rowMajor.kindGrid).every(size =>
      size >= options.recipe.regions.minimumRegionArea
    )
  );
  assert.ok(rowMajor.seedRegions.length > 0);
  assert.ok(Object.isFrozen(rowMajor));
});

test('hysteresis includes exact enter/retain boundaries and excludes below-retain cells', () => {
  const width = 10;
  const height = 10;
  const recipe = {
    ...getV2Recipe('forest'),
    regions: { minimumRegionArea: 1, materialBandCount: 4 }
  };
  const fields = Object.fromEntries(
    ['height', 'moisture', 'roughness', 'detail', 'disturbance'].map(name => [
      name,
      Array.from({ length: height }, () => Array(width).fill(0))
    ])
  );
  // Grove score is 0.6 * moisture. These cells exercise enter=180,000,
  // retain=20,000, and retain-1 under the fixed integer quantization rule.
  fields.moisture[2][2] = 300_000;
  fields.moisture[2][3] = 33_334;
  fields.moisture[8][8] = 33_333;
  const spawnLayout = {
    coreMask: Array.from({ length: height }, () => Array(width).fill(false))
  };
  const rowMajor = generateTerrainRegions({
    width,
    height,
    recipe,
    fields,
    spawnLayout
  });
  const reverse = generateTerrainRegions({
    width,
    height,
    recipe,
    fields,
    spawnLayout,
    scanOrder: 'reverse'
  });
  assert.deepEqual(rowMajor, reverse);
  assert.equal(rowMajor.kindGrid[2][2], 'grove');
  assert.equal(rowMajor.kindGrid[2][3], 'grove');
  assert.equal(rowMajor.kindGrid[8][8], 'meadow');
});

test('region records partition the grid and carry symmetric stable adjacency', () => {
  const options = fixture('mountain', 32, 19);
  const output = generateTerrainRegions(options);
  const counts = new Map();
  output.regionIdGrid.flat().forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
  assert.equal(counts.size, output.regions.length);
  for (const region of output.regions) {
    assert.equal(counts.get(region.id), region.area);
    assert.deepEqual(region.adjacentRegionIds, [...region.adjacentRegionIds].sort());
    for (const adjacentId of region.adjacentRegionIds) {
      const adjacent = output.regions.find(candidate => candidate.id === adjacentId);
      assert.ok(adjacent);
      assert.ok(adjacent.adjacentRegionIds.includes(region.id));
    }
    assert.deepEqual(Object.keys(region), [
      'id',
      'kind',
      'material',
      'bounds',
      'area',
      'adjacentRegionIds',
      'parentFeatureId'
    ]);
  }
});

test('protected spawn cores retain the recipe default semantic terrain', () => {
  const options = fixture('swamp', 24, 16);
  const output = generateTerrainRegions(options);
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      if (!options.spawnLayout.coreMask[y][x]) continue;
      assert.equal(output.materialGrid[y][x], 'grass');
      assert.equal(output.kindGrid[y][x], 'wet-meadow');
    }
  }
});

test('cave CA consumes the supplied prior mask and keeps protected cells open', () => {
  const options = fixture('cave', 20, 14);
  const empty = Array.from({ length: options.height }, () =>
    Array(options.width).fill(false)
  );
  const solid = Array.from({ length: options.height }, () =>
    Array(options.width).fill(true)
  );
  const openResult = generateTerrainRegions({ ...options, priorMask: empty });
  const solidResult = generateTerrainRegions({ ...options, priorMask: solid });
  assert.notDeepEqual(openResult.kindGrid, solidResult.kindGrid);
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      if (options.spawnLayout.coreMask[y][x]) {
        assert.notEqual(solidResult.kindGrid[y][x], 'cave-solid');
      }
    }
  }

  const refined = refineMaskWithCellularAutomata({
    priorMask: solid,
    protectedMask: options.spawnLayout.coreMask
  });
  assert.ok(refined.flat().some(Boolean));
  assert.ok(options.spawnLayout.coreMask.flat().every((isProtected, index) =>
    !isProtected || !refined.flat()[index]
  ));
});

test('structured overlays are order-invariant, preserve geometry, and set parent semantics', () => {
  const options = fixture('castle', 22, 14);
  const overlays = [
    {
      id: 'structure:z',
      kind: 'wall-foundation',
      material: 'stone',
      cells: [{ x: 10, y: 2 }, { x: 11, y: 2 }, { x: 12, y: 2 }],
      parentFeatureId: 'structure:z'
    },
    {
      id: 'structure:a',
      kind: 'gate-foundation',
      material: 'dirt',
      cells: [{ x: 10, y: 3 }, { x: 11, y: 3 }, { x: 12, y: 3 }],
      parentFeatureId: 'structure:a'
    }
  ];
  const forward = generateTerrainRegions({ ...options, structuredOverlays: overlays });
  const reverse = generateTerrainRegions({
    ...options,
    structuredOverlays: [...overlays].reverse(),
    scanOrder: 'reverse'
  });
  assert.deepEqual(forward, reverse);
  for (const overlay of overlays) {
    for (const cell of overlay.cells) {
      assert.equal(forward.kindGrid[cell.y][cell.x], overlay.kind);
      assert.equal(forward.materialGrid[cell.y][cell.x], overlay.material);
      assert.equal(forward.parentFeatureIdGrid[cell.y][cell.x], overlay.parentFeatureId);
    }
  }
  assert.ok(forward.regions.some(region =>
    region.parentFeatureId === 'structure:z' && region.kind === 'wall-foundation'
  ));
});

test('structured overlays reject overlap and protected-core intersections', () => {
  const options = fixture('castle', 22, 14);
  const base = Array.from({ length: options.height }, () =>
    Array.from({ length: options.width }, () => ({
      kind: 'courtyard',
      material: 'stone',
      parentFeatureId: null,
      authored: false,
      protected: false
    }))
  );
  const coreCell = options.spawnLayout.playerSlots[0];
  assert.throws(() => applyStructuredRegionOverlays({
    classification: base,
    protectedMask: options.spawnLayout.coreMask,
    structuredOverlays: [{
      id: 'structure:bad',
      kind: 'wall',
      material: 'stone',
      cells: [{ x: coreCell.x, y: coreCell.y }],
      parentFeatureId: 'structure:bad'
    }]
  }), /protected spawn core/);
  assert.throws(() => applyStructuredRegionOverlays({
    classification: base,
    protectedMask: options.spawnLayout.coreMask,
    structuredOverlays: [
      {
        id: 'structure:a',
        kind: 'wall',
        material: 'stone',
        cells: [{ x: 10, y: 2 }],
        parentFeatureId: 'structure:a'
      },
      {
        id: 'structure:b',
        kind: 'gate',
        material: 'stone',
        cells: [{ x: 10, y: 2 }],
        parentFeatureId: 'structure:b'
      }
    ]
  }), /overlap/);
});

test('unsupported classifiers and malformed field grids fail explicitly', () => {
  const options = fixture();
  assert.throws(() => generateTerrainRegions({
    ...options,
    recipe: { ...options.recipe, nodeType: 'unknown' }
  }), /No explicit V2 region profile/);
  assert.throws(() => generateTerrainRegions({
    ...options,
    fields: { ...options.fields, moisture: options.fields.moisture.slice(1) }
  }), /fields\.moisture/);
});
