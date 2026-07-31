/**
 * Server-authoritative fishing.
 *
 * The client may choose owned gear and decide when to release/which direction
 * to press. Database time, cryptographic randomness, durable phase rows, and
 * UUID action receipts own every deadline and reward.
 */

import { createHash, randomInt, randomUUID } from 'node:crypto';
import { withTransaction } from '../config/database.js';
import { MAX_GOLD } from '../config/constants.js';
import { AppError } from '../middleware/errorHandler.js';
import { lockAgainstWorldMigration } from '../db/worldMigrationLock.js';
import {
  RODS,
  TACKLE,
  calculateFishValue,
  getPublicFishPool,
  getRodByKey,
  getTackleByKey,
  getWaitDurationMs,
  normalizeBiome,
  selectFishForCatch
} from '../db/templates/fish.js';
import * as dailyQuestService from './dailyQuestService.js';
import { incrementFishingMetric } from './fishingMetrics.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_COLUMNS = `
  session_id, user_id, node_id, node_name, status, started_at,
  last_catch_at, catches, total_value, big_one_active,
  big_one_expires_at, big_one_fish, collection_result, collected_at,
  selected_rod_key, selected_tackle_key, biome_key, biome_source,
  session_expires_at, updated_at
`;
const ATTEMPT_COLUMNS = `
  attempt_id, session_id, user_id, node_id, cast_request_id, phase,
  revision, cast_started_at, released_at, bite_at, hook_deadline,
  hooked_at, reel_deadline, resolved_at, cast_power, depth,
  is_big_catch, rod_key, rod_landing_rate, tackle_key,
  tackle_wait_reduction, reel_challenge, outcome, created_at, updated_at
`;
const ACTIVE_ATTEMPT_PHASES = ['cast', 'wait', 'bite', 'reel', 'resolve'];
const DIRECTIONS = ['left', 'up', 'right', 'down'];
const PUBLIC_CONFIG = Object.freeze({
  sessionDurationMs: 30 * 60 * 1000,
  castPowerDurationMs: 1600,
  hookWindowMs: 3000,
  normalReelDurationMs: 6000,
  hardReelDurationMs: 8000,
  normalCueCount: 3,
  hardCueCount: 4,
  normalRequiredHits: 2,
  hardRequiredHits: 3,
  bigCatchChance: 0.20,
  minWaitMs: 8000
});

let randomSource = () => randomInt(0, 1_000_000_000) / 1_000_000_000;

export function setFishingRandomSourceForTests(source) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Fishing RNG injection is test-only');
  }
  randomSource = typeof source === 'function'
    ? source
    : () => randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function random() {
  const value = Number(randomSource());
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(0.999999999, value));
}

function toDate(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toEpoch(value) {
  return toDate(value)?.getTime() ?? null;
}

function asJsonObject(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === 'object' ? value : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashFishingAction(actionType, userId, nodeId, payload) {
  return createHash('sha256')
    .update(canonicalJson({ actionType, userId, nodeId, payload }))
    .digest('hex');
}

function validateUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new AppError(`${label} must be a UUID`, 400);
  }
}

function requirePositiveNodeId(nodeId) {
  if (!Number.isSafeInteger(nodeId) || nodeId <= 0) {
    throw new AppError('Fishing node ID is invalid', 400);
  }
}

function transitionError(message, data = null) {
  incrementFishingMetric('invalidTransitions');
  throw new AppError(message, 409, data);
}

async function getDatabaseNow(client) {
  const result = await client.query('SELECT clock_timestamp() AS now');
  return toDate(result.rows[0]?.now) || new Date();
}

async function lockUser(client, userId) {
  const result = await client.query(
    'SELECT id, gold FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );
  if (!result.rows[0]) throw new AppError('User not found', 404);
  return result.rows[0];
}

async function lockPartyLeader(client, userId) {
  const result = await client.query(
    `SELECT id, current_node_id, in_battle
     FROM characters
     WHERE user_id = $1 AND party_slot = 1
     FOR NO KEY UPDATE`,
    [userId]
  );
  if (!result.rows[0]) {
    throw new AppError('No active party character', 400);
  }
  return result.rows[0];
}

async function loadFishingNode(client, nodeId) {
  const result = await client.query(
    `SELECT id, name, node_type, region_race,
            COALESCE(difficulty_tier, 1) AS difficulty_tier
     FROM world_nodes
     WHERE id = $1`,
    [nodeId]
  );
  const node = result.rows[0];
  if (!node) throw new AppError('Node not found', 404);
  if (node.node_type !== 'fishing_spot') {
    throw new AppError('This node is not a fishing spot', 400);
  }
  return node;
}

async function assertFishingLocation(client, userId, nodeId, leader = null) {
  const partyLeader = leader || await lockPartyLeader(client, userId);
  if (Number(partyLeader.current_node_id) !== Number(nodeId)) {
    throw new AppError('You must be at this fishing spot', 409);
  }

  await assertNotInBattle(client, userId, partyLeader);
  return partyLeader;
}

async function assertNotInBattle(client, userId, partyLeader) {
  const battleResult = await client.query(
    'SELECT 1 FROM characters WHERE user_id = $1 AND in_battle = TRUE LIMIT 1',
    [userId]
  );
  if (partyLeader.in_battle || battleResult.rows.length > 0) {
    throw new AppError('Cannot fish while in battle', 409);
  }
}

function sessionFromRow(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: Number(row.user_id),
    nodeId: Number(row.node_id),
    nodeName: row.node_name,
    status: row.status,
    startedAt: toDate(row.started_at),
    expiresAt: toDate(row.session_expires_at) ||
      new Date(toEpoch(row.started_at) + PUBLIC_CONFIG.sessionDurationMs),
    legacyCatches: Array.isArray(row.catches) ? row.catches : [],
    totalValue: Number(row.total_value) || 0,
    selectedRodKey: row.selected_rod_key || null,
    selectedTackleKey: row.selected_tackle_key || null,
    biome: normalizeBiome(row.biome_key || row.biome_source),
    biomeSource: row.biome_source || null,
    collectionResult: asJsonObject(row.collection_result),
    collectedAt: toDate(row.collected_at)
  };
}

function attemptFromRow(row) {
  if (!row) return null;
  return {
    attemptId: row.attempt_id,
    sessionId: row.session_id,
    userId: Number(row.user_id),
    nodeId: Number(row.node_id),
    castRequestId: row.cast_request_id,
    phase: row.phase,
    revision: Number(row.revision) || 0,
    castStartedAt: toDate(row.cast_started_at),
    releasedAt: toDate(row.released_at),
    biteAt: toDate(row.bite_at),
    hookDeadline: toDate(row.hook_deadline),
    hookedAt: toDate(row.hooked_at),
    reelDeadline: toDate(row.reel_deadline),
    resolvedAt: toDate(row.resolved_at),
    castPower: row.cast_power === null ? null : Number(row.cast_power),
    depth: row.depth || null,
    isBigCatch: row.is_big_catch === null ? null : row.is_big_catch === true,
    rodKey: row.rod_key,
    rodLandingRate: Number(row.rod_landing_rate) || 0,
    tackleKey: row.tackle_key || null,
    tackleWaitReduction: Number(row.tackle_wait_reduction) || 0,
    reelChallenge: asJsonObject(row.reel_challenge),
    outcome: asJsonObject(row.outcome)
  };
}

async function loadSessionForUpdate(client, userId, nodeId, sessionId) {
  validateUuid(sessionId, 'sessionId');
  const result = await client.query(
    `SELECT ${SESSION_COLUMNS}
     FROM user_fishing_sessions
     WHERE session_id = $1 AND user_id = $2 AND node_id = $3
     FOR UPDATE`,
    [sessionId, userId, nodeId]
  );
  if (!result.rows[0]) throw new AppError('Fishing session not found', 404);
  return sessionFromRow(result.rows[0]);
}

async function loadOutstandingSessionForUpdate(client, userId) {
  const result = await client.query(
    `SELECT ${SESSION_COLUMNS}
     FROM user_fishing_sessions
     WHERE user_id = $1 AND status IN ('active', 'expired')
     ORDER BY started_at
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  return sessionFromRow(result.rows[0]);
}

