#!/usr/bin/env node
/**
 * Materialize the portrait-matched player sprite registry.
 *
 * The portrait combinations file is authoritative for race/gender/class
 * identity. The class sprite file remains authoritative for animation lists,
 * motion traits, and class art direction. This script joins both sources into
 * a compact generation registry without duplicating frame prompts.
 *
 * Usage:
 *   node scripts/ai-images/sync-player-character-variants.js
 *   node scripts/ai-images/sync-player-character-variants.js --check
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PORTRAITS_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/portraits/combinations.json');
const PLAYERS_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/characters/players.json');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/characters/player-variants.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function canonicalIdentityReference(portrait) {
  return `/assets/characters/player/${portrait.race}/${portrait.gender}/${portrait.class}/${portrait.id}_reference.png`;
}

function buildRegistry() {
  const portraits = readJson(PORTRAITS_PATH);
  const playerSprites = readJson(PLAYERS_PATH);
  const existing = fs.existsSync(OUTPUT_PATH) ? readJson(OUTPUT_PATH) : { variants: [] };
  const existingById = new Map((existing.variants || []).map(variant => [variant.id, variant]));
  const templateByClass = new Map((playerSprites.players || []).map(template => [template.class, template]));

  const variants = (portraits.portraits || []).map((portrait, index) => {
    const template = templateByClass.get(portrait.class);
    if (!template) {
      throw new Error(`No character sprite template for portrait class: ${portrait.class}`);
    }

    const previous = existingById.get(portrait.id) || {};
    // Victory is a universal runtime state (battle outro), even though the
    // legacy class templates predate it. Keep class-specific cast support while
    // guaranteeing that every canonical identity owns a victory strip.
    const animations = [...new Set([...template.animations, 'victory'])];
    const generatedAnimations = Object.fromEntries(
      animations.map(animation => [animation, previous.generatedAnimations?.[animation] === true])
    );
    const generated = animations.every(animation => generatedAnimations[animation]);
    const portraitReference = `/assets/portraits/originals/${portrait.id}.png`;
    const identityReference = canonicalIdentityReference(portrait);
    const classTraits = playerSprites.classTraits?.[portrait.class] || {};
    const raceTraits = portraits.raceTraits?.[portrait.race] || portrait.race;
    const genderTraits = portraits.genderTraits?.[portrait.gender] || portrait.gender;

    return {
      id: portrait.id,
      race: portrait.race,
      gender: portrait.gender,
      class: portrait.class,
      isAdvanced: portrait.isAdvanced === true,
      inheritsFrom: template.id,
      animations,
      visualTraits: [raceTraits, genderTraits, classTraits.visualTraits].filter(Boolean).join(' '),
      portraitCard: `/assets/portraits/256/${portrait.id}.webp`,
      portraitReference,
      seed: portrait.seed ?? (70000 + index),
      generated,
      generatedAnimations,
      generatedAt: previous.generatedAt || null,
      needsRegeneration: !generated,
      regenerationQueuedAt: generated ? null : (previous.regenerationQueuedAt || null),
      sd15Config: {
        controlnetWeight: previous.sd15Config?.controlnetWeight ?? template.sd15Config?.controlnetWeight ?? 0.7,
        ipadapterWeight: previous.sd15Config?.ipadapterWeight ?? template.sd15Config?.ipadapterWeight ?? 0.7,
        // Animation generation must condition on the approved full-body identity.
        // Keep the portrait separately as immutable source/provenance rather than
        // allowing an old registry value to silently restore bust-only guidance.
        referenceImage: identityReference,
        identitySource: portraitReference,
        referenceLoraModel: previous.sd15Config?.referenceLoraModel || template.sd15Config?.referenceLoraModel || null,
        animationLoraModel: previous.sd15Config?.animationLoraModel || template.sd15Config?.animationLoraModel || null
      }
    };
  });

  return {
    version: '1.0.0',
    description: 'Portrait-matched player sprite variants for every race, gender, and class combination',
    identityContract: '{race}_{gender}_{class}',
    sourcePortraitMetadata: '../portraits/combinations.json',
    sourceClassMetadata: 'players.json',
    outputPattern: '/assets/characters/player/{race}/{gender}/{class}/{id}_{animation}.webp',
    totalVariants: variants.length,
    variants
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function main() {
  const expected = serialize(buildRegistry());
  const current = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : '';
  const checkOnly = process.argv.includes('--check');

  if (current === expected) {
    console.log(`Player character variant registry is current (${JSON.parse(expected).totalVariants} variants).`);
    return;
  }

  if (checkOnly) {
    console.error('Player character variant registry is out of date. Run npm run ai:sync:character-variants.');
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(OUTPUT_PATH, expected);
  console.log(`Wrote ${OUTPUT_PATH} (${JSON.parse(expected).totalVariants} variants).`);
}

if (require.main === module) main();

module.exports = { buildRegistry, canonicalIdentityReference, main, serialize };
