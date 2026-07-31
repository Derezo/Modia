import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV,
  BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV,
  BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV,
  BATTLE_MAP_V2_GENERATION_P95_SLO_MS_ENV,
  BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT_ENV,
  BATTLE_MAP_V2_SHADOW_SAMPLE_RATE_ENV,
  assertBattleMapWirePayloadWithinBudget,
  getBattleMapOperationalDiagnostics,
  getBattleMapOperationalMetrics,
  getBattleMapV2ShadowMaxConcurrent,
  getBattleMapV2ShadowSampleRate,
  isBattleMapReferenceDeltaEnabled,
  recordBattleMapCapabilityNegotiation,
  recordBattleMapGenerationStarted,
  recordBattleMapGenerationFailed,
  recordBattleMapGenerationSucceeded,
  recordAuthoredMapCatalogCoverage,
  recordAuthoredMapCatalogSelectionFailed,
  recordBattleMapResyncRequest,
  recordBattleMapSchemaOrHashRejection,
  recordBattleMapWebsocketDelivery,
  resetBattleMapOperationalMetrics,
  scheduleBattleMapV2Shadow,
  shouldSampleBattleMapV2Shadow
} from '../../services/battle/BattleMapOperations.js';

const ENVIRONMENT_NAMES = Object.freeze([
  BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV,
  BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV,
  BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV,
  BATTLE_MAP_V2_GENERATION_P95_SLO_MS_ENV,
  BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT_ENV,
  BATTLE_MAP_V2_SHADOW_SAMPLE_RATE_ENV
]);

const request = Object.freeze({
  mode: 'pve',
  nodeType: 'forest',
  terrainSeed: 997,
  mapWidth: 32,
  mapHeight: 32
});

function shadowMap(overrides = {}) {
  return {
    battleMapSchemaVersion: 2,
    terrainGenerationVersion: 2,
    terrainSeed: request.terrainSeed,
    mapWidth: request.mapWidth,
    mapHeight: request.mapHeight,
    nodeType: request.nodeType,
    diagnostics: {
      attempt: 2,
      resolvedRecipe: {
        recipeId: 'forest',
        recipeVersion: '2'
      },
      hardValidation: { valid: true },
      tacticalValidation: { passed: true },
      qualityMetrics: { score: 0.875 },
      hashes: {
        authoritativeHash: 'sha256:authoritative-fixture',
        visualHash: 'sha256:visual-fixture',
        fullHash: 'sha256:shadow-fixture'
      }
    },
    ...overrides
  };
}

