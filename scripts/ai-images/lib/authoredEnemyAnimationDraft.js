'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { sha256, stableJson } = require('./authoredPlayerAnimationCompiler');

const DEFAULT_TEMPLATE = 'ai-image-metadata/characters/enemy-authored-animation-template.json';
const DEFAULT_PROFILE = 'ai-image-metadata/characters/enemy-animation-profiles/enemy_v1.json';
const DEFAULT_ENEMY_DIRECTORY = 'ai-image-metadata/characters/enemies';
const DEFAULT_PORTRAIT_REGISTRY = 'ai-image-metadata/portraits/enemies.json';
const DEFAULT_AUTHORED_ALIASES = 'ai-image-metadata/characters/enemy-authored-identity-aliases.json';
const DEFAULT_OUTPUT_DIRECTORY = 'ai-image-metadata/characters/enemy-authored-animations';
const COMPILER_VERSION = '1.0.0';
const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function serializeJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function projectRelative(root, file) { return path.relative(root, file).split(path.sep).join('/'); }
function resolveWithinProject(root, candidate, label) {
  if (typeof candidate !== 'string' || !candidate) throw new Error(`${label} must be a non-empty path`);
  const resolved = path.resolve(root, candidate);
  if (resolved !== path.resolve(root) && !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`${label} escapes the project root: ${candidate}`);
  }
  return resolved;
}
async function readJson(file, label) {
  try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`${label} does not exist: ${file}`); throw error; }
}
async function atomicWrite(file, contents) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`);
  try { await fs.promises.writeFile(temporary, contents, { flag: 'wx' }); await fs.promises.rename(temporary, file); }
  catch (error) { await fs.promises.unlink(temporary).catch(() => {}); throw error; }
}
function lookup(context, token, label) {
  const value = token.split('.').reduce((current, key) => current?.[key], context);
  if (value === undefined || value === null || value === '') throw new Error(`${label} references missing {{${token}}}`);
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') throw new Error(`${label} token {{${token}}} is not scalar`);
  return String(value);
}
function renderTemplate(template, context, label) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, token) => lookup(context, token, label)).replace(/\s+/g, ' ').trim();
}
function enemySnapshot(enemy, portrait, biome, biomeTraits) {
  return {
    biome,
    biomeTraits: biomeTraits || '',
    id: enemy.id,
    name: enemy.name,
    archetype: enemy.archetype,
    visualTraits: enemy.visualTraits,
    animationSourceId: enemy.authoredAnimationSourceId || enemy.id,
    portrait: {
      id: portrait.id,
      name: portrait.name,
      archetype: portrait.archetype,
      region: portrait.region,
      visualTraits: portrait.visualTraits,
      seed: portrait.seed
    },
    animations: Object.fromEntries(Object.entries(enemy.animations || {}).map(([name, value]) => [name, { frameCount: value.frameCount, prompt: value.prompt }]))
  };
}
function resolveEnemyIdentity(registry, aliasRegistry, portraitRegistry, id, biome) {
  const portrait = (portraitRegistry.enemies || []).find(value => value.id === `enemy_${id}`);
  const direct = (registry.enemies || []).find(value => value.id === id);
  const alias = (aliasRegistry.aliases || []).find(value => value.id === id && value.biome === biome);
  const source = alias
    ? (registry.enemies || []).find(value => value.id === alias.animationSourceId)
    : direct;
  if (!source) return { enemy: null, portrait, alias };
  if (!alias) return { enemy: source, portrait, alias: null };
  if (!portrait) return { enemy: null, portrait, alias };
  return {
    alias,
    portrait,
    enemy: {
      ...source,
      id,
      name: portrait.name,
      archetype: portrait.archetype,
      visualTraits: portrait.visualTraits,
      authoredAnimationSourceId: alias.animationSourceId
    }
  };
}
function validate(enemy, portrait, registry, template, profile) {
  if (!enemy) throw new Error('enemy identity was not found');
  if (!portrait) throw new Error(`canonical portrait enemy_${enemy.id} was not found`);
  for (const field of ['id', 'name', 'archetype', 'visualTraits']) if (!enemy[field]) throw new Error(`enemy has no ${field}`);
  if (portrait.region !== registry.biome) throw new Error(`${portrait.id} belongs to ${portrait.region}, not ${registry.biome}`);
  if (portrait.name !== enemy.name || portrait.archetype !== enemy.archetype) {
    throw new Error(`${portrait.id} identity metadata does not match ${enemy.id}`);
  }
  if (template.id !== 'authored-enemy-pose-atlas-v1') throw new Error(`unsupported enemy template: ${template.id}`);
  if (profile.templateId !== template.id) throw new Error(`profile ${profile.id} targets ${profile.templateId}, not ${template.id}`);
  for (const action of ['idle', 'attack', 'hit', 'death', 'dead']) {
    if (!enemy.animations?.[action]) throw new Error(`${enemy.id} has no ${action} metadata`);
    if (!profile.animations?.[action]) throw new Error(`${profile.id} has no ${action} direction`);
  }
  if (!registry.biome) throw new Error('enemy registry has no biome');
}
function buildSpec({ registry, enemy, portrait, template, profile, registryPath, portraitRegistryPath, aliasRegistryPath, aliasRegistry, templatePath, profilePath }) {
  validate(enemy, portrait, registry, template, profile);
  const biome = registry.biome;
  const root = `ai-image-metadata/characters/enemy-animation-sources/${biome}/${enemy.id}`;
  const layout = template.generator.sourceAtlasLayout;
  const invariants = template.promptContract.invariants.map(value => `No violation of this invariant: ${value}.`).join(' ');
  const base = {
    name: enemy.name, archetype: enemy.archetype, biome, biomeTraits: registry.biomeTraits || '', visualTraits: enemy.visualTraits,
    background: layout.background, invariants, poseRequirement: template.promptContract.poseRequirement,
    frameCount: 8, columns: layout.columns, rows: layout.rows
  };
  const animations = {};
  for (const action of ['idle', 'attack', 'hit', 'death', 'dead']) {
    const motion = profile.animations[action];
    if (action === 'dead') {
      animations.dead = { deriveFrom: motion.deriveFrom, frameDescriptions: motion.frameDescriptions, prompt: motion.prompt };
      continue;
    }
    const context = { ...base, actionLabel: motion.actionLabel, actionDirection: enemy.animations[action].prompt, frameSequence: motion.frameDescriptions.join('; '), motionDirection: motion.motionDirection, effectRule: motion.effectRule };
    animations[action] = {
      source: `${root}/${action}.png`, chromaSource: `${root}/chroma/${action}.png`,
      layout: { columns: layout.columns, rows: layout.rows, minimumComponentPixels: layout.minimumComponentPixels, minimumSubjectPixels: layout.minimumSubjectPixels, minimumDominantRatio: layout.minimumDominantRatio },
      anchor: 'source-cell', ...(motion.verticalAnchor ? { verticalAnchor: motion.verticalAnchor } : {}),
      minimumUniquePoses: motion.minimumUniquePoses, ...(motion.outputFrameMap ? { outputFrameMap: motion.outputFrameMap } : {}),
      frameDescriptions: motion.frameDescriptions,
      prompt: renderTemplate(profile.promptTemplates.animation, context, `${profile.id} ${action}`)
    };
  }
  const snapshot = enemySnapshot(enemy, portrait, biome, registry.biomeTraits);
  const identityOrigin = `frontend/public/assets/portraits/originals/${portrait.id}.png`;
  return {
    version: '1.0.0', template: templatePath, compilerVersion: COMPILER_VERSION,
    id: enemy.id, biome, profile: profile.id, profileSource: profilePath,
    status: 'draft-awaiting-generation', approvedAt: null, metadataFingerprint: sha256(stableJson(snapshot)),
    draftProvenance: {
      registry: registryPath,
      portraitRegistry: portraitRegistryPath,
      authoredAliasRegistry: aliasRegistryPath,
      authoredAliasRegistrySha256: sha256(stableJson(aliasRegistry)),
      templateSha256: sha256(stableJson(template)),
      profileSha256: sha256(stableJson(profile))
    },
    identity: { name: enemy.name, archetype: enemy.archetype, visualTraits: enemy.visualTraits, biomeTraits: registry.biomeTraits || '', baseFacing: 'right' },
    inputs: {
      identity: {
        origin: identityOrigin,
        staged: `${root}/inputs/identity.png`,
        authority: 'Canonical enemy identity. Preserve recognizable head and face, anatomy, coloration, markings, and any identity-defining costume or equipment.'
      },
      style: { origin: profile.style.source, staged: `${root}/inputs/style.png`, authority: profile.style.authority }
    },
    reference: {
      source: `${root}/reference.png`,
      chromaSource: `${root}/chroma/reference.png`,
      identitySource: `${root}/inputs/identity.png`,
      styleSource: `${root}/inputs/style.png`,
      prompt: renderTemplate(profile.promptTemplates.reference, base, `${profile.id} reference`)
    },
    animations, pins: { reference: null, animations: {} }
  };
}
async function renderAuthoredEnemyDraft(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../../..'));
  const id = String(options.id || '').trim().toLowerCase();
  const biome = String(options.biome || '').trim().toLowerCase();
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(biome)) throw new Error('--id and --biome are required safe path segments');
  const registryFile = resolveWithinProject(projectRoot, options.registryPath || `${DEFAULT_ENEMY_DIRECTORY}/${biome}.json`, 'registry path');
  const portraitRegistryFile = resolveWithinProject(projectRoot, options.portraitRegistryPath || DEFAULT_PORTRAIT_REGISTRY, 'portrait registry path');
  const aliasRegistryFile = resolveWithinProject(projectRoot, options.aliasRegistryPath || DEFAULT_AUTHORED_ALIASES, 'authored alias registry path');
  const templateFile = resolveWithinProject(projectRoot, options.templatePath || DEFAULT_TEMPLATE, 'template path');
  const profileFile = resolveWithinProject(projectRoot, options.profilePath || DEFAULT_PROFILE, 'profile path');
  const [registry, portraitRegistry, aliasRegistry, template, profile] = await Promise.all([
    readJson(registryFile, 'enemy registry'),
    readJson(portraitRegistryFile, 'portrait registry'),
    readJson(aliasRegistryFile, 'authored alias registry'),
    readJson(templateFile, 'enemy template'),
    readJson(profileFile, 'enemy profile')
  ]);
  if (registry.biome !== biome) throw new Error(`registry biome ${registry.biome} does not match ${biome}`);
  resolveWithinProject(projectRoot, profile.style.source, 'style source');
  const { enemy, portrait } = resolveEnemyIdentity(registry, aliasRegistry, portraitRegistry, id, biome);
  if (!enemy) throw new Error(`enemy identity ${id} was not found`);
  const identityOrigin = `frontend/public/assets/portraits/originals/enemy_${id}.png`;
  const identityFile = resolveWithinProject(projectRoot, identityOrigin, 'identity source');
  if (!fs.existsSync(identityFile)) throw new Error(`identity source does not exist: ${identityOrigin}`);
  const spec = buildSpec({
    registry,
    enemy,
    portrait,
    aliasRegistry,
    template,
    profile,
    registryPath: projectRelative(projectRoot, registryFile),
    portraitRegistryPath: projectRelative(projectRoot, portraitRegistryFile),
    aliasRegistryPath: projectRelative(projectRoot, aliasRegistryFile),
    templatePath: projectRelative(projectRoot, templateFile),
    profilePath: projectRelative(projectRoot, profileFile)
  });
  const outputPath = resolveWithinProject(projectRoot, options.outputPath || `${DEFAULT_OUTPUT_DIRECTORY}/${biome}/${id}.json`, 'output path');
  return { id, biome, outputPath, output: projectRelative(projectRoot, outputPath), spec, contents: serializeJson(spec) };
}
async function draftAuthoredEnemy(options = {}) {
  if (options.check && options.force) throw new Error('--check and --force are mutually exclusive');
  const rendered = await renderAuthoredEnemyDraft(options);
  if (options.check) {
    let actual = null; try { actual = await fs.promises.readFile(rendered.outputPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const ok = actual === rendered.contents;
    return { ok, check: true, id: rendered.id, biome: rendered.biome, output: rendered.output, issues: ok ? [] : ['draft spec is missing or differs'] };
  }
  if (!options.force && fs.existsSync(rendered.outputPath)) throw new Error(`${rendered.output} exists; use --force or --check`);
  await atomicWrite(rendered.outputPath, rendered.contents);
  return { ok: true, check: false, id: rendered.id, biome: rendered.biome, output: rendered.output, issues: [] };
}

module.exports = {
  COMPILER_VERSION,
  DEFAULT_AUTHORED_ALIASES,
  DEFAULT_OUTPUT_DIRECTORY,
  DEFAULT_PORTRAIT_REGISTRY,
  buildSpec,
  draftAuthoredEnemy,
  enemySnapshot,
  renderAuthoredEnemyDraft,
  renderTemplate,
  resolveEnemyIdentity
};
