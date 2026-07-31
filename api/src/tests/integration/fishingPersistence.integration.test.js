import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { query } from '../testHelper.js';
import {
  getSetup,
  resolveAttempt
} from '../../services/fishingService.js';

describe('fishing PostgreSQL persistence', () => {
  let userId;
  let nodeId;
  let sessionId;
  let attemptId;

  before(async () => {
    const nodeResult = await query(
      `SELECT id, name
       FROM world_nodes
       WHERE node_type = 'fishing_spot'
       ORDER BY id
       LIMIT 1`
    );
    assert.equal(nodeResult.rows.length, 1, 'seeded fishing node is required');
    nodeId = Number(nodeResult.rows[0].id);

    const fixtureId = randomUUID();
    const userResult = await query(
      `INSERT INTO users (username, email, password_hash, gold)
       VALUES ($1, $2, 'integration-test', 100)
       RETURNING id`,
      [
        `fish_${fixtureId.slice(0, 12)}`,
        `fish_${fixtureId}@example.invalid`
      ]
    );
    userId = Number(userResult.rows[0].id);

    await query(
      `INSERT INTO characters (
         user_id, name, race, class, hp_current, hp_max, mp_current, mp_max,
         strength, intelligence, agility, vitality, luck, current_node_id,
         in_battle, party_slot
       )
       VALUES (
         $1, $2, 'human', 'warrior', 20, 20, 10, 10,
         5, 5, 5, 5, 5, $3, FALSE, 1
       )`,
      [userId, `Fish${fixtureId.slice(0, 8)}`, nodeId]
    );

    sessionId = randomUUID();
    attemptId = randomUUID();
    await query(
      `INSERT INTO user_fishing_sessions (
         session_id, user_id, node_id, node_name, status, started_at,
         catches, total_value, big_one_active, selected_rod_key,
         selected_tackle_key, biome_key, biome_source, session_expires_at,
         updated_at
       )
       VALUES (
         $1, $2, $3, $4, 'active', clock_timestamp() - INTERVAL '1 minute',
         '[]'::JSONB, 0, FALSE, 'fishing:rod:weathered',
         NULL, 'heartlands', 'human',
         clock_timestamp() + INTERVAL '29 minutes', clock_timestamp()
       )`,
      [sessionId, userId, nodeId, nodeResult.rows[0].name]
    );
    await query(
      `INSERT INTO user_fishing_attempts (
         attempt_id, session_id, user_id, node_id, cast_request_id, phase,
         revision, cast_started_at, released_at, bite_at, hook_deadline,
         cast_power, depth, is_big_catch, rod_key, rod_landing_rate,
         tackle_wait_reduction, reel_challenge
       )
       VALUES (
         $1, $2, $3, $4, $5, 'wait', 0,
         clock_timestamp() - INTERVAL '10 seconds',
         clock_timestamp() - INTERVAL '8 seconds',
         clock_timestamp() - INTERVAL '1 second',
         clock_timestamp() + INTERVAL '1 minute',
         50, 'mid', FALSE, 'fishing:rod:weathered', 0.10, 0,
         $6::JSONB
       )`,
      [
        attemptId,
        sessionId,
        userId,
        nodeId,
        randomUUID(),
        JSON.stringify({
          cues: ['left', 'right', 'up'],
          nextCueIndex: 0,
          hits: 0,
          misses: 0,
          requiredHits: 2,
          totalDurationMs: 6000,
          cueWindowMs: 2000,
          succeeded: null
        })
      ]
    );
  });

  after(async () => {
    if (userId) {
      await query('DELETE FROM users WHERE id = $1', [userId]);
    }
  });

  it('hydrates timed phases and commits an idempotent catch exactly once', async () => {
    const hydrated = await getSetup(userId, nodeId);
    assert.equal(hydrated.attempt.phase, 'bite');
    assert.equal(hydrated.attempt.revision, 1);

    await query(
      `UPDATE user_fishing_attempts
       SET phase = 'resolve',
           revision = revision + 1,
           hooked_at = clock_timestamp(),
           reel_deadline = clock_timestamp() + INTERVAL '1 minute',
           reel_challenge = reel_challenge || $1::JSONB,
           updated_at = clock_timestamp()
       WHERE attempt_id = $2`,
      [JSON.stringify({
        nextCueIndex: 3,
        hits: 3,
        misses: 0,
        succeeded: true
      }), attemptId]
    );

    const actionId = randomUUID();
    const options = { actionId, sessionId };
    const resolved = await resolveAttempt(userId, nodeId, attemptId, options);
    const replay = await resolveAttempt(userId, nodeId, attemptId, options);

    assert.equal(resolved.attempt.phase, 'resolved');
    assert.equal(resolved.attempt.outcome.result, 'caught');
    assert.equal(resolved.catch.attemptId, attemptId);
    assert.deepEqual(replay, resolved);

    const persisted = await query(
      `SELECT
         (SELECT COUNT(*)::INTEGER
          FROM user_fishing_catches
          WHERE attempt_id = $1) AS catch_count,
         (SELECT COUNT(*)::INTEGER
          FROM fishing_action_receipts
          WHERE action_id = $2) AS receipt_count`,
      [attemptId, actionId]
    );
    assert.deepEqual(persisted.rows[0], {
      catch_count: 1,
      receipt_count: 1
    });
  });
});
