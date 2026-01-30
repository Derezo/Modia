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

    it('should successfully claim with valid requirements', async () => {
      const relicsRes = await request('GET', '/api/relics', null, claimUser.accessToken);
      const questRelic = relicsRes.body.relics.find(
        r => r.acquisitionType === 'quest' && !r.owned
      );

      const res = await request(
        'POST',
        `/api/relics/${questRelic.id}/claim`,
        { context: { questCompleted: true } },
        claimUser.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.relic.key, questRelic.key);
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
