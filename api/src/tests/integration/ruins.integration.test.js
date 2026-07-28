import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';
import {
  PUZZLE_ALGORITHM_VERSION,
  createPuzzleSolution
} from '../../routes/ruins.js';

describe('Ruins API', () => {
  let ctx;
  let user;
  let ruinsNode;

  async function authorizeAtRuins(testUser, { discover = true } = {}) {
    const character = await ctx.createCharacter(testUser.accessToken);
    await query(
      'UPDATE characters SET current_node_id = $1 WHERE id = $2',
      [ruinsNode.id, character.id]
    );

    if (discover) {
      await query(`
        INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
        VALUES ($1, $2, 'travel')
        ON CONFLICT (user_id, node_id) DO NOTHING
      `, [testUser.userId, ruinsNode.id]);
    }

    return character;
  }

  async function createAuthorizedSolver() {
    const solver = await ctx.createUser();
    await authorizeAtRuins(solver);
    return solver;
  }

  function validSolution(gridSize) {
    return createPuzzleSolution(ruinsNode.local_seed, gridSize);
  }

  function solutionBody(gridSize, overrides = {}) {
    return {
      moves: validSolution(gridSize),
      puzzleVersion: PUZZLE_ALGORITHM_VERSION,
      ...overrides
    };
  }

  before(async () => {
    ctx = createTestContext();
    user = await ctx.createUser();

    // Find an existing ruins node from the seeded world
    const ruinsResult = await query(`
      SELECT id, name, ruins_reward_tier, region_race, local_seed
      FROM world_nodes
      WHERE node_type = 'ruins'
      LIMIT 1
    `);

    if (ruinsResult.rows.length === 0) {
      throw new Error('No ruins node found in seeded world - ensure db:seed has been run');
    }

    ruinsNode = ruinsResult.rows[0];
    await authorizeAtRuins(user);
  });

  after(async () => {
    // Clean up any ruins completions created during tests
    if (user?.userId && ruinsNode?.id) {
      await query('DELETE FROM user_ruins_completions WHERE user_id = $1', [user.userId]);
    }
    await ctx.cleanup();
  });

  describe('GET /api/ruins/:nodeId/puzzle', () => {
    it('should return a valid puzzle configuration', async () => {
      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.nodeId, ruinsNode.id);
      assert.ok(res.body.nodeName);
      assert.ok([1, 2, 3].includes(res.body.tier), 'Tier should be 1, 2, or 3');
      assert.ok([3, 4, 5].includes(res.body.gridSize), 'Grid size should be 3, 4, or 5');
      assert.ok(res.body.parMoves > 0, 'Par moves should be positive');
      assert.ok(res.body.theme);
      assert.ok(res.body.theme.name);
      assert.ok(res.body.theme.race);
      assert.strictEqual(res.body.isCompleted, false);
      assert.ok(Array.isArray(res.body.puzzleState), 'Puzzle state should be an array');
      assert.ok(res.body.rewards);
      assert.ok(res.body.rewards.gold > 0, 'Gold reward should be positive');
    });

    it('should return correct grid size based on tier', async () => {
      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, user.accessToken);

      assert.strictEqual(res.status, 200);

      const tier = res.body.tier;
      const expectedGridSize = tier === 1 ? 3 : tier === 2 ? 4 : 5;
      assert.strictEqual(res.body.gridSize, expectedGridSize, `Tier ${tier} should have ${expectedGridSize}x${expectedGridSize} grid`);

      // Verify puzzle state array size matches grid
      const expectedTiles = expectedGridSize * expectedGridSize;
      assert.strictEqual(res.body.puzzleState.length, expectedTiles, `Puzzle should have ${expectedTiles} tiles`);
    });

    it('should return deterministic puzzle for same node', async () => {
      const res1 = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, user.accessToken);
      const res2 = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, user.accessToken);

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);
      assert.deepStrictEqual(res1.body.puzzleState, res2.body.puzzleState, 'Puzzle state should be deterministic');
      assert.strictEqual(res1.body.rewards.gold, res2.body.rewards.gold, 'Gold reward should be deterministic');
    });

    it('should not reveal whether an inaccessible node exists', async () => {
      const res = await request('GET', '/api/ruins/999999/puzzle', null, user.accessToken);

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error);
    });

    it('should not reveal the type of an inaccessible node', async () => {
      // Find a non-ruins node
      const nonRuinsResult = await query(`
        SELECT id FROM world_nodes
        WHERE node_type != 'ruins'
        LIMIT 1
      `);

      if (nonRuinsResult.rows.length > 0) {
        const res = await request('GET', `/api/ruins/${nonRuinsResult.rows[0].id}/puzzle`, null, user.accessToken);

        assert.strictEqual(res.status, 403);
        assert.ok(res.body.error);
      }
    });

    it('should not reveal puzzle or reward data to a remote party leader', async () => {
      const remoteUser = await ctx.createUser();
      await ctx.createCharacter(remoteUser.accessToken);

      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, remoteUser.accessToken);

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error);
      assert.strictEqual(res.body.puzzleState, undefined);
      assert.strictEqual(res.body.rewards, undefined);
      assert.strictEqual(res.body.tier, undefined);
    });

    it('should require the current ruins to be discovered', async () => {
      const undiscoveredUser = await ctx.createUser();
      await authorizeAtRuins(undiscoveredUser, { discover: false });
      await query(
        'DELETE FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
        [undiscoveredUser.userId, ruinsNode.id]
      );

      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, undiscoveredUser.accessToken);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.puzzleState, undefined);
      assert.strictEqual(res.body.rewards, undefined);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`);

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/ruins/:nodeId/solve', () => {
    it('should accept valid solution and award gold', async () => {
      const solver = await createAuthorizedSolver();

      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      assert.strictEqual(puzzleRes.status, 200);

      const res = await request(
        'POST',
        `/api/ruins/${ruinsNode.id}/solve`,
        solutionBody(puzzleRes.body.gridSize),
        solver.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('gold'));
      assert.ok(res.body.rewards);
      assert.ok(res.body.rewards.gold > 0);
      assert.ok(typeof res.body.newGold === 'number');
    });

    it('should award exactly the previewed reward for an over-par solution', async () => {
      const solver = await createAuthorizedSolver();

      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const moves = validSolution(puzzleRes.body.gridSize);
      assert.ok(moves.length > puzzleRes.body.parMoves);

      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moves,
        puzzleVersion: puzzleRes.body.puzzleVersion
      }, solver.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.rewards.underPar, false);
      assert.strictEqual(res.body.rewards.gold, puzzleRes.body.rewards.gold);
    });

    it('should reject solving same ruins twice', async () => {
      const solver = await createAuthorizedSolver();

      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const moves = validSolution(puzzleRes.body.gridSize);

      // First solve - should succeed
      const firstRes = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moves,
        puzzleVersion: puzzleRes.body.puzzleVersion
      }, solver.accessToken);
      assert.strictEqual(firstRes.status, 200);

      // Second solve - should fail
      const secondRes = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moves,
        puzzleVersion: puzzleRes.body.puzzleVersion
      }, solver.accessToken);
      assert.strictEqual(secondRes.status, 400);
      assert.ok(secondRes.body.error.includes('already been solved'));
    });

    it('should allow only one reward for concurrent solve submissions', async () => {
      const solver = await createAuthorizedSolver();
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const moves = validSolution(puzzleRes.body.gridSize);
      const beforeResult = await query('SELECT gold FROM users WHERE id = $1', [solver.userId]);

      const responses = await Promise.all([
        request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
          moves,
          puzzleVersion: puzzleRes.body.puzzleVersion
        }, solver.accessToken),
        request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
          moves,
          puzzleVersion: puzzleRes.body.puzzleVersion
        }, solver.accessToken)
      ]);

      const successResponses = responses.filter(response => response.status === 200);
      const rejectedResponses = responses.filter(response => response.status === 400);
      assert.strictEqual(successResponses.length, 1);
      assert.strictEqual(rejectedResponses.length, 1);
      assert.ok(rejectedResponses[0].body.error.includes('already been solved'));

      const afterResult = await query('SELECT gold FROM users WHERE id = $1', [solver.userId]);
      assert.strictEqual(
        afterResult.rows[0].gold - beforeResult.rows[0].gold,
        successResponses[0].body.rewards.gold
      );

      const completionResult = await query(
        'SELECT COUNT(*)::int AS count FROM user_ruins_completions WHERE user_id = $1 AND node_id = $2',
        [solver.userId, ruinsNode.id]
      );
      assert.strictEqual(completionResult.rows[0].count, 1);
    });

    it('should reject a legal move sequence that does not solve the puzzle', async () => {
      const solver = await createAuthorizedSolver();
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const firstMove = validSolution(puzzleRes.body.gridSize)[0];
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moves: [firstMove],
        puzzleVersion: puzzleRes.body.puzzleVersion
      }, solver.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid solution'));
    });

    it('should reject invalid move sequence values', async () => {
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moves: [1.5],
        puzzleVersion: PUZZLE_ALGORITHM_VERSION
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject a missing move sequence', async () => {
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {}, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject a valid solution from a remote party leader', async () => {
      const remoteUser = await ctx.createUser();
      await ctx.createCharacter(remoteUser.accessToken);
      const tier = Number(ruinsNode.ruins_reward_tier);
      const gridSize = tier === 1 ? 3 : tier === 2 ? 4 : 5;

      const res = await request(
        'POST',
        `/api/ruins/${ruinsNode.id}/solve`,
        solutionBody(gridSize),
        remoteUser.accessToken
      );

      assert.strictEqual(res.status, 403);
      const completionResult = await query(
        'SELECT COUNT(*)::int AS count FROM user_ruins_completions WHERE user_id = $1',
        [remoteUser.userId]
      );
      assert.strictEqual(completionResult.rows[0].count, 0);
    });

    it('should reject a valid solution at undiscovered ruins', async () => {
      const undiscoveredUser = await ctx.createUser();
      await authorizeAtRuins(undiscoveredUser, { discover: false });
      await query(
        'DELETE FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
        [undiscoveredUser.userId, ruinsNode.id]
      );
      const tier = Number(ruinsNode.ruins_reward_tier);
      const gridSize = tier === 1 ? 3 : tier === 2 ? 4 : 5;

      const res = await request(
        'POST',
        `/api/ruins/${ruinsNode.id}/solve`,
        solutionBody(gridSize),
        undiscoveredUser.accessToken
      );

      assert.strictEqual(res.status, 403);
    });

    it('should reject a stale puzzle version', async () => {
      const solver = await createAuthorizedSolver();
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);

      const res = await request(
        'POST',
        `/api/ruins/${ruinsNode.id}/solve`,
        solutionBody(puzzleRes.body.gridSize, {
          puzzleVersion: puzzleRes.body.puzzleVersion + 1
        }),
        solver.accessToken
      );

      assert.strictEqual(res.status, 409);
      assert.ok(res.body.error.includes('version'));
    });

    it('should not reveal whether an inaccessible solve target exists', async () => {
      const res = await request('POST', '/api/ruins/999999/solve', {
        moves: [0],
        puzzleVersion: PUZZLE_ALGORITHM_VERSION
      }, user.accessToken);

      assert.strictEqual(res.status, 403);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moves: [0],
        puzzleVersion: PUZZLE_ALGORITHM_VERSION
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/ruins/:nodeId/puzzle (after completion)', () => {
    it('should return null puzzleState for completed ruins', async () => {
      const solver = await createAuthorizedSolver();

      // Get puzzle config and solve
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);

      await request(
        'POST',
        `/api/ruins/${ruinsNode.id}/solve`,
        solutionBody(puzzleRes.body.gridSize),
        solver.accessToken
      );

      // Fetch puzzle again
      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.isCompleted, true);
      assert.strictEqual(res.body.puzzleState, null, 'Completed puzzle should have null state');
      assert.ok(res.body.completedAt, 'Should have completion timestamp');
    });
  });

  describe('GET /api/ruins/completions', () => {
    it('should return empty completions for new user', async () => {
      const freshUser = await ctx.createUser();

      const res = await request('GET', '/api/ruins/completions', null, freshUser.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.completions));
      assert.strictEqual(res.body.completions.length, 0);
      assert.strictEqual(res.body.totalCompleted, 0);
    });

    it('should return completions after solving ruins', async () => {
      const solver = await createAuthorizedSolver();

      // Solve a ruins
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);

      await request(
        'POST',
        `/api/ruins/${ruinsNode.id}/solve`,
        solutionBody(puzzleRes.body.gridSize),
        solver.accessToken
      );

      // Check completions
      const res = await request('GET', '/api/ruins/completions', null, solver.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.completions.length, 1);
      assert.strictEqual(res.body.totalCompleted, 1);
      assert.strictEqual(res.body.completions[0].node_id, ruinsNode.id);
      assert.ok(res.body.completions[0].completed_at);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', '/api/ruins/completions');

      assert.strictEqual(res.status, 401);
    });
  });
});
