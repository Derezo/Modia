/**
 * Skill Definition Service
 *
 * This module is the canonical boundary between learned/persisted skill records
 * and the complete skill objects stored in battle state. Persisted records only
 * need an id and level; mechanics and presentation stay sourced from the skill
 * trees so adding a field to a definition cannot be silently lost by a route.
 */

import { SKILL_TREES } from '../../config/skillTrees.js';
import { MONSTER_SKILL_TREES } from '../../config/monsterSkillTrees.js';
import { scaleSkillAttributes } from '../../config/skillScaling.js';

function findSkillInTree(tree, skillId) {
  if (!tree?.branches || !skillId) return null;

  for (const branch of tree.branches) {
    const skill = branch.skills?.find(candidate => candidate.id === skillId);
    if (skill) return skill;
  }

  return null;
}

function findStaticSkillDefinition(unitClass, skillId, unit, includeGlobalFallback = true) {
  const normalizedClass = unitClass?.toLowerCase();
  const playerSkill = findSkillInTree(SKILL_TREES[normalizedClass], skillId);
  if (playerSkill) return playerSkill;

  const normalizedArchetype = (unit?.archetype || unitClass)?.toLowerCase();
  const archetypeSkill = findSkillInTree(MONSTER_SKILL_TREES[normalizedArchetype], skillId);
  if (archetypeSkill) return archetypeSkill;

  // Advanced characters retain learned skills from earlier classes. Resolve by
  // stable id when the current class tree does not own that inherited skill.
  if (includeGlobalFallback) {
    for (const tree of Object.values(SKILL_TREES)) {
      const skill = findSkillInTree(tree, skillId);
      if (skill) return skill;
    }

    for (const tree of Object.values(MONSTER_SKILL_TREES)) {
      const skill = findSkillInTree(tree, skillId);
      if (skill) return skill;
    }
  }

  return null;
}

function cloneSerializable(value) {
  if (Array.isArray(value)) {
    return value.map(cloneSerializable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, cloneSerializable(nestedValue)])
    );
  }
  return value;
}

function normalizeLearnedSkill(learnedSkill) {
  if (typeof learnedSkill === 'string') {
    return { id: learnedSkill, level: 1 };
  }

  const record = learnedSkill || {};
  return {
    id: record.id ?? record.skillId ?? record.skill_id,
    level: record.level ?? record.skillLevel ?? record.skill_level ?? 1
  };
}

/**
 * Get a complete skill definition with optional level scaling.
 *
 * Unit-local skills may contain custom or pre-scaled values. When a matching
 * tree definition exists, it fills fields omitted by that local copy (element,
 * targeting, effects, visuals, and so on), while the local values retain
 * precedence for backwards compatibility with generated enemies.
 *
 * @param {string} unitClass - The unit's class (warrior, wizard, etc.)
 * @param {string} skillId - The skill ID to find
 * @param {number} skillLevel - Optional skill level for scaling (1-100)
 * @param {Object} unit - Optional unit object with local/pre-scaled skills
 * @returns {Object|null} Complete skill definition, or null when unknown
 */
export function getSkillDefinition(unitClass, skillId, skillLevel = null, unit = null) {
  const unitSkill = Array.isArray(unit?.skills)
    ? unit.skills.find(skill => skill.id === skillId)
    : null;

  // Do not enrich a genuinely custom local skill from an unrelated monster
  // definition that merely happens to share its id.
  const staticSkill = findStaticSkillDefinition(
    unitClass,
    skillId,
    unit,
    !unitSkill || unit?.type === 'player'
  );

  const scaledStaticSkill = staticSkill && skillLevel && skillLevel > 1
    ? scaleSkillAttributes(staticSkill, skillLevel)
    : staticSkill;

  if (unitSkill) {
    // Unit-local values are already scaled for generated enemies and must win;
    // the source definition only restores mechanics stripped by old DTOs.
    return scaledStaticSkill
      ? { ...scaledStaticSkill, ...unitSkill }
      : unitSkill;
  }

  return scaledStaticSkill || null;
}

/**
 * Serialize a complete skill definition for battle state/API transport.
 *
 * The definition is copied wholesale rather than projected through an allow
 * list. This intentionally preserves all current and future mechanics and
 * presentation fields, including nested animation/effect configuration.
 * Compatibility defaults use nullish checks so meaningful zero values (free
 * skills, self range, non-damaging abilities) survive unchanged.
 *
 * @param {Object} skillDefinition - Complete source definition
 * @param {Object} identity - Learned identity ({ id, level })
 * @returns {Object|null} Canonical battle skill DTO
 */
export function serializeBattleSkill(skillDefinition, identity = {}) {
  if (!skillDefinition) return null;

  const skill = cloneSerializable(skillDefinition);
  const id = identity.id ?? skill.id;
  if (!id) return null;

  const targetSelf = skill.targetSelf === true || skill.selfBuff != null || skill.cleanse === true;
  const isHealing = skill.healPercent != null || skill.healing != null;

  return {
    ...skill,
    id,
    level: identity.level ?? skill.level ?? skill.currentLevel ?? 1,
    type: skill.type ?? 'active',
    damageType: skill.damageType ?? 'physical',
    mpCost: skill.mpCost ?? 0,
    power: skill.power ?? 0,
    range: skill.range ?? (targetSelf ? 0 : 1),
    aoeRadius: skill.aoeRadius ?? 0,
    cooldown: skill.cooldown ?? 0,
    description: skill.description ?? '',
    visualCategory: skill.visualCategory
      ?? skill.element
      ?? (isHealing ? 'healing' : (skill.damageType ?? 'physical')),
    icon: skill.icon ?? null
  };
}

/**
 * Resolve a learned record ({id/skill_id, level}) into a canonical battle DTO.
 *
 * @param {string} unitClass - Owning class/archetype
 * @param {Object|string} learnedSkill - Learned skill record or id
 * @param {Object|null} unit - Optional unit with custom/pre-scaled skills
 * @returns {Object|null} Canonical battle skill DTO
 */
export function resolveBattleSkill(unitClass, learnedSkill, unit = null) {
  const identity = normalizeLearnedSkill(learnedSkill);
  if (!identity.id) return null;

  const definition = getSkillDefinition(unitClass, identity.id, identity.level, unit);
  return serializeBattleSkill(definition, identity);
}

/**
 * Resolve a collection of learned records, omitting unknown skill ids.
 */
export function resolveBattleSkills(unitClass, learnedSkills = [], unit = null) {
  if (!Array.isArray(learnedSkills)) return [];

  return learnedSkills
    .map(skill => resolveBattleSkill(unitClass, skill, unit))
    .filter(Boolean);
}
