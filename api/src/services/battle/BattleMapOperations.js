/**
 * Operational controls and bounded telemetry for battle-map rollout.
 *
 * This module deliberately keeps no battle state. Shadow generation receives
 * an injected, side-effect-free generator and stores only small diagnostic
 * summaries. Metrics use fixed counter names and bounded sample buffers so a
 * seed, battle id, user id, or error message can never create unbounded
 * cardinality.
 */

import { performance } from 'node:perf_hooks';
import { constants as zlibConstants, deflateRawSync } from 'node:zlib';

import { BATTLE_STATE_BYTE_BUDGETS } from '../../../../shared/battleStateProtocol.js';
import {
  WEBSOCKET_COMPRESSION_THRESHOLD_BYTES,
  WEBSOCKET_ZLIB_DEFLATE_OPTIONS
} from '../../websocket/compressionConfig.js';

export const BATTLE_MAP_V2_SHADOW_SAMPLE_RATE_ENV =
  'BATTLE_MAP_V2_SHADOW_SAMPLE_RATE';
export const BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT_ENV =
  'BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT';
export const BATTLE_MAP_V2_GENERATION_P95_SLO_MS_ENV =
  'BATTLE_MAP_V2_GENERATION_P95_SLO_MS';
export const BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV =
  'BATTLE_MAP_REFERENCE_DELTA_ENABLED';
export const BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV =
  'BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES';
export const BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV =
  'BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES';
export const BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV =
  'BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES';
export const BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV =
  'BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES';

const SAMPLE_LIMIT = 512;
const RECENT_DIAGNOSTIC_LIMIT = 32;
const MAX_SHADOW_CONCURRENCY = 8;
const INITIAL_RELATIVE_P95_GUARDRAIL = 2;
const INITIAL_RELATIVE_P95_MIN_SAMPLES = 20;
const KNOWN_MODES = new Set([
  'pve',
  'pve_coop',
  'guild',
  'pvp',
  'pvp_coliseum'
]);
const KNOWN_RESYNC_REASONS = new Set([
  'cache_miss',
  'client_apply_error',
  'client_requested',
  'map_hash_mismatch',
  'map_reference_mismatch',
  'queue_timeout',
  'revision_conflict',
  'revision_gap',
  'revisioned_snapshot_required',
  'revisioned_update_required',
  'state_payload_missing'
]);

function createCounters() {
  return {
    generationActiveV1Started: 0,
    generationActiveV1Succeeded: 0,
    generationActiveV1Failed: 0,
    generationActiveV2Started: 0,
    generationActiveV2Succeeded: 0,
    generationActiveV2Failed: 0,
    generationSelectedNonzeroAttempt: 0,
    shadowSampled: 0,
    shadowSucceeded: 0,
    shadowFailed: 0,
    shadowSkippedBusy: 0,
    capabilityIncompatible: 0,
    schemaOrHashRejected: 0,
    cachedMapHit: 0,
    cachedMapMiss: 0,
    initialSnapshotAccepted: 0,
    initialSnapshotOversized: 0,
    mutableDeltaAccepted: 0,
    mutableDeltaOversized: 0,
    referenceDeltaFallbacks: 0,
    websocketSent: 0,
    websocketSendFailed: 0,
    websocketAcked: 0,
    websocketRetries: 0,
    websocketAckExhausted: 0,
    freshSnapshotRecoverySucceeded: 0,
    freshSnapshotRecoveryFailed: 0,
    stateResyncRequested: 0,
    stateRevisionGap: 0,
    stateRevisionConflict: 0,
    mapReferenceMismatch: 0,
    mapHashMismatch: 0
  };
}

