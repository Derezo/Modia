#!/usr/bin/env node
/**
 * Compile the canonical visual registry for every active battle ability.
 *
 * Sources:
 *   - Player guild skill trees
 *   - Monster archetype skill trees
 *   - Zodiac signature abilities
 *
 * Usage:
 *   node scripts/ai-images/sync-ability-visuals.js
 *   node scripts/ai-images/sync-ability-visuals.js --check
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata/abilities');
const REGISTRY_PATH = path.join(OUTPUT_DIR, 'abilities.json');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const STATUS_METADATA_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/icons/status.json');

const ABILITY_ICON_COMPILER = Object.freeze({
  script: 'scripts/ai-images/compile-ability-icons.js',
  version: '1.0.0',
  mode: 'offline_deterministic_composition',
  renderer: 'sharp',
  format: 'lossless WebP',
  width: 128,
  height: 128,
  alpha: true,
  sourceFamilies: ['actions', 'augments', 'status']
});

const SOURCE_PATHS = Object.freeze({
  player: 'api/src/config/skillTrees.js',
  monster: 'api/src/config/monsterSkillTrees.js',
  zodiac: 'shared/constants.js'
});

const SOURCE_ORDER = Object.freeze({ player: 0, monster: 1, zodiac: 2 });
const OWNER_TYPES = Object.freeze({ player: 'guild', monster: 'archetype', zodiac: 'zodiac_sign' });
const CAST_CAPABLE_GUILDS = new Set(['wizard', 'sorcerer']);

const ELEMENT_ALIASES = Object.freeze({
  air: 'wind',
  darkness: 'dark',
  electric: 'lightning',
  flame: 'fire',
  frost: 'ice',
  light: 'holy',
  nature: 'poison',
  shadow: 'dark',
  thunder: 'lightning',
  void: 'dark'
});

const VALID_ELEMENTS = Object.freeze([
  'neutral', 'physical', 'fire', 'ice', 'lightning', 'earth', 'wind',
  'water', 'holy', 'dark', 'poison'
]);

const VISUAL_CATEGORY_ALIASES = Object.freeze({
  air: 'wind',
  darkness: 'dark',
  light: 'holy',
  nature: 'poison',
  selfaura: 'selfAura'
});

const VALID_VISUAL_CATEGORIES = Object.freeze([
  'physical', 'fire', 'ice', 'lightning', 'earth', 'wind', 'water',
  'holy', 'dark', 'shadow', 'poison', 'healing', 'buff', 'debuff', 'selfAura'
]);

const ELEMENT_TO_VISUAL_CATEGORY = Object.freeze({
  physical: 'physical',
  fire: 'fire',
  ice: 'ice',
  lightning: 'lightning',
  earth: 'earth',
  wind: 'wind',
  water: 'water',
  holy: 'holy',
  dark: 'dark',
  poison: 'poison'
});

const EFFECT_TO_VISUAL_CATEGORY = Object.freeze({
  bleed: 'physical',
  blind: 'debuff',
  burn: 'fire',
  corrode: 'poison',
  curse: 'debuff',
  doom: 'dark',
  fear: 'debuff',
  freeze: 'ice',
  haste: 'buff',
  marked: 'debuff',
  poison: 'poison',
  root: 'earth',
  silence: 'debuff',
  slow: 'ice',
  stun: 'lightning',
  taunt: 'debuff',
  transmuted: 'debuff',
  weaken: 'debuff'
});

// Mechanical statuses intentionally share a smaller overlay vocabulary where
// their battle readability is equivalent.
const EFFECT_TO_STATUS_OVERLAY = Object.freeze({
  bleed: 'bleed',
  blind: 'blind',
  burn: 'burn',
  corrode: 'defense_down',
  curse: 'strength_down',
  doom: 'doom',
  fear: 'confusion',
  freeze: 'freeze',
  haste: 'haste',
  marked: 'doom',
  poison: 'poison',
  root: 'slow',
  silence: 'silence',
  slow: 'slow',
  stun: 'stun',
  taunt: 'taunt',
  transmuted: 'confusion',
  weaken: 'strength_down'
});

const SELF_BUFF_TO_STATUS_OVERLAY = Object.freeze({
  amplify: 'strength_up',
  berserker: 'berserk',
  elem_shield: 'protect',
  final_stand: 'protect',
  fortify: 'defense_up',
  frenzy: 'strength_up',
  invisible: 'invisible',
  mana_shield: 'shell',
  martyr: 'strength_up',
  pack_bonus: 'strength_up',
  rage: 'strength_up',
  reckless: 'berserk',
  shadow_arts: 'strength_up'
});

const ZODIAC_PRESENTATION_OVERRIDES = Object.freeze({
  rams_charge: { visualCategory: 'fire', impactArchetype: 'melee_strike' },
  unmovable: { visualCategory: 'earth', impactArchetype: 'aura_pulse', statusOverlay: 'protect' },
  twin_strike: { visualCategory: 'wind', impactArchetype: 'melee_strike' },
  moonshield: { visualCategory: 'water', impactArchetype: 'aura_pulse', statusOverlay: 'protect' },
  roar: { visualCategory: 'fire', impactArchetype: 'area_burst', statusOverlay: 'slow' },
  purify: { visualCategory: 'earth', impactArchetype: 'aura_pulse', statusOverlay: 'cleanse' },
  balance: { visualCategory: 'wind', impactArchetype: 'healing_bloom', statusOverlay: 'regen' },
  venom_sting: { visualCategory: 'poison', impactArchetype: 'melee_strike', statusOverlay: 'poison' },
  celestial_arrow: {
    visualCategory: 'fire',
    projectileArchetype: 'physical_missile',
    impactArchetype: 'projectile_hit'
  },
  mountains_endurance: {
    visualCategory: 'earth',
    impactArchetype: 'aura_pulse',
    statusOverlay: 'defense_up'
  },
  cascade: { visualCategory: 'water', impactArchetype: 'healing_bloom', statusOverlay: 'regen' },
  dreamwave: {
    visualCategory: 'water',
    projectileArchetype: 'support_orb',
    impactArchetype: 'status_sigil',
    statusOverlay: 'sleep'
  }
});

const PROJECTILE_ARCHETYPES = Object.freeze({
  none: 'No travelling visual; resolve at the actor or target.',
  physical_missile: 'Reusable arrow, shard, thorn, or other physical missile flight.',
  thrown_object: 'Reusable arcing flask, potion, bomb, rock, or carried-object throw.',
  elemental_orb: 'Reusable elemental orb or shard driven by the normalized visual category.',
  energy_bolt: 'Fast linear lightning or arcane energy discharge.',
  support_orb: 'Soft travelling heal, buff, debuff, or control mote.',
  cone_wave: 'Short expanding breath, spray, or wave emitted from the actor.'
});

const IMPACT_ARCHETYPES = Object.freeze({
  melee_strike: 'Close-range weapon, claw, bite, or body-strike contact.',
  projectile_hit: 'Compact impact used when a physical or thrown projectile lands.',
  elemental_burst: 'Single-target elemental detonation using the visual-category palette.',
  area_burst: 'Radial or multi-target burst centered on a tile or actor.',
  status_cloud: 'Lingering cloud, spores, smoke, venom, or corrosive haze.',
  status_sigil: 'Non-damaging control or debuff glyph at the target.',
  healing_bloom: 'Healing light, restorative particles, or life-energy bloom.',
  aura_pulse: 'Self/party buff, shield, cleanse, or stance pulse.'
});

const POSITIVE_STATUS_OVERLAYS = new Set([
  'berserk', 'cleanse', 'defense_up', 'haste', 'invisible', 'protect', 'regen',
  'shell', 'strength_up'
]);

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeElement(value) {
  const token = normalizeToken(value);
  if (!token) return null;
  const normalized = ELEMENT_ALIASES[token] || token;
  return VALID_ELEMENTS.includes(normalized) ? normalized : 'neutral';
}

function normalizeVisualCategory(value) {
  const token = normalizeToken(value);
  if (!token) return null;
  const normalized = VISUAL_CATEGORY_ALIASES[token] || token;
  return VALID_VISUAL_CATEGORIES.find(category => category.toLowerCase() === normalized.toLowerCase()) || null;
}

function inferVisualCategory(skill) {
  const explicit = normalizeVisualCategory(skill.visualCategory);
  if (explicit) return explicit;

  const element = normalizeElement(skill.element);
  if (element && ELEMENT_TO_VISUAL_CATEGORY[element]) {
    return ELEMENT_TO_VISUAL_CATEGORY[element];
  }

  const effect = normalizeToken(skill.effect?.type || skill.effect);
  if (EFFECT_TO_VISUAL_CATEGORY[effect]) {
    return EFFECT_TO_VISUAL_CATEGORY[effect];
  }

  if (skill.healing || skill.healPercent || skill.targetAlly || skill.targetAllAllies) {
    return 'healing';
  }

  if (skill.selfBuff || skill.targetSelf || skill.cleanse) {
    return 'selfAura';
  }

  return normalizeToken(skill.damageType) === 'magical' ? 'holy' : 'physical';
}

function inferElement(skill, visualCategory) {
  const explicit = normalizeElement(skill.element);
  if (explicit) return explicit;
  if (normalizeToken(skill.damageType) === 'physical' || visualCategory === 'physical') {
    return 'physical';
  }
  return 'neutral';
}

function isSelfTargeting(skill) {
  return Boolean(
    skill.targetSelf ||
    skill.selfBuff ||
    skill.cleanse ||
    skill.targetAllAllies ||
    (skill.healPercent && !skill.targetAlly && Number(skill.range || 0) === 0)
  );
}

function resolveActorAnimation(definition, visualCategory) {
  const explicit = normalizeToken(definition.skill.actorAnimation);
  if (explicit === 'attack' || explicit === 'cast') return explicit;

  if (
    definition.source === 'player' &&
    CAST_CAPABLE_GUILDS.has(definition.owner) &&
    visualCategory !== 'physical'
  ) {
    return 'cast';
  }

  // Monsters expose attack strips only, and zodiac abilities can be used by
  // any class, so attack is the universally available fallback.
  return 'attack';
}

function inferProjectileArchetype(definition, visualCategory) {
  const override = ZODIAC_PRESENTATION_OVERRIDES[definition.id]?.projectileArchetype;
  if (override) return override;

  const skill = definition.skill;
  const words = `${definition.id} ${skill.name || ''}`.toLowerCase();
  const range = Number(skill.range || 0);

  if (isSelfTargeting(skill) || skill.targetAllAllies || range === 0) return 'none';
  if (skill.aoePattern === 'cone' || /\b(breath|spray|wave)\b/.test(words)) return 'cone_wave';
  if (/\b(arrow|shot|volley|shuriken|kunai|thorn)\b/.test(words)) return 'physical_missile';
  if (/\b(bomb|boulder|flask|potion|rock|throw|vial|tag|nuke)\b/.test(words)) return 'thrown_object';
  if (range <= 1) return 'none';
  if (visualCategory === 'physical') return 'physical_missile';
  if (visualCategory === 'lightning') return 'energy_bolt';
  if (['healing', 'buff', 'debuff', 'selfAura'].includes(visualCategory)) return 'support_orb';
  return 'elemental_orb';
}

function inferImpactArchetype(definition, visualCategory, projectileArchetype) {
  const override = ZODIAC_PRESENTATION_OVERRIDES[definition.id]?.impactArchetype;
  if (override) return override;

  const skill = definition.skill;
  const words = `${definition.id} ${skill.name || ''}`.toLowerCase();
  const power = Number(skill.power || 0);

  if (visualCategory === 'healing') return 'healing_bloom';
  if (['buff', 'selfAura'].includes(visualCategory) || isSelfTargeting(skill)) return 'aura_pulse';
  if (/\b(cloud|fog|rain|smoke|spore|toxic)\b/.test(words)) return 'status_cloud';
  if (skill.effect && power === 0) return 'status_sigil';
  if (skill.aoeRadius > 0 || skill.targetAllAllies || skill.chainTargets > 1) return 'area_burst';
  if (visualCategory === 'physical') {
    return projectileArchetype === 'none' ? 'melee_strike' : 'projectile_hit';
  }
  if (projectileArchetype === 'thrown_object') return 'projectile_hit';
  if (['debuff'].includes(visualCategory) && power === 0) return 'status_sigil';
  return 'elemental_burst';
}

function inferStatusOverlay(definition) {
  const override = ZODIAC_PRESENTATION_OVERRIDES[definition.id];
  if (override && Object.hasOwn(override, 'statusOverlay')) return override.statusOverlay;

  const skill = definition.skill;
  const effect = normalizeToken(skill.effect?.type || skill.effect);
  if (EFFECT_TO_STATUS_OVERLAY[effect]) return EFFECT_TO_STATUS_OVERLAY[effect];

  const selfBuff = normalizeToken(skill.selfBuff);
  if (SELF_BUFF_TO_STATUS_OVERLAY[selfBuff]) return SELF_BUFF_TO_STATUS_OVERLAY[selfBuff];
  if (skill.cleanse) return 'cleanse';
  if (/\b(regenerate|photosynthesis)\b/.test(`${definition.id} ${skill.name || ''}`.toLowerCase())) {
    return 'regen';
  }

  return null;
}

function flattenSkillTrees(trees, source) {
  const definitions = [];
  for (const [owner, tree] of Object.entries(trees || {})) {
    for (const branch of tree.branches || []) {
      for (const skill of branch.skills || []) {
        definitions.push({
          id: skill.id,
          source,
          sourceFile: SOURCE_PATHS[source],
          owner,
          ownerType: OWNER_TYPES[source],
          branch: branch.name || 'Uncategorized',
          type: skill.type || 'active',
          skill
        });
      }
    }
  }
  return definitions;
}

function flattenZodiacAbilities(zodiacDefinitions) {
  return Object.entries(zodiacDefinitions || {}).map(([sign, info]) => ({
    id: info.signatureAbility,
    source: 'zodiac',
    sourceFile: SOURCE_PATHS.zodiac,
    owner: sign,
    ownerType: OWNER_TYPES.zodiac,
    branch: 'Signature',
    type: 'active',
    skill: {
      ...info,
      id: info.signatureAbility,
      type: 'active'
    }
  }));
}

function collectAbilityDefinitions({ playerSkillTrees, monsterSkillTrees, zodiacAbilities }) {
  const allDefinitions = [
    ...flattenSkillTrees(playerSkillTrees, 'player'),
    ...flattenSkillTrees(monsterSkillTrees, 'monster'),
    ...flattenZodiacAbilities(zodiacAbilities)
  ];
  const activeDefinitions = allDefinitions.filter(definition => definition.type === 'active');

  const sourceSummary = Object.fromEntries(
    Object.keys(SOURCE_ORDER).map(source => {
      const sourceDefinitions = allDefinitions.filter(definition => definition.source === source);
      const activeCount = sourceDefinitions.filter(definition => definition.type === 'active').length;
      return [source, {
        totalDefinitions: sourceDefinitions.length,
        activeAbilities: activeCount,
        excludedNonActive: sourceDefinitions.length - activeCount
      }];
    })
  );

  return { allDefinitions, activeDefinitions, sourceSummary };
}

function sortDefinitions(definitions) {
  return [...definitions].sort((left, right) =>
    SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source] ||
    left.owner.localeCompare(right.owner) ||
    left.branch.localeCompare(right.branch) ||
    left.id.localeCompare(right.id)
  );
}

function findDuplicateIds(definitions) {
  const occurrences = new Map();
  for (const definition of definitions) {
    if (!definition.id) continue;
    const current = occurrences.get(definition.id) || [];
    current.push({
      source: definition.source,
      owner: definition.owner,
      branch: definition.branch,
      type: definition.type
    });
    occurrences.set(definition.id, current);
  }

  return [...occurrences.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({ id, occurrences: entries }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compareRegistryIds(existingAbilities, expectedDefinitions) {
  const existingIds = new Set((existingAbilities || []).map(ability => ability.id));
  const expectedIds = new Set((expectedDefinitions || []).map(definition => definition.id));
  return {
    staleIds: [...existingIds].filter(id => !expectedIds.has(id)).sort(),
    missingIds: [...expectedIds].filter(id => !existingIds.has(id)).sort()
  };
}

function resolveStatusOverlayAssetPath(statusOverlay, knownStatusIcons = new Set()) {
  if (!statusOverlay) return null;
  return knownStatusIcons.has(statusOverlay)
    ? `/assets/icons/originals/status/${statusOverlay}.webp`
    : `/assets/abilities/status/${statusOverlay}.webp`;
}

function buildAbilityRegistry(definitions, options = {}) {
  const {
    existingAbilities = [],
    knownStatusIcons = new Set(),
    assetExists = () => false
  } = options;
  const existingById = new Map(existingAbilities.map(ability => [ability.id, ability]));

  return sortDefinitions(definitions).map(definition => {
    const skill = definition.skill;
    const previous = existingById.get(definition.id) || {};
    const zodiacOverride = ZODIAC_PRESENTATION_OVERRIDES[definition.id] || {};
    const visualCategory = zodiacOverride.visualCategory || inferVisualCategory(skill);
    const element = inferElement(skill, visualCategory);
    const projectileArchetype = inferProjectileArchetype(definition, visualCategory);
    const impactArchetype = inferImpactArchetype(definition, visualCategory, projectileArchetype);
    const statusOverlay = inferStatusOverlay(definition);
    const iconAssetPath = `/assets/abilities/icons/${definition.source}/${definition.id}.webp`;
    const iconGenerated = assetExists(iconAssetPath);
    const needsRegeneration = iconGenerated && previous.needsRegeneration === true;

    return {
      id: definition.id,
      name: skill.name || definition.id,
      description: skill.description || '',
      type: 'active',
      source: definition.source,
      sourceFile: definition.sourceFile,
      owner: definition.owner,
      ownerType: definition.ownerType,
      branch: definition.branch,
      element,
      visualCategory,
      iconAssetPath,
      actorAnimation: resolveActorAnimation(definition, visualCategory),
      projectileArchetype,
      impactArchetype,
      statusOverlay,
      statusOverlayAssetPath: resolveStatusOverlayAssetPath(statusOverlay, knownStatusIcons),
      generated: iconGenerated,
      status: needsRegeneration ? 'needs_regeneration' : (iconGenerated ? 'generated' : 'missing'),
      needsRegeneration,
      generatedAt: iconGenerated ? (previous.generatedAt || null) : null
    };
  });
}

function countBy(records, key) {
  const counts = {};
  for (const record of records) {
    const value = record[key] ?? 'none';
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function buildStatusOverlayManifest(abilities, knownStatusIcons, assetExists) {
  const overlayIds = [...new Set(abilities.map(ability => ability.statusOverlay).filter(Boolean))].sort();
  return Object.fromEntries(overlayIds.map(id => {
    const assetPath = resolveStatusOverlayAssetPath(id, knownStatusIcons);
    const generated = assetExists(assetPath);
    return [id, {
      assetPath,
      fallbackAssetPath: POSITIVE_STATUS_OVERLAYS.has(id)
        ? '/assets/icons/originals/actions/buff.webp'
        : '/assets/icons/originals/actions/debuff.webp',
      generated,
      status: generated ? 'generated' : 'missing'
    }];
  }));
}

function buildManifest(abilities, sourceSummary, options = {}) {
  const { knownStatusIcons = new Set(), assetExists = () => false } = options;
  const generatedCount = abilities.filter(ability => ability.generated).length;

  return {
    version: '1.0.0',
    category: 'abilities',
    description: 'Canonical visual metadata for active player, monster, and zodiac battle abilities',
    registryFile: 'abilities.json',
    sourceFiles: SOURCE_PATHS,
    inclusionPolicy: 'Active abilities only; passive skill-tree nodes do not trigger battle visuals.',
    iconOutputPattern: '/assets/abilities/icons/{source}/{id}.webp',
    iconCompiler: ABILITY_ICON_COMPILER,
    totalAbilities: abilities.length,
    generatedAbilities: generatedCount,
    missingAbilities: abilities.length - generatedCount,
    needsRegeneration: abilities.filter(ability => ability.needsRegeneration).length,
    sourceSummary,
    countsBySource: countBy(abilities, 'source'),
    countsByElement: countBy(abilities, 'element'),
    countsByVisualCategory: countBy(abilities, 'visualCategory'),
    normalizedElements: VALID_ELEMENTS,
    visualCategories: VALID_VISUAL_CATEGORIES,
    actorAnimations: {
      attack: 'Universal attack strip; used for monsters, zodiac abilities, and martial/non-caster guilds.',
      cast: 'Cast strip used only by player guilds whose canonical character metadata includes it.'
    },
    projectileArchetypes: PROJECTILE_ARCHETYPES,
    impactArchetypes: IMPACT_ARCHETYPES,
    statusOverlays: buildStatusOverlayManifest(abilities, knownStatusIcons, assetExists)
  };
}

async function loadSourceDefinitions() {
  const importProjectModule = relativePath => import(
    pathToFileURL(path.join(PROJECT_ROOT, relativePath)).href
  );
  const [playerModule, monsterModule, sharedModule] = await Promise.all([
    importProjectModule(SOURCE_PATHS.player),
    importProjectModule(SOURCE_PATHS.monster),
    importProjectModule(SOURCE_PATHS.zodiac)
  ]);

  return collectAbilityDefinitions({
    playerSkillTrees: playerModule.SKILL_TREES,
    monsterSkillTrees: monsterModule.MONSTER_SKILL_TREES,
    zodiacAbilities: sharedModule.ZODIAC_SHRINE_BUFFS
  });
}

function loadKnownStatusIcons() {
  const statusMetadata = readJson(STATUS_METADATA_PATH, { icons: [] });
  return new Set((statusMetadata.icons || []).map(icon => icon.id));
}

function publicAssetExists(assetPath) {
  if (!assetPath) return false;
  return fs.existsSync(path.join(PROJECT_ROOT, 'frontend/public', assetPath.replace(/^\//, '')));
}

function reportIdDiagnostics(duplicates, idDiff) {
  if (duplicates.length === 0) {
    console.log('Duplicate source IDs: none.');
  } else {
    console.error(`Duplicate source IDs (${duplicates.length}):`);
    for (const duplicate of duplicates) {
      const owners = duplicate.occurrences
        .map(entry => `${entry.source}:${entry.owner}/${entry.branch}`)
        .join(', ');
      console.error(`  ${duplicate.id}: ${owners}`);
    }
  }

  if (idDiff.staleIds.length === 0) {
    console.log('Stale registry IDs: none.');
  } else {
    console.warn(`Stale registry IDs (${idDiff.staleIds.length}): ${idDiff.staleIds.join(', ')}`);
  }

  if (idDiff.missingIds.length > 0) {
    console.log(`New registry IDs: ${idDiff.missingIds.length}.`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const existingRegistry = readJson(REGISTRY_PATH, { abilities: [] });
  const { allDefinitions, activeDefinitions, sourceSummary } = await loadSourceDefinitions();
  const missingSourceIds = allDefinitions.filter(definition => !definition.id);
  const duplicates = findDuplicateIds(allDefinitions);
  const idDiff = compareRegistryIds(existingRegistry.abilities, activeDefinitions);

  reportIdDiagnostics(duplicates, idDiff);

  if (missingSourceIds.length > 0) {
    console.error(`${missingSourceIds.length} source definition(s) are missing stable IDs.`);
    process.exitCode = 1;
    return;
  }
  if (duplicates.length > 0) {
    console.error('Ability visual registry not written because source IDs are ambiguous.');
    process.exitCode = 1;
    return;
  }

  const knownStatusIcons = loadKnownStatusIcons();
  const abilities = buildAbilityRegistry(activeDefinitions, {
    existingAbilities: existingRegistry.abilities,
    knownStatusIcons,
    assetExists: publicAssetExists
  });
  const registry = {
    version: '1.0.0',
    description: 'Deterministically compiled visual registry for active battle abilities',
    totalAbilities: abilities.length,
    abilities
  };
  const manifest = buildManifest(abilities, sourceSummary, {
    knownStatusIcons,
    assetExists: publicAssetExists
  });
  const outputs = [
    { path: REGISTRY_PATH, content: serialize(registry), label: 'ability registry' },
    { path: MANIFEST_PATH, content: serialize(manifest), label: 'ability manifest' }
  ];
  const staleOutputs = outputs.filter(output =>
    !fs.existsSync(output.path) || fs.readFileSync(output.path, 'utf8') !== output.content
  );

  if (staleOutputs.length === 0) {
    console.log(`Ability visual metadata is current (${abilities.length} active abilities).`);
    return;
  }

  if (checkOnly) {
    console.error(`Ability visual metadata is out of date: ${staleOutputs.map(output => output.label).join(', ')}.`);
    console.error('Run node scripts/ai-images/sync-ability-visuals.js.');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const output of staleOutputs) {
    fs.writeFileSync(output.path, output.content);
    console.log(`Wrote ${output.path}.`);
  }
  console.log(`Compiled ${abilities.length} active abilities (${sourceSummary.player.excludedNonActive} passive player nodes excluded).`);
}

module.exports = {
  VALID_ELEMENTS,
  VALID_VISUAL_CATEGORIES,
  PROJECTILE_ARCHETYPES,
  IMPACT_ARCHETYPES,
  ABILITY_ICON_COMPILER,
  normalizeElement,
  normalizeVisualCategory,
  inferVisualCategory,
  inferElement,
  inferProjectileArchetype,
  inferImpactArchetype,
  inferStatusOverlay,
  collectAbilityDefinitions,
  sortDefinitions,
  findDuplicateIds,
  compareRegistryIds,
  resolveStatusOverlayAssetPath,
  buildAbilityRegistry,
  buildManifest,
  loadSourceDefinitions,
  serialize
};

if (require.main === module) {
  main().catch(error => {
    console.error(`Failed to sync ability visual metadata: ${error.message}`);
    console.error(error);
    process.exitCode = 1;
  });
}
