/**
 * Skill classification shared by the battle runtime (actionProcessor) and the
 * AI simulator (ai/cache.js), so the two agree on which skills are offensive.
 *
 * In particular, the caster of an offensive AoE is excluded from its own area
 * when the skill deals damage OR applies a hostile status (smoke_bomb blind,
 * roar fear, ancient_presence weaken, ...). Before this module the runtime
 * checked damage only, so power-0 hostile AoEs debuffed their own caster while
 * the AI scored them as free of self-effects.
 */

/** A skill with a damaging component aimed at enemies. */
export function hasOffensiveSkillComponent(skill) {
  return Number(skill?.power) > 0 &&
    skill?.targetSelf !== true &&
    skill?.targetAlly !== true &&
    skill?.targetAllAllies !== true &&
    skill?.damageType !== 'support' &&
    skill?.damageType !== 'heal' &&
    skill?.effect !== 'heal';
}

export function getSkillBuffEffect(skill) {
  if (typeof skill?.selfBuff === 'string') return skill.selfBuff;
  if (skill?.selfBuff && typeof skill.selfBuff === 'object') {
    return skill.selfBuff.type || `${skill.id || 'skill'}_buff`;
  }
  if (skill?.effect && skill.effect !== 'heal') return skill.effect;
  return null;
}

export function isSkillEffectHandledAsBuff(skill) {
  return Boolean(skill?.selfBuff) &&
    skill.effect === getSkillBuffEffect(skill);
}

/** A skill whose status effect is meant for enemies (blind, fear, weaken...). */
export function hasHostileStatusSkillComponent(skill) {
  if (!skill?.effect || skill.effect === 'heal' ||
      isSkillEffectHandledAsBuff(skill) ||
      skill.targetSelf === true ||
      skill.targetAlly === true ||
      skill.targetAllAllies === true) {
    return false;
  }

  if (!hasOffensiveSkillComponent(skill) &&
      (skill.selfBuff || skill.cleanse || skill.mpRestore > 0 ||
       skill.healPercent > 0 || skill.damageType === 'heal')) {
    return false;
  }

  return true;
}

/**
 * Whether an AoE skill's caster is left out of its own area: any offensive
 * AoE (damage or hostile status) unless the skill explicitly includes self.
 */
export function excludesCasterFromAoE(skill) {
  return (hasOffensiveSkillComponent(skill) || hasHostileStatusSkillComponent(skill)) &&
    !skill?.includesSelf;
}