const state = {
  startedAt: Date.now(),
  counters: createCounters(),
  samples: new Map(),
  recentGenerationDiagnostics: [],
  recentShadowDiagnostics: [],
  resyncReasons: Object.fromEntries(
    [...KNOWN_RESYNC_REASONS, 'other'].map(reason => [reason, 0])
  ),
  shadowInFlight: 0
};

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedIntegerFromEnvironment(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function nullablePositiveNumberFromEnvironment(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeMode(mode) {
  return KNOWN_MODES.has(mode) ? mode : 'other';
}

function boundedString(value, maximumLength = 128) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, maximumLength);
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function errorCode(error) {
  if (typeof error?.code === 'string' && error.code.length > 0) {
    return error.code.slice(0, 80);
  }
  return error?.name === 'RangeError'
    ? 'RANGE_ERROR'
    : error?.name === 'TypeError'
      ? 'TYPE_ERROR'
      : 'GENERATION_ERROR';
}

function appendBounded(array, value, limit = RECENT_DIAGNOSTIC_LIMIT) {
  array.push(Object.freeze(value));
  if (array.length > limit) array.splice(0, array.length - limit);
}

function firstAttemptCandidate(error) {
  if (!Array.isArray(error?.attempts)) return null;
  return error.attempts.find(attempt => attempt?.candidate)?.candidate ?? null;
}

function reproductionContext({
  version,
  mode,
  nodeType,
  terrainSeed,
  mapWidth,
  mapHeight,
  expectedMapSchemaVersion,
  successful = true,
  map = null
}) {
  const numericVersion = Number(version) === 2 ? 2 : 1;
  const resolvedRecipe = map?.diagnostics?.resolvedRecipe;
  const hashes = map?.diagnostics?.hashes;
  return {
    terrainSeed: safeInteger(map?.terrainSeed ?? terrainSeed),
    mode: normalizeMode(mode),
    nodeType: boundedString(map?.nodeType ?? nodeType, 80),
    dimensions: `${safeInteger(map?.mapWidth ?? mapWidth) ?? 'unknown'}x${
      safeInteger(map?.mapHeight ?? mapHeight) ?? 'unknown'
    }`,
    activeVersion: numericVersion,
    mapSchemaVersion:
      safeInteger(map?.battleMapSchemaVersion)
        ?? safeInteger(expectedMapSchemaVersion)
        ?? numericVersion,
    recipeId: boundedString(resolvedRecipe?.recipeId, 80),
    recipeVersion: boundedString(resolvedRecipe?.recipeVersion, 40),
    selectedAttempt: successful
      ? safeInteger(map?.diagnostics?.attempt)
        ?? safeInteger(map?.metadata?.validationResult?.iterations)
      : null,
    authoritativeHash: successful
      ? boundedString(hashes?.authoritativeHash)
      : null,
    visualHash: successful ? boundedString(hashes?.visualHash) : null,
    fullHash: successful ? boundedString(hashes?.fullHash) : null
  };
}

function observe(name, value) {
  const numericValue = finiteNumber(value, NaN);
  if (!Number.isFinite(numericValue)) return;
  let samples = state.samples.get(name);
  if (!samples) {
    samples = [];
    state.samples.set(name, samples);
  }
  samples.push(numericValue);
  if (samples.length > SAMPLE_LIMIT) {
    samples.splice(0, samples.length - SAMPLE_LIMIT);
  }
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  );
  return sorted[index];
}

function summarize(samples = []) {
  if (samples.length === 0) {
    return Object.freeze({
      count: 0,
      min: null,
      p50: null,
      p95: null,
      p99: null,
      max: null
    });
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1]
  });
}

function websocketFrameSize(payloadBytes) {
  const headerBytes = payloadBytes <= 125
    ? 2
    : (payloadBytes <= 65_535 ? 4 : 10);
  return payloadBytes + headerBytes;
}

