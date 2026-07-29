import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  analyzeDiversity,
  aggregateRecords,
  createMacroSignature,
  mergeShardReportData,
  macroSimilarity,
  parseAuditArgs,
  runAudit
} from './audit-battle-maps.js';
import {
  dispatchBattleMapGeneration,
  SUPPORTED_TERRAIN_GENERATION_VERSIONS
} from '../shared/mapGeneration.js';

describe('V2 battle-map audit tooling', () => {
  it('parses the closed corpus CLI and refuses unbounded or unsupported selectors', () => {
    const options = parseAuditArgs([
      '--versions=2',
      '--node-types=arena,guild',
      '--seed-count=3',
      '--sizes=10x10,16x24',
      '--modes=pve,pvp',
      '--max-corpus-maps=100'
    ]);
    assert.deepEqual(options.seeds, [0, 1, 2]);
    assert.deepEqual(options.dimensions, [
      { width: 10, height: 10 },
      { width: 16, height: 24 }
    ]);
    assert.deepEqual(options.modes, ['pve', 'pvp']);
    assert.throws(
      () => parseAuditArgs(['--modes=story']),
      /unsupported modes: story/
    );
    assert.throws(
      () => parseAuditArgs(['--node-types=unknown']),
      /unsupported node types: unknown/
    );
    assert.throws(
      () => parseAuditArgs([
        '--versions=2',
        '--node-types=arena,guild',
        '--seed-count=3',
        '--sizes=10x10',
        '--modes=pve,pvp',
        '--max-corpus-maps=10'
      ]),
      /corpus has 12 maps/
    );
    assert.throws(
      () => parseAuditArgs([
        '--versions=2',
        '--node-types=forest',
        '--modes=pvp'
      ]),
      /unsupported V2 node\/mode pairs: forest:pvp/
    );
    assert.throws(
      () => parseAuditArgs(['--seed-count=20001']),
      /seed-count may not exceed 20000/
    );
    assert.throws(
      () => parseAuditArgs(['--sizes=65x32']),
      /map dimensions may not exceed 64x64/
    );
    const mergeOptions = parseAuditArgs([
      '--merge-input-dir=artifacts/shards',
      '--output-dir=artifacts/merged',
      '--defer-corpus-gates'
    ]);
    assert.match(mergeOptions.mergeInputDirectory, /artifacts\/shards$/);
    assert.equal(mergeOptions.deferCorpusGates, true);
  });

  it('uses identity-free macro signatures and reports same/cross-node duplication', async () => {
    const map = await dispatchBattleMapGeneration({
      terrainGenerationVersion: 2,
      terrainSeed: 2,
      nodeType: 'forest',
      mapWidth: 10,
      mapHeight: 10,
      options: { mode: 'pve' }
    });
    const variant = structuredClone(map);
    variant.terrainSeed = 999;
    variant.diagnostics.attempt = 7;
    variant.variants = [];
    variant.decorations = [];
    assert.deepEqual(createMacroSignature(map), createMacroSignature(variant));

    variant.terrain[0][0].material = variant.terrain[0][0].material === 'water'
      ? 'grass'
      : 'water';
    const changed = createMacroSignature(variant);
    assert.notEqual(changed.hash, createMacroSignature(map).hash);
    assert.ok(macroSimilarity(createMacroSignature(map), changed) < 1);

    const signature = createMacroSignature(map);
    const nearSignature = {
      ...signature,
      tokens: [...signature.tokens],
      hash: 'sha256:near-signature'
    };
    nearSignature.tokens[0] = `${nearSignature.tokens[0]}:changed`;
    const record = (id, nodeType, macroSignature = signature) => ({
      id,
      status: 'generated',
      input: {
        terrainGenerationVersion: 2,
        nodeType,
        mapWidth: 10,
        mapHeight: 10,
        mode: 'pve'
      },
      macroSignature
    });
    const report = analyzeDiversity([
      record('forest-a', 'forest'),
      record('forest-b', 'forest'),
      record('forest-near', 'forest', nearSignature),
      record('cave-a', 'cave'),
      record('plains-near', 'plains', {
        ...nearSignature,
        hash: 'sha256:plains-near-signature'
      })
    ]);
    assert.equal(report.profileFailureCount, 1);
    assert.equal(report.crossNodeExactCollisionCount, 1);
    assert.ok(report.crossNodeNearDuplicateCount >= 1);
  });

  it('allows occasional direct swamp routes but rejects a straight-route corpus', () => {
    const record = (index, turnDensity) => ({
      id: `swamp-${index}`,
      status: 'generated',
      input: {
        terrainGenerationVersion: 2,
        nodeType: 'swamp',
        mapWidth: 32,
        mapHeight: 32,
        mode: 'pve'
      },
      metrics: {
        quality: {
          turnDensity,
          organic: { routeTurnOpportunityCount: 44 }
        }
      },
      macroSignature: {
        version: 'battle-map-macro-signature-v1',
        tokens: Array.from({ length: 64 }, (_, token) => `${index}:${token}`),
        topology: {
          regionDegrees: [index],
          routeLengths: [44],
          connectionKinds: []
        },
        hash: `sha256:swamp-${index}`
      }
    });
    const reportForStraightCount = straightCount => analyzeDiversity(
      Array.from({ length: 20 }, (_, index) =>
        record(index, index < straightCount ? 0 : 0.05)
      )
    ).profiles[0].organicRouteDistribution;

    const withinLimit = reportForStraightCount(2);
    assert.equal(withinLimit.enforced, true);
    assert.equal(withinLimit.straightRouteRate, 0.10);
    assert.equal(withinLimit.passed, true);

    const overLimit = reportForStraightCount(3);
    assert.equal(overLimit.straightRouteRate, 0.15);
    assert.equal(overLimit.passed, false);
  });

  it('re-evaluates exact and near duplicates that are split across shards', () => {
    const topology = {
      regionDegrees: [],
      routeLengths: [],
      connectionKinds: []
    };
    const baseTokens = Array.from({ length: 64 }, (_, index) => `tile-${index}`);
    const exactSignature = {
      version: 'battle-map-macro-signature-v1',
      tokens: baseTokens,
      topology,
      hash: 'sha256:exact'
    };
    const nearTokens = [...baseTokens];
    nearTokens[0] = 'changed';
    const nearSignature = {
      version: 'battle-map-macro-signature-v1',
      tokens: nearTokens,
      topology,
      hash: 'sha256:near'
    };
    const record = (seed, size, signature) => {
      const id = `v2-forest-s${seed}-${size}x${size}-pve`;
      return {
        schema: 'battle-map-audit-v2',
        id,
        input: {
          terrainGenerationVersion: 2,
          terrainSeed: seed,
          nodeType: 'forest',
          mapWidth: size,
          mapHeight: size,
          mode: 'pve',
          options: { mode: 'pve' }
        },
        status: 'generated',
        checks: { hard: [], tactical: [], quality: [], guardrails: [] },
        stages: [],
        metrics: {},
        hashes: { full: `sha256:full-${id}` },
        macroSignature: signature,
        deterministicRecordHash: `sha256:record-${id}`,
        timing: { generationMs: 1 }
      };
    };
    const exactRecords = [
      record(0, 10, exactSignature),
      record(1, 10, exactSignature)
    ];
    const nearRecords = [
      record(0, 16, exactSignature),
      record(1, 16, nearSignature)
    ];
    for (const shardRecord of [...exactRecords, ...nearRecords]) {
      const shardAggregate = aggregateRecords([shardRecord], 2, {
        failureLimit: 50,
        deferCorpusGates: false
      });
      assert.equal(shardAggregate.requiredFailureCount, 0);
    }
    const deferredAggregate = aggregateRecords(exactRecords, 2, {
      failureLimit: 50,
      deferCorpusGates: true
    });
    assert.ok(deferredAggregate.corpusGateFailureCount > 0);
    assert.equal(deferredAggregate.requiredFailureCount, 0);
    const source = (name, records, size, shardIndex) => ({
      source: name,
      report: {
        schema: 'battle-map-audit-v2',
        matrix: {
          versions: [2],
          nodeTypes: ['forest'],
          seeds: [0, 1],
          dimensions: [{ width: size, height: size }],
          modes: ['pve'],
          shardIndex,
          shardCount: 2,
          corpusGatesDeferred: true,
          fullMapCount: 2,
          selectedMapCount: 1,
          guardrails: {
            maximumCorpusMaps: 20000,
            maximumMapBytes: 4194304,
            maximumGenerationMs: 10000
          }
        }
      },
      records
    });
    const merged = mergeShardReportData([
      source('exact-0', [exactRecords[0]], 10, 0),
      source('exact-1', [exactRecords[1]], 10, 1),
      source('near-0', [nearRecords[0]], 16, 0),
      source('near-1', [nearRecords[1]], 16, 1)
    ]);

    assert.equal(merged.merge.failures.length, 0);
    assert.equal(merged.merge.corpusGroups.length, 2);
    assert.equal(merged.aggregate.corpusGatesDeferred, false);
    assert.equal(merged.aggregate.diversity.profileFailureCount, 2);
    const exactProfile = merged.aggregate.diversity.profiles.find(
      profile => profile.profile === 'v2:forest:10x10:pve'
    );
    const nearProfile = merged.aggregate.diversity.profiles.find(
      profile => profile.profile === 'v2:forest:16x16:pve'
    );
    assert.equal(exactProfile.exactCollisions.length, 1);
    assert.equal(nearProfile.nearPairs.length, 1);
    assert.ok(merged.aggregate.requiredFailureCount >= 2);

    const incomplete = mergeShardReportData([
      source('exact-0', [exactRecords[0]], 10, 0)
    ]);
    assert.ok(incomplete.merge.failures.some(failure =>
      failure.error.name === 'missing-shards'
    ));
    assert.ok(incomplete.aggregate.requiredFailureCount > 0);

    const swapped = mergeShardReportData([
      source('exact-0', [exactRecords[1]], 10, 0),
      source('exact-1', [exactRecords[0]], 10, 1)
    ]);
    assert.ok(swapped.merge.failures.some(failure =>
      failure.error.name === 'shard-membership-mismatch'
    ));

    const relabeled = structuredClone(exactRecords[0]);
    relabeled.input.terrainSeed = 1;
    const mislabeled = mergeShardReportData([
      source('exact-0', [relabeled], 10, 0),
      source('exact-1', [exactRecords[1]], 10, 1)
    ]);
    const membershipFailure = mislabeled.merge.failures.find(failure =>
      failure.error.name === 'shard-membership-mismatch'
    );
    assert.deepEqual(membershipFailure.details.inputMismatches, [exactRecords[0].id]);
  });

  it('indexes every locality candidate and keeps detail limits out of counts', () => {
    const topology = {
      regionDegrees: [],
      routeLengths: [],
      connectionKinds: []
    };
    const tokens = Array.from({ length: 64 }, (_, index) => `tile-${index}`);
    const record = (id, nodeType, signatureTokens, hash) => ({
      id,
      status: 'generated',
      input: {
        terrainGenerationVersion: 2,
        nodeType,
        mapWidth: 32,
        mapHeight: 32,
        mode: 'pve'
      },
      macroSignature: {
        version: 'battle-map-macro-signature-v1',
        tokens: signatureTokens,
        topology,
        hash
      }
    });
    const localityRecords = Array.from({ length: 66 }, (_, index) => {
      const signatureTokens = [...tokens];
      signatureTokens[0] = `variant-${index}`;
      return record(
        `late-${String(index).padStart(3, '0')}`,
        'forest',
        signatureTokens,
        `sha256:late-${index}`
      );
    });
    const locality = analyzeDiversity(localityRecords, 3000);
    const localityProfile = locality.profiles[0];
    assert.ok(localityProfile.nearPairs.some(pair =>
      new Set([pair.left, pair.right]).has('late-064') &&
      new Set([pair.left, pair.right]).has('late-065')
    ));

    const denseRecords = Array.from({ length: 512 }, (_, index) => {
      const signatureTokens = [...tokens];
      signatureTokens[0] = `dense-${index}`;
      return record(
        `dense-${String(index).padStart(3, '0')}`,
        'forest',
        signatureTokens,
        `sha256:dense-${index}`
      );
    });
    const dense = analyzeDiversity(denseRecords, 1);
    assert.equal(dense.profiles[0].nearDuplicateRate, 1);
    assert.equal(dense.profiles[0].nearPairs.length, 1);

    const left = [0, 1, 2].map(index =>
      record(`forest-${index}`, 'forest', tokens, 'sha256:forest-exact')
    );
    const changed = [...tokens];
    changed[0] = 'near-change';
    const right = [0, 1, 2].map(index =>
      record(`cave-${index}`, 'cave', changed, 'sha256:cave-exact')
    );
    const limited = analyzeDiversity([...left, ...right], 2);
    assert.equal(limited.crossNodeNearDuplicateCount, 9);
    assert.equal(limited.crossNodeNearPairs.length, 2);

    const denseLeft = Array.from({ length: 1000 }, (_, index) =>
      record(
        `dense-forest-${String(index).padStart(4, '0')}`,
        'forest',
        tokens,
        'sha256:dense-forest'
      )
    );
    const denseRight = Array.from({ length: 1000 }, (_, index) =>
      record(
        `dense-cave-${String(index).padStart(4, '0')}`,
        'cave',
        changed,
        'sha256:dense-cave'
      )
    );
    const denseCrossNode = analyzeDiversity([...denseLeft, ...denseRight], 1);
    assert.equal(denseCrossNode.crossNodeNearDuplicateCount, 1_000_000);
    assert.equal(denseCrossNode.crossNodeNearPairs.length, 1);

    const distinctDense = Array.from({ length: 2000 }, (_, index) => {
      const signatureTokens = [...tokens];
      signatureTokens[0] = `cross-node-distinct-${index}`;
      return record(
        `cross-node-distinct-${String(index).padStart(4, '0')}`,
        index % 2 === 0 ? 'forest' : 'cave',
        signatureTokens,
        `sha256:cross-node-distinct-${index}`
      );
    });
    const distinctDenseCrossNode = analyzeDiversity(distinctDense, 1);
    assert.equal(distinctDenseCrossNode.crossNodeNearDuplicateCount, 1_000_000);
    assert.equal(distinctDenseCrossNode.crossNodeNearPairs.length, 1);
  });

  it('audits a public-dispatcher V2 map and emits deterministic semantic gallery artifacts', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'modia-battle-map-v2-audit-'));
    try {
      const options = {
        ...parseAuditArgs([
          '--versions=2',
          '--node-types=forest',
          '--seeds=0',
          '--sizes=10x10',
          '--modes=pve',
          '--emit-gallery'
        ]),
        outputDirectory
      };
      const result = await runAudit(options, {
        dispatch: dispatchBattleMapGeneration,
        supportedVersions: SUPPORTED_TERRAIN_GENERATION_VERSIONS
      });
      assert.equal(result.aggregate.requiredFailureCount, 0);
      assert.equal(result.records[0].status, 'generated');
      assert.ok(result.records[0].checks.hard.every(check => check.passed));
      assert.ok(result.records[0].checks.tactical.every(check => check.passed));
      assert.ok(result.records[0].checks.quality.every(check => check.passed));
      assert.equal(result.records[0].checks.hard.at(-1).code, 'v2-final-hashes');
      assert.ok(result.records[0].metrics.payloadBytes > 0);

      const manifest = JSON.parse(
        await readFile(join(outputDirectory, 'gallery-manifest.json'), 'utf8')
      );
      const html = await readFile(join(outputDirectory, 'gallery.html'), 'utf8');
      const svg = await readFile(
        join(outputDirectory, manifest.entries[0].svg),
        'utf8'
      );
      assert.equal(manifest.renderer, 'static-semantic-svg-v1');
      assert.match(html, /not runtime screenshots/);
      assert.match(svg, /deterministic semantic map/);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
