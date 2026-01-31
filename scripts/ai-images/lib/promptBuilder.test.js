/**
 * SD1.5 Prompt Builder Unit Tests
 * Tests for SD1.5-specific prompt building functions
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const {
  getSD15LoraTrigger,
  buildSD15CharacterPrompt,
  buildSD15ReferencePrompt,
  getSD15NegativePrompt,
  SD15_LORA_TRIGGERS
} = require('./promptBuilder.js');

describe('SD1.5 Prompt Builder', () => {
  describe('getSD15LoraTrigger', () => {
    it('should return correct trigger for pixel-art-xl', () => {
      const trigger = getSD15LoraTrigger('pixel-art-xl');
      assert.strictEqual(trigger, 'pixel art style');
    });

    it('should return correct trigger for 16-bit-pixel', () => {
      const trigger = getSD15LoraTrigger('16-bit-pixel');
      assert.strictEqual(trigger, '16bit pixel art');
    });

    it('should return correct trigger for pixel-sprite', () => {
      const trigger = getSD15LoraTrigger('pixel-sprite');
      assert.strictEqual(trigger, 'pixel sprite');
    });

    it('should return correct trigger for retro-game', () => {
      const trigger = getSD15LoraTrigger('retro-game');
      assert.strictEqual(trigger, 'retro game style');
    });

    it('should return empty string for null', () => {
      const trigger = getSD15LoraTrigger(null);
      assert.strictEqual(trigger, '');
    });

    it('should return empty string for undefined', () => {
      const trigger = getSD15LoraTrigger(undefined);
      assert.strictEqual(trigger, '');
    });

    it('should return empty string for unknown LoRA', () => {
      const trigger = getSD15LoraTrigger('unknown-lora-model');
      assert.strictEqual(trigger, '');
    });

    it('should return empty string for empty string input', () => {
      const trigger = getSD15LoraTrigger('');
      assert.strictEqual(trigger, '');
    });
  });

  describe('buildSD15CharacterPrompt', () => {
    const baseCharacter = {
      id: 'warrior_human',
      visualTraits: 'muscular human warrior with plate armor',
      class: 'warrior'
    };

    it('should include animation name in prompt', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});
      assert.ok(prompt.includes('idle animation'), 'Should include idle animation');
    });

    it('should include different animation names', () => {
      const walkPrompt = buildSD15CharacterPrompt(baseCharacter, 'walk', {});
      const attackPrompt = buildSD15CharacterPrompt(baseCharacter, 'attack', {});

      assert.ok(walkPrompt.includes('walk animation'), 'Should include walk animation');
      assert.ok(attackPrompt.includes('attack animation'), 'Should include attack animation');
    });

    it('should include LoRA trigger when provided', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {
        loraModel: 'pixel-art-xl'
      });
      assert.ok(prompt.includes('pixel art style'), 'Should include LoRA trigger');
    });

    it('should not include LoRA trigger when not provided', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});
      // Should not start with a comma (which would happen if empty trigger was added)
      assert.ok(!prompt.startsWith(','), 'Should not start with comma');
      // Should still have content
      assert.ok(prompt.length > 0, 'Should have content');
    });

    it('should handle missing visualTraits gracefully', () => {
      const characterNoTraits = {
        id: 'test_char',
        class: 'mage'
      };
      const prompt = buildSD15CharacterPrompt(characterNoTraits, 'idle', {});

      // Should not throw and should still build a valid prompt
      assert.ok(prompt.length > 0, 'Should build prompt without visualTraits');
      assert.ok(prompt.includes('idle animation'), 'Should still include animation');
    });

    it('should handle undefined visualTraits', () => {
      const characterUndefined = {
        id: 'test_char',
        visualTraits: undefined,
        class: 'mage'
      };
      const prompt = buildSD15CharacterPrompt(characterUndefined, 'idle', {});

      assert.ok(prompt.length > 0, 'Should build prompt with undefined visualTraits');
      // Should not contain "undefined" as text
      assert.ok(!prompt.includes('undefined'), 'Should not contain literal undefined');
    });

    it('should include 64x64 size constraint', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});
      assert.ok(prompt.includes('64x64'), 'Should include 64x64 size');
    });

    it('should include core style keywords', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});

      assert.ok(prompt.includes('pixel art character sprite'), 'Should include core style');
      assert.ok(prompt.includes('side view'), 'Should include side view');
      assert.ok(prompt.includes('transparent background'), 'Should include transparent background');
    });

    it('should include quality boosters', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});

      assert.ok(prompt.includes('clean lines'), 'Should include clean lines');
      assert.ok(prompt.includes('game asset'), 'Should include game asset');
    });

    it('should include visual traits when provided', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});
      assert.ok(
        prompt.includes('muscular human warrior with plate armor'),
        'Should include visual traits'
      );
    });

    it('should include pose description when provided', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'attack', {
        poseDescription: 'sword raised overhead'
      });
      assert.ok(prompt.includes('sword raised overhead'), 'Should include pose description');
    });

    it('should produce comma-separated parts', () => {
      const prompt = buildSD15CharacterPrompt(baseCharacter, 'idle', {});
      const parts = prompt.split(',');
      // Should have multiple parts separated by commas
      assert.ok(parts.length >= 5, 'Should have multiple comma-separated parts');
    });

    it('should work with enemy characters', () => {
      const enemy = {
        id: 'goblin_scout',
        visualTraits: 'small green goblin with leather armor and dagger',
        biome: 'forest'
      };
      const prompt = buildSD15CharacterPrompt(enemy, 'idle', {});

      assert.ok(prompt.includes('small green goblin'), 'Should include enemy visual traits');
      assert.ok(prompt.includes('idle animation'), 'Should include animation');
    });
  });

  describe('buildSD15ReferencePrompt', () => {
    const baseCharacter = {
      id: 'mage_elf',
      visualTraits: 'elegant elf mage with flowing robes and staff'
    };

    it('should include 128x128 for higher quality', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});
      assert.ok(prompt.includes('128x128'), 'Should include 128x128 size');
    });

    it('should include reference sheet terminology', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});
      assert.ok(
        prompt.includes('reference sheet'),
        'Should include reference sheet terminology'
      );
    });

    it('should include visual traits', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});
      assert.ok(
        prompt.includes('elegant elf mage with flowing robes and staff'),
        'Should include visual traits'
      );
    });

    it('should handle missing visualTraits gracefully', () => {
      const characterNoTraits = { id: 'test_char' };
      const prompt = buildSD15ReferencePrompt(characterNoTraits, {});

      assert.ok(prompt.length > 0, 'Should build prompt without visualTraits');
      assert.ok(prompt.includes('reference sheet'), 'Should still include reference terminology');
    });

    it('should include LoRA trigger when provided', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {
        loraModel: 'pixel-art-xl'
      });
      assert.ok(prompt.includes('pixel art style'), 'Should include LoRA trigger');
    });

    it('should include neutral pose keywords', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});

      assert.ok(prompt.includes('standing pose'), 'Should include standing pose');
      assert.ok(prompt.includes('front view'), 'Should include front view');
      assert.ok(prompt.includes('full body'), 'Should include full body');
    });

    it('should include quality keywords', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});

      assert.ok(prompt.includes('detailed pixel art character'), 'Should include detailed keyword');
      assert.ok(prompt.includes('clean pixel art'), 'Should include clean pixel art');
      assert.ok(prompt.includes('consistent style'), 'Should include consistent style');
    });

    it('should include transparent background', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});
      assert.ok(
        prompt.includes('transparent background'),
        'Should include transparent background'
      );
    });

    it('should produce comma-separated parts', () => {
      const prompt = buildSD15ReferencePrompt(baseCharacter, {});
      const parts = prompt.split(',');
      assert.ok(parts.length >= 5, 'Should have multiple comma-separated parts');
    });
  });

  describe('getSD15NegativePrompt', () => {
    it('should return non-empty string', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(typeof negative === 'string', 'Should be a string');
      assert.ok(negative.length > 0, 'Should not be empty');
    });

    it('should include blurry', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('blurry'), 'Should include blurry');
    });

    it('should include low quality', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('low quality'), 'Should include low quality');
    });

    it('should include watermark', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('watermark'), 'Should include watermark');
    });

    it('should include photorealistic', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('photorealistic'), 'Should include photorealistic');
    });

    it('should include 3D render', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('3D render'), 'Should include 3D render');
    });

    it('should include anatomy issues', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('bad anatomy'), 'Should include bad anatomy');
      assert.ok(negative.includes('extra limbs'), 'Should include extra limbs');
    });

    it('should include signature and text', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('signature'), 'Should include signature');
      assert.ok(negative.includes('text'), 'Should include text');
    });

    it('should include jpeg artifacts', () => {
      const negative = getSD15NegativePrompt();
      assert.ok(negative.includes('jpeg artifacts'), 'Should include jpeg artifacts');
    });

    it('should be comma-separated', () => {
      const negative = getSD15NegativePrompt();
      const parts = negative.split(',');
      assert.ok(parts.length >= 5, 'Should have multiple comma-separated parts');
    });

    it('should return consistent value on multiple calls', () => {
      const first = getSD15NegativePrompt();
      const second = getSD15NegativePrompt();
      assert.strictEqual(first, second, 'Should return same value each time');
    });
  });

  describe('SD15_LORA_TRIGGERS constant', () => {
    it('should be defined and non-empty', () => {
      assert.ok(SD15_LORA_TRIGGERS, 'Should be defined');
      assert.ok(typeof SD15_LORA_TRIGGERS === 'object', 'Should be an object');
    });

    it('should have null key for default fallback', () => {
      assert.ok('null' in SD15_LORA_TRIGGERS || null in SD15_LORA_TRIGGERS,
        'Should have null key');
      // The null key should map to empty string
      assert.strictEqual(SD15_LORA_TRIGGERS[null], '', 'null should map to empty string');
    });

    it('should have known LoRA model keys', () => {
      const expectedKeys = ['pixel-art-xl', '16-bit-pixel', 'pixel-sprite', 'retro-game'];
      for (const key of expectedKeys) {
        assert.ok(key in SD15_LORA_TRIGGERS, `Should have ${key} key`);
        assert.ok(
          typeof SD15_LORA_TRIGGERS[key] === 'string',
          `${key} should map to string`
        );
        assert.ok(
          SD15_LORA_TRIGGERS[key].length > 0,
          `${key} should have non-empty trigger`
        );
      }
    });
  });
});
