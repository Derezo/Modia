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

    it('requires the complete identity prompt after output validation', async () => {
      await assert.rejects(
        () => generateAnimation({
          characterId: 'human_male_warrior',
          animation: 'idle',
          outputPath: '/tmp/human_male_warrior_idle.webp'
        }),
        { message: /prompt is required/i }
      );
    });

    it('passes the identity prompt to the repository-owned animation adapter', async () => {
      const result = await generateAnimation({
        characterId: 'human_male_warrior',
        animation: 'idle',
        prompt: 'blond bearded warrior, white and gold plate armor, red scarf',
        referenceImage: '/tmp/human_male_warrior_reference.png',
        outputPath: '/tmp/human_male_warrior_idle.webp',
        originalsDirectory: '/tmp/human_male_warrior_idle_originals',
        negativePrompt: 'duplicate character, colored background'
      }, { dryRun: true, quiet: true });

      assert.equal(result.success, true);
      assert.match(result.command, /scripts\/ai-images\/python\/generate_character_animation\.py/);
      assert.match(result.command, /--prompt blond bearded warrior/);
      assert.match(result.command, /--originals-dir \/tmp\/human_male_warrior_idle_originals/);
      assert.match(result.command, /--negative-prompt duplicate character, colored background/);
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
