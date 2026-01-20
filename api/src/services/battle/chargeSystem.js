/**
 * Charge System - Charge time mechanics for MP skills
 *
 * Base CT = MP cost * 2, reduced by agility, intelligence, and skill level
 */

/**
 * Calculate charge time for an MP skill
 * Base CT = MP cost * 2, reduced by agility, intelligence, and skill level
 * @param {Object} unit - The unit using the skill
 * @param {Object} skill - The skill being used
 * @returns {number} Charge time in CT ticks (10-50)
 */
export function calculateChargeTime(unit, skill) {
  if (!skill.mpCost || skill.mpCost <= 0) return 0;

  const baseCT = skill.mpCost * 2;
  const agilityBonus = Math.floor((unit.agility || 10) / 10);
  const intBonus = Math.floor((unit.intelligence || 10) / 10);
  const levelBonus = ((skill.level || 1) - 1) * 2;

  const chargeTime = baseCT - agilityBonus - intBonus - levelBonus;

  // Clamp between 10 and 50
  return Math.max(10, Math.min(50, chargeTime));
}

/**
 * Check if a charging skill is interrupted when the unit takes damage
 * @returns {boolean} True if the skill is interrupted (10% chance)
 */
export function checkChargeInterrupt() {
  return Math.random() < 0.10;
}

/**
 * Get damage multiplier for physical damage against a charging unit
 * @returns {number} Damage multiplier (1.25 = 25% extra damage)
 */
export function getChargingDamageMultiplier() {
  return 1.25;
}

/**
 * Start charging a skill for a unit
 * @param {Object} unit - The unit starting to charge
 * @param {string} skillId - The skill being charged
 * @param {Object} targetTile - The target tile for the skill
 * @param {number} chargeTime - The charge time in CT ticks
 */
export function startCharging(unit, skillId, targetTile, chargeTime) {
  unit.isCharging = true;
  unit.chargingSkill = {
    skillId,
    targetTile,
    chargeTime,
    chargeRemaining: chargeTime
  };
  unit.chargeStartCT = unit.ct;
}

/**
 * Cancel a charging skill (due to interrupt or death)
 * @param {Object} unit - The unit whose charge to cancel
 */
export function cancelCharging(unit) {
  unit.isCharging = false;
  unit.chargingSkill = null;
  unit.chargeStartCT = null;
}

/**
 * Update charge progress when CT advances
 * Returns true if charge is complete and ready to execute
 * @param {Object} unit - The charging unit
 * @param {number} ctAdvanced - Amount of CT advanced
 * @returns {boolean} True if charge is complete
 */
export function updateChargeProgress(unit, ctAdvanced) {
  if (!unit.isCharging || !unit.chargingSkill) return false;

  unit.chargingSkill.chargeRemaining -= ctAdvanced;

  if (unit.chargingSkill.chargeRemaining <= 0) {
    return true; // Charge complete
  }

  return false;
}
