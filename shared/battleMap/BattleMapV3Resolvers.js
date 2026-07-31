import { deepFreeze } from './canonicalJson.js';

export const BATTLE_MAP_V3_SUPPORTED_THEMES = deepFreeze([
  'forest',
  'cave',
  'mountain',
  'bridge',
  'castle',
  'dungeon',
  'swamp',
  'volcano',
  'plains',
  'arena',
  'guild',
  'elven_grove',
  'dwarven_mine',
  'vampiric_crypt',
  'orcish_warcamp',
  'human_ruins'
]);

const THEME_SET = new Set(BATTLE_MAP_V3_SUPPORTED_THEMES);
const SAFE_BAND_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;
const GUILD_TIER_TO_BATTLE_TIER = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5
});

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function assertSupportedTheme(value, label) {
  if (!THEME_SET.has(value)) {
    const error = new TypeError(`${label} is not a supported BattleMapV3 theme`);
    error.code = 'BATTLE_MAP_V3_THEME_UNSUPPORTED';
    throw error;
  }
  return value;
}

function assertTier(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5) {
    throw new TypeError(`${label} must be an integer from 1 through 5`);
  }
  return value;
}

function assertBand(value, label) {
  if (typeof value !== 'string' || !SAFE_BAND_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase safe identifier`);
  }
  return value;
}

/**
 * Resolve authoritative encounter context to one of the 16 explicit themes.
 * Unknown values fail instead of becoming forest or entering compatibility.
 */
export function resolveBattleMapV3Theme({
  nodeType = null,
  mode = 'pve',
  authoritativeTheme = null
} = {}) {
  if (authoritativeTheme !== null) {
    return assertSupportedTheme(authoritativeTheme, 'authoritativeTheme');
  }
  if (mode === 'guild') return 'guild';
  if (mode === 'pvp_coliseum' || nodeType === 'coliseum') return 'arena';
  return assertSupportedTheme(nodeType, 'nodeType');
}

/**
 * Resolve the original tier and the exact catalog selection band. Numeric PvE
 * and guild tiers remain one-to-one; competitive/default bands are explicit.
 */
export function resolveBattleMapV3Tier({
  mode = 'pve',
  difficultyTier = null,
  guildTier = null,
  competitiveBand = null,
  namedDefaultBand = null
} = {}) {
  if (mode === 'pve' || mode === 'pve_coop') {
    const sourceTier = assertTier(difficultyTier, 'difficultyTier');
    return deepFreeze({ sourceTier, selectionBand: `tier-${sourceTier}` });
  }
  if (mode === 'guild') {
    const originalGuildTier = assertTier(guildTier, 'guildTier');
    const sourceTier = GUILD_TIER_TO_BATTLE_TIER[originalGuildTier];
    return deepFreeze({ sourceTier, selectionBand: `tier-${sourceTier}` });
  }
  if (mode === 'pvp' || mode === 'pvp_coliseum') {
    return deepFreeze({
      sourceTier: null,
      selectionBand: assertBand(competitiveBand, 'competitiveBand')
    });
  }
  return deepFreeze({
    sourceTier: null,
    selectionBand: assertBand(namedDefaultBand, 'namedDefaultBand')
  });
}

export function resolveBattleMapV3CapacityBands({
  playerCount,
  opponentCount
}) {
  assertPlainObject({ playerCount, opponentCount }, 'capacity input');
  if (!Number.isSafeInteger(playerCount) || playerCount < 1 || playerCount > 5) {
    throw new TypeError('playerCount must be an integer from 1 through 5');
  }
  if (!Number.isSafeInteger(opponentCount) || opponentCount < 0 || opponentCount > 64) {
    throw new TypeError('opponentCount must be an integer from 0 through 64');
  }
  const opposingRosterCapacityBand = opponentCount === 0
    ? 'opponents-0'
    : opponentCount <= 7
      ? 'opponents-1-7'
      : opponentCount <= 12
        ? 'opponents-8-12'
        : opponentCount <= 24
          ? 'opponents-13-24'
          : 'opponents-25-64';
  return deepFreeze({
    partyCapacityBand: 'players-1-5',
    opposingRosterCapacityBand
  });
}

export function resolveBattleMapV3TeamLayout(mode) {
  if (typeof mode !== 'string' || mode.length === 0) {
    throw new TypeError('mode must be a non-empty string');
  }
  return mode === 'pvp' || mode === 'pvp_coliseum'
    ? 'team-one-vs-team-two'
    : 'players-vs-opponents';
}