function jsonWireSizes(value) {
  const json = JSON.stringify(value);
  const bytes = Buffer.from(json, 'utf8');
  let compressedPayloadBytes = bytes.byteLength;

  if (bytes.byteLength >= WEBSOCKET_COMPRESSION_THRESHOLD_BYTES) {
    const syncFlushed = deflateRawSync(bytes, {
      ...WEBSOCKET_ZLIB_DEFLATE_OPTIONS,
      finishFlush: zlibConstants.Z_SYNC_FLUSH
    });
    // `ws` removes the RFC 7692 sync-flush trailer from a final compressed
    // fragment. Context takeover and fragmentation are disabled for this
    // server-to-client path, so this matches the negotiated frame payload.
    compressedPayloadBytes = Math.max(0, syncFlushed.byteLength - 4);
  }

  return {
    // Include the exact unmasked server-frame header as part of both budgets.
    uncompressed: websocketFrameSize(bytes.byteLength),
    compressed: websocketFrameSize(compressedPayloadBytes)
  };
}

function snapshotLimits() {
  return {
    uncompressed: boundedIntegerFromEnvironment(
      BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV,
      BATTLE_STATE_BYTE_BUDGETS.initialSnapshotUncompressed
    ),
    compressed: boundedIntegerFromEnvironment(
      BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV,
      BATTLE_STATE_BYTE_BUDGETS.initialSnapshotCompressed
    )
  };
}

function deltaLimits() {
  return {
    uncompressed: boundedIntegerFromEnvironment(
      BATTLE_MAP_MUTABLE_DELTA_UNCOMPRESSED_BYTES_ENV,
      BATTLE_STATE_BYTE_BUDGETS.mutableUpdateUncompressed
    ),
    compressed: boundedIntegerFromEnvironment(
      BATTLE_MAP_MUTABLE_DELTA_COMPRESSED_BYTES_ENV,
      BATTLE_STATE_BYTE_BUDGETS.mutableUpdateCompressed
    )
  };
}

/**
 * Reference/delta delivery is rollout-gated and therefore disabled by default.
 * Only an exact true/1/on value enables it; missing and unknown values fail
 * closed to full snapshots.
 */
export function isBattleMapReferenceDeltaEnabled(
  raw = process.env[BATTLE_MAP_REFERENCE_DELTA_ENABLED_ENV]
) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return false;
  const normalized = String(raw).trim().toLowerCase();
  if (['true', '1', 'on'].includes(normalized)) return true;
  return false;
}

export function getBattleMapV2ShadowSampleRate(
  raw = process.env[BATTLE_MAP_V2_SHADOW_SAMPLE_RATE_ENV]
) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

export function getBattleMapV2ShadowMaxConcurrent() {
  return boundedIntegerFromEnvironment(
    BATTLE_MAP_V2_SHADOW_MAX_CONCURRENT_ENV,
    1,
    MAX_SHADOW_CONCURRENCY
  );
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function shouldSampleBattleMapV2Shadow(
  {
    mode,
    nodeType,
    terrainSeed,
    mapWidth,
    mapHeight
  },
  rate = getBattleMapV2ShadowSampleRate()
) {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  const key = [
    normalizeMode(mode),
    String(nodeType),
    String(terrainSeed),
    String(mapWidth),
    String(mapHeight)
  ].join(':');
  return fnv1a32(key) / 0x1_0000_0000 < rate;
}

export function recordBattleMapGenerationStarted({ version }) {
  const suffix = Number(version) === 2 ? 'V2' : 'V1';
  state.counters[`generationActive${suffix}Started`] += 1;
}

export function recordBattleMapGenerationSucceeded({
  version,
  mode,
  nodeType,
  terrainSeed,
  mapWidth,
  mapHeight,
  durationMs,
  map
}) {
  const numericVersion = Number(version) === 2 ? 2 : 1;
  state.counters[`generationActiveV${numericVersion}Succeeded`] += 1;
  observe(`generation.active.v${numericVersion}.durationMs`, durationMs);

  const context = reproductionContext({
    version: numericVersion,
    mode,
    nodeType,
    terrainSeed,
    mapWidth,
    mapHeight,
    map
  });
  const selectedAttempt = context.selectedAttempt ?? 0;
  observe(`generation.active.v${numericVersion}.selectedAttempt`, selectedAttempt);
  if (numericVersion === 2 && selectedAttempt > 0) {
    state.counters.generationSelectedNonzeroAttempt += 1;
  }

  let payloadBytes = null;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(map), 'utf8');
    observe(`generation.active.v${numericVersion}.mapBytes`, payloadBytes);
  } catch {
    // Generation has already succeeded. Telemetry must never change its result.
  }

  appendBounded(state.recentGenerationDiagnostics, {
    at: new Date().toISOString(),
    version: numericVersion,
    status: 'succeeded',
    ...context,
    durationMs: finiteNumber(durationMs),
    payloadBytes,
    hardValid: numericVersion === 2
      ? map?.diagnostics?.hardValidation?.valid === true
      : null,
    tacticalPass: numericVersion === 2
      ? map?.diagnostics?.tacticalValidation?.passed === true
      : null,
    qualityScore: numericVersion === 2
      ? finiteNumber(map?.diagnostics?.qualityMetrics?.score)
      : null
  });
}

