import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
  createBattleTerminalProgression,
  validateBattleTerminalProgressionPayload
} from '../../services/battle/BattleTerminalProgression.js';

const pvePayload = (overrides = {}) => ({
  version: 1,
  kind: 'pve_victory',
  partyLeaderId: 7,
  enemies: [
    { type: 'goblin', count: 2 },
    { type: 'goblin', count: 1 },
    { type: 'orc', count: 1 }
  ],
  droppedItems: [
    { templateId: 11, quantity: 1 },
    { templateId: 11, quantity: 2 }
  ],
  node: { id: 19, type: 'forest' },
  difficultyTier: 3,
  gold: 50,
  isPartyBattle: true,
  advancement: null,
  ...overrides
});

function createTransactionHarness() {
  const receipts = new Map();
  const transactions = [];

  const withTransaction = async callback => {
    const staged = new Map(receipts);
    const client = {
      async query(sql, params) {
        if (sql.includes('INSERT INTO battle_terminal_progression_receipts')) {
          const [eventKey, eventKind, payload] = params;
          if (staged.has(eventKey)) return { rows: [] };
          staged.set(eventKey, {
            event_kind: eventKind,
            payload: JSON.parse(payload),
            result: {}
          });
          return { rows: [{ event_key: eventKey }] };
        }
        if (sql.includes('SELECT event_kind')) {
          const row = staged.get(params[0]);
          return {
            rows: row
              ? [{
                  event_kind: row.event_kind,
                  payload_matches:
                    JSON.stringify(row.payload) ===
                    JSON.stringify(JSON.parse(params[1])),
                  result: row.result
                }]
              : []
          };
        }
        if (sql.includes('UPDATE battle_terminal_progression_receipts')) {
          staged.get(params[0]).result = JSON.parse(params[1]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected receipt query: ${sql}`);
      }
    };
    transactions.push(client);
    const result = await callback(client);
    receipts.clear();
    for (const [key, value] of staged) receipts.set(key, value);
    return result;
  };

  return { receipts, transactions, withTransaction };
}

function createQuestMocks({ failDailyOnce = false } = {}) {
  const calls = [];
  let shouldFailDaily = failDailyOnce;
  const record = (operation, client, args) => {
    calls.push({ operation, client, args });
  };
  const dailyQuests = {
    async updateProgressWithClient(client, ...args) {
      record('daily', client, args);
      if (shouldFailDaily) {
        shouldFailDaily = false;
        throw new Error('daily mutation failed');
      }
    }
  };
  const advancementQuests = {
    async updateEnemyProgressWithClient(client, ...args) {
      record('enemy', client, args);
      return true;
    },
    async updateNodeProgressWithClient(client, ...args) {
      record('node', client, args);
      return true;
    },
    async updateMaterialProgressWithClient(client, ...args) {
      record('material', client, args);
      return true;
    },
    async completeQuestWithClient(client, ...args) {
      record('complete', client, args);
      return { success: true, newClass: 'paladin', rewards: { gold: 10 } };
    }
  };
  return { advancementQuests, calls, dailyQuests };
}

describe('BattleTerminalProgression', () => {
  it('exposes the stable outbox event type', () => {
    assert.equal(
      BATTLE_TERMINAL_PROGRESSION_EVENT_TYPE,
      'battle.progression.v1'
    );
  });

  it('applies aggregated PvE mutations once and returns the stored outcome', async () => {
    const transactions = createTransactionHarness();
    const quests = createQuestMocks();
    const progression = createBattleTerminalProgression({
      withTransaction: transactions.withTransaction,
      ...quests
    });

    const first = await progression.apply('battle:42:battle.progression.v1', pvePayload({
      advancement: { challengerCharacterId: 8, battleId: 42 }
    }));
    const duplicate = await progression.handler(
      pvePayload({ advancement: { challengerCharacterId: 8, battleId: 42 } }),
      { eventKey: 'battle:42:battle.progression.v1' }
    );

    assert.deepEqual(duplicate, first);
    assert.equal(transactions.receipts.size, 1);
    assert.equal(quests.calls.filter(call => call.operation === 'enemy').length, 2);
    assert.deepEqual(
      quests.calls.filter(call => call.operation === 'enemy').map(call => call.args),
      [[7, 'goblin', 3], [7, 'orc', 1]]
    );
    assert.deepEqual(
      quests.calls.find(call => call.operation === 'material').args,
      [7, 11, 3]
    );
    assert.deepEqual(
      quests.calls.filter(call => call.operation === 'daily').map(call => call.args),
      [
        [7, 'kill_enemies', 4, {}, { notify: false }],
        [7, 'complete_battles', 1, { tier: 3 }, { notify: false }],
        [7, 'gold_earned', 50, {}, { notify: false }],
        [7, 'party_battles', 1, {}, { notify: false }]
      ]
    );
    assert.equal(quests.calls.filter(call => call.operation === 'complete').length, 1);
    assert.deepEqual(
      quests.calls.find(call => call.operation === 'complete').args,
      [8, 42]
    );
    assert.ok(
      quests.calls.every(call => call.client === transactions.transactions[0]),
      'every first-delivery mutation must use the receipt transaction client'
    );
  });

  it('rolls the receipt back with a failed mutation and succeeds on retry', async () => {
    const transactions = createTransactionHarness();
    const quests = createQuestMocks({ failDailyOnce: true });
    const progression = createBattleTerminalProgression({
      withTransaction: transactions.withTransaction,
      ...quests
    });

    await assert.rejects(
      progression.apply('battle:43:battle.progression.v1', pvePayload()),
      /daily mutation failed/
    );
    assert.equal(transactions.receipts.size, 0);

    const result = await progression.apply(
      'battle:43:battle.progression.v1',
      pvePayload()
    );
    assert.equal(result.kind, 'pve_victory');
    assert.equal(transactions.receipts.size, 1);
  });

  it('applies Coliseum win progress and rejects event-key payload conflicts', async () => {
    const transactions = createTransactionHarness();
    const quests = createQuestMocks();
    const progression = createBattleTerminalProgression({
      withTransaction: transactions.withTransaction,
      ...quests
    });
    const eventKey = 'battle:44:battle.progression.v1';

    await progression.apply(eventKey, {
      version: 1,
      kind: 'coliseum_victory',
      winnerCharacterId: 22,
      queueType: 'ranked'
    });
    assert.deepEqual(quests.calls[0].args, [
      22,
      'coliseum_wins',
      1,
      { queueType: 'ranked' },
      { notify: false }
    ]);
    await assert.rejects(
      progression.apply(eventKey, {
        version: 1,
        kind: 'coliseum_victory',
        winnerCharacterId: 23,
        queueType: 'ranked'
      }),
      /event key conflict/
    );
  });

  it('replays a receipt stored before partyCharacterIds existed', async () => {
    const transactions = createTransactionHarness();
    const quests = createQuestMocks();
    const progression = createBattleTerminalProgression({
      withTransaction: transactions.withTransaction,
      ...quests
    });
    // A receipt written by the pre-Finding-41 normalizer: no partyCharacterIds key
    const legacyPayload = pvePayload();
    const storedResult = { kind: 'pve_victory', advancementComplete: null };
    transactions.receipts.set('battle:77:battle.progression.v1', {
      event_kind: 'pve_victory',
      payload: legacyPayload,
      result: storedResult
    });

    const replayed = await progression.apply('battle:77:battle.progression.v1', pvePayload());

    assert.deepEqual(replayed, storedResult);
    assert.equal(quests.calls.length, 0, 'a replay must not re-apply mutations');
    assert.equal(
      'partyCharacterIds' in validateBattleTerminalProgressionPayload(pvePayload()),
      false
    );
  });

  it('applies the leader fallback when partyCharacterIds is absent', async () => {
    const transactions = createTransactionHarness();
    const quests = createQuestMocks();
    const progression = createBattleTerminalProgression({
      withTransaction: transactions.withTransaction,
      ...quests
    });
    await progression.apply('battle:78:battle.progression.v1', pvePayload());
    assert.deepEqual(
      [...new Set(quests.calls.filter(call => call.operation === 'enemy').map(call => call.args[0]))],
      [7]
    );
  });

  it('validates terminal payloads before opening a transaction', () => {
    assert.throws(
      () => validateBattleTerminalProgressionPayload(
        pvePayload({ enemies: [{ type: '', count: 1 }] })
      ),
      /non-empty string/
    );
    assert.throws(
      () => validateBattleTerminalProgressionPayload(
        pvePayload({ gold: -1 })
      ),
      /non-negative safe integer/
    );
    assert.throws(
      () => validateBattleTerminalProgressionPayload({
        version: 2,
        kind: 'coliseum_victory'
      }),
      /version must be 1/
    );
  });

  it('rejects an advancement payload bound to another outbox battle', async () => {
    const { handler } = createBattleTerminalProgression({
      withTransaction: async () => {
        throw new Error('transaction should not open');
      }
    });

    await assert.rejects(
      handler(
        pvePayload({
          advancement: { challengerCharacterId: 8, battleId: 42 }
        }),
        { eventKey: 'battle:43:battle.progression.v1', battleId: 43 }
      ),
      /does not match outbox context/
    );
  });
});
