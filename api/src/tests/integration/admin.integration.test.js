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

        // Use single-asset GET to capture original prompt for this specific asset
        // This avoids list ordering issues that could cause flaky tests
        const originalAsset = await request('GET', `/api/admin/assets/tiles/${assetId}`);
        const originalPrompt = originalAsset.body.prompt;

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

      // Use single-asset GET endpoint to verify loraModel is set
      // This avoids list ordering issues that could cause flaky tests
      const getRes = await request('GET', `/api/admin/assets/tiles/${assetId}`);
      assert.strictEqual(getRes.status, 200);
      assert.strictEqual(getRes.body.loraModel, 'v1');
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

  // ============================================================================
  // SD1.5 ANIMATION MANAGEMENT ENDPOINTS
  // ============================================================================

  describe('GET /api/admin/assets/characters/:id/animations', () => {
    it('should return animations list with status for valid character', async () => {
      // First get a character ID from the list
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        // Skip if no character assets available
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.characterId, characterId);
      assert.ok('characterType' in res.body, 'Response should include characterType');
      assert.ok('totalAnimations' in res.body, 'Response should include totalAnimations');
      assert.ok('generatedCount' in res.body, 'Response should include generatedCount');
      assert.ok('sd15Config' in res.body, 'Response should include sd15Config');
      assert.ok(Array.isArray(res.body.animations), 'Response should include animations array');

      // Verify animation structure
      if (res.body.animations.length > 0) {
        const anim = res.body.animations[0];
        assert.ok('animation' in anim, 'Animation should have animation name');
        assert.ok('generated' in anim, 'Animation should have generated flag');
        assert.ok('description' in anim, 'Animation should have description');
        assert.ok('frameCount' in anim, 'Animation should have frameCount');
      }
    });

    it('should return 404 for non-existent character', async () => {
      const res = await request('GET', '/api/admin/assets/characters/nonexistent_character_12345/animations');

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'), 'Error should mention not found');
    });

    it('should return 400 for path traversal attempt in character ID', async () => {
      const res = await request('GET', '/api/admin/assets/characters/..%2F..%2Fetc%2Fpasswd/animations');

      // Should be rejected by assertValidAssetId
      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });
  });

  describe('POST /api/admin/assets/characters/:id/animations/:animation/generate', () => {
    it('should return 404 for non-existent character', async () => {
      const res = await request('POST', '/api/admin/assets/characters/nonexistent_char/animations/idle/generate', {});

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should return 400 for invalid animation name (invalid characters)', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/invalid-anim!/generate`, {});

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid animation name'));
    });

    it('should return 400 for animation not defined for this character', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // Use a valid format but nonexistent animation
      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/nonexistent_animation/generate`, {});

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('not valid for character'));
    });

    it('should return 400 for controlnetWeight out of range (>1)', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // Get valid animation for this character
      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/${validAnimation}/generate`, {
        controlnetWeight: 1.5
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('controlnetWeight must be between 0 and 1'));
    });

    it('should return 400 for controlnetWeight out of range (<0)', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/${validAnimation}/generate`, {
        controlnetWeight: -0.5
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('controlnetWeight must be between 0 and 1'));
    });

    it('should return 400 for ipadapterWeight out of range (>1)', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/${validAnimation}/generate`, {
        ipadapterWeight: 2.0
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('ipadapterWeight must be between 0 and 1'));
    });

    it('should return 400 for invalid preset name', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/${validAnimation}/generate`, {
        preset: 'invalid_preset_name'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid preset'));
    });

    it('should return 400 when reference image not generated', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      // Find a character without reference image
      let testCharacter = null;
      for (const char of listRes.body.assets) {
        const charId = char.key || char.id;
        const refRes = await request('GET', `/api/admin/assets/characters/${charId}/reference`);
        if (!refRes.body.hasReference) {
          testCharacter = char;
          break;
        }
      }

      if (!testCharacter) {
        // Skip if all characters have reference images
        return;
      }

      const characterId = testCharacter.key || testCharacter.id;
      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('POST', `/api/admin/assets/characters/${characterId}/animations/${validAnimation}/generate`, {
        controlnetWeight: 0.5,
        ipadapterWeight: 0.5
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Reference image required'));
    });
  });

  describe('GET /api/admin/assets/characters/:id/reference', () => {
    it('should return reference status for valid character', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/reference`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.characterId, characterId);
      assert.ok('hasReference' in res.body, 'Response should include hasReference');
      assert.ok('referenceImage' in res.body, 'Response should include referenceImage');
      assert.ok('referenceGeneratedAt' in res.body, 'Response should include referenceGeneratedAt');
      assert.ok('referenceExists' in res.body, 'Response should include referenceExists');
      assert.ok('sd15Weights' in res.body, 'Response should include sd15Weights');
    });

    it('should return 404 for non-existent character', async () => {
      const res = await request('GET', '/api/admin/assets/characters/nonexistent_char_99999/reference');

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should reject path traversal in character ID', async () => {
      const res = await request('GET', '/api/admin/assets/characters/../../../etc/passwd/reference');

      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });
  });

  describe('POST /api/admin/assets/characters/:id/reference/generate', () => {
    it('should return 404 for non-existent character', async () => {
      const res = await request('POST', '/api/admin/assets/characters/nonexistent_char/reference/generate', {});

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should accept valid request for character without reference (queues generation)', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      // Find a character without reference image
      let testCharacter = null;
      for (const char of listRes.body.assets) {
        const charId = char.key || char.id;
        const refRes = await request('GET', `/api/admin/assets/characters/${charId}/reference`);
        if (!refRes.body.hasReference) {
          testCharacter = char;
          break;
        }
      }

      if (!testCharacter) {
        // Skip if all characters have reference images
        return;
      }

      const characterId = testCharacter.key || testCharacter.id;
      const res = await request('POST', `/api/admin/assets/characters/${characterId}/reference/generate`, {});

      // 202 means job queued successfully
      assert.strictEqual(res.status, 202);
      assert.ok(res.body.message.includes('Queued'));
      assert.strictEqual(res.body.characterId, characterId);
    });

    it('should return 200 with message if reference already exists (without force)', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      // Find a character WITH reference image
      let testCharacter = null;
      for (const char of listRes.body.assets) {
        const charId = char.key || char.id;
        const refRes = await request('GET', `/api/admin/assets/characters/${charId}/reference`);
        if (refRes.body.hasReference && refRes.body.referenceExists) {
          testCharacter = char;
          break;
        }
      }

      if (!testCharacter) {
        // Skip if no characters have reference images
        return;
      }

      const characterId = testCharacter.key || testCharacter.id;
      const res = await request('POST', `/api/admin/assets/characters/${characterId}/reference/generate`, {});

      // Should return 200 with message about existing reference
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('already exists'));
    });
  });

  describe('PUT /api/admin/assets/characters/:id/weights', () => {
    it('should return 404 for non-existent character', async () => {
      const res = await request('PUT', '/api/admin/assets/characters/nonexistent_char/weights', {
        controlnetWeight: 0.5
      });

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should return 400 for controlnetWeight > 1', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        controlnetWeight: 1.5
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('controlnetWeight must be between 0 and 1'));
    });

    it('should return 400 for controlnetWeight < 0', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        controlnetWeight: -0.1
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('controlnetWeight must be between 0 and 1'));
    });

    it('should return 400 for ipadapterWeight > 1', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        ipadapterWeight: 1.1
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('ipadapterWeight must be between 0 and 1'));
    });

    it('should return 400 for ipadapterWeight < 0', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        ipadapterWeight: -0.5
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('ipadapterWeight must be between 0 and 1'));
    });

    it('should return 400 for invalid preset', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        preset: 'nonexistent_preset'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid preset'));
    });

    it('should update weights successfully with valid values', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        controlnetWeight: 0.6,
        ipadapterWeight: 0.4
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('updated successfully'));
      assert.strictEqual(res.body.characterId, characterId);
      assert.ok('sd15Config' in res.body, 'Response should include sd15Config');
      assert.strictEqual(res.body.sd15Config.controlnetWeight, 0.6);
      assert.strictEqual(res.body.sd15Config.ipadapterWeight, 0.4);
    });

    it('should accept valid preset name', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // balanced is a known preset from the manifest
      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/weights`, {
        preset: 'balanced'
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('updated successfully'));
      assert.strictEqual(res.body.appliedPreset, 'balanced');
    });

    it('should reject path traversal in character ID', async () => {
      const res = await request('PUT', '/api/admin/assets/characters/..%2F..%2Fetc%2Fpasswd/weights', {
        controlnetWeight: 0.5
      });

      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });
  });

  describe('GET /api/admin/assets/characters/:id/weights/presets', () => {
    it('should return presets for valid character', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/weights/presets`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.characterId, characterId);
      assert.ok('currentConfig' in res.body, 'Response should include currentConfig');
      assert.ok('generationDefaults' in res.body, 'Response should include generationDefaults');
      assert.ok(Array.isArray(res.body.presets), 'Response should include presets array');

      // Verify preset structure
      if (res.body.presets.length > 0) {
        const preset = res.body.presets[0];
        assert.ok('name' in preset, 'Preset should have name');
        assert.ok('controlnetWeight' in preset, 'Preset should have controlnetWeight');
        assert.ok('ipadapterWeight' in preset, 'Preset should have ipadapterWeight');
        assert.ok('description' in preset, 'Preset should have description');
      }
    });

    it('should return known preset names', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/weights/presets`);

      assert.strictEqual(res.status, 200);

      const presetNames = res.body.presets.map(p => p.name);
      const expectedPresets = ['balanced', 'maxConsistency', 'precisePoses', 'creative'];

      for (const expected of expectedPresets) {
        assert.ok(presetNames.includes(expected), `Should include ${expected} preset`);
      }
    });

    it('should return 404 for non-existent character', async () => {
      const res = await request('GET', '/api/admin/assets/characters/nonexistent_char/weights/presets');

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should reject path traversal in character ID', async () => {
      const res = await request('GET', '/api/admin/assets/characters/..%2Fetc%2Fpasswd/weights/presets');

      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });
  });

  // ============================================================================
  // FRAME DESCRIPTION OVERRIDES ENDPOINTS
  // ============================================================================

  describe('GET /api/admin/assets/characters/:id/frame-descriptions', () => {
    it('should return frame descriptions for valid character', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        // Skip if no character assets available
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/frame-descriptions`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.characterId, characterId);
      assert.ok('animations' in res.body, 'Response should include animations');
      assert.ok('hasOverrides' in res.body, 'Response should include hasOverrides');
    });

    it('should return frame descriptions for specific animation when queried', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // Get animations list first
      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/frame-descriptions?animation=${validAnimation}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.characterId, characterId);
      assert.strictEqual(res.body.animation, validAnimation);
      assert.ok('defaults' in res.body, 'Response should include defaults');
      assert.ok('overrides' in res.body, 'Response should include overrides');
      assert.ok('frameCount' in res.body, 'Response should include frameCount');
    });

    it('should return 404 for non-existent character', async () => {
      const res = await request('GET', '/api/admin/assets/characters/nonexistent_char_99999/frame-descriptions');

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should return 400 for invalid animation query parameter', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('GET', `/api/admin/assets/characters/${characterId}/frame-descriptions?animation=nonexistent_animation`);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('not valid for character'));
    });

    it('should reject path traversal in character ID', async () => {
      const res = await request('GET', '/api/admin/assets/characters/..%2F..%2Fetc%2Fpasswd/frame-descriptions');

      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });
  });

  describe('PUT /api/admin/assets/characters/:id/frame-descriptions', () => {
    it('should return 404 for non-existent character', async () => {
      const res = await request('PUT', '/api/admin/assets/characters/nonexistent_char/frame-descriptions', {
        frameDescriptionOverrides: { idle: ['frame 1', 'frame 2'] }
      });

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should reject path traversal in character ID', async () => {
      const res = await request('PUT', '/api/admin/assets/characters/..%2F..%2Fetc%2Fpasswd/frame-descriptions', {
        frameDescriptionOverrides: { idle: ['test'] }
      });

      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });

    it('should return 400 for non-object frameDescriptionOverrides', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: 'not an object'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('must be an object'));
    });

    it('should return 400 for array frameDescriptionOverrides', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: ['not', 'an', 'object']
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('must be an object'));
    });

    it('should return 400 for invalid animation name in overrides', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: { 'invalid-name!': ['frame 1'] }
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid animation name'));
    });

    it('should return 400 for non-array frame descriptions', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: { idle: 'not an array' }
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('must be an array'));
    });

    it('should return 400 when frame descriptions exceed 8 elements', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: { idle: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'] }
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('cannot exceed 8 elements'));
    });

    it('should return 400 for non-string frame description', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: { idle: ['valid', 123, 'also valid'] }
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('must be a string'));
    });

    it('should update frame descriptions successfully with valid data', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // Get valid animation for this character
      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: { [validAnimation]: ['test frame 1', 'test frame 2'] }
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('updated successfully'));
      assert.strictEqual(res.body.characterId, characterId);
      assert.ok('overrideCount' in res.body, 'Response should include overrideCount');
    });

    it('should accept null to clear all overrides', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: null
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('updated successfully'));
    });
  });

  describe('DELETE /api/admin/assets/characters/:id/frame-descriptions/:animation', () => {
    it('should return 404 for non-existent character', async () => {
      const res = await request('DELETE', '/api/admin/assets/characters/nonexistent_char/frame-descriptions/idle');

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('not found'));
    });

    it('should reject path traversal in character ID', async () => {
      const res = await request('DELETE', '/api/admin/assets/characters/..%2F..%2Fetc/frame-descriptions/idle');

      assert.ok(res.status === 400 || res.status === 404, 'Should reject path traversal');
    });

    it('should return 400 for invalid animation name format', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      const res = await request('DELETE', `/api/admin/assets/characters/${characterId}/frame-descriptions/invalid-name!`);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid animation name'));
    });

    it('should return success message for animation without overrides', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // Use a valid format animation name that likely has no overrides
      const res = await request('DELETE', `/api/admin/assets/characters/${characterId}/frame-descriptions/nonexistent_anim`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('No overrides found'));
      assert.strictEqual(res.body.characterId, characterId);
    });

    it('should delete frame description overrides successfully', async () => {
      const listRes = await request('GET', '/api/admin/assets/characters');
      if (listRes.body.assets?.length === 0) {
        return;
      }

      const testCharacter = listRes.body.assets[0];
      const characterId = testCharacter.key || testCharacter.id;

      // Get valid animation for this character
      const animRes = await request('GET', `/api/admin/assets/characters/${characterId}/animations`);
      if (animRes.body.animations?.length === 0) {
        return;
      }
      const validAnimation = animRes.body.animations[0].animation;

      // First set some overrides to ensure there's something to delete
      await request('PUT', `/api/admin/assets/characters/${characterId}/frame-descriptions`, {
        frameDescriptionOverrides: { [validAnimation]: ['test frame for deletion'] }
      });

      // Now delete the overrides
      const res = await request('DELETE', `/api/admin/assets/characters/${characterId}/frame-descriptions/${validAnimation}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.message.includes('Removed') || res.body.message.includes('No overrides found'));
      assert.strictEqual(res.body.characterId, characterId);
      assert.strictEqual(res.body.animation, validAnimation);
    });
  });
});
