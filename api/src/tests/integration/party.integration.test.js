import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query } from '../testHelper.js';

describe('Party API', () => {
  const ctx = createTestContext();
  let user, mainCharId, secondCharId;

  before(async () => {
    user = await ctx.createUser();
    const charRes = await ctx.createCharacter(user.accessToken);
    mainCharId = charRes.id;

    // Insert second character directly to bypass creation block
    // (POST /api/characters only allows one character per user)
    const recruitName = `Recruit${Date.now().toString(36).slice(-6)}`;
    const result = await query(
      `INSERT INTO characters (user_id, name, race, class, gender, level, party_slot, current_node_id, hp_current, hp_max, mp_current, mp_max, strength, intelligence, agility, vitality, luck)
       SELECT $1, $2, 'human', 'warrior', 'male', 1, 2, current_node_id, 100, 100, 50, 50, 10, 10, 10, 10, 10
       FROM characters WHERE id = $3
       RETURNING id`,
      [user.userId, recruitName, mainCharId]
    );
    secondCharId = result.rows[0].id;
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('PUT /api/party - main character slot validation', () => {
    it('should reject formation with main character not in slot 1', async () => {
      const res = await request('PUT', '/api/party', {
        formation: [
          { characterId: secondCharId, slot: 1 },
          { characterId: mainCharId, slot: 2 }
        ]
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Main character must remain in slot 1'));
    });

    it('should accept formation with main character in slot 1', async () => {
      const res = await request('PUT', '/api/party', {
        formation: [
          { characterId: mainCharId, slot: 1 },
          { characterId: secondCharId, slot: 2 }
        ]
      }, user.accessToken);

      assert.strictEqual(res.status, 200);
    });

    it('should reject party mutations while an owned character is in battle', async () => {
      await query(
        'UPDATE characters SET in_battle = true WHERE id = $1',
        [secondCharId]
      );

      try {
        const before = await query(
          `SELECT id, party_slot
           FROM characters
           WHERE user_id = $1
           ORDER BY id`,
          [user.userId]
        );
        const formationResponse = await request('PUT', '/api/party', {
          formation: [
            { characterId: mainCharId, slot: 1 },
            { characterId: secondCharId, slot: 2 }
          ]
        }, user.accessToken);
        const battlePartyResponse = await request('PUT', '/api/party/battle', {
          characterIds: [mainCharId, secondCharId]
        }, user.accessToken);

        assert.strictEqual(formationResponse.status, 400);
        assert.match(formationResponse.body.error, /during battle/i);
        assert.strictEqual(battlePartyResponse.status, 400);
        assert.match(battlePartyResponse.body.error, /during battle/i);

        const after = await query(
          `SELECT id, party_slot
           FROM characters
           WHERE user_id = $1
           ORDER BY id`,
          [user.userId]
        );
        assert.deepStrictEqual(after.rows, before.rows);
      } finally {
        await query(
          'UPDATE characters SET in_battle = false WHERE id = $1',
          [secondCharId]
        );
      }
    });
  });
});
