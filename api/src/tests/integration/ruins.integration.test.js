import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('Ruins API', () => {
  let ctx;
  let user;
  let ruinsNode;

  before(async () => {
    ctx = createTestContext();
    user = await ctx.createUser();

    // Find an existing ruins node from the seeded world
    const ruinsResult = await query(`
      SELECT id, name, ruins_reward_tier, region_race
      FROM world_nodes
      WHERE node_type = 'ruins'
      LIMIT 1
    `);

    if (ruinsResult.rows.length === 0) {
      throw new Error('No ruins node found in seeded world - ensure db:seed has been run');
    }

    ruinsNode = ruinsResult.rows[0];
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

    it('should return 404 for non-existent node', async () => {
      const res = await request('GET', '/api/ruins/999999/puzzle', null, user.accessToken);

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error);
    });

    it('should reject non-ruins node type', async () => {
      // Find a non-ruins node
      const nonRuinsResult = await query(`
        SELECT id FROM world_nodes
        WHERE node_type != 'ruins'
        LIMIT 1
      `);

      if (nonRuinsResult.rows.length > 0) {
        const res = await request('GET', `/api/ruins/${nonRuinsResult.rows[0].id}/puzzle`, null, user.accessToken);

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error.includes('not a ruins'));
      }
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`);

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/ruins/:nodeId/solve', () => {
    it('should accept valid solution and award gold', async () => {
      // Create a fresh user to test solving
      const solver = await ctx.createUser();

      // Get puzzle config to determine valid move count
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      assert.strictEqual(puzzleRes.status, 200);

      const gridSize = puzzleRes.body.gridSize;
      const minMoves = gridSize === 3 ? 8 : gridSize === 4 ? 15 : 30;
      const moveCount = minMoves + 5; // Valid move count above minimum

      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount
      }, solver.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('gold'));
      assert.ok(res.body.rewards);
      assert.ok(res.body.rewards.gold > 0);
      assert.ok(typeof res.body.newGold === 'number');
    });

    it('should award par bonus for under-par completion', async () => {
      const solver = await ctx.createUser();

      // Get puzzle config
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const parMoves = puzzleRes.body.parMoves;
      const gridSize = puzzleRes.body.gridSize;
      const minMoves = gridSize === 3 ? 8 : gridSize === 4 ? 15 : 30;

      // Solve at exactly par moves (under par)
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: Math.max(minMoves, parMoves)
      }, solver.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.rewards.underPar, true);
      assert.ok(res.body.message.includes('par bonus'));
    });

    it('should reject solving same ruins twice', async () => {
      const solver = await ctx.createUser();

      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const gridSize = puzzleRes.body.gridSize;
      const minMoves = gridSize === 3 ? 8 : gridSize === 4 ? 15 : 30;

      // First solve - should succeed
      const firstRes = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: minMoves + 10
      }, solver.accessToken);
      assert.strictEqual(firstRes.status, 200);

      // Second solve - should fail
      const secondRes = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: minMoves + 10
      }, solver.accessToken);
      assert.strictEqual(secondRes.status, 400);
      assert.ok(secondRes.body.error.includes('already been solved'));
    });

    it('should reject solution with too few moves (exploit prevention)', async () => {
      const solver = await ctx.createUser();

      // Try to solve with 1 move (impossible for any grid)
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: 1
      }, solver.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid solution') || res.body.error.includes('at least'));
    });

    it('should reject invalid move count values', async () => {
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: -5
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error);
    });

    it('should reject missing move count', async () => {
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {}, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should return 404 for non-existent node', async () => {
      const res = await request('POST', '/api/ruins/999999/solve', {
        moveCount: 20
      }, user.accessToken);

      assert.strictEqual(res.status, 404);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: 20
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/ruins/:nodeId/puzzle (after completion)', () => {
    it('should return null puzzleState for completed ruins', async () => {
      const solver = await ctx.createUser();

      // Get puzzle config and solve
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const gridSize = puzzleRes.body.gridSize;
      const minMoves = gridSize === 3 ? 8 : gridSize === 4 ? 15 : 30;

      await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: minMoves + 10
      }, solver.accessToken);

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
      const solver = await ctx.createUser();

      // Solve a ruins
      const puzzleRes = await request('GET', `/api/ruins/${ruinsNode.id}/puzzle`, null, solver.accessToken);
      const gridSize = puzzleRes.body.gridSize;
      const minMoves = gridSize === 3 ? 8 : gridSize === 4 ? 15 : 30;

      await request('POST', `/api/ruins/${ruinsNode.id}/solve`, {
        moveCount: minMoves + 10
      }, solver.accessToken);

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
