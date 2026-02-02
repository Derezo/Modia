/**
 * @module battleTips
 * @description Collection of battle tips displayed during loading screens.
 * Tips are categorized by type and shuffled before display.
 */

export const battleTips = [
  // ============================================
  // COMBAT TIPS - Tactical positioning and mechanics
  // ============================================
  {
    category: 'combat',
    text: 'Higher ground grants +10% accuracy and damage. Position your ranged units on elevated terrain.'
  },
  {
    category: 'combat',
    text: 'Flanking an enemy from behind deals bonus damage. Coordinate attacks for maximum effect.'
  },
  {
    category: 'combat',
    text: 'Movement and actions are separate. You can attack first, then move to safety.'
  },
  {
    category: 'combat',
    text: 'Each turn grants two actions: one move and one combat action. Use both wisely.'
  },
  {
    category: 'combat',
    text: 'CT (Charge Time) determines turn order. Units with higher agility act more frequently.'
  },
  {
    category: 'combat',
    text: 'Difficult terrain like swamps and rubble costs extra movement points to traverse.'
  },
  {
    category: 'combat',
    text: 'Blocking choke points with tanky units protects your vulnerable backline.'
  },
  {
    category: 'combat',
    text: 'Preview enemy attack ranges by hovering over them. Know the danger zones.'
  },

  // ============================================
  // CLASS TIPS - Class-specific abilities and strategies
  // ============================================
  {
    category: 'class',
    text: 'Warriors excel at drawing enemy attention. Their Taunt skill forces enemies to target them.'
  },
  {
    category: 'class',
    text: 'Wizards have 4-tile attack range but are fragile. Keep them protected in the back row.'
  },
  {
    category: 'class',
    text: 'Monks can attack from 1-2 tiles away and have excellent mobility for flanking maneuvers.'
  },
  {
    category: 'class',
    text: 'Chemists support the party with healing, buffs, and debuffs. Position them where they can reach allies.'
  },
  {
    category: 'class',
    text: 'Wizard Fire spells deal strong single-target damage. Ice spells can freeze enemies in place.'
  },
  {
    category: 'class',
    text: 'Monk Ki abilities scale with both STR and INT. A balanced build can be surprisingly effective.'
  },
  {
    category: 'class',
    text: 'Chemist thrown items have 3-tile range. They can heal allies or debuff enemies from mid-range.'
  },
  {
    category: 'class',
    text: 'Warrior defense skills reduce incoming damage. Activate them before taking heavy hits.'
  },

  // ============================================
  // STATUS EFFECT TIPS - DoTs, CCs, and counters
  // ============================================
  {
    category: 'status',
    text: 'Poison deals 5% max HP per turn for 3 turns. Cleanse it early to avoid significant damage.'
  },
  {
    category: 'status',
    text: 'Burn deals 3% max HP per turn but lasts shorter than poison. Fire attacks often inflict it.'
  },
  {
    category: 'status',
    text: 'Stun and Freeze completely prevent actions for 1 turn. Use them on dangerous enemies.'
  },
  {
    category: 'status',
    text: 'Sleep is broken by damage. Sleeping enemies are vulnerable but wake when attacked.'
  },
  {
    category: 'status',
    text: 'Root prevents movement but not actions. Rooted enemies can still attack if in range.'
  },
  {
    category: 'status',
    text: 'Silence blocks skill use but allows basic attacks. Use it on spellcasters.'
  },
  {
    category: 'status',
    text: 'Slow reduces movement by 1 and halves CT gain. Haste provides the opposite effect.'
  },
  {
    category: 'status',
    text: 'Blind reduces accuracy by 30%. Even skilled warriors miss more often when blinded.'
  },

  // ============================================
  // LORE TIPS - World history and faction stories
  // ============================================
  {
    category: 'lore',
    text: 'The five regions of Modia were once united under a single kingdom before the Great Sundering.'
  },
  {
    category: 'lore',
    text: 'Dwarves forge the finest two-handed weapons, dealing 15% bonus damage with their craftsmanship.'
  },
  {
    category: 'lore',
    text: 'Elves possess natural magical affinity, regenerating 5% of their MP each turn in battle.'
  },
  {
    category: 'lore',
    text: 'Vampires sustain themselves through combat, healing 10% of damage dealt through lifesteal.'
  },
  {
    category: 'lore',
    text: 'Orcs live for battle. Their savage strikes deal 175% damage on critical hits instead of 150%.'
  },
  {
    category: 'lore',
    text: 'Humans adapt quickly, gaining 10% bonus experience from all encounters.'
  },
  {
    category: 'lore',
    text: 'The Palace at the world\'s center holds ancient secrets from before the regions divided.'
  },
  {
    category: 'lore',
    text: 'Zodiac signs grant unique abilities. Your birth sign shapes your destiny in battle.'
  }
];

/**
 * Get tips filtered by category
 * @param {string} category - 'combat' | 'class' | 'status' | 'lore'
 * @returns {Array} Filtered tips
 */
export function getTipsByCategory(category) {
  return battleTips.filter(tip => tip.category === category);
}

/**
 * Get a random tip from all categories
 * @returns {Object} Random tip object
 */
export function getRandomTip() {
  return battleTips[Math.floor(Math.random() * battleTips.length)];
}

export default battleTips;
