/**
 * Leaderboard + online list show character names, not only account usernames.
 *
 * Name semantics:
 * - level: the highest-level character (the one whose level is ranked)
 * - pvp, gold, battles, /chat/online: the active party leader (party_slot 1)
 *
 * Also guards the battles category against the old `battles.user_id`
 * reference (the column does not exist; PvE owners live in player1_id).
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  createTestContext,
  createTestPartyCharacter,
  request,
  query
} from '../testHelper.js';

const FAR_OFFSET = 1000000;

describe('character names on leaderboard and online list', () => {
  const ctx = createTestContext();
  let user;
  let leader;
  let strongest;

  before(async () => {
    user = await ctx.createUser();
    leader = await ctx.createCharacter(user.accessToken);
    strongest = await createTestPartyCharacter(user.userId);
    await query('UPDATE characters SET level = 1, experience = 0 WHERE id = $1', [leader.id]);
    await query('UPDATE characters SET level = 7, experience = 10 WHERE id = $1', [strongest.id]);
    await query('UPDATE users SET gold = 5 WHERE id = $1', [user.userId]);
    await query(
      `INSERT INTO pvp_ratings (user_id, queue_type, rating, wins, losses)
       VALUES ($1, '1v1', 1000, 1, 0)`,
      [user.userId]
    );
    await query(
      `INSERT INTO battles (battle_type, status, battle_state, map_seed, player1_id, ended_at)
       VALUES ('pve', 'victory', '{}'::jsonb, 1, $1, NOW())`,
      [user.userId]
    );
  });

  after(async () => {
    await ctx.cleanup();
  });

  async function userEntryFor(category) {
    const res = await request(
      'GET',
      `/api/leaderboard/${category}?limit=1&offset=${FAR_OFFSET}`,
      null,
      user.accessToken
    );
    assert.equal(res.status, 200, `${category}: ${JSON.stringify(res.body)}`);
    assert.deepEqual(res.body.leaderboard, []);
    assert.ok(res.body.userEntry, `${category} userEntry present`);
    assert.equal(res.body.userEntry.userId, user.userId);
    return res.body.userEntry;
  }

  it('level userEntry names the highest-level character', async () => {
    const entry = await userEntryFor('level');
    assert.equal(entry.value, 7);
    assert.equal(entry.characterName, strongest.name);
  });

  for (const category of ['pvp', 'gold', 'battles']) {
    it(`${category} userEntry names the active party leader`, async () => {
      const entry = await userEntryFor(category);
      assert.equal(entry.characterName, leader.name);
    });
  }

  it('page rows carry characterName for every category', async () => {
    for (const category of ['pvp', 'level', 'gold', 'battles']) {
      const res = await request(
        'GET',
        `/api/leaderboard/${category}?limit=5`,
        null,
        user.accessToken
      );
      assert.equal(res.status, 200, `${category}: ${JSON.stringify(res.body)}`);
      assert.ok(res.body.leaderboard.length > 0, `${category} has rows`);
      for (const row of res.body.leaderboard) {
        assert.ok('characterName' in row, `${category} row has characterName`);
      }
    }
  });

  it('GET /chat/online includes the active character name', async () => {
    const put = await request(
      'PUT',
      '/api/chat/presence',
      { status: 'online' },
      user.accessToken
    );
    assert.equal(put.status, 200);

    const res = await request('GET', '/api/chat/online', null, user.accessToken);
    assert.equal(res.status, 200);
    const self = res.body.players.find(p => p.userId === user.userId);
    assert.ok(self, 'requester is listed');
    assert.equal(self.username, user.username);
    assert.equal(self.characterName, leader.name);
  });
});
