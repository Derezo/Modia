import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  generateCorpusReport,
  summary
} from '../../../scripts/worldgen-corpus-report.js';

describe('worldgen corpus report', () => {
  it('aggregates deterministic diagnostics with stable reproduction metadata', () => {
    const first = generateCorpusReport(1, 3);
    const second = generateCorpusReport(1, 3);

    assert.equal(first.failures.length, 0);
    assert.equal(first.range.count, 3);
    assert.deepEqual(first, second);
    assert.equal(first.aggregate.activityProfiles.human.total > 0, true);
    assert.equal(first.aggregate.activityProfiles.human.density > 0, true);
    assert.equal(first.aggregate.activityDensity.observed > 0, true);
    assert.equal(first.aggregate.activityDensity.activityNodeCount > 0, true);
    assert.equal(first.aggregate.rewardDeadEndShare.aggregate >= 0.1, true);
    assert.equal(first.aggregate.rewardDeadEndShare.aggregate <= 0.2, true);
    assert.equal(first.aggregate.rewardDeadEndShare.p50 >= 0.1, true);
    assert.equal(first.aggregate.rewardDeadEndShare.p50 <= 0.2, true);
    assert.match(first.diagnosticOutliers.singleChoiceCorridor.payload.nodeKeys[0], /:/);
    assert.match(first.diagnosticOutliers.hopStretch.payload.fromNodeKey, /:/);
    assert.match(first.diagnosticOutliers.routeSharedSegmentRatio.payload.routePairKey, /:/);
    assert.equal(first.diagnosticOutliers.hopStretch.outputHash.length, 64);
    assert.equal(first.diagnosticOutliers.hopStretch.routeManifestHash.length, 64);
    for (const outlier of Object.values(first.diagnosticOutliers).filter(Boolean)) {
      assert.equal(Number.isInteger(outlier.seed), true);
      assert.equal(outlier.outputHash.length, 64);
      assert.equal(outlier.routeManifestHash.length, 64);
      assert.equal(typeof outlier.payload, 'object');
    }
  });

  it('prints a report when invoked through its package-script path', () => {
    const scriptPath = fileURLToPath(
      new URL('../../../scripts/worldgen-corpus-report.js', import.meta.url)
    );
    const output = execFileSync(
      process.execPath,
      [scriptPath, '--start=1', '--end=1'],
      { encoding: 'utf8' }
    );
    const report = JSON.parse(output);
    assert.deepEqual(report.range, { startSeed: 1, endSeed: 1, count: 1 });
    assert.equal(report.failures.length, 0);
  });

  it('summarizes extended-corpus metric arrays without spreading them', () => {
    const values = Array.from(
      { length: 200_000 },
      (_, index) => index - 100_000
    );

    assert.deepEqual(summary(values), {
      min: -100_000,
      p50: -1,
      p95: 89_999,
      max: 99_999
    });
  });
});
