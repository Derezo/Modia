import { withTransaction as databaseWithTransaction } from '../../config/database.js';
import * as dailyQuestService from '../dailyQuestService.js';
import * as advancementQuestService from '../advancementQuestService.js';

export const BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE = 'battle.progression.v1';

const EVENT_KEY_MAX_LENGTH = 255;
const TYPE_MAX_LENGTH = 96;

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireString(value, name, maxLength = TYPE_MAX_LENGTH) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new TypeError(`${name} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function requireBoolean(value, name) {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function requireArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`);
  }
  return value;
}

function normalizePartyCharacterIds(payload) {
  // Finding 41: Accept partyCharacterIds for advancement progress on all party members.
  // Older outbox rows have none; applyMutations falls back to [partyLeaderId].
  if (payload.partyCharacterIds === null || payload.partyCharacterIds === undefined) {
    return null;
  }
  const ids = requireArray(payload.partyCharacterIds, 'payload.partyCharacterIds');
  return ids.map((id, index) =>
    requirePositiveInteger(id, `payload.partyCharacterIds[${index}]`)
  );
}

function normalizePvePayload(payload) {
  const enemies = requireArray(payload.enemies, 'payload.enemies').map(
    (enemy, index) => {
      requireObject(enemy, `payload.enemies[${index}]`);
      return {
        type: requireString(enemy.type, `payload.enemies[${index}].type`),
        count: requirePositiveInteger(
          enemy.count,
          `payload.enemies[${index}].count`
        )
      };
    }
  );
  const droppedItems = requireArray(
    payload.droppedItems,
    'payload.droppedItems'
  ).map((item, index) => {
    requireObject(item, `payload.droppedItems[${index}]`);
    return {
      templateId: requirePositiveInteger(
        item.templateId,
        `payload.droppedItems[${index}].templateId`
      ),
      quantity: requirePositiveInteger(
        item.quantity,
        `payload.droppedItems[${index}].quantity`
      )
    };
  });

  let node = null;
  if (payload.node !== null) {
    requireObject(payload.node, 'payload.node');
    node = {
      id: requirePositiveInteger(payload.node.id, 'payload.node.id'),
      type: requireString(payload.node.type, 'payload.node.type')
    };
  }

  let advancement = null;
  if (payload.advancement !== null) {
    requireObject(payload.advancement, 'payload.advancement');
    advancement = {
      challengerCharacterId: requirePositiveInteger(
        payload.advancement.challengerCharacterId,
        'payload.advancement.challengerCharacterId'
      ),
      battleId: requirePositiveInteger(
        payload.advancement.battleId,
        'payload.advancement.battleId'
      )
    };
  }

  const partyLeaderId = requirePositiveInteger(
    payload.partyLeaderId,
    'payload.partyLeaderId'
  );
  const partyCharacterIds = normalizePartyCharacterIds(payload);

  return {
    version: 1,
    kind: 'pve_victory',
    partyLeaderId,
    // Finding 41: include partyCharacterIds only when the event carried them.
    // Synthesising [partyLeaderId] here would change the normalized shape, so
    // a receipt stored before partyCharacterIds existed would no longer match
    // (payload = $2::JSONB) and a replay or redrive would throw a key
    // conflict. applyMutations applies the leader fallback instead.
    ...(partyCharacterIds ? { partyCharacterIds } : {}),
    enemies,
    droppedItems,
    node,
    difficultyTier: requirePositiveInteger(
      payload.difficultyTier,
      'payload.difficultyTier'
    ),
    gold: requireNonNegativeInteger(payload.gold, 'payload.gold'),
    isPartyBattle: requireBoolean(payload.isPartyBattle, 'payload.isPartyBattle'),
    advancement
  };
}

function normalizeColiseumPayload(payload) {
  return {
    version: 1,
    kind: 'coliseum_victory',
    winnerCharacterId: requirePositiveInteger(
      payload.winnerCharacterId,
      'payload.winnerCharacterId'
    ),
    queueType: requireString(payload.queueType, 'payload.queueType')
  };
}

export function validateBattleTerminalProgressionPayload(payload) {
  requireObject(payload, 'payload');
  if (payload.version !== 1) {
    throw new TypeError('payload.version must be 1');
  }
  if (payload.kind === 'pve_victory') {
    return normalizePvePayload(payload);
  }
  if (payload.kind === 'coliseum_victory') {
    return normalizeColiseumPayload(payload);
  }
  throw new TypeError(
    'payload.kind must be "pve_victory" or "coliseum_victory"'
  );
}

function aggregateBy(items, keyName, valueName) {
  const totals = new Map();
  for (const item of items) {
    totals.set(item[keyName], (totals.get(item[keyName]) || 0) + item[valueName]);
  }
  return totals;
}

