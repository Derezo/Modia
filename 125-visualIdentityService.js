/**
 * Canonical, JSON-safe visual identity for every battle participant.
 *
 * Battle unit ids identify an encounter instance; visual ids identify the
 * reusable artwork. Keeping those concepts separate lets the same NPC render
 * consistently in every zone while legacy clients continue reading their
 * preferred sprite-id spelling.
 */

import { NPC_PRIMARY_BIOMES } from '../../../../shared/assetPaths.js';

export { NPC_PRIMARY_BIOMES };

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function normalizeToken(value, fallback = null) {
  const selected = firstPresent(value, fallback);
  return selected === undefined || selected === null
    ? null
    : String(selected).trim().toLowerCase();
}

function normalizeId(value, fallback = null) {
  const selected = firstPresent(value, fallback);
  if (selected === undefined || selected === null) return null;
  if (['string', 'number', 'boolean'].includes(typeof selected)) return selected;
  return String(selected);
}

/**
 * Build the canonical visual identity without mutating its input.
 *
 * Player: { kind, id, race, gender, class }
 * NPC:    { kind, id, visualId, primaryBiome }
 */
export function createBattleVisualIdentity(unit = {}, overrides = {}) {
  const existing = unit.visualIdentity || {};
  const requestedKind = normalizeToken(
    firstPresent(overrides.kind, existing.kind, unit.type === 'player' ? 'player' : 'npc')
  );
  const kind = requestedKind === 'player' ? 'player' : 'npc';

  if (kind === 'player') {
    return {
      kind: 'player',
      id: normalizeId(firstPresent(
        overrides.id,
        existing.id,
        unit.characterId,
        unit.character_id,
        unit.id
      )),
      race: normalizeToken(firstPresent(overrides.race, existing.race, unit.race)),
      gender: normalizeToken(
        firstPresent(overrides.gender, existing.gender, unit.gender),
        'other'
      ),
      class: normalizeToken(firstPresent(overrides.class, existing.class, unit.class))
    };
  }

  const visualId = normalizeToken(firstPresent(
    overrides.visualId,
    existing.visualId,
    unit.visualId,
    unit.enemyId,
    unit.sprite_id,
    unit.spriteId
  ));
  const knownPrimaryBiome = visualId ? NPC_PRIMARY_BIOMES[visualId] : null;
  const spawnNodeTypes = firstPresent(
    overrides.spawnNodeTypes,
    unit.spawnNodeTypes,
    unit.spawn_node_types
  );

  return {
    kind: 'npc',
    id: normalizeId(firstPresent(
      overrides.id,
      existing.id,
      unit.templateId,
      unit.template_id,
      unit.id,
      visualId
    )),
    visualId,
    primaryBiome: normalizeToken(firstPresent(
      knownPrimaryBiome,
      overrides.primaryBiome,
      existing.primaryBiome,
      unit.primaryBiome,
      Array.isArray(spawnNodeTypes) ? spawnNodeTypes[0] : null,
      unit.biome,
      'forest'
    ))
  };
}

/**
 * Attach canonical identity and all legacy NPC aliases to a battle unit.
 */
export function withBattleVisualIdentity(unit = {}, overrides = {}) {
  const visualIdentity = createBattleVisualIdentity(unit, overrides);
  const normalized = {
    ...unit,
    visualIdentity
  };

  if (visualIdentity.kind === 'npc') {
    normalized.visualId = visualIdentity.visualId;
    normalized.enemyId = visualIdentity.visualId;
    normalized.sprite_id = visualIdentity.visualId;
    normalized.spriteId = visualIdentity.visualId;
    normalized.primaryBiome = visualIdentity.primaryBiome;
    normalized.biome = normalized.biome ?? visualIdentity.primaryBiome;
  } else {
    // Keep legacy top-level transport fields synchronized for renderers that
    // have not migrated to the nested DTO yet. The nested identity remains
    // authoritative when old persisted fields disagree.
    if (visualIdentity.race) normalized.race = visualIdentity.race;
    if (visualIdentity.gender) normalized.gender = visualIdentity.gender;
    if (visualIdentity.class) normalized.class = visualIdentity.class;
  }

  return normalized;
}

/**
 * Backfill canonical art DTOs on a persisted battle state without mutating the
 * database object. This keeps rejoin/current responses compatible with battles
 * created before visualIdentity was introduced.
 */
export function withBattleStateVisualIdentities(state = {}) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.units)) {
    return state;
  }

  return {
    ...state,
    units: state.units.map(unit => withBattleVisualIdentity(unit))
  };
}
