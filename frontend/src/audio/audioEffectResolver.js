import { getSkillSoundKey } from './helpers/audioHelpers.js';
import { SFX_MANIFEST } from './manifests/sfxManifest.js';

export const GENERIC_SKILL_SFX = 'skill_cast';

export const MONSTER_SKILL_SFX_ALIASES = Object.freeze({
  coordinated_strike: 'monster_savage_assault',
  pack_hunter: 'monster_savage_assault',
  dragon_scales: 'monster_stone_skin',
  ancient_presence: 'monster_intimidating_roar',
  relentless_grasp: 'monster_shadow_grasp',
  chain_lightning_monster: 'monster_chain_lightning',
  aimed_shot: 'monster_arrow_shot',
  weaken_curse: 'status_curse',
  fortify_chassis: 'monster_stone_skin',
  taunt_pulse: 'monster_intimidating_roar',
  dark_pact: 'monster_corrupt',
  cocoon: 'monster_web_shot',
  photosynthesis: 'monster_regenerate'
});

export const STATUS_SFX_ALIASES = Object.freeze({
  amplify: 'status_rage',
  berserker: 'status_rage',
  doom: 'status_curse',
  elem_shield: 'status_fortify',
  final_stand: 'status_fortify',
  frenzy: 'status_haste',
  invisible: 'status_haste',
  knockback: 'impact_hit',
  mana_shield: 'status_fortify',
  marked: 'status_curse',
  martyr: 'status_fortify',
  pack_bonus: 'status_rage',
  reckless: 'status_rage',
  root: 'status_slow',
  shadow_arts: 'status_haste',
  transmuted: 'status_corrode'
});

function normalizeEffectId(effectId) {
  return typeof effectId === 'string'
    ? effectId.trim().toLowerCase()
    : '';
}

function uniqueCandidates(candidates) {
  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Return the direct skill key followed by any semantic alias.
 * @param {string} skillId
 * @param {boolean} isMonster
 * @returns {string[]}
 */
export function getSkillSfxCandidates(skillId, isMonster = false) {
  const normalizedId = normalizeEffectId(skillId);
  if (!normalizedId) return [];

  const rawSkillId = normalizedId.replace(/^(?:skill_|monster_)/, '');
  const directKey = getSkillSoundKey(rawSkillId, isMonster);
  const aliasKey = isMonster
    ? MONSTER_SKILL_SFX_ALIASES[rawSkillId]
    : null;

  return uniqueCandidates([directKey, aliasKey]);
}

/**
 * Return the direct status key followed by any semantic alias.
 * @param {string} effectType
 * @returns {string[]}
 */
export function getStatusSfxCandidates(effectType) {
  const normalizedType = normalizeEffectId(effectType);
  if (!normalizedType) return [];

  const rawEffectType = normalizedType.replace(/^status_/, '');
  return uniqueCandidates([
    `status_${rawEffectType}`,
    STATUS_SFX_ALIASES[rawEffectType]
  ]);
}

/**
 * Pick the first candidate registered in the generated SFX manifest.
 * @param {string[]} candidates
 * @param {string} fallback
 * @returns {string}
 */
export function resolveRegisteredSfx(
  candidates,
  fallback = GENERIC_SKILL_SFX
) {
  return candidates.find(candidate =>
    Object.hasOwn(SFX_MANIFEST, candidate)
  ) || fallback;
}

/**
 * Resolve a player or monster skill to a playable SFX key.
 * @param {string} skillId
 * @param {boolean} isMonster
 * @returns {string}
 */
export function resolveSkillSfx(skillId, isMonster = false) {
  return resolveRegisteredSfx(getSkillSfxCandidates(skillId, isMonster));
}

/**
 * Resolve a status effect or self-buff to a playable SFX key.
 * @param {string} effectType
 * @returns {string}
 */
export function resolveStatusSfx(effectType) {
  return resolveRegisteredSfx(getStatusSfxCandidates(effectType));
}