describe('Battle-map operational controls', () => {
  let savedEnvironment;

  beforeEach(() => {
    savedEnvironment = Object.fromEntries(
      ENVIRONMENT_NAMES.map(name => [name, process.env[name]])
    );
    for (const name of ENVIRONMENT_NAMES) delete process.env[name];
    resetBattleMapOperationalMetrics();
  });

  afterEach(() => {
    for (const name of ENVIRONMENT_NAMES) {
      const previous = savedEnvironment[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    resetBattleMapOperationalMetrics();
  });

  it('defaults live rollout and shadow controls conservatively', () => {
    assert.equal(getBattleMapV2ShadowSampleRate(), 0);
    assert.equal(getBattleMapV2ShadowMaxConcurrent(), 1);
    assert.equal(isBattleMapReferenceDeltaEnabled(), false);

    process.env[BATTLE_MAP_V2_SHADOW_SAMPLE_RATE_ENV] = '0.25';
    process.env[BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT_ENV] = '99';
    process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = 'on';

    assert.equal(getBattleMapV2ShadowSampleRate(), 0.25);
    assert.equal(getBattleMapV2ShadowMaxConcurrent(), 8);
    assert.equal(isBattleMapReferenceDeltaEnabled(), true);

    process.env[BATTLE_MAP_V2_SHADOW_SAMPLE_RATE_ENV] = 'invalid';
    process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV] = 'invalid';
    assert.equal(getBattleMapV2ShadowSampleRate(), 0);
    assert.equal(isBattleMapReferenceDeltaEnabled(), false);
  });

  it('samples a request deterministically without using ambient randomness', () => {
    const first = shouldSampleBattleMapV2Shadow(request, 0.37);
    for (let index = 0; index < 20; index++) {
      assert.equal(shouldSampleBattleMapV2Shadow(request, 0.37), first);
    }
    assert.equal(shouldSampleBattleMapV2Shadow(request, 0), false);
    assert.equal(shouldSampleBattleMapV2Shadow(request, 1), true);
  });

  it('records successful and failed shadows without rejecting the caller', async () => {
    const success = scheduleBattleMapV2Shadow({
      request,
      activeGeneration: { durationMs: 10 },
      generate: async () => shadowMap(),
      rate: 1
    });
    assert.equal(success.scheduled, true);
    assert.equal((await success.completion).status, 'succeeded');

    const failure = scheduleBattleMapV2Shadow({
      request,
      activeGeneration: { durationMs: 10 },
      generate: async () => {
        const error = new Error('fixture failure');
        error.code = 'FIXTURE_FAILURE';
        throw error;
      },
      rate: 1
    });
    assert.equal((await failure.completion).status, 'failed');

    const metrics = getBattleMapOperationalMetrics();
    assert.equal(metrics.counters.shadowSampled, 2);
    assert.equal(metrics.counters.shadowSucceeded, 1);
    assert.equal(metrics.counters.shadowFailed, 1);
    assert.equal(metrics.shadowInFlight, 0);
    assert.equal('recentShadowDiagnostics' in metrics, false);
    assert.equal('recentGenerationDiagnostics' in metrics, false);
    const diagnostics = getBattleMapOperationalDiagnostics();
    assert.equal(
      diagnostics.recentShadowDiagnostics[0].fullHash,
      'sha256:shadow-fixture'
    );
    assert.deepEqual(
      {
        terrainSeed: diagnostics.recentShadowDiagnostics[0].terrainSeed,
        mode: diagnostics.recentShadowDiagnostics[0].mode,
        nodeType: diagnostics.recentShadowDiagnostics[0].nodeType,
        dimensions: diagnostics.recentShadowDiagnostics[0].dimensions,
        activeVersion: diagnostics.recentShadowDiagnostics[0].activeVersion,
        mapSchemaVersion:
          diagnostics.recentShadowDiagnostics[0].mapSchemaVersion,
        recipeId: diagnostics.recentShadowDiagnostics[0].recipeId,
        recipeVersion: diagnostics.recentShadowDiagnostics[0].recipeVersion,
        selectedAttempt:
          diagnostics.recentShadowDiagnostics[0].selectedAttempt,
        authoritativeHash:
          diagnostics.recentShadowDiagnostics[0].authoritativeHash,
        visualHash: diagnostics.recentShadowDiagnostics[0].visualHash
      },
      {
        terrainSeed: 997,
        mode: 'pve',
        nodeType: 'forest',
        dimensions: '32x32',
        activeVersion: 1,
        mapSchemaVersion: 2,
        recipeId: 'forest',
        recipeVersion: '2',
        selectedAttempt: 2,
        authoritativeHash: 'sha256:authoritative-fixture',
        visualHash: 'sha256:visual-fixture'
      }
    );
    assert.equal(
      diagnostics.recentShadowDiagnostics[1].errorCode,
      'FIXTURE_FAILURE'
    );
    assert.deepEqual(
      {
        terrainSeed: diagnostics.recentShadowDiagnostics[1].terrainSeed,
        mode: diagnostics.recentShadowDiagnostics[1].mode,
        nodeType: diagnostics.recentShadowDiagnostics[1].nodeType,
        dimensions: diagnostics.recentShadowDiagnostics[1].dimensions,
        activeVersion: diagnostics.recentShadowDiagnostics[1].activeVersion,
        mapSchemaVersion:
          diagnostics.recentShadowDiagnostics[1].mapSchemaVersion,
        recipeId: diagnostics.recentShadowDiagnostics[1].recipeId,
        selectedAttempt:
          diagnostics.recentShadowDiagnostics[1].selectedAttempt,
        fullHash: diagnostics.recentShadowDiagnostics[1].fullHash
      },
      {
        terrainSeed: 997,
        mode: 'pve',
        nodeType: 'forest',
        dimensions: '32x32',
        activeVersion: 1,
        mapSchemaVersion: 2,
        recipeId: null,
        selectedAttempt: null,
        fullHash: null
      }
    );
    assert.ok(metrics.alerts.active.includes('shadow_generation_failure'));
  });

  it('retains only the 32 newest shadow reproduction diagnostics', async () => {
    for (let index = 0; index < 33; index++) {
      const terrainSeed = 10_000 + index;
      const shadow = scheduleBattleMapV2Shadow({
        request: { ...request, terrainSeed },
        activeGeneration: { version: 1, durationMs: 1 },
        generate: async () => shadowMap({ terrainSeed }),
        rate: 1
      });
      await shadow.completion;
    }

    const diagnostics = getBattleMapOperationalDiagnostics();
    assert.equal(diagnostics.recentShadowDiagnostics.length, 32);
    assert.equal(
      diagnostics.recentShadowDiagnostics[0].terrainSeed,
      10_001
    );
    assert.equal(
      diagnostics.recentShadowDiagnostics[31].terrainSeed,
      10_032
    );
  });

  it('bounds concurrent shadow work and exposes a busy skip', async () => {
    let release;
    const deferred = new Promise(resolve => {
      release = resolve;
    });
    const first = scheduleBattleMapV2Shadow({
      request,
      activeGeneration: {},
      generate: () => deferred.then(shadowMap),
      rate: 1,
      maxConcurrent: 1
    });
    const second = scheduleBattleMapV2Shadow({
      request: { ...request, terrainSeed: 998 },
      activeGeneration: {},
      generate: async () => shadowMap(),
      rate: 1,
      maxConcurrent: 1
    });

    assert.equal(first.scheduled, true);
    assert.deepEqual(
      { scheduled: second.scheduled, reason: second.reason },
      { scheduled: false, reason: 'concurrency_limit' }
    );
    release();
    await first.completion;
    assert.equal(
      getBattleMapOperationalMetrics().counters.shadowSkippedBusy,
      1
    );
  });

  it('enforces compressed and uncompressed wire budgets', () => {
    const accepted = assertBattleMapWirePayloadWithinBudget(
      { type: 'battle_state', state: { units: [] } },
      'initialSnapshot'
    );
    assert.ok(accepted.uncompressed > 0);
    assert.ok(accepted.compressed > 0);

    process.env[BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV] = '1';
    process.env[BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV] = '1';
    assert.throws(
      () => assertBattleMapWirePayloadWithinBudget(
        { type: 'battle_state_update', stateRevision: 2 },
        'mutableDelta'
      ),
      error => error?.code === 'BATTLE_MAP_WIRE_PAYLOAD_TOO_LARGE'
        && error?.kind === 'mutableDelta'
    );

    const metrics = getBattleMapOperationalMetrics();
    assert.equal(metrics.counters.initialSnapshotAccepted, 1);
    assert.equal(metrics.counters.mutableDeltaOversized, 1);
    assert.ok(metrics.alerts.active.includes('mutable_delta_oversized'));
  });

  it('aggregates bounded, low-cardinality rollout telemetry and SLO alerts', () => {
    process.env[BATTLE_MAP_V2_GENERATION_P95_SLO_MS_ENV] = '1';
    recordBattleMapGenerationStarted({ version: 2 });
    recordBattleMapGenerationSucceeded({
      version: 2,
      ...request,
      durationMs: 5,
      map: shadowMap()
    });
    recordBattleMapCapabilityNegotiation({
      compatible: true,
      mapDelivery: 'cached',
      hadCachedMaps: true
    });
    recordBattleMapCapabilityNegotiation({
      compatible: false,
      mapDelivery: null
    });
    recordBattleMapSchemaOrHashRejection();
    recordBattleMapWebsocketDelivery('sent');
    recordBattleMapWebsocketDelivery('acked');
    recordBattleMapResyncRequest('map_hash_mismatch');
    recordBattleMapResyncRequest('unbounded-user-input');

    const metrics = getBattleMapOperationalMetrics();
    assert.equal(metrics.counters.generationActiveV2Started, 1);
    assert.equal(metrics.counters.generationActiveV2Succeeded, 1);
    assert.equal(metrics.counters.cachedMapHit, 1);
    assert.equal(metrics.counters.capabilityIncompatible, 1);
    assert.equal(metrics.counters.websocketSent, 1);
    assert.equal(metrics.counters.websocketAcked, 1);
    assert.equal(metrics.resyncReasons.map_hash_mismatch, 1);
    assert.equal(metrics.resyncReasons.other, 1);
    assert.equal(metrics.status, 'degraded');
    assert.ok(metrics.alerts.active.includes('schema_or_hash_rejection'));
    assert.deepEqual(metrics.generationP95Slo, {
      configured: true,
      ready: true,
      source: 'generation.active.v2.durationMs',
      sampleCount: 1,
      observedP95Ms: 5,
      thresholdMs: 1,
      breached: true
    });
    assert.ok(
      metrics.alerts.active.includes(
        'active_v2_generation_p95_slo_exceeded'
      )
    );
    const active =
      getBattleMapOperationalDiagnostics().recentGenerationDiagnostics[0];
    assert.deepEqual(
      {
        status: active.status,
        terrainSeed: active.terrainSeed,
        mode: active.mode,
        nodeType: active.nodeType,
        dimensions: active.dimensions,
        activeVersion: active.activeVersion,
        mapSchemaVersion: active.mapSchemaVersion,
        recipeId: active.recipeId,
        recipeVersion: active.recipeVersion,
        selectedAttempt: active.selectedAttempt,
        authoritativeHash: active.authoritativeHash,
        visualHash: active.visualHash,
        fullHash: active.fullHash
      },
      {
        status: 'succeeded',
        terrainSeed: 997,
        mode: 'pve',
        nodeType: 'forest',
        dimensions: '32x32',
        activeVersion: 2,
        mapSchemaVersion: 2,
        recipeId: 'forest',
        recipeVersion: '2',
        selectedAttempt: 2,
        authoritativeHash: 'sha256:authoritative-fixture',
        visualHash: 'sha256:visual-fixture',
        fullHash: 'sha256:shadow-fixture'
      }
    );
  });

  it('keeps active generation failure context and bounds active diagnostics', () => {
    const candidate = shadowMap({ terrainSeed: 20_000 });
    const error = new Error('attempt budget exhausted');
    error.code = 'ATTEMPT_BUDGET_EXHAUSTED';
    error.attempts = [{ candidate }];
    recordBattleMapGenerationFailed({
      version: 2,
      ...request,
      terrainSeed: 20_000,
      durationMs: 12,
      error
    });

    for (let index = 1; index < 33; index++) {
      const terrainSeed = 20_000 + index;
      recordBattleMapGenerationSucceeded({
        version: 2,
        ...request,
        terrainSeed,
        durationMs: 5,
        map: shadowMap({ terrainSeed })
      });
    }

    const diagnostics = getBattleMapOperationalDiagnostics();
    assert.equal(diagnostics.recentGenerationDiagnostics.length, 32);
    assert.equal(
      diagnostics.recentGenerationDiagnostics[0].terrainSeed,
      20_001
    );
    assert.equal(
      diagnostics.recentGenerationDiagnostics[31].terrainSeed,
      20_032
    );

    resetBattleMapOperationalMetrics();
    recordBattleMapGenerationFailed({
      version: 2,
      ...request,
      terrainSeed: 20_000,
      durationMs: 12,
      error
    });
    const failure =
      getBattleMapOperationalDiagnostics().recentGenerationDiagnostics[0];
    assert.deepEqual(
      {
        status: failure.status,
        terrainSeed: failure.terrainSeed,
        mode: failure.mode,
        nodeType: failure.nodeType,
        dimensions: failure.dimensions,
        activeVersion: failure.activeVersion,
        mapSchemaVersion: failure.mapSchemaVersion,
        recipeId: failure.recipeId,
        recipeVersion: failure.recipeVersion,
        selectedAttempt: failure.selectedAttempt,
        authoritativeHash: failure.authoritativeHash,
        visualHash: failure.visualHash,
        fullHash: failure.fullHash,
        errorCode: failure.errorCode,
        attemptedCandidates: failure.attemptedCandidates
      },
      {
        status: 'failed',
        terrainSeed: 20_000,
        mode: 'pve',
        nodeType: 'forest',
        dimensions: '32x32',
        activeVersion: 2,
        mapSchemaVersion: 2,
        recipeId: 'forest',
        recipeVersion: '2',
        selectedAttempt: null,
        authoritativeHash: null,
        visualHash: null,
        fullHash: null,
        errorCode: 'ATTEMPT_BUDGET_EXHAUSTED',
        attemptedCandidates: 1
      }
    );
  });

  it('records V3 generation and catalog coverage without cardinality-bearing labels', () => {
    recordAuthoredMapCatalogCoverage('selected');
    recordAuthoredMapCatalogCoverage('absent');
    recordAuthoredMapCatalogSelectionFailed();
    recordBattleMapGenerationStarted({ version: 3 });
    recordBattleMapGenerationSucceeded({
      version: 3,
      ...request,
      durationMs: 4,
      map: {
        battleMapSchemaVersion: 3,
        hashes: {
          authoritativeHash: 'sha256:v3-authoritative',
          visualHash: 'sha256:v3-visual',
          fullHash: 'sha256:v3-full'
        }
      }
    });

    const metrics = getBattleMapOperationalMetrics();
    assert.equal(metrics.counters.v3CatalogSelected, 1);
    assert.equal(metrics.counters.v3CatalogCoverageAbsent, 1);
    assert.equal(metrics.counters.v3CatalogSelectionFailed, 1);
    assert.equal(metrics.counters.generationActiveV3Started, 1);
    assert.equal(metrics.counters.generationActiveV3Succeeded, 1);
    const diagnostic =
      getBattleMapOperationalDiagnostics().recentGenerationDiagnostics[0];
    assert.equal(diagnostic.activeVersion, 3);
    assert.equal(diagnostic.mapSchemaVersion, 3);
    assert.equal(diagnostic.fullHash, 'sha256:v3-full');
    assert.throws(
      () => recordAuthoredMapCatalogCoverage('corrupt'),
      /Unknown authored-map catalog coverage state/
    );
  });

  it('enforces the initial paired V2-to-V1 p95 guardrail until an SLO replaces it', async () => {
    const completions = [];
    for (let index = 0; index < 20; index++) {
      const shadow = scheduleBattleMapV2Shadow({
        request: { ...request, terrainSeed: 2_000 + index },
        activeGeneration: { durationMs: Number.EPSILON },
        generate: async () => shadowMap(),
        rate: 1
      });
      completions.push(shadow.completion);
      await shadow.completion;
    }
    await Promise.all(completions);

    const guarded = getBattleMapOperationalMetrics();
    assert.equal(guarded.relativePerformance.ready, true);
    assert.ok(guarded.relativePerformance.observedP95Ratio > 2);
    assert.ok(
      guarded.alerts.active.includes(
        'shadow_generation_relative_p95_guardrail_exceeded'
      )
    );

    process.env[BATTLE_MAP_V2_GENERATION_P95_SLO_MS_ENV] =
      String(Number.MAX_SAFE_INTEGER);
    const deploymentSlo = getBattleMapOperationalMetrics();
    assert.equal(
      deploymentSlo.configuration.initialRelativeP95Guardrail.enforced,
      false
    );
    assert.equal(
      deploymentSlo.alerts.active.includes(
        'shadow_generation_relative_p95_guardrail_exceeded'
      ),
      false
    );
  });

  it('preserves pve_coop as a known telemetry mode', () => {
    recordBattleMapGenerationSucceeded({
      version: 2,
      ...request,
      mode: 'pve_coop',
      durationMs: 5,
      map: shadowMap()
    });
    recordBattleMapGenerationSucceeded({
      version: 2,
      ...request,
      mode: 'unbounded-user-input',
      durationMs: 5,
      map: shadowMap()
    });

    const diagnostics = getBattleMapOperationalDiagnostics();
    assert.equal(diagnostics.recentGenerationDiagnostics[0].mode, 'pve_coop');
    assert.equal(diagnostics.recentGenerationDiagnostics[1].mode, 'other');
  });
});
