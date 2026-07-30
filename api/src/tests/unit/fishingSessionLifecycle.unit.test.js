import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../config/database.js';
import {
  endSession,
  getActiveSessionStatus,
  getSessionStatus,
  registerCatch,
  startSession
} from '../../services/fishingService.js';

function installDatabaseHarness(t, { startingGold = 1000 } = {}) {
  const sessions = new Map();
  let gold = startingGold;
  let goldCreditCount = 0;
  let userLockTail = Promise.resolve();

  const cloneRow = row => structuredClone(row);
  const activeForUser = userId => [...sessions.values()]
    .filter(row => row.user_id === userId && row.status === 'active')
    .sort((a, b) => b.started_at.getTime() - a.started_at.getTime());

  function sessionRows(sql, params) {
    if (sql.includes('session_id = $1')) {
      const row = sessions.get(params[0]);
      return row && row.user_id === params[1] && row.node_id === params[2]
        ? [cloneRow(row)]
        : [];
    }

    const rows = activeForUser(params[0]);
    if (sql.includes('node_id = $2')) {
      return rows
        .filter(row => row.node_id === params[1])
        .map(cloneRow);
    }
    return rows.map(cloneRow);
  }

  function createClient() {
    let releaseUserLock = null;

    return {
      async query(sql, params = []) {
        const command = sql.trim();
        if (command === 'BEGIN') return { rows: [] };
        if (command === 'COMMIT' || command === 'ROLLBACK') {
          releaseUserLock?.();
          releaseUserLock = null;
          return { rows: [] };
        }

        if (sql.includes('pg_advisory_xact_lock_shared')) {
          return { rows: [{}] };
        }

        if (
          sql.includes('SELECT id FROM users') &&
          sql.includes('FOR NO KEY UPDATE')
        ) {
          let release;
          const previous = userLockTail;
          userLockTail = new Promise(resolve => {
            release = resolve;
          });
          await previous;
          releaseUserLock = release;
          return { rows: [{ id: params[0] }] };
        }

        if (sql.includes('SELECT id, name, node_type FROM world_nodes')) {
          return {
            rows: [{
              id: params[0],
              name: `Regression Lake ${params[0]}`,
              node_type: 'fishing_spot'
            }]
          };
        }

        if (sql.includes('FROM user_fishing_sessions')) {
          return { rows: sessionRows(sql, params) };
        }

        if (sql.includes('INSERT INTO user_fishing_sessions')) {
          sessions.set(params[0], {
            session_id: params[0],
            user_id: params[1],
            node_id: params[2],
            node_name: params[3],
            status: 'active',
            started_at: params[4],
            last_catch_at: null,
            catches: [],
            total_value: 0,
            big_one_active: false,
            big_one_expires_at: null,
            big_one_fish: null,
            collection_result: null,
            collected_at: null
          });
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes('UPDATE user_fishing_sessions') &&
          sql.includes('SET catches =')
        ) {
          const isBigOneClaim = sql.includes('big_one_active = FALSE');
          const sessionId = params[isBigOneClaim ? 2 : 6];
          const row = sessions.get(sessionId);
          row.catches = JSON.parse(params[0]);
          row.total_value = params[1];
          if (isBigOneClaim) {
            row.big_one_active = false;
            row.big_one_expires_at = null;
            row.big_one_fish = null;
          } else {
            row.last_catch_at = params[2];
            row.big_one_active = params[3];
            row.big_one_expires_at = params[4];
            row.big_one_fish = params[5] ? JSON.parse(params[5]) : null;
          }
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes('UPDATE user_fishing_sessions') &&
          sql.includes("status = 'collected'")
        ) {
          const row = sessions.get(params[1]);
          row.status = 'collected';
          row.collection_result = JSON.parse(params[0]);
          row.collected_at = new Date();
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('INSERT INTO user_fishing_catches')) {
          return { rows: [], rowCount: 1 };
        }

        if (sql.includes('UPDATE users') && sql.includes('RETURNING gold')) {
          goldCreditCount++;
          gold = Math.min(gold + params[0], params[1]);
          return { rows: [{ gold }], rowCount: 1 };
        }

        if (sql.includes('SELECT gold FROM users')) {
          return { rows: [{ gold }] };
        }

        throw new Error(`Unexpected transaction query in fishing test: ${sql}`);
      },
      release() {
        releaseUserLock?.();
        releaseUserLock = null;
      }
    };
  }

  t.mock.method(pool, 'connect', async () => createClient());
  t.mock.method(pool, 'query', async (sql, params = []) => {
    if (sql.includes('FROM user_fishing_sessions')) {
      return { rows: sessionRows(sql, params) };
    }
    if (sql.includes('SELECT id FROM characters')) {
      return { rows: [] };
    }
    if (
      sql.includes('UPDATE user_fishing_sessions') &&
      sql.includes("status = 'expired'")
    ) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected pool query in fishing test: ${sql}`);
  });

  return {
    sessions,
    get gold() {
      return gold;
    },
    get goldCreditCount() {
      return goldCreditCount;
    }
  };
}

describe('fishing session lifecycle', () => {
  it('durably resumes full state and isolates a new session from collected catches', async (t) => {
    const userId = 91001;
    const nodeId = 92001;
    installDatabaseHarness(t);

    const started = await startSession(userId, nodeId);
    const caught = await registerCatch(userId, nodeId, started.sessionId);
    const resumed = await startSession(userId, nodeId);
    const status = await getSessionStatus(userId, nodeId);

    assert.equal(resumed.resumed, true);
    assert.equal(resumed.sessionId, started.sessionId);
    assert.deepEqual(resumed.catches, [caught.catch]);
    assert.equal(status.sessionId, started.sessionId);
    assert.equal(status.nodeId, nodeId);
    assert.deepEqual(status.catches, [caught.catch]);
    assert.equal((await getActiveSessionStatus(userId)).sessionId, started.sessionId);

    await endSession(userId, nodeId, started.sessionId);
    const fresh = await startSession(userId, nodeId);

    assert.notEqual(fresh.sessionId, started.sessionId);
    assert.equal(fresh.totalCatches, 0);
    assert.equal(fresh.totalValue, 0);
    assert.deepEqual(fresh.catches, []);
    await assert.rejects(
      registerCatch(userId, nodeId, started.sessionId),
      /no longer active/i
    );

    await endSession(userId, nodeId, fresh.sessionId);
    assert.equal(await getActiveSessionStatus(userId), null);
  });

  it('credits concurrent and later collection replays exactly once', async (t) => {
    const userId = 91002;
    const nodeId = 92002;
    const database = installDatabaseHarness(t, { startingGold: 500 });

    const started = await startSession(userId, nodeId);
    const caught = await registerCatch(userId, nodeId, started.sessionId);
    const expectedValue = caught.sessionStats.totalValue;

    const [first, concurrent] = await Promise.all([
      endSession(userId, nodeId, started.sessionId),
      endSession(userId, nodeId, started.sessionId)
    ]);

    assert.equal(database.goldCreditCount, 1);
    assert.equal(database.gold, 500 + expectedValue);
    assert.equal(first.summary.totalValue, expectedValue);
    assert.deepEqual(concurrent.summary, first.summary);

    const retry = await endSession(userId, nodeId, started.sessionId);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.summary.totalValue, expectedValue);
    assert.equal(database.goldCreditCount, 1);
    assert.equal(await getSessionStatus(userId, nodeId), null);
  });

  it('enforces one active node per user', async (t) => {
    const userId = 91003;
    installDatabaseHarness(t);

    const started = await startSession(userId, 92003);
    await assert.rejects(
      startSession(userId, 92004),
      /already have an active fishing session/i
    );
    assert.equal((await getActiveSessionStatus(userId)).sessionId, started.sessionId);
    await endSession(userId, 92003, started.sessionId);
  });

  it('gives racing starts after collection the same fresh session', async (t) => {
    const userId = 91004;
    const nodeId = 92005;
    installDatabaseHarness(t);

    const oldSession = await startSession(userId, nodeId);
    const [ended, firstStart, secondStart] = await Promise.all([
      endSession(userId, nodeId, oldSession.sessionId),
      startSession(userId, nodeId),
      startSession(userId, nodeId)
    ]);

    assert.equal(ended.success, true);
    assert.notEqual(firstStart.sessionId, oldSession.sessionId);
    assert.equal(secondStart.sessionId, firstStart.sessionId);
  });

  it('requires the caller to identify the active session', async (t) => {
    const userId = 91005;
    const nodeId = 92006;
    installDatabaseHarness(t);

    const started = await startSession(userId, nodeId);
    await assert.rejects(
      registerCatch(userId, nodeId),
      /session ID is required/
    );
    await assert.rejects(
      endSession(userId, nodeId, 'different-session'),
      /session ID is invalid/
    );
    await endSession(userId, nodeId, started.sessionId);
  });
});
