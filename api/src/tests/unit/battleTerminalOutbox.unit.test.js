import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BattleTerminalOutboxEventKeyConflictError,
  BattleTerminalOutboxRedriveRejectedError,
  buildBattleTerminalEventKey,
  createBattleTerminalOutbox
} from '../../services/battle/BattleTerminalOutbox.js';

const outboxRow = (overrides = {}) => ({
  id: 9,
  event_key: 'battle:42:quest.progress',
  battle_id: 42,
  event_type: 'quest.progress',
  payload: { winnerId: 7 },
  attempts: 1,
  next_attempt_at: new Date('2026-07-28T12:00:00.000Z'),
  claimed_at: new Date('2026-07-28T12:00:01.000Z'),
  claim_token: '11111111-1111-4111-8111-111111111111',
  last_error: null,
  processed_at: null,
  created_at: new Date('2026-07-28T12:00:00.000Z'),
  updated_at: new Date('2026-07-28T12:00:01.000Z'),
  ...overrides
});

const silentLogger = { error() {} };

describe('BattleTerminalOutbox', () => {
  it('builds a stable battle/type event key', () => {
    assert.equal(
      buildBattleTerminalEventKey(42, 'quest.progress'),
      'battle:42:quest.progress'
    );
  });

  it('enqueues only through the caller client and preserves conflicts', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [outboxRow({
            attempts: 0,
            claimed_at: null,
            claim_token: null
          })]
        };
      }
    };
    const outbox = createBattleTerminalOutbox({
      query: async () => {
        throw new Error('global query must not be used by enqueue');
      }
    });

    const event = await outbox.enqueue(client, {
      battleId: 42,
      eventType: 'quest.progress',
      payload: { winnerId: 7 }
    });

    assert.equal(event.eventKey, 'battle:42:quest.progress');
    assert.equal(event.attempts, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /ON CONFLICT \(event_key\) DO UPDATE/);
    assert.match(calls[0].sql, /SET event_key = battle_terminal_effect_outbox\.event_key/);
    assert.match(
      calls[0].sql,
      /battle_terminal_effect_outbox\.payload = EXCLUDED\.payload/
    );
    assert.deepEqual(calls[0].params, [
      'battle:42:quest.progress',
      42,
      'quest.progress',
      '{"winnerId":7}'
    ]);
  });

  it('rejects an explicit key already bound to another event', async () => {
    const client = {
      async query() {
        return {
          rows: [outboxRow({
            battle_id: 99,
            event_key: 'explicit:terminal'
          })]
        };
      }
    };
    const outbox = createBattleTerminalOutbox({ query: async () => ({ rows: [] }) });

    await assert.rejects(
      outbox.enqueue(client, {
        battleId: 42,
        eventType: 'quest.progress',
        eventKey: 'explicit:terminal'
      }),
      BattleTerminalOutboxEventKeyConflictError
    );
  });

  it('rejects a retry that changes the payload for the same event identity', async () => {
    const client = {
      async query() {
        // PostgreSQL returns no row because the ON CONFLICT validation WHERE
        // clause rejects a different JSONB payload.
        return { rows: [] };
      }
    };
    const outbox = createBattleTerminalOutbox({ query: async () => ({ rows: [] }) });

    await assert.rejects(
      outbox.enqueue(client, {
        battleId: 42,
        eventType: 'quest.progress',
        payload: { winnerId: 8 }
      }),
      BattleTerminalOutboxEventKeyConflictError
    );
  });

  it('claims due rows atomically with skip locked and a lease', async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [outboxRow()] };
    };
    const outbox = createBattleTerminalOutbox({
      query,
      createClaimToken: () => '11111111-1111-4111-8111-111111111111',
      maxAttempts: 4,
      claimLeaseMs: 30_000
    });

    const claimed = await outbox.claimPending({ limit: 3 });

    assert.equal(claimed.length, 1);
    assert.equal(claimed[0].attempts, 1);
    assert.match(calls[0].sql, /FOR UPDATE SKIP LOCKED/);
    assert.match(calls[0].sql, /attempts = outbox\.attempts \+ 1/);
    assert.match(calls[0].sql, /claimed_at <= CURRENT_TIMESTAMP/);
    assert.deepEqual(calls[0].params, [
      3,
      '11111111-1111-4111-8111-111111111111',
      30_000,
      4
    ]);
  });

  it('dispatches registered handlers and durably marks success', async () => {
    const calls = [];
    const handled = [];
    let claimCount = 0;
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('WITH pending')) {
        claimCount += 1;
        return { rows: claimCount === 1 ? [outboxRow()] : [] };
      }
      return { rows: [{ id: 9 }], rowCount: 1 };
    };
    const outbox = createBattleTerminalOutbox({
      query,
      handlers: {
        'quest.progress': async (payload, context) => {
          handled.push({ payload, context });
        }
      },
      createClaimToken: () => '11111111-1111-4111-8111-111111111111',
      logger: silentLogger
    });

    const summary = await outbox.drainBatch({ limit: 5 });

    assert.deepEqual(summary, {
      claimed: 1,
      processed: 1,
      failed: 0,
      exhausted: 0,
      errors: []
    });
    assert.deepEqual(handled[0].payload, { winnerId: 7 });
    assert.equal(handled[0].context.eventKey, 'battle:42:quest.progress');
    assert.equal(handled[0].context.attempt, 1);
    const completion = calls.find(call => call.sql.includes('SET processed_at'));
    assert.ok(completion);
    assert.deepEqual(completion.params, [
      9,
      '11111111-1111-4111-8111-111111111111'
    ]);
  });

  it('retries failures with capped exponential backoff and stops claiming at max attempts', async () => {
    const attempts = [1, 2, 4];
    const delays = [];
    const query = async (sql, params) => {
      if (sql.includes('WITH pending')) {
        const attempt = attempts.shift();
        return { rows: attempt ? [outboxRow({ attempts: attempt })] : [] };
      }
      if (sql.includes('SET last_error')) {
        delays.push(params[3]);
        return { rows: [{ id: 9 }], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    };
    const outbox = createBattleTerminalOutbox({
      query,
      handlers: {
        'quest.progress': async () => {
          throw new Error('quest provider unavailable');
        }
      },
      createClaimToken: () => '11111111-1111-4111-8111-111111111111',
      maxAttempts: 4,
      baseRetryDelayMs: 1000,
      maxRetryDelayMs: 2500,
      logger: silentLogger
    });

    const first = await outbox.drainBatch({ limit: 1 });
    const second = await outbox.drainBatch({ limit: 1 });
    const final = await outbox.drainBatch({ limit: 1 });

    assert.deepEqual(delays, [1000, 2000, 2500]);
    assert.equal(first.exhausted, 0);
    assert.equal(second.exhausted, 0);
    assert.equal(final.exhausted, 1);
    assert.equal(final.errors[0].error, 'quest provider unavailable');
  });

  it('treats a missing handler as a durable dispatch failure', async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('WITH pending')) return { rows: [outboxRow()] };
      return { rows: [{ id: 9 }], rowCount: 1 };
    };
    const outbox = createBattleTerminalOutbox({
      query,
      createClaimToken: () => '11111111-1111-4111-8111-111111111111',
      logger: silentLogger
    });

    const summary = await outbox.drainBatch({ limit: 1 });

    assert.equal(summary.failed, 1);
    assert.match(summary.errors[0].error, /No battle terminal outbox handler registered/);
    const failure = calls.find(call => call.sql.includes('SET last_error'));
    assert.equal(failure.params[3], 1000);
  });

  it('atomically redrives an exhausted event and processes it with the same receipt key', async () => {
    const calls = [];
    let state = outboxRow({
      attempts: 5,
      last_error: 'quest provider unavailable'
    });
    let handledEventKey;
    const query = async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('WITH candidate AS MATERIALIZED')) {
        const previous = state;
        state = {
          ...state,
          attempts: 0,
          next_attempt_at: new Date('2026-07-28T12:05:00.000Z'),
          claimed_at: null,
          claim_token: null,
          last_error: null
        };
        return {
          rows: [{
            candidate_attempts: previous.attempts,
            candidate_processed_at: previous.processed_at,
            candidate_claim_token: previous.claim_token,
            redriven_id: state.id,
            ...state,
            previous_attempts: previous.attempts,
            previous_last_error: previous.last_error,
            audit_id: 71,
            redriven_at: new Date('2026-07-28T12:05:00.000Z')
          }]
        };
      }
      if (sql.includes('WITH pending')) {
        if (state.processed_at || state.attempts > 0) return { rows: [] };
        state = {
          ...state,
          attempts: 1,
          claimed_at: new Date('2026-07-28T12:05:01.000Z'),
          claim_token: params[1]
        };
        return { rows: [state] };
      }
      if (sql.includes('SET processed_at')) {
        state = {
          ...state,
          processed_at: new Date('2026-07-28T12:05:02.000Z'),
          claimed_at: null,
          claim_token: null
        };
        return { rows: [{ id: state.id }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    };
    const outbox = createBattleTerminalOutbox({
      query,
      handlers: {
        'quest.progress': async (_payload, context) => {
          handledEventKey = context.eventKey;
        }
      },
      createClaimToken: () => '22222222-2222-4222-8222-222222222222',
      maxAttempts: 5,
      logger: silentLogger
    });

    const redrive = await outbox.redriveExhausted(
      'battle:42:quest.progress',
      {
        actor: 'ops@example.test',
        reason: 'Quest provider recovered; incident INC-42'
      }
    );
    const delivery = await outbox.drainBatch({ limit: 1 });

    assert.equal(redrive.event.attempts, 0);
    assert.equal(redrive.event.claimToken, null);
    assert.equal(redrive.event.lastError, null);
    assert.deepEqual(redrive.audit, {
      id: 71,
      actor: 'ops@example.test',
      reason: 'Quest provider recovered; incident INC-42',
      previousAttempts: 5,
      previousLastError: 'quest provider unavailable',
      redrivenAt: new Date('2026-07-28T12:05:00.000Z')
    });
    assert.equal(handledEventKey, 'battle:42:quest.progress');
    assert.equal(delivery.processed, 1);
    assert.ok(state.processed_at);

    const redriveCall = calls[0];
    assert.match(redriveCall.sql, /FOR UPDATE/);
    assert.match(redriveCall.sql, /SET attempts = 0/);
    assert.match(redriveCall.sql, /claimed_at = NULL/);
    assert.match(redriveCall.sql, /next_attempt_at = CURRENT_TIMESTAMP/);
    assert.match(redriveCall.sql, /INSERT INTO battle_terminal_outbox_redrives/);
    assert.doesNotMatch(redriveCall.sql, /battle_terminal_progression_receipts/);
    assert.deepEqual(redriveCall.params, [
      'battle:42:quest.progress',
      'ops@example.test',
      'Quest provider recovered; incident INC-42',
      5,
      60_000
    ]);
  });

  it('rejects invalid, missing, non-exhausted, processed, and actively claimed redrives', async () => {
    const makeOutbox = row => createBattleTerminalOutbox({
      maxAttempts: 5,
      query: async () => ({ rows: row ? [row] : [] })
    });

    await assert.rejects(
      makeOutbox(null).redriveExhausted('', {
        actor: 'ops',
        reason: 'investigated'
      }),
      /eventKey must be a non-empty string/
    );
    await assert.rejects(
      makeOutbox(null).redriveExhausted('missing', {
        actor: 'ops',
        reason: 'investigated'
      }),
      error => error instanceof BattleTerminalOutboxRedriveRejectedError
        && error.reason === 'not_found'
    );
    await assert.rejects(
      makeOutbox({
        candidate_attempts: 4,
        candidate_processed_at: null,
        candidate_claim_token: null,
        redriven_id: null
      }).redriveExhausted('pending', {
        actor: 'ops',
        reason: 'investigated'
      }),
      error => error instanceof BattleTerminalOutboxRedriveRejectedError
        && error.reason === 'not_exhausted'
    );
    await assert.rejects(
      makeOutbox({
        candidate_attempts: 5,
        candidate_processed_at: new Date(),
        candidate_claim_token: null,
        redriven_id: null
      }).redriveExhausted('processed', {
        actor: 'ops',
        reason: 'investigated'
      }),
      error => error instanceof BattleTerminalOutboxRedriveRejectedError
        && error.reason === 'processed'
    );
    await assert.rejects(
      makeOutbox({
        candidate_attempts: 5,
        candidate_processed_at: null,
        candidate_claim_token: '11111111-1111-4111-8111-111111111111',
        redriven_id: null
      }).redriveExhausted('active-final-attempt', {
        actor: 'ops',
        reason: 'investigated'
      }),
      error => error instanceof BattleTerminalOutboxRedriveRejectedError
        && error.reason === 'actively_claimed'
    );
  });

  it('allows only one concurrent redrive of the same exhausted event', async () => {
    let attempts = 5;
    let sql;
    const outbox = createBattleTerminalOutbox({
      maxAttempts: 5,
      query: async (statement) => {
        sql = statement;
        const candidateAttempts = attempts;
        if (attempts >= 5) {
          attempts = 0;
          return {
            rows: [{
              candidate_attempts: candidateAttempts,
              candidate_processed_at: null,
              candidate_claim_token: null,
              redriven_id: 9,
              ...outboxRow({
                attempts: 0,
                claimed_at: null,
                claim_token: null,
                last_error: null
              }),
              previous_attempts: candidateAttempts,
              previous_last_error: 'provider unavailable',
              audit_id: 81,
              redriven_at: new Date()
            }]
          };
        }
        return {
          rows: [{
            candidate_attempts: candidateAttempts,
            candidate_processed_at: null,
            candidate_claim_token: null,
            redriven_id: null
          }]
        };
      }
    });
    const input = {
      actor: 'ops',
      reason: 'provider recovered'
    };

    const results = await Promise.allSettled([
      outbox.redriveExhausted('battle:42:quest.progress', input),
      outbox.redriveExhausted('battle:42:quest.progress', input)
    ]);

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.equal(rejected.reason.reason, 'not_exhausted');
    assert.match(sql, /FOR UPDATE/);
    assert.match(sql, /candidate\.attempts >= \$4/);
  });

  it('reports persistent pending and exhausted delivery health', async () => {
    const calls = [];
    const outbox = createBattleTerminalOutbox({
      maxAttempts: 7,
      query: async (sql, params) => {
        calls.push({ sql, params });
        return {
          rows: [{
            pending: '4',
            due: '2',
            claimed: '1',
            exhausted: '3',
            oldest_pending_at: new Date('2026-07-28T12:00:00.000Z')
          }]
        };
      }
    });

    const status = await outbox.getDeliveryStatus();

    assert.deepEqual(status, {
      pending: 4,
      due: 2,
      claimed: 1,
      exhausted: 3,
      oldestPendingAt: new Date('2026-07-28T12:00:00.000Z'),
      maxAttempts: 7
    });
    assert.match(calls[0].sql, /attempts >= \$1/);
    assert.deepEqual(calls[0].params, [7]);
  });
});