export function recordBattleMapGenerationFailed({
  version,
  mode,
  nodeType,
  terrainSeed,
  mapWidth,
  mapHeight,
  durationMs,
  error
}) {
  const numericVersion = Number(version) === 2 ? 2 : 1;
  const context = reproductionContext({
    version: numericVersion,
    mode,
    nodeType,
    terrainSeed,
    mapWidth,
    mapHeight,
    successful: false,
    map: firstAttemptCandidate(error)
  });
  state.counters[`generationActiveV${numericVersion}Failed`] += 1;
  observe(`generation.active.v${numericVersion}.failureDurationMs`, durationMs);
  appendBounded(state.recentGenerationDiagnostics, {
    at: new Date().toISOString(),
    version: numericVersion,
    status: 'failed',
    ...context,
    durationMs: finiteNumber(durationMs),
    errorCode: errorCode(error),
    attemptedCandidates: Array.isArray(error?.attempts) ? error.attempts.length : null
  });
}

/**
 * Schedule a sampled V2 comparison without awaiting it or exposing its output
 * to the active battle. The injected generate function must only generate and
 * validate an in-memory map.
 */
export function scheduleBattleMapV2Shadow({
  request,
  activeGeneration,
  generate,
  rate = getBattleMapV2ShadowSampleRate(),
  maxConcurrent = getBattleMapV2ShadowMaxConcurrent()
}) {
  if (typeof generate !== 'function') {
    throw new TypeError('Shadow generation requires an injected generate function');
  }
  if (!shouldSampleBattleMapV2Shadow(request, rate)) {
    return Object.freeze({
      scheduled: false,
      reason: 'not_sampled',
      completion: null
    });
  }
  if (state.shadowInFlight >= maxConcurrent) {
    state.counters.shadowSkippedBusy += 1;
    return Object.freeze({
      scheduled: false,
      reason: 'concurrency_limit',
      completion: null
    });
  }

  state.shadowInFlight += 1;
  state.counters.shadowSampled += 1;
  const startedAt = performance.now();
  const completion = Promise.resolve()
    .then(generate)
    .then(map => {
      const durationMs = performance.now() - startedAt;
      const context = reproductionContext({
        version: activeGeneration?.version,
        mode: request.mode,
        nodeType: request.nodeType,
        terrainSeed: request.terrainSeed,
        mapWidth: request.mapWidth,
        mapHeight: request.mapHeight,
        expectedMapSchemaVersion: 2,
        map
      });
      const diagnostic = {
        at: new Date().toISOString(),
        status: 'succeeded',
        ...context,
        activeDurationMs: finiteNumber(activeGeneration?.durationMs),
        shadowDurationMs: durationMs,
        durationRatio: activeGeneration?.durationMs > 0
          ? durationMs / activeGeneration.durationMs
          : null,
        hardValid: map?.diagnostics?.hardValidation?.valid === true,
        tacticalPass: map?.diagnostics?.tacticalValidation?.passed === true,
        qualityScore: finiteNumber(map?.diagnostics?.qualityMetrics?.score)
      };
      state.counters.shadowSucceeded += 1;
      observe('generation.shadow.v2.durationMs', durationMs);
      if (diagnostic.activeDurationMs > 0) {
        observe(
          'generation.shadow.active.v1.durationMs',
          diagnostic.activeDurationMs
        );
      }
      if (diagnostic.durationRatio !== null) {
        observe('generation.shadow.v2.durationRatioToV1', diagnostic.durationRatio);
      }
      observe('generation.shadow.v2.selectedAttempt', diagnostic.selectedAttempt);
      observe('generation.shadow.v2.qualityScore', diagnostic.qualityScore);
      appendBounded(state.recentShadowDiagnostics, diagnostic);
      return Object.freeze(diagnostic);
    })
    .catch(error => {
      const durationMs = performance.now() - startedAt;
      const context = reproductionContext({
        version: activeGeneration?.version,
        mode: request.mode,
        nodeType: request.nodeType,
        terrainSeed: request.terrainSeed,
        mapWidth: request.mapWidth,
        mapHeight: request.mapHeight,
        expectedMapSchemaVersion: 2,
        successful: false,
        map: firstAttemptCandidate(error)
      });
      const diagnostic = {
        at: new Date().toISOString(),
        status: 'failed',
        ...context,
        activeDurationMs: finiteNumber(activeGeneration?.durationMs),
        shadowDurationMs: durationMs,
        errorCode: errorCode(error),
        attemptedCandidates: Array.isArray(error?.attempts) ? error.attempts.length : null
      };
      state.counters.shadowFailed += 1;
      observe('generation.shadow.v2.failureDurationMs', durationMs);
      appendBounded(state.recentShadowDiagnostics, diagnostic);
      return Object.freeze(diagnostic);
    })
    .finally(() => {
      state.shadowInFlight -= 1;
    });

  return Object.freeze({
    scheduled: true,
    reason: 'sampled',
    completion
  });
}

