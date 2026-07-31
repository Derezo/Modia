/**
 * Fishing content and balance catalog.
 *
 * FISH_TYPES intentionally remains the original 15-entry catalog for legacy
 * sessions. New gameplay resolves catches through the regional catalogs below.
 */

import { getTackleByKey } from './fishingGear.js';
export {
  RODS,
  TACKLE,
  getRodByKey,
  getTackleByKey
} from './fishingGear.js';

const LEGACY_FISH = [
  { id: 'bass', name: 'Bass', rarity: 'common', baseValue: 2, description: 'A common freshwater fish.' },
  { id: 'carp', name: 'Carp', rarity: 'common', baseValue: 3, description: 'Hardy and plentiful.' },
  { id: 'trout', name: 'Trout', rarity: 'common', baseValue: 3, description: 'Popular among fishers.' },
  { id: 'perch', name: 'Perch', rarity: 'common', baseValue: 2, description: 'A striped lake dweller.' },
  { id: 'bream', name: 'Bream', rarity: 'common', baseValue: 2, description: 'Flat and silvery.' },
  { id: 'salmon', name: 'Salmon', rarity: 'uncommon', baseValue: 6, description: 'Pink-fleshed and prized.' },
  { id: 'pike', name: 'Pike', rarity: 'uncommon', baseValue: 5, description: 'A fierce predator.' },
  { id: 'catfish', name: 'Catfish', rarity: 'uncommon', baseValue: 4, description: 'Whiskered bottom-dweller.' },
  { id: 'eel', name: 'Eel', rarity: 'uncommon', baseValue: 5, description: 'Slippery and elusive.' },
  { id: 'golden_koi', name: 'Golden Koi', rarity: 'rare', baseValue: 16, description: 'Symbol of good fortune.' },
  { id: 'electric_eel', name: 'Electric Eel', rarity: 'rare', baseValue: 15, description: 'Crackling with energy.' },
  { id: 'moonfish', name: 'Moonfish', rarity: 'rare', baseValue: 15, description: 'Glows faintly in darkness.' },
  { id: 'sea_dragon', name: 'Sea Dragon', rarity: 'epic', baseValue: 50, description: 'Mythical serpent of the deep.' },
  { id: 'ancient_carp', name: 'Ancient Carp', rarity: 'epic', baseValue: 45, description: 'Said to be centuries old.' },
  { id: 'leviathan_scale', name: 'Leviathan Scale', rarity: 'legendary', baseValue: 120, description: 'A scale from the great sea beast.' }
];

const REGIONAL_FISH = [
  { id: 'blind_cavefish', name: 'Blind Cavefish', rarity: 'common', baseValue: 3, description: 'A pale fish adapted to lightless waters.' },
  { id: 'crystal_sturgeon', name: 'Crystal Sturgeon', rarity: 'epic', baseValue: 45, description: 'Its armored scales sparkle like cavern crystal.' },
  { id: 'dusk_bream', name: 'Dusk Bream', rarity: 'common', baseValue: 3, description: 'A dark-scaled bream found in still marsh water.' },
  { id: 'bloodfin', name: 'Bloodfin', rarity: 'uncommon', baseValue: 5, description: 'Its vivid fins cut through blackwater.' },
  { id: 'ash_perch', name: 'Ash Perch', rarity: 'common', baseValue: 2, description: 'A hardy perch dusted in volcanic gray.' },
  { id: 'ember_koi', name: 'Ember Koi', rarity: 'rare', baseValue: 15, description: 'Warm scales glow like banked coals.' },
  { id: 'ironjaw_sturgeon', name: 'Ironjaw Sturgeon', rarity: 'epic', baseValue: 45, description: 'A massive sturgeon with a plated jaw.' }
];

export const FISH_TYPES = Object.freeze(LEGACY_FISH.map(fish => Object.freeze(fish)));
export const ALL_FISH_TYPES = Object.freeze(
  [...LEGACY_FISH, ...REGIONAL_FISH].map(fish => Object.freeze(fish))
);

const FISH_BY_ID = new Map(ALL_FISH_TYPES.map(fish => [fish.id, fish]));

// Legacy auto-fishing weights retained for the one-release compatibility path.
export const RARITY_WEIGHTS = Object.freeze({
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1
});

