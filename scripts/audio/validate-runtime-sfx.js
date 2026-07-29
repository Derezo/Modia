#!/usr/bin/env node
/**
 * Runtime SFX Validation Script
 *
 * Complements validate-audio.js and validate-manifest-sync.js by checking the
 * frontend call sites that select an audio category at runtime. It also checks
 * the dynamic battle skill/status resolvers against the authored skill trees.
 */

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FRONTEND_SRC = path.join(PROJECT_ROOT, 'frontend/src');

const METHOD_CATEGORIES = {
  playSFX: 'sfx',
  playCombat: 'sfx',
  playSound: 'sfx',
  playUI: 'ui',
  playInteraction: 'interactions',
  playAmbient: 'ambient'
};

function listSourceFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === '__tests__') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(?:js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else {
      walk(value, visit);
    }
  }
}

function unwrapChain(node) {
  return node?.type === 'ChainExpression' ? node.expression : node;
}

function getCalledMethod(callExpression) {
  const callee = unwrapChain(callExpression.callee);
  if (callee?.type !== 'MemberExpression' || callee.computed) return null;
  return callee.property?.type === 'Identifier' ? callee.property.name : null;
}

function getStringLiteral(node) {
  return node?.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

function getObjectStringProperty(objectExpression, propertyName) {
  if (objectExpression?.type !== 'ObjectExpression') return null;

  for (const property of objectExpression.properties) {
    if (property.type !== 'Property' || property.computed) continue;
    const key = property.key.type === 'Identifier'
      ? property.key.name
      : getStringLiteral(property.key);
    if (key === propertyName) return getStringLiteral(property.value);
  }

  return null;
}

function parseSource(filePath) {
  return espree.parse(fs.readFileSync(filePath, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    loc: true
  });
}

function auditLiteralCallSites(manifests) {
  const issues = [];
  let checked = 0;

  for (const filePath of listSourceFiles(FRONTEND_SRC)) {
    const ast = parseSource(filePath);

    walk(ast, node => {
      if (node.type !== 'CallExpression') return;
      const method = getCalledMethod(node);
      const category = METHOD_CATEGORIES[method];
      const effectId = getStringLiteral(node.arguments[0]);
      if (!category || effectId === null) return;

      checked++;
      if (!manifests[category]?.[effectId]) {
        issues.push({
          filePath,
          line: node.loc.start.line,
          message: `${method}("${effectId}") does not exist in AUDIO_MANIFEST.${category}`
        });
      }
    });
  }

  return { checked, issues };
}

function auditSfxPreloads(manifests) {
  const audioManagerPath = path.join(FRONTEND_SRC, 'audio/AudioManager.js');
  const ast = parseSource(audioManagerPath);
  const issues = [];
  let checked = 0;

  walk(ast, node => {
    if (node.type !== 'VariableDeclarator' ||
        node.id?.type !== 'Identifier' ||
        node.id.name !== 'preloadSets') {
      return;
    }

    walk(node.init, candidate => {
      if (candidate.type !== 'ObjectExpression') return;
      const category = getObjectStringProperty(candidate, 'category');
      const effectId = getObjectStringProperty(candidate, 'id');
      if (!category || !effectId || category === 'music') return;

      checked++;
      if (!manifests[category]?.[effectId]) {
        issues.push({
          filePath: audioManagerPath,
          line: candidate.loc.start.line,
          message: `preload ${category}/${effectId} does not exist in AUDIO_MANIFEST`
        });
      }
    });
  });

  return { checked, issues };
}

function getActiveSkills(trees) {
  return Object.entries(trees).flatMap(([group, tree]) =>
    tree.branches.flatMap(branch =>
      branch.skills
        .filter(skill => skill.type === 'active')
        .map(skill => ({ ...skill, group }))
    )
  );
}

async function auditDynamicBattleSounds(sfxManifest) {
  const { SKILL_TREES } = await import(
    path.join(PROJECT_ROOT, 'api/src/config/skillTrees.js')
  );
  const { MONSTER_SKILL_TREES } = await import(
    path.join(PROJECT_ROOT, 'api/src/config/monsterSkillTrees.js')
  );
  const {
    GENERIC_SKILL_SFX,
    resolveSkillSfx,
    resolveStatusSfx
  } = await import(
    path.join(PROJECT_ROOT, 'frontend/src/audio/audioEffectResolver.js')
  );

  const issues = [];
  let checked = 0;
  const playerSkills = getActiveSkills(SKILL_TREES);
  const monsterSkills = getActiveSkills(MONSTER_SKILL_TREES);

  for (const [skills, isMonster] of [
    [playerSkills, false],
    [monsterSkills, true]
  ]) {
    for (const skill of skills) {
      checked++;
      const candidate = resolveSkillSfx(skill.id, isMonster);
      if (!candidate || candidate === GENERIC_SKILL_SFX || !sfxManifest[candidate]) {
        issues.push({
          message: `${isMonster ? 'monster' : 'player'} skill ${skill.group}/${skill.id} ` +
            `does not resolve to a dedicated registered SFX (candidate: ${candidate || 'none'})`
        });
      }
    }
  }

  const statusIds = new Set(
    [...playerSkills, ...monsterSkills]
      .flatMap(skill => [skill.effect, skill.selfBuff])
      .filter(Boolean)
  );

  for (const statusId of [...statusIds].sort()) {
    checked++;
    const candidate = resolveStatusSfx(statusId);
    if (!candidate || candidate === GENERIC_SKILL_SFX || !sfxManifest[candidate]) {
      issues.push({
        message: `status ${statusId} does not resolve to a dedicated registered SFX ` +
          `(candidate: ${candidate || 'none'})`
      });
    }
  }

  return { checked, issues };
}

function printIssues(issues) {
  for (const issue of issues) {
    const location = issue.filePath
      ? `${path.relative(PROJECT_ROOT, issue.filePath)}:${issue.line}`
      : 'dynamic battle audit';
    console.error(`  - ${location}: ${issue.message}`);
  }
}

async function main() {
  const [
    { SFX_MANIFEST },
    { UI_MANIFEST },
    { AMBIENT_MANIFEST },
    { INTERACTION_MANIFEST }
  ] = await Promise.all([
    import(path.join(PROJECT_ROOT, 'frontend/src/audio/manifests/sfxManifest.js')),
    import(path.join(PROJECT_ROOT, 'frontend/src/audio/manifests/uiManifest.js')),
    import(path.join(PROJECT_ROOT, 'frontend/src/audio/manifests/ambientManifest.js')),
    import(path.join(PROJECT_ROOT, 'frontend/src/audio/manifests/interactionManifest.js'))
  ]);

  const manifests = {
    sfx: SFX_MANIFEST,
    ui: UI_MANIFEST,
    ambient: AMBIENT_MANIFEST,
    interactions: INTERACTION_MANIFEST
  };

  const literalAudit = auditLiteralCallSites(manifests);
  const preloadAudit = auditSfxPreloads(manifests);
  const dynamicAudit = await auditDynamicBattleSounds(SFX_MANIFEST);
  const issues = [
    ...literalAudit.issues,
    ...preloadAudit.issues,
    ...dynamicAudit.issues
  ];
  const checked = literalAudit.checked + preloadAudit.checked + dynamicAudit.checked;

  console.log('Runtime SFX Validation');
  console.log('======================');
  console.log(`Checked ${checked} literal calls, preloads, skills, and statuses.`);

  if (issues.length > 0) {
    console.error(`Found ${issues.length} runtime SFX issue(s):`);
    printIssues(issues);
    process.exitCode = 1;
    return;
  }

  console.log('All runtime SFX references resolve to registered effects.');
}

main().catch(error => {
  console.error(`Runtime SFX validation failed: ${error.message}`);
  process.exitCode = 1;
});
