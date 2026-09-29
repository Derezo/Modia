/**
 * Equipment Stats Service
 *
 * Shared helper for calculating equipment stat totals.
 *
 * Generated items store stats in modifications:
 * - modifications.baseStats: rarity/level scaled template stats
 * - modifications.bonusStats: augment-added stats
 *
 * Legacy items without modifications use template stat_bonuses directly.
 *
 * HP/MP normalization: templates use hp_max/mp_max keys, but battle/character
 * systems expect hp/mp. This module normalizes both.
 */

/**
 * All stat keys tracked by the equipment system.
 * hp_max and mp_max are normalized to hp and mp in output.
 */
export const EQUIPMENT_STAT_KEYS = [
  'strength',
  'intelligence',
  'agility',
  'vitality',
  'luck',
  'hp',
  'hp_max',
  'mp',
  'mp_max',
  'attack',
  'defense',
  'magic_attack',
  'magicAttack',
  'magic_defense',
  'magicDefense'
];

/**
 * Normalized output keys after mapping.
 */
export const NORMALIZED_STAT_KEYS = [
  'strength',
  'intelligence',
  'agility',
  'vitality',
  'luck',
  'hp',
  'mp',
  'attack',
  'defense',
  'magicAttack',
  'magicDefense'
];

/**
 * Generate the SQL LATERAL subquery for equipment stat aggregation.
 * This properly handles:
 * - Generated items: COALESCE(modifications->'baseStats', template stat_bonuses)
 * - Augment stats: adds modifications->'bonusStats'
 * - HP/MP normalization: maps hp_max to hp, mp_max to mp
 * - Legacy top-level modification keys for backwards compatibility
 *
 * @returns {string} SQL subquery text for use in LATERAL JOIN
 */
export function buildEquipmentStatsLateral() {
  // For each stat, we need:
  // 1. Base stat = COALESCE(modifications->'baseStats'->>'stat', stat_bonuses->>'stat', 0)
  // 2. Bonus stat = COALESCE(modifications->'bonusStats'->>'stat', 0)
  // 3. Legacy = COALESCE(modifications->>'stat', 0) for backwards compat with old top-level keys
  //
  // HP/MP special handling:
  // - Template uses hp_max/mp_max
  // - Battle expects hp/mp
  // - Sum both variants and normalize to hp/mp

  return `
    SELECT
      -- Core stats: prefer baseStats over template, add bonusStats and legacy
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'strength')::int, (it.stat_bonuses->>'strength')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'strength')::int, 0) +
        COALESCE((ci.modifications->>'strength')::int, 0)
      ) as equip_strength,
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'intelligence')::int, (it.stat_bonuses->>'intelligence')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'intelligence')::int, 0) +
        COALESCE((ci.modifications->>'intelligence')::int, 0)
      ) as equip_intelligence,
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'agility')::int, (it.stat_bonuses->>'agility')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'agility')::int, 0) +
        COALESCE((ci.modifications->>'agility')::int, 0)
      ) as equip_agility,
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'vitality')::int, (it.stat_bonuses->>'vitality')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'vitality')::int, 0) +
        COALESCE((ci.modifications->>'vitality')::int, 0)
      ) as equip_vitality,
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'luck')::int, (it.stat_bonuses->>'luck')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'luck')::int, 0) +
        COALESCE((ci.modifications->>'luck')::int, 0)
      ) as equip_luck,
      -- HP: sum hp and hp_max from all sources, normalize to hp
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'hp')::int, (it.stat_bonuses->>'hp')::int, 0) +
        COALESCE((ci.modifications->'baseStats'->>'hp_max')::int, (it.stat_bonuses->>'hp_max')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'hp')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'hp_max')::int, 0) +
        COALESCE((ci.modifications->>'hp')::int, 0) +
        COALESCE((ci.modifications->>'hp_max')::int, 0)
      ) as equip_hp,
      -- MP: sum mp and mp_max from all sources, normalize to mp
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'mp')::int, (it.stat_bonuses->>'mp')::int, 0) +
        COALESCE((ci.modifications->'baseStats'->>'mp_max')::int, (it.stat_bonuses->>'mp_max')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'mp')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'mp_max')::int, 0) +
        COALESCE((ci.modifications->>'mp')::int, 0) +
        COALESCE((ci.modifications->>'mp_max')::int, 0)
      ) as equip_mp,
      -- Combat stats
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'attack')::int, (it.stat_bonuses->>'attack')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'attack')::int, 0) +
        COALESCE((ci.modifications->>'attack')::int, 0)
      ) as equip_attack,
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'defense')::int, (it.stat_bonuses->>'defense')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'defense')::int, 0) +
        COALESCE((ci.modifications->>'defense')::int, 0)
      ) as equip_defense,
      -- Magic attack: handle both snake_case and camelCase
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'magic_attack')::int, (it.stat_bonuses->>'magic_attack')::int, 0) +
        COALESCE((ci.modifications->'baseStats'->>'magicAttack')::int, (it.stat_bonuses->>'magicAttack')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'magic_attack')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'magicAttack')::int, 0) +
        COALESCE((ci.modifications->>'magic_attack')::int, 0) +
        COALESCE((ci.modifications->>'magicAttack')::int, 0)
      ) as equip_magic_attack,
      -- Magic defense: handle both snake_case and camelCase
      SUM(
        COALESCE((ci.modifications->'baseStats'->>'magic_defense')::int, (it.stat_bonuses->>'magic_defense')::int, 0) +
        COALESCE((ci.modifications->'baseStats'->>'magicDefense')::int, (it.stat_bonuses->>'magicDefense')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'magic_defense')::int, 0) +
        COALESCE((ci.modifications->'bonusStats'->>'magicDefense')::int, 0) +
        COALESCE((ci.modifications->>'magic_defense')::int, 0) +
        COALESCE((ci.modifications->>'magicDefense')::int, 0)
      ) as equip_magic_defense
    FROM character_items ci
    JOIN item_templates it ON ci.item_template_id = it.id
    WHERE ci.character_id = c.id AND ci.equipped_slot IS NOT NULL
  `;
}

/**
 * Calculate equipment bonuses from an array of equipped item rows.
 * Each row should have: stat_bonuses (from template), modifications (from character_items).
 *
 * This is the JS equivalent of buildEquipmentStatsLateral for use when
 * equipment rows are already loaded (e.g., guildmasterBattleService).
 *
 * @param {Array<Object>} equipment - Array of equipped item rows
 * @returns {Object} Aggregated equipment bonuses with normalized keys
 */