export const NORMAL_RARITY_WEIGHTS = Object.freeze({
  near: Object.freeze({ common: 80, uncommon: 19, rare: 1 }),
  mid: Object.freeze({ common: 60, uncommon: 32, rare: 7, epic: 1 }),
  deep: Object.freeze({ common: 45, uncommon: 40, rare: 14, epic: 1 })
});

export const BIG_CATCH_RARITY_WEIGHTS = Object.freeze({
  rare: 70,
  epic: 25,
  legendary: 5
});

export const FISHING_CONFIG = Object.freeze({
  castPowerDurationMs: 1600,
  waitMinMs: 35000,
  waitMaxMs: 65000,
  minimumWaitMs: 8000,
  biteWindowMs: 3000,
  bigCatchChance: 0.20,
  bigCatchValueBonus: 2,
  normalSizeMultiplierMin: 0.8,
  normalSizeMultiplierMax: 1.5,
  bigCatchSizeMultiplierMin: 1.3,
  bigCatchSizeMultiplierMax: 1.7,
  difficultyValueBonusPerTier: 0.05,
  normalReel: Object.freeze({ cueCount: 3, requiredHits: 2, durationMs: 6000 }),
  deepReel: Object.freeze({ cueCount: 4, requiredHits: 3, durationMs: 8000 }),
  maxSessionDuration: 30 * 60 * 1000,

  // Legacy names consumed by the old client/service during the transition.
  minCatchInterval: 35000,
  maxCatchInterval: 65000,
  catchCooldown: 15000,
  bigOneChance: 0.20,
  bigOneWindowMs: 3000,
  bigOneBonus: 2,
  sizeMultiplierMin: 0.8,
  sizeMultiplierMax: 1.5
});

const BIOME_ALIASES = Object.freeze({
  heartlands: 'heartlands',
  heartland: 'heartlands',
  human: 'heartlands',
  sylvan_reaches: 'sylvan_reaches',
  sylvan: 'sylvan_reaches',
  elf: 'sylvan_reaches',
  iron_depths: 'iron_depths',
  iron: 'iron_depths',
  dwarf: 'iron_depths',
  shadowmere: 'shadowmere',
  vampire: 'shadowmere',
  bloodplains: 'bloodplains',
  blood_plains: 'bloodplains',
  orc: 'bloodplains',
  common_waters: 'common_waters'
});

export const DEFAULT_FISHING_BIOME = 'common_waters';

export const REGION_FISH_POOLS = Object.freeze({
  heartlands: Object.freeze([
    'bass', 'carp', 'bream', 'pike', 'golden_koi', 'ancient_carp', 'leviathan_scale'
  ]),
  sylvan_reaches: Object.freeze([
    'trout', 'perch', 'salmon', 'golden_koi', 'moonfish', 'sea_dragon', 'leviathan_scale'
  ]),
  iron_depths: Object.freeze([
    'blind_cavefish', 'catfish', 'eel', 'electric_eel', 'crystal_sturgeon',
    'ancient_carp', 'leviathan_scale'
  ]),
  shadowmere: Object.freeze([
    'dusk_bream', 'eel', 'bloodfin', 'moonfish', 'electric_eel',
    'sea_dragon', 'leviathan_scale'
  ]),
  bloodplains: Object.freeze([
    'ash_perch', 'carp', 'pike', 'ember_koi', 'ironjaw_sturgeon',
    'sea_dragon', 'leviathan_scale'
  ]),
  common_waters: Object.freeze([
    'bass', 'trout', 'carp', 'pike', 'salmon', 'golden_koi',
    'ancient_carp', 'leviathan_scale'
  ])
});

