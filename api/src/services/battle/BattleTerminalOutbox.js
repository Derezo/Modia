import { randomUUID } from 'node:crypto';
import { query as databaseQuery } from '../../config/database.js';
import { logger as defaultLogger } from '../../utils/logger.js';

export const BATTLE_TERMINAL_OUTBOX_DEFAULTS = Object.freeze({
  maxAttempts: 5,
  baseRetryDelayMs: 1000,
  maxRetryDelayMs: 5 * 60 * 1000,
  claimLeaseMs: 60 * 1000,
  batchSize: 25
});

const EVENT_TYPE_MAX_LENGTH = 96;
const EVENT_KEY_MAX_LENGTH = 255;
const LAST_ERROR_MAX_LENGTH = 4000;
const REDRIVE_ACTOR_MAX_LENGTH = 255;
const REDRIVE_REASON_MAX_LENGTH = 2000;

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireBoundedString(value, name, maxLength) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new TypeError(`${name} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function serializePayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('payload must be a JSON object');
  }

  let serialized;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    throw new TypeError(`payload must be JSON serializable: ${error.message}`);
  }
  if (serialized === undefined) {
    throw new TypeError('payload must be JSON serializable');
  }
  return serialized;
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventKey: row.event_key,
    battleId: row.battle_id,
    eventType: row.event_type,
    payload: row.payload,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    claimedAt: row.claimed_at,
    claimToken: row.claim_token,
    lastError: row.last_error,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, LAST_ERROR_MAX_LENGTH);
}

export class BattleTerminalOutboxClaimLostError extends Error {
  constructor(eventKey) {
    super(`Battle terminal outbox claim was lost for ${eventKey}`);
    this.name = 'BattleTerminalOutboxClaimLostError';
  }
}

export class BattleTerminalOutboxEventKeyConflictError extends Error {
  constructor(eventKey) {
    super(`Battle terminal outbox event key is already used by another event: ${eventKey}`);
    this.name = 'BattleTerminalOutboxEventKeyConflictError';
  }
}

export class BattleTerminalOutboxRedriveRejectedError extends Error {
  constructor(eventKey, reason) {
    const descriptions = {
      not_found: 'does not exist',
      processed: 'is already processed',
      not_exhausted: 'is not exhausted',
      actively_claimed: 'still has an active delivery claim'
    };
    super(
      `Battle terminal outbox event ${eventKey} cannot be redriven: `
      + (descriptions[reason] ?? reason)
    );
    this.name = 'BattleTerminalOutboxRedriveRejectedError';
    this.eventKey = eventKey;
    this.reason = reason;
  }
}

/**
 * Build the default stable identity for a terminal effect. Callers that need
 * more than one effect of the same type for a battle must provide an explicit
 * eventKey to enqueue().
 */
export function buildBattleTerminalEventKey(battleId, eventType) {
  const normalizedBattleId = requirePositiveInteger(battleId, 'battleId');
  const normalizedEventType = requireBoundedString(
    eventType,
    'eventType',
    EVENT_TYPE_MAX_LENGTH
  );
  return `battle:${normalizedBattleId}:${normalizedEventType}`;
}

/**
 * Create a durable terminal-effect outbox.
 *
 * Handlers receive `(payload, context)`, where context contains the normalized
 * event plus `eventKey`, `battleId`, `eventType`, and the one-based `attempt`.
 * Delivery is at-least-once, so handlers must use eventKey for idempotency.
 */
export function createBattleTerminalOutbox({
  query = databaseQuery,
  handlers = {},
  logger = defaultLogger,
  createClaimToken = randomUUID,
  maxAttempts = BATTLE_TERMINAL_OUTBOX_DEFAULTS.maxAttempts,
  baseRetryDelayMs = BATTLE_TERMINAL_OUTBOX_DEFAULTS.baseRetryDelayMs,
  maxRetryDelayMs = BATTLE_TERMINAL_OUTBOX_DEFAULTS.maxRetryDelayMs,
  claimLeaseMs = BATTLE_TERMINAL_OUTBOX_DEFAULTS.claimLeaseMs,
  batchSize = BATTLE_TERMINAL_OUTBOX_DEFAULTS.batchSize
} = {}) {
  if (typeof query !== 'function') {
    throw new TypeError('query must be a function');
  }
  if (typeof createClaimToken !== 'function') {
    throw new TypeError('createClaimToken must be a function');
  }
  requirePositiveInteger(maxAttempts, 'maxAttempts');
  requirePositiveInteger(baseRetryDelayMs, 'baseRetryDelayMs');
  requirePositiveInteger(maxRetryDelayMs, 'maxRetryDelayMs');
  requirePositiveInteger(claimLeaseMs, 'claimLeaseMs');
  requirePositiveInteger(batchSize, 'batchSize');
  if (baseRetryDelayMs > maxRetryDelayMs) {
    throw new TypeError('baseRetryDelayMs must not exceed maxRetryDelayMs');
  }

  const registeredHandlers = new Map();

  function registerHandler(eventType, handler) {
    const normalizedEventType = requireBoundedString(
      eventType,
      'eventType',
      EVENT_TYPE_MAX_LENGTH
    );
    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }
    registeredHandlers.set(normalizedEventType, handler);
    return () => {
      if (registeredHandlers.get(normalizedEventType) !== handler) return false;
      return registeredHandlers.delete(normalizedEventType);
    };
  }

  const initialHandlers = handlers instanceof Map
    ? handlers.entries()
    : Object.entries(handlers);
  for (const [eventType, handler] of initialHandlers) {
    registerHandler(eventType, handler);
  }

  /**
   * Enqueue through a caller-owned pg client. This method intentionally never
   * opens or commits a transaction.
   */
  async function enqueue(client, {
    battleId,
    eventType,
    payload = {},
    eventKey
  }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('enqueue requires a caller-provided pg client');
    }
    const normalizedBattleId = requirePositiveInteger(battleId, 'battleId');
    const normalizedEventType = requireBoundedString(
      eventType,
      'eventType',
      EVENT_TYPE_MAX_LENGTH
    );
    const normalizedEventKey = eventKey === undefined
      ? buildBattleTerminalEventKey(normalizedBattleId, normalizedEventType)
      : requireBoundedString(eventKey, 'eventKey', EVENT_KEY_MAX_LENGTH);
    const serializedPayload = serializePayload(payload);

    const result = await client.query(
      `INSERT INTO battle_terminal_effect_outbox (
         event_key,
         battle_id,
         event_type,
         payload
       )
       VALUES ($1, $2, $3, $4::JSONB)
       ON CONFLICT (event_key) DO UPDATE
       SET event_key = battle_terminal_effect_outbox.event_key
       WHERE battle_terminal_effect_outbox.battle_id = EXCLUDED.battle_id
         AND battle_terminal_effect_outbox.event_type = EXCLUDED.event_type
         AND battle_terminal_effect_outbox.payload = EXCLUDED.payload
       RETURNING *`,
      [
        normalizedEventKey,
        normalizedBattleId,
        normalizedEventType,
        serializedPayload
      ]
    );
    const event = normalizeRow(result.rows[0]);
    if (!event
      || event.battleId !== normalizedBattleId
      || event.eventType !== normalizedEventType) {
      throw new BattleTerminalOutboxEventKeyConflictError(normalizedEventKey);
    }
    return event;
  }

  /**
   * Atomically lease due rows. The single UPDATE statement commits the leases
   * before any handler runs, while SKIP LOCKED prevents worker contention.
   */
  async function claimPending({ limit = batchSize } = {}) {
    requirePositiveInteger(limit, 'limit');
    const claimToken = requireBoundedString(
      createClaimToken(),
      'claimToken',
      EVENT_KEY_MAX_LENGTH
    );
    const result = await query(
      `WITH pending AS (
         SELECT id
         FROM battle_terminal_effect_outbox
         WHERE processed_at IS NULL
           AND attempts < $4
           AND next_attempt_at <= CURRENT_TIMESTAMP
           AND (
             claim_token IS NULL
             OR claimed_at <= CURRENT_TIMESTAMP
               - ($3::BIGINT * INTERVAL '1 millisecond')
           )
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE battle_terminal_effect_outbox AS outbox
       SET attempts = outbox.attempts + 1,
           claimed_at = CURRENT_TIMESTAMP,
           claim_token = $2::UUID,
           updated_at = CURRENT_TIMESTAMP
       FROM pending
       WHERE outbox.id = pending.id
       RETURNING outbox.*`,
      [limit, claimToken, claimLeaseMs, maxAttempts]
    );
    return result.rows.map(normalizeRow);
  }

  function retryDelayMs(attempt) {
    const exponent = Math.max(0, attempt - 1);
    return Math.min(maxRetryDelayMs, baseRetryDelayMs * (2 ** exponent));
  }

  async function markProcessed(event) {
    const result = await query(
      `UPDATE battle_terminal_effect_outbox
       SET processed_at = CURRENT_TIMESTAMP,
           claimed_at = NULL,
           claim_token = NULL,
           last_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND claim_token = $2::UUID
         AND processed_at IS NULL
       RETURNING id`,
      [event.id, event.claimToken]
    );
    if (result.rows.length !== 1) {
      throw new BattleTerminalOutboxClaimLostError(event.eventKey);
    }
  }

  async function markFailed(event, error) {
    const delayMs = retryDelayMs(event.attempts);
    const result = await query(
      `UPDATE battle_terminal_effect_outbox
       SET last_error = $3,
           next_attempt_at = CURRENT_TIMESTAMP
             + ($4::BIGINT * INTERVAL '1 millisecond'),
           claimed_at = NULL,
           claim_token = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND claim_token = $2::UUID
         AND processed_at IS NULL
       RETURNING id`,
      [event.id, event.claimToken, errorMessage(error), delayMs]
    );
    if (result.rows.length !== 1) {
      throw new BattleTerminalOutboxClaimLostError(event.eventKey);
    }
    return {
      retryDelayMs: delayMs,
      exhausted: event.attempts >= maxAttempts
    };
  }

  /**
   * Atomically return one exhausted event to the delivery queue and append an
   * immutable operator audit row. An unexpired claim is rejected so redrive
   * cannot overlap a handler that is still legitimately processing its final
   * attempt. Progression receipts are intentionally untouched: replay keeps
   * using the original event key and therefore retains handler idempotency.
   */
  async function redriveExhausted(eventKey, { actor, reason } = {}) {
    const normalizedEventKey = requireBoundedString(
      eventKey,
      'eventKey',
      EVENT_KEY_MAX_LENGTH
    );
    const normalizedActor = requireBoundedString(
      actor,
      'actor',
      REDRIVE_ACTOR_MAX_LENGTH
    );
    const normalizedReason = requireBoundedString(
      reason,
      'reason',
      REDRIVE_REASON_MAX_LENGTH
    );
    const result = await query(
      `WITH candidate AS MATERIALIZED (
         SELECT *
         FROM battle_terminal_effect_outbox
         WHERE event_key = $1
         FOR UPDATE
       ),
       redriven AS (
         UPDATE battle_terminal_effect_outbox AS outbox
         SET attempts = 0,
             next_attempt_at = CURRENT_TIMESTAMP,
             claimed_at = NULL,
             claim_token = NULL,
             last_error = NULL,
             updated_at = CURRENT_TIMESTAMP
         FROM candidate
         WHERE outbox.id = candidate.id
           AND candidate.processed_at IS NULL
           AND candidate.attempts >= $4
           AND (
             candidate.claim_token IS NULL
             OR candidate.claimed_at <= CURRENT_TIMESTAMP
               - ($5::BIGINT * INTERVAL '1 millisecond')
           )
         RETURNING outbox.*,
                   candidate.attempts AS previous_attempts,
                   candidate.last_error AS previous_last_error
       ),
       audit_row AS (
         INSERT INTO battle_terminal_outbox_redrives (
           outbox_event_id,
           event_key,
           previous_attempts,
           previous_last_error,
           actor,
           reason
         )
         SELECT id,
                event_key,
                previous_attempts,
                previous_last_error,
                $2,
                $3
         FROM redriven
         RETURNING id, redriven_at
       )
       SELECT candidate.attempts AS candidate_attempts,
              candidate.processed_at AS candidate_processed_at,
              candidate.claim_token AS candidate_claim_token,
              redriven.id AS redriven_id,
              redriven.*,
              audit_row.id AS audit_id,
              audit_row.redriven_at
       FROM candidate
       LEFT JOIN redriven ON redriven.id = candidate.id
       LEFT JOIN audit_row ON TRUE`,
      [
        normalizedEventKey,
        normalizedActor,
        normalizedReason,
        maxAttempts,
        claimLeaseMs
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BattleTerminalOutboxRedriveRejectedError(
        normalizedEventKey,
        'not_found'
      );
    }
    if (!row.redriven_id && row.candidate_processed_at) {
      throw new BattleTerminalOutboxRedriveRejectedError(
        normalizedEventKey,
        'processed'
      );
    }
    if (!row.redriven_id && row.candidate_attempts < maxAttempts) {
      throw new BattleTerminalOutboxRedriveRejectedError(
        normalizedEventKey,
        'not_exhausted'
      );
    }
    if (!row.redriven_id && row.candidate_claim_token) {
      throw new BattleTerminalOutboxRedriveRejectedError(
        normalizedEventKey,
        'actively_claimed'
      );
    }
    if (!row.redriven_id || !row.audit_id) {
      throw new Error(
        `Battle terminal outbox redrive did not complete for ${normalizedEventKey}`
      );
    }

    return {
      event: normalizeRow(row),
      audit: {
        id: row.audit_id,
        actor: normalizedActor,
        reason: normalizedReason,
        previousAttempts: row.previous_attempts,
        previousLastError: row.previous_last_error,
        redrivenAt: row.redriven_at
      }
    };
  }

  /**
   * Claim and dispatch at most one operational batch. Each event is leased
   * immediately before its handler runs so time spent on an earlier handler
   * cannot consume the lease of later events in the same drain.
   */
  async function drainBatch({ limit = batchSize } = {}) {
    requirePositiveInteger(limit, 'limit');
    const summary = {
      claimed: 0,
      processed: 0,
      failed: 0,
      exhausted: 0,
      errors: []
    };

    while (summary.claimed < limit) {
      const [event] = await claimPending({ limit: 1 });
      if (!event) break;
      summary.claimed += 1;

      const handler = registeredHandlers.get(event.eventType);
      let failure = null;

      if (!handler) {
        failure = new Error(
          `No battle terminal outbox handler registered for ${event.eventType}`
        );
      } else {
        try {
          await handler(event.payload, {
            event,
            eventKey: event.eventKey,
            battleId: event.battleId,
            eventType: event.eventType,
            attempt: event.attempts
          });
        } catch (error) {
          failure = error;
        }
      }

      if (!failure) {
        await markProcessed(event);
        summary.processed += 1;
        continue;
      }

      const retry = await markFailed(event, failure);
      summary.failed += 1;
      if (retry.exhausted) summary.exhausted += 1;
      summary.errors.push({
        eventKey: event.eventKey,
        eventType: event.eventType,
        error: errorMessage(failure),
        exhausted: retry.exhausted
      });
      logger?.error?.(
        `BattleTerminalOutbox eventKey=${event.eventKey} attempt=${event.attempts}`,
        failure
      );
    }

    return summary;
  }

  /**
   * Read persistent delivery health. Worker-local counters are useful for
   * trends, but these counts survive process restarts and expose exhausted
   * effects that require an operator to investigate and redrive.
   */
  async function getDeliveryStatus() {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (
           WHERE processed_at IS NULL AND attempts < $1
         ) AS pending,
         COUNT(*) FILTER (
           WHERE processed_at IS NULL
             AND attempts < $1
             AND next_attempt_at <= CURRENT_TIMESTAMP
         ) AS due,
         COUNT(*) FILTER (
           WHERE processed_at IS NULL AND claim_token IS NOT NULL
         ) AS claimed,
         COUNT(*) FILTER (
           WHERE processed_at IS NULL AND attempts >= $1
         ) AS exhausted,
         MIN(created_at) FILTER (
           WHERE processed_at IS NULL
         ) AS oldest_pending_at
       FROM battle_terminal_effect_outbox`,
      [maxAttempts]
    );
    const row = result.rows[0] ?? {};
    return {
      pending: Number(row.pending ?? 0),
      due: Number(row.due ?? 0),
      claimed: Number(row.claimed ?? 0),
      exhausted: Number(row.exhausted ?? 0),
      oldestPendingAt: row.oldest_pending_at ?? null,
      maxAttempts
    };
  }

  return Object.freeze({
    enqueue,
    registerHandler,
    claimPending,
    drainBatch,
    redriveExhausted,
    getDeliveryStatus
  });
}

export const battleTerminalOutbox = createBattleTerminalOutbox();
