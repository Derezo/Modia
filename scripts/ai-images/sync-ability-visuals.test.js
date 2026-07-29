'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  VALID_ELEMENTS,
  VALID_VISUAL_CATEGORIES,
  PROJECTILE_ARCHETYPES,
  IMPACT_ARCHETYPES,
  normalizeElement,
  normalizeVisualCategory,
  inferVisualCategory,
  collectAbilityDefinitions,
  findDuplicateIds,
  compareRegistryIds,
  buildAbilityRegistry,
  resolveStatusOverlayAssetPath,
  loadSourceDefinitions
} = require('./sync-ability-visuals');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function makeDefinition(overrides = {}) {
  return {
    id: 'fire_bolt',
    source: 'player',
    sourceFile: 'api/src/config/skillTrees.js',
    owner: 'wizard',
    ownerType: 'guild',
    branch: 'Fire',
    type: 'active',
    skill: {
      id: 'fire_bolt',
      name: 'Fire Bolt',
      description: 'A burning projectile',
      type: 'active',
      element: 'fire',
      effect: 'burn',
      damageType: 'magical',
      power: 100,
      range: 4
    },
    ...overrides
  };
}

test('normalizes element and visual-category aliases to canonical values', () => {
  assert.equal(normalizeElement('air'), 'wind');
  assert.equal(normalizeElement('darkness'), 'dark');
  assert.equal(normalizeElement('not-an-element'), 'neutral');
  assert.equal(normalizeVisualCategory('selfAura'), 'selfAura');
  assert.equal(normalizeVisualCategory('AIR'), 'wind');
  assert.equal(inferVisualCategory({ element: 'air' }), 'wind');
  assert.equal(inferVisualCategory({ effect: 'corrode' }), 'poison');
  assert.equal(inferVisualCategory({ healPercent: 20 }), 'healing');
});

test('collects all sources while excluding passive nodes from the visual registry', () => {
  const collected = collectAbilityDefinitions({
    playerSkillTrees: {
      warrior: {
        branches: [{
          name: 'Core',
          skills: [
            { id: 'slash', type: 'active' },
            { id: 'iron_skin', type: 'passive' }
          ]
        }]
      }
    },
    monsterSkillTrees: {
      beast: { branches: [{ name: 'Fangs', skills: [{ id: 'bite', type: 'active' }] }] }
    },
    zodiacAbilities: {
      aries: { signatureAbility: 'rams_charge', name: "Ram's Charge", element: 'fire' }
    }
  });

  assert.equal(collected.allDefinitions.length, 4);
  assert.deepEqual(collected.activeDefinitions.map(definition => definition.id), [
    'slash', 'bite', 'rams_charge'
  ]);
  assert.deepEqual(collected.sourceSummary.player, {
    totalDefinitions: 2,
    activeAbilities: 1,
    excludedNonActive: 1
  });
});

test('builds stable visual fields and deliberately reuses shared archetypes', () => {
  const [ability] = buildAbilityRegistry([makeDefinition()], {
    knownStatusIcons: new Set(['burn']),
    assetExists: () => false
  });

  assert.deepEqual(ability, {
    id: 'fire_bolt',
    name: 'Fire Bolt',
    description: 'A burning projectile',
    type: 'active',
    source: 'player',
    sourceFile: 'api/src/config/skillTrees.js',
    owner: 'wizard',
    ownerType: 'guild',
    branch: 'Fire',
    element: 'fire',
    visualCategory: 'fire',
    iconAssetPath: '/assets/abilities/icons/player/fire_bolt.webp',
    actorAnimation: 'cast',
    projectileArchetype: 'elemental_orb',
    impactArchetype: 'elemental_burst',
    statusOverlay: 'burn',
    statusOverlayAssetPath: '/assets/icons/originals/status/burn.webp',
    generated: false,
    status: 'missing',
    needsRegeneration: false,
    generatedAt: null
  });
});

test('status overlays reuse existing artwork instead of missing custom paths', () => {
  assert.equal(
    resolveStatusOverlayAssetPath('bleed'),
    '/assets/icons/originals/augments/damage.webp'
  );
  assert.equal(
    resolveStatusOverlayAssetPath('cleanse'),
    '/assets/icons/originals/augments/cleanse.webp'
  );
  assert.equal(
    resolveStatusOverlayAssetPath('invisible'),
    '/assets/icons/originals/actions/stealth.webp'
  );
  assert.equal(
    resolveStatusOverlayAssetPath('taunt'),
    '/assets/icons/originals/actions/taunt.webp'
  );
  assert.equal(
    resolveStatusOverlayAssetPath('future_status'),
    '/assets/abilities/status/future_status.webp'
  );
  for (const status of ['bleed', 'cleanse', 'invisible', 'taunt']) {
    assert.equal(
      resolveStatusOverlayAssetPath(status).startsWith('/assets/abilities/icons/'),
      false,
      `${status} must not use a generated ability icon as compiler input`
    );
  }
});

