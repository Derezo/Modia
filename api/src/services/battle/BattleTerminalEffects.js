import {
  analyzeBattleOutcome,
  checkAndAwardBadges
} from '../achievementService.js';
import { battleTerminalOutbox } from './BattleTerminalOutbox.js';
import {
  BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
  handleBattleTerminalProgression,
  validateBattleTerminalProgressionPayload
} from './BattleTerminalProgression.js';

export { BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE };

export const BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE =
  'battle.coliseum_badges.v1';

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function compareStrings(left, right) {
  const normalizedLeft = String(left);
  const normalizedRight = String(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}

function aggregateRecords(records, readKey, compareKeys) {
  const totals = new Map();
  for (const record of records) {
    const key = readKey(record);
    if (key === null || key === undefined || key === '') continue;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  }
  return [...totals]
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([key, count]) => ({ key, count }));
}

/**
 * Convert the exact reward input committed for a PvE victory into a compact,
 * canonical progression event. Aggregating here keeps the outbox payload
 * bounded and makes its identity independent of incidental unit/item order.
 *
 * Finding 41: Accept partyCharacterIds array so advancement progress applies
 * to all party members with active quests, not just the leader.
 */
export function buildPveTerminalProgressionPayload({
  battleId,
  partyLeaderId,
  partyCharacterIds = null,
  rewardsData,
  isAdvancementBattle = false,
  challengerCharacterId = null
}) {
  requireObject(rewardsData, 'rewardsData');
  const enemies = aggregateRecords(
    Array.isArray(rewardsData.enemies) ? rewardsData.enemies : [],
    enemy => enemy?.archetype || enemy?.type || enemy?.name || null,
    compareStrings
  ).map(({ key, count }) => ({ type: String(key), count }));
  const droppedItems = aggregateRecords(
    Array.isArray(rewardsData.droppedItems) ? rewardsData.droppedItems : [],
    item => item?.templateId ?? null,
    (left, right) => Number(left) - Number(right)
  ).map(({ key, count }) => ({
    templateId: Number(key),
    quantity: count
  }));
  const owners = new Set(
    (Array.isArray(rewardsData.players) ? rewardsData.players : [])
      .map(player => player?.ownerId ?? player?.userId)
      .filter(ownerId => ownerId !== null && ownerId !== undefined)
      .map(String)
  );
  const node = rewardsData.nodeId && rewardsData.nodeType
    ? {
      id: Number(rewardsData.nodeId),
      type: String(rewardsData.nodeType)
    }
    : null;
  const advancement = isAdvancementBattle && challengerCharacterId
    ? {
      challengerCharacterId: Number(challengerCharacterId),
      battleId: Number(battleId)
    }
    : null;

  // Finding 41: Include all party character IDs for advancement progress tracking
  // Fallback to [partyLeaderId] if not provided (backward compatibility)
  const effectivePartyIds = Array.isArray(partyCharacterIds) && partyCharacterIds.length > 0
    ? partyCharacterIds.map(Number)
    : [Number(partyLeaderId)];

  return validateBattleTerminalProgressionPayload({
    version: 1,
    kind: 'pve_victory',
    partyLeaderId: Number(partyLeaderId),
    partyCharacterIds: effectivePartyIds,
    enemies,
    droppedItems,
    node,
    difficultyTier: Number(rewardsData.difficultyTier ?? 1),
    gold: Number(rewardsData.gold ?? 0),
    isPartyBattle: owners.size > 1,
    advancement
  });
}

export function buildColiseumTerminalProgressionPayload({
  winnerCharacterId,
  queueType
}) {
  return validateBattleTerminalProgressionPayload({
    version: 1,
    kind: 'coliseum_victory',
    winnerCharacterId: Number(winnerCharacterId),
    queueType
  });
}

export function buildColiseumBadgePayload({
  winnerId,
  winnerRating,
  loserRating,
  winnerPPR,
  loserPPR,
  winnerNewRating,
  finalState
}) {
  const outcome = analyzeBattleOutcome(finalState);
  return validateColiseumBadgePayload({
    version: 1,
    winnerId: Number(winnerId),
    winnerRating,
    loserRating,
    winnerPPR,
    loserPPR,
    winnerNewRating,
    outcome
  });
}

export function validateColiseumBadgePayload(payload) {
  requireObject(payload, 'payload');
  if (payload.version !== 1) {
    throw new TypeError('payload.version must be 1');
  }
  requireObject(payload.outcome, 'payload.outcome');
  return {
    version: 1,
    winnerId: requirePositiveInteger(payload.winnerId, 'payload.winnerId'),
    winnerRating: requireFiniteNumber(
      payload.winnerRating,
      'payload.winnerRating'
    ),
    loserRating: requireFiniteNumber(
      payload.loserRating,
      'payload.loserRating'
    ),
    winnerPPR: requireFiniteNumber(payload.winnerPPR, 'payload.winnerPPR'),
    loserPPR: requireFiniteNumber(payload.loserPPR, 'payload.loserPPR'),
    winnerNewRating: requireFiniteNumber(
      payload.winnerNewRating,
      'payload.winnerNewRating'
    ),
    outcome: {
      flawless: requireBoolean(
        payload.outcome.flawless,
        'payload.outcome.flawless'
      ),
      comeback: requireBoolean(
        payload.outcome.comeback,
        'payload.outcome.comeback'
      )
    }
  };
}

export async function handleColiseumBadgeEffect(rawPayload) {
  const payload = validateColiseumBadgePayload(rawPayload);
  return checkAndAwardBadges(
    payload.winnerId,
    {
      winnerRating: payload.winnerRating,
      loserRating: payload.loserRating,
      winnerPPR: payload.winnerPPR,
      loserPPR: payload.loserPPR,
      winnerNewRating: payload.winnerNewRating,
      outcome: payload.outcome
    },
    { throwOnAwardError: true }
  );
}

/**
 * Register every durable terminal-effect handler before the worker starts.
 * registerHandler replaces an existing handler of the same type, so startup
 * remains safe under test harnesses that initialize the app more than once.
 */
export function registerBattleTerminalEffectHandlers(
  outbox = battleTerminalOutbox
) {
  if (!outbox || typeof outbox.registerHandler !== 'function') {
    throw new TypeError('outbox must expose registerHandler()');
  }
  const unregisterProgression = outbox.registerHandler(
    BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
    handleBattleTerminalProgression
  );
  const unregisterBadges = outbox.registerHandler(
    BATTLE_TERMINAL_COLISEUM_BADGES_EVENT_TYPE,
    handleColiseumBadgeEffect
  );
  return () => {
    unregisterProgression();
    unregisterBadges();
  };
}
