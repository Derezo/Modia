/**
 * Coliseum endpoints read the caller from req.user.userId.
 *
 * Regression guard: these handlers read req.user.id, which the auth
 * middleware never sets, so /stats returned no ratings, /matches?filter=mine
 * matched nothing and the leaderboard never found the caller.
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, request, query } from '../testHelper.js';

describe('coliseum endpoints use the authenticated caller', () => {
  const ctx = createTestContext();
  let user;
  let opponent;
  let matchId;

  before(async () => {
    user = await ctx.createUser();
    opponent = await ctx.createUser();
    await ctx.createCharacter(user.accessToken);
    await query(
      `INSERT INTO pvp_ratings (user_id, queue_type, rating, peak_rating, wins, losses)
       VALUES ($1, '1v1', 1234, 1250, 3, 1), ($2, '1v1', 1000, 1000, 1, 3)`,
      [user.userId, opponent.userId]
    );
    const match = await query(
      `INSERT INTO coliseum_matches
         (queue_type, winner_user_id, loser_user_id, winner_rating_change, loser_rating_change, match_duration_seconds)
       VALUES ('1v1', $1, $2, 16, -16, 90)
       RETURNING id`,
      [user.userId, opponent.userId]
    );
    matchId = match.rows[0].id;
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('GET /api/coliseum/stats returns the caller\'s ratings and matches', async () => {
    const res = await request('GET', '/api/coliseum/stats', null, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ratings.length, 1);
    const [rating] = res.body.ratings;
    assert.equal(rating.queueType, '1v1');
    assert.equal(rating.rating, 1234);
    assert.equal(rating.wins, 3);
    assert.ok(res.body.recentMatches.some(m => m.id === matchId && m.ratingChange === 16));
  });

  it('GET /api/coliseum/matches?filter=mine returns the caller\'s match', async () => {
    const res = await request('GET', '/api/coliseum/matches?filter=mine', null, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.matches.some(m => m.id === matchId), 'own match listed');
  });

  it('GET /api/coliseum/leaderboard locates the caller', async () => {
    const res = await request('GET', '/api/coliseum/leaderboard?queue=1v1', null, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const listed = res.body.leaderboard.some(e => e.userId === user.userId);
    if (!listed) {
      // With no caller id the rank subquery is NULL and every caller is #1
      const higher = await query(
        `SELECT COUNT(*)::int AS n FROM pvp_ratings WHERE queue_type = '1v1' AND rating > 1234`
      );
      assert.equal(res.body.userRank, higher.rows[0].n + 1);
    }
  });

  it('GET /api/coliseum/my-achievements answers for the caller', async () => {
    const res = await request('GET', '/api/coliseum/my-achievements', null, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.achievements));
  });
});
