#!/usr/bin/env node
/**
 * Portrait SVG Generator
 * Generates missing character and enemy portrait SVGs
 */

const fs = require('fs');
const path = require('path');

const { createPortraitSvg, background, SKIN_PALETTES, EQUIPMENT_PALETTES, drawShoulders } = require('./icons/portraits/utils');
const { getRaceGenerator } = require('./icons/portraits/races');
const { getClassEquipment } = require('./icons/portraits/classes');
const { generateEnemyPortraits } = require('./icons/portraits/enemies');

// Output directories
const SVG_OUTPUT_DIR = path.join(__dirname, '../frontend/public/assets/sprites/portraits/svg');
const ENEMY_OUTPUT_DIR = path.join(__dirname, '../frontend/public/assets/sprites/enemies');
const PORTRAIT_DIR = path.join(__dirname, '../frontend/public/assets/sprites/portraits');

// Character combinations to generate
const RACES = ['human', 'elf', 'dwarf', 'vampire', 'orc'];
const GENDERS = ['male', 'female', 'other'];
const CLASSES = ['warrior', 'wizard', 'monk', 'chemist', 'berserker', 'sorcerer', 'ninja', 'alchemist'];

// Track what already exists
function getExistingPortraits() {
  const existing = new Set();
  if (fs.existsSync(PORTRAIT_DIR)) {
    const files = fs.readdirSync(PORTRAIT_DIR);
    files.forEach(file => {
      if (file.endsWith('.png')) {
        existing.add(file.replace('.png', ''));
      }
    });
  }
  return existing;
}

function getExistingEnemyPortraits() {
  const existing = new Set();
  if (fs.existsSync(ENEMY_OUTPUT_DIR)) {
    const files = fs.readdirSync(ENEMY_OUTPUT_DIR);
    files.forEach(file => {
      if (file.endsWith('.png')) {
        existing.add(file.replace('.png', ''));
      }
    });
  }
  return existing;
}

/**
 * Generate a character portrait by combining race base + class equipment
 */
function generateCharacterPortrait(race, gender, charClass) {
  // Background color based on class
  const classColors = {
    warrior: '#2a2830',
    wizard: '#1a2030',
    monk: '#2a2a20',
    chemist: '#2a2020',
    berserker: '#301a1a',
    sorcerer: '#201a30',
    ninja: '#1a1a20',
    alchemist: '#1a2a20'
  };

  let content = '';

  // Background
  content += background(classColors[charClass] || '#2a2a30');

  // Shoulders/clothing base (before face so equipment can overlay)
  const clothPalette = EQUIPMENT_PALETTES.cloth;
  content += drawShoulders(32, 50, clothPalette, gender === 'male' ? 'wide' : 'medium');

  // Race base (face, features, hair)
  const raceGenerator = getRaceGenerator(race);
  content += raceGenerator(gender);

  // Class equipment overlay
  content += getClassEquipment(charClass);

  return createPortraitSvg(content);
}

/**
 * Main generation function
 */
function generatePortraits() {
  console.log('Portrait SVG Generator');
  console.log('======================\n');

  // Ensure output directories exist
  fs.mkdirSync(SVG_OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(ENEMY_OUTPUT_DIR, { recursive: true });

  const existingPortraits = getExistingPortraits();
  const existingEnemies = getExistingEnemyPortraits();

  let generatedCount = 0;
  let skippedCount = 0;

  // Generate character portraits
  console.log('Generating character portraits...\n');

  for (const race of RACES) {
    for (const gender of GENDERS) {
      for (const charClass of CLASSES) {
        const filename = `${race}_${gender}_${charClass}`;

        // Skip if PNG already exists (won't overwrite)
        if (existingPortraits.has(filename)) {
          skippedCount++;
          continue;
        }

        try {
          const svg = generateCharacterPortrait(race, gender, charClass);
          const svgPath = path.join(SVG_OUTPUT_DIR, `${filename}.svg`);
          fs.writeFileSync(svgPath, svg);
          console.log(`  Created: ${filename}.svg`);
          generatedCount++;
        } catch (error) {
          console.error(`  Error generating ${filename}: ${error.message}`);
        }
      }
    }
  }

  console.log(`\nCharacter portraits: ${generatedCount} generated, ${skippedCount} skipped (already exist)\n`);

  // Generate enemy portraits
  console.log('Generating enemy portraits...\n');

  const enemyPortraits = generateEnemyPortraits();
  let enemyGeneratedCount = 0;
  let enemySkippedCount = 0;

  for (const [enemyName, svg] of Object.entries(enemyPortraits)) {
    // Skip if already exists
    if (existingEnemies.has(enemyName)) {
      enemySkippedCount++;
      continue;
    }

    try {
      const svgPath = path.join(ENEMY_OUTPUT_DIR, `${enemyName}.svg`);
      fs.writeFileSync(svgPath, svg);
      console.log(`  Created: ${enemyName}.svg`);
      enemyGeneratedCount++;
    } catch (error) {
      console.error(`  Error generating ${enemyName}: ${error.message}`);
    }
  }

  console.log(`\nEnemy portraits: ${enemyGeneratedCount} generated, ${enemySkippedCount} skipped (already exist)\n`);

  // Summary
  console.log('======================');
  console.log('Summary:');
  console.log(`  Character portraits: ${generatedCount} new SVGs`);
  console.log(`  Enemy portraits: ${enemyGeneratedCount} new SVGs`);
  console.log(`  Total new: ${generatedCount + enemyGeneratedCount}`);
  console.log(`\nSVG files saved to:`);
  console.log(`  Characters: ${SVG_OUTPUT_DIR}`);
  console.log(`  Enemies: ${ENEMY_OUTPUT_DIR}`);
  console.log(`\nRun 'npm run generate:icons -- --portraits' to convert to PNG`);
}

// Run if called directly
if (require.main === module) {
  generatePortraits();
}

module.exports = { generatePortraits, generateCharacterPortrait };
