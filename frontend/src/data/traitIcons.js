/**
 * @module traitIcons
 * @description Painted icon for each character trait, replacing the OS emoji
 * (DNA for racial traits, star for the rest) the trait badges used to show.
 *
 * Traits reach the UI as `{ name, description, type }` (racial names come from
 * RACIAL_TRAIT_NAMES in api/src/routes/characters.js, the rest from the
 * `traits` table), so the map is keyed by display name. Every entry points at
 * an existing file under /assets/icons/png/{size}/{category}/{name}.webp; no
 * trait needed new art.
 */

import { Icon } from '../components/Icon.js';

/** @typedef {{category: string, name: string}} TraitIconRef */

/** @type {Readonly<Record<string, TraitIconRef>>} */
export const TRAIT_ICONS = Object.freeze({
  // Racial traits (one per race)
  'Quick Learner': { category: 'resources', name: 'xp' },
  'Arcane Flow': { category: 'augments', name: 'mp' },
  'Lucky Find': { category: 'resources', name: 'gold' },
  'Blood Hunger': { category: 'augments', name: 'lifesteal' },
  'Savage Strikes': { category: 'augments', name: 'critical' },

  // Combat
  'Strong Arm': { category: 'augments', name: 'strength' },
  'Sharp Mind': { category: 'augments', name: 'intelligence' },
  'Quick Reflexes': { category: 'augments', name: 'evasion' },
  'Heavy Hitter': { category: 'augments', name: 'crit' },
  'Precision': { category: 'augments', name: 'accuracy' },
  'Berserker Blood': { category: 'status', name: 'berserk' },
  'Arcane Affinity': { category: 'augments', name: 'cost' },
  'Battle Master': { category: 'augments', name: 'damage_boost' },

  // Survival
  'Tough Skin': { category: 'augments', name: 'armor' },
  'Magic Resistance': { category: 'augments', name: 'spell_resist' },
  'Vitality': { category: 'augments', name: 'hp' },
  'Regeneration': { category: 'status', name: 'regen' },
  'Mana Well': { category: 'augments', name: 'mp' },
  'Iron Will': { category: 'augments', name: 'protection' },
  'Second Wind': { category: 'augments', name: 'healing' },
  'Immortal Spirit': { category: 'augments', name: 'healing_boost' },

  // Utility
  'Swift Feet': { category: 'augments', name: 'agility' },
  'Eagle Eye': { category: 'augments', name: 'range' },
  'Fast Learner': { category: 'resources', name: 'xp' },
  'Treasure Hunter': { category: 'resources', name: 'gold' },
  'Initiative': { category: 'status', name: 'haste' },
  'Prodigy': { category: 'resources', name: 'xp' },
  'Fortune Blessed': { category: 'augments', name: 'luck' },

  // Situational
  'Forest Walker': { category: 'actions', name: 'travel' },
  'Mountain Climber': { category: 'actions', name: 'travel' },
  'Night Owl': { category: 'augments', name: 'dark' },
  'Dragon Slayer': { category: 'augments', name: 'dragon-slayer' },
  'Undead Bane': { category: 'augments', name: 'undead-slayer' },
  'Demon Hunter': { category: 'augments', name: 'demon-slayer' },
  'Boss Killer': { category: 'augments', name: 'damage' },
  'Chosen One': { category: 'augments', name: 'holy' }
});

/** Icon for a trait whose name is not in TRAIT_ICONS. */
export const DEFAULT_TRAIT_ICON = Object.freeze({ category: 'augments', name: 'power' });

/**
 * @param {{name?: string}|null|undefined} trait
 * @returns {TraitIconRef}
 */
export function getTraitIcon(trait) {
  return TRAIT_ICONS[trait?.name] || DEFAULT_TRAIT_ICON;
}

/**
 * Inline HTML for a trait badge icon. Decorative: the badge shows the trait
 * name next to it, so the icon carries no alt text or title.
 * @param {{name?: string}|null|undefined} trait
 * @returns {string}
 */
export function renderTraitIcon(trait) {
  const { category, name } = getTraitIcon(trait);
  return Icon.html(category, name, { size: 'sm' });
}
