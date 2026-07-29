import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  cleanupTestUser,
  cleanupTestUsers,
  createTestUser,
  query
} from '../testHelper.js';

describe('test user cleanup', () => {
  it('detaches one user from a shared battle and removes it with the final participant', async () => {
    const firstUser = await createTestUser();
    const secondUser = await createTestUser();
    const eventKey = `test-cleanup:${randomUUID()}`;
    let battleId = null;
    let unrelatedMatchId = null;

    try {
      const unrelatedMatch = await query(
        `INSERT INTO coliseum_matches (queue_type)
         VALUES ('1v1')
         RETURNING id`
      );
      unrelatedMatchId = unrelatedMatch.rows[0].id;

      const battle = await query(
        `INSERT INTO battles (
           battle_type,
           status,
           battle_state,
           map_seed,
           player1_id,
           player2_id,
           winner_id
         )
         VALUES ('pvp_coliseum', 'victory', '{}'::jsonb, 1, $1, $2, $1)
         RETURNING id`,
        [firstUser.userId, secondUser.userId]
      );
      battleId = battle.rows[0].id;

      await query(
        `INSERT INTO battle_players (battle_id, user_id, team, is_winner)
         VALUES ($1, $2, 1, true), ($1, $3, 2, false)`,
        [battleId, firstUser.userId, secondUser.userId]
      );
      await query(
        `INSERT INTO coliseum_matches (
           battle_id,
           queue_type,
           winner_user_id,
           loser_user_id
         )
         VALUES ($1, '1v1', $2, $3)`,
        [battleId, firstUser.userId, secondUser.userId]
      );
      await query(
        `INSERT INTO battle_terminal_effect_outbox (
           event_key,
           battle_id,
           event_type,
           payload,
           processed_at
         )
         VALUES ($1, $2, 'coliseum_completed', '{}'::jsonb, NOW())`,
        [eventKey, battleId]
      );
      await query(
        `INSERT INTO battle_terminal_progression_receipts (
           event_key,
           event_kind,
           payload
         )
         VALUES ($1, 'coliseum_victory', '{}'::jsonb)`,
        [eventKey]
      );

      await cleanupTestUser(firstUser.userId);

      const afterFirstCleanup = await query(
        `SELECT b.player1_id,
                b.player2_id,
                b.winner_id,
                ARRAY_AGG(bp.user_id ORDER BY bp.user_id)
                  FILTER (WHERE bp.user_id IS NOT NULL) AS participant_ids,
                cm.winner_user_id,
                cm.loser_user_id,
                o.event_key AS outbox_event_key,
                r.event_key AS receipt_event_key
         FROM battles b
         LEFT JOIN battle_players bp ON bp.battle_id = b.id
         LEFT JOIN coliseum_matches cm ON cm.battle_id = b.id
         LEFT JOIN battle_terminal_effect_outbox o ON o.battle_id = b.id
         LEFT JOIN battle_terminal_progression_receipts r
           ON r.event_key = o.event_key
         WHERE b.id = $1
         GROUP BY b.id, cm.id, o.event_key, r.event_key`,
        [battleId]
      );
      assert.strictEqual(afterFirstCleanup.rowCount, 1);
      assert.strictEqual(afterFirstCleanup.rows[0].player1_id, null);
      assert.strictEqual(
        afterFirstCleanup.rows[0].player2_id,
        secondUser.userId
      );
      assert.strictEqual(afterFirstCleanup.rows[0].winner_id, null);
      assert.deepStrictEqual(
        afterFirstCleanup.rows[0].participant_ids,
        [secondUser.userId]
      );
      assert.strictEqual(afterFirstCleanup.rows[0].winner_user_id, null);
      assert.strictEqual(
        afterFirstCleanup.rows[0].loser_user_id,
        secondUser.userId
      );
      assert.strictEqual(afterFirstCleanup.rows[0].outbox_event_key, eventKey);
      assert.strictEqual(afterFirstCleanup.rows[0].receipt_event_key, eventKey);

      const deletedFirstUser = await query(
        'SELECT id FROM users WHERE id = $1',
        [firstUser.userId]
      );
      assert.strictEqual(deletedFirstUser.rowCount, 0);
      const unrelatedAfterFirstCleanup = await query(
        'SELECT id FROM coliseum_matches WHERE id = $1',
        [unrelatedMatchId]
      );
      assert.strictEqual(
        unrelatedAfterFirstCleanup.rowCount,
        1,
        'cleanup must not delete unrelated anonymized Coliseum history'
      );

      await cleanupTestUser(secondUser.userId);

      const finalState = await query(
        `SELECT
           EXISTS (SELECT 1 FROM battles WHERE id = $1) AS battle_exists,
           EXISTS (
             SELECT 1
             FROM battle_terminal_effect_outbox
             WHERE event_key = $2
           ) AS outbox_exists,
           EXISTS (
             SELECT 1
             FROM battle_terminal_progression_receipts
             WHERE event_key = $2
           ) AS receipt_exists,
           EXISTS (
             SELECT 1
             FROM coliseum_matches
             WHERE battle_id = $1
                OR winner_user_id = $3
                OR loser_user_id = $3
           ) AS match_exists,
           EXISTS (
             SELECT 1
             FROM coliseum_matches
             WHERE id = $4
           ) AS unrelated_match_exists,
           EXISTS (SELECT 1 FROM users WHERE id = $3) AS user_exists`,
        [battleId, eventKey, secondUser.userId, unrelatedMatchId]
      );
      assert.deepStrictEqual(finalState.rows[0], {
        battle_exists: false,
        outbox_exists: false,
        receipt_exists: false,
        match_exists: false,
        unrelated_match_exists: true,
        user_exists: false
      });
    } finally {
      if (unrelatedMatchId) {
        await query('DELETE FROM coliseum_matches WHERE id = $1', [unrelatedMatchId]);
      }
      await cleanupTestUsers([firstUser.userId, secondUser.userId]);
    }
  });

  it('refuses to detach one participant from an active shared battle', async () => {
    const firstUser = await createTestUser();
    const secondUser = await createTestUser();
    let battleId = null;

    try {
      const battle = await query(
        `INSERT INTO battles (
           battle_type,
           status,
           battle_state,
           map_seed,
           player1_id,
           player2_id
         )
         VALUES ('pvp_coliseum', 'active', '{}'::jsonb, 1, $1, $2)
         RETURNING id`,
        [firstUser.userId, secondUser.userId]
      );
      battleId = battle.rows[0].id;
      await query(
        `INSERT INTO battle_players (battle_id, user_id, team)
         VALUES ($1, $2, 1), ($1, $3, 2)`,
        [battleId, firstUser.userId, secondUser.userId]
      );

      await assert.rejects(
        cleanupTestUser(firstUser.userId),
        /Cannot clean a participant from active shared battle/
      );

      const unchanged = await query(
        `SELECT b.player1_id,
                b.player2_id,
                ARRAY_AGG(bp.user_id ORDER BY bp.user_id) AS participant_ids,
                EXISTS (
                  SELECT 1 FROM users WHERE id = $2
                ) AS first_user_exists
         FROM battles b
         JOIN battle_players bp ON bp.battle_id = b.id
         WHERE b.id = $1
         GROUP BY b.id`,
        [battleId, firstUser.userId]
      );
      assert.strictEqual(unchanged.rowCount, 1);
      assert.strictEqual(unchanged.rows[0].player1_id, firstUser.userId);
      assert.strictEqual(unchanged.rows[0].player2_id, secondUser.userId);
      assert.deepStrictEqual(
        unchanged.rows[0].participant_ids,
        [firstUser.userId, secondUser.userId].sort((left, right) => left - right)
      );
      assert.strictEqual(unchanged.rows[0].first_user_exists, true);
    } finally {
      await cleanupTestUsers([firstUser.userId, secondUser.userId]);
    }
  });

  it('refuses cleanup while a terminal outbox event is actively claimed', async () => {
    const user = await createTestUser();
    const eventKey = `test-cleanup-claim:${randomUUID()}`;
    const claimToken = randomUUID();
    let battleId = null;

    try {
      const battle = await query(
        `INSERT INTO battles (
           battle_type,
           status,
           battle_state,
           map_seed,
           player1_id,
           winner_id
         )
         VALUES ('pve', 'victory', '{}'::jsonb, 1, $1, $1)
         RETURNING id`,
        [user.userId]
      );
      battleId = battle.rows[0].id;
      await query(
        `INSERT INTO battle_terminal_effect_outbox (
           event_key,
           battle_id,
           event_type,
           payload,
           claim_token,
           claimed_at
         )
         VALUES ($1, $2, 'battle.progression.v1', '{}'::jsonb, $3, NOW())`,
        [eventKey, battleId, claimToken]
      );

      await assert.rejects(
        cleanupTestUser(user.userId),
        /terminal battle event is actively claimed/
      );

      const unchanged = await query(
        `SELECT
           EXISTS (SELECT 1 FROM users WHERE id = $1) AS user_exists,
           EXISTS (SELECT 1 FROM battles WHERE id = $2) AS battle_exists,
           EXISTS (
             SELECT 1
             FROM battle_terminal_effect_outbox
             WHERE event_key = $3 AND claim_token = $4
           ) AS claimed_event_exists`,
        [user.userId, battleId, eventKey, claimToken]
      );
      assert.deepStrictEqual(unchanged.rows[0], {
        user_exists: true,
        battle_exists: true,
        claimed_event_exists: true
      });

      await query(
        `UPDATE battle_terminal_effect_outbox
         SET claim_token = NULL, claimed_at = NULL
         WHERE event_key = $1`,
        [eventKey]
      );
      await cleanupTestUser(user.userId);
    } finally {
      await query(
        `UPDATE battle_terminal_effect_outbox
         SET claim_token = NULL, claimed_at = NULL
         WHERE event_key = $1`,
        [eventKey]
      );
      await cleanupTestUser(user.userId);
    }
  });
});
