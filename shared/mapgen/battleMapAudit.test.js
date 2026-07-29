import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildAuditMatrix,
  inspectBattleMap,
  parseAuditArgs,
  runAudit
} from '../../scripts/audit-battle-maps.js';

function fixtureMap(width = 2, height = 2) {
  return {
    terrain: Array.from({ length: height }, () => Array(width).fill('grass')),
    obstacles: Array.from({ length: height }, () => Array(width).fill(null)),
    elevation: Array.from({ length: height }, () => Array(width).fill(0)),
    variants: Array.from({ length: height }, () => Array(width).fill(0)),
    metadata: {
      algorithms: [{ name: 'fixture-stage', required: true, success: true }],
      validationResult: {
        valid: true,
        finalAnalysis: { walkableRatio: 1 }
      }
    }
  };
}

function withoutExcludedSidecars(result) {
  return {
    ...result,
    environment: undefined,
    records: result.records.map(({ timing, ...record }) => record),
    aggregate: {
      ...result.aggregate,
      timingMs: undefined
    }
  };
}

describe('battle-map audit harness', () => {
  it('parses version, type, seed range, size, output, and shard arguments', () => {
    const options = parseAuditArgs([
      '--versions=1,2',
      '--node-types=forest,cave',
      '--seed-range=3:5',
      '--dimensions=32x32,16x24',
      '--output-dir=tmp/audit',
      '--shard-index=1',
      '--shard-count=3',
      '--failure-limit=7',
      '--emit-render-fixtures'
    ]);

    assert.deepEqual(options.versions, [1, 2]);
    assert.deepEqual(options.nodeTypes, ['forest', 'cave']);
    assert.deepEqual(options.seeds, [3, 4, 5]);
    assert.deepEqual(options.dimensions, [
      { width: 32, height: 32 },
      { width: 16, height: 24 }
    ]);
    assert.equal(options.shardIndex, 1);
    assert.equal(options.shardCount, 3);
    assert.equal(options.failureLimit, 7);
    assert.equal(options.emitRenderFixtures, true);
    assert.match(options.outputDirectory, /tmp\/audit$/);
  });

  it('builds deterministic modulo shards over the full Cartesian matrix', () => {
    const options = parseAuditArgs([
      '--versions=1,2',
      '--node-types=forest,cave',
      '--seeds=0,1',
      '--dimensions=2x2',
      '--shard-index=1',
      '--shard-count=3'
    ]);
    const matrix = buildAuditMatrix(options);

    assert.equal(matrix.full.length, 8);
    assert.deepEqual(matrix.selected, matrix.full.filter((_, index) => index % 3 === 1));
  });

  it('parses separate seed bounds without inheriting the default range', () => {
    const options = parseAuditArgs([
      '--seed-start=100',
      '--seed-end=102'
    ]);
    assert.deepEqual(options.seeds, [100, 101, 102]);
    assert.throws(
      () => parseAuditArgs(['--seeds=1,2', '--seed-range=3:4']),
      /only one seed list or range/
    );
  });

  it('produces identical deterministic records apart from timing and environment', async () => {
    const options = parseAuditArgs([
      '--versions=1',
      '--node-types=forest',
      '--seeds=0,1',
      '--dimensions=2x2'
    ]);
    const dispatch = input => fixtureMap(input.mapWidth, input.mapHeight);
    let firstClock = 0;
    let secondClock = 1000;
    const first = await runAudit(options, {
      dispatch,
      supportedVersions: [1],
      now: () => firstClock += 2,
      writeFiles: false
    });
    const second = await runAudit(options, {
      dispatch,
      supportedVersions: [1],
      now: () => secondClock += 7,
      writeFiles: false
    });

    assert.deepEqual(withoutExcludedSidecars(first), withoutExcludedSidecars(second));
    assert.equal(first.records[0].timing.generationMs, 2);
    assert.equal(second.records[0].timing.generationMs, 7);
  });

  it('reports ragged grids, non-finite cells, unknown assets, and stage failures', () => {
    const map = fixtureMap();
    map.terrain[1].pop();
    map.elevation[0][0] = Number.NaN;
    map.obstacles[0][0] = {
      type: 'trees',
      variant: 'missing-tree',
      passable: false
    };
    map.metadata.algorithms[0].success = false;
    map.metadata.finalMutationDetected = true;
    map.metadata.streamIsolationViolations = [{ stream: 'variants' }];

    const inspected = inspectBattleMap(map, {
      terrainGenerationVersion: 1,
      terrainSeed: 0,
      nodeType: 'forest',
      mapWidth: 2,
      mapHeight: 2
    });
    const failedCodes = inspected.hardChecks
      .filter(check => !check.passed)
      .map(check => check.code);

    assert.ok(failedCodes.includes('terrain.shape-and-values'));
    assert.ok(failedCodes.includes('obstacles.shape-and-values'));
    assert.ok(failedCodes.includes('elevation.shape-and-values'));
    assert.ok(failedCodes.includes('required-stages'));
    assert.ok(failedCodes.includes('no-final-mutations'));
    assert.ok(failedCodes.includes('stream-isolation'));
  });

  it('writes metric artifacts and optional browser-free render fixtures', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'modia-battle-map-audit-'));
    try {
      const options = {
        ...parseAuditArgs([
          '--versions=1',
          '--node-types=forest',
          '--seeds=9',
          '--dimensions=2x2',
          '--emit-render-fixtures'
        ]),
        outputDirectory
      };
      const result = await runAudit(options, {
        dispatch: input => fixtureMap(input.mapWidth, input.mapHeight),
        supportedVersions: [1]
      });

      const report = JSON.parse(await readFile(join(outputDirectory, 'report.json'), 'utf8'));
      const manifest = JSON.parse(
        await readFile(join(outputDirectory, 'render-manifest.json'), 'utf8')
      );
      const jsonl = await readFile(join(outputDirectory, 'maps.jsonl'), 'utf8');
      assert.equal(report.aggregate.selectedMapCount, 1);
      assert.equal(manifest.fixtures.length, 1);
      assert.match(jsonl, new RegExp(result.records[0].deterministicRecordHash));
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a requested generation version outside the dispatcher capability', async () => {
    const options = parseAuditArgs([
      '--versions=2',
      '--node-types=forest',
      '--seeds=0',
      '--dimensions=2x2'
    ]);
    await assert.rejects(
      runAudit(options, {
        dispatch: () => fixtureMap(),
        supportedVersions: [1],
        writeFiles: false
      }),
      /unsupported terrain generation versions: 2/
    );
  });
});