export function recordBattleMapCapabilityNegotiation({
  compatible,
  mapDelivery,
  hadCachedMaps = false
}) {
  if (!compatible) {
    state.counters.capabilityIncompatible += 1;
    return;
  }
  if (mapDelivery === 'cached') {
    state.counters.cachedMapHit += 1;
  } else if (hadCachedMaps) {
    state.counters.cachedMapMiss += 1;
  }
}

export function recordBattleMapSchemaOrHashRejection() {
  state.counters.schemaOrHashRejected += 1;
}

export function recordBattleMapReferenceDeltaFallback() {
  state.counters.referenceDeltaFallbacks += 1;
}

export function assertBattleMapWirePayloadWithinBudget(value, kind) {
  if (kind !== 'initialSnapshot' && kind !== 'mutableDelta') {
    throw new TypeError('Battle-map wire payload kind is unsupported');
  }
  const limits = kind === 'initialSnapshot' ? snapshotLimits() : deltaLimits();
  const sizes = jsonWireSizes(value);
  observe(`payload.${kind}.uncompressedBytes`, sizes.uncompressed);
  observe(`payload.${kind}.compressedBytes`, sizes.compressed);

  const acceptedCounter = kind === 'initialSnapshot'
    ? 'initialSnapshotAccepted'
    : 'mutableDeltaAccepted';
  const rejectedCounter = kind === 'initialSnapshot'
    ? 'initialSnapshotOversized'
    : 'mutableDeltaOversized';
  if (sizes.uncompressed > limits.uncompressed || sizes.compressed > limits.compressed) {
    state.counters[rejectedCounter] += 1;
    const error = new RangeError(
      `${kind} exceeds battle-map wire budget: ` +
      `${sizes.uncompressed}/${limits.uncompressed} uncompressed bytes, ` +
      `${sizes.compressed}/${limits.compressed} compressed bytes`
    );
    error.code = 'BATTLE_MAP_WIRE_PAYLOAD_TOO_LARGE';
    error.kind = kind;
    error.sizes = Object.freeze(sizes);
    error.limits = Object.freeze(limits);
    throw error;
  }
  state.counters[acceptedCounter] += 1;
  return Object.freeze({ ...sizes, limits: Object.freeze(limits) });
}

