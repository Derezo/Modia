import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createBattleTerminalOutboxWorker
} from '../../services/battle/BattleTerminalOutboxWorker.js';

const silentLogger = { error() {} };

describe('BattleTerminalOutboxWorker', () => {
  it('drains bounded batches until the backlog is smaller than one batch', async () => {
    const limits = [];
    const results = [
      { claimed: 2, processed: 2, failed: 0, exhausted: 0, errors: [] },
      { claimed: 1, processed: 1, failed: 0, exhausted: 0, errors: [] }
    ];
    const worker = createBattleTerminalOutboxWorker({
      outbox: {
        async drainBatch({ limit }) {
          limits.push(limit);
          return results.shift();
        }
      },
      batchSize: 2,
      maxBatchesPerTick: 4,
      logger: silentLogger
    });

    const result = await worker.drainOnce();

    assert.deepEqual(limits, [2, 2]);
    assert.equal(result.claimed, 3);
    assert.equal(result.processed, 3);
    assert.equal(worker.getStatus().processed, 3);
  });

  it('coalesces overlapping drains and records the overlap', async () => {
    let release;
    const blocked = new Promise(resolve => {
      release = resolve;
    });
    let calls = 0;
    const worker = createBattleTerminalOutboxWorker({
      outbox: {
        async drainBatch() {
          calls += 1;
          await blocked;
          return {
            claimed: 0,
            processed: 0,
            failed: 0,
            exhausted: 0,
            errors: []
          };
        }
      },
      logger: silentLogger
    });

    const first = worker.drainOnce();
    const second = worker.drainOnce();
    assert.equal(first, second);
    release();
    await first;

    assert.equal(calls, 1);
    assert.equal(worker.getStatus().skippedOverlaps, 1);
  });

  it('starts immediately, schedules one unrefed interval, and stops cleanly', async () => {
    let callback;
    let scheduledDelay;
    let unrefed = false;
    let cancelled = null;
    const intervalToken = {
      unref() {
        unrefed = true;
      }
    };
    let drains = 0;
    const worker = createBattleTerminalOutboxWorker({
      outbox: {
        async drainBatch() {
          drains += 1;
          return {
            claimed: 0,
            processed: 0,
            failed: 0,
            exhausted: 0,
            errors: []
          };
        }
      },
      intervalMs: 250,
      logger: silentLogger,
      scheduleInterval(fn, delay) {
        callback = fn;
        scheduledDelay = delay;
        return intervalToken;
      },
      cancelInterval(token) {
        cancelled = token;
      }
    });

    assert.equal(worker.start(), true);
    assert.equal(worker.start(), false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drains, 1);
    assert.equal(scheduledDelay, 250);
    assert.equal(unrefed, true);

    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drains, 2);
    assert.equal(worker.stop(), true);
    assert.equal(worker.stop(), false);
    assert.equal(cancelled, intervalToken);
  });

  it('stops scheduling and logs once when the outbox relation is missing', async () => {
    let callback;
    let cancelled = null;
    let retryCallback;
    let retryDelay;
    let retryCancelled = null;
    let drains = 0;
    const errors = [];
    const intervalToken = {};
    const retryToken = {};
    const missingRelation = Object.assign(
      new Error('relation "battle_terminal_effect_outbox" does not exist'),
      { code: '42P01' }
    );
    const worker = createBattleTerminalOutboxWorker({
      outbox: {
        async drainBatch() {
          drains += 1;
          throw missingRelation;
        }
      },
      logger: {
        error(...args) {
          errors.push(args);
        }
      },
      scheduleInterval(fn) {
        callback = fn;
        return intervalToken;
      },
      cancelInterval(token) {
        cancelled = token;
      },
      scheduleTimeout(fn, delay) {
        retryCallback = fn;
        retryDelay = delay;
        return retryToken;
      },
      cancelTimeout(token) {
        retryCancelled = token;
      }
    });

    assert.equal(worker.start(), true);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(drains, 1);
    assert.equal(errors.length, 1);
    assert.equal(cancelled, intervalToken);
    assert.deepEqual(worker.getStatus(), {
      running: false,
      draining: false,
      schemaBlocked: true,
      schemaRetryScheduled: true,
      desiredRunning: true,
      intervalMs: 1000,
      batchSize: 25,
      maxBatchesPerTick: 20,
      schemaRetryMs: 5000,
      ticks: 1,
      claimed: 0,
      processed: 0,
      failed: 0,
      exhausted: 0,
      skippedOverlaps: 0,
      drainErrors: 1,
      lastStartedAt: worker.getStatus().lastStartedAt,
      lastCompletedAt: worker.getStatus().lastCompletedAt,
      lastError: missingRelation.message
    });

    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drains, 1);
    assert.equal(errors.length, 1);
    assert.equal(retryDelay, 5000);
    assert.equal(typeof retryCallback, 'function');

    assert.equal(worker.stop(), true);
    assert.equal(retryCancelled, retryToken);
    retryCallback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drains, 1);
  });

  it('recovers automatically after the missing schema is migrated', async () => {
    let relationExists = false;
    let callback;
    let retryCallback;
    let drains = 0;
    const missingRelation = Object.assign(new Error('relation does not exist'), {
      code: '42P01'
    });
    const worker = createBattleTerminalOutboxWorker({
      outbox: {
        async drainBatch() {
          drains += 1;
          if (!relationExists) throw missingRelation;
          return {
            claimed: 0,
            processed: 0,
            failed: 0,
            exhausted: 0,
            errors: []
          };
        }
      },
      logger: silentLogger,
      scheduleInterval(fn) {
        callback = fn;
        return {};
      },
      cancelInterval() {},
      scheduleTimeout(fn) {
        retryCallback = fn;
        return {};
      },
      cancelTimeout() {}
    });

    worker.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(worker.getStatus().schemaBlocked, true);

    relationExists = true;
    retryCallback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(worker.getStatus().schemaBlocked, false);
    assert.equal(worker.getStatus().schemaRetryScheduled, false);
    assert.equal(worker.getStatus().running, true);
    assert.equal(drains, 2);

    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drains, 3);
    worker.stop();
  });

  it('continues scheduling and logging generic database errors', async () => {
    let callback;
    let cancelled = false;
    let drains = 0;
    const errors = [];
    const worker = createBattleTerminalOutboxWorker({
      outbox: {
        async drainBatch() {
          drains += 1;
          throw new Error('connection reset');
        }
      },
      logger: {
        error(...args) {
          errors.push(args);
        }
      },
      scheduleInterval(fn) {
        callback = fn;
        return {};
      },
      cancelInterval() {
        cancelled = true;
      }
    });

    worker.start();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(worker.getStatus().schemaBlocked, false);
    assert.equal(worker.getStatus().running, true);
    assert.equal(cancelled, false);

    callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drains, 2);
    assert.equal(errors.length, 2);
    worker.stop();
  });
});
