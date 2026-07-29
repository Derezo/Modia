import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveAttemptSeed } from './Determinism.js';
import { compileFeasibilityProfile } from './Feasibility.js';
import {
  generateCoherentElevation,
  generateLandscapeFieldSet
} from './LandscapeFields.js';
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
  return {
    width,
    height,
    attemptSeed: deriveAttemptSeed(123456, 2, 0),
    recipe: getV2Recipe(nodeType),
    feasibility: compileFeasibilityProfile(request),
    spawnLayout: resolveSpawnLayout(request)
  };
}

test('landscape fields are finite, bounded, non-square, and scan-order invariant', () => {
  const options = fixture();
  const rowMajor = generateLandscapeFieldSet(options);
  const reverse = generateLandscapeFieldSet({ ...options, scanOrder: 'reverse' });
  assert.deepEqual(rowMajor, reverse);
  for (const name of ['height', 'moisture', 'roughness', 'detail', 'disturbance']) {
    assert.equal(rowMajor[name].length, options.height);
    for (const row of rowMajor[name]) {
      assert.equal(row.length, options.width);
      assert.ok(row.every(value =>
        Number.isSafeInteger(value) && value >= -1_000_000 && value <= 1_000_000
      ));
    }
  }
});

test('coherent elevation preserves flat cores and reciprocal height candidates', () => {
  const options = fixture('mountain', 32, 24);
  const fields = generateLandscapeFieldSet(options);
  const result = generateCoherentElevation({ ...options, fields });
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      assert.ok(Number.isFinite(result.elevation[y][x]));
      assert.ok(result.elevation[y][x] >= 0 && result.elevation[y][x] <= 1);
      if (options.spawnLayout.coreMask[y][x]) {
        assert.equal(result.discreteElevation[y][x], 0);
      }
      if (x + 1 < options.width) {
        assert.ok(
          Math.abs(result.discreteElevation[y][x + 1] - result.discreteElevation[y][x]) <= 1
        );
      }
      if (y + 1 < options.height) {
        assert.ok(
          Math.abs(result.discreteElevation[y + 1][x] - result.discreteElevation[y][x]) <= 1
        );
      }
    }
  }
  const byId = new Map(result.connectionCandidates.map(candidate => [candidate.id, candidate]));
  for (const candidate of result.connectionCandidates) {
    const reciprocal = byId.get(candidate.reciprocalId);
    assert.ok(reciprocal);
    assert.deepEqual(reciprocal.from, candidate.to);
    assert.deepEqual(reciprocal.to, candidate.from);
    assert.equal(reciprocal.elevationDelta, -candidate.elevationDelta);
  }
});

test('unrelated named-stream draws cannot perturb landscape sampling', () => {
  const options = fixture('cave', 18, 29);
  const first = generateLandscapeFieldSet(options);
  // Only attemptSeed and named coordinate salts are inputs; no mutable PRNG is shared.
  const second = generateLandscapeFieldSet({ ...options });
  assert.deepEqual(first, second);
});