export function recordBattleMapWebsocketDelivery(event) {
  const counterByEvent = {
    sent: 'websocketSent',
    send_failed: 'websocketSendFailed',
    acked: 'websocketAcked',
    retry: 'websocketRetries',
    ack_exhausted: 'websocketAckExhausted',
    recovery_succeeded: 'freshSnapshotRecoverySucceeded',
    recovery_failed: 'freshSnapshotRecoveryFailed'
  };
  const counter = counterByEvent[event];
  if (counter) state.counters[counter] += 1;
}

export function recordBattleMapResyncRequest(reason = 'client_requested') {
  const normalizedReason = KNOWN_RESYNC_REASONS.has(reason) ? reason : 'other';
  state.counters.stateResyncRequested += 1;
  state.resyncReasons[normalizedReason] += 1;
  if (normalizedReason === 'revision_gap') state.counters.stateRevisionGap += 1;
  if (normalizedReason === 'revision_conflict') state.counters.stateRevisionConflict += 1;
  if (normalizedReason === 'map_reference_mismatch') {
    state.counters.mapReferenceMismatch += 1;
  }
  if (normalizedReason === 'map_hash_mismatch') state.counters.mapHashMismatch += 1;
}

export function getBattleMapOperationalMetrics() {
  const sampleSummaries = {};
  for (const [name, samples] of [...state.samples.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    sampleSummaries[name] = summarize(samples);
  }

  const generationP95SloMs = nullablePositiveNumberFromEnvironment(
    BATTLE_MAP_V2_GENERATION_P95_SLO_MS_ENV
  );
  const activeV2Duration =
    sampleSummaries['generation.active.v2.durationMs'];
  const shadowDuration = sampleSummaries['generation.shadow.v2.durationMs'];
  const pairedActiveV1Duration =
    sampleSummaries['generation.shadow.active.v1.durationMs'];
  const relativeP95Ratio =
    shadowDuration?.p95 !== null
      && pairedActiveV1Duration?.p95 > 0
      ? shadowDuration.p95 / pairedActiveV1Duration.p95
      : null;
  const relativeP95Ready =
    (shadowDuration?.count ?? 0) >= INITIAL_RELATIVE_P95_MIN_SAMPLES
      && (pairedActiveV1Duration?.count ?? 0)
        >= INITIAL_RELATIVE_P95_MIN_SAMPLES;
  const relativeP95Enforced = generationP95SloMs === null;
  const generationP95SloReady = (activeV2Duration?.count ?? 0) > 0;
  const generationP95SloBreached =
    generationP95SloMs !== null
      && generationP95SloReady
      && activeV2Duration.p95 > generationP95SloMs;
  const alerts = {
    active: [],
    generationP95SloConfigured: generationP95SloMs !== null
  };
  if (state.counters.shadowFailed > 0) {
    alerts.active.push('shadow_generation_failure');
  }
  if (state.counters.schemaOrHashRejected > 0) {
    alerts.active.push('schema_or_hash_rejection');
  }
  if (state.counters.initialSnapshotOversized > 0) {
    alerts.active.push('initial_snapshot_oversized');
  }
  if (state.counters.mutableDeltaOversized > 0) {
    alerts.active.push('mutable_delta_oversized');
  }
  if (state.counters.websocketAckExhausted > 0) {
    alerts.active.push('websocket_ack_exhaustion');
  }
  if (state.counters.freshSnapshotRecoveryFailed > 0) {
    alerts.active.push('fresh_snapshot_recovery_failure');
  }
  if (generationP95SloBreached) {
    alerts.active.push('active_v2_generation_p95_slo_exceeded');
  }
  if (
    relativeP95Enforced
      && relativeP95Ready
      && relativeP95Ratio > INITIAL_RELATIVE_P95_GUARDRAIL
  ) {
    alerts.active.push('shadow_generation_relative_p95_guardrail_exceeded');
  }

  return Object.freeze({
    status: alerts.active.length > 0
      ? 'degraded'
      : (generationP95SloMs !== null && generationP95SloReady
        ? 'up'
        : 'observing'),
    startedAt: new Date(state.startedAt).toISOString(),
    configuration: Object.freeze({
      v2ShadowSampleRate: getBattleMapV2ShadowSampleRate(),
      v2ShadowMaxConcurrent: getBattleMapV2ShadowMaxConcurrent(),
      v2GenerationP95SloMs: generationP95SloMs,
      initialRelativeP95Guardrail: Object.freeze({
        enforced: relativeP95Enforced,
        maximumRatio: INITIAL_RELATIVE_P95_GUARDRAIL,
        minimumSamples: INITIAL_RELATIVE_P95_MIN_SAMPLES
      }),
      referenceDeltaEnabled: isBattleMapReferenceDeltaEnabled(),
      initialSnapshotLimits: Object.freeze(snapshotLimits()),
      mutableDeltaLimits: Object.freeze(deltaLimits())
    }),
    counters: Object.freeze({ ...state.counters }),
    resyncReasons: Object.freeze({ ...state.resyncReasons }),
    shadowInFlight: state.shadowInFlight,
    distributions: Object.freeze(sampleSummaries),
    generationP95Slo: Object.freeze({
      configured: generationP95SloMs !== null,
      ready: generationP95SloReady,
      source: 'generation.active.v2.durationMs',
      sampleCount: activeV2Duration?.count ?? 0,
      observedP95Ms: activeV2Duration?.p95 ?? null,
      thresholdMs: generationP95SloMs,
      breached: generationP95SloBreached
    }),
    shadowPerformance: Object.freeze({
      ready: (shadowDuration?.count ?? 0) > 0,
      source: 'generation.shadow.v2.durationMs',
      sampleCount: shadowDuration?.count ?? 0,
      observedP95Ms: shadowDuration?.p95 ?? null
    }),
    relativePerformance: Object.freeze({
      ready: relativeP95Ready,
      activeV1P95Ms: pairedActiveV1Duration?.p95 ?? null,
      shadowV2P95Ms: shadowDuration?.p95 ?? null,
      observedP95Ratio: relativeP95Ratio
    }),
    alerts: Object.freeze({
      active: Object.freeze([...alerts.active]),
      generationP95SloConfigured: alerts.generationP95SloConfigured
    })
  });
}

/**
 * Return bounded request-level diagnostics for authenticated operator tooling.
 * The unauthenticated health metrics route intentionally does not expose these
 * records because they contain seeds, map hashes, node types, and dimensions.
 */
export function getBattleMapOperationalDiagnostics() {
  return Object.freeze({
    recentGenerationDiagnostics: Object.freeze([
      ...state.recentGenerationDiagnostics
    ]),
    recentShadowDiagnostics: Object.freeze([...state.recentShadowDiagnostics])
  });
}

export function resetBattleMapOperationalMetrics() {
  state.startedAt = Date.now();
  state.counters = createCounters();
  state.samples.clear();
  state.recentGenerationDiagnostics.splice(0);
  state.recentShadowDiagnostics.splice(0);
  state.resyncReasons = Object.fromEntries(
    [...KNOWN_RESYNC_REASONS, 'other'].map(reason => [reason, 0])
  );
  // Do not reset shadowInFlight: doing so while a scheduled task is running
  // would defeat the concurrency bound. Tests reset only after awaiting tasks.
}
