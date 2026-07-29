#!/usr/bin/env node
/*
 * Stage one portrait-conditioned full-body candidate per player identity.
 * Technical validation is automatic, but diffusion cannot reliably detect
 * duplicate faces or semantic identity drift, so candidates become canonical
 * only through an explicit targeted --promote. Existing golden/manual or
 * deterministic references are never overwritten unless --force is explicit.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  ensureDirectoryExists,
  fileExists,
  getProjectRoot,
  generateAnimation,
  buildSD15CharacterPrompt,
  log
} = require('./lib');
const { getCharacterReferencePath } = require('./lib/assetPathsBridge');
const {
  prepareAnimationReference,
  resolveAnimationGuidance,
  resolveCharacterGenerationConfig
} = require('./generate-characters');

const PROJECT_ROOT = getProjectRoot();
const REGISTRY_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/characters/player-variants.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/characters/manifest.json');
const TEMP_DIR = path.join(PROJECT_ROOT, 'ai-images-temp/characters/identity-references');
const CANDIDATE_DIR = path.join(PROJECT_ROOT, 'ai-images-temp/characters/identity-candidates');
const REJECTED_DIR = path.join(PROJECT_ROOT, 'ai-images-temp/rejected/identity-references');
const DWARF_FEMALE_ANCHOR_PATH = path.join(
  PROJECT_ROOT,
  'ai-image-metadata/characters/reference-anchors/dwarf_female_neutral.png'
);
const MAX_GENERATION_ATTEMPTS = 3;

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    ids: [],
    limit: Infinity,
    force: false,
    promote: false,
    dryRun: false,
    check: false,
    verbose: false
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--id' || arg === '--key') {
      const id = argv[++index];
      if (!id) throw new Error(`${arg} requires a value`);
      options.ids.push(id);
    } else if (arg === '--limit') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--limit must be a positive integer');
      options.limit = value;
    } else if (arg === '--force') options.force = true;
    else if (arg === '--promote') options.promote = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--verbose') options.verbose = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function inspectIdentityReference(filePath) {
  try {
    const metadata = await sharp(filePath).metadata();
    if (metadata.format !== 'png' || metadata.width < 512 || metadata.height < 512 || !metadata.hasAlpha) {
      return { valid: false, reason: 'expected an RGBA PNG at least 512x512' };
    }
    const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let foreground = 0;
    let transparent = 0;
    const pixelCount = metadata.width * metadata.height;
    const rowForeground = new Uint32Array(metadata.height);
    const foregroundMask = new Uint8Array(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      const alpha = data[(pixel * info.channels) + info.channels - 1];
      if (alpha > 0) {
        foreground++;
        foregroundMask[pixel] = 1;
        rowForeground[Math.floor(pixel / metadata.width)]++;
      } else transparent++;
    }
    const coverage = foreground / (metadata.width * metadata.height);
    if (foreground === 0 || transparent === 0 || coverage > 0.6) {
      return { valid: false, reason: `invalid alpha/foreground coverage ${(coverage * 100).toFixed(1)}%`, coverage };
    }
    const broadRows = [...rowForeground].filter(count => count / metadata.width > 0.78).length;
    // Wide weapons, capes, and spell effects can legitimately span a handful
    // of rows. A backdrop occupies a material vertical band as well as most of
    // the canvas width.
    const broadStageRowThreshold = Math.ceil(metadata.height * 0.1);
    if (broadRows >= broadStageRowThreshold) {
      return {
        valid: false,
        reason: `background-like alpha stage spans ${broadRows} broad rows`,
        coverage,
        broadRows
      };
    }

    const visited = new Uint8Array(pixelCount);
    const queue = new Int32Array(pixelCount);
    let largestComponent = 0;
    for (let start = 0; start < pixelCount; start++) {
      if (!foregroundMask[start] || visited[start]) continue;
      let head = 0;
      let tail = 0;
      let componentSize = 0;
      queue[tail++] = start;
      visited[start] = 1;
      while (head < tail) {
        const pixel = queue[head++];
        componentSize++;
        const x = pixel % metadata.width;
        const neighbors = [pixel - metadata.width, pixel + metadata.width];
        if (x > 0) neighbors.push(pixel - 1);
        if (x + 1 < metadata.width) neighbors.push(pixel + 1);
        for (const neighbor of neighbors) {
          if (neighbor >= 0 && neighbor < pixelCount && foregroundMask[neighbor] && !visited[neighbor]) {
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
      }
      largestComponent = Math.max(largestComponent, componentSize);
    }
    const primarySubjectRatio = largestComponent / foreground;
    // Canonical game sprites can have detached but intentional class props
    // (paired axes, a banner, staff, orbiting effects). Require one component
    // to remain the clear majority while still rejecting two similarly sized
    // character subjects.
    if (primarySubjectRatio < 0.55) {
      return {
        valid: false,
        reason: `multiple large foreground subjects; primary component ${(primarySubjectRatio * 100).toFixed(1)}%`,
        coverage,
        primarySubjectRatio
      };
    }
    return { valid: true, coverage, primarySubjectRatio };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

async function getReferencePath(variant) {
  return getCharacterReferencePath(variant, { type: 'player' });
}

function getCandidatePath(variant) {
  return path.join(CANDIDATE_DIR, `${variant.id}_reference.png`);
}

function getPortraitPath(variant) {
  return path.join(PROJECT_ROOT, 'frontend/public', variant.portraitReference.replace(/^\//, ''));
}

function hasCanonicalTraitConflict(variant) {
  return variant.gender === 'female' && /\b(?:beard(?:ed)?|mustache|masculine|male)\b/i.test(variant.visualTraits || '');
}

function getIdentitySourcePath(variant, portraitPath) {
  if (hasCanonicalTraitConflict(variant) && fileExists(DWARF_FEMALE_ANCHOR_PATH)) {
    return DWARF_FEMALE_ANCHOR_PATH;
  }
  return portraitPath || getPortraitPath(variant);
}

function resolveIdentityReferenceGuidance(variant, portraitPath, generationConfig) {
  const guidance = resolveAnimationGuidance(portraitPath, generationConfig);
  if (!hasCanonicalTraitConflict(variant)) return guidance;
  return {
    controlnetWeight: Math.max(Number(generationConfig.controlnetWeight), 0.82),
    ipadapterWeight: Math.min(Number(generationConfig.ipadapterWeight), 0.45),
    mode: 'canonical_gender_anchor'
  };
}

function buildIdentityReferencePrompt(character, loraModel) {
  let prompt = buildSD15CharacterPrompt(character, 'idle', { loraModel });
  if (hasCanonicalTraitConflict(character)) {
    prompt = prompt.replace(
      'preserve the exact reference identity costume equipment and palette',
      'preserve the reference palette costume equipment and hairstyle, canonical gender controls the face and body'
    );
    prompt += ', corrected reference supplies race gender proportions and hairstyle, class prompt controls equipment, do not add facial hair or masculine anatomy';
  }
  return prompt;
}

function buildIdentityReferenceNegativePrompt(character) {
  const constraints = [
    'multiple characters',
    'duplicate character',
    'character lineup',
    'sprite sheet',
    'cropped body',
    'close-up portrait',
    'colored background',
    'circular backdrop',
    'scenery',
    'floor',
    'cast shadow'
  ];
  if (hasCanonicalTraitConflict(character)) {
    constraints.push('man', 'male', 'masculine face', 'beard', 'mustache', 'facial hair');
  }
  return constraints.join(', ');
}

async function generateOne(variant, manifest, options) {
  const canonicalPath = await getReferencePath(variant);
  const candidatePath = getCandidatePath(variant);
  if (fileExists(canonicalPath) && !options.force) {
    const inspection = await inspectIdentityReference(canonicalPath);
    return inspection.valid
      ? { status: 'skipped', outputPath: canonicalPath, inspection }
      : { status: 'failed', outputPath: canonicalPath, error: inspection.reason };
  }

  if (options.promote) {
    if (!fileExists(candidatePath)) {
      return { status: 'failed', outputPath: canonicalPath, error: `approved candidate missing: ${candidatePath}` };
    }
    const inspection = await inspectIdentityReference(candidatePath);
    if (!inspection.valid) {
      return { status: 'failed', outputPath: canonicalPath, error: `candidate is invalid: ${inspection.reason}` };
    }
    if (options.dryRun) {
      return { status: 'planned', outputPath: canonicalPath, candidatePath, inspection };
    }
    ensureDirectoryExists(path.dirname(canonicalPath));
    const temporaryPath = path.join(path.dirname(canonicalPath), `.${path.basename(canonicalPath)}.${process.pid}.tmp`);
    fs.copyFileSync(candidatePath, temporaryPath);
    fs.renameSync(temporaryPath, canonicalPath);
    return { status: 'promoted', outputPath: canonicalPath, candidatePath, inspection };
  }

  const character = { ...variant, _type: 'player', _variant: true };
  const generationConfig = resolveCharacterGenerationConfig(character, {}, manifest);
  const portraitPath = getPortraitPath(variant);
  if (!fileExists(portraitPath)) {
    return { status: 'failed', outputPath: candidatePath, error: `portrait source missing: ${portraitPath}` };
  }

  const identitySourcePath = getIdentitySourcePath(variant, portraitPath);

  const preparedPortrait = options.dryRun
    ? identitySourcePath
    : await prepareAnimationReference(identitySourcePath, character);
  const guidance = resolveIdentityReferenceGuidance(variant, identitySourcePath, generationConfig);
  const prompt = buildIdentityReferencePrompt(character, generationConfig.animationLoraModel);
  ensureDirectoryExists(path.dirname(candidatePath));

  let lastFailure;
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const result = await generateAnimation({
      characterId: variant.id,
      animation: 'idle',
      prompt,
      controlnetWeight: guidance.controlnetWeight,
      ipadapterWeight: guidance.ipadapterWeight,
      referenceImage: preparedPortrait,
      loraModel: generationConfig.animationLoraModel,
      seed: Number(variant.seed) + attempt,
      seedPolicy: 'fixed',
      outputPath: candidatePath,
      originalsDirectory: path.join(TEMP_DIR, variant.id, `attempt-${attempt + 1}`),
      identityReferenceOnly: true,
      negativePrompt: buildIdentityReferenceNegativePrompt(character)
    }, {
      dryRun: options.dryRun,
      verbose: options.verbose,
      quiet: !options.verbose
    });

    if (!result.success || options.dryRun) {
      return result.success
        ? { status: 'planned', outputPath: candidatePath }
        : { status: 'failed', outputPath: candidatePath, error: result.stderr || 'generation failed' };
    }

    const inspection = await inspectIdentityReference(candidatePath);
    if (inspection.valid) {
      return { status: 'staged', outputPath: candidatePath, canonicalPath, inspection, attempt: attempt + 1 };
    }

    ensureDirectoryExists(REJECTED_DIR);
    const rejectedPath = path.join(REJECTED_DIR, `${variant.id}_attempt-${attempt + 1}_${Date.now()}.png`);
    fs.renameSync(candidatePath, rejectedPath);
    lastFailure = { rejectedPath, error: inspection.reason };
  }
  return { status: 'failed', outputPath: candidatePath, ...lastFailure };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const requested = new Set(options.ids);
  const variants = registry.variants
    .filter(variant => requested.size === 0 || requested.has(variant.id))
    .slice(0, options.limit);

  if (requested.size && variants.length !== requested.size) {
    const found = new Set(variants.map(variant => variant.id));
    throw new Error(`Unknown player ids: ${[...requested].filter(id => !found.has(id)).join(', ')}`);
  }
  if (options.promote && requested.size === 0) {
    throw new Error('--promote requires at least one explicit --id');
  }
  if (options.promote && options.check) {
    throw new Error('--promote and --check cannot be combined');
  }

  const counts = { staged: 0, promoted: 0, skipped: 0, planned: 0, failed: 0 };
  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index];
    const outputPath = await getReferencePath(variant);
    if (options.check) {
      const inspection = fileExists(outputPath)
        ? await inspectIdentityReference(outputPath)
        : { valid: false, reason: 'missing' };
      counts[inspection.valid ? 'skipped' : 'failed']++;
      if (!inspection.valid && options.verbose) log(`${variant.id}: ${inspection.reason}`, 'error');
      continue;
    }

    log(`[${index + 1}/${variants.length}] ${variant.id}`, 'info');
    const result = await generateOne(variant, manifest, options);
    counts[result.status]++;
    if (result.status === 'failed') log(`${variant.id}: ${result.error}`, 'error');
  }

  console.log(JSON.stringify({ selected: variants.length, ...counts }, null, 2));
  if (counts.failed > 0) process.exitCode = 1;
  return counts;
}

module.exports = {
  parseArgs,
  inspectIdentityReference,
  getCandidatePath,
  hasCanonicalTraitConflict,
  getIdentitySourcePath,
  resolveIdentityReferenceGuidance,
  buildIdentityReferencePrompt,
  buildIdentityReferenceNegativePrompt,
  generateOne,
  main
};

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
