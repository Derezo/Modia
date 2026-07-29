import { battleTerminalOutbox } from './BattleTerminalOutbox.js';
import { logger as defaultLogger } from '../../utils/logger.js';

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCHES_PER_TICK = 20;
const DEFAULT_SCHEMA_RETRY_MS = 5000;

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function configuredPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Run the terminal-effect outbox continuously without overlapping drains.
 * PostgreSQL row leases make multiple API replicas safe; the local guard only
 * prevents one process from starting a second drain while its prior tick runs.
 */
export function createBattleTerminalOutboxWorker({
  outbox = battleTerminalOutbox,
  logger = defaultLogger,
  intervalMs = DEFAULT_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
  maxBatchesPerTick = DEFAULT_MAX_BATCHES_PER_TICK,
  schemaRetryMs = DEFAULT_SCHEMA_RETRY_MS,
  scheduleInterval = setInterval,
  cancelInterval = clearInterval,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout
} = {}) {
  if (!outbox || typeof outbox.drainBatch !== 'function') {
    throw new TypeError('outbox must expose drainBatch()');
  }
  positiveInteger(intervalMs, 'intervalMs');
  positiveInteger(batchSize, 'batchSize');
  positiveInteger(maxBatchesPerTick, 'maxBatchesPerTick');
  positiveInteger(schemaRetryMs, 'schemaRetryMs');
  if (
    typeof scheduleInterval !== 'function' ||
    typeof cancelInterval !== 'function' ||
    typeof scheduleTimeout !== 'function' ||
    typeof cancelTimeout !== 'function'
  ) {
    throw new TypeError('interval and timeout scheduler functions are required');
  }

  let intervalId = null;
  let schemaRetryId = null;
  let activeDrain = null;
  let schemaBlocked = false;
  let desiredRunning = false;
  const counters = {
    ticks: 0,
    claimed: 0,
    processed: 0,
    failed: 0,
    exhausted: 0,
    skippedOverlaps: 0,
    drainErrors: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastError: null
  };

  function cancelScheduledDrain() {
    if (intervalId === null) return false;
    const scheduledIntervalId = intervalId;
    intervalId = null;
    cancelInterval(scheduledIntervalId);
    return true;
  }

  function cancelSchemaRetry() {
    if (schemaRetryId === null) return false;
    const scheduledRetryId = schemaRetryId;
    schemaRetryId = null;
    cancelTimeout(scheduledRetryId);
    return true;
  }

  function scheduleRegularDrain() {
    if (!desiredRunning || intervalId !== null) return false;
    intervalId = scheduleInterval(() => {
      if (intervalId === null || schemaBlocked) return;
      void drainOnce().catch(() => {});
    }, intervalMs);
    intervalId?.unref?.();
    return true;
  }

  function scheduleSchemaRetry() {
    if (!desiredRunning || schemaRetryId !== null) return false;
    schemaRetryId = scheduleTimeout(() => {
      schemaRetryId = null;
      if (!desiredRunning || !schemaBlocked) return;
      scheduleRegularDrain();
      void drainOnce().catch(() => {});
    }, schemaRetryMs);
    schemaRetryId?.unref?.();
    return true;
  }

  async function performDrain() {
    counters.ticks += 1;
    counters.lastStartedAt = new Date().toISOString();
    const aggregate = {
      claimed: 0,
      processed: 0,
      failed: 0,
      exhausted: 0,
      errors: []
    };

    for (let batch = 0; batch < maxBatchesPerTick; batch += 1) {
      const result = await outbox.drainBatch({ limit: batchSize });
      aggregate.claimed += result.claimed;
      aggregate.processed += result.processed;
      aggregate.failed += result.failed;
      aggregate.exhausted += result.exhausted;
      aggregate.errors.push(...result.errors);
      if (result.claimed < batchSize) break;
    }

    counters.claimed += aggregate.claimed;
    counters.processed += aggregate.processed;
    counters.failed += aggregate.failed;
    counters.exhausted += aggregate.exhausted;
    counters.lastCompletedAt = new Date().toISOString();
    counters.lastError = aggregate.errors.at(-1)?.error ?? null;
    if (schemaBlocked) {
      schemaBlocked = false;
      cancelSchemaRetry();
    }

    if (aggregate.exhausted > 0) {
      logger?.error?.(
        'BattleTerminalOutboxWorker exhausted events require operator action',
        new Error(`${aggregate.exhausted} terminal effect(s) exhausted retries`)
      );
    }
    return aggregate;
  }

  function drainOnce() {
    if (activeDrain) {
      counters.skippedOverlaps += 1;
      return activeDrain;
    }
    activeDrain = performDrain()
      .catch(error => {
        counters.drainErrors += 1;
        counters.lastCompletedAt = new Date().toISOString();
        counters.lastError = error instanceof Error ? error.message : String(error);
        if (error?.code === '42P01') {
          const wasSchemaBlocked = schemaBlocked;
          schemaBlocked = true;
          cancelScheduledDrain();
          scheduleSchemaRetry();
          if (!wasSchemaBlocked) {
            logger?.error?.('BattleTerminalOutboxWorker drain failed', error);
          }
        } else {
          logger?.error?.('BattleTerminalOutboxWorker drain failed', error);
        }
        throw error;
      })
      .finally(() => {
        activeDrain = null;
      });
    return activeDrain;
  }

  function start() {
    if (desiredRunning && !schemaBlocked) return false;
    desiredRunning = true;
    // An explicit start while schema-blocked forces an immediate recovery
    // probe; otherwise the worker quietly probes on the slower retry cadence.
    cancelSchemaRetry();
    // A startup drain recovers effects committed immediately before a crash.
    void drainOnce().catch(() => {});
    scheduleRegularDrain();
    return true;
  }

  function stop() {
    if (!desiredRunning && intervalId === null && schemaRetryId === null) {
      return false;
    }
    desiredRunning = false;
    cancelScheduledDrain();
    cancelSchemaRetry();
    return true;
  }

  function getStatus() {
    return {
      running: intervalId !== null,
      draining: activeDrain !== null,
      schemaBlocked,
      schemaRetryScheduled: schemaRetryId !== null,
      desiredRunning,
      intervalMs,
      batchSize,
      maxBatchesPerTick,
      schemaRetryMs,
      ...counters
    };
  }

  return Object.freeze({
    start,
    stop,
    drainOnce,
    getStatus
  });
}

export const battleTerminalOutboxWorker = createBattleTerminalOutboxWorker({
  intervalMs: configuredPositiveInteger(
    'BATTLE_TERMINAL_OUTBOX_INTERVAL_MS',
    DEFAULT_INTERVAL_MS
  ),
  batchSize: configuredPositiveInteger(
    'BATTLE_TERMINAL_OUTBOX_BATCH_SIZE',
    DEFAULT_BATCH_SIZE
  ),
  maxBatchesPerTick: configuredPositiveInteger(
    'BATTLE_TERMINAL_OUTBOX_MAX_BATCHES_PER_TICK',
    DEFAULT_MAX_BATCHES_PER_TICK
  ),
  schemaRetryMs: configuredPositiveInteger(
    'BATTLE_TERMINAL_OUTBOX_SCHEMA_RETRY_MS',
    DEFAULT_SCHEMA_RETRY_MS
  )
});