async function loadAttemptForUpdate(client, sessionId, attemptId) {
  validateUuid(attemptId, 'attemptId');
  const result = await client.query(
    `SELECT ${ATTEMPT_COLUMNS}
     FROM user_fishing_attempts
     WHERE attempt_id = $1 AND session_id = $2
     FOR UPDATE`,
    [attemptId, sessionId]
  );
  if (!result.rows[0]) throw new AppError('Fishing attempt not found', 404);
  return attemptFromRow(result.rows[0]);
}

async function loadCurrentAttempt(client, sessionId, { forUpdate = false } = {}) {
  const result = await client.query(
    `SELECT ${ATTEMPT_COLUMNS}
     FROM user_fishing_attempts
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [sessionId]
  );
  return attemptFromRow(result.rows[0]);
}

function rodCatalogKey(rod) {
  return rod?.catalogKey || rod?.catalog_key || rod?.key || null;
}

function tackleCatalogKey(tackle) {
  return tackle?.catalogKey || tackle?.catalog_key || tackle?.key || null;
}

function publicRod(rod) {
  if (!rod) return null;
  const landingRate = Number(
    rod.bigCatchRate ?? rod.bigCatchLandingRate ?? rod.landingRate ?? 0
  );
  return {
    key: rodCatalogKey(rod),
    name: rod.name,
    landingRate,
    landingRatePercent: Math.round(landingRate * 100),
    basePrice: Number(rod.basePrice) || 0,
    spriteId: rod.spriteId || rod.sprite_id || null
  };
}

function publicTackle(tackle) {
  if (!tackle) return null;
  const waitReduction = Number(tackle.waitReduction ?? tackle.reduction ?? 0);
  return {
    key: tackleCatalogKey(tackle),
    name: tackle.name,
    waitReduction,
    waitReductionPercent: Math.round(waitReduction * 100),
    basePrice: Number(tackle.basePrice) || 0,
    spriteId: tackle.spriteId || tackle.sprite_id || null
  };
}

async function loadOwnedGear(client, userId) {
  const result = await client.query(
    `SELECT item_templates.catalog_key, item_templates.item_type,
            item_templates.name, item_templates.sprite_id,
            COALESCE(SUM(character_items.quantity), 0)::INTEGER AS quantity
     FROM character_items
     JOIN item_templates
       ON item_templates.id = character_items.item_template_id
     WHERE character_items.user_id = $1
       AND character_items.character_id IS NULL
       AND character_items.equipped_slot IS NULL
       AND item_templates.catalog_key LIKE 'fishing:%'
     GROUP BY item_templates.id, item_templates.catalog_key,
              item_templates.item_type, item_templates.name,
              item_templates.sprite_id`,
    [userId]
  );

  const quantities = new Map(
    result.rows.map(row => [row.catalog_key, Number(row.quantity) || 0])
  );
  const ownedRods = RODS
    .map(rod => ({ ...publicRod(rod), owned: quantities.get(rodCatalogKey(rod)) || 0 }))
    .filter(rod => rod.owned > 0);
  const ownedTackle = TACKLE.map(tackle => ({
    ...publicTackle(tackle),
    quantity: quantities.get(tackleCatalogKey(tackle)) || 0
  }));

  return { quantities, ownedRods, ownedTackle };
}

async function consumeTackle(client, userId, tackleKey) {
  if (!tackleKey) return;
  const result = await client.query(
    `SELECT character_items.id, character_items.quantity
     FROM character_items
     JOIN item_templates
       ON item_templates.id = character_items.item_template_id
     WHERE character_items.user_id = $1
       AND character_items.character_id IS NULL
       AND character_items.equipped_slot IS NULL
       AND item_templates.catalog_key = $2
     ORDER BY character_items.id
     LIMIT 1
     FOR UPDATE OF character_items`,
    [userId, tackleKey]
  );
  const item = result.rows[0];
  if (!item || Number(item.quantity) < 1) {
    throw new AppError('Selected tackle is no longer in your inventory', 409);
  }
  if (Number(item.quantity) === 1) {
    await client.query('DELETE FROM character_items WHERE id = $1', [item.id]);
  } else {
    await client.query(
      'UPDATE character_items SET quantity = quantity - 1 WHERE id = $1',
      [item.id]
    );
  }
  incrementFishingMetric('tackleUsed');
}

async function beginActionReceipt(
  client,
  { userId, nodeId, actionId, actionType, payload }
) {
  validateUuid(actionId, 'actionId');
  const requestHash = hashFishingAction(actionType, userId, nodeId, payload);
  const inserted = await client.query(
    `INSERT INTO fishing_action_receipts
       (action_id, user_id, action_type, request_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (action_id) DO NOTHING
     RETURNING action_id`,
    [actionId, userId, actionType, requestHash]
  );
  if (inserted.rows.length > 0) {
    return { requestHash, retry: false, response: null };
  }

  const existing = await client.query(
    `SELECT user_id, action_type, request_hash, response_body
     FROM fishing_action_receipts
     WHERE action_id = $1
     FOR UPDATE`,
    [actionId]
  );
  const row = existing.rows[0];
  if (
    !row ||
    Number(row.user_id) !== Number(userId) ||
    row.action_type !== actionType ||
    row.request_hash !== requestHash
  ) {
    throw new AppError('actionId was already used with a different payload', 409);
  }
  if (!row.response_body) {
    throw new AppError('Fishing action is still being processed', 409);
  }
  return {
    requestHash,
    retry: true,
    response: asJsonObject(row.response_body)
  };
}

async function completeActionReceipt(client, actionId, response, status = 200) {
  await client.query(
    `UPDATE fishing_action_receipts
     SET response_status = $1,
         response_body = $2::JSONB,
         completed_at = clock_timestamp()
     WHERE action_id = $3`,
    [status, JSON.stringify(response), actionId]
  );
}

async function withFishingMutation(
  { userId, nodeId, actionId, actionType, payload, requireLocation = true },
  operation
) {
  requirePositiveNodeId(nodeId);
  return withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    const user = await lockUser(client, userId);
    const leader = await lockPartyLeader(client, userId);
    const node = await loadFishingNode(client, nodeId);
    const receipt = await beginActionReceipt(client, {
      userId,
      nodeId,
      actionId,
      actionType,
      payload
    });
    if (receipt.retry) {
      return receipt.response;
    }
    if (requireLocation) {
      await assertFishingLocation(client, userId, nodeId, leader);
    }
    const now = await getDatabaseNow(client);
    const response = await operation({ client, user, leader, node, now });
    await completeActionReceipt(client, actionId, response);
    return response;
  });
}

export function castPowerFromElapsed(elapsedMs) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return Math.max(0, Math.min(
    100,
    Math.floor((elapsed / PUBLIC_CONFIG.castPowerDurationMs) * 100)
  ));
}

export function depthFromCastPower(power) {
  const normalized = Math.max(0, Math.min(100, Number(power) || 0));
  if (normalized < 40) return 'near';
  if (normalized < 75) return 'mid';
  return 'deep';
}

export function fishingAttemptFitsSession({
  now,
  sessionExpiresAt,
  waitMs,
  reelDurationMs
}) {
  const startedAt = toEpoch(now);
  const expiresAt = toEpoch(sessionExpiresAt);
  if (startedAt === null || expiresAt === null) return false;
  const latestResolutionAt =
    startedAt +
    Math.max(0, Number(waitMs) || 0) +
    PUBLIC_CONFIG.hookWindowMs +
    Math.max(0, Number(reelDurationMs) || 0);
  return latestResolutionAt < expiresAt;
}

function buildReelChallenge(depth, isBigCatch) {
  const hard = depth === 'deep' || isBigCatch;
  const cueCount = hard
    ? PUBLIC_CONFIG.hardCueCount
    : PUBLIC_CONFIG.normalCueCount;
  const totalDurationMs = hard
    ? PUBLIC_CONFIG.hardReelDurationMs
    : PUBLIC_CONFIG.normalReelDurationMs;
  const cues = Array.from(
    { length: cueCount },
    () => DIRECTIONS[Math.floor(random() * DIRECTIONS.length)]
  );
  return {
    cues,
    nextCueIndex: 0,
    hits: 0,
    misses: 0,
    requiredHits: hard
      ? PUBLIC_CONFIG.hardRequiredHits
      : PUBLIC_CONFIG.normalRequiredHits,
    totalDurationMs,
    cueWindowMs: totalDurationMs / cueCount,
    startedAt: null,
    succeeded: null
  };
}

function publicAttempt(attempt) {
  if (!attempt) return null;
  const safe = {
    attemptId: attempt.attemptId,
    phase: attempt.phase,
    revision: attempt.revision,
    castStartedAt: toEpoch(attempt.castStartedAt),
    releasedAt: toEpoch(attempt.releasedAt),
    biteAt: toEpoch(attempt.biteAt),
    hookDeadline: toEpoch(attempt.hookDeadline),
    reelDeadline: toEpoch(attempt.reelDeadline),
    castPower: attempt.castPower,
    depth: attempt.depth
  };

  if (
    attempt.reelChallenge &&
    ['reel', 'resolve', 'resolved', 'cancelled'].includes(attempt.phase)
  ) {
    const challenge = attempt.reelChallenge;
    safe.reel = {
      cues: [...(challenge.cues || [])],
      nextCueIndex: Number(challenge.nextCueIndex) || 0,
      hits: Number(challenge.hits) || 0,
      misses: Number(challenge.misses) || 0,
      requiredHits: Number(challenge.requiredHits) || 0,
      totalDurationMs: Number(challenge.totalDurationMs) || 0,
      cueWindowMs: Number(challenge.cueWindowMs) || 0,
      startedAt: toEpoch(challenge.startedAt)
    };
  }
  if (['resolved', 'cancelled'].includes(attempt.phase) && attempt.outcome) {
    safe.outcome = attempt.outcome;
  }
  return safe;
}

async function writeAttemptPhase(
  client,
  attempt,
  { phase, challenge = attempt.reelChallenge, outcome = attempt.outcome, now }
) {
  const result = await client.query(
    `UPDATE user_fishing_attempts
     SET phase = $1::VARCHAR(16),
         revision = revision + 1,
         reel_challenge = $2::JSONB,
         outcome = $3::JSONB,
         resolved_at = CASE
           WHEN $1::VARCHAR(16) IN ('resolved', 'cancelled') THEN $4
           ELSE resolved_at
         END,
         updated_at = $4
     WHERE attempt_id = $5
     RETURNING ${ATTEMPT_COLUMNS}`,
    [
      phase,
      challenge ? JSON.stringify(challenge) : null,
      outcome ? JSON.stringify(outcome) : null,
      now,
      attempt.attemptId
    ]
  );
  return attemptFromRow(result.rows[0]);
}

async function advanceTimedAttempt(client, attempt, now) {
  if (!attempt) return null;
  const nowMs = now.getTime();

  if (attempt.phase === 'wait' && nowMs >= toEpoch(attempt.biteAt)) {
    if (nowMs <= toEpoch(attempt.hookDeadline)) {
      return writeAttemptPhase(client, attempt, { phase: 'bite', now });
    }
    incrementFishingMetric('missedHooks');
    return writeAttemptPhase(client, attempt, {
      phase: 'resolved',
      outcome: {
        result: 'missed_hook',
        awarded: false,
        resolvedAt: nowMs
      },
      now
    });
  }

  if (attempt.phase === 'bite' && nowMs > toEpoch(attempt.hookDeadline)) {
    incrementFishingMetric('missedHooks');
    return writeAttemptPhase(client, attempt, {
      phase: 'resolved',
      outcome: {
        result: 'missed_hook',
        awarded: false,
        resolvedAt: nowMs
      },
      now
    });
  }

  if (attempt.phase === 'reel' && nowMs > toEpoch(attempt.reelDeadline)) {
    const challenge = {
      ...attempt.reelChallenge,
      succeeded:
        Number(attempt.reelChallenge?.hits) >=
        Number(attempt.reelChallenge?.requiredHits)
    };
    if (!challenge.succeeded) incrementFishingMetric('reelFailures');
    return writeAttemptPhase(client, attempt, {
      phase: 'resolve',
      challenge,
      now
    });
  }

  return attempt;
}

async function loadBasket(client, session) {
  const result = await client.query(
    `SELECT fish_type, rarity, value, size_multiplier, is_big_catch,
            caught_at, attempt_id
     FROM user_fishing_catches
     WHERE session_id = $1
     ORDER BY caught_at, id`,
    [session.sessionId]
  );
  const durable = result.rows.map(row => ({
    fishId: row.fish_type,
    fishName: getPublicFishPool(session.biome)
      .find(fish => fish.id === row.fish_type)?.name || row.fish_type,
    rarity: row.rarity,
    value: Number(row.value) || 0,
    sizeMultiplier: Number(row.size_multiplier) || 1,
    isBigCatch: row.is_big_catch === true,
    timestamp: toEpoch(row.caught_at),
    attemptId: row.attempt_id
  }));
  const catches = [
    ...session.legacyCatches.map(catchRecord => ({ ...catchRecord })),
    ...durable
  ];
  return {
    catches,
    totalCatches: catches.length,
    totalValue: session.totalValue
  };
}

async function buildCommonState(
  client,
  { userId, node, session = null, attempt = null, now, settlement = null }
) {
  const owned = await loadOwnedGear(client, userId);
  const biome = session?.biome || normalizeBiome(node.region_race);
  const selectedRod = session?.selectedRodKey
    ? publicRod(getRodByKey(session.selectedRodKey))
    : null;
  const selectedTackle = session?.selectedTackleKey
    ? publicTackle(getTackleByKey(session.selectedTackleKey))
    : null;
  const basket = session
    ? await loadBasket(client, session)
    : { catches: [], totalCatches: 0, totalValue: 0 };

  return {
    success: true,
    serverTime: now.getTime(),
    config: PUBLIC_CONFIG,
    biome,
    publicFish: getPublicFishPool(biome),
    rods: RODS.map(publicRod),
    tackle: TACKLE.map(publicTackle),
    ownedRods: owned.ownedRods,
    ownedTackle: owned.ownedTackle,
    selectedRod,
    selectedTackle,
    session: session ? {
      active: session.status === 'active' && now < session.expiresAt,
      expired: now >= session.expiresAt || session.status === 'expired',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      nodeName: session.nodeName,
      status: session.status,
      startTime: session.startedAt.getTime(),
      expiresAt: session.expiresAt.getTime(),
      duration: Math.max(0, Math.floor(
        (now.getTime() - session.startedAt.getTime()) / 1000
      )),
      totalCatches: basket.totalCatches,
      totalValue: basket.totalValue,
      catches: basket.catches
    } : null,
    basket,
    attempt: publicAttempt(attempt),
    ...(settlement ? { settlement } : {})
  };
}

async function cancelUnfinishedAttempt(client, session, now, reason = 'packed_up') {
  let attempt = await loadCurrentAttempt(client, session.sessionId, {
    forUpdate: true
  });
  if (!attempt || !ACTIVE_ATTEMPT_PHASES.includes(attempt.phase)) return attempt;
  attempt = await writeAttemptPhase(client, attempt, {
    phase: 'cancelled',
    outcome: {
      result: reason,
      awarded: false,
      resolvedAt: now.getTime()
    },
    now
  });
  return attempt;
}

async function settleSession(client, { session, user, leader, now }) {
  if (session.status === 'collected' && session.collectionResult) {
    return { ...session.collectionResult, idempotent: true };
  }
  if (!['active', 'expired'].includes(session.status)) {
    transitionError('Fishing session cannot be collected');
  }

  await cancelUnfinishedAttempt(client, session, now);
  const basket = await loadBasket(client, session);
  const basketValue = Math.max(0, Number(session.totalValue) || 0);
  const startingGold = Math.max(0, Number(user.gold) || 0);
  const creditedGold = Math.max(0, Math.min(
    basketValue,
    MAX_GOLD - startingGold
  ));
  const overflowLost = Math.max(0, basketValue - creditedGold);
  const newGold = startingGold + creditedGold;

  if (creditedGold > 0) {
    await client.query(
      'UPDATE users SET gold = $1 WHERE id = $2',
      [newGold, session.userId]
    );
    await dailyQuestService.updateProgressWithClient(
      client,
      leader.id,
      'gold_earned',
      creditedGold,
      {},
      { notify: false }
    );
  }

  const catchesByRarity = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0
  };
  for (const catchRecord of basket.catches) {
    if (catchRecord.rarity) {
      catchesByRarity[catchRecord.rarity] =
        (catchesByRarity[catchRecord.rarity] || 0) + 1;
    }
  }

  const settlement = {
    success: true,
    idempotent: false,
    sessionId: session.sessionId,
    basketValue,
    creditedGold,
    overflowLost,
    newGold,
    summary: {
      duration: Math.max(0, Math.floor(
        (now.getTime() - session.startedAt.getTime()) / 1000
      )),
      totalCatches: basket.totalCatches,
      totalValue: basketValue,
      basketValue,
      creditedGold,
      overflowLost,
      catchesByRarity,
      catches: basket.catches
    },
    message: overflowLost > 0
      ? `Basket sold for ${basketValue} gold; ${creditedGold} credited and ${overflowLost} lost at the gold cap.`
      : `Basket sold for ${basketValue} gold.`
  };

  await client.query(
    `UPDATE user_fishing_sessions
     SET status = 'collected',
         collection_result = $1::JSONB,
         collected_at = $2,
         big_one_active = FALSE,
         big_one_expires_at = NULL,
         big_one_fish = NULL,
         updated_at = $2
     WHERE session_id = $3`,
    [JSON.stringify(settlement), now, session.sessionId]
  );

  incrementFishingMetric('settlements');
  incrementFishingMetric('settlementValue', basketValue);
  incrementFishingMetric('creditedGold', creditedGold);
  incrementFishingMetric('overflowGold', overflowLost);
  return settlement;
}

export async function getSetup(userId, nodeId) {
  requirePositiveNodeId(nodeId);
  return withTransaction(async client => {
    await lockPartyLeader(client, userId);
    const node = await loadFishingNode(client, nodeId);
    const now = await getDatabaseNow(client);
    const result = await client.query(
      `SELECT ${SESSION_COLUMNS}
       FROM user_fishing_sessions
       WHERE user_id = $1 AND node_id = $2
         AND status IN ('active', 'expired')
       ORDER BY started_at DESC
       LIMIT 1`,
      [userId, nodeId]
    );
    const session = sessionFromRow(result.rows[0]);
    let attempt = session
      ? await loadCurrentAttempt(client, session.sessionId, { forUpdate: true })
      : null;
    attempt = await advanceTimedAttempt(client, attempt, now);
    return buildCommonState(client, { userId, node, session, attempt, now });
  });
}

export async function startSession(userId, nodeId, options = {}) {
  const actionId = options.actionId;
  const requestedRodKey = options.rodKey || null;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'start',
    payload: { rodKey: requestedRodKey }
  }, async ({ client, user, leader, node, now }) => {
    const outstanding = await loadOutstandingSessionForUpdate(client, userId);
    if (outstanding) {
      const expired = now >= outstanding.expiresAt ||
        outstanding.status === 'expired';
      if (expired) {
        const settlement = await settleSession(client, {
          session: outstanding,
          user,
          leader,
          now
        });
        return buildCommonState(client, {
          userId,
          node,
          now,
          settlement: { ...settlement, outstanding: true }
        });
      }
      if (outstanding.nodeId !== nodeId) {
        throw new AppError(
          `You already have an active fishing session at ${outstanding.nodeName}`,
          409
        );
      }
      let attempt = await loadCurrentAttempt(client, outstanding.sessionId, {
        forUpdate: true
      });
      attempt = await advanceTimedAttempt(client, attempt, now);
      const state = await buildCommonState(client, {
        userId,
        node,
        session: outstanding,
        attempt,
        now
      });
      return {
        ...state,
        resumed: true,
        message: 'Fishing session resumed.'
      };
    }

    const gear = await loadOwnedGear(client, userId);
    let selectedRodKey = null;
    if (requestedRodKey) {
      const rod = getRodByKey(requestedRodKey);
      selectedRodKey = rodCatalogKey(rod);
      if (!rod || !selectedRodKey || !gear.quantities.get(selectedRodKey)) {
        throw new AppError('You do not own that fishing rod', 409);
      }
    }

    const sessionId = randomUUID();
    const biome = normalizeBiome(node.region_race);
    const expiresAt = new Date(now.getTime() + PUBLIC_CONFIG.sessionDurationMs);
    const inserted = await client.query(
      `INSERT INTO user_fishing_sessions
       (session_id, user_id, node_id, node_name, status, started_at,
        catches, total_value, big_one_active, selected_rod_key,
        selected_tackle_key, biome_key, biome_source, session_expires_at,
        updated_at)
       VALUES
       ($1, $2, $3, $4, 'active', $5, '[]'::JSONB, 0, FALSE, $6,
        NULL, $7, $8, $9, $5)
       RETURNING ${SESSION_COLUMNS}`,
      [
        sessionId,
        userId,
        nodeId,
        node.name,
        now,
        selectedRodKey,
        biome,
        node.region_race || null,
        expiresAt
      ]
    );
    const session = sessionFromRow(inserted.rows[0]);
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        now
      })),
      resumed: false,
      message: selectedRodKey
        ? 'Fishing session started.'
        : 'Fishing session started. Select an owned rod before casting.'
    };
  });
}

export async function selectGear(userId, nodeId, options = {}) {
  const {
    actionId,
    sessionId,
    rodKey = null,
    tackleKey = null
  } = options;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'gear',
    payload: { sessionId, rodKey, tackleKey }
  }, async ({ client, node, now }) => {
    let session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    if (session.status !== 'active' || now >= session.expiresAt) {
      transitionError('Fishing session has expired; pack up to collect');
    }
    const currentAttempt = await loadCurrentAttempt(client, session.sessionId, {
      forUpdate: true
    });
    if (currentAttempt && ACTIVE_ATTEMPT_PHASES.includes(currentAttempt.phase)) {
      transitionError('Gear cannot be changed during a cast');
    }

    const owned = await loadOwnedGear(client, userId);
    const rod = getRodByKey(rodKey);
    const canonicalRodKey = rodCatalogKey(rod);
    if (!rod || !canonicalRodKey || !owned.quantities.get(canonicalRodKey)) {
      throw new AppError('You do not own that fishing rod', 409);
    }

    let canonicalTackleKey = null;
    if (tackleKey) {
      const tackle = getTackleByKey(tackleKey);
      canonicalTackleKey = tackleCatalogKey(tackle);
      if (
        !tackle ||
        !canonicalTackleKey ||
        !owned.quantities.get(canonicalTackleKey)
      ) {
        throw new AppError('You do not own that tackle', 409);
      }
    }

    const result = await client.query(
      `UPDATE user_fishing_sessions
       SET selected_rod_key = $1,
           selected_tackle_key = $2,
           updated_at = $3
       WHERE session_id = $4
       RETURNING ${SESSION_COLUMNS}`,
      [canonicalRodKey, canonicalTackleKey, now, session.sessionId]
    );
    session = sessionFromRow(result.rows[0]);
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        attempt: currentAttempt,
        now
      })),
      message: 'Fishing gear selected.'
    };
  });
}

export async function startCast(userId, nodeId, options = {}) {
  const { actionId, sessionId } = options;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'cast',
    payload: { sessionId }
  }, async ({ client, node, now }) => {
    const session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    if (session.status !== 'active' || now >= session.expiresAt) {
      transitionError('Fishing session has expired; pack up to collect');
    }

    let previous = await loadCurrentAttempt(client, session.sessionId, {
      forUpdate: true
    });
    previous = await advanceTimedAttempt(client, previous, now);
    if (previous && ACTIVE_ATTEMPT_PHASES.includes(previous.phase)) {
      transitionError('Finish the current fishing attempt first', {
        attempt: publicAttempt(previous)
      });
    }

    const rod = getRodByKey(session.selectedRodKey);
    const rodKey = rodCatalogKey(rod);
    if (!rod || !rodKey) {
      throw new AppError('Select an owned fishing rod before casting', 409);
    }
    const owned = await loadOwnedGear(client, userId);
    if (!owned.quantities.get(rodKey)) {
      throw new AppError('Selected fishing rod is not in your inventory', 409);
    }
    if (
      session.selectedTackleKey &&
      !owned.quantities.get(session.selectedTackleKey)
    ) {
      throw new AppError('Selected tackle is not in your inventory', 409);
    }

    const attemptId = randomUUID();
    const landingRate = Number(
      rod.bigCatchRate ?? rod.bigCatchLandingRate ?? rod.landingRate ?? 0
    );
    const tackle = session.selectedTackleKey
      ? getTackleByKey(session.selectedTackleKey)
      : null;
    const reduction = Number(tackle?.waitReduction ?? tackle?.reduction ?? 0);
    const inserted = await client.query(
      `INSERT INTO user_fishing_attempts
       (attempt_id, session_id, user_id, node_id, cast_request_id, phase,
        revision, cast_started_at, rod_key, rod_landing_rate, tackle_key,
        tackle_wait_reduction, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'cast', 0, $6, $7, $8, $9, $10, $6, $6)
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        attemptId,
        session.sessionId,
        userId,
        nodeId,
        actionId,
        now,
        rodKey,
        landingRate,
        session.selectedTackleKey,
        reduction
      ]
    );
    const attempt = attemptFromRow(inserted.rows[0]);
    incrementFishingMetric('casts');
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      })),
      message: 'Cast power started.'
    };
  });
}