function normalizeRandom(random) {
  const value = Number(typeof random === 'function' ? random() : Math.random());
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

function selectWeightedRarity(weights, random) {
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  let roll = normalizeRandom(random) * total;

  for (const [rarity, weight] of Object.entries(weights)) {
    if (roll < weight) return rarity;
    roll -= weight;
  }

  return Object.keys(weights)[0];
}

export function normalizeBiome(regionRace) {
  if (typeof regionRace !== 'string') return DEFAULT_FISHING_BIOME;
  const key = regionRace.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return BIOME_ALIASES[key] || DEFAULT_FISHING_BIOME;
}

export const resolveBiome = normalizeBiome;

export function normalizeDepth(depth) {
  if (typeof depth !== 'string') return 'near';
  const normalized = depth.trim().toLowerCase();
  return Object.hasOwn(NORMAL_RARITY_WEIGHTS, normalized) ? normalized : 'near';
}

export function getPublicFishPool(biome) {
  const normalizedBiome = normalizeBiome(biome);
  return REGION_FISH_POOLS[normalizedBiome].map(fishId => {
    const fish = FISH_BY_ID.get(fishId);
    const depths = Object.entries(NORMAL_RARITY_WEIGHTS)
      .filter(([, weights]) => Object.hasOwn(weights, fish.rarity))
      .map(([depth]) => depth);

    return {
      id: fish.id,
      name: fish.name,
      rarity: fish.rarity,
      baseValue: fish.baseValue,
      depths,
      bigCatchOnly: fish.rarity === 'legendary'
    };
  });
}

export function selectFishForCatch({
  biome,
  depth = 'near',
  isBigCatch = false,
  random = Math.random
} = {}) {
  const normalizedBiome = normalizeBiome(biome);
  const poolIds = REGION_FISH_POOLS[normalizedBiome];
  const weights = isBigCatch
    ? BIG_CATCH_RARITY_WEIGHTS
    : NORMAL_RARITY_WEIGHTS[normalizeDepth(depth)];
  const rarity = selectWeightedRarity(weights, random);
  const candidates = poolIds
    .map(fishId => FISH_BY_ID.get(fishId))
    .filter(fish => fish.rarity === rarity);

  if (candidates.length === 0) {
    throw new Error(`Fishing pool ${normalizedBiome} has no ${rarity} fish`);
  }

  return candidates[Math.floor(normalizeRandom(random) * candidates.length)];
}

export function rollFishSizeMultiplier(isBigCatch = false, random = Math.random) {
  const min = isBigCatch
    ? FISHING_CONFIG.bigCatchSizeMultiplierMin
    : FISHING_CONFIG.normalSizeMultiplierMin;
  const max = isBigCatch
    ? FISHING_CONFIG.bigCatchSizeMultiplierMax
    : FISHING_CONFIG.normalSizeMultiplierMax;
  return min + normalizeRandom(random) * (max - min);
}

export function getDifficultyValueMultiplier(difficultyTier = 1) {
  const tier = Math.max(1, Math.floor(Number(difficultyTier) || 1));
  return 1 + ((tier - 1) * FISHING_CONFIG.difficultyValueBonusPerTier);
}

export function calculateFishValue(
  fish,
  sizeMultiplier = 1,
  isBigCatch = false,
  difficultyTier = 1
) {
  const bigCatchMultiplier = isBigCatch ? FISHING_CONFIG.bigCatchValueBonus : 1;
  return Math.floor(
    fish.baseValue
    * sizeMultiplier
    * bigCatchMultiplier
    * getDifficultyValueMultiplier(difficultyTier)
  );
}

export function getWaitDurationMs(
  tackleKey = null,
  random = Math.random,
  waitReductionSnapshot = null
) {
  const baseWait = FISHING_CONFIG.waitMinMs
    + (normalizeRandom(random) * (FISHING_CONFIG.waitMaxMs - FISHING_CONFIG.waitMinMs));
  const catalogReduction = getTackleByKey(tackleKey)?.waitReduction ?? 0;
  const hasSnapshot =
    waitReductionSnapshot !== null &&
    waitReductionSnapshot !== undefined &&
    Number.isFinite(Number(waitReductionSnapshot));
  const reduction = hasSnapshot
    ? Math.max(0, Math.min(1, Number(waitReductionSnapshot)))
    : catalogReduction;
  return Math.max(
    FISHING_CONFIG.minimumWaitMs,
    Math.round(baseWait * (1 - reduction))
  );
}

/**
 * Legacy global-pool selector retained until the old endpoints are removed.
 */
export function selectRandomFish(random = Math.random) {
  const rarity = selectWeightedRarity(RARITY_WEIGHTS, random);
  const candidates = FISH_TYPES.filter(fish => fish.rarity === rarity);
  return candidates[Math.floor(normalizeRandom(random) * candidates.length)];
}

export function getFishById(fishId) {
  return FISH_BY_ID.get(fishId) || null;
}
