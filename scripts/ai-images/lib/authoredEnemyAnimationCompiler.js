'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const {
  APPROVED_STATUS,
  compileAtlasAnimation,
  compileDeadAnimation,
  compileReferenceBuffer,
  sha256,
  stableJson
} = require('./authoredPlayerAnimationCompiler');
const {
  COMPILER_VERSION,
  DEFAULT_AUTHORED_ALIASES,
  DEFAULT_PORTRAIT_REGISTRY,
  enemySnapshot,
  resolveEnemyIdentity
} = require('./authoredEnemyAnimationDraft');

const DEFAULT_SPEC_DIRECTORY = 'ai-image-metadata/characters/enemy-authored-animations';
const DEFAULT_ENEMY_DIRECTORY = 'ai-image-metadata/characters/enemies';

function resolveProjectPath(root, candidate, label) {
  if (typeof candidate !== 'string' || !candidate || path.isAbsolute(candidate)) throw new Error(`${label} must be project-relative`);
  const resolved = path.resolve(root, candidate);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`${label} escapes the project root`);
  return resolved;
}
async function readJson(file) { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
async function evidence(file) {
  const bytes = await fs.promises.readFile(file);
  const metadata = await sharp(bytes).metadata();
  return { bytes, sha256: sha256(bytes), dimensions: `${metadata.width}x${metadata.height}` };
}
async function atomicWrite(file, contents) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
  try { await fs.promises.writeFile(temporary, contents, { flag: 'wx' }); await fs.promises.rename(temporary, file); }
  catch (error) { await fs.promises.unlink(temporary).catch(() => {}); throw error; }
}
function pinForSource(source, chroma, prompt, compiled) {
  return {
    sourceSha256: source.sha256,
    sourceDimensions: source.dimensions,
    chromaSourceSha256: chroma.sha256,
    chromaSourceDimensions: chroma.dimensions,
    promptSha256: sha256(prompt),
    encodedSha256: sha256(compiled.buffer),
    poseSha256: compiled.poseSignatures
  };
}
function comparePin(actual, expected, label, issues) {
  if (!expected) { issues.push(`${label} is not pinned; run with --update-pins after approval`); return; }
  for (const [key, value] of Object.entries(actual)) {
    if (stableJson(value) !== stableJson(expected[key])) issues.push(`${label} ${key} does not match its pin`);
  }
}
function applyApproval(spec, approvedAt = new Date().toISOString()) {
  if (!APPROVED_STATUS.test(String(spec.status || ''))) {
    spec.status = 'approved';
    spec.approvedAt = approvedAt;
  } else if (!spec.approvedAt) {
    spec.approvedAt = approvedAt;
  }
}
function runtimeOutputPaths(projectRoot, biome, id) {
  const directory = path.join(projectRoot, 'frontend/public/assets/characters/enemies', biome, id);
  return {
    reference: path.join(directory, `${id}_reference.png`),
    animations: Object.fromEntries(
      ['idle', 'attack', 'hit', 'death', 'dead'].map(action => [action, path.join(directory, `${id}_${action}.webp`)])
    )
  };
}
async function compileAuthoredEnemy(options = {}) {
  if (options.approve && !options.updatePins) throw new Error('--approve requires --update-pins');
  if (options.approve && options.check) throw new Error('--approve and --check are mutually exclusive');
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../../..'));
  const id = String(options.id || '').trim();
  const biome = String(options.biome || '').trim();
  if (!/^[a-z0-9_]+$/.test(id) || !/^[a-z0-9_]+$/.test(biome)) throw new Error('--id and --biome are required safe path segments');
  const specRelative = options.specPath
    ? path.relative(projectRoot, path.resolve(options.specPath)).split(path.sep).join('/')
    : `${DEFAULT_SPEC_DIRECTORY}/${biome}/${id}.json`;
  const specPath = resolveProjectPath(projectRoot, specRelative, 'spec path');
  const specInitial = await fs.promises.readFile(specPath);
  const spec = JSON.parse(specInitial);
  if (spec.id !== id || spec.biome !== biome) throw new Error('spec identity does not match --biome/--id');
  if (!APPROVED_STATUS.test(String(spec.status || '')) && !options.approve) throw new Error(`${biome}/${id} is not approved; use --approve with --update-pins after visual review`);
  if (spec.compilerVersion !== COMPILER_VERSION && !options.updatePins) throw new Error(`spec compilerVersion ${spec.compilerVersion} does not match ${COMPILER_VERSION}`);

  const registryRelative = spec.draftProvenance?.registry || `${DEFAULT_ENEMY_DIRECTORY}/${biome}.json`;
  const portraitRegistryRelative = spec.draftProvenance?.portraitRegistry || DEFAULT_PORTRAIT_REGISTRY;
  const aliasRegistryRelative = spec.draftProvenance?.authoredAliasRegistry || DEFAULT_AUTHORED_ALIASES;
  const [registry, portraitRegistry, aliasRegistry, template, profile] = await Promise.all([
    readJson(resolveProjectPath(projectRoot, registryRelative, 'registry path')),
    readJson(resolveProjectPath(projectRoot, portraitRegistryRelative, 'portrait registry path')),
    readJson(resolveProjectPath(projectRoot, aliasRegistryRelative, 'authored alias registry path')),
    readJson(resolveProjectPath(projectRoot, spec.template, 'template path')),
    readJson(resolveProjectPath(projectRoot, spec.profileSource, 'profile path'))
  ]);
  const { enemy, portrait } = resolveEnemyIdentity(registry, aliasRegistry, portraitRegistry, id, biome);
  if (!enemy) throw new Error(`${id} is missing from ${registryRelative}`);
  if (!portrait) throw new Error(`enemy_${id} is missing from ${portraitRegistryRelative}`);
  const fingerprint = sha256(stableJson(enemySnapshot(enemy, portrait, biome, registry.biomeTraits)));
  const templateSha256 = sha256(stableJson(template));
  const profileSha256 = sha256(stableJson(profile));
  const authoredAliasRegistrySha256 = sha256(stableJson(aliasRegistry));
  const issues = [];
  if (spec.metadataFingerprint !== fingerprint) issues.push('enemy metadata fingerprint is stale; redraft and re-approve');
  if (!options.updatePins) {
    if (spec.pins?.templateSha256 !== templateSha256) issues.push('template hash does not match its pin');
    if (spec.pins?.profileSha256 !== profileSha256) issues.push('profile hash does not match its pin');
    if (spec.pins?.authoredAliasRegistrySha256 !== authoredAliasRegistrySha256) issues.push('authored alias registry hash does not match its pin');
  }

  const referenceSource = resolveProjectPath(projectRoot, spec.reference.source, 'reference source');
  const referenceChroma = resolveProjectPath(projectRoot, spec.reference.chromaSource, 'reference chroma source');
  const identitySource = resolveProjectPath(projectRoot, spec.reference.identitySource, 'identity source');
  const styleSource = resolveProjectPath(projectRoot, spec.reference.styleSource, 'style source');
  const [referenceBuffer, referenceEvidence, referenceChromaEvidence, identityEvidence, styleEvidence] = await Promise.all([
    compileReferenceBuffer(referenceSource), evidence(referenceSource), evidence(referenceChroma), evidence(identitySource), evidence(styleSource)
  ]);
  const referencePin = {
    sourceSha256: referenceEvidence.sha256, sourceDimensions: referenceEvidence.dimensions,
    chromaSourceSha256: referenceChromaEvidence.sha256, chromaSourceDimensions: referenceChromaEvidence.dimensions,
    identitySourceSha256: identityEvidence.sha256, identitySourceDimensions: identityEvidence.dimensions,
    styleSourceSha256: styleEvidence.sha256, styleSourceDimensions: styleEvidence.dimensions,
    promptSha256: sha256(spec.reference.prompt), encodedSha256: sha256(referenceBuffer)
  };
  if (!options.updatePins) comparePin(referencePin, spec.pins?.reference, 'reference', issues);

  const compiled = {};
  const animationPins = {};
  for (const action of ['idle', 'attack', 'hit', 'death']) {
    const config = spec.animations[action];
    const sourcePath = resolveProjectPath(projectRoot, config.source, `${action} source`);
    const chromaPath = resolveProjectPath(projectRoot, config.chromaSource, `${action} chroma source`);
    const [result, source, chroma] = await Promise.all([
      compileAtlasAnimation(sourcePath, action === 'hit' ? 'hurt' : action, config), evidence(sourcePath), evidence(chromaPath)
    ]);
    compiled[action] = result;
    animationPins[action] = pinForSource(source, chroma, config.prompt, result);
    if (!options.updatePins) comparePin(animationPins[action], spec.pins?.animations?.[action], action, issues);
  }
  compiled.dead = await compileDeadAnimation(compiled.death);
  animationPins.dead = {
    deriveFrom: spec.animations.dead.deriveFrom,
    promptSha256: sha256(spec.animations.dead.prompt),
    encodedSha256: sha256(compiled.dead.buffer),
    poseSha256: compiled.dead.poseSignatures
  };
  if (!options.updatePins) comparePin(animationPins.dead, spec.pins?.animations?.dead, 'dead', issues);

  const runtimePaths = runtimeOutputPaths(projectRoot, biome, id);
  const outputs = [[runtimePaths.reference, referenceBuffer]];
  for (const [action, result] of Object.entries(compiled)) outputs.push([runtimePaths.animations[action], result.buffer]);
  if (options.check) {
    for (const [file, buffer] of outputs) {
      let actual = null; try { actual = await fs.promises.readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!actual) issues.push(`${path.relative(projectRoot, file)} is missing`);
      else if (sha256(actual) !== sha256(buffer)) issues.push(`${path.relative(projectRoot, file)} differs from deterministic compilation`);
    }
  }
  if (issues.length) return { ok: false, check: Boolean(options.check), id, biome, generated: [], issues };

  const generated = [];
  if (!options.check) {
    for (const [file, buffer] of outputs) {
      if (fs.existsSync(file)) {
        const current = await fs.promises.readFile(file);
        if (sha256(current) === sha256(buffer)) continue;
        if (!options.force) throw new Error(`${path.relative(projectRoot, file)} exists; use --force`);
      }
      await atomicWrite(file, buffer);
      generated.push(path.relative(projectRoot, file).split(path.sep).join('/'));
    }
    if (options.updatePins) {
      spec.compilerVersion = COMPILER_VERSION;
      spec.metadataFingerprint = fingerprint;
      spec.pins = { templateSha256, profileSha256, authoredAliasRegistrySha256, reference: referencePin, animations: animationPins };
      if (options.approve) applyApproval(spec);
      await atomicWrite(specPath, Buffer.from(`${JSON.stringify(spec, null, 2)}\n`));
    }
  }
  return { ok: true, check: Boolean(options.check), id, biome, generated, issues: [] };
}

module.exports = { DEFAULT_SPEC_DIRECTORY, applyApproval, compileAuthoredEnemy, comparePin, pinForSource, runtimeOutputPaths };
