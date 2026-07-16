'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const {
  COMPILER_VERSION: AUTHORED_COMPILER_VERSION,
  compileAtlasAnimation,
  compileDeadAnimation,
  compileReferenceBuffer,
  metadataFingerprint,
  resolveProjectPath,
  sha256,
  stableJson
} = require('./authoredPlayerAnimationCompiler');
const { findAlphaBounds } = require('./playerAnimationCompiler');

const DEFAULT_SPEC_DIRECTORY = 'ai-image-metadata/characters/player-authored-animations';
const APPROVED_STATUS = /^approved(?:[-_]|$)/;
const REQUIRED_PIN_FIELDS = Object.freeze([
  'sourceSha256',
  'promptSha256',
  'encodedSha256',
  'decodedSha256'
]);

function relativePath(projectRoot, absolutePath) {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

function resolveSpecDirectory(projectRoot, specDirectory = DEFAULT_SPEC_DIRECTORY) {
  return path.isAbsolute(specDirectory)
    ? path.resolve(specDirectory)
    : path.resolve(projectRoot, specDirectory);
}

/**
 * Discover only explicitly approved authored identities. Draft specs may coexist
 * in the directory without changing either fallback compiler's behavior.
 */
function discoverApprovedAuthoredSpecs(projectRoot, options = {}) {
  const directory = resolveSpecDirectory(projectRoot, options.specDirectory);
  if (!fs.existsSync(directory)) return new Map();

  const discovered = new Map();
  const filenames = fs.readdirSync(directory)
    .filter(filename => filename.endsWith('.json'))
    .sort();

  for (const filename of filenames) {
    const specPath = path.join(directory, filename);
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    if (!APPROVED_STATUS.test(String(spec.status || ''))) continue;

    const filenameId = path.basename(filename, '.json');
    if (spec.id !== filenameId) {
      throw new Error(`Approved authored player spec ${relativePath(projectRoot, specPath)} has id ${String(spec.id)} instead of ${filenameId}`);
    }
    if (!spec.pins?.reference || !spec.pins?.animations) {
      throw new Error(`Approved authored player spec ${filenameId} has no pinned outputs`);
    }
    for (const [label, source, expected] of [
      ['template', spec.template, spec.pins.templateSha256],
      ['animation profile', spec.profileSource, spec.pins.profileSha256]
    ]) {
      if (!expected) throw new Error(`Approved authored player spec ${filenameId} has no pinned ${label}`);
      const sourcePath = resolveProjectPath(projectRoot, source, label);
      if (sha256(fs.readFileSync(sourcePath)) !== expected) {
        throw new Error(`Approved authored player spec ${filenameId} ${label} pin differs`);
      }
    }
    for (const field of REQUIRED_PIN_FIELDS) {
      if (!spec.pins.reference[field]) {
        throw new Error(`Approved authored player spec ${filenameId} is missing reference pin ${field}`);
      }
    }
    discovered.set(spec.id, { id: spec.id, path: specPath, spec });
  }
  return discovered;
}

function assertIdentityContract(entry, variant) {
  const { spec } = entry;
  if (spec.compilerVersion !== AUTHORED_COMPILER_VERSION) {
    throw new Error(`${variant.id}: authored compiler version ${String(spec.compilerVersion || 'missing')} differs from ${AUTHORED_COMPILER_VERSION}`);
  }
  if (spec.id !== variant.id) throw new Error(`${variant.id}: authored spec id differs from player metadata`);
  for (const key of ['race', 'gender', 'class']) {
    if (spec.identity?.[key] !== variant[key]) {
      throw new Error(`${variant.id}: authored ${key} differs from player metadata`);
    }
  }
  if (spec.metadataFingerprint !== metadataFingerprint(variant)) {
    throw new Error(`${variant.id}: authored player metadata fingerprint differs`);
  }
}

function assertPin(label, actual, expected) {
  if (!expected) throw new Error(`${label}: approved authored output has no provenance pin`);
  for (const field of REQUIRED_PIN_FIELDS) {
    if (!expected[field]) throw new Error(`${label}: approved authored output is missing pin ${field}`);
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (stableJson(actual[field]) !== stableJson(expectedValue)) {
      throw new Error(`${label}: authored ${field} pin differs`);
    }
  }
}

async function decodedImageHash(input) {
  return sha256(await sharp(input).ensureAlpha().raw().toBuffer());
}

async function imageDimensions(input) {
  const metadata = await sharp(input).metadata();
  return `${metadata.width}x${metadata.height}`;
}

function animationOutputPin(compiled) {
  return {
    encodedSha256: sha256(compiled.buffer),
    decodedSha256: compiled.report.stripHash,
    frameSha256: compiled.report.frames.map(frame => frame.hash),
    poseSha256: compiled.poseSignatures,
    sourceFrameIndexes: compiled.sourceFrameIndexes,
    sourceDominantRatios: compiled.sourceDominantRatios
  };
}

async function compileAuthoredReferenceOverride({ projectRoot, variant, entry }) {
  assertIdentityContract(entry, variant);
  const { spec } = entry;
  const sourcePath = resolveProjectPath(projectRoot, spec.reference?.source, 'reference source');
  const chromaPath = resolveProjectPath(projectRoot, spec.reference?.chromaSource, 'reference chroma source');
  const identityPath = resolveProjectPath(projectRoot, spec.reference?.identitySource, 'identity source');
  const stylePath = resolveProjectPath(projectRoot, spec.reference?.styleSource, 'style source');
  const source = await fs.promises.readFile(sourcePath);
  const buffer = await compileReferenceBuffer(sourcePath);
  const actualPin = {
    sourceSha256: sha256(source),
    sourceDimensions: await imageDimensions(source),
    chromaSourceSha256: sha256(await fs.promises.readFile(chromaPath)),
    chromaSourceDimensions: await imageDimensions(chromaPath),
    identitySourceSha256: sha256(await fs.promises.readFile(identityPath)),
    identitySourceDimensions: await imageDimensions(identityPath),
    styleSourceSha256: sha256(await fs.promises.readFile(stylePath)),
    styleSourceDimensions: await imageDimensions(stylePath),
    promptSha256: sha256(spec.reference?.prompt || ''),
    encodedSha256: sha256(buffer),
    decodedSha256: await decodedImageHash(buffer)
  };
  assertPin(`${variant.id}/reference`, actualPin, spec.pins.reference);
  return {
    buffer,
    pin: actualPin,
    sourcePath,
    sourceDecodedSha256: await decodedImageHash(source),
    chromaPath,
    identityPath,
    stylePath
  };
}

async function compileAuthoredAnimationOverride({ projectRoot, variant, animation, entry }) {
  assertIdentityContract(entry, variant);
  const { spec } = entry;
  let animationSpec = spec.animations?.[animation];
  let compiled;
  let sourcePath;
  let chromaPath;
  let sourceSha256;
  let chromaSourceSha256;

  if (animation === 'dead') {
    animationSpec = spec.animations?.death;
    if (!animationSpec?.source) throw new Error(`${variant.id}/dead: authored death source is missing`);
    sourcePath = resolveProjectPath(projectRoot, animationSpec.source, 'death source');
    chromaPath = resolveProjectPath(projectRoot, animationSpec.chromaSource, 'death chroma source');
    const death = await compileAtlasAnimation(sourcePath, 'death', animationSpec);
    compiled = await compileDeadAnimation(death);
    sourceSha256 = sha256(await fs.promises.readFile(sourcePath));
    chromaSourceSha256 = sha256(await fs.promises.readFile(chromaPath));
  } else {
    if (!animationSpec?.source) throw new Error(`${variant.id}/${animation}: authored source is missing`);
    sourcePath = resolveProjectPath(projectRoot, animationSpec.source, `${animation} source`);
    chromaPath = resolveProjectPath(projectRoot, animationSpec.chromaSource, `${animation} chroma source`);
    compiled = await compileAtlasAnimation(sourcePath, animation, animationSpec);
    sourceSha256 = sha256(await fs.promises.readFile(sourcePath));
    chromaSourceSha256 = sha256(await fs.promises.readFile(chromaPath));
  }

  const prompt = animation === 'dead'
    ? (spec.animations?.dead?.prompt || 'derived-from-death-terminal-frame')
    : (animationSpec.prompt || '');
  const actualPin = {
    sourceSha256,
    sourceDimensions: await imageDimensions(sourcePath),
    chromaSourceSha256,
    chromaSourceDimensions: await imageDimensions(chromaPath),
    promptSha256: sha256(prompt),
    ...animationOutputPin(compiled)
  };
  assertPin(`${variant.id}/${animation}`, actualPin, spec.pins.animations?.[animation]);
  return { buffer: compiled.buffer, pin: actualPin, sourcePath, chromaPath };
}

async function createAuthoredReferenceProvenanceEntry({
  projectRoot,
  variant,
  entry,
  compiled,
  outputPath,
  fallbackCompilerVersion,
  semanticSignature
}) {
  const { spec } = entry;
  const { data, info } = await sharp(compiled.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    compilerVersion: fallbackCompilerVersion,
    race: variant.race,
    gender: variant.gender,
    class: variant.class,
    method: 'openai-built-in-imagegen-authored-reference',
    semanticSignature,
    sourcePortrait: relativePath(projectRoot, compiled.identityPath),
    sourcePortraitSha256: sha256(await fs.promises.readFile(compiled.identityPath)),
    genderAnchor: null,
    genderAnchorSha256: null,
    genderAnchorReason: null,
    sourcePixelSha256: compiled.sourceDecodedSha256,
    output: relativePath(projectRoot, outputPath),
    outputSha256: sha256(compiled.buffer),
    dimensions: `${info.width}x${info.height}`,
    encoding: 'lossless-rgba-png-authored-source-nearest-downscale',
    alphaBounds512: findAlphaBounds(data, info.width, info.height, info.channels, 0),
    authoredCompilerVersion: AUTHORED_COMPILER_VERSION,
    authoredPromptSha256: sha256(spec.reference?.prompt || ''),
    authoredChromaSource: relativePath(projectRoot, compiled.chromaPath),
    authoredChromaSourceSha256: sha256(await fs.promises.readFile(compiled.chromaPath)),
    authoredStyleSource: relativePath(projectRoot, compiled.stylePath),
    authoredStyleSourceSha256: sha256(await fs.promises.readFile(compiled.stylePath)),
    authoredAnimationSpec: relativePath(projectRoot, entry.path),
    authoredAnimationSpecSha256: sha256(await fs.promises.readFile(entry.path))
  };
}

module.exports = {
  APPROVED_STATUS,
  DEFAULT_SPEC_DIRECTORY,
  compileAuthoredAnimationOverride,
  compileAuthoredReferenceOverride,
  createAuthoredReferenceProvenanceEntry,
  discoverApprovedAuthoredSpecs
};
