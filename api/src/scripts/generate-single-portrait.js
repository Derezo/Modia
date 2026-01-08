#!/usr/bin/env node
/**
 * Generate a single portrait for testing
 * Usage: node generate-single-portrait.js <race> <gender> <class>
 * Example: node generate-single-portrait.js elf male wizard
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const { getPortraitService } = require('../services/portraitService');
const { buildPortraitPrompt } = require('../config/pixelLabPrompts');

async function main() {
  const [,, race = 'elf', gender = 'male', charClass = 'wizard'] = process.argv;

  console.log(`\n=== Portrait Generation Test ===\n`);
  console.log(`Race: ${race}`);
  console.log(`Gender: ${gender}`);
  console.log(`Class: ${charClass}`);

  // Show the prompt that will be used
  const prompt = buildPortraitPrompt(race, gender, charClass);
  console.log(`\nPrompt:\n${prompt}\n`);

  const service = getPortraitService();

  console.log('Generating portrait...\n');

  const result = await service.generatePortrait(race, gender, charClass, true); // force=true to regenerate

  if (result.success) {
    console.log('Success!');
    console.log(`File: ${result.path}`);
    console.log(`URL: ${result.url}`);
    console.log(`Cached: ${result.cached}`);
  } else {
    console.error('Failed:', result.error);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
