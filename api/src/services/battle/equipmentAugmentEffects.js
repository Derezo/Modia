/**
 * Equipment Augment Effects - Combat-relevant augment effect helpers
 *
 * This module provides utilities for aggregating and looking up combat-relevant
 * augment effects from equipment for use in battle calculations.
 */

/**
 * Combat-relevant augment effect types that are aggregated for battle.
 * These effects directly modify combat behavior (crit, lifesteal, damage bonuses).
 */
export const COMBAT_AUGMENT_EFFECTS = new Set([
  'crit_chance',
  'crit_damage',
  'lifesteal',
  'damage_bonus',
  'physical_attack',
  'magic_defense',
  'physical_defense',
  'damage_reduction',
  'heal_on_hit'
]);

/**
 * Aggregate combat-relevant augment effects from an array of equipped item rows.
 * Each row should have modifications object with augments array.
 *
 * @param {Array<Object>} equipment - Array of equipped item rows
 * @returns {Object} Aggregated augment effects (type -> value)
 */
export function sumEquipmentAugmentEffects(equipment) {
  const effects = {};

  for (const item of equipment) {
    const modifications = typeof item.modifications === 'string'
      ? JSON.parse(item.modifications)
      : item.modifications || {};

    const augments = modifications.augments || [];
    for (const augment of augments) {
      if (!augment?.effect?.type) continue;
      const effectType = augment.effect.type;

      // Only aggregate combat-relevant effects
      if (!COMBAT_AUGMENT_EFFECTS.has(effectType)) continue;

      const effectValue = augment.effect.value || 0;
      effects[effectType] = (effects[effectType] || 0) + effectValue;
    }
  }

  return effects;
}

/**
 * Get a specific augment effect value from a battle unit.
 * Checks equipmentAugmentEffects property if present.
 *
 * @param {Object} unit - Battle unit
 * @param {string} effectType - Effect type (e.g., 'crit_chance', 'lifesteal')
 * @returns {number} Effect value or 0 if not present
 */
export function getEquipmentAugmentEffect(unit, effectType) {
  if (!unit?.equipmentAugmentEffects) return 0;
  return unit.equipmentAugmentEffects[effectType] || 0;
}

/**
 * Load the combat augment effects of every equipped item for a set of
 * characters. Shared by all battle unit builders (PvE start, guildmaster
 * advancement, coliseum) so crit/lifesteal augments apply in every mode.
 *
 * @param {{query: Function}} client - pg client or pool
 * @param {Array<number>} characterIds - Character IDs
 * @returns {Promise<Object<number, Object>>} characterId -> aggregated effects
 */
export async function loadEquipmentAugmentEffects(client, characterIds) {
  const ids = [...new Set((characterIds || []).map(Number))]
    .filter(id => Number.isSafeInteger(id) && id > 0);
  const effectsByCharacter = {};
  for (const id of ids) {
    effectsByCharacter[id] = {};
  }
  if (ids.length === 0) {
    return effectsByCharacter;
  }

  const result = await client.query(
    `SELECT ci.character_id, ci.modifications
     FROM character_items ci
     WHERE ci.character_id = ANY($1::int[]) AND ci.equipped_slot IS NOT NULL`,
    [ids]
  );
  for (const id of ids) {
    effectsByCharacter[id] = sumEquipmentAugmentEffects(
      result.rows.filter(row => Number(row.character_id) === id)
    );
  }
  return effectsByCharacter;
}
