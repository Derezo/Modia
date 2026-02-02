import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('Garrison API', () => {
  let ctx;
  let user;
  let character;
  let castleNode;
  let nonCastleNode;

  before(async () => {
    ctx = createTestContext();
    user = await ctx.createUser();
    character = await ctx.createCharacter(user.accessToken);

    // Find a castle node from the seeded world
    const castleResult = await query(`
      SELECT id, name, region_id
      FROM world_nodes
      WHERE node_type = 'castle'
      LIMIT 1
    `);

    if (castleResult.rows.length === 0) {
      throw new Error('No castle node found in seeded world - ensure db:seed has been run');
    }

    castleNode = castleResult.rows[0];

    // Find a non-castle node for negative tests
    const nonCastleResult = await query(`
      SELECT id, name
      FROM world_nodes
      WHERE node_type != 'castle'
      LIMIT 1
    `);

    if (nonCastleResult.rows.length > 0) {
      nonCastleNode = nonCastleResult.rows[0];
    }
  });

  after(async () => {
    // Clean up any garrison recruits created during tests
    if (user?.userId) {
      await query('DELETE FROM garrison_recruits WHERE purchased_by = $1', [user.userId]);
    }
    await ctx.cleanup();
  });

  /**
   * Move a character to a specific node for testing
   */
  async function moveCharacterToNode(charId, nodeId) {
    await query(
      'UPDATE characters SET current_node_id = $1 WHERE id = $2',
      [nodeId, charId]
    );
  }

  /**
   * Give a user a specific amount of gold for testing
   */
  async function setUserGold(userId, amount) {
    await query(
      'UPDATE users SET gold = $1 WHERE id = $2',
      [amount, userId]
    );
  }

  describe('GET /api/garrison/:nodeId', () => {
    it('should return 401 without auth', async () => {
      const res = await request('GET', `/api/garrison/${castleNode.id}`);

      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for non-castle node', async () => {
      if (!nonCastleNode) {
        return; // Skip if no non-castle node found
      }

      // Move character to non-castle node first
      await moveCharacterToNode(character.id, nonCastleNode.id);

      const res = await request('GET', `/api/garrison/${nonCastleNode.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('not a castle'));
    });

    it('should return 403 if user not at the castle', async () => {
      // Ensure character is NOT at the castle node
      if (nonCastleNode) {
        await moveCharacterToNode(character.id, nonCastleNode.id);
      }

      const res = await request('GET', `/api/garrison/${castleNode.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error.includes('must be at this castle'));
    });

    it('should return 200 with recruits array when at castle', async () => {
      // Move character to the castle
      await moveCharacterToNode(character.id, castleNode.id);

      const res = await request('GET', `/api/garrison/${castleNode.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.nodeId, castleNode.id);
      assert.ok(res.body.nodeName);
      assert.ok(Array.isArray(res.body.recruits));
    });

    it('should lazy generate recruits if none exist', async () => {
      // Move character to the castle
      await moveCharacterToNode(character.id, castleNode.id);

      // First delete any existing recruits for this castle
      await query(
        'DELETE FROM garrison_recruits WHERE castle_node_id = $1 AND purchased_by IS NULL',
        [castleNode.id]
      );

      // Now fetch - should generate new recruits
      const res = await request('GET', `/api/garrison/${castleNode.id}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.recruits));
      assert.ok(res.body.recruits.length > 0, 'Should have generated new recruits');

      // Verify recruits have expected properties
      const recruit = res.body.recruits[0];
      assert.ok(recruit.id);
      assert.ok(recruit.name);
      assert.ok(recruit.race);
      assert.ok(recruit.class);
      assert.ok(recruit.price > 0);
      assert.ok(recruit.stats);
    });

    it('should return 400 for invalid node ID', async () => {
      const res = await request('GET', '/api/garrison/invalid', null, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should return 404 for non-existent node', async () => {
      const res = await request('GET', '/api/garrison/999999', null, user.accessToken);

      assert.strictEqual(res.status, 404);
    });
  });

  describe('POST /api/garrison/:nodeId/purchase/:recruitId', () => {
    let testRecruit;

    beforeEach(async () => {
      // Move character to castle for each test
      await moveCharacterToNode(character.id, castleNode.id);

      // Ensure user has plenty of gold
      await setUserGold(user.userId, 50000);

      // Get available recruits
      const res = await request('GET', `/api/garrison/${castleNode.id}`, null, user.accessToken);
      if (res.body.recruits && res.body.recruits.length > 0) {
        testRecruit = res.body.recruits[0];
      }
    });

    it('should return 401 without auth', async () => {
      const res = await request('POST', `/api/garrison/${castleNode.id}/purchase/1`);

      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for non-castle node', async () => {
      if (!nonCastleNode) {
        return; // Skip if no non-castle node found
      }

      await moveCharacterToNode(character.id, nonCastleNode.id);

      const res = await request('POST', `/api/garrison/${nonCastleNode.id}/purchase/1`, {}, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('not a castle'));
    });

    it('should return 403 if user not at the castle', async () => {
      if (!nonCastleNode) {
        return;
      }

      await moveCharacterToNode(character.id, nonCastleNode.id);

      const res = await request('POST', `/api/garrison/${castleNode.id}/purchase/1`, {}, user.accessToken);

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error.includes('must be at this castle'));
    });

    it('should return 404 for invalid recruitId', async () => {
      const res = await request('POST', `/api/garrison/${castleNode.id}/purchase/999999`, {}, user.accessToken);

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should return 400 if recruit already purchased', async () => {
      if (!testRecruit) {
        return; // Skip if no recruit available
      }

      // Create a fresh user to purchase
      const buyer = await ctx.createUser();
      await ctx.createCharacter(buyer.accessToken);

      // Move buyer's character to castle
      const buyerChars = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1', [buyer.userId]);
      await moveCharacterToNode(buyerChars.rows[0].id, castleNode.id);
      await setUserGold(buyer.userId, 50000);

      // First purchase - should succeed
      const firstRes = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/${testRecruit.id}`,
        {},
        buyer.accessToken
      );
      assert.strictEqual(firstRes.status, 200);

      // Second attempt by another user - should fail
      const secondRes = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/${testRecruit.id}`,
        {},
        user.accessToken
      );
      assert.strictEqual(secondRes.status, 400);
      assert.ok(secondRes.body.error.includes('already been purchased'));
    });

    it('should return 400 if insufficient gold', async () => {
      // Create fresh user with no gold
      const poorUser = await ctx.createUser();
      await ctx.createCharacter(poorUser.accessToken);

      // Move character to castle
      const poorChars = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1', [poorUser.userId]);
      await moveCharacterToNode(poorChars.rows[0].id, castleNode.id);

      // Set gold to 0
      await setUserGold(poorUser.userId, 0);

      // Get a fresh recruit
      const listRes = await request('GET', `/api/garrison/${castleNode.id}`, null, poorUser.accessToken);
      if (listRes.body.recruits.length === 0) {
        return; // No recruits to test with
      }
      const recruit = listRes.body.recruits[0];

      const res = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/${recruit.id}`,
        {},
        poorUser.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Not enough gold'));
    });

    it('should return 400 if party full (12 characters)', async () => {
      // Create a user with 12 characters already
      const fullUser = await ctx.createUser();

      // Create first character via API (this is allowed)
      await ctx.createCharacter(fullUser.accessToken);

      // Create 11 more characters directly in the database (simulating recruitment)
      for (let i = 2; i <= 12; i++) {
        await query(
          `INSERT INTO characters (user_id, name, race, class, gender, level, experience,
            hp_current, hp_max, mp_current, mp_max,
            strength, intelligence, agility, vitality, luck,
            party_slot, current_node_id)
           VALUES ($1, $2, 'human', 'warrior', 'male', 1, 0, 100, 100, 50, 50, 10, 10, 10, 10, 10, $3, $4)`,
          [fullUser.userId, `TestChar${i}_${Date.now()}`, i, castleNode.id]
        );
      }

      // Move lead character to castle
      const leadChar = await query(
        'SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1',
        [fullUser.userId]
      );
      await moveCharacterToNode(leadChar.rows[0].id, castleNode.id);
      await setUserGold(fullUser.userId, 50000);

      // Get a recruit
      const listRes = await request('GET', `/api/garrison/${castleNode.id}`, null, fullUser.accessToken);
      if (listRes.body.recruits.length === 0) {
        return; // No recruits to test with
      }
      const recruit = listRes.body.recruits[0];

      const res = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/${recruit.id}`,
        {},
        fullUser.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Cannot have more than'));
    });

    it('should return 200 on successful purchase with new character', async () => {
      // Create fresh user for clean purchase test
      const buyer = await ctx.createUser();
      await ctx.createCharacter(buyer.accessToken);

      // Move to castle and set gold
      const buyerChars = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1', [buyer.userId]);
      await moveCharacterToNode(buyerChars.rows[0].id, castleNode.id);
      await setUserGold(buyer.userId, 50000);

      // Get a fresh recruit
      const listRes = await request('GET', `/api/garrison/${castleNode.id}`, null, buyer.accessToken);
      assert.ok(listRes.body.recruits.length > 0, 'Should have recruits available');
      const recruit = listRes.body.recruits[0];

      const res = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/${recruit.id}`,
        { characterName: 'TestRecruit' },
        buyer.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('recruited'));
      assert.ok(res.body.character);
      assert.strictEqual(res.body.character.name, 'TestRecruit');
      assert.strictEqual(res.body.character.race, recruit.race);
      assert.strictEqual(res.body.character.class, recruit.class);
      assert.ok(res.body.goldSpent > 0);
      assert.ok(typeof res.body.remainingGold === 'number');
    });

    it('should use recruit name if no custom name provided', async () => {
      // Create fresh user
      const buyer = await ctx.createUser();
      await ctx.createCharacter(buyer.accessToken);

      // Move to castle and set gold
      const buyerChars = await query('SELECT id FROM characters WHERE user_id = $1 LIMIT 1', [buyer.userId]);
      await moveCharacterToNode(buyerChars.rows[0].id, castleNode.id);
      await setUserGold(buyer.userId, 50000);

      // Get a fresh recruit
      const listRes = await request('GET', `/api/garrison/${castleNode.id}`, null, buyer.accessToken);
      assert.ok(listRes.body.recruits.length > 0, 'Should have recruits available');
      const recruit = listRes.body.recruits[0];

      const res = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/${recruit.id}`,
        {}, // No custom name
        buyer.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.character.name, recruit.name);
    });

    it('should return 400 for invalid recruit ID format', async () => {
      const res = await request(
        'POST',
        `/api/garrison/${castleNode.id}/purchase/invalid`,
        {},
        user.accessToken
      );

      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/garrison/:nodeId/refresh-time', () => {
    before(async () => {
      // Move character to castle for these tests
      await moveCharacterToNode(character.id, castleNode.id);
    });

    it('should return seconds until next hour', async () => {
      const res = await request(
        'GET',
        `/api/garrison/${castleNode.id}/refresh-time`,
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.nodeId, castleNode.id);
      assert.ok(res.body.nodeName);
      assert.ok(typeof res.body.secondsUntilRefresh === 'number');
      assert.ok(res.body.secondsUntilRefresh >= 0);
      assert.ok(res.body.secondsUntilRefresh <= 3600, 'Should be at most 1 hour');
    });

    it('should return 401 without auth', async () => {
      const res = await request('GET', `/api/garrison/${castleNode.id}/refresh-time`);

      assert.strictEqual(res.status, 401);
    });

    it('should return 400 for non-castle node', async () => {
      if (!nonCastleNode) {
        return;
      }

      await moveCharacterToNode(character.id, nonCastleNode.id);

      const res = await request(
        'GET',
        `/api/garrison/${nonCastleNode.id}/refresh-time`,
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('not a castle'));
    });

    it('should return 403 if user not at the castle', async () => {
      if (!nonCastleNode) {
        return;
      }

      await moveCharacterToNode(character.id, nonCastleNode.id);

      const res = await request(
        'GET',
        `/api/garrison/${castleNode.id}/refresh-time`,
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 403);
      assert.ok(res.body.error.includes('must be at this castle'));
    });
  });
});
