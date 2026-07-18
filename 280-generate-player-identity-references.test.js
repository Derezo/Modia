'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  parseArgs,
  inspectIdentityReference,
  hasCanonicalTraitConflict,
  getIdentitySourcePath,
  resolveIdentityReferenceGuidance,
  buildIdentityReferencePrompt,
  buildIdentityReferenceNegativePrompt
} = require('./generate-player-identity-references');

test('identity-reference CLI parses bounded resumable selections', () => {
  assert.deepEqual(
    parseArgs(['--id', 'elf_female_wizard', '--limit', '3', '--force', '--verbose']),
    {
      ids: ['elf_female_wizard'],
      limit: 3,
      force: true,
      promote: false,
      dryRun: false,
      check: false,
      verbose: true
    }
  );
  assert.throws(() => parseArgs(['--limit', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
  assert.equal(parseArgs(['--id', 'human_male_warrior', '--promote']).promote, true);
});

test('identity-reference inspection accepts a padded RGBA PNG', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-identity-ref-'));
  try {
    const filePath = path.join(directory, 'reference.png');
    const subject = Buffer.from(
      '<svg width="220" height="420" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="220" height="420" rx="40" fill="#315fa8"/></svg>'
    );
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).composite([{ input: subject, left: 146, top: 60 }]).png().toFile(filePath);

    const inspection = await inspectIdentityReference(filePath);
    assert.equal(inspection.valid, true);
    assert.ok(inspection.coverage > 0.2 && inspection.coverage < 0.6);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('identity-reference inspection rejects an opaque or oversized stage', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-identity-ref-bad-'));
  try {
    const filePath = path.join(directory, 'reference.png');
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 20, g: 30, b: 40, alpha: 1 }
      }
    }).png().toFile(filePath);
    const inspection = await inspectIdentityReference(filePath);
    assert.equal(inspection.valid, false);
    assert.match(inspection.reason, /coverage/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('identity-reference inspection rejects a broad colored backdrop below the coverage ceiling', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-identity-ref-stage-'));
  try {
    const filePath = path.join(directory, 'reference.png');
    const stage = Buffer.from(
      '<svg width="450" height="180" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="450" height="180" fill="#65b8e8"/></svg>'
    );
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).composite([{ input: stage, left: 31, top: 120 }]).png().toFile(filePath);

    const inspection = await inspectIdentityReference(filePath);
    assert.equal(inspection.valid, false);
    assert.match(inspection.reason, /background-like alpha stage/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('identity-reference inspection rejects multiple large disconnected subjects', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-identity-ref-multiple-'));
  try {
    const filePath = path.join(directory, 'reference.png');
    const subject = Buffer.from(
      '<svg width="130" height="350" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="130" height="350" rx="30" fill="#91532f"/></svg>'
    );
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).composite([
      { input: subject, left: 80, top: 90 },
      { input: subject, left: 300, top: 90 }
    ]).png().toFile(filePath);

    const inspection = await inspectIdentityReference(filePath);
    assert.equal(inspection.valid, false);
    assert.match(inspection.reason, /multiple large foreground subjects/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('identity-reference inspection accepts one dominant subject with detached class gear', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-identity-ref-gear-'));
  try {
    const filePath = path.join(directory, 'reference.png');
    const subject = Buffer.from(
      '<svg width="120" height="300" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="120" height="300" rx="24" fill="#91532f"/></svg>'
    );
    const banner = Buffer.from(
      '<svg width="70" height="280" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="70" height="280" rx="5" fill="#d2a23f"/></svg>'
    );
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).composite([
      { input: subject, left: 145, top: 105 },
      { input: banner, left: 315, top: 115 }
    ]).png().toFile(filePath);

    const inspection = await inspectIdentityReference(filePath);
    assert.equal(inspection.valid, true, inspection.reason);
    assert.ok(inspection.primarySubjectRatio > 0.6);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('contradictory legacy portraits use canonical-gender-dominant conditioning', () => {
  const variant = {
    id: 'dwarf_female_chemist',
    race: 'dwarf',
    gender: 'female',
    class: 'chemist',
    visualTraits: 'dwarf stout build thick beard braided hair female chemist'
  };
  assert.equal(hasCanonicalTraitConflict(variant), true);
  assert.deepEqual(
    resolveIdentityReferenceGuidance(variant, '/assets/portraits/originals/dwarf_female_chemist.png', {
      controlnetWeight: 0.7,
      ipadapterWeight: 0.7
    }),
    { controlnetWeight: 0.82, ipadapterWeight: 0.45, mode: 'canonical_gender_anchor' }
  );

  const prompt = buildIdentityReferencePrompt(variant, 'cps2-pixel-art');
  assert.match(prompt, /canonical gender controls the face and body/);
  assert.match(prompt, /corrected reference supplies race gender proportions and hairstyle/);
  assert.match(prompt, /clearly dwarf/);
  assert.match(prompt, /clearly recognizable chemist/);
  assert.match(prompt, /glass potion vials/);
  assert.doesNotMatch(prompt, /thick beard/);
  assert.match(getIdentitySourcePath(variant), /reference-anchors\/dwarf_female_neutral\.png$/);
  assert.match(buildIdentityReferenceNegativePrompt(variant), /beard/);
  assert.match(buildIdentityReferenceNegativePrompt(variant), /multiple characters/);
});
