/**
 * Unit tests for pythonRunner.js outputPath validation
 * Tests that functions requiring outputPath throw appropriate errors when it's missing
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  generateTile,
  generateCharacterFrame,
  generateAnimation,
  generateReferenceImage
} = require('./pythonRunner.js');

describe('pythonRunner outputPath validation', () => {
  describe('generateTile()', () => {
    it('should throw error when outputPath is missing', async () => {
      await assert.rejects(
        () => generateTile({ prompt: 'test tile', key: 'test_tile', biome: 'forest' }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is undefined', async () => {
      await assert.rejects(
        () => generateTile({ prompt: 'test tile', key: 'test_tile', biome: 'forest', outputPath: undefined }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is null', async () => {
      await assert.rejects(
        () => generateTile({ prompt: 'test tile', key: 'test_tile', biome: 'forest', outputPath: null }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is empty string', async () => {
      await assert.rejects(
        () => generateTile({ prompt: 'test tile', key: 'test_tile', biome: 'forest', outputPath: '' }),
        { message: /outputPath is required/i }
      );
    });
  });

  describe('generateCharacterFrame()', () => {
    it('should throw error when outputPath is missing', async () => {
      await assert.rejects(
        () => generateCharacterFrame({
          prompt: 'test character',
          key: 'test_frame',
          characterType: 'player',
          animation: 'idle',
          frameIndex: 0
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is undefined', async () => {
      await assert.rejects(
        () => generateCharacterFrame({
          prompt: 'test character',
          key: 'test_frame',
          characterType: 'player',
          animation: 'idle',
          frameIndex: 0,
          outputPath: undefined
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is null', async () => {
      await assert.rejects(
        () => generateCharacterFrame({
          prompt: 'test character',
          key: 'test_frame',
          characterType: 'player',
          animation: 'idle',
          frameIndex: 0,
          outputPath: null
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is empty string', async () => {
      await assert.rejects(
        () => generateCharacterFrame({
          prompt: 'test character',
          key: 'test_frame',
          characterType: 'player',
          animation: 'idle',
          frameIndex: 0,
          outputPath: ''
        }),
        { message: /outputPath is required/i }
      );
    });
  });

  describe('generateAnimation()', () => {
    it('should throw error when outputPath is missing', async () => {
      await assert.rejects(
        () => generateAnimation({
          characterId: 'warrior',
          animation: 'idle'
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is undefined', async () => {
      await assert.rejects(
        () => generateAnimation({
          characterId: 'warrior',
          animation: 'idle',
          outputPath: undefined
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is null', async () => {
      await assert.rejects(
        () => generateAnimation({
          characterId: 'warrior',
          animation: 'idle',
          outputPath: null
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is empty string', async () => {
      await assert.rejects(
        () => generateAnimation({
          characterId: 'warrior',
          animation: 'idle',
          outputPath: ''
        }),
        { message: /outputPath is required/i }
      );
    });
  });

  describe('generateReferenceImage()', () => {
    it('should throw error when outputPath is missing', async () => {
      await assert.rejects(
        () => generateReferenceImage({
          characterId: 'warrior',
          prompt: 'test warrior character'
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is undefined', async () => {
      await assert.rejects(
        () => generateReferenceImage({
          characterId: 'warrior',
          prompt: 'test warrior character',
          outputPath: undefined
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is null', async () => {
      await assert.rejects(
        () => generateReferenceImage({
          characterId: 'warrior',
          prompt: 'test warrior character',
          outputPath: null
        }),
        { message: /outputPath is required/i }
      );
    });

    it('should throw error when outputPath is empty string', async () => {
      await assert.rejects(
        () => generateReferenceImage({
          characterId: 'warrior',
          prompt: 'test warrior character',
          outputPath: ''
        }),
        { message: /outputPath is required/i }
      );
    });
  });
});
