import {
  BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME
} from '../../../../shared/battleMap/BattleMapV3EcologyProfiles.js';

export const BATTLE_MAP_ECOLOGY_CONTEXT_VERSION =
  'battle-map-ecology-context-v1';

const FOREST_PROFILES_BY_RACE = Object.freeze({
  human: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.forest[1],
  elf: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.forest[2],
  vampire: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.forest[3],
  dwarf: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.forest[4]
});

const CAVE_PROFILES_BY_RACE = Object.freeze({
  dwarf: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.cave[1],
  vampire: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.cave[2]
});

const MOUNTAIN_PROFILES_BY_RACE = Object.freeze({
  orc: BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.mountain[1]
});

const AUTHORITATIVE_THEME_BY_NODE_TYPE = Object.freeze({
  forest: 'forest',
  cave: 'cave',
  mountain: 'mountain',
  bridge: 'bridge',
  castle: 'castle',
  dungeon: 'dungeon',
  swamp: 'swamp',
  volcano: 'volcano',
  plains: 'plains',
  arena: 'arena',
  guild: 'guild',
  'elven-grove': 'elven_grove',
  'dwarven-mine': 'dwarven_mine',
  'vampiric-crypt': 'vampiric_crypt',
  'orcish-warcamp': 'orcish_warcamp',
  'human-ruins': 'human_ruins'
});

export const BATTLE_MAP_ECOLOGY_NODE_QUERY = `
  SELECT wn.id, wn.node_type, wn.name, wn.difficulty_tier,
         wn.local_seed, wn.features, wn.region_id,
         COALESCE(wr.race, wn.region_race) AS region_race,
         wr.dominant_terrain AS region_dominant_terrain
  FROM world_nodes wn
  LEFT JOIN world_regions wr ON wr.id = wn.region_id
  WHERE wn.id = $1
`;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nullableString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableSafeInteger(value) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizedIdentifier(value) {
  const text = nullableString(value);
  if (text === null) return null;
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : null;
}

function terrainSubtypeFromRecord(record) {
  if (!isPlainObject(record)) return null;
  for (const key of [
    'terrainSubtype',
    'terrain_subtype',
    'displayTerrain',
    'display_terrain'
  ]) {
    const subtype = normalizedIdentifier(record[key]);
    if (subtype !== null) return subtype;
  }
  const kind = normalizedIdentifier(record.kind ?? record.category);
  if (kind !== 'terrain') return null;
  return normalizedIdentifier(record.subtype ?? record.name ?? record.id);
}

/**
 * Extract a persisted node terrain subtype when older or newer world content
 * has recorded one in the node feature payload. Plain string feature labels
 * are intentionally ignored because they are not a typed terrain contract.
 */
export function extractBattleMapTerrainSubtype(features) {
  const direct = terrainSubtypeFromRecord(features);
  if (direct !== null) return direct;
  if (!Array.isArray(features)) return null;
  for (const feature of features) {
    const subtype = terrainSubtypeFromRecord(feature);
    if (subtype !== null) return subtype;
  }
  return null;
}

/**
 * Resolve a coarse authoritative ecology asset profile from a supported theme
 * and optional trusted regional context. The profile changes only the ecology
 * choice; BattleMapV3 theme and scene shape remain catalog-owned.
 */
export function resolveBattleMapEcologyProfile({
  nodeType = null,
  regionRace = null
} = {}) {
  const type = normalizedIdentifier(nodeType);
  const race = normalizedIdentifier(regionRace);
  if (type === 'forest') {
    return FOREST_PROFILES_BY_RACE[race]
      ?? BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.forest[0];
  }
  if (type === 'cave') {
    return CAVE_PROFILES_BY_RACE[race]
      ?? BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.cave[0];
  }
  if (type === 'mountain') {
    return MOUNTAIN_PROFILES_BY_RACE[race]
      ?? BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.mountain[0];
  }
  if (type === 'palace') {
    return BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME.castle[1];
  }
  const authoritativeTheme = AUTHORITATIVE_THEME_BY_NODE_TYPE[type];
  return authoritativeTheme === undefined
    ? null
    : BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME[authoritativeTheme][0];
}

/**
 * Normalize one trusted world-node query row into the stable context passed to
 * new-battle map selection. Optional regional/subtype fields remain null when
 * older world data does not provide them.
 */
export function createBattleMapEcologyContext(row) {
  if (!isPlainObject(row)) {
    throw new TypeError('Battle-map ecology source must be a plain object');
  }
  const nodeType = normalizedIdentifier(row.node_type ?? row.nodeType);
  const regionRace = normalizedIdentifier(row.region_race ?? row.regionRace);
  const explicitTerrainSubtype = normalizedIdentifier(
    row.terrain_subtype
    ?? row.terrainSubtype
    ?? row.display_terrain
    ?? row.displayTerrain
  );
  const terrainSubtype = explicitTerrainSubtype
    ?? extractBattleMapTerrainSubtype(row.features);
  const context = {
    version: BATTLE_MAP_ECOLOGY_CONTEXT_VERSION,
    node: {
      id: nullableSafeInteger(row.id ?? row.node_id ?? row.nodeId),
      name: nullableString(row.name ?? row.node_name ?? row.nodeName),
      type: nodeType,
      difficultyTier: nullableSafeInteger(
        row.difficulty_tier ?? row.difficultyTier
      ),
      localSeed: nullableSafeInteger(row.local_seed ?? row.localSeed),
      terrainSubtype
    },
    region: {
      id: nullableSafeInteger(row.region_id ?? row.regionId),
      race: regionRace,
      dominantTerrain: normalizedIdentifier(
        row.region_dominant_terrain ?? row.regionDominantTerrain
      )
    },
    ecologyProfile: resolveBattleMapEcologyProfile({
      nodeType,
      regionRace
    })
  };
  Object.freeze(context.node);
  Object.freeze(context.region);
  return Object.freeze(context);
}

/**
 * Load the trusted source row and its normalized context through the caller's
 * transaction-bound query executor. A missing node remains a normal null
 * result so the route can preserve its existing HTTP error behavior.
 */
export async function loadBattleMapEcologyNode(queryExecutor, nodeId) {
  if (typeof queryExecutor !== 'function') {
    throw new TypeError('Battle-map ecology query executor must be a function');
  }
  const result = await queryExecutor(BATTLE_MAP_ECOLOGY_NODE_QUERY, [nodeId]);
  const node = result?.rows?.[0];
  if (node === undefined) return null;
  return Object.freeze({
    node,
    ecologyContext: createBattleMapEcologyContext(node)
  });
}