export async function releaseCast(userId, nodeId, attemptId, options = {}) {
  const { actionId, sessionId } = options;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'release',
    payload: { sessionId, attemptId }
  }, async ({ client, node, now }) => {
    const session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    if (session.status !== 'active' || now >= session.expiresAt) {
      transitionError('Fishing session has expired; pack up to collect');
    }
    let attempt = await loadAttemptForUpdate(client, session.sessionId, attemptId);
    if (attempt.phase !== 'cast') {
      transitionError('Cast has already been released', {
        attempt: publicAttempt(attempt)
      });
    }

    const power = castPowerFromElapsed(
      now.getTime() - attempt.castStartedAt.getTime()
    );
    const depth = depthFromCastPower(power);
    const waitMs = Math.max(
      PUBLIC_CONFIG.minWaitMs,
      Math.round(getWaitDurationMs(
        attempt.tackleKey,
        random,
        attempt.tackleWaitReduction
      ))
    );
    const biteAt = new Date(now.getTime() + waitMs);
    const hookDeadline = new Date(
      biteAt.getTime() + PUBLIC_CONFIG.hookWindowMs
    );
    const isBigCatch = random() < PUBLIC_CONFIG.bigCatchChance;
    const challenge = buildReelChallenge(depth, isBigCatch);
    if (!fishingAttemptFitsSession({
      now,
      sessionExpiresAt: session.expiresAt,
      waitMs,
      reelDurationMs: challenge.totalDurationMs
    })) {
      attempt = await writeAttemptPhase(client, attempt, {
        phase: 'cancelled',
        outcome: {
          result: 'session_expiring',
          awarded: false,
          tackleConsumed: false,
          resolvedAt: now.getTime()
        },
        now
      });
      return {
        ...(await buildCommonState(client, {
          userId,
          node,
          session,
          attempt,
          now
        })),
        message: 'There is not enough session time left for this cast. No tackle was consumed.'
      };
    }

    await consumeTackle(client, userId, attempt.tackleKey);
    const result = await client.query(
      `UPDATE user_fishing_attempts
       SET phase = 'wait',
           revision = revision + 1,
           released_at = $1,
           bite_at = $2,
           hook_deadline = $3,
           cast_power = $4,
           depth = $5,
           is_big_catch = $6,
           reel_challenge = $7::JSONB,
           updated_at = $1
       WHERE attempt_id = $8
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        now,
        biteAt,
        hookDeadline,
        power,
        depth,
        isBigCatch,
        JSON.stringify(challenge),
        attempt.attemptId
      ]
    );
    attempt = attemptFromRow(result.rows[0]);
    if (isBigCatch) {
      incrementFishingMetric('bigCatchTriggers', 1, {
        rodKey: attempt.rodKey
      });
    }
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      })),
      message: `Cast released into ${depth} water.`
    };
  });
}

export async function hookBite(userId, nodeId, attemptId, options = {}) {
  const { actionId, sessionId } = options;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'hook',
    payload: { sessionId, attemptId }
  }, async ({ client, node, now }) => {
    const session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    if (session.status !== 'active' || now >= session.expiresAt) {
      transitionError('Fishing session has expired; pack up to collect');
    }
    let attempt = await loadAttemptForUpdate(client, session.sessionId, attemptId);
    attempt = await advanceTimedAttempt(client, attempt, now);
    if (attempt.phase === 'resolved') {
      return {
        ...(await buildCommonState(client, {
          userId,
          node,
          session,
          attempt,
          now
        })),
        message: 'The bite was missed.'
      };
    }
    if (now < attempt.biteAt) {
      transitionError('There is no bite to hook yet');
    }
    if (!['wait', 'bite'].includes(attempt.phase)) {
      transitionError('Hook action is out of order', {
        attempt: publicAttempt(attempt)
      });
    }
    if (now > attempt.hookDeadline) {
      attempt = await advanceTimedAttempt(client, attempt, now);
      return buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      });
    }

    const challenge = {
      ...attempt.reelChallenge,
      startedAt: now.toISOString()
    };
    const reelDeadline = new Date(
      now.getTime() + Number(challenge.totalDurationMs)
    );
    const result = await client.query(
      `UPDATE user_fishing_attempts
       SET phase = 'reel',
           revision = revision + 1,
           hooked_at = $1,
           reel_deadline = $2,
           reel_challenge = $3::JSONB,
           updated_at = $1
       WHERE attempt_id = $4
       RETURNING ${ATTEMPT_COLUMNS}`,
      [now, reelDeadline, JSON.stringify(challenge), attempt.attemptId]
    );
    attempt = attemptFromRow(result.rows[0]);
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      })),
      message: 'Fish hooked. Follow the tension cues!'
    };
  });
}

export async function submitReelCue(
  userId,
  nodeId,
  attemptId,
  options = {}
) {
  const {
    actionId,
    sessionId,
    cueIndex,
    direction
  } = options;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'reel',
    payload: { sessionId, attemptId, cueIndex, direction }
  }, async ({ client, node, now }) => {
    const session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    if (session.status !== 'active' || now >= session.expiresAt) {
      transitionError('Fishing session has expired; pack up to collect');
    }
    let attempt = await loadAttemptForUpdate(client, session.sessionId, attemptId);
    attempt = await advanceTimedAttempt(client, attempt, now);
    if (attempt.phase !== 'reel') {
      transitionError('Reel action is out of order', {
        attempt: publicAttempt(attempt)
      });
    }
    if (!Number.isInteger(cueIndex) || cueIndex < 0) {
      throw new AppError('cueIndex must be a non-negative integer', 400);
    }
    if (!DIRECTIONS.includes(direction)) {
      throw new AppError('direction must be left, up, right, or down', 400);
    }

    const challenge = { ...attempt.reelChallenge };
    const cues = [...(challenge.cues || [])];
    let nextCueIndex = Number(challenge.nextCueIndex) || 0;
    if (cueIndex < nextCueIndex) {
      transitionError('That reel cue was already answered');
    }
    const startedAt = toDate(challenge.startedAt);
    const elapsedMs = now.getTime() - startedAt.getTime();
    const currentCueIndex = Math.min(
      cues.length - 1,
      Math.floor(elapsedMs / Number(challenge.cueWindowMs))
    );
    if (currentCueIndex < 0 || cueIndex > currentCueIndex) {
      transitionError('That reel cue is not active yet');
    }
    if (currentCueIndex > nextCueIndex) {
      challenge.misses = (Number(challenge.misses) || 0) +
        (currentCueIndex - nextCueIndex);
      nextCueIndex = currentCueIndex;
    }
    if (cueIndex !== nextCueIndex) {
      transitionError('Reel cues must be answered in order');
    }

    if (direction === cues[cueIndex]) {
      challenge.hits = (Number(challenge.hits) || 0) + 1;
    } else {
      challenge.misses = (Number(challenge.misses) || 0) + 1;
    }
    challenge.nextCueIndex = cueIndex + 1;

    let phase = 'reel';
    if (challenge.nextCueIndex >= cues.length) {
      challenge.succeeded =
        Number(challenge.hits) >= Number(challenge.requiredHits);
      phase = 'resolve';
      if (!challenge.succeeded) incrementFishingMetric('reelFailures');
    }
    attempt = await writeAttemptPhase(client, attempt, {
      phase,
      challenge,
      now
    });
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      })),
      cueResult: direction === cues[cueIndex] ? 'hit' : 'miss',
      message: phase === 'resolve'
        ? 'Reeling complete.'
        : 'Tension cue recorded.'
    };
  });
}

export async function resolveAttempt(
  userId,
  nodeId,
  attemptId,
  options = {}
) {
  const { actionId, sessionId } = options;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'resolve',
    payload: { sessionId, attemptId }
  }, async ({ client, leader, node, now }) => {
    let session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    let attempt = await loadAttemptForUpdate(client, session.sessionId, attemptId);
    const reachedResolveBeforeExpiry = attempt.phase === 'resolve';
    if (
      (session.status !== 'active' || now >= session.expiresAt) &&
      !reachedResolveBeforeExpiry
    ) {
      transitionError('Fishing session has expired; pack up to collect');
    }
    attempt = await advanceTimedAttempt(client, attempt, now);
    if (attempt.phase === 'resolved') {
      return buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      });
    }
    if (attempt.phase !== 'resolve') {
      transitionError('Fishing attempt is not ready to resolve', {
        attempt: publicAttempt(attempt)
      });
    }

    const interactionSucceeded = attempt.reelChallenge?.succeeded === true;
    if (!interactionSucceeded) {
      attempt = await writeAttemptPhase(client, attempt, {
        phase: 'resolved',
        outcome: {
          result: 'reel_failed',
          awarded: false,
          resolvedAt: now.getTime()
        },
        now
      });
      return {
        ...(await buildCommonState(client, {
          userId,
          node,
          session,
          attempt,
          now
        })),
        message: 'The fish escaped during the reel.'
      };
    }

    if (attempt.isBigCatch && random() >= attempt.rodLandingRate) {
      attempt = await writeAttemptPhase(client, attempt, {
        phase: 'resolved',
        outcome: {
          result: 'big_catch_escaped',
          awarded: false,
          isBigCatch: true,
          rodKey: attempt.rodKey,
          landingRate: attempt.rodLandingRate,
          resolvedAt: now.getTime()
        },
        now
      });
      return {
        ...(await buildCommonState(client, {
          userId,
          node,
          session,
          attempt,
          now
        })),
        message: 'The Big Catch broke free. No fallback fish was awarded.'
      };
    }

    const fish = selectFishForCatch({
      biome: session.biome,
      depth: attempt.depth,
      isBigCatch: attempt.isBigCatch,
      random
    });
    if (!fish) throw new Error('Fishing catalog returned no eligible fish');
    const sizeMin = attempt.isBigCatch ? 1.3 : 0.8;
    const sizeMax = attempt.isBigCatch ? 1.7 : 1.5;
    const sizeMultiplier = Number(
      (sizeMin + (random() * (sizeMax - sizeMin))).toFixed(2)
    );
    const value = calculateFishValue(
      fish,
      sizeMultiplier,
      attempt.isBigCatch,
      Number(node.difficulty_tier) || 1
    );
    const insertedCatch = await client.query(
      `INSERT INTO user_fishing_catches
       (user_id, node_id, fish_type, quantity, caught_at, session_id,
        attempt_id, rarity, value, size_multiplier, is_big_catch)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (attempt_id) WHERE attempt_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        userId,
        nodeId,
        fish.id,
        now,
        session.sessionId,
        attempt.attemptId,
        fish.rarity,
        value,
        sizeMultiplier,
        attempt.isBigCatch
      ]
    );
    if (insertedCatch.rows.length !== 1) {
      throw new Error('Fishing catch already exists without a stored outcome');
    }

    await client.query(
      `UPDATE user_fishing_sessions
       SET total_value = total_value + $1,
           last_catch_at = $2,
           updated_at = $2
       WHERE session_id = $3`,
      [value, now, session.sessionId]
    );
    await dailyQuestService.updateProgressWithClient(
      client,
      leader.id,
      'fish_catches',
      1,
      {
        rarity: fish.rarity,
        ...(attempt.isBigCatch ? { isBigOne: true, isBigCatch: true } : {})
      },
      { notify: false }
    );

    const catchRecord = {
      fishId: fish.id,
      fishName: fish.name,
      rarity: fish.rarity,
      value,
      sizeMultiplier,
      isBigCatch: attempt.isBigCatch,
      timestamp: now.getTime(),
      attemptId: attempt.attemptId
    };
    attempt = await writeAttemptPhase(client, attempt, {
      phase: 'resolved',
      outcome: {
        result: 'caught',
        awarded: true,
        isBigCatch: attempt.isBigCatch,
        catch: catchRecord,
        resolvedAt: now.getTime()
      },
      now
    });
    if (attempt.isBigCatch) {
      incrementFishingMetric('bigCatchLands', 1, { rodKey: attempt.rodKey });
    }
    const refreshedSession = await client.query(
      `SELECT ${SESSION_COLUMNS}
       FROM user_fishing_sessions
       WHERE session_id = $1`,
      [session.sessionId]
    );
    session = sessionFromRow(refreshedSession.rows[0]);
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        session,
        attempt,
        now
      })),
      catch: catchRecord,
      message: `Caught ${fish.name}!`
    };
  });
}

