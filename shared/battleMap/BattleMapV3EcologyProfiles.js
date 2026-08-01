import { deepFreeze } from './canonicalJson.js';
import {
  BATTLE_MAP_V3_SUPPORTED_THEMES
} from './BattleMapV3Resolvers.js';

const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;

const profilesByTheme = {
  forest: [
    'forest-temperate-woodland',
    'forest-heartlands-woodland',
    'forest-sylvan-ancient-grove',
    'forest-shadowmere-gloomwood',
    'forest-iron-depths-borderwood'
  ],
  cave: [
    'cave-limestone',
    'cave-iron-depths-granite',
    'cave-shadowmere-crypt'
  ],
  mountain: [
    'mountain-granite',
    'mountain-bloodplains-red-crag'
  ],
  bridge: ['bridge-stone-crossing'],
  castle: ['castle-fortress', 'palace-grand-palace'],
  dungeon: ['dungeon-subterranean'],
  swamp: ['swamp-wetlands'],
  volcano: ['volcano-caldera'],
  plains: ['plains-grassland'],
  arena: ['arena-coliseum'],
  guild: ['guild-guildhall'],
  elven_grove: ['forest-sylvan-ancient-grove'],
  dwarven_mine: ['cave-iron-depths-granite'],
  vampiric_crypt: ['cave-shadowmere-crypt'],
  orcish_warcamp: ['mountain-bloodplains-red-crag'],
  human_ruins: ['human-heartlands-ruins']
};

const matrixThemes = Object.keys(profilesByTheme);
if (
  matrixThemes.length !== BATTLE_MAP_V3_SUPPORTED_THEMES.length
  || matrixThemes.some(
    (theme, index) => theme !== BATTLE_MAP_V3_SUPPORTED_THEMES[index]
  )
) {
  throw new Error(
    'BattleMapV3 ecology profiles must exactly match supported themes'
  );
}
for (const [theme, profiles] of Object.entries(profilesByTheme)) {
  if (
    profiles.length === 0
    || profiles.some(profile => !SAFE_ID_PATTERN.test(profile))
    || new Set(profiles).size !== profiles.length
  ) {
    throw new Error(
      `BattleMapV3 ecology profiles for ${theme} must be non-empty, unique safe IDs`
    );
  }
}

/**
 * The complete ecology inventory eligible for newly selected BattleMapV3
 * content. Array order is authoritative: the first profile is each theme's
 * coarse fallback, followed by its regional variants.
 */
export const BATTLE_MAP_V3_ECOLOGY_PROFILES_BY_THEME =
  deepFreeze(profilesByTheme);
