/**
 * Unit tests for adminGenerationService.js
 *
 * Tests cover validation and pure functions that don't require file system or child process operations:
 * - Input validation (categories, LoRA models, backends, seed modes)
 * - Queue management structure
 * - Configuration defaults
 * - Error handling for invalid inputs
 * - Return value structures
 *
 * Note: File system and child process operations are not mocked due to Node.js test runner limitations.
 * These tests focus on business logic validation and error handling.
 */

import { after, describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// =============================================================================
// IMPORT SERVICE
// =============================================================================

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const THEME_PATH = path.resolve(TEST_DIR, '../../../../ai-image-metadata/theme.json');
const ORIGINAL_THEME = readFileSync(THEME_PATH, 'utf8');

// This file queues jobs to exercise validation. It must never launch the real
// asset backends when invoked directly with `node --test`.
process.env.NODE_ENV = 'test';

const {
  queueJob,
  getValidCategories,
  getValidLoraModels,
  getValidBackends,
  getDefaultLora,
  setGenerationBackend,
  getGenerationBackend,
  resetIncrementalSeed
} = await import('../../services/adminGenerationService.js');

after(() => {
  writeFileSync(THEME_PATH, ORIGINAL_THEME);
});

// =============================================================================
// TEST DATA FACTORIES
// =============================================================================

function createJobOptions(overrides = {}) {
  return {
    backend: 'comfyui',
    lora: 'v1',
    seedMode: 'random',
    variants: 1,
    force: false,
    dryRun: false,
    verbose: false,
    ...overrides
  };
}

function createJobFilters(overrides = {}) {
  return {
    biome: 'forest',
    race: 'human',
    class: 'warrior',
    queueMode: false,
    ...overrides
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('adminGenerationService', () => {
  beforeEach(() => {
    // Reset backend to default
    setGenerationBackend('comfyui');
  });

  describe('validation functions', () => {
    it('should return valid categories', () => {
      const categories = getValidCategories();

      assert.ok(Array.isArray(categories));
      assert.ok(categories.length > 0);
      assert.ok(categories.includes('tiles'));
      assert.ok(categories.includes('portraits'));
      assert.ok(categories.includes('items'));
      assert.ok(categories.includes('icons'));
      assert.ok(categories.includes('nodes'));
      assert.ok(categories.includes('overlays'));
    });

    it('should return valid LoRA models', () => {
      const models = getValidLoraModels();

      assert.ok(Array.isArray(models));
      assert.ok(models.length > 0);
      assert.ok(models.includes('v1'));
      assert.ok(models.includes('v2'));
    });

    it('should return valid backends', () => {
      const backends = getValidBackends();

      assert.ok(Array.isArray(backends));
      assert.ok(backends.length > 0);
      assert.ok(backends.includes('comfyui'));
      assert.ok(backends.includes('huggingface'));
    });

    it('should return default LoRA mapping', () => {
      const defaults = getDefaultLora();

      assert.ok(typeof defaults === 'object');
      assert.ok(defaults !== null);
      assert.ok(Object.keys(defaults).length > 0);
    });
  });

  describe('queueJob validation', () => {
    it('should throw error for invalid category', () => {
      assert.throws(
        () => queueJob('invalid_category'),
        /Invalid category: invalid_category/
      );
    });

    it('should throw error for invalid LoRA model', () => {
      assert.throws(
        () => queueJob('tiles', {}, { lora: 'invalid_lora' }),
        /Invalid LoRA model: invalid_lora/
      );
    });

    it('should throw error for invalid backend', () => {
      assert.throws(
        () => queueJob('tiles', {}, { backend: 'invalid_backend' }),
        /Invalid backend: invalid_backend/
      );
    });

    it('should throw error for invalid seedMode', () => {
      assert.throws(
        () => queueJob('tiles', {}, { seedMode: 'invalid_mode' }),
        /Invalid seedMode: invalid_mode/
      );
    });

    it('should accept valid category and return job info', () => {
      const result = queueJob('tiles', createJobFilters(), createJobOptions());

      assert.ok(result.jobId);
      assert.ok(typeof result.jobId === 'string');
      assert.ok(typeof result.queuePosition === 'number');
      assert.ok(result.queuePosition >= 1);
    });

    it('should accept all valid categories', () => {
      const categories = getValidCategories();

      for (const category of categories) {
        const result = queueJob(category, {}, {});
        assert.ok(result.jobId);
      }
    });

    it('should accept all valid LoRA models', () => {
      const models = getValidLoraModels();

      for (const lora of models) {
        const result = queueJob('tiles', {}, { lora });
        assert.ok(result.jobId);
      }
    });

    it('should accept all valid backends', () => {
      const backends = getValidBackends();

      for (const backend of backends) {
        const result = queueJob('tiles', {}, { backend });
        assert.ok(result.jobId);
      }
    });

    it('should accept all valid seed modes', () => {
      const seedModes = ['random', 'fixed', 'incremental'];

      for (const seedMode of seedModes) {
        const result = queueJob('tiles', {}, { seedMode });
        assert.ok(result.jobId);
      }
    });

    it('should preserve a trailing newline when persisting the backend', () => {
      setGenerationBackend('comfyui');
      assert.ok(readFileSync(THEME_PATH, 'utf8').endsWith('\n'));
    });
  });

  describe('resetIncrementalSeed', () => {
    it('should accept numeric seed values', () => {
      // Function should not throw
      resetIncrementalSeed(42);
      resetIncrementalSeed(100);
      resetIncrementalSeed(0);
      resetIncrementalSeed(-1);

      // Test passes if no exceptions thrown
      assert.ok(true);
    });

    it('should use default value when called without parameters', () => {
      // Function should not throw
      resetIncrementalSeed();

      // Test passes if no exceptions thrown
      assert.ok(true);
    });
  });

  describe('setGenerationBackend and getGenerationBackend', () => {
    it('should set and get valid backend successfully', () => {
      setGenerationBackend('huggingface');
      const backend = getGenerationBackend();
      assert.strictEqual(backend, 'huggingface');

      setGenerationBackend('comfyui');
      const backend2 = getGenerationBackend();
      assert.strictEqual(backend2, 'comfyui');
    });

    it('should throw error for invalid backend', () => {
      assert.throws(
        () => setGenerationBackend('invalid'),
        /Invalid backend: invalid/
      );
    });

    it('should accept all valid backends', () => {
      const backends = getValidBackends();

      for (const backend of backends) {
        setGenerationBackend(backend);
        const current = getGenerationBackend();
        assert.strictEqual(current, backend);
      }
    });
  });

  describe('option combination validation', () => {
    it('should handle complex option combinations', () => {
      const complexOptions = {
        backend: 'huggingface',
        lora: 'v2',
        seedMode: 'fixed',
        fixedSeed: 123,
        variants: 3,
        delay: 5000,
        force: true,
        dryRun: false,
        verbose: true,
        backup: true,
        limit: 10,
        sd15Mode: true,
        controlnetWeight: 0.8,
        ipadapterWeight: 0.6,
        referenceOnly: true,
        referencePose: 'idle',
        animation: 'attack'
      };

      const result = queueJob('characters', {}, complexOptions);
      assert.ok(result.jobId);
    });

    it('should handle filter combinations', () => {
      const complexFilters = {
        biome: 'cave',
        race: 'elf',
        class: 'mage',
        subcategory: 'weapon',
        queueMode: true,
        animation: 'cast',
        ids: ['item1', 'item2'],
        keys: ['key1', 'key2']
      };

      const result = queueJob('items', complexFilters, {});
      assert.ok(result.jobId);
    });
  });

  describe('boundary condition tests', () => {
    it('should handle edge case values', () => {
      // Test with boundary values
      const edgeOptions = {
        variants: 0,
        delay: 0,
        limit: 0,
        fixedSeed: 0,
        controlnetWeight: 0,
        ipadapterWeight: 1
      };

      const result = queueJob('tiles', {}, edgeOptions);
      assert.ok(result.jobId);
    });

    it('should handle empty filters and options', () => {
      const result = queueJob('portraits');
      assert.ok(result.jobId);

      const result2 = queueJob('icons', {});
      assert.ok(result2.jobId);

      const result3 = queueJob('nodes', {}, {});
      assert.ok(result3.jobId);
    });
  });

  describe('job ID uniqueness', () => {
    it('should generate unique job IDs', () => {
      const ids = new Set();

      // Generate multiple jobs
      for (let i = 0; i < 10; i++) {
        const result = queueJob('tiles', { biome: 'forest' });
        assert.ok(!ids.has(result.jobId), `Duplicate job ID: ${result.jobId}`);
        ids.add(result.jobId);
      }

      assert.strictEqual(ids.size, 10);
    });
  });
});