export async function endSession(userId, nodeId, sessionId, options = {}) {
  const actionId = options.actionId;
  return withFishingMutation({
    userId,
    nodeId,
    actionId,
    actionType: 'end',
    payload: { sessionId },
    requireLocation: false
  }, async ({ client, user, leader, node, now }) => {
    const session = await loadSessionForUpdate(client, userId, nodeId, sessionId);
    await assertNotInBattle(client, userId, leader);
    const settlement = await settleSession(client, {
      session,
      user,
      leader,
      now
    });
    return {
      ...(await buildCommonState(client, {
        userId,
        node,
        now,
        settlement
      })),
      settlement,
      ...settlement
    };
  });
}

async function readSessionStatus(userId, nodeId = null) {
  const params = [userId];
  const nodeFilter = nodeId === null ? '' : 'AND node_id = $2';
  if (nodeId !== null) params.push(nodeId);
  return withTransaction(async client => {
    const now = await getDatabaseNow(client);
    const result = await client.query(
      `SELECT ${SESSION_COLUMNS}
       FROM user_fishing_sessions
       WHERE user_id = $1
         ${nodeFilter}
         AND status IN ('active', 'expired')
       ORDER BY started_at DESC
       LIMIT 1
       FOR UPDATE`,
      params
    );
    const session = sessionFromRow(result.rows[0]);
    if (!session) return null;
    const node = await loadFishingNode(client, session.nodeId);
    let attempt = await loadCurrentAttempt(client, session.sessionId, {
      forUpdate: true
    });
    attempt = await advanceTimedAttempt(client, attempt, now);
    return buildCommonState(client, {
      userId,
      node,
      session,
      attempt,
      now
    });
  });
}

