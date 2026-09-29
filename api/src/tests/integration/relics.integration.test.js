import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, createTestContext, query, resetRateLimitersViaApi } from '../testHelper.js';

describe('Relics API', () => {
  let ctx;
  let user;

  before(async () => {
    await resetRateLimitersViaApi();
    ctx = createTestContext();
    user = await ctx.createUser();
  });

  after(async () => {
    if (user?.userId) {
      await query('DELETE FROM user_relics WHERE user_id = $1', [user.userId]);
    }
    await ctx.cleanup();
  });

  describe('GET /api/relics', () => {
    it('should return all available relics with ownership status', async () => {
      const res = await request('GET', '/api/relics', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.relics));
      assert.ok(res.body.relics.length >= 4, 'Should have at least 4 seeded relics');

      const relic = res.body.relics[0];
      assert.ok(relic.id && relic.key && relic.name && relic.rarity);
      assert.strictEqual(typeof relic.owned, 'boolean');
    });

    it('should require authentication', async () => {
      const res = await request('GET', '/api/relics');
      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/relics/owned', () => {
    it('should return empty array when user has no relics', async () => {
      const res = await request('GET', '/api/relics/owned', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.count, 0);
      assert.ok(Array.isArray(res.body.relics));
    });

    it('should return owned relics after granting', async () => {
      await request('POST', '/api/relics/grant/wayfarers_compass', {}, user.accessToken);

      const res = await request('GET', '/api/relics/owned', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.count, 1);
      assert.strictEqual(res.body.relics[0].key, 'wayfarers_compass');
    });
  });

  describe('POST /api/relics/:id/claim', () => {
    let claimUser;

    before(async () => {
      claimUser = await ctx.createUser();
    });

    after(async () => {
      if (claimUser?.userId) {
        await query('DELETE FROM user_relics WHERE user_id = $1', [claimUser.userId]);
      }
    });

    it('should fail to claim without meeting requirements', async () => {
      const relicsRes = await request('GET', '/api/relics', null, claimUser.accessToken);
      const questRelic = relicsRes.body.relics.find(r => r.acquisitionType === 'quest');

      const res = await request(
        'POST',
        `/api/relics/${questRelic.id}/claim`,
        { context: {} },
        claimUser.accessToken
      );

      assert.strictEqual(res.status, 400);
    });

    it('should successfully claim once any tier-1 advancement quest is completed', async () => {
      const character = await ctx.createCharacter(claimUser.accessToken);

      // Find a quest-acquisition relic the user does not yet own
      // acquisition_id now represents the tier requirement (1 = any tier-1 quest)
      const tplResult = await query(
        `SELECT id, key, acquisition_id FROM relic_templates
         WHERE acquisition_type = 'quest'
           AND id NOT IN (SELECT relic_id FROM user_relics WHERE user_id = $1)
         LIMIT 1`,
        [claimUser.userId]
      );
      // Assert that a quest relic exists (regression guard for migration 062/063)
      assert.ok(tplResult.rows.length > 0, 'Expected at least one quest relic to exist');
      const questRelic = tplResult.rows[0];

      // First attempt — without a completed quest, the claim must be rejected
      const blockedRes = await request(
        'POST',
        `/api/relics/${questRelic.id}/claim`,
        {},
        claimUser.accessToken
      );
      assert.strictEqual(blockedRes.status, 400, 'claim must require a real completion');

      // Get any tier-1 advancement quest template
      const questTplResult = await query(
        `SELECT id FROM advancement_quest_templates WHERE tier = 1 LIMIT 1`
      );
      assert.ok(questTplResult.rows.length > 0, 'Expected tier-1 quest template to exist');
      const questTemplateId = questTplResult.rows[0].id;

      // Insert a completed character_quest row for any tier-1 quest (class-agnostic)
      // Character is freshly created, so no conflict possible - use plain INSERT
      await query(
        `INSERT INTO character_quests (character_id, quest_template_id, status, completed_at)
         VALUES ($1, $2, 'completed', NOW())`,
        [character.id, questTemplateId]
      );

      const res = await request(
        'POST',
        `/api/relics/${questRelic.id}/claim`,
        {},
        claimUser.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.relic.key, questRelic.key);

      // Cleanup
      await query(
        'DELETE FROM character_quests WHERE character_id = $1 AND quest_template_id = $2',
        [character.id, questTemplateId]
      );
    });

    it('should return 404 for unknown relic id', async () => {
      const res = await request(
        'POST',
        '/api/relics/999999/claim',
        {},
        claimUser.accessToken
      );
      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.toLowerCase().includes('not found'));
    });

    it('should require marketplace sale to claim merchants_seal', async () => {
      // Get merchants_seal relic ID
      const relicsRes = await request('GET', '/api/relics', null, claimUser.accessToken);
      const merchantsRelic = relicsRes.body.relics.find(r => r.key === 'merchants_seal');
      assert.ok(merchantsRelic, 'merchants_seal relic should exist');

      // Fresh user has no marketplace sales, claim should fail
      const res = await request(
        'POST',
        `/api/relics/${merchantsRelic.id}/claim`,
        {},
        claimUser.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(
        res.body.error.toLowerCase().includes('marketplace') ||
        res.body.error.toLowerCase().includes('sale'),
        'Error should mention marketplace sale requirement'
      );
    });

    it('should ignore client-supplied questCompleted context (no longer trusted)', async () => {
      const tplResult = await query(
        `SELECT id FROM relic_templates
         WHERE acquisition_type = 'quest' AND acquisition_id IS NOT NULL
           AND id NOT IN (SELECT relic_id FROM user_relics WHERE user_id = $1)
         LIMIT 1`,
        [claimUser.userId]
      );
      if (tplResult.rows.length === 0) return;

      const res = await request(
        'POST',
        `/api/relics/${tplResult.rows[0].id}/claim`,
        { context: { questCompleted: true, guildRequirementMet: true, achievementCompleted: true } },
        claimUser.accessToken
      );
      assert.strictEqual(res.status, 400, 'service must not honor client-supplied flags');
    });

    it('should prevent claiming the same relic twice', async () => {
      await request('POST', '/api/relics/grant/cartographers_eye', {}, claimUser.accessToken);

      const relicsRes = await request('GET', '/api/relics', null, claimUser.accessToken);
      const relic = relicsRes.body.relics.find(r => r.key === 'cartographers_eye');

      const res = await request(
        'POST',
        `/api/relics/${relic.id}/claim`,
        { context: {} },
        claimUser.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.includes('already own'));
    });

    it('should reject invalid relic ID', async () => {
      const res = await request(
        'POST',
        '/api/relics/invalid/claim',
        { context: {} },
        claimUser.accessToken
      );
      assert.strictEqual(res.status, 400);
    });
  });

  describe('GET /api/relics/check/:key', () => {
    it('should return owned=false for unowned relic', async () => {
      const checkUser = await ctx.createUser();

      const res = await request(
        'GET',
        '/api/relics/check/merchants_seal',
        null,
        checkUser.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.owned, false);
      assert.strictEqual(res.body.effects, null);
    });

    it('should return owned=true with effects for owned relic', async () => {
      await request('POST', '/api/relics/grant/merchants_seal', {}, user.accessToken);

      const res = await request(
        'GET',
        '/api/relics/check/merchants_seal',
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.owned, true);
      assert.strictEqual(res.body.effects.fee_rate, 0.03);
    });
  });
});
