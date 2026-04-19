/**
 * @module skillIcons
 * @description Skill icon emoji mappings for battle UI display.
 *
 * Maps skill IDs to their display icons (emoji). Organized by class/category.
 *
 * @see BattleScene.js - Uses for skill menu display
 * @see BattleUI.js - Uses for action bar skill buttons
 */

/**
 * Map of skill IDs to display icons (emoji)
 */
export const SKILL_ICONS = {
  // Warrior skills
  slash: '\u2694\uFE0F', power_strike: '\uD83D\uDCA5', bash: '\uD83D\uDEE1\uFE0F', cleave: '\uD83D\uDD2A', rend: '\uD83E\uDE78',
  crushing_blow: '\uD83D\uDCAA', whirlwind: '\uD83C\uDF00', executioner: '\u2620\uFE0F', blade_storm: '\u2694\uFE0F',
  guard: '\uD83D\uDEE1\uFE0F', shield_block: '\uD83D\uDEE1\uFE0F', parry: '\u21A9\uFE0F', taunt: '\uD83D\uDE24', fortify: '\uD83C\uDFF0',
  shield_wall: '\uD83E\uDDF1', aegis: '\uD83D\uDC7C', last_stand: '\uD83D\uDC80', iron_fortress: '\uD83C\uDFEF',
  charge: '\uD83C\uDFC3', knockback: '\uD83D\uDC4A', war_cry: '\uD83D\uDCE2', intimidate: '\uD83D\uDE20',
  ground_slam: '\uD83D\uDCA5', rally: '\uD83D\uDCE3',

  // Wizard skills
  fire_bolt: '\uD83D\uDD25', ignite: '\uD83D\uDD25', fireball: '\uD83D\uDD25', flame_shield: '\uD83D\uDD25',
  combustion: '\uD83D\uDCA5', wall_of_fire: '\uD83D\uDD25', inferno: '\uD83D\uDD25', meteor: '\u2604\uFE0F',
  ice_shard: '\u2744\uFE0F', frost: '\u2744\uFE0F', blizzard: '\u2744\uFE0F', ice_armor: '\uD83E\uDDCA',
  frozen_prison: '\uD83E\uDDCA', glacial_spike: '\u2744\uFE0F', absolute_zero: '\u2744\uFE0F', ice_age: '\u2744\uFE0F',
  spark: '\u26A1', static: '\u26A1', lightning_bolt: '\u26A1', chain_lightning: '\u26A1',
  thunder_strike: '\u26A1', paralysis: '\u26A1', overcharge: '\u26A1', tempest: '\uD83C\uDF29\uFE0F',

  // Monk skills
  palm_strike: '\uD83E\uDD1A', kick: '\uD83E\uDDB5', combo: '\uD83D\uDC4A', flying_kick: '\uD83E\uDDB6',
  chain_combo: '\uD83D\uDC4A', counter_strike: '\u21A9\uFE0F', ultimate_combo: '\uD83D\uDCAB', pressure_point: '\uD83D\uDC46',
  fists_of_fury: '\uD83D\uDC4A', meditate: '\uD83E\uDDD8', ki_strike: '\u2728', ki_shield: '\uD83D\uDCA0',
  focus: '\uD83C\uDFAF', ki_burst: '\uD83D\uDCA5', inner_peace: '\u262E\uFE0F', ki_storm: '\uD83C\uDF0A',
  transcendence: '\u2728', dash: '\uD83D\uDCA8', dodge: '\uD83C\uDFC3', swift_strike: '\u26A1',
  afterimage: '\uD83D\uDC64', untouchable: '\uD83D\uDCAB', phantom_step: '\uD83D\uDC7B',

  // Chemist skills
  potion_throw: '\uD83E\uDDEA', antidote: '\uD83D\uDC8A', mega_potion: '\uD83E\uDDEA', elixir: '\u2728',
  cure_all: '\uD83D\uDC9A', full_life: '\uD83D\uDC96', super_potion: '\uD83E\uDDEA', mass_heal: '\uD83D\uDC9A',
  panacea: '\uD83C\uDF1F', acid_flask: '\u2697\uFE0F', poison_vial: '\u2620\uFE0F', toxic_cloud: '\uD83D\uDCA8',
  corrosive: '\uD83E\uDDEA', plague: '\u2623\uFE0F', acid_rain: '\uD83C\uDF27\uFE0F', virulent: '\u2620\uFE0F',
  pandemic: '\u2623\uFE0F', bomb_throw: '\uD83D\uDCA3', flash_bomb: '\uD83D\uDCA1', timed_bomb: '\u23F0',
  cluster_bomb: '\uD83D\uDCA3', smoke_bomb: '\uD83D\uDCA8', mega_bomb: '\uD83D\uDCA3', minefield: '\uD83D\uDCA3',
  nuclear_option: '\u2622\uFE0F'
};

/**
 * Get icon for a skill based on its ID
 * @param {string} skillId - The skill ID
 * @returns {string} Icon emoji
 */
export function getSkillIcon(skillId) {
  return SKILL_ICONS[skillId] || '\u2728';
}
