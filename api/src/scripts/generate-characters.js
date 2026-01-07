#!/usr/bin/env node
/**
 * Generate Character Sprites
 * Creates 8-directional animated sprites for player classes using PixelLab API
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const { CHARACTER_PROMPTS } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Animation templates to generate
const ANIMATIONS = [
  { name: 'idle', template: 'breathing-idle', frames: 4 },
  { name: 'walk', template: 'walking', frames: 8 },
  { name: 'attack', template: 'attack-forward', frames: 6 },
  { name: 'hit', template: 'hit-react', frames: 4 },
  { name: 'death', template: 'death-fall', frames: 8 },
  { name: 'victory', template: 'victory-pose', frames: 8 }
];

const CHARACTER_SIZE = 64;

async function generateCharacters() {
  console.log('=== Character Sprite Generation ===\n');

  if (!process.env.PIXELLAB_API_KEY && !process.env.PIXELLABS_API_KEY) {
    console.error('Error: PIXELLAB_API_KEY not found in environment');
    console.log('Please add your PixelLab API key to .env file');
    process.exit(1);
  }

  const client = getPixelLabClient();
  const cache = getAssetCacheManager();

  // Check credits
  try {
    const balance = await client.getBalance();
    console.log(`PixelLab Credits: ${balance.credits || balance.remaining_credits || 'Unknown'}\n`);
  } catch (error) {
    console.warn('Could not fetch credit balance:', error.message);
  }

  const classes = Object.keys(CHARACTER_PROMPTS);
  let totalGenerated = 0;
  let totalCached = 0;
  const characterIds = {};

  // Phase 1: Generate base 8-directional sprites
  console.log('--- Phase 1: Base Character Sprites ---\n');

  for (const charClass of classes) {
    const prompt = CHARACTER_PROMPTS[charClass];

    const params = {
      description: prompt,
      image_size: CHARACTER_SIZE,
      outline: 'medium',
      shading: 'detailed',
      detail: 'high',
      isometric: true,
      seed: getCharacterSeed(charClass)
    };

    try {
      const result = await cache.getOrGenerate(`character_${charClass}`, params, async (p) => {
        console.log(`  Generating base sprite: ${charClass}`);
        return await client.createCharacterWith8Directions(p);
      });

      if (result.cached) {
        console.log(`  [CACHED] ${charClass} base sprite`);
        totalCached++;
      } else {
        console.log(`  [GENERATED] ${charClass} base sprite`);
        totalGenerated++;

        // Store character ID for animation generation
        if (result.result?.character_id) {
          characterIds[charClass] = result.result.character_id;
        }
      }

      // Copy base sprite
      const destPath = `characters/player/${charClass}/${charClass}_base.png`;
      await cache.copyToAssets(result.cacheKey, destPath);

    } catch (error) {
      console.error(`  [ERROR] ${charClass}: ${error.message}`);
    }
  }

  // Phase 2: Generate animations for each class
  console.log('\n--- Phase 2: Character Animations ---\n');

  for (const charClass of classes) {
    console.log(`\nGenerating animations for ${charClass}:`);

    for (const anim of ANIMATIONS) {
      const params = {
        character_class: charClass,
        animation: anim.name,
        animation_template: anim.template,
        frames: anim.frames,
        seed: getAnimationSeed(charClass, anim.name)
      };

      try {
        const result = await cache.getOrGenerate(`character_anim_${charClass}_${anim.name}`, params, async (p) => {
          console.log(`  Generating ${anim.name} animation...`);

          // If we have a character ID from base generation, use it
          if (characterIds[charClass]) {
            return await client.createCharacterAnimation({
              character_id: characterIds[charClass],
              animation_template: p.animation_template,
              outline: 'medium',
              shading: 'detailed'
            });
          } else {
            // Generate animation with text description
            return await client.animateWithText({
              character_description: CHARACTER_PROMPTS[charClass],
              action_description: getActionDescription(charClass, anim.name),
              image_size: CHARACTER_SIZE,
              seed: p.seed
            });
          }
        });

        if (result.cached) {
          console.log(`    [CACHED] ${anim.name}`);
          totalCached++;
        } else {
          console.log(`    [GENERATED] ${anim.name}`);
          totalGenerated++;
        }

        // Copy animation sprite sheet
        const destPath = `characters/player/${charClass}/${charClass}_${anim.name}.png`;
        await cache.copyToAssets(result.cacheKey, destPath);

      } catch (error) {
        console.error(`    [ERROR] ${anim.name}: ${error.message}`);
      }
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} sprites/animations`);
  console.log(`From cache: ${totalCached} sprites/animations`);
  console.log(`Total: ${totalGenerated + totalCached}`);
}

/**
 * Get action description for animation
 */
function getActionDescription(charClass, animation) {
  const actions = {
    warrior: {
      idle: 'standing alert with sword and shield ready',
      walk: 'walking forward in heavy armor',
      attack: 'powerful sword slash attack',
      hit: 'recoiling from impact, armor absorbing blow',
      death: 'falling to knees defeated',
      victory: 'raising sword triumphantly'
    },
    wizard: {
      idle: 'standing with staff glowing softly',
      walk: 'walking gracefully with robes flowing',
      attack: 'casting spell with staff raised, magic energy burst',
      hit: 'magical shield breaking, recoiling',
      death: 'collapsing into robes',
      victory: 'staff raised with magical celebration'
    },
    monk: {
      idle: 'centered breathing in martial arts stance',
      walk: 'light-footed martial movement',
      attack: 'rapid punch combo with ki energy',
      hit: 'nimble dodge attempt, taking hit',
      death: 'graceful collapse',
      victory: 'meditation pose, peaceful triumph'
    },
    chemist: {
      idle: 'examining potion flask curiously',
      walk: 'careful movement protecting potions',
      attack: 'throwing potion with arc motion',
      hit: 'potion splash, chemical spill reaction',
      death: 'flask shattering, collapsing',
      victory: 'successful brew, flask raised proudly'
    }
  };

  return actions[charClass]?.[animation] || `${animation} action`;
}

/**
 * Generate deterministic seed for character
 */
function getCharacterSeed(charClass) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const classHash = hashString(charClass);
  return (worldSeed + classHash) % 1000000;
}

/**
 * Generate deterministic seed for animation
 */
function getAnimationSeed(charClass, animation) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const classHash = hashString(charClass);
  const animHash = hashString(animation);
  return (worldSeed + classHash + animHash) % 1000000;
}

/**
 * Simple string hash
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Run if called directly
if (require.main === module) {
  generateCharacters().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateCharacters };
