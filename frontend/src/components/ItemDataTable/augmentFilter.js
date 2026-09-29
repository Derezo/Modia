/**
 * Augment filter for ItemDataTable.
 *
 * Drop-table augments carry a category (fire, dragon_slayer, hot_minor, ...),
 * an effect type (fire_damage, damage_vs, hot, ...) and, for equipment, the
 * stat the roll added (strength, luck, ...). There are ~45 categories, too
 * many for one select, so the filter offers families; an item matches when
 * any of its augments' category, type, effect type or stat is in the family.
 * Every category in api/src/services/itemDropService.js belongs to at least
 * one family (asserted by augmentFilter.test.js).
 */

/** Filter option value -> { label, tokens } */
export const AUGMENT_FILTER_GROUPS = {
  fire: { label: 'Fire', tokens: ['fire', 'fire_damage', 'burn_chance'] },
  ice: { label: 'Ice', tokens: ['ice', 'ice_damage', 'slow_chance'] },
  lightning: { label: 'Lightning', tokens: ['lightning', 'lightning_damage', 'stun_chance'] },
  poison: { label: 'Poison', tokens: ['poison', 'poison_chance', 'poison_dot'] },
  holy: { label: 'Holy', tokens: ['holy', 'holy_damage', 'heal_on_hit'] },
  dark: { label: 'Dark', tokens: ['dark', 'dark_damage', 'lifesteal'] },
  slayer: { label: 'Slayer', tokens: ['slayer', 'demon_slayer', 'dragon_slayer', 'undead_slayer', 'damage_vs'] },
  damage: { label: 'Damage', tokens: ['damage', 'power', 'damage_bonus', 'physical_attack'] },
  critical: { label: 'Critical', tokens: ['critical', 'crit', 'accuracy', 'crit_chance', 'crit_damage'] },
  defense: {
    label: 'Defense',
    tokens: [
      'defense', 'armor', 'block', 'protection', 'magic_defense', 'spell_resist',
      'physical_defense', 'block_chance', 'damage_reduction', 'magic_resist'
    ]
  },
  speed: { label: 'Speed', tokens: ['speed', 'initiative', 'instant'] },
  life: { label: 'HP & Regen', tokens: ['hp', 'regen', 'hp_max_bonus', 'hp_regen'] },
  mana: {
    label: 'MP & Spells',
    tokens: ['mp', 'mp_regen', 'mp_max_bonus', 'mp_bonus', 'concentration', 'spell_cost', 'spell_cost_reduction']
  },
  strength: { label: 'Strength', tokens: ['strength', 'buff_str'] },
  intelligence: { label: 'Intelligence', tokens: ['intelligence', 'buff_int'] },
  agility: { label: 'Agility', tokens: ['agility', 'buff_agi'] },
  vitality: { label: 'Vitality', tokens: ['vitality', 'buff_vit'] },
  luck: { label: 'Luck', tokens: ['luck'] },
  healing: {
    label: 'Healing & Revive',
    tokens: [
      'hot', 'hot_minor', 'hot_major', 'hot_percent', 'revive_bonus', 'revive_full',
      'revive_immunity', 'revive_hp_bonus'
    ]
  },
  cleanse: { label: 'Cleanse', tokens: ['cleanse', 'cleanse_minor', 'cleanse_major', 'cleanse_all'] },
  potency: { label: 'Potency & Area', tokens: ['potency', 'empowerment', 'effect_multiplier', 'aoe'] }
};

/** Select options for the augment filter */
export const AUGMENT_FILTER_OPTIONS = [
  { value: '', label: 'Any Augment' },
  ...Object.entries(AUGMENT_FILTER_GROUPS).map(([value, { label }]) => ({ value, label }))
];

/**
 * Identifiers of one augment, lowercased: category, type, effect type, stat.
 * @param {Object|string} augment
 * @returns {string[]}
 */
export function augmentTokens(augment) {
  if (!augment) return [];
  if (typeof augment === 'string') return [augment.toLowerCase()];
  if (typeof augment !== 'object') return [];
  return [augment.category, augment.type, augment.effect?.type, augment.stat, augment.effect?.stat]
    .filter(value => typeof value === 'string' && value)
    .map(value => value.toLowerCase());
}

/**
 * Whether an augment belongs to a filter family. Unknown filter values
 * match the raw category/type/stat directly.
 * @param {Object|string} augment
 * @param {string} filterValue
 * @returns {boolean}
 */
export function augmentMatchesFilter(augment, filterValue) {
  if (!filterValue) return true;
  const group = AUGMENT_FILTER_GROUPS[filterValue];
  const wanted = group ? group.tokens : [String(filterValue).toLowerCase()];
  return augmentTokens(augment).some(token => wanted.includes(token));
}

/**
 * Whether any of an item's augments matches the filter.
 * @param {Object} item - Item with augments
 * @param {string} filterValue
 * @returns {boolean}
 */
export function itemMatchesAugmentFilter(item, filterValue) {
  if (!filterValue) return true;
  const augments = Array.isArray(item?.augments) ? item.augments : [];
  return augments.some(augment => augmentMatchesFilter(augment, filterValue));
}