export async function getSessionStatus(userId, nodeId) {
  requirePositiveNodeId(nodeId);
  return readSessionStatus(userId, nodeId);
}

export async function getActiveSessionStatus(userId) {
  return readSessionStatus(userId);
}

export async function registerCatch() {
  throw new AppError(
    'The legacy fishing catch endpoint is gone. Upgrade to the cast protocol.',
    410
  );
}

export async function claimBigOne() {
  throw new AppError(
    'The legacy Big One endpoint is gone. Upgrade to the reel protocol.',
    410
  );
}

export async function cleanupExpiredSessions() {
  await withTransaction(async client => {
    await lockAgainstWorldMigration(client);
    await client.query(
      `UPDATE user_fishing_sessions
       SET status = 'expired',
           big_one_active = FALSE,
           big_one_expires_at = NULL,
           big_one_fish = NULL,
           updated_at = clock_timestamp()
       WHERE status = 'active'
         AND session_expires_at <= clock_timestamp()`
    );
  });
}

let cleanupInterval = null;

export function startCleanupScheduler() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupExpiredSessions().catch(error => {
      console.warn('[Fishing] Failed to mark expired sessions:', error.message);
    });
  }, 5 * 60 * 1000);
  cleanupInterval.unref();
}

export function stopCleanupScheduler() {
  if (!cleanupInterval) return;
  clearInterval(cleanupInterval);
  cleanupInterval = null;
}

startCleanupScheduler();

export { PUBLIC_CONFIG as AUTHORITATIVE_FISHING_CONFIG };
