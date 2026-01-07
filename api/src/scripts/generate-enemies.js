#!/usr/bin/env node
/**
 * Generate Enemy Sprites
 * Creates enemy sprites for all biomes using PixelLab API
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { getPixelLabClient } = require('../services/pixelLabService');
const { getAssetCacheManager } = require('../services/assetCacheManager');
const { ENEMY_PROMPTS } = require('../config/pixelLabPrompts');

const ASSETS_DIR = path.join(__dirname, '../../../frontend/public/assets/sprites');

// Enemy size configurations
const ENEMY_SIZES = {
  forest: {
    gray_wolf: 48,
    alpha_wolf: 56,
    goblin_warrior: 48,
    goblin_archer: 48,
    treant: 96,
    forest_sprite: 32,
    spider: 56
  },
  cave: {
    stone_golem: 80,
    skeleton_warrior: 56,
    skeleton_mage: 56,
    cave_bat: 48,
    slime: 40,
    ghost: 56
  },
  mountain: {
    mountain_troll: 80,
    troll_shaman: 72,
    harpy: 56,
    ice_elemental: 64,
    yeti: 80,
    gargoyle: 64
  },
  bridge: {
    bandit_captain: 56,
    bandit_archer: 56,
    bandit_rogue: 56,
    mercenary: 64,
    toll_troll: 72
  },
  bosses: {
    troll_king: 112,
    frost_wyvern: 128,
    dragon: 144
  }
};

// Animations to generate for enemies (subset of player animations)
const ENEMY_ANIMATIONS = [
  { name: 'idle', template: 'breathing-idle' },
  { name: 'attack', template: 'attack-forward' },
  { name: 'hit', template: 'hit-react' },
  { name: 'death', template: 'death-fall' }
];

async function generateEnemies() {
  console.log('=== Enemy Sprite Generation ===\n');

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

  const biomes = Object.keys(ENEMY_PROMPTS);
  let totalGenerated = 0;
  let totalCached = 0;

  for (const biome of biomes) {
    console.log(`\n=== Generating ${biome} enemies ===`);
    const enemies = ENEMY_PROMPTS[biome];

    for (const [enemyName, prompt] of Object.entries(enemies)) {
      console.log(`\n--- ${enemyName} ---`);
      const size = ENEMY_SIZES[biome]?.[enemyName] || 56;

      // Generate base sprite
      const baseParams = {
        description: prompt,
        image_size: size,
        outline: 'medium',
        shading: 'detailed',
        detail: 'high',
        isometric: true,
        seed: getEnemySeed(biome, enemyName)
      };

      let characterId = null;

      try {
        const result = await cache.getOrGenerate(`enemy_${biome}_${enemyName}`, baseParams, async (p) => {
          console.log(`  Generating base sprite (${size}px)...`);
          return await client.createCharacterWith8Directions(p);
        });

        if (result.cached) {
          console.log(`  [CACHED] base sprite`);
          totalCached++;
        } else {
          console.log(`  [GENERATED] base sprite`);
          totalGenerated++;
          if (result.result?.character_id) {
            characterId = result.result.character_id;
          }
        }

        // Determine destination based on biome
        const destFolder = biome === 'bosses' ? 'bosses' : biome;
        const destPath = `characters/enemies/${destFolder}/${enemyName}/${enemyName}_base.png`;
        await cache.copyToAssets(result.cacheKey, destPath);

      } catch (error) {
        console.error(`  [ERROR] base sprite: ${error.message}`);
        continue; // Skip animations if base fails
      }

      // Generate animations
      for (const anim of ENEMY_ANIMATIONS) {
        const animParams = {
          enemy: enemyName,
          biome: biome,
          animation: anim.name,
          animation_template: anim.template,
          seed: getAnimationSeed(biome, enemyName, anim.name)
        };

        try {
          const result = await cache.getOrGenerate(`enemy_anim_${biome}_${enemyName}_${anim.name}`, animParams, async (p) => {
            console.log(`    Generating ${anim.name}...`);

            if (characterId) {
              return await client.createCharacterAnimation({
                character_id: characterId,
                animation_template: p.animation_template,
                outline: 'medium',
                shading: 'detailed'
              });
            } else {
              return await client.animateWithText({
                character_description: prompt,
                action_description: getEnemyAction(enemyName, anim.name),
                image_size: size,
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

          const destFolder = biome === 'bosses' ? 'bosses' : biome;
          const destPath = `characters/enemies/${destFolder}/${enemyName}/${enemyName}_${anim.name}.png`;
          await cache.copyToAssets(result.cacheKey, destPath);

        } catch (error) {
          console.error(`    [ERROR] ${anim.name}: ${error.message}`);
        }
      }
    }
  }

  console.log('\n=== Generation Complete ===');
  console.log(`Generated: ${totalGenerated} sprites/animations`);
  console.log(`From cache: ${totalCached} sprites/animations`);
  console.log(`Total: ${totalGenerated + totalCached}`);
}

/**
 * Get action description for enemy animation
 */
function getEnemyAction(enemyName, animation) {
  const genericActions = {
    idle: 'standing alert, ready for combat',
    attack: 'aggressive attack motion',
    hit: 'reacting to damage, recoiling',
    death: 'collapsing defeated'
  };

  // Special actions for specific enemies
  const specialActions = {
    gray_wolf: { attack: 'lunging bite attack', idle: 'snarling stance' },
    treant: { attack: 'sweeping branch attack', idle: 'swaying menacingly' },
    stone_golem: { attack: 'smashing fist attack', idle: 'standing guard' },
    ghost: { attack: 'ethereal touch attack', death: 'fading into mist' },
    dragon: { attack: 'fire breath attack', idle: 'wings spread majestically' },
    frost_wyvern: { attack: 'ice breath attack', idle: 'perched on rocks' }
  };

  return specialActions[enemyName]?.[animation] || genericActions[animation] || animation;
}

/**
 * Generate deterministic seed for enemy
 */
function getEnemySeed(biome, enemyName) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const biomeHash = hashString(biome);
  const enemyHash = hashString(enemyName);
  return (worldSeed + biomeHash + enemyHash) % 1000000;
}

/**
 * Generate deterministic seed for animation
 */
function getAnimationSeed(biome, enemyName, animation) {
  const worldSeed = parseInt(process.env.WORLD_SEED || '12345');
  const biomeHash = hashString(biome);
  const enemyHash = hashString(enemyName);
  const animHash = hashString(animation);
  return (worldSeed + biomeHash + enemyHash + animHash) % 1000000;
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
  generateEnemies().catch(error => {
    console.error('Generation failed:', error);
    process.exit(1);
  });
}

module.exports = { generateEnemies };