export function createBattleTerminalProgression({
  withTransaction = databaseWithTransaction,
  dailyQuests = dailyQuestService,
  advancementQuests = advancementQuestService
} = {}) {
  if (typeof withTransaction !== 'function') {
    throw new TypeError('withTransaction must be a function');
  }

  async function applyMutations(client, payload) {
    if (payload.kind === 'coliseum_victory') {
      await dailyQuests.updateProgressWithClient(
        client,
        payload.winnerCharacterId,
        'coliseum_wins',
        1,
        { queueType: payload.queueType },
        { notify: false }
      );
      return { kind: payload.kind, advancementComplete: null };
    }

    // Finding 41: Apply advancement quest progress to ALL party members, not just leader.
    // Each party member may have an active advancement quest that should progress.
    // The update functions are idempotent for characters without active quests.
    const partyIds = payload.partyCharacterIds || [payload.partyLeaderId];

    for (const characterId of partyIds) {
      for (const [enemyType, count] of aggregateBy(
        payload.enemies,
        'type',
        'count'
      )) {
        await advancementQuests.updateEnemyProgressWithClient(
          client,
          characterId,
          enemyType,
          count
        );
      }

      if (payload.node) {
        await advancementQuests.updateNodeProgressWithClient(
          client,
          characterId,
          payload.node.id,
          payload.node.type
        );
      }

      for (const [templateId, quantity] of aggregateBy(
        payload.droppedItems,
        'templateId',
        'quantity'
      )) {
        await advancementQuests.updateMaterialProgressWithClient(
          client,
          characterId,
          templateId,
          quantity
        );
      }
    }

    // Daily quest updates still go to the party leader only
    const dailyUpdates = [
      ['kill_enemies', payload.enemies.reduce((sum, enemy) => sum + enemy.count, 0), {}],
      ['complete_battles', 1, { tier: payload.difficultyTier }]
    ];
    if (payload.gold > 0) {
      dailyUpdates.push(['gold_earned', payload.gold, {}]);
    }
    if (payload.isPartyBattle) {
      dailyUpdates.push(['party_battles', 1, {}]);
    }
    for (const [objectiveType, amount, metadata] of dailyUpdates) {
      if (amount > 0) {
        await dailyQuests.updateProgressWithClient(
          client,
          payload.partyLeaderId,
          objectiveType,
          amount,
          metadata,
          { notify: false }
        );
      }
    }

    const advancementComplete = payload.advancement
      ? await advancementQuests.completeQuestWithClient(
        client,
        payload.advancement.challengerCharacterId,
        payload.advancement.battleId
      )
      : null;

    return { kind: payload.kind, advancementComplete };
  }

  async function apply(eventKey, rawPayload) {
    const normalizedEventKey = requireString(
      eventKey,
      'eventKey',
      EVENT_KEY_MAX_LENGTH
    );
    const payload = validateBattleTerminalProgressionPayload(rawPayload);
    const serializedPayload = JSON.stringify(payload);

    return withTransaction(async client => {
      const receipt = await client.query(
        `INSERT INTO battle_terminal_progression_receipts (
           event_key,
           event_kind,
           payload,
           result
         )
         VALUES ($1, $2, $3::JSONB, '{}'::JSONB)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING event_key`,
        [normalizedEventKey, payload.kind, serializedPayload]
      );

      if (receipt.rows.length === 0) {
        const existing = await client.query(
          `SELECT event_kind,
                  payload = $2::JSONB AS payload_matches,
                  result
           FROM battle_terminal_progression_receipts
           WHERE event_key = $1`,
          [normalizedEventKey, serializedPayload]
        );
        const row = existing.rows[0];
        if (!row || row.event_kind !== payload.kind || !row.payload_matches) {
          throw new Error(
            `Battle terminal progression event key conflict: ${normalizedEventKey}`
          );
        }
        return row.result;
      }

      const result = await applyMutations(client, payload);
      await client.query(
        `UPDATE battle_terminal_progression_receipts
         SET result = $2::JSONB
         WHERE event_key = $1`,
        [normalizedEventKey, JSON.stringify(result)]
      );
      return result;
    });
  }

  async function handler(payload, context) {
    if (!context || typeof context !== 'object') {
      throw new TypeError('context must be an object');
    }
    if (
      payload?.advancement !== null &&
      payload?.advancement !== undefined &&
      context.battleId !== undefined &&
      payload.advancement.battleId !== context.battleId
    ) {
      throw new Error('Advancement battle ID does not match outbox context');
    }
    return apply(context.eventKey, payload);
  }

  return { apply, handler };
}

const defaultProgression = createBattleTerminalProgression();

export const applyBattleTerminalProgression = defaultProgression.apply;
export const handleBattleTerminalProgression = defaultProgression.handler;

export default handleBattleTerminalProgression;
