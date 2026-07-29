import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  createTestContext,
  getClient,
  query,
  request
} from '../testHelper.js';

describe('World chest activity', () => {
  let context;
  let user;
  let character;
  let chest;
  let parallelUser;
  let raceUser;

  before(async () => {
    context = createTestContext();
    user = await context.createUser();
    character = await context.createCharacter(user.accessToken);

    const chestResult = await query(
      `SELECT id, name
       FROM world_nodes
       WHERE node_type = 'chest'
       ORDER BY id
       LIMIT 1`
    );

    if (chestResult.rows.length === 0) {
      throw new Error('No chest node found in seeded world');
    }

    chest = chestResult.rows[0];

    await query(
      `UPDATE characters
       SET current_node_id = $1, party_slot = 1
       WHERE id = $2`,
      [chest.id, character.id]
    );
    await query(
      `INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
       VALUES ($1, $2, 'travel')
       ON CONFLICT (user_id, node_id)
       DO UPDATE SET discovery_method = 'travel'`,
      [user.userId, chest.id]
    );
  });

  after(async () => {
    if (user?.userId) {
      await query('DELETE FROM users WHERE id = $1', [user.userId]);
    }
    if (raceUser?.userId) {
      await query('DELETE FROM users WHERE id = $1', [raceUser.userId]);
    }
    if (parallelUser?.userId) {
      await query('DELETE FROM users WHERE id = $1', [parallelUser.userId]);
    }
    await context.cleanup();
  });

  it('publishes, claims, and then removes the one-time treasury action', async () => {
    const balanceBefore = await query(
      'SELECT gold FROM users WHERE id = $1',
      [user.userId]
    );

    const beforeCurrent = await request(
      'GET',
      '/api/world/current',
      null,
      user.accessToken
    );

    assert.equal(beforeCurrent.status, 200);
    assert.equal(beforeCurrent.body.currentNode.id, chest.id);
    assert.equal(beforeCurrent.body.currentNode.chest_claimed, false);
    assert.ok(
      beforeCurrent.body.availableActions.some(action => action.type === 'claim_chest')
    );

    const claim = await request(
      'POST',
      `/api/world/nodes/${chest.id}/claim-chest`,
      null,
      user.accessToken
    );

    assert.equal(claim.status, 200);
    assert.equal(claim.body.success, true);
    assert.ok(Number.isInteger(claim.body.gold_awarded));
    assert.ok(claim.body.gold_awarded > 0);
    assert.ok(Array.isArray(claim.body.items_awarded));
    assert.equal(
      claim.body.new_gold_balance,
      balanceBefore.rows[0].gold + claim.body.gold_awarded
    );

    const balanceAfter = await query(
      'SELECT gold FROM users WHERE id = $1',
      [user.userId]
    );
    assert.equal(balanceAfter.rows[0].gold, claim.body.new_gold_balance);

    const persistedClaim = await query(
      `SELECT gold_awarded, items_awarded
       FROM user_chest_claims
       WHERE user_id = $1 AND node_id = $2`,
      [user.userId, chest.id]
    );
    assert.equal(persistedClaim.rows.length, 1);
    assert.equal(persistedClaim.rows[0].gold_awarded, claim.body.gold_awarded);
    assert.deepEqual(persistedClaim.rows[0].items_awarded, claim.body.items_awarded);

    const afterCurrent = await request(
      'GET',
      '/api/world/current',
      null,
      user.accessToken
    );
    assert.equal(afterCurrent.status, 200);
    assert.equal(afterCurrent.body.currentNode.chest_claimed, true);
    assert.ok(
      !afterCurrent.body.availableActions.some(action => action.type === 'claim_chest')
    );

    const world = await request(
      'GET',
      '/api/world/nodes',
      null,
      user.accessToken
    );
    assert.equal(world.status, 200);
    assert.equal(
      world.body.nodes.find(node => node.id === chest.id)?.chest_claimed,
      true
    );

    const duplicateClaim = await request(
      'POST',
      `/api/world/nodes/${chest.id}/claim-chest`,
      null,
      user.accessToken
    );
    assert.equal(duplicateClaim.status, 200);
    assert.equal(duplicateClaim.body.success, true);
    assert.equal(duplicateClaim.body.already_claimed, true);
    assert.equal(duplicateClaim.body.gold_awarded, claim.body.gold_awarded);
    assert.deepEqual(duplicateClaim.body.items_awarded, claim.body.items_awarded);
    assert.equal(duplicateClaim.body.new_gold_balance, claim.body.new_gold_balance);

    const balanceAfterRetry = await query(
      'SELECT gold FROM users WHERE id = $1',
      [user.userId]
    );
    assert.equal(balanceAfterRetry.rows[0].gold, claim.body.new_gold_balance);

    const claimCountAfterRetry = await query(
      `SELECT COUNT(*)::integer AS count
       FROM user_chest_claims
       WHERE user_id = $1 AND node_id = $2`,
      [user.userId, chest.id]
    );
    assert.equal(claimCountAfterRetry.rows[0].count, 1);
  });

  it('awards exactly once when duplicate claims arrive concurrently', async () => {
    parallelUser = await context.createUser();
    const parallelCharacter = await context.createCharacter(parallelUser.accessToken);
    await query(
      `UPDATE characters
       SET current_node_id = $1, party_slot = 1
       WHERE id = $2`,
      [chest.id, parallelCharacter.id]
    );

    const balanceBefore = await query(
      'SELECT gold FROM users WHERE id = $1',
      [parallelUser.userId]
    );
    const inventoryBefore = await query(
      `SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
       FROM character_items
       WHERE user_id = $1`,
      [parallelUser.userId]
    );
    const responses = await Promise.all([
      request(
        'POST',
        `/api/world/nodes/${chest.id}/claim-chest`,
        null,
        parallelUser.accessToken
      ),
      request(
        'POST',
        `/api/world/nodes/${chest.id}/claim-chest`,
        null,
        parallelUser.accessToken
      )
    ]);

    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.deepEqual(
      responses.map(response => response.body.already_claimed).sort(),
      [false, true]
    );
    assert.equal(responses[0].body.gold_awarded, responses[1].body.gold_awarded);
    assert.deepEqual(responses[0].body.items_awarded, responses[1].body.items_awarded);

    const persisted = await query(
      `SELECT u.gold, ucc.gold_awarded, ucc.items_awarded
       FROM users u
       JOIN user_chest_claims ucc ON ucc.user_id = u.id
       WHERE u.id = $1 AND ucc.node_id = $2`,
      [parallelUser.userId, chest.id]
    );
    assert.equal(persisted.rows.length, 1);
    assert.equal(
      persisted.rows[0].gold,
      balanceBefore.rows[0].gold + persisted.rows[0].gold_awarded
    );
    assert.equal(persisted.rows[0].gold_awarded, responses[0].body.gold_awarded);
    assert.deepEqual(persisted.rows[0].items_awarded, responses[0].body.items_awarded);

    const inventoryAfter = await query(
      `SELECT COALESCE(SUM(quantity), 0)::integer AS quantity
       FROM character_items
       WHERE user_id = $1`,
      [parallelUser.userId]
    );
    const expectedItemQuantity = responses[0].body.items_awarded.reduce(
      (total, item) => total + item.quantity,
      0
    );
    assert.equal(
      inventoryAfter.rows[0].quantity - inventoryBefore.rows[0].quantity,
      expectedItemQuantity
    );
  });

  it('serializes location authorization against a concurrent move', async () => {
    raceUser = await context.createUser();
    const raceCharacter = await context.createCharacter(raceUser.accessToken);
    const destinationResult = await query(
      `SELECT id
       FROM world_nodes
       WHERE id <> $1
       ORDER BY id
       LIMIT 1`,
      [chest.id]
    );
    const destinationId = destinationResult.rows[0].id;

    await query(
      `UPDATE characters
       SET current_node_id = $1, party_slot = 1
       WHERE id = $2`,
      [chest.id, raceCharacter.id]
    );

    const travelClient = await getClient();
    let transactionOpen = false;

    try {
      await travelClient.query('BEGIN');
      transactionOpen = true;
      await travelClient.query(
        'UPDATE characters SET current_node_id = $1 WHERE id = $2',
        [destinationId, raceCharacter.id]
      );

      let claimSettled = false;
      const claimPromise = request(
        'POST',
        `/api/world/nodes/${chest.id}/claim-chest`,
        null,
        raceUser.accessToken
      ).then(response => {
        claimSettled = true;
        return response;
      });

      // The claim must wait for the location-changing row lock instead of
      // authorizing against the stale pre-travel location.
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(claimSettled, false);

      await travelClient.query('COMMIT');
      transactionOpen = false;

      const racedClaim = await claimPromise;
      assert.equal(racedClaim.status, 400);
      assert.match(racedClaim.body.error, /must be at this location/i);

      const persistedClaim = await query(
        `SELECT 1
         FROM user_chest_claims
         WHERE user_id = $1 AND node_id = $2`,
        [raceUser.userId, chest.id]
      );
      assert.equal(persistedClaim.rows.length, 0);

      const finalLocation = await query(
        'SELECT current_node_id FROM characters WHERE id = $1',
        [raceCharacter.id]
      );
      assert.equal(finalLocation.rows[0].current_node_id, destinationId);
    } finally {
      if (transactionOpen) {
        await travelClient.query('ROLLBACK');
      }
      travelClient.release();
    }
  });
});