test('zodiac overrides capture mechanics absent from the blessing definition', () => {
  const definition = makeDefinition({
    id: 'dreamwave',
    source: 'zodiac',
    sourceFile: 'shared/constants.js',
    owner: 'pisces',
    ownerType: 'zodiac_sign',
    branch: 'Signature',
    skill: {
      id: 'dreamwave',
      name: 'Dreamwave',
      description: '50% chance to sleep target 1 turn',
      type: 'active',
      element: 'water'
    }
  });
  const [ability] = buildAbilityRegistry([definition]);

  assert.equal(ability.actorAnimation, 'attack');
  assert.equal(ability.projectileArchetype, 'support_orb');
  assert.equal(ability.impactArchetype, 'status_sigil');
  assert.equal(ability.statusOverlay, 'sleep');
});

test('reports duplicate source IDs and stale registry IDs deterministically', () => {
  const duplicate = makeDefinition();
  const duplicates = findDuplicateIds([
    duplicate,
    makeDefinition({ source: 'monster', owner: 'elemental', ownerType: 'archetype' })
  ]);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].id, 'fire_bolt');
  assert.deepEqual(compareRegistryIds(
    [{ id: 'fire_bolt' }, { id: 'removed_skill' }],
    [duplicate, makeDefinition({ id: 'new_skill', skill: { id: 'new_skill' } })]
  ), {
    staleIds: ['removed_skill'],
    missingIds: ['new_skill']
  });
});

test('generated and regeneration status follows the canonical icon asset', () => {
  const [ability] = buildAbilityRegistry([makeDefinition()], {
    existingAbilities: [{
      id: 'fire_bolt',
      generated: true,
      needsRegeneration: true,
      generatedAt: '2026-01-01T00:00:00.000Z'
    }],
    assetExists: assetPath => assetPath === '/assets/abilities/icons/player/fire_bolt.webp'
  });

  assert.equal(ability.generated, true);
  assert.equal(ability.status, 'needs_regeneration');
  assert.equal(ability.needsRegeneration, true);
  assert.equal(ability.generatedAt, '2026-01-01T00:00:00.000Z');
});

test('current source inventory compiles to a complete unique active registry', async () => {
  const { allDefinitions, activeDefinitions, sourceSummary } = await loadSourceDefinitions();
  const abilities = buildAbilityRegistry(activeDefinitions);

  assert.equal(allDefinitions.length, 184);
  assert.equal(activeDefinitions.length, 164);
  assert.equal(findDuplicateIds(allDefinitions).length, 0);
  assert.deepEqual(sourceSummary, {
    player: { totalDefinitions: 92, activeAbilities: 72, excludedNonActive: 20 },
    monster: { totalDefinitions: 80, activeAbilities: 80, excludedNonActive: 0 },
    zodiac: { totalDefinitions: 12, activeAbilities: 12, excludedNonActive: 0 }
  });
  assert.equal(new Set(abilities.map(ability => ability.id)).size, abilities.length);

  for (const ability of abilities) {
    assert.ok(ability.id);
    assert.ok(ability.source);
    assert.ok(ability.owner);
    assert.ok(VALID_ELEMENTS.includes(ability.element), `${ability.id} has invalid element`);
    assert.ok(
      VALID_VISUAL_CATEGORIES.includes(ability.visualCategory),
      `${ability.id} has invalid visual category`
    );
    assert.ok(
      Object.hasOwn(PROJECTILE_ARCHETYPES, ability.projectileArchetype),
      `${ability.id} has invalid projectile archetype`
    );
    assert.ok(
      Object.hasOwn(IMPACT_ARCHETYPES, ability.impactArchetype),
      `${ability.id} has invalid impact archetype`
    );
    assert.match(ability.iconAssetPath, /^\/assets\/abilities\/icons\/(player|monster|zodiac)\//);
    assert.ok(['attack', 'cast'].includes(ability.actorAnimation));
    assert.ok(['generated', 'missing', 'needs_regeneration'].includes(ability.status));
  }
});

test('checked-in generated ability metadata is current', () => {
  const result = spawnSync(process.execPath, [
    path.join(PROJECT_ROOT, 'scripts/ai-images/sync-ability-visuals.js'),
    '--check'
  ], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Duplicate source IDs: none/);
  assert.match(result.stdout, /Stale registry IDs: none/);
  assert.match(result.stdout, /current \(164 active abilities\)/);
});
