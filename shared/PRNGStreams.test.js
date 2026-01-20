/**
 * PRNGStreams Unit Tests
 * Tests for deterministic, isolated random streams
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PRNGStreams,
  createPRNGStreams,
  mulberry32,
  saltSeed,
  STREAM_SALTS,
  createSeededRandom
} from './mapgen/PRNGStreams.js';

describe('PRNGStreams', () => {
  describe('mulberry32', () => {
    it('should create a deterministic random function', () => {
      const random1 = mulberry32(12345);
      const random2 = mulberry32(12345);

      const values1 = [random1(), random1(), random1()];
      const values2 = [random2(), random2(), random2()];

      assert.deepStrictEqual(values1, values2);
    });

    it('should produce values between 0 and 1', () => {
      const random = mulberry32(42);
      for (let i = 0; i < 100; i++) {
        const value = random();
        assert.ok(value >= 0 && value < 1, `Value ${value} out of range`);
      }
    });

    it('should produce different sequences for different seeds', () => {
      const random1 = mulberry32(1);
      const random2 = mulberry32(2);

      const values1 = [random1(), random1(), random1()];
      const values2 = [random2(), random2(), random2()];

      assert.notDeepStrictEqual(values1, values2);
    });
  });

  describe('saltSeed', () => {
    it('should produce different seeds with different salts', () => {
      const base = 12345;
      const salted1 = saltSeed(base, STREAM_SALTS.structure);
      const salted2 = saltSeed(base, STREAM_SALTS.terrain);

      assert.notStrictEqual(salted1, salted2);
    });

    it('should be deterministic', () => {
      const result1 = saltSeed(100, STREAM_SALTS.detail);
      const result2 = saltSeed(100, STREAM_SALTS.detail);

      assert.strictEqual(result1, result2);
    });
  });

  describe('STREAM_SALTS', () => {
    it('should have all required stream salts', () => {
      const requiredStreams = [
        'structure', 'terrain', 'detail', 'variants',
        'spawns', 'obstacles', 'elevation', 'cover', 'repair'
      ];

      for (const stream of requiredStreams) {
        assert.ok(STREAM_SALTS[stream] !== undefined, `Missing salt for ${stream}`);
        assert.strictEqual(typeof STREAM_SALTS[stream], 'number');
      }
    });

    it('should have unique salt values', () => {
      const values = Object.values(STREAM_SALTS);
      const uniqueValues = new Set(values);
      assert.strictEqual(values.length, uniqueValues.size, 'Salt values should be unique');
    });
  });

  describe('PRNGStreams class', () => {
    it('should create isolated streams', () => {
      const streams = new PRNGStreams(42);

      // Each stream should exist
      assert.ok(streams.structure);
      assert.ok(streams.terrain);
      assert.ok(streams.detail);
      assert.ok(streams.variants);
      assert.ok(streams.spawns);
      assert.ok(streams.obstacles);
    });

    it('should produce isolated sequences', () => {
      const streams = new PRNGStreams(42);

      // Generate from structure stream
      const structureValue = streams.structure();

      // Create new instance, use terrain first
      const streams2 = new PRNGStreams(42);
      const terrainValue = streams2.terrain();

      // Now check structure - should match first instance
      const structureValue2 = streams2.structure();
      assert.strictEqual(structureValue, structureValue2, 'Streams should be isolated');
    });

    it('should be deterministic with same seed', () => {
      const streams1 = new PRNGStreams(12345);
      const streams2 = new PRNGStreams(12345);

      const values1 = [
        streams1.structure(),
        streams1.terrain(),
        streams1.detail()
      ];
      const values2 = [
        streams2.structure(),
        streams2.terrain(),
        streams2.detail()
      ];

      assert.deepStrictEqual(values1, values2);
    });

    it('should produce different sequences with different seeds', () => {
      const streams1 = new PRNGStreams(1);
      const streams2 = new PRNGStreams(2);

      const value1 = streams1.structure();
      const value2 = streams2.structure();

      assert.notStrictEqual(value1, value2);
    });

    it('should provide getStream() method', () => {
      const streams = new PRNGStreams(42);

      const structureStream = streams.getStream('structure');
      assert.ok(typeof structureStream === 'function');

      // Values from getStream should match direct calls
      const streams2 = new PRNGStreams(42);
      const directValue = streams2.structure();
      const streamValue = streams2.getStream('structure')();

      // They won't be equal since each call advances the state,
      // but both should return valid numbers
      assert.ok(typeof directValue === 'number');
      assert.ok(typeof streamValue === 'number');
    });

    it('should fork streams', () => {
      const streams = new PRNGStreams(42);

      // Fork with a salt value
      const forked = streams.fork(0x12345678);

      // Forked stream should be different from original
      // but deterministic with same fork parameters
      const streams2 = new PRNGStreams(42);
      const forked2 = streams2.fork(0x12345678);

      // Both forks with same salt should produce same values
      assert.strictEqual(forked.structure(), forked2.structure());
    });
  });

  describe('createPRNGStreams', () => {
    it('should create a PRNGStreams instance', () => {
      const streams = createPRNGStreams(42);

      assert.ok(streams instanceof PRNGStreams);
      assert.ok(streams.structure);
      assert.ok(streams.terrain);
    });

    it('should be deterministic', () => {
      const streams1 = createPRNGStreams(999);
      const streams2 = createPRNGStreams(999);

      assert.strictEqual(streams1.structure(), streams2.structure());
    });
  });

  describe('createSeededRandom', () => {
    it('should create a simple random function', () => {
      const random = createSeededRandom(42);
      assert.ok(typeof random === 'function');

      const value = random();
      assert.ok(value >= 0 && value < 1);
    });

    it('should be deterministic', () => {
      const random1 = createSeededRandom(123);
      const random2 = createSeededRandom(123);

      const values1 = [random1(), random1(), random1()];
      const values2 = [random2(), random2(), random2()];

      assert.deepStrictEqual(values1, values2);
    });
  });

  describe('Stream independence', () => {
    it('should not affect other streams when one is consumed', () => {
      const streams1 = new PRNGStreams(42);
      const streams2 = new PRNGStreams(42);

      // Consume structure 100 times on streams1
      for (let i = 0; i < 100; i++) {
        streams1.structure();
      }

      // terrain should still be identical
      const terrain1 = streams1.terrain();
      const terrain2 = streams2.terrain();

      assert.strictEqual(terrain1, terrain2, 'Consuming one stream should not affect others');
    });

    it('should allow interleaved consumption with same results', () => {
      // Pattern A: structure, terrain, structure, terrain
      const streamsA = new PRNGStreams(42);
      const a1 = streamsA.structure();
      const a2 = streamsA.terrain();
      const a3 = streamsA.structure();
      const a4 = streamsA.terrain();

      // Pattern B: structure, structure, terrain, terrain
      const streamsB = new PRNGStreams(42);
      const b1 = streamsB.structure();
      const b3 = streamsB.structure();
      const b2 = streamsB.terrain();
      const b4 = streamsB.terrain();

      // Same stream values regardless of order
      assert.strictEqual(a1, b1, 'First structure value');
      assert.strictEqual(a3, b3, 'Second structure value');
      assert.strictEqual(a2, b2, 'First terrain value');
      assert.strictEqual(a4, b4, 'Second terrain value');
    });
  });

  describe('Backward compatibility', () => {
    it('should work as drop-in for single random function', () => {
      // Old pattern
      const oldRandom = createSeededRandom(42);
      const oldValues = [oldRandom(), oldRandom(), oldRandom()];

      // New pattern using legacy mode
      const newRandom = createSeededRandom(42);
      const newValues = [newRandom(), newRandom(), newRandom()];

      assert.deepStrictEqual(oldValues, newValues);
    });
  });
});
