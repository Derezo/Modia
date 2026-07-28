import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MAP_SEED_MODULUS,
  TERRAIN_GENERATION_VERSION,
  deriveEncounterTerrainSeed,
  generateEncounterTerrain
} from '../../../services/battle/encounterService.js';

describe('encounter terrain seed contract', () => {
  it('derives a stable, isolated seed from node type, local seed, and version', () => {
    const first = deriveEncounterTerrainSeed(123456, 'forest', TERRAIN_GENERATION_VERSION);
    const repeated = deriveEncounterTerrainSeed('123456', 'forest', TERRAIN_GENERATION_VERSION);

    assert.equal(first, repeated);
    assert.equal(first, 101876589, 'version 1 seed derivation must remain stable');
    assert.ok(first >= -0x80000000 && first <= 0x7FFFFFFF);
    assert.notEqual(first, deriveEncounterTerrainSeed(123457, 'forest', TERRAIN_GENERATION_VERSION));
    assert.notEqual(first, deriveEncounterTerrainSeed(123456, 'cave', TERRAIN_GENERATION_VERSION));
    assert.notEqual(first, deriveEncounterTerrainSeed(123456, 'forest', TERRAIN_GENERATION_VERSION + 1));
  });

  it('does not collapse distinct full-width hashes into the legacy random seed range', () => {
    const first = deriveEncounterTerrainSeed(-9631, 'forest', TERRAIN_GENERATION_VERSION);
    const second = deriveEncounterTerrainSeed(5300, 'forest', TERRAIN_GENERATION_VERSION);

    assert.equal((first >>> 0) % MAP_SEED_MODULUS, 478210);
    assert.equal((second >>> 0) % MAP_SEED_MODULUS, 478210);
    assert.equal(first, -742489086);
    assert.equal(second, -412489086);
    assert.notEqual(first, second);
  });

  it('generates every tactical map layer deterministically from the stable contract', () => {
    const contract = {
      nodeType: 'forest',
      localSeed: 872341,
      terrainGenerationVersion: TERRAIN_GENERATION_VERSION
    };

    const first = generateEncounterTerrain(contract);
    const repeated = generateEncounterTerrain(contract);

    assert.equal(first.mapSeed, repeated.mapSeed);
    assert.equal(first.terrainGenerationVersion, TERRAIN_GENERATION_VERSION);
    assert.deepEqual(first.terrain, repeated.terrain);
    assert.deepEqual(first.elevation, repeated.elevation);
    assert.deepEqual(first.obstacles, repeated.obstacles);
    assert.deepEqual(first.variants, repeated.variants);

    const mapDigest = createHash('sha256')
      .update(JSON.stringify({
        terrain: first.terrain,
        elevation: first.elevation,
        obstacles: first.obstacles,
        variants: first.variants
      }))
      .digest('hex');
    assert.equal(
      mapDigest,
      '52e6672c0a9112b2d6b76ab29aed25deeb954d9d2d0c1b547683fbe4825b4cb1',
      'terrain generator changes must increment the persisted generation version'
    );
  });

  it('does not consume the global encounter or combat randomness stream', () => {
    const originalRandom = Math.random;
    let globalRandomCalls = 0;
    Math.random = () => {
      globalRandomCalls++;
      return 0.5;
    };

    try {
      generateEncounterTerrain({
        nodeType: 'cave',
        localSeed: 554433,
        terrainGenerationVersion: TERRAIN_GENERATION_VERSION
      });
    } finally {
      Math.random = originalRandom;
    }

    assert.equal(globalRandomCalls, 0);
  });

  it('produces a different tactical map seed for a different node seed', () => {
    const first = generateEncounterTerrain({
      nodeType: 'mountain',
      localSeed: 1001
    });
    const second = generateEncounterTerrain({
      nodeType: 'mountain',
      localSeed: 1002
    });

    assert.notEqual(first.mapSeed, second.mapSeed);
    assert.notDeepEqual(first.terrain, second.terrain);
  });

  it('keeps the legacy random call shape available', () => {
    const result = generateEncounterTerrain('forest', 16, 12);

    assert.equal(result.mapWidth, 16);
    assert.equal(result.mapHeight, 12);
    assert.equal(result.terrainGenerationVersion, undefined);
  });

  it('rejects incomplete stable contracts instead of silently using random terrain', () => {
    assert.throws(
      () => generateEncounterTerrain({ nodeType: 'forest' }),
      /localSeed must be a safe integer/
    );
  });
});
