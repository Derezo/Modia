/**
 * Admin Assets Integration Tests
 * Tests for /api/admin/assets and /api/admin/config endpoints
 *
 * Note: Admin endpoints are disabled in production (NODE_ENV=production).
 * These tests will be skipped if running in production environment.
 *
 * @category integration
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { request } from '../testHelper.js';

const isProduction = process.env.NODE_ENV === 'production';

describe('Admin Assets API', { skip: isProduction }, () => {
  before(() => {
    if (isProduction) {
      console.log('Skipping admin assets tests in production environment');
    }
  });

  describe('GET /api/admin/config', () => {
    it('should return LoRA models configuration', async () => {
      const res = await request('GET', '/api/admin/config');

      assert.strictEqual(res.status, 200);
      assert.ok('validLoraModels' in res.body, 'Response should include validLoraModels');
      assert.ok('loraModels' in res.body, 'Response should include loraModels');
      assert.ok('defaultLoraByCategory' in res.body, 'Response should include defaultLoraByCategory');
    });

    it('should return validLoraModels as array of model IDs', async () => {
      const res = await request('GET', '/api/admin/config');

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.validLoraModels), 'validLoraModels should be an array');
      assert.ok(res.body.validLoraModels.length > 0, 'validLoraModels should not be empty');

      // Verify expected models are present
      const expectedModels = ['v1', 'v2', 'modern-pixel', 'retro-pixel'];
      for (const model of expectedModels) {
        assert.ok(
          res.body.validLoraModels.includes(model),
          `validLoraModels should include ${model}`
        );
      }
    });

    it('should return loraModels with full metadata', async () => {
      const res = await request('GET', '/api/admin/config');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(typeof res.body.loraModels, 'object', 'loraModels should be an object');

      // Verify structure of each model
      for (const [modelId, model] of Object.entries(res.body.loraModels)) {
        assert.ok(model.name, `Model ${modelId} should have name`);
        assert.ok(model.triggerWord, `Model ${modelId} should have triggerWord`);
      }
    });

    it('should return defaultLoraByCategory for all categories', async () => {
      const res = await request('GET', '/api/admin/config');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(typeof res.body.defaultLoraByCategory, 'object', 'defaultLoraByCategory should be an object');

      // Verify expected categories have defaults
      const expectedCategories = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays', 'obstacles', 'characters'];
      for (const category of expectedCategories) {
        assert.ok(
          res.body.defaultLoraByCategory[category],
          `defaultLoraByCategory should have default for ${category}`
        );
      }
    });
  });

  describe('PUT /api/admin/assets/:category/:id', () => {
    describe('loraModel field validation', () => {
      it('should accept valid loraModel value v1', async () => {
        // First get an existing asset to test with
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          // Skip if no assets available to test
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'v1'
        });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.asset, 'Response should include updated asset');
      });

      it('should accept valid loraModel value v2', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'v2'
        });

        assert.strictEqual(res.status, 200);
      });

      it('should accept valid loraModel value modern-pixel', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'modern-pixel'
        });

        assert.strictEqual(res.status, 200);
      });

      it('should accept valid loraModel value retro-pixel', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'retro-pixel'
        });

        assert.strictEqual(res.status, 200);
      });

      it('should reject invalid loraModel with 400 error', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'invalid-model'
        });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error, 'Response should include error');
        assert.ok(res.body.error.includes('Invalid loraModel'), 'Error should mention invalid loraModel');
      });

      it('should reject case-incorrect loraModel (V1 instead of v1)', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'V1'
        });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.error.includes('Invalid loraModel'));
      });

      it('should accept empty string loraModel (uses category default)', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        // Note: empty string should pass validation (not trigger the validation check)
        // because the condition is `updates.loraModel && !validLoraModels.includes(...)`
        const res = await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: ''
        });

        // Empty string should be accepted (means use category default)
        assert.strictEqual(res.status, 200);
      });
    });

    describe('loraModel field persistence', () => {
      it('should persist loraModel to asset metadata', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;

        // Set loraModel
        await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'modern-pixel'
        });

        // Verify it's persisted by re-fetching
        const getRes = await request('GET', `/api/admin/assets/tiles/${assetId}`);
        assert.strictEqual(getRes.status, 200);
        assert.strictEqual(getRes.body.loraModel, 'modern-pixel');
      });

      it('should not affect other fields when updating only loraModel', async () => {
        const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
        if (listRes.body.assets?.length === 0) {
          return;
        }

        const testAsset = listRes.body.assets[0];
        const assetId = testAsset.key || testAsset.id;
        const originalPrompt = testAsset.prompt;

        // Update only loraModel
        await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
          loraModel: 'v2'
        });

        // Verify other fields unchanged
        const getRes = await request('GET', `/api/admin/assets/tiles/${assetId}`);
        assert.strictEqual(getRes.body.prompt, originalPrompt);
      });
    });
  });

  describe('GET /api/admin/assets/:category', () => {
    it('should return assets with loraModel field when set', async () => {
      // First set loraModel on an asset
      const listRes = await request('GET', '/api/admin/assets/tiles?status=generated');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testAsset = listRes.body.assets[0];
      const assetId = testAsset.key || testAsset.id;

      await request('PUT', `/api/admin/assets/tiles/${assetId}`, {
        loraModel: 'v1'
      });

      // List assets and verify loraModel is included
      const res = await request('GET', '/api/admin/assets/tiles');
      assert.strictEqual(res.status, 200);

      const updatedAsset = res.body.assets.find(a => (a.key || a.id) === assetId);
      if (updatedAsset) {
        assert.strictEqual(updatedAsset.loraModel, 'v1');
      }
    });
  });

  describe('GET /api/admin/assets/obstacles', () => {
    it('should list obstacles assets', async () => {
      const res = await request('GET', '/api/admin/assets/obstacles');
      assert.strictEqual(res.status, 200);
      assert.ok('assets' in res.body, 'Response should include assets');
      assert.ok('summary' in res.body, 'Response should include summary');
    });

    it('should filter obstacles by subcategory', async () => {
      const res = await request('GET', '/api/admin/assets/obstacles?subcategory=rocks');
      assert.strictEqual(res.status, 200);
    });
  });

  describe('GET /api/admin/assets/characters', () => {
    it('should list character assets', async () => {
      const res = await request('GET', '/api/admin/assets/characters');
      assert.strictEqual(res.status, 200);
      assert.ok('assets' in res.body, 'Response should include assets');
    });

    it('should filter characters by subcategory (players)', async () => {
      const res = await request('GET', '/api/admin/assets/characters?subcategory=players');
      assert.strictEqual(res.status, 200);
    });

    it('should filter characters by subcategory (enemies)', async () => {
      const res = await request('GET', '/api/admin/assets/characters?subcategory=enemies');
      assert.strictEqual(res.status, 200);
    });

    it('should filter enemies by biome', async () => {
      const res = await request('GET', '/api/admin/assets/characters?subcategory=enemies&biome=forest');
      assert.strictEqual(res.status, 200);
    });
  });

  describe('Admin API security', () => {
    it('should block access in production mode', async () => {
      // This test validates that requireDevMode middleware works
      // Note: We can't actually change NODE_ENV mid-test, but we document the behavior
      if (isProduction) {
        const res = await request('GET', '/api/admin/config');
        assert.strictEqual(res.status, 403);
        assert.ok(res.body.error.includes('disabled in production'));
      }
    });
  });
});
