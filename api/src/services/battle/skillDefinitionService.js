/**
 * Skill Definition Service - Skill lookup from skill trees
 */

import { SKILL_TREES } from '../../config/skillTrees.js';
import { MONSTER_SKILL_TREES } from '../../config/monsterSkillTrees.js';
import { scaleSkillAttributes } from '../../config/skillScaling.js';

/**
 * Get skill definition from SKILL_TREES with optional scaling
 * @param {string} unitClass - The unit's class (warrior, wizard, etc.)
 * @param {string} skillId - The skill ID to find
 * @param {number} skillLevel - Optional skill level for scaling (1-100)
 * @param {Object} unit - Optional unit object (for enemies with skills array)
 * @returns {Object|null} Skill definition (scaled if level provided) or null if not found
 */
export function getSkillDefinition(unitClass, skillId, skillLevel = null, unit = null) {
  // First, check if the unit has the skill directly in their skills array
  // This is how enemy units store their skills (from npcSkillService)
  if (unit && unit.skills && Array.isArray(unit.skills)) {
    const unitSkill = unit.skills.find(s => s.id === skillId);
    if (unitSkill) {
      // Unit's skills are already scaled when generated
      return unitSkill;
    }
  }

  // Try player class skill trees
  const classTree = SKILL_TREES[unitClass?.toLowerCase()];
  if (classTree) {
    for (const branch of classTree.branches) {
      const skill = branch.skills.find(s => s.id === skillId);
      if (skill) {
        if (skillLevel && skillLevel > 1) {
          return scaleSkillAttributes(skill, skillLevel);
        }
        return skill;
      }
    }
  }

  // Try monster skill trees (check all archetypes)
  // This handles enemies that use monster archetype skills
  const archetypeToCheck = unit?.archetype || unitClass;
  const archetypeTree = MONSTER_SKILL_TREES[archetypeToCheck?.toLowerCase()];
  if (archetypeTree) {
    for (const branch of archetypeTree.branches) {
      const skill = branch.skills.find(s => s.id === skillId);
      if (skill) {
        if (skillLevel && skillLevel > 1) {
          return scaleSkillAttributes(skill, skillLevel);
        }
        return skill;
      }
    }
  }

  // Fall back: search ALL monster skill trees
  for (const [_archetype, tree] of Object.entries(MONSTER_SKILL_TREES)) {
    for (const branch of tree.branches) {
      const skill = branch.skills.find(s => s.id === skillId);
      if (skill) {
        if (skillLevel && skillLevel > 1) {
          return scaleSkillAttributes(skill, skillLevel);
        }
        return skill;
      }
    }
  }

  return null;
}
