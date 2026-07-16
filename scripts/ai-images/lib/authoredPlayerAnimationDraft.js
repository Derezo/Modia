'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  COMPILER_VERSION,
  metadataFingerprint,
  sha256,
  stableJson
} = require('./authoredPlayerAnimationCompiler');

const DEFAULT_REGISTRY = 'ai-image-metadata/characters/player-variants.json';
const DEFAULT_TEMPLATE = 'ai-image-metadata/characters/player-authored-animation-template.json';
const DEFAULT_PROFILE_DIRECTORY = 'ai-image-metadata/characters/player-animation-profiles';
const DEFAULT_OUTPUT_DIRECTORY = 'ai-image-metadata/characters/player-authored-animations';
const DRAFT_VERSION = '1.0.0';
const ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function projectRelative(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function resolveWithinProject(projectRoot, candidate, label) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error(`${label} must be a non-empty path`);
  }
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the project root: ${candidate}`);
  }
  return resolved;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} does not exist: ${filePath}`);
    if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON: ${error.message}`);
    throw error;
  }
}

async function atomicWrite(filePath, contents) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`
  );
  try {
    await fs.promises.writeFile(temporary, contents, { flag: 'wx' });
    await fs.promises.rename(temporary, filePath);
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
}

function titleCase(value) {
  return String(value)
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function genderPresentation(gender) {
  if (gender === 'other') return 'non-binary';
  return gender;
}

function publicAssetProjectPath(assetPath, label) {
  if (typeof assetPath !== 'string' || !assetPath) throw new Error(`${label} is missing`);
  let projectPath = assetPath;
  if (assetPath.startsWith('/assets/')) projectPath = `frontend/public${assetPath}`;
  else if (assetPath.startsWith('assets/')) projectPath = `frontend/public/${assetPath}`;
  else if (path.isAbsolute(assetPath)) throw new Error(`${label} must point into /assets or be project-relative`);
  const normalized = path.posix.normalize(projectPath.split(path.sep).join('/'));
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} escapes the project root: ${assetPath}`);
  }
  return normalized;
}

function lookupToken(context, token, label) {
  const value = token.split('.').reduce((current, key) => current?.[key], context);
  if (value === undefined || value === null || value === '') {
    throw new Error(`${label} references missing template token {{${token}}}`);
  }
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') throw new Error(`${label} token {{${token}}} is not scalar`);
  return String(value);
}

function renderTemplate(template, context, label) {
  if (typeof template !== 'string' || !template.trim()) throw new Error(`${label} must be a non-empty string`);
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, token) => (
    lookupToken(context, token, label)
  ));
  if (/\{\{[^}]+\}\}/.test(rendered)) throw new Error(`${label} contains an invalid template token`);
  return rendered.replace(/\s+/g, ' ').trim();
}

function validateVariant(variant, id) {
  if (!variant) throw new Error(`unknown player variant: ${id}`);
  for (const field of ['id', 'race', 'gender', 'class', 'visualTraits', 'portraitReference']) {
    if (typeof variant[field] !== 'string' || !variant[field].trim()) {
      throw new Error(`player variant ${id} has no ${field}`);
    }
  }
  if (!Array.isArray(variant.animations) || variant.animations.length === 0) {
    throw new Error(`player variant ${id} has no animation list`);
  }
  if (new Set(variant.animations).size !== variant.animations.length) {
    throw new Error(`player variant ${id} contains duplicate animations`);
  }
}

function validateTemplate(template) {
  if (template?.id !== 'authored-pose-atlas-v1') {
    throw new Error(`unsupported authored animation template: ${String(template?.id || 'missing')}`);
  }
  const layout = template.generator?.sourceAtlasLayout;
  const frameCount = template.runtimeContract?.animation?.frameCount;
  if (!Number.isInteger(layout?.columns) || !Number.isInteger(layout?.rows)) {
    throw new Error('authored template has no valid source atlas layout');
  }
  if (layout.columns * layout.rows !== frameCount || frameCount !== 8) {
    throw new Error('authored template must define an eight-frame source atlas and runtime strip');
  }
  if (!template.generator?.sourceAtlasLayout?.background) {
    throw new Error('authored template has no chroma-key background');
  }
  if (!Array.isArray(template.promptContract?.invariants) || template.promptContract.invariants.length === 0) {
    throw new Error('authored template has no prompt invariants');
  }
  if (typeof template.promptContract?.poseRequirement !== 'string') {
    throw new Error('authored template has no pose requirement');
  }
}

function validateProfile(profile, variant, template) {
  if (typeof profile?.id !== 'string' || !profile.id) throw new Error('animation profile has no id');
  if (profile.class !== variant.class) {
    throw new Error(`profile ${profile.id} targets ${String(profile.class)}, not ${variant.class}`);
  }
  if (profile.templateId !== template.id) {
    throw new Error(`profile ${profile.id} targets template ${String(profile.templateId)}, not ${template.id}`);
  }
  if (!profile.style?.source) throw new Error(`profile ${profile.id} has no style source`);
  for (const field of ['baseFacing', 'motionStyle', 'equipmentRule', 'magicRule']) {
    if (typeof profile.identity?.[field] !== 'string' || !profile.identity[field]) {
      throw new Error(`profile ${profile.id} has no identity ${field}`);
    }
  }
  for (const field of ['reference', 'animation']) {
    if (typeof profile.promptTemplates?.[field] !== 'string' || !profile.promptTemplates[field]) {
      throw new Error(`profile ${profile.id} has no ${field} prompt template`);
    }
  }
  for (const animation of variant.animations) {
    const motion = profile.animations?.[animation];
    if (!motion) throw new Error(`profile ${profile.id} does not define ${animation}`);
    if (!Array.isArray(motion.frameDescriptions) || motion.frameDescriptions.length !== 8) {
      throw new Error(`profile ${profile.id} ${animation} must define exactly eight frame descriptions`);
    }
    if (animation !== 'dead') {
      if (!motion.actionLabel || !motion.motionDirection || !motion.effectRule) {
        throw new Error(`profile ${profile.id} ${animation} has incomplete prompt direction`);
      }
      if (!Number.isInteger(motion.minimumUniquePoses) || motion.minimumUniquePoses < 1 || motion.minimumUniquePoses > 8) {
        throw new Error(`profile ${profile.id} ${animation} has invalid minimumUniquePoses`);
      }
      const anchor = motion.anchor || 'source-cell';
      if (!['source-cell', 'bottom-center', 'center'].includes(anchor)) {
        throw new Error(`profile ${profile.id} ${animation} has invalid anchor`);
      }
      if (motion.verticalAnchor !== undefined &&
          (anchor !== 'source-cell' || !['source-cell', 'bottom'].includes(motion.verticalAnchor))) {
        throw new Error(`profile ${profile.id} ${animation} has invalid verticalAnchor`);
      }
    }
  }
}

function animationPaths(id, animation) {
  const root = `ai-image-metadata/characters/player-animation-sources/${id}`;
  return {
    source: `${root}/${animation}.png`,
    chromaSource: `${root}/chroma/${animation}.png`
  };
}

function buildContext(variant, profile, template) {
  const layout = template.generator.sourceAtlasLayout;
  const invariantText = template.promptContract.invariants
    .map(invariant => `No violation of this invariant: ${invariant}.`)
    .join(' ');
  return {
    displayName: `${titleCase(variant.race)} ${titleCase(variant.class)} (${genderPresentation(variant.gender)} presentation)`,
    visualTraits: variant.visualTraits.trim(),
    background: layout.background,
    baseFacing: profile.identity.baseFacing,
    motionStyle: profile.identity.motionStyle,
    equipmentRule: profile.identity.equipmentRule,
    magicRule: profile.identity.magicRule,
    invariants: invariantText,
    poseRequirement: template.promptContract.poseRequirement,
    frameCount: template.runtimeContract.animation.frameCount,
    columns: layout.columns,
    rows: layout.rows
  };
}

function buildAnimationSpec(id, animation, motion, profile, template, context) {
  if (animation === 'dead') {
    return {
      deriveFrom: motion.deriveFrom,
      frameDescriptions: [...motion.frameDescriptions],
      prompt: motion.prompt
    };
  }
  const paths = animationPaths(id, animation);
  const animationContext = {
    ...context,
    actionLabel: motion.actionLabel,
    frameSequence: motion.frameDescriptions.join('; '),
    motionDirection: motion.motionDirection,
    effectRule: motion.effectRule
  };
  const rendered = {
    ...paths,
    layout: {
      columns: template.generator.sourceAtlasLayout.columns,
      rows: template.generator.sourceAtlasLayout.rows,
      minimumComponentPixels: template.generator.sourceAtlasLayout.minimumComponentPixels,
      minimumSubjectPixels: template.generator.sourceAtlasLayout.minimumSubjectPixels,
      minimumDominantRatio: template.generator.sourceAtlasLayout.minimumDominantRatio
    },
    anchor: motion.anchor || 'source-cell',
    minimumUniquePoses: motion.minimumUniquePoses
  };
  if (motion.verticalAnchor) rendered.verticalAnchor = motion.verticalAnchor;
  if (motion.outputFrameMap) rendered.outputFrameMap = [...motion.outputFrameMap];
  rendered.frameDescriptions = [...motion.frameDescriptions];
  rendered.prompt = renderTemplate(
    profile.promptTemplates.animation,
    animationContext,
    `${profile.id} ${animation} prompt`
  );
  return rendered;
}

function buildDraftSpec({
  variant,
  profile,
  template,
  registryPath,
  templatePath,
  profilePath,
  templateSha256,
  profileSha256
}) {
  validateVariant(variant, variant?.id || 'unknown');
  validateTemplate(template);
  validateProfile(profile, variant, template);

  const id = variant.id;
  const root = `ai-image-metadata/characters/player-animation-sources/${id}`;
  const identityOrigin = publicAssetProjectPath(variant.portraitReference, 'portraitReference');
  const identityStaged = `${root}/inputs/identity.png`;
  const styleStaged = `${root}/inputs/style.png`;
  const context = buildContext(variant, profile, template);
  const animations = {};
  for (const animation of variant.animations) {
    animations[animation] = buildAnimationSpec(
      id,
      animation,
      profile.animations[animation],
      profile,
      template,
      context
    );
  }

  return {
    version: DRAFT_VERSION,
    template: templatePath,
    compilerVersion: COMPILER_VERSION,
    id,
    profile: profile.id,
    profileSource: profilePath,
    status: 'draft-awaiting-generation',
    approvedAt: null,
    metadataFingerprint: metadataFingerprint(variant),
    draftProvenance: {
      registry: registryPath || DEFAULT_REGISTRY,
      templateSha256: templateSha256 || sha256(stableJson(template)),
      profileSha256: profileSha256 || sha256(stableJson(profile))
    },
    identity: {
      race: variant.race,
      gender: variant.gender,
      class: variant.class,
      presentation: `${genderPresentation(variant.gender)} ${variant.race} ${variant.class}`,
      visualTraits: variant.visualTraits.trim(),
      baseFacing: profile.identity.baseFacing,
      sourceMetadata: {
        isAdvanced: Boolean(variant.isAdvanced),
        inheritsFrom: variant.inheritsFrom || null,
        seed: variant.seed ?? null
      }
    },
    inputs: {
      identity: {
        origin: identityOrigin,
        staged: identityStaged,
        authority: 'face, ancestry, gender presentation, hair, eyes, complexion, costume, palette, proportions, and equipment'
      },
      style: {
        origin: profile.style.source,
        staged: styleStaged,
        authority: profile.style.authority
      }
    },
    reference: {
      source: `${root}/reference.png`,
      chromaSource: `${root}/chroma/reference.png`,
      identitySource: identityStaged,
      styleSource: styleStaged,
      prompt: renderTemplate(profile.promptTemplates.reference, context, `${profile.id} reference prompt`)
    },
    animations,
    pins: {
      reference: null,
      animations: {}
    }
  };
}

function profileLocator(options, variant) {
  const requested = options.profilePath || options.profile || `${variant.class}_v1`;
  if (requested.includes('/') || requested.includes('\\') || requested.endsWith('.json')) return requested;
  return `${DEFAULT_PROFILE_DIRECTORY}/${requested}.json`;
}

async function renderAuthoredDraft(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '../../..'));
  const id = String(options.id || '').trim().toLowerCase();
  if (!id) throw new Error('--id is required; bulk drafting is intentionally unsupported');
  if (!ID_PATTERN.test(id)) throw new Error(`invalid player variant id: ${id}`);

  const registryPath = resolveWithinProject(
    projectRoot,
    options.registryPath || DEFAULT_REGISTRY,
    'registry path'
  );
  const registry = await readJson(registryPath, 'player variant registry');
  const variant = (registry.variants || []).find(entry => entry.id === id);
  validateVariant(variant, id);

  const templateFile = resolveWithinProject(
    projectRoot,
    options.templatePath || DEFAULT_TEMPLATE,
    'template path'
  );
  const profileFile = resolveWithinProject(projectRoot, profileLocator(options, variant), 'profile path');
  const [template, profile] = await Promise.all([
    readJson(templateFile, 'authored animation template'),
    readJson(profileFile, 'player animation profile')
  ]);
  resolveWithinProject(projectRoot, profile.style?.source, 'profile style source');
  const templatePath = projectRelative(projectRoot, templateFile);
  const profilePath = projectRelative(projectRoot, profileFile);
  const spec = buildDraftSpec({
    variant,
    profile,
    template,
    registryPath: projectRelative(projectRoot, registryPath),
    templatePath,
    profilePath,
    templateSha256: sha256(stableJson(template)),
    profileSha256: sha256(stableJson(profile))
  });
  const outputPath = resolveWithinProject(
    projectRoot,
    options.outputPath || `${DEFAULT_OUTPUT_DIRECTORY}/${id}.json`,
    'output path'
  );
  if (path.extname(outputPath).toLowerCase() !== '.json') {
    throw new Error('output path must end in .json');
  }
  return {
    id,
    projectRoot,
    outputPath,
    outputRelative: projectRelative(projectRoot, outputPath),
    spec,
    contents: serializeJson(spec)
  };
}

async function draftAuthoredVariant(options = {}) {
  if (options.check && options.force) throw new Error('--check and --force are mutually exclusive');
  const rendered = await renderAuthoredDraft(options);

  if (options.check) {
    let actual;
    try {
      actual = await fs.promises.readFile(rendered.outputPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          ok: false,
          check: true,
          id: rendered.id,
          output: rendered.outputRelative,
          issues: ['draft spec is missing'],
          generatedImages: false
        };
      }
      throw error;
    }
    const matches = actual === rendered.contents;
    return {
      ok: matches,
      check: true,
      id: rendered.id,
      output: rendered.outputRelative,
      issues: matches ? [] : ['draft spec differs from current metadata, profile, or template'],
      generatedImages: false
    };
  }

  if (!options.force && fs.existsSync(rendered.outputPath)) {
    throw new Error(`${rendered.outputRelative} exists; use --force or --check`);
  }
  await atomicWrite(rendered.outputPath, rendered.contents);
  return {
    ok: true,
    check: false,
    id: rendered.id,
    output: rendered.outputRelative,
    issues: [],
    generatedImages: false
  };
}

module.exports = {
  DEFAULT_OUTPUT_DIRECTORY,
  DEFAULT_PROFILE_DIRECTORY,
  DEFAULT_REGISTRY,
  DEFAULT_TEMPLATE,
  DRAFT_VERSION,
  buildDraftSpec,
  draftAuthoredVariant,
  genderPresentation,
  publicAssetProjectPath,
  renderAuthoredDraft,
  renderTemplate,
  resolveWithinProject,
  serializeJson,
  titleCase
};
