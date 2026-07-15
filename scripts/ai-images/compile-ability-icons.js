#!/usr/bin/env node
/**
 * Compile canonical battle-ability icons from Modia's existing icon language.
 *
 * This is intentionally offline and deterministic: a given ability registry and
 * compiler version always produce the same lossless WebP bytes. The compiler
 * combines an action glyph, mechanic-specific augment badges, an optional
 * status glyph, and a stable geometric signature derived from the ability ID.
 *
 * Usage:
 *   node scripts/ai-images/compile-ability-icons.js
 *   node scripts/ai-images/compile-ability-icons.js --check
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const REGISTRY_RELATIVE_PATH = 'ai-image-metadata/abilities/abilities.json';
const SYNC_SCRIPT_RELATIVE_PATH = 'scripts/ai-images/sync-ability-visuals.js';
const PUBLIC_ROOT_RELATIVE_PATH = 'frontend/public';
const ICON_LIBRARY_RELATIVE_PATH = 'frontend/public/assets/icons/originals';
const ICON_SIZE = 128;
const COMPILER_VERSION = '1.0.0';
const DEFAULT_CONCURRENCY = 8;

const ACTION_BY_CATEGORY = Object.freeze({
  physical: 'attack',
  fire: 'magic_fire',
  ice: 'magic_ice',
  lightning: 'magic_lightning',
  earth: 'magic_earth',
  wind: 'travel',
  water: 'heal',
  holy: 'magic_holy',
  dark: 'magic_dark',
  shadow: 'stealth',
  poison: 'debuff',
  healing: 'heal',
  buff: 'buff',
  debuff: 'debuff',
  selfAura: 'defend'
});

const CATEGORY_PALETTES = Object.freeze({
  physical: ['#d66b55', '#ffd0a8', '#4b2425'],
  fire: ['#f45d22', '#ffd166', '#5f1b16'],
  ice: ['#60a5fa', '#dbeafe', '#183b68'],
  lightning: ['#facc15', '#c4b5fd', '#4c3588'],
  earth: ['#a47745', '#bef264', '#3f321f'],
  wind: ['#7dd3fc', '#f8fafc', '#27475d'],
  water: ['#38bdf8', '#93c5fd', '#163b73'],
  holy: ['#fde68a', '#fff7d6', '#806b30'],
  dark: ['#8b5cf6', '#c4b5fd', '#25164e'],
  shadow: ['#7c3aed', '#a1a1aa', '#18152c'],
  poison: ['#84cc16', '#d9f99d', '#304516'],
  healing: ['#22c55e', '#bbf7d0', '#155238'],
  buff: ['#f59e0b', '#fef3c7', '#62420d'],
  debuff: ['#ef4444', '#ddd6fe', '#5c202f'],
  selfAura: ['#14b8a6', '#99f6e4', '#164e4b']
});

const TINTED_ACTION_CATEGORIES = new Set(['wind', 'water', 'poison', 'selfAura']);

const PROJECTILE_BADGES = Object.freeze({
  none: [],
  physical_missile: ['range', 'pierce', 'accuracy'],
  thrown_object: ['actions:item'],
  elemental_orb: ['power', 'intelligence', 'mp'],
  energy_bolt: ['lightning', 'speed', 'critical'],
  support_orb: ['mp', 'healing', 'spell_resist'],
  cone_wave: ['area', 'splash', 'range']
});

const IMPACT_BADGES = Object.freeze({
  melee_strike: ['damage', 'crit', 'stagger', 'strength'],
  projectile_hit: ['pierce', 'range', 'accuracy', 'crit'],
  elemental_burst: ['power', 'intelligence', 'critical', 'damage'],
  area_burst: ['area', 'splash', 'chain', 'damage'],
  status_cloud: ['duration', 'poison', 'area', 'regen'],
  status_sigil: ['spell_resist', 'cooldown', 'duration', 'mp'],
  healing_bloom: ['healing', 'regen', 'hp', 'vitality'],
  aura_pulse: ['protection', 'shield', 'defense', 'armor']
});

const POSITIVE_STATUS_OVERLAYS = new Set([
  'berserk', 'cleanse', 'defense_up', 'haste', 'invisible', 'protect',
  'regen', 'shell', 'strength_up'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stableDigest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function byteFromDigest(digest, index) {
  return digest[index % digest.length];
}

function selectStable(values, digest, index = 0) {
  if (!values || values.length === 0) return null;
  return values[byteFromDigest(digest, index) % values.length];
}

function publicAssetUrlToFile(projectRoot, assetUrl) {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/assets/')) return null;
  const publicRoot = path.join(projectRoot, PUBLIC_ROOT_RELATIVE_PATH);
  const resolved = path.resolve(publicRoot, assetUrl.slice(1));
  return resolved.startsWith(`${publicRoot}${path.sep}`) ? resolved : null;
}

function libraryAsset(projectRoot, family, id) {
  return path.join(projectRoot, ICON_LIBRARY_RELATIVE_PATH, family, `${id}.webp`);
}

function parseBadgeToken(token) {
  const [explicitFamily, explicitId] = String(token || '').split(':');
  return explicitId
    ? { family: explicitFamily, id: explicitId }
    : { family: 'augments', id: explicitFamily };
}

function resolveExistingStatusAsset(ability, projectRoot) {
  const declared = publicAssetUrlToFile(projectRoot, ability.statusOverlayAssetPath);
  if (declared && fs.existsSync(declared)) {
    return {
      family: ability.statusOverlayAssetPath.includes('/status/') ? 'status' : 'custom',
      id: ability.statusOverlay,
      path: declared
    };
  }

  if (!ability.statusOverlay) return null;
  const fallbackId = POSITIVE_STATUS_OVERLAYS.has(ability.statusOverlay) ? 'buff' : 'debuff';
  return {
    family: 'actions',
    id: fallbackId,
    path: libraryAsset(projectRoot, 'actions', fallbackId)
  };
}

function validateAbilityIdentity(ability) {
  if (!/^(player|monster|zodiac)$/.test(String(ability.source || ''))) {
    throw new Error(`Invalid ability source for ${ability.id || '<missing id>'}: ${ability.source}`);
  }
  if (!/^[a-z0-9_]+$/.test(String(ability.id || ''))) {
    throw new Error(`Invalid canonical ability ID: ${ability.id}`);
  }
  const expected = `/assets/abilities/icons/${ability.source}/${ability.id}.webp`;
  if (ability.iconAssetPath !== expected) {
    throw new Error(`${ability.source}/${ability.id} has noncanonical icon path ${ability.iconAssetPath}`);
  }
  if (!ACTION_BY_CATEGORY[ability.visualCategory]) {
    throw new Error(`${ability.id} has unsupported visual category ${ability.visualCategory}`);
  }
  if (!PROJECTILE_BADGES[ability.projectileArchetype]) {
    throw new Error(`${ability.id} has unsupported projectile archetype ${ability.projectileArchetype}`);
  }
  if (!IMPACT_BADGES[ability.impactArchetype]) {
    throw new Error(`${ability.id} has unsupported impact archetype ${ability.impactArchetype}`);
  }
}

function buildIconRecipe(ability, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  validateAbilityIdentity(ability);

  const digest = stableDigest([
    COMPILER_VERSION,
    ability.source,
    ability.owner,
    ability.id,
    ability.element,
    ability.visualCategory,
    ability.projectileArchetype,
    ability.impactArchetype,
    ability.statusOverlay || 'none'
  ].join('|'));
  const actionId = ACTION_BY_CATEGORY[ability.visualCategory];
  const projectileToken = selectStable(PROJECTILE_BADGES[ability.projectileArchetype], digest, 3);
  const impactToken = selectStable(IMPACT_BADGES[ability.impactArchetype], digest, 7);
  const projectileBadge = projectileToken ? parseBadgeToken(projectileToken) : null;
  const impactBadge = parseBadgeToken(impactToken);
  const palette = CATEGORY_PALETTES[ability.visualCategory];
  const statusBadge = resolveExistingStatusAsset(ability, projectRoot);

  const recipe = {
    compilerVersion: COMPILER_VERSION,
    id: ability.id,
    source: ability.source,
    visualCategory: ability.visualCategory,
    projectileArchetype: ability.projectileArchetype,
    impactArchetype: ability.impactArchetype,
    statusOverlay: ability.statusOverlay || null,
    palette,
    digestHex: digest.toString('hex'),
    action: {
      family: 'actions',
      id: actionId,
      path: libraryAsset(projectRoot, 'actions', actionId),
      tint: TINTED_ACTION_CATEGORIES.has(ability.visualCategory) ? palette[0] : null,
      size: 76 + (byteFromDigest(digest, 9) % 13),
      rotation: (byteFromDigest(digest, 10) % 25) - 12,
      left: 21 + (byteFromDigest(digest, 11) % 8) - 4,
      top: 18 + (byteFromDigest(digest, 12) % 8) - 4
    },
    impactBadge: {
      ...impactBadge,
      path: libraryAsset(projectRoot, impactBadge.family, impactBadge.id),
      rotation: (byteFromDigest(digest, 13) % 31) - 15
    },
    projectileBadge: projectileBadge ? {
      ...projectileBadge,
      path: libraryAsset(projectRoot, projectileBadge.family, projectileBadge.id),
      rotation: (byteFromDigest(digest, 14) % 31) - 15
    } : null,
    statusBadge,
    variant: {
      backplateRotation: byteFromDigest(digest, 15) % 46 - 23,
      paletteSwap: byteFromDigest(digest, 16) % 2 === 1,
      motifPhase: byteFromDigest(digest, 17) % 8,
      motifBits: digest.subarray(18, 26).toString('hex'),
      sourceStyle: { player: 1, monster: 2, zodiac: 3 }[ability.source]
    }
  };

  for (const asset of [recipe.action, recipe.impactBadge, recipe.projectileBadge, recipe.statusBadge]) {
    if (asset && !fs.existsSync(asset.path)) {
      throw new Error(`${ability.id} references missing compiler source ${path.relative(projectRoot, asset.path)}`);
    }
  }

  return recipe;
}

function pointsForRegularPolygon(cx, cy, radius, count, rotationDegrees = -90) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (rotationDegrees + index * (360 / count)) * Math.PI / 180;
    return `${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`;
  }).join(' ');
}

function impactBackplateMarkup(archetype, fill, stroke, rotation) {
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"`;
  const transform = `transform="rotate(${rotation} 64 64)"`;
  switch (archetype) {
    case 'melee_strike':
      return `<polygon points="64,6 122,64 64,122 6,64" ${common} ${transform}/>`;
    case 'projectile_hit':
      return `<polygon points="${pointsForRegularPolygon(64, 64, 59, 6)}" ${common} ${transform}/>`;
    case 'elemental_burst': {
      const points = Array.from({ length: 16 }, (_, index) => {
        const radius = index % 2 === 0 ? 59 : 48;
        const angle = (-90 + index * 22.5 + rotation) * Math.PI / 180;
        return `${(64 + Math.cos(angle) * radius).toFixed(2)},${(64 + Math.sin(angle) * radius).toFixed(2)}`;
      }).join(' ');
      return `<polygon points="${points}" ${common}/>`;
    }
    case 'area_burst':
      return `<circle cx="64" cy="64" r="58" ${common}/><circle cx="64" cy="64" r="49" fill="none" stroke="${stroke}" stroke-width="1.5" opacity="0.65"/>`;
    case 'status_cloud':
      return `<path d="M20 83 C2 70 12 45 31 44 C31 21 58 10 73 27 C94 15 116 32 111 53 C130 67 117 96 95 94 C80 118 45 116 36 96 C29 97 24 91 20 83 Z" ${common} ${transform}/>`;
    case 'status_sigil':
      return `<polygon points="${pointsForRegularPolygon(64, 64, 59, 8)}" ${common} ${transform}/><circle cx="64" cy="64" r="48" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="6 5"/>`;
    case 'healing_bloom':
      return `<g ${transform}><ellipse cx="64" cy="29" rx="25" ry="22" ${common}/><ellipse cx="99" cy="64" rx="22" ry="25" ${common}/><ellipse cx="64" cy="99" rx="25" ry="22" ${common}/><ellipse cx="29" cy="64" rx="22" ry="25" ${common}/><circle cx="64" cy="64" r="33" ${common}/></g>`;
    case 'aura_pulse':
      return `<path d="M64 5 C84 19 103 20 117 24 L113 72 C109 98 91 115 64 123 C37 115 19 98 15 72 L11 24 C25 20 44 19 64 5 Z" ${common} ${transform}/>`;
    default:
      throw new Error(`Unsupported impact backplate ${archetype}`);
  }
}

function buildSignatureMarkup(recipe) {
  const digest = Buffer.from(recipe.digestHex, 'hex');
  const [primary, secondary] = recipe.variant.paletteSwap
    ? [recipe.palette[1], recipe.palette[0]]
    : [recipe.palette[0], recipe.palette[1]];
  const marks = [];
  const phase = recipe.variant.motifPhase;
  for (let index = 0; index < 8; index++) {
    const digestByte = byteFromDigest(digest, 18 + index);
    const angle = (-90 + (index + phase) * 45) * Math.PI / 180;
    const radius = 52 + ((digestByte >> 5) % 5);
    const x = 64 + Math.cos(angle) * radius;
    const y = 64 + Math.sin(angle) * radius;
    const size = 2.2 + (digestByte % 4);
    const color = digestByte & 0x10 ? primary : secondary;
    const shape = digestByte % 3;
    if (shape === 0) {
      marks.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${size.toFixed(2)}" fill="${color}"/>`);
    } else if (shape === 1) {
      marks.push(`<rect x="${(x - size).toFixed(2)}" y="${(y - size).toFixed(2)}" width="${(size * 2).toFixed(2)}" height="${(size * 2).toFixed(2)}" rx="1" fill="${color}" transform="rotate(45 ${x.toFixed(2)} ${y.toFixed(2)})"/>`);
    } else {
      const points = `${x.toFixed(2)},${(y - size * 1.4).toFixed(2)} ${(x + size * 1.25).toFixed(2)},${(y + size).toFixed(2)} ${(x - size * 1.25).toFixed(2)},${(y + size).toFixed(2)}`;
      marks.push(`<polygon points="${points}" fill="${color}"/>`);
    }
  }

  const sourceMarks = Array.from({ length: recipe.variant.sourceStyle }, (_, index) => {
    const x = 14 + index * 8;
    return `<polygon points="${x},12 ${x + 4},8 ${x + 8},12 ${x + 4},16" fill="${secondary}" stroke="${recipe.palette[2]}" stroke-width="1"/>`;
  }).join('');
  return `${marks.join('')}${sourceMarks}`;
}

function buildBackplateSvg(recipe) {
  const [primary, secondary] = recipe.variant.paletteSwap
    ? [recipe.palette[1], recipe.palette[0]]
    : [recipe.palette[0], recipe.palette[1]];
  const fill = `${recipe.palette[2]}d9`;
  const backplate = impactBackplateMarkup(
    recipe.impactArchetype,
    fill,
    primary,
    recipe.variant.backplateRotation
  );
  const signature = buildSignatureMarkup(recipe);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
      `<g opacity="0.96">${backplate}</g>` +
      `<circle cx="64" cy="64" r="43" fill="none" stroke="${secondary}" stroke-width="1.5" opacity="0.42"/>` +
      signature +
    `</svg>`
  );
}

function buildBadgeBackingsSvg(recipe) {
  const impactX = 22;
  const projectileX = 106;
  const status = recipe.statusBadge
    ? `<circle cx="105" cy="22" r="17" fill="${recipe.palette[2]}f2" stroke="${recipe.palette[1]}" stroke-width="2"/>`
    : '';
  const projectile = recipe.projectileBadge
    ? `<circle cx="${projectileX}" cy="105" r="17" fill="${recipe.palette[2]}f2" stroke="${recipe.palette[0]}" stroke-width="2"/>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
      `<circle cx="${impactX}" cy="105" r="17" fill="${recipe.palette[2]}f2" stroke="${recipe.palette[0]}" stroke-width="2"/>` +
      projectile + status +
    `</svg>`
  );
}

async function prepareLibraryLayer(asset, options = {}) {
  const size = options.size || 32;
  let pipeline = sharp(asset.path)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (asset.tint) pipeline = pipeline.tint(asset.tint);
  if (options.saturation || options.brightness) {
    pipeline = pipeline.modulate({
      saturation: options.saturation || 1,
      brightness: options.brightness || 1
    });
  }
  if (asset.rotation) {
    pipeline = pipeline
      .rotate(asset.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  }
  return pipeline.png().toBuffer();
}

async function renderAbilityIcon(ability, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const recipe = buildIconRecipe(ability, { projectRoot });
  const digest = Buffer.from(recipe.digestHex, 'hex');
  const actionSize = recipe.action.size;
  const [action, impact, projectile, status] = await Promise.all([
    prepareLibraryLayer(recipe.action, {
      size: actionSize,
      saturation: 0.92 + (byteFromDigest(digest, 27) % 15) / 100,
      brightness: 0.96 + (byteFromDigest(digest, 28) % 10) / 100
    }),
    prepareLibraryLayer(recipe.impactBadge, { size: 29, saturation: 1.05 }),
    recipe.projectileBadge
      ? prepareLibraryLayer(recipe.projectileBadge, { size: 29, saturation: 1.05 })
      : Promise.resolve(null),
    recipe.statusBadge
      ? prepareLibraryLayer(recipe.statusBadge, { size: 29, saturation: 1.08 })
      : Promise.resolve(null)
  ]);

  const composite = [
    { input: buildBackplateSvg(recipe), left: 0, top: 0 },
    {
      input: action,
      left: Math.max(2, Math.min(ICON_SIZE - actionSize - 2, recipe.action.left)),
      top: Math.max(2, Math.min(ICON_SIZE - actionSize - 2, recipe.action.top))
    },
    { input: buildBadgeBackingsSvg(recipe), left: 0, top: 0 },
    { input: impact, left: 8, top: 91 }
  ];
  if (projectile) composite.push({ input: projectile, left: 92, top: 91 });
  if (status) composite.push({ input: status, left: 91, top: 8 });

  return sharp({
    create: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composite)
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
}

async function mapLimit(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker()
  ));
  return results;
}

function updateGeneratedRegistry(registry, generatedAt) {
  return {
    ...registry,
    abilities: registry.abilities.map(ability => ({
      ...ability,
      generated: true,
      status: 'generated',
      needsRegeneration: false,
      generatedAt: ability.generatedAt || generatedAt
    }))
  };
}

function runMetadataSync(projectRoot, checkOnly) {
  const script = path.join(projectRoot, SYNC_SCRIPT_RELATIVE_PATH);
  const result = spawnSync(process.execPath, [script, ...(checkOnly ? ['--check'] : [])], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Ability metadata sync ${checkOnly ? 'check ' : ''}failed with exit ${result.status}`);
  }
}

async function compileAbilityIcons(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || PROJECT_ROOT);
  const checkOnly = options.checkOnly === true;
  const concurrency = Math.max(1, Number(options.concurrency || DEFAULT_CONCURRENCY));
  const generatedAt = options.generatedAt || new Date().toISOString();
  const registryPath = path.join(projectRoot, REGISTRY_RELATIVE_PATH);
  const registry = readJson(registryPath);
  if (!Array.isArray(registry.abilities) || registry.abilities.length === 0) {
    throw new Error('Ability registry is missing or empty');
  }

  const outputs = await mapLimit(registry.abilities, concurrency, async ability => {
    const filePath = publicAssetUrlToFile(projectRoot, ability.iconAssetPath);
    if (!filePath) throw new Error(`${ability.id} has an unsafe output path`);
    const content = await renderAbilityIcon(ability, { projectRoot });
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    return {
      ability,
      filePath,
      content,
      current: Boolean(existing && existing.equals(content))
    };
  });
  const stale = outputs.filter(output => !output.current);

  if (checkOnly) {
    if (stale.length > 0) {
      const sample = stale.slice(0, 8).map(output => `${output.ability.source}/${output.ability.id}`).join(', ');
      throw new Error(`${stale.length} canonical ability icon(s) are missing or stale: ${sample}${stale.length > 8 ? ', ...' : ''}`);
    }
    const staleMetadata = registry.abilities.filter(ability => (
      ability.generated !== true ||
      ability.status !== 'generated' ||
      ability.needsRegeneration === true ||
      !ability.generatedAt
    ));
    if (staleMetadata.length > 0) {
      throw new Error(`${staleMetadata.length} ability metadata entr${staleMetadata.length === 1 ? 'y is' : 'ies are'} stale`);
    }
    runMetadataSync(projectRoot, true);
    console.log(`Ability icons are current (${outputs.length}/${outputs.length}, compiler ${COMPILER_VERSION}).`);
    return { total: outputs.length, written: 0, current: outputs.length };
  }

  for (const output of stale) {
    fs.mkdirSync(path.dirname(output.filePath), { recursive: true });
    fs.writeFileSync(output.filePath, output.content);
  }
  fs.writeFileSync(registryPath, serialize(updateGeneratedRegistry(registry, generatedAt)));
  runMetadataSync(projectRoot, false);
  console.log(`Compiled ${outputs.length} deterministic ability icons (${stale.length} written, ${outputs.length - stale.length} already current).`);
  return { total: outputs.length, written: stale.length, current: outputs.length - stale.length };
}

function parseArgs(argv) {
  const options = { checkOnly: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--check') options.checkOnly = true;
    else if (argument === '--generated-at') options.generatedAt = argv[++index];
    else if (argument === '--concurrency') options.concurrency = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.generatedAt && !Number.isFinite(Date.parse(options.generatedAt))) {
    throw new Error(`Invalid --generated-at timestamp: ${options.generatedAt}`);
  }
  return options;
}

module.exports = {
  ICON_SIZE,
  COMPILER_VERSION,
  ACTION_BY_CATEGORY,
  CATEGORY_PALETTES,
  PROJECTILE_BADGES,
  IMPACT_BADGES,
  stableDigest,
  selectStable,
  publicAssetUrlToFile,
  validateAbilityIdentity,
  buildIconRecipe,
  buildBackplateSvg,
  renderAbilityIcon,
  updateGeneratedRegistry,
  compileAbilityIcons,
  parseArgs
};

if (require.main === module) {
  compileAbilityIcons(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(`Failed to compile ability icons: ${error.message}`);
    process.exitCode = 1;
  });
}
