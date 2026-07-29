import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completeQuestWithClient } from '../../services/advancementQuestService.js';

const questRow = status => ({
  quest_id: 5,
  status,
  target_class: 'paladin',
  prerequisite_class: null,
  guild_id: 'warrior',
  tier: 1,
  gold_reward: 100,
  xp_reward: 50,
  title_reward: 'Shield Bearer',
  name: 'Ada',
  class: status === 'completed' ? 'paladin' : 'warrior',
  race: 'human',
  level: 20,
  user_id: 3
});

describe('advancement quest completion idempotency', () => {
  it('reconstructs a completed outcome without re-awarding rewards', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [questRow('completed')] };
      }
    };

    const outcome = await completeQuestWithClient(client, 7, 42);

    assert.equal(outcome.success, true);
    assert.equal(outcome.previousClass, 'warrior');
    assert.equal(outcome.newClass, 'paladin');
    assert.deepEqual(outcome.rewards, {
      gold: 100,
      xp: 50,
      title: 'Shield Bearer'
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /FOR UPDATE OF cq, c/);
    assert.match(calls[0].sql, /cq\.completion_battle_id = \$2/);
    assert.deepEqual(calls[0].params, [7, 42]);
    assert.doesNotMatch(calls[0].sql, /UPDATE users/);
  });

  it('locks, mutates, and awards a boss-ready quest once', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('SELECT cq.id AS quest_id')) {
          return { rows: [questRow('boss_ready')] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const outcome = await completeQuestWithClient(client, 7, 42);

    assert.equal(outcome.newClass, 'paladin');
    assert.equal(calls.filter(call => call.sql.includes('UPDATE users')).length, 1);
    assert.equal(
      calls.filter(call => call.sql.includes('SET experience = experience +')).length,
      1
    );
    assert.equal(
      calls.filter(call => call.sql.includes('INSERT INTO character_titles')).length,
      1
    );
  });
});
