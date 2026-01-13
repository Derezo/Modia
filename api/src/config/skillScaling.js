/**
 * Skill Scaling Configuration
 *
 * Defines how skill attributes scale with level using linear progression.
 * Formula: scaledValue = baseValue + (level - 1) * increment
 *
 * This module provides:
 * 1. Default scaling increments for each attribute type
 * 2. Helper functions to calculate scaled values
 * 3. Utility to apply scaling to entire skill objects
 */

/**
 * Default scaling increments per level for each attribute type
 * Skills can override these with custom values in their `scaling` property
 */
const DEFAULT_SCALING_CONFIG = {
  // Damage/power scaling: +0.5% per level (150% at L1 -> ~200% at L100)
  power: 0.5,

  // Effect chance scaling: +0.5% per level (caps at 100%)
  effectChance: 0.005,

  // Effect duration scaling: +0.02 turns per level (2 turns at L1 -> ~4 turns at L100)
  effectDuration: 0.02,

  // Range scaling: 0 by default (opt-in only via skill.scaling.range)
  range: 0,

  // AOE radius scaling: 0 by default (opt-in only)
  aoeRadius: 0,

  // Heal percent scaling: +0.1% per level (15% at L1 -> ~25% at L100)
  healPercent: 0.1,

  // MP restore scaling: +0.1% per level
  mpRestore: 0.1,

  // Multi-hit scaling: 0 by default (opt-in only)
  hits: 0,

  // Chain targets scaling: 0 by default (opt-in only)
  chainTargets: 0,

  // Buff duration scaling: +0.02 turns per level
  buffDuration: 0.02
};

/**
 * Calculate a scaled attribute value
 * @param {string} attribute - Attribute name (power, effectChance, etc.)
 * @param {number} baseValue - Base value from skill definition
 * @param {number} level - Current skill level (1-100)
 * @param {number|null} customIncrement - Optional custom increment override
 * @returns {number} Scaled value
 */
function getScaledValue(attribute, baseValue, level, customIncrement = null) {
  if (baseValue === undefined || baseValue === null) return baseValue;
  if (level <= 1) return baseValue;

  const increment = customIncrement ?? DEFAULT_SCALING_CONFIG[attribute] ?? 0;
  return baseValue + (level - 1) * increment;
}

/**
 * Apply scaling to all scalable attributes of a skill
 * @param {object} skill - Skill definition object
 * @param {number} level - Current skill level (1-100)
 * @returns {object} New skill object with scaled attributes
 */
function scaleSkillAttributes(skill, level) {
  if (!skill || level <= 1) return skill;

  const scaled = { ...skill };
  const customScaling = skill.scaling || {};

  // Scale power (damage multiplier)
  if (skill.power !== undefined) {
    scaled.power = Math.round(
      getScaledValue('power', skill.power, level, customScaling.power) * 10
    ) / 10;
  }

  // Scale effect chance (cap at 100%)
  if (skill.effectChance !== undefined) {
    scaled.effectChance = Math.min(
      1.0,
      getScaledValue('effectChance', skill.effectChance, level, customScaling.effectChance)
    );
  }

  // Scale effect duration (floor to whole turns for most cases)
  if (skill.effectDuration !== undefined) {
    const rawDuration = getScaledValue(
      'effectDuration',
      skill.effectDuration,
      level,
      customScaling.effectDuration
    );
    scaled.effectDuration = Math.floor(rawDuration);
  }

  // Scale heal percent
  if (skill.healPercent !== undefined) {
    scaled.healPercent = Math.round(
      getScaledValue('healPercent', skill.healPercent, level, customScaling.healPercent) * 10
    ) / 10;
  }

  // Scale MP restore
  if (skill.mpRestore !== undefined) {
    scaled.mpRestore = Math.round(
      getScaledValue('mpRestore', skill.mpRestore, level, customScaling.mpRestore) * 10
    ) / 10;
  }

  // Scale buff duration
  if (skill.buffDuration !== undefined) {
    const rawDuration = getScaledValue(
      'buffDuration',
      skill.buffDuration,
      level,
      customScaling.buffDuration
    );
    scaled.buffDuration = Math.floor(rawDuration);
  }

  // Scale range (opt-in only, floor to whole tiles)
  if (skill.range !== undefined && customScaling.range) {
    scaled.range = Math.floor(
      getScaledValue('range', skill.range, level, customScaling.range)
    );
  }

  // Scale AOE radius (opt-in only, floor to whole tiles)
  if (skill.aoeRadius !== undefined && customScaling.aoeRadius) {
    scaled.aoeRadius = Math.floor(
      getScaledValue('aoeRadius', skill.aoeRadius, level, customScaling.aoeRadius)
    );
  }

  // Scale multi-hit count (opt-in only)
  if (skill.hits !== undefined && customScaling.hits) {
    scaled.hits = Math.floor(
      getScaledValue('hits', skill.hits, level, customScaling.hits)
    );
  }

  // Scale chain targets (opt-in only)
  if (skill.chainTargets !== undefined && customScaling.chainTargets) {
    scaled.chainTargets = Math.floor(
      getScaledValue('chainTargets', skill.chainTargets, level, customScaling.chainTargets)
    );
  }

  // Add current level to the skill for reference
  scaled.currentLevel = level;

  return scaled;
}

/**
 * Preview skill attributes at a different level (for UI display)
 * @param {object} skill - Skill definition object
 * @param {number} currentLevel - Current skill level
 * @param {number} previewLevel - Level to preview
 * @returns {object} Comparison object with current and preview values
 */
function getSkillScalingPreview(skill, currentLevel, previewLevel) {
  const current = scaleSkillAttributes(skill, currentLevel);
  const preview = scaleSkillAttributes(skill, previewLevel);

  const comparison = {};
  const scalableAttributes = [
    'power',
    'effectChance',
    'effectDuration',
    'healPercent',
    'mpRestore',
    'buffDuration',
    'range',
    'aoeRadius',
    'hits',
    'chainTargets'
  ];

  for (const attr of scalableAttributes) {
    if (skill[attr] !== undefined) {
      comparison[attr] = {
        current: current[attr],
        preview: preview[attr],
        improved: preview[attr] > current[attr]
      };
    }
  }

  return {
    skill: skill.id,
    currentLevel,
    previewLevel,
    attributes: comparison
  };
}

/**
 * Get the total scaling bonus from level 1 to max level
 * Useful for tooltip displays
 * @param {object} skill - Skill definition object
 * @param {number} maxLevel - Max skill level (default 100)
 * @returns {object} Total bonus for each attribute
 */
function getTotalScalingBonus(skill, maxLevel = 100) {
  const base = scaleSkillAttributes(skill, 1);
  const max = scaleSkillAttributes(skill, maxLevel);

  const bonus = {};
  const attributes = ['power', 'effectChance', 'effectDuration', 'healPercent', 'range', 'aoeRadius'];

  for (const attr of attributes) {
    if (skill[attr] !== undefined && base[attr] !== undefined) {
      bonus[attr] = {
        base: base[attr],
        max: max[attr],
        totalBonus: max[attr] - base[attr]
      };
    }
  }

  return bonus;
}

export {
  DEFAULT_SCALING_CONFIG,
  getScaledValue,
  scaleSkillAttributes,
  getSkillScalingPreview,
  getTotalScalingBonus
};