export function sumEquipmentStats(equipment) {
  const bonuses = {
    hp: 0,
    mp: 0,
    strength: 0,
    intelligence: 0,
    agility: 0,
    vitality: 0,
    luck: 0,
    attack: 0,
    defense: 0,
    magicAttack: 0,
    magicDefense: 0
  };

  for (const item of equipment) {
    const templateStats = typeof item.stat_bonuses === 'string'
      ? JSON.parse(item.stat_bonuses)
      : item.stat_bonuses || {};

    const modifications = typeof item.modifications === 'string'
      ? JSON.parse(item.modifications)
      : item.modifications || {};

    // Use baseStats if present (generated item), otherwise use template stats
    const baseStats = modifications.baseStats || templateStats;
    const bonusStats = modifications.bonusStats || {};

    // Core stats
    bonuses.strength += (baseStats.strength || 0) + (bonusStats.strength || 0) + (modifications.strength || 0);
    bonuses.intelligence += (baseStats.intelligence || 0) + (bonusStats.intelligence || 0) + (modifications.intelligence || 0);
    bonuses.agility += (baseStats.agility || 0) + (bonusStats.agility || 0) + (modifications.agility || 0);
    bonuses.vitality += (baseStats.vitality || 0) + (bonusStats.vitality || 0) + (modifications.vitality || 0);
    bonuses.luck += (baseStats.luck || 0) + (bonusStats.luck || 0) + (modifications.luck || 0);

    // HP: normalize hp_max to hp
    bonuses.hp += (baseStats.hp || 0) + (baseStats.hp_max || 0) +
                  (bonusStats.hp || 0) + (bonusStats.hp_max || 0) +
                  (modifications.hp || 0) + (modifications.hp_max || 0);

    // MP: normalize mp_max to mp
    bonuses.mp += (baseStats.mp || 0) + (baseStats.mp_max || 0) +
                  (bonusStats.mp || 0) + (bonusStats.mp_max || 0) +
                  (modifications.mp || 0) + (modifications.mp_max || 0);

    // Combat stats
    bonuses.attack += (baseStats.attack || 0) + (bonusStats.attack || 0) + (modifications.attack || 0);
    bonuses.defense += (baseStats.defense || 0) + (bonusStats.defense || 0) + (modifications.defense || 0);

    // Magic attack: handle both snake_case and camelCase
    bonuses.magicAttack +=
      (baseStats.magic_attack || 0) + (baseStats.magicAttack || 0) +
      (bonusStats.magic_attack || 0) + (bonusStats.magicAttack || 0) +
      (modifications.magic_attack || 0) + (modifications.magicAttack || 0);

    // Magic defense: handle both snake_case and camelCase
    bonuses.magicDefense +=
      (baseStats.magic_defense || 0) + (baseStats.magicDefense || 0) +
      (bonusStats.magic_defense || 0) + (bonusStats.magicDefense || 0) +
      (modifications.magic_defense || 0) + (modifications.magicDefense || 0);
  }

  return bonuses;
}

/**
 * Get effective item stats for a single item.
 * Combines baseStats (or template fallback) with bonusStats.
 *
 * @param {Object} modifications - Item modifications object
 * @param {Object} templateStatBonuses - Template stat_bonuses object
 * @returns {Object} Effective stats with normalized keys
 */
export function getEffectiveItemStats(modifications, templateStatBonuses) {
  const mods = typeof modifications === 'string'
    ? JSON.parse(modifications)
    : modifications || {};

  const template = typeof templateStatBonuses === 'string'
    ? JSON.parse(templateStatBonuses)
    : templateStatBonuses || {};

  // Use baseStats if present (generated item), otherwise use template
  const baseStats = mods.baseStats || template;
  const bonusStats = mods.bonusStats || {};

  const result = {
    strength: (baseStats.strength || 0) + (bonusStats.strength || 0),
    intelligence: (baseStats.intelligence || 0) + (bonusStats.intelligence || 0),
    agility: (baseStats.agility || 0) + (bonusStats.agility || 0),
    vitality: (baseStats.vitality || 0) + (bonusStats.vitality || 0),
    luck: (baseStats.luck || 0) + (bonusStats.luck || 0),
    hp: (baseStats.hp || 0) + (baseStats.hp_max || 0) +
        (bonusStats.hp || 0) + (bonusStats.hp_max || 0),
    mp: (baseStats.mp || 0) + (baseStats.mp_max || 0) +
        (bonusStats.mp || 0) + (bonusStats.mp_max || 0),
    attack: (baseStats.attack || 0) + (bonusStats.attack || 0),
    defense: (baseStats.defense || 0) + (bonusStats.defense || 0),
    magicAttack: (baseStats.magic_attack || 0) + (baseStats.magicAttack || 0) +
                 (bonusStats.magic_attack || 0) + (bonusStats.magicAttack || 0),
    magicDefense: (baseStats.magic_defense || 0) + (baseStats.magicDefense || 0) +
                  (bonusStats.magic_defense || 0) + (bonusStats.magicDefense || 0)
  };

  return result;
}

/**
 * Combat-relevant augment effect types that are aggregated for battle.
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
