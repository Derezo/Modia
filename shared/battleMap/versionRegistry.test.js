import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertBattleMapHashRequirements,
  assertBattleMapVersion,
  BATTLE_MAP_VERSION_DESCRIPTORS,
  BATTLE_MAP_VERSION_REGISTRY,
  resolveBattleMapDecoder,
  resolveBattleMapHashRequirements,
  resolveBattleMapVersionDescriptor
} from './versionRegistry.js';

const HASH = `sha256:${'a'.repeat(64)}`;

describe('BattleMap version registry', () => {
  it('publishes deeply frozen, explicit V1/V2/V3 descriptors', () => {
    assert.deepEqual(
      BATTLE_MAP_VERSION_DESCRIPTORS.map(descriptor => [
        descriptor.battleMapSchemaVersion,
        descriptor.terrainGenerationVersion,
        descriptor.decoderId
      ]),
      [
        [1, 1, 'battle-map-v1'],
        [2, 2, 'battle-map-v2'],
        [3, 3, 'battle-map-v3']
      ]
    );
    assert.ok(Object.isFrozen(BATTLE_MAP_VERSION_DESCRIPTORS));
    assert.ok(Object.isFrozen(BATTLE_MAP_VERSION_REGISTRY));
    for (const descriptor of BATTLE_MAP_VERSION_DESCRIPTORS) {
      assert.ok(Object.isFrozen(descriptor));
      assert.ok(Object.isFrozen(descriptor.hashRequirements));
      assert.ok(Object.isFrozen(descriptor.hashRequirements.fields));
    }
  });

  it('resolves only exact schema/generation pairs', () => {
    assert.equal(
      resolveBattleMapVersionDescriptor({
        battleMapSchemaVersion: 3,
        terrainGenerationVersion: 3
      }),
      BATTLE_MAP_VERSION_REGISTRY['3:3']
    );
    assert.equal(
      resolveBattleMapVersionDescriptor(2, 2),
      BATTLE_MAP_VERSION_REGISTRY['2:2']
    );
    assert.throws(
      () => resolveBattleMapVersionDescriptor({
        battleMapSchemaVersion: 3,
        terrainGenerationVersion: 2
      }),
      /Unsupported battle map version pair 3\/2/
    );
    assert.throws(
      () => resolveBattleMapVersionDescriptor({
        battleMapSchemaVersion: 4,
        terrainGenerationVersion: 4
      }),
      /Unsupported battle map version pair 4\/4/
    );
  });

  it('never treats absent or malformed versions as legacy', () => {
    for (const value of [
      {},
      { battleMapSchemaVersion: 1 },
      { terrainGenerationVersion: 1 },
      { battleMapSchemaVersion: 0, terrainGenerationVersion: 1 },
      { battleMapSchemaVersion: '1', terrainGenerationVersion: 1 }
    ]) {
      assert.throws(
        () => assertBattleMapVersion(value),
        /battleMapSchemaVersion|terrainGenerationVersion/
      );
    }
  });

  it('resolves a decoder by the exact descriptor ID and fails when absent', () => {
    const decodeV1 = value => value;
    const decodeV3 = value => value;
    const decoders = new Map([
      ['battle-map-v1', decodeV1],
      ['battle-map-v3', decodeV3]
    ]);
    assert.equal(
      resolveBattleMapDecoder({
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1
      }, decoders),
      decodeV1
    );
    assert.equal(
      resolveBattleMapDecoder({
        battleMapSchemaVersion: 3,
        terrainGenerationVersion: 3
      }, decoders),
      decodeV3
    );
    assert.throws(
      () => resolveBattleMapDecoder({
        battleMapSchemaVersion: 2,
        terrainGenerationVersion: 2
      }, decoders),
      /Missing decoder for battle-map-v2/
    );
  });

  it('declares and enforces version-specific hash requirements', () => {
    assert.deepEqual(
      resolveBattleMapHashRequirements(1, 1).fields,
      []
    );
    assert.equal(
      resolveBattleMapHashRequirements(2, 2).containerPath,
      'diagnostics.hashes'
    );
    assert.equal(
      resolveBattleMapHashRequirements(3, 3).containerPath,
      'hashes'
    );

    const v1 = {
      battleMapSchemaVersion: 1,
      terrainGenerationVersion: 1
    };
    assert.equal(assertBattleMapHashRequirements(v1), v1);

    const v2 = {
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      diagnostics: {
        hashes: {
          authoritativeHash: HASH,
          visualHash: HASH,
          fullHash: HASH
        }
      }
    };
    assert.equal(assertBattleMapHashRequirements(v2), v2);

    const v3 = {
      battleMapSchemaVersion: 3,
      terrainGenerationVersion: 3,
      hashes: {
        authoritativeHash: HASH,
        visualHash: HASH,
        fullHash: HASH
      }
    };
    assert.equal(assertBattleMapHashRequirements(v3), v3);
    assert.throws(
      () => assertBattleMapHashRequirements({
        ...v3,
        hashes: { ...v3.hashes, visualHash: 'sha256:BAD' }
      }),
      /hashes\.visualHash must be a lowercase SHA-256 hash/
    );
  });
});
