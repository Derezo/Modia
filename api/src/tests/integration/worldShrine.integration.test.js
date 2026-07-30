import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  createTestContext,
  query,
  request
} from '../testHelper.js';

const HOUR_MS = 60 * 60 * 1000;
const TIMING_TOLERANCE_MS = 15 * 1000;

describe('World shrine activity', () => {
  let context;
  let shrine;
  let zodiacShrines;
  let regularShrine;
  let user;
  let character;
  let concurrentUser;
  let concurrentCharacter;
  let shrineNeighborId;

  async function placeAtShrine(testUser, testCharacter, targetShrine = shrine) {
    await query(
      `UPDATE characters
       SET current_node_id = $1, party_slot = 1
       WHERE id = $2`,
      [targetShrine.id, testCharacter.id]
    );
    await query(
      `INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
       VALUES ($1, $2, 'travel')
       ON CONFLICT (user_id, node_id)
       DO UPDATE SET discovery_method = 'travel'`,
      [testUser.userId, targetShrine.id]
    );
  }

  async function visitShrine(testUser, testCharacter, targetShrine) {
    await placeAtShrine(testUser, testCharacter, targetShrine);
    return request(
      'POST',
      `/api/world/nodes/${targetShrine.id}/visit-shrine`,
      null,
      testUser.accessToken
    );
  }

  before(async () => {
    context = createTestContext();
    const shrineResult = await query(
      `SELECT id, name, shrine_buff_type, zodiac_sign
       FROM world_nodes
       WHERE node_type = 'shrine'
         AND zodiac_sign IS NOT NULL
       ORDER BY id
       LIMIT 4`
    );
    if (shrineResult.rows.length < 4) {
      throw new Error('Fewer than four zodiac shrines found in seeded world');
    }
    zodiacShrines = shrineResult.rows;
    [shrine] = zodiacShrines;

    const regularShrineResult = await query(
      `SELECT id, name, shrine_buff_type, zodiac_sign
       FROM world_nodes
       WHERE node_type = 'shrine'
         AND zodiac_sign IS NULL
         AND shrine_buff_type IS NOT NULL
       ORDER BY id
       LIMIT 1`
    );
    if (regularShrineResult.rows.length === 0) {
      throw new Error('No standard shrine found in seeded world');
    }
    [regularShrine] = regularShrineResult.rows;

    const neighborResult = await query(
      `SELECT CASE
                WHEN from_node_id = $1 THEN to_node_id
                ELSE from_node_id
              END AS neighbor_id
       FROM world_node_connections
       WHERE from_node_id = $1 OR to_node_id = $1
       ORDER BY id
       LIMIT 1`,
      [shrine.id]
    );
    if (neighborResult.rows.length === 0) {
      throw new Error('Zodiac shrine has no connected node');
    }
    shrineNeighborId = neighborResult.rows[0].neighbor_id;

    user = await context.createUser();
    character = await context.createCharacter(user.accessToken);
    await placeAtShrine(user, character);

    concurrentUser = await context.createUser();
    concurrentCharacter = await context.createCharacter(concurrentUser.accessToken);
    await placeAtShrine(concurrentUser, concurrentCharacter);
  });

  after(async () => {
    await context.cleanup();
  });

  it('publishes identity and private availability, then updates all shrine state', async () => {
    const initialCurrent = await request(
      'GET',
      '/api/world/current',
      null,
      user.accessToken
    );
    assert.equal(initialCurrent.status, 200);
    assert.equal(initialCurrent.body.currentNode.id, shrine.id);
    assert.equal(
      initialCurrent.body.currentNode.shrine_buff_type,
      shrine.shrine_buff_type
    );
    assert.equal(initialCurrent.body.currentNode.zodiac_sign, shrine.zodiac_sign);
    assert.equal(initialCurrent.body.currentNode.shrine_available, true);
    assert.equal(initialCurrent.body.currentNode.shrine_on_cooldown, false);
    assert.equal(initialCurrent.body.currentNode.shrine_buff_active, false);
    assert.equal(initialCurrent.body.currentNode.shrine_cooldown_until, null);
    assert.ok(initialCurrent.body.availableActions.some(action =>
      action.type === 'visit_shrine' && action.enabled === true
    ));

    const initialWorld = await request(
      'GET',
      '/api/world/nodes',
      null,
      user.accessToken
    );
    assert.equal(initialWorld.status, 200);
    const initialWorldShrine = initialWorld.body.nodes.find(node => node.id === shrine.id);
    assert.equal(initialWorldShrine.zodiac_sign, shrine.zodiac_sign);
    assert.equal(initialWorldShrine.shrine_buff_type, shrine.shrine_buff_type);
    assert.equal(initialWorldShrine.shrine_available, true);

    const initialDetails = await request(
      'GET',
      `/api/world/nodes/${shrine.id}`,
      null,
      user.accessToken
    );
    assert.equal(initialDetails.status, 200);
    assert.equal(initialDetails.body.node.zodiac_sign, shrine.zodiac_sign);
    assert.equal(initialDetails.body.node.shrine_available, true);

    const visit = await request(
      'POST',
      `/api/world/nodes/${shrine.id}/visit-shrine`,
      null,
      user.accessToken
    );
    assert.equal(visit.status, 200);
    assert.equal(visit.body.success, true);
    assert.equal(visit.body.buff_type, `zodiac_${shrine.zodiac_sign}`);
    assert.equal(visit.body.duration_hours, 4);
    assert.equal(visit.body.cooldown_hours, 6);
    assert.equal(visit.body.shrine_buff_active, true);
    assert.equal(visit.body.shrine_on_cooldown, true);
    assert.equal(visit.body.zodiacSign, shrine.zodiac_sign);
    assert.equal(visit.body.crystalAwarded, true);
    assert.equal(visit.body.zodiacBlessingSlots, 1);
    assert.equal(visit.body.activeZodiacBlessings, 1);
    assert.deepEqual(visit.body.replacedBlessings, []);

    const visitedAt = new Date(visit.body.visited_at).getTime();
    const expiresAt = new Date(visit.body.expires_at).getTime();
    const cooldownUntil = new Date(visit.body.shrine_cooldown_until).getTime();
    assert.ok(Number.isFinite(visitedAt));
    assert.ok(Math.abs(expiresAt - visitedAt - (4 * HOUR_MS)) < TIMING_TOLERANCE_MS);
    assert.ok(
      Math.abs(cooldownUntil - visitedAt - (6 * HOUR_MS)) < TIMING_TOLERANCE_MS
    );

    const activeBuffs = await request(
      'GET',
      '/api/world/active-buffs',
      null,
      user.accessToken
    );
    assert.equal(activeBuffs.status, 200);
    const activeBuff = activeBuffs.body.buffs.find(
      buff => buff.buff_type === `zodiac_${shrine.zodiac_sign}`
    );
    assert.equal(activeBuff.node_id, shrine.id);
    assert.equal(activeBuff.zodiac_sign, shrine.zodiac_sign);
    assert.equal(activeBuff.buff_info.name, visit.body.buff_name);
    assert.equal(
      activeBuff.buff_info.signatureAbility,
      visit.body.signatureAbility.name
    );

    const updatedCurrent = await request(
      'GET',
      '/api/world/current',
      null,
      user.accessToken
    );
    assert.equal(updatedCurrent.status, 200);
    assert.equal(updatedCurrent.body.currentNode.shrine_available, false);
    assert.equal(updatedCurrent.body.currentNode.shrine_on_cooldown, true);
    assert.equal(updatedCurrent.body.currentNode.shrine_buff_active, true);
    assert.equal(
      updatedCurrent.body.currentNode.shrine_buff_expires_at,
      visit.body.expires_at
    );
    assert.equal(
      updatedCurrent.body.currentNode.shrine_cooldown_until,
      visit.body.shrine_cooldown_until
    );
    assert.ok(updatedCurrent.body.availableActions.some(action =>
      action.type === 'visit_shrine'
      && action.enabled === false
      && action.cooldown_until === visit.body.shrine_cooldown_until
    ));

    await query(
      'UPDATE characters SET current_node_id = $1 WHERE id = $2',
      [shrineNeighborId, character.id]
    );
    await query(
      `INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
       VALUES ($1, $2, 'travel')
       ON CONFLICT (user_id, node_id)
       DO UPDATE SET discovery_method = 'travel'`,
      [user.userId, shrineNeighborId]
    );
    const travel = await request(
      'POST',
      '/api/world/travel',
      { targetNodeId: shrine.id },
      user.accessToken
    );
    assert.equal(travel.status, 200);
    assert.equal(travel.body.currentNode.id, shrine.id);
    assert.equal(travel.body.currentNode.zodiac_sign, shrine.zodiac_sign);
    assert.equal(travel.body.currentNode.shrine_available, false);
    assert.equal(travel.body.currentNode.shrine_on_cooldown, true);
    assert.equal(
      travel.body.currentNode.shrine_cooldown_until,
      visit.body.shrine_cooldown_until
    );

    const retry = await request(
      'POST',
      `/api/world/nodes/${shrine.id}/visit-shrine`,
      null,
      user.accessToken
    );
    assert.equal(retry.status, 400);
    assert.equal(retry.body.shrine_on_cooldown, true);
    assert.equal(retry.body.cooldown_hours, 6);
    assert.equal(
      retry.body.shrine_cooldown_until,
      visit.body.shrine_cooldown_until
    );
    assert.ok(retry.body.remaining_seconds > 0);

    const invalidNode = await request(
      'POST',
      '/api/world/nodes/not-a-node/visit-shrine',
      null,
      user.accessToken
    );
    assert.equal(invalidNode.status, 400);
    assert.match(invalidNode.body.error, /Invalid node ID/);
  });

  it('does not leak another user state and serializes concurrent visits', async () => {
    const privateState = await request(
      'GET',
      `/api/world/nodes/${shrine.id}`,
      null,
      concurrentUser.accessToken
    );
    assert.equal(privateState.status, 200);
    assert.equal(privateState.body.node.shrine_available, true);
    assert.equal(privateState.body.node.shrine_on_cooldown, false);
    assert.equal(privateState.body.node.shrine_buff_active, false);
    assert.equal(privateState.body.node.shrine_cooldown_until, null);

    const privateWorld = await request(
      'GET',
      '/api/world/nodes',
      null,
      concurrentUser.accessToken
    );
    assert.equal(privateWorld.status, 200);
    const privateWorldShrine = privateWorld.body.nodes.find(
      node => node.id === shrine.id
    );
    assert.equal(privateWorldShrine.shrine_available, true);
    assert.equal(privateWorldShrine.shrine_on_cooldown, false);
    assert.equal(privateWorldShrine.shrine_buff_active, false);

    const privateCurrent = await request(
      'GET',
      '/api/world/current',
      null,
      concurrentUser.accessToken
    );
    assert.equal(privateCurrent.status, 200);
    assert.equal(privateCurrent.body.currentNode.shrine_available, true);
    assert.equal(privateCurrent.body.currentNode.shrine_on_cooldown, false);
    assert.equal(privateCurrent.body.currentNode.shrine_buff_active, false);

    await query(
      'UPDATE characters SET current_node_id = $1 WHERE id = $2',
      [shrineNeighborId, concurrentCharacter.id]
    );
    await query(
      `INSERT INTO user_node_discovery (user_id, node_id, discovery_method)
       VALUES ($1, $2, 'travel')
       ON CONFLICT (user_id, node_id)
       DO UPDATE SET discovery_method = 'travel'`,
      [concurrentUser.userId, shrineNeighborId]
    );
    const privateTravel = await request(
      'POST',
      '/api/world/travel',
      { targetNodeId: shrine.id },
      concurrentUser.accessToken
    );
    assert.equal(privateTravel.status, 200);
    assert.equal(privateTravel.body.currentNode.shrine_available, true);
    assert.equal(privateTravel.body.currentNode.shrine_on_cooldown, false);
    assert.equal(privateTravel.body.currentNode.shrine_buff_active, false);

    const visits = await Promise.all([
      request(
        'POST',
        `/api/world/nodes/${shrine.id}/visit-shrine`,
        null,
        concurrentUser.accessToken
      ),
      request(
        'POST',
        `/api/world/nodes/${shrine.id}/visit-shrine`,
        null,
        concurrentUser.accessToken
      )
    ]);
    assert.deepEqual(visits.map(response => response.status).sort(), [200, 400]);

    const persistedVisits = await query(
      `SELECT COUNT(*)::integer AS count
       FROM user_shrine_visits
       WHERE user_id = $1 AND node_id = $2`,
      [concurrentUser.userId, shrine.id]
    );
    assert.equal(persistedVisits.rows[0].count, 1);

    const persistedCrystals = await query(
      `SELECT COUNT(*)::integer AS count
       FROM user_zodiac_crystals
       WHERE user_id = $1 AND zodiac_sign = $2`,
      [concurrentUser.userId, shrine.zodiac_sign]
    );
    assert.equal(persistedCrystals.rows[0].count, 1);
  });

  it('replaces the oldest zodiac blessing in the default single slot', async () => {
    const slotUser = await context.createUser();
    const slotCharacter = await context.createCharacter(slotUser.accessToken);

    const standardVisit = await visitShrine(
      slotUser,
      slotCharacter,
      regularShrine
    );
    assert.equal(standardVisit.status, 200);
    assert.equal(standardVisit.body.buff_type, regularShrine.shrine_buff_type);

    const firstZodiacVisit = await visitShrine(
      slotUser,
      slotCharacter,
      zodiacShrines[0]
    );
    assert.equal(firstZodiacVisit.status, 200);
    assert.equal(firstZodiacVisit.body.zodiacBlessingSlots, 1);
    assert.equal(firstZodiacVisit.body.activeZodiacBlessings, 1);
    assert.deepEqual(firstZodiacVisit.body.replacedBlessings, []);

    const secondZodiacVisit = await visitShrine(
      slotUser,
      slotCharacter,
      zodiacShrines[1]
    );
    assert.equal(secondZodiacVisit.status, 200);
    assert.equal(secondZodiacVisit.body.zodiacBlessingSlots, 1);
    assert.equal(secondZodiacVisit.body.activeZodiacBlessings, 1);
    assert.equal(secondZodiacVisit.body.replacedBlessings.length, 1);
    assert.equal(
      secondZodiacVisit.body.replacedBlessings[0].nodeId,
      zodiacShrines[0].id
    );
    assert.equal(
      secondZodiacVisit.body.replacedBlessings[0].zodiacSign,
      zodiacShrines[0].zodiac_sign
    );
    assert.equal(
      secondZodiacVisit.body.replacedBlessings[0].buffName,
      firstZodiacVisit.body.buff_name
    );
    assert.match(
      secondZodiacVisit.body.message,
      new RegExp(`${firstZodiacVisit.body.buff_name} faded`)
    );

    const activeBuffs = await request(
      'GET',
      '/api/world/active-buffs',
      null,
      slotUser.accessToken
    );
    assert.equal(activeBuffs.status, 200);
    assert.ok(activeBuffs.body.buffs.some(
      buff => buff.buff_type === regularShrine.shrine_buff_type
    ));
    assert.ok(activeBuffs.body.buffs.some(
      buff => buff.node_id === zodiacShrines[1].id
    ));
    assert.ok(!activeBuffs.body.buffs.some(
      buff => buff.node_id === zodiacShrines[0].id
    ));
  });

  it('ignores malformed legacy crystal signs for completion rewards', async () => {
    const legacyUser = await context.createUser();
    const legacyCharacter = await context.createCharacter(legacyUser.accessToken);

    await query(
      `INSERT INTO user_zodiac_crystals (user_id, zodiac_sign, shrine_node_id)
       SELECT $1, 'legacy_sign_' || value, $2
       FROM generate_series(1, 12) AS value`,
      [legacyUser.userId, shrine.id]
    );

    const visit = await visitShrine(
      legacyUser,
      legacyCharacter,
      shrine
    );
    assert.equal(visit.status, 200);
    assert.equal(visit.body.totalCrystals, 1);
    assert.equal(visit.body.collectionComplete, false);
    assert.equal(visit.body.zodiacBlessingSlots, 1);

    const collection = await request(
      'GET',
      '/api/world/zodiac-collection',
      null,
      legacyUser.accessToken
    );
    assert.equal(collection.status, 200);
    assert.equal(collection.body.totalCollected, 1);
    assert.equal(collection.body.collectionComplete, false);
    assert.equal(
      collection.body.crystals.filter(crystal => crystal.collected).length,
      1
    );
  });

  it('expires malformed legacy blessings without consuming Zodiac slots', async () => {
    const legacyUser = await context.createUser();
    const legacyCharacter = await context.createCharacter(
      legacyUser.accessToken
    );

    await query(
      `INSERT INTO user_zodiac_crystals (user_id, zodiac_sign, shrine_node_id)
       SELECT $1, zodiac_sign, id
       FROM world_nodes
       WHERE node_type = 'shrine' AND zodiac_sign IS NOT NULL
       ON CONFLICT (user_id, zodiac_sign) DO NOTHING`,
      [legacyUser.userId]
    );
    await query(
      `INSERT INTO user_shrine_visits (
         user_id, node_id, buff_type, expires_at, last_visited_at,
         signature_ability
       )
       VALUES
         ($1, $2, $3, NOW() + INTERVAL '2 hours',
          NOW() - INTERVAL '20 minutes', 'legacy_wrong_signature'),
         ($1, $4, 'zodiac_legacy', NOW() + INTERVAL '2 hours',
          NOW() - INTERVAL '10 minutes', 'legacy_unknown_signature')`,
      [
        legacyUser.userId,
        zodiacShrines[0].id,
        `zodiac_${zodiacShrines[0].zodiac_sign}`,
        regularShrine.id
      ]
    );

    const visit = await visitShrine(
      legacyUser,
      legacyCharacter,
      zodiacShrines[1]
    );
    assert.equal(visit.status, 200);
    assert.equal(visit.body.collectionComplete, true);
    assert.equal(visit.body.zodiacBlessingSlots, 2);
    assert.equal(visit.body.activeZodiacBlessings, 1);
    assert.deepEqual(visit.body.replacedBlessings, []);

    const persisted = await query(
      `SELECT node_id, expires_at > NOW() AS active
       FROM user_shrine_visits
       WHERE user_id = $1
         AND node_id = ANY($2::int[])
       ORDER BY node_id`,
      [
        legacyUser.userId,
        [zodiacShrines[0].id, regularShrine.id, zodiacShrines[1].id]
      ]
    );
    const activeByNode = new Map(
      persisted.rows.map(row => [row.node_id, row.active])
    );
    assert.equal(activeByNode.get(zodiacShrines[0].id), false);
    assert.equal(activeByNode.get(regularShrine.id), false);
    assert.equal(activeByNode.get(zodiacShrines[1].id), true);
  });

  it('holds two completed-collection blessings and normalizes legacy excess', async () => {
    const completedUser = await context.createUser();
    const completedCharacter = await context.createCharacter(
      completedUser.accessToken
    );

    await query(
      `INSERT INTO user_zodiac_crystals (user_id, zodiac_sign, shrine_node_id)
       SELECT $1, zodiac_sign, id
       FROM world_nodes
       WHERE node_type = 'shrine' AND zodiac_sign IS NOT NULL
       ON CONFLICT (user_id, zodiac_sign) DO NOTHING`,
      [completedUser.userId]
    );

    const firstVisit = await visitShrine(
      completedUser,
      completedCharacter,
      zodiacShrines[0]
    );
    assert.equal(firstVisit.status, 200);
    assert.equal(firstVisit.body.collectionComplete, true);
    assert.equal(firstVisit.body.zodiacBlessingSlots, 2);
    assert.equal(firstVisit.body.activeZodiacBlessings, 1);
    assert.deepEqual(firstVisit.body.replacedBlessings, []);
    assert.equal(firstVisit.body.collectionTitle, 'Celestial Wanderer');
    assert.equal(firstVisit.body.collectionTitleAwarded, true);

    const persistedTitle = await query(
      `SELECT title, is_active
       FROM character_titles
       WHERE character_id = $1 AND title = 'Celestial Wanderer'`,
      [completedCharacter.id]
    );
    assert.equal(persistedTitle.rowCount, 1);
    assert.equal(persistedTitle.rows[0].is_active, false);

    const secondVisit = await visitShrine(
      completedUser,
      completedCharacter,
      zodiacShrines[1]
    );
    assert.equal(secondVisit.status, 200);
    assert.equal(secondVisit.body.zodiacBlessingSlots, 2);
    assert.equal(secondVisit.body.activeZodiacBlessings, 2);
    assert.deepEqual(secondVisit.body.replacedBlessings, []);
    assert.equal(secondVisit.body.collectionTitleAwarded, false);

    const thirdVisit = await visitShrine(
      completedUser,
      completedCharacter,
      zodiacShrines[2]
    );
    assert.equal(thirdVisit.status, 200);
    assert.equal(thirdVisit.body.zodiacBlessingSlots, 2);
    assert.equal(thirdVisit.body.activeZodiacBlessings, 2);
    assert.equal(thirdVisit.body.replacedBlessings.length, 1);
    assert.equal(thirdVisit.body.replacedBlessings[0].nodeId, zodiacShrines[0].id);

    // Reintroduce an extra active blessing to represent legacy state. The
    // next activation must collapse four would-be blessings to the two-slot
    // entitlement by expiring the two oldest records.
    await query(
      `UPDATE user_shrine_visits
       SET expires_at = NOW() + INTERVAL '2 hours',
           last_visited_at = NOW() - INTERVAL '10 minutes'
       WHERE user_id = $1 AND node_id = $2`,
      [completedUser.userId, zodiacShrines[0].id]
    );

    const normalizedVisit = await visitShrine(
      completedUser,
      completedCharacter,
      zodiacShrines[3]
    );
    assert.equal(normalizedVisit.status, 200);
    assert.equal(normalizedVisit.body.zodiacBlessingSlots, 2);
    assert.equal(normalizedVisit.body.activeZodiacBlessings, 2);
    assert.equal(normalizedVisit.body.replacedBlessings.length, 2);
    assert.ok(normalizedVisit.body.replacedBlessings.some(
      blessing => blessing.nodeId === zodiacShrines[0].id
    ));

    const activeZodiacCount = await query(
      `SELECT COUNT(*)::integer AS count
       FROM user_shrine_visits usv
       JOIN world_nodes wn ON wn.id = usv.node_id
       WHERE usv.user_id = $1
         AND usv.expires_at > NOW()
         AND (
           wn.zodiac_sign IS NOT NULL
           OR LEFT(usv.buff_type, 7) = 'zodiac_'
         )`,
      [completedUser.userId]
    );
    assert.equal(activeZodiacCount.rows[0].count, 2);
  });
});
