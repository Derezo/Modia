import { GUILD_ADVANCEMENT_TIERS } from '../../../shared/constants.js';

// Skill definitions by guild (class)
// Combat properties: power (% damage), range, mpCost, effect (status to apply), effectDuration, effectChance
// Scaling: All skills now scale to level 100 with linear attribute progression
// Visual categories: fire, ice, lightning, physical, healing, buff, debuff, selfAura, poison, holy, shadow, earth, wind
// Elements: physical, fire, ice, lightning, earth, wind, water, holy, dark (affects damage with elemental system)

const SKILL_TREES = {
  warrior: {
    name: 'Warrior Guild',
    description: 'Masters of physical combat and defense',
    branches: [
      {
        name: 'Offense',
        skills: [
          { id: 'power_strike', name: 'Power Strike', description: 'A powerful melee attack dealing 150% damage', maxLevel: 100, baseCost: 50, type: 'active', icon: '⚔️', power: 150, range: 1, mpCost: 10, visualCategory: 'physical', scaling: { power: 0.5 } },
          { id: 'cleave', name: 'Cleave', description: 'Attack all adjacent enemies for 120% damage', maxLevel: 100, baseCost: 100, type: 'active', icon: '🗡️', requires: { power_strike: 5 }, power: 120, range: 1, mpCost: 15, aoeRadius: 1, visualCategory: 'physical', scaling: { power: 0.6 } },
          { id: 'rage', name: 'Rage', description: 'Increase attack by 20% for 3 turns', maxLevel: 100, baseCost: 150, type: 'active', icon: '😤', requires: { cleave: 5 }, power: 0, range: 0, mpCost: 20, selfBuff: 'rage', buffDuration: 3, targetSelf: true, visualCategory: 'buff', scaling: { buffDuration: 0.02 } },
          { id: 'rend', name: 'Rend', description: 'Attack that causes bleeding (3% HP/turn for 3 turns)', maxLevel: 100, baseCost: 80, type: 'active', icon: '🩸', requires: { power_strike: 5 }, power: 100, range: 1, mpCost: 12, effect: 'bleed', effectDuration: 3, effectChance: 0.8, visualCategory: 'physical', scaling: { power: 0.4, effectChance: 0.002 } }
        ]
      },
      {
        name: 'Defense',
        skills: [
          { id: 'shield_bash', name: 'Shield Bash', description: 'Stun enemy for 1 turn (80% damage)', maxLevel: 100, baseCost: 50, type: 'active', icon: '🛡️', power: 80, range: 1, mpCost: 8, effect: 'stun', effectDuration: 1, effectChance: 0.7, visualCategory: 'physical', scaling: { power: 0.3, effectChance: 0.003 } },
          { id: 'fortify', name: 'Fortify', description: 'Increase defense by 30% for 3 turns', maxLevel: 100, baseCost: 100, type: 'active', icon: '🏰', requires: { shield_bash: 5 }, power: 0, range: 0, mpCost: 15, selfBuff: 'fortify', buffDuration: 3, targetSelf: true, visualCategory: 'buff', scaling: { buffDuration: 0.02 } },
          { id: 'taunt', name: 'Taunt', description: 'Force enemies to attack you for 2 turns', maxLevel: 100, baseCost: 150, type: 'active', icon: '📣', requires: { fortify: 5 }, power: 0, range: 3, mpCost: 10, effect: 'taunt', effectDuration: 2, effectChance: 1.0, visualCategory: 'debuff', scaling: { effectDuration: 0.01, range: 0.02 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'warrior_strength', name: 'Warrior Strength', description: '+5% STR per level', maxLevel: 100, baseCost: 30, type: 'passive', icon: '💪', statBonus: { stat: 'strength', percentPerLevel: 0.05 } },
          { id: 'iron_skin', name: 'Iron Skin', description: '+5% VIT per level', maxLevel: 100, baseCost: 30, type: 'passive', icon: '🛡️', statBonus: { stat: 'vitality', percentPerLevel: 0.05 } }
        ]
      }
    ]
  },
  wizard: {
    name: 'Wizard Guild',
    description: 'Masters of arcane magic',
    branches: [
      {
        name: 'Fire',
        skills: [
          { id: 'fireball', name: 'Fireball', description: 'Launch a ball of fire (130% MATK, burn)', maxLevel: 100, baseCost: 50, type: 'active', icon: '🔥', power: 130, range: 4, mpCost: 18, damageType: 'magical', element: 'fire', effect: 'burn', effectDuration: 2, effectChance: 0.5, visualCategory: 'fire', scaling: { power: 0.7, effectChance: 0.004 } },
          { id: 'inferno', name: 'Inferno', description: 'Burn all enemies in area (180% MATK)', maxLevel: 100, baseCost: 150, type: 'active', icon: '🌋', requires: { fireball: 5 }, power: 180, range: 4, mpCost: 35, damageType: 'magical', element: 'fire', aoeRadius: 2, effect: 'burn', effectDuration: 3, effectChance: 0.8, visualCategory: 'fire', scaling: { power: 0.8, effectChance: 0.002 } }
        ]
      },
      {
        name: 'Ice',
        skills: [
          { id: 'ice_shard', name: 'Ice Shard', description: 'Pierce with ice (100% MATK, slow)', maxLevel: 100, baseCost: 50, type: 'active', icon: '❄️', power: 100, range: 4, mpCost: 8, damageType: 'magical', element: 'ice', effect: 'slow', effectDuration: 2, effectChance: 0.6, visualCategory: 'ice', scaling: { power: 0.6, effectChance: 0.004 } },
          { id: 'blizzard', name: 'Blizzard', description: 'Freeze enemies in area (110% MATK)', maxLevel: 100, baseCost: 150, type: 'active', icon: '🌨️', requires: { ice_shard: 5 }, power: 110, range: 4, mpCost: 30, damageType: 'magical', element: 'ice', aoeRadius: 2, effect: 'freeze', effectDuration: 1, effectChance: 0.5, visualCategory: 'ice', scaling: { power: 0.7, effectChance: 0.004, effectDuration: 0.01 } }
        ]
      },
      {
        name: 'Lightning',
        skills: [
          { id: 'lightning_bolt', name: 'Lightning Bolt', description: 'Strike with lightning (150% MATK, stun)', maxLevel: 100, baseCost: 50, type: 'active', icon: '⚡', power: 150, range: 5, mpCost: 15, damageType: 'magical', element: 'lightning', effect: 'stun', effectDuration: 1, effectChance: 0.15, visualCategory: 'lightning', scaling: { power: 0.6, effectChance: 0.006 } },
          { id: 'chain_lightning', name: 'Chain Lightning', description: 'Lightning that chains (80% per target)', maxLevel: 100, baseCost: 150, type: 'active', icon: '⛈️', requires: { lightning_bolt: 5 }, power: 80, range: 4, mpCost: 22, damageType: 'magical', element: 'lightning', chainTargets: 3, visualCategory: 'lightning', scaling: { power: 0.5, chainTargets: 0.02 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'wizard_intellect', name: 'Wizard Intellect', description: '+5% INT per level', maxLevel: 100, baseCost: 30, type: 'passive', icon: '🧠', statBonus: { stat: 'intelligence', percentPerLevel: 0.05 } },
          { id: 'mana_flow', name: 'Mana Flow', description: '+5% MP per level', maxLevel: 100, baseCost: 30, type: 'passive', icon: '💧', statBonus: { stat: 'mpMax', percentPerLevel: 0.05 } }
        ]
      }
    ]
  },
  monk: {
    name: 'Monk Guild',
    description: 'Masters of martial arts and inner peace',
    branches: [
      {
        name: 'Strikes',
        skills: [
          { id: 'palm_strike', name: 'Palm Strike', description: 'Quick palm attack (100% damage)', maxLevel: 100, baseCost: 50, type: 'active', icon: '🤚', power: 100, range: 1, mpCost: 5, visualCategory: 'physical', scaling: { power: 0.5 } },
          { id: 'flying_kick', name: 'Flying Kick', description: 'Jump to target (130% damage)', maxLevel: 100, baseCost: 100, type: 'active', icon: '🦶', requires: { palm_strike: 5 }, power: 130, range: 3, mpCost: 15, visualCategory: 'physical', scaling: { power: 0.5, range: 0.02 } },
          { id: 'thousand_fists', name: 'Thousand Fists', description: 'Rapid hits (5x 40% damage)', maxLevel: 100, baseCost: 200, type: 'active', icon: '👊', requires: { flying_kick: 5 }, power: 40, range: 1, mpCost: 25, hits: 5, visualCategory: 'physical', scaling: { power: 0.3, hits: 0.03 } }
        ]
      },
      {
        name: 'Spirit',
        skills: [
          { id: 'meditation', name: 'Meditation', description: 'Recover 15% HP and MP', maxLevel: 100, baseCost: 50, type: 'active', icon: '🧘', power: 0, range: 0, mpCost: 0, healPercent: 15, mpRestore: 15, targetSelf: true, visualCategory: 'selfAura', scaling: { healPercent: 0.1, mpRestore: 0.1 } },
          { id: 'inner_peace', name: 'Inner Peace', description: 'Remove all debuffs, heal 20% HP', maxLevel: 100, baseCost: 100, type: 'active', icon: '☮️', requires: { meditation: 5 }, power: 0, range: 0, mpCost: 20, cleanse: true, healPercent: 20, targetSelf: true, visualCategory: 'selfAura', scaling: { healPercent: 0.15 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'monk_agility', name: 'Monk Agility', description: '+5% AGI per level', maxLevel: 100, baseCost: 30, type: 'passive', icon: '🏃', statBonus: { stat: 'agility', percentPerLevel: 0.05 } },
          { id: 'chi_flow', name: 'Chi Flow', description: '+2% HP regen per level', maxLevel: 100, baseCost: 50, type: 'passive', icon: '☯️', statBonus: { stat: 'hpRegen', percentPerLevel: 0.02 } }
        ]
      }
    ]
  },
  chemist: {
    name: 'Chemist Guild',
    description: 'Masters of potions and alchemy',
    branches: [
      {
        name: 'Healing',
        skills: [
          { id: 'potion_toss', name: 'Potion Toss', description: 'Heal ally for 20% HP', maxLevel: 100, baseCost: 50, type: 'active', icon: '🧪', power: 0, range: 3, mpCost: 8, healPercent: 20, targetAlly: true, visualCategory: 'healing', scaling: { healPercent: 0.15, range: 0.02 } },
          { id: 'mega_potion', name: 'Mega Potion', description: 'Heal all allies for 30% HP', maxLevel: 100, baseCost: 150, type: 'active', icon: '💉', requires: { potion_toss: 5 }, power: 0, range: 0, mpCost: 25, healPercent: 30, targetAllAllies: true, visualCategory: 'healing', scaling: { healPercent: 0.2 } }
        ]
      },
      {
        name: 'Offense',
        skills: [
          { id: 'acid_flask', name: 'Acid Flask', description: 'Acid damage + armor reduction (80% MATK)', maxLevel: 100, baseCost: 50, type: 'active', icon: '⚗️', power: 80, range: 3, mpCost: 8, damageType: 'magical', element: 'earth', effect: 'corrode', effectDuration: 3, effectChance: 0.7, visualCategory: 'poison', scaling: { power: 0.5, effectChance: 0.003 } },
          { id: 'poison_cloud', name: 'Poison Cloud', description: 'AoE poison (5% HP/turn for 3 turns)', maxLevel: 100, baseCost: 100, type: 'active', icon: '☠️', requires: { acid_flask: 5 }, power: 60, range: 4, mpCost: 18, damageType: 'magical', element: 'earth', aoeRadius: 2, effect: 'poison', effectDuration: 3, effectChance: 0.9, visualCategory: 'poison', scaling: { power: 0.4, effectChance: 0.001, aoeRadius: 0.01 } }
        ]
      },
      {
        name: 'Utility',
        skills: [
          { id: 'smoke_bomb', name: 'Smoke Bomb', description: 'Blind enemies in area (-30% accuracy for 2 turns)', maxLevel: 100, baseCost: 50, type: 'active', icon: '💨', power: 0, range: 3, mpCost: 10, aoeRadius: 2, effect: 'blind', effectDuration: 2, effectChance: 0.8, visualCategory: 'debuff', scaling: { effectChance: 0.002, effectDuration: 0.01 } },
          { id: 'haste_potion', name: 'Haste Potion', description: 'Grant ally haste (+1 move for 3 turns)', maxLevel: 100, baseCost: 100, type: 'active', icon: '⏱️', power: 0, range: 3, mpCost: 12, targetAlly: true, effect: 'haste', effectDuration: 3, effectChance: 1.0, visualCategory: 'buff', scaling: { effectDuration: 0.02, range: 0.02 } }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'chemist_luck', name: 'Chemist Luck', description: '+5% LCK per level', maxLevel: 100, baseCost: 30, type: 'passive', icon: '🍀', statBonus: { stat: 'luck', percentPerLevel: 0.05 } },
          { id: 'efficient_mixing', name: 'Efficient Mixing', description: 'Item effects +10% per level', maxLevel: 100, baseCost: 50, type: 'passive', icon: '📈', statBonus: { stat: 'itemEffectiveness', percentPerLevel: 0.1 } }
        ]
      },
      {
        name: 'Support',
        skills: [
          {
            id: 'throw_item',
            name: 'Throw Item',
            description: 'Throw consumable items at allies. Range and effectiveness scale with level. Range: 2 + floor(level/5). Effectiveness: 60% + (level * 2)%.',
            maxLevel: 20,
            baseCost: 50,
            type: 'passive',
            icon: '🎯',
            // Range: 2 + floor(level / 5) tiles (max 6 at level 20)
            // Effectiveness: 60% + (level * 2)% (max 100% at level 20)
            throwItem: {
              baseRange: 2,
              rangeBonusPerLevel: 0.2, // +1 range per 5 levels
              baseEffectiveness: 0.6,
              effectivenessPerLevel: 0.02
            }
          }
        ]
      }
    ]
  },

  // ============================================
  // ADVANCED GUILDS
  // ============================================

  berserker: {
    name: 'Berserker Guild',
    description: 'Warrior advancement focused on rage and reckless power',
    advancedFrom: 'warrior',
    levelRequirement: 20,
    branches: [
      {
        name: 'Rage',
        skills: [
          { id: 'rage_strike', name: 'Rage Strike', description: '140% ATK damage, gain 10 rage', maxLevel: 100, baseCost: 100, type: 'active', icon: '😡', power: 140, range: 1, mpCost: 15, visualCategory: 'physical', scaling: { power: 0.6 } },
          { id: 'blood_frenzy', name: 'Blood Frenzy', description: '+20% ATK per kill for 3 turns', maxLevel: 100, baseCost: 150, type: 'active', icon: '🩸', requires: { rage_strike: 5 }, power: 0, range: 0, mpCost: 20, selfBuff: 'frenzy', buffDuration: 3, targetSelf: true, visualCategory: 'buff', scaling: { buffDuration: 0.02 } },
          { id: 'enraged_fury', name: 'Enraged Fury', description: '180% ATK, +5% per rage point', maxLevel: 100, baseCost: 200, type: 'active', icon: '💢', requires: { blood_frenzy: 5 }, power: 180, range: 1, mpCost: 30, visualCategory: 'physical', scaling: { power: 0.8 } },
          { id: 'bloodlust', name: 'Bloodlust', description: 'Killing blow heals 10% HP', maxLevel: 100, baseCost: 150, type: 'passive', icon: '❤️‍🔥', statBonus: { stat: 'lifeSteal', percentPerLevel: 0.1 } },
          { id: 'reckless_power', name: 'Reckless Power', description: '+50% ATK, -25% DEF for 3 turns', maxLevel: 100, baseCost: 200, type: 'active', icon: '⚡', requires: { enraged_fury: 5 }, power: 0, range: 0, mpCost: 25, selfBuff: 'reckless', buffDuration: 3, targetSelf: true, visualCategory: 'buff', scaling: { buffDuration: 0.02 } },
          { id: 'berserker_rage', name: 'Berserker Rage', description: '+100% ATK, cannot use skills, 3 turns', maxLevel: 100, baseCost: 300, type: 'active', icon: '🔥', requires: { reckless_power: 5 }, power: 0, range: 0, mpCost: 50, selfBuff: 'berserker', buffDuration: 3, targetSelf: true, visualCategory: 'buff', scaling: { buffDuration: 0.03 } },
          { id: 'unstoppable', name: 'Unstoppable', description: 'Immune to stun/slow while in rage', maxLevel: 100, baseCost: 250, type: 'passive', icon: '🦸', requires: { berserker_rage: 5 }, statBonus: { stat: 'statusResist', percentPerLevel: 0.01 } },
          { id: 'rampage', name: 'Rampage', description: 'Attack all enemies in range, +10% per hit', maxLevel: 100, baseCost: 500, type: 'active', icon: '💥', requires: { unstoppable: 5 }, power: 100, range: 2, mpCost: 70, aoeRadius: 2, visualCategory: 'physical', scaling: { power: 1.0, aoeRadius: 0.02 } }
        ]
      },
      {
        name: 'Recklessness',
        skills: [
          { id: 'reckless_charge', name: 'Reckless Charge', description: 'Rush + 150% ATK, take 10% HP damage', maxLevel: 100, baseCost: 100, type: 'active', icon: '🏃', power: 150, range: 5, mpCost: 20, visualCategory: 'physical', scaling: { power: 0.6, range: 0.02 } },
          { id: 'wild_swing', name: 'Wild Swing', description: '200% ATK, 50% chance to hit', maxLevel: 100, baseCost: 100, type: 'active', icon: '🌀', power: 200, range: 1, mpCost: 15, accuracy: 0.5, visualCategory: 'physical', scaling: { power: 0.8 } },
          { id: 'berserker_leap', name: 'Berserker Leap', description: 'Jump + AoE 100% ATK, take 5% HP', maxLevel: 100, baseCost: 150, type: 'active', icon: '🦘', requires: { reckless_charge: 5, wild_swing: 5 }, power: 100, range: 4, mpCost: 25, aoeRadius: 1, visualCategory: 'physical', scaling: { power: 0.6, range: 0.02 } },
          { id: 'martyrs_resolve', name: 'Martyr\'s Resolve', description: '+100% damage when below 30% HP', maxLevel: 100, baseCost: 200, type: 'active', icon: '✝️', requires: { berserker_leap: 5 }, power: 0, range: 0, mpCost: 30, selfBuff: 'martyr', buffDuration: 3, targetSelf: true, visualCategory: 'buff', scaling: { buffDuration: 0.02 } },
          { id: 'death_wish', name: 'Death Wish', description: '+1% ATK per 1% missing HP', maxLevel: 100, baseCost: 250, type: 'passive', icon: '💀', requires: { martyrs_resolve: 5 }, statBonus: { stat: 'lowHpDamage', percentPerLevel: 0.01 } },
          { id: 'final_stand', name: 'Final Stand', description: 'Survive at 1 HP once per battle', maxLevel: 100, baseCost: 400, type: 'active', icon: '🛡️', requires: { death_wish: 5 }, power: 0, range: 0, mpCost: 40, selfBuff: 'final_stand', buffDuration: 999, targetSelf: true, visualCategory: 'buff' },
          { id: 'self_destruction', name: 'Self-Destruction', description: 'Deal HP as damage to all enemies, KO self', maxLevel: 100, baseCost: 500, type: 'active', icon: '☢️', requires: { final_stand: 5 }, power: 0, range: 3, mpCost: 0, element: 'fire', aoeRadius: 3, visualCategory: 'fire', scaling: { aoeRadius: 0.02 } }
        ]
      }
    ]
  },

  sorcerer: {
    name: 'Sorcerer Guild',
    description: 'Wizard advancement focused on raw magical power',
    advancedFrom: 'wizard',
    levelRequirement: 20,
    branches: [
      {
        name: 'Arcane Power',
        skills: [
          { id: 'arcane_bolt', name: 'Arcane Bolt', description: '120% MATK, ignores resistance', maxLevel: 100, baseCost: 100, type: 'active', icon: '✨', power: 120, range: 5, mpCost: 12, damageType: 'magical', element: 'holy', visualCategory: 'holy', scaling: { power: 0.6 } },
          { id: 'mana_shield', name: 'Mana Shield', description: 'Damage reduces MP instead of HP', maxLevel: 100, baseCost: 150, type: 'active', icon: '🛡️', requires: { arcane_bolt: 5 }, power: 0, range: 0, mpCost: 20, selfBuff: 'mana_shield', buffDuration: 3, targetSelf: true, visualCategory: 'selfAura', scaling: { buffDuration: 0.02 } },
          { id: 'spell_amplify', name: 'Spell Amplify', description: 'Next spell +75% damage', maxLevel: 100, baseCost: 200, type: 'active', icon: '📈', requires: { mana_shield: 5 }, power: 0, range: 0, mpCost: 25, selfBuff: 'amplify', buffDuration: 1, targetSelf: true, visualCategory: 'buff' },
          { id: 'arcane_mastery', name: 'Arcane Mastery', description: '+20% spell damage', maxLevel: 100, baseCost: 200, type: 'passive', icon: '📚', requires: { spell_amplify: 5 }, statBonus: { stat: 'spellDamage', percentPerLevel: 0.2 } },
          { id: 'penetrating_magic', name: 'Penetrating Magic', description: 'Ignore 25% magic resistance', maxLevel: 100, baseCost: 250, type: 'passive', icon: '🔮', requires: { arcane_mastery: 5 }, statBonus: { stat: 'magicPen', percentPerLevel: 0.25 } },
          { id: 'arcane_explosion', name: 'Arcane Explosion', description: '250% MATK, 3-tile AoE', maxLevel: 100, baseCost: 300, type: 'active', icon: '💥', requires: { penetrating_magic: 5 }, power: 250, range: 4, mpCost: 50, damageType: 'magical', element: 'holy', aoeRadius: 3, visualCategory: 'holy', scaling: { power: 1.0, aoeRadius: 0.01 } },
          { id: 'infinite_mana', name: 'Infinite Mana', description: '20% chance spell costs no MP', maxLevel: 100, baseCost: 350, type: 'passive', icon: '♾️', requires: { arcane_explosion: 5 }, statBonus: { stat: 'freeCastChance', percentPerLevel: 0.2 } },
          { id: 'armageddon', name: 'Armageddon', description: '400% MATK to all enemies', maxLevel: 100, baseCost: 500, type: 'active', icon: '🌋', requires: { infinite_mana: 5 }, power: 400, range: 10, mpCost: 100, damageType: 'magical', element: 'fire', aoeRadius: 10, visualCategory: 'fire', scaling: { power: 1.5 } }
        ]
      },
      {
        name: 'Elemental Mastery',
        skills: [
          { id: 'element_shift', name: 'Element Shift', description: 'Change spell element mid-cast', maxLevel: 100, baseCost: 100, type: 'active', icon: '🔄', power: 0, range: 0, mpCost: 10, targetSelf: true, visualCategory: 'selfAura' },
          { id: 'tri_element', name: 'Tri-Element', description: 'Fire+Ice+Lightning, 100% each', maxLevel: 100, baseCost: 200, type: 'active', icon: '🌈', requires: { element_shift: 5 }, power: 100, range: 4, mpCost: 30, damageType: 'magical', element: 'fire', hits: 3, visualCategory: 'lightning', scaling: { power: 0.6, hits: 0.02 } },
          { id: 'prismatic_blast', name: 'Prismatic Blast', description: 'Random element, 200% MATK', maxLevel: 100, baseCost: 200, type: 'active', icon: '💎', requires: { tri_element: 5 }, power: 200, range: 5, mpCost: 40, damageType: 'magical', element: 'holy', visualCategory: 'holy', scaling: { power: 0.8 } },
          { id: 'elemental_shield', name: 'Elemental Shield', description: 'Resist current highest element +50%', maxLevel: 100, baseCost: 200, type: 'active', icon: '🔰', requires: { prismatic_blast: 5 }, power: 0, range: 0, mpCost: 25, selfBuff: 'elem_shield', buffDuration: 3, targetSelf: true, visualCategory: 'selfAura', scaling: { buffDuration: 0.02 } },
          { id: 'all_elements', name: 'All Elements', description: '+10% all elemental damage', maxLevel: 100, baseCost: 250, type: 'passive', icon: '🌐', requires: { elemental_shield: 5 }, statBonus: { stat: 'elementalDamage', percentPerLevel: 0.1 } },
          { id: 'elemental_overload', name: 'Elemental Overload', description: 'Hit weakness for +100% damage', maxLevel: 100, baseCost: 350, type: 'active', icon: '⚡', requires: { all_elements: 5 }, power: 200, range: 5, mpCost: 60, damageType: 'magical', element: 'lightning', visualCategory: 'lightning', scaling: { power: 1.0 } },
          { id: 'avatar_of_elements', name: 'Avatar of Elements', description: 'Cast 3 elemental spells instantly', maxLevel: 100, baseCost: 500, type: 'active', icon: '👑', requires: { elemental_overload: 5 }, power: 150, range: 5, mpCost: 80, damageType: 'magical', element: 'holy', hits: 3, visualCategory: 'holy', scaling: { power: 0.8, hits: 0.02 } }
        ]
      }
    ]
  },

  ninja: {
    name: 'Ninja Guild',
    description: 'Monk advancement focused on stealth and assassination',
    advancedFrom: 'monk',
    levelRequirement: 20,
    branches: [
      {
        name: 'Stealth',
        skills: [
          { id: 'shadow_step', name: 'Shadow Step', description: 'Teleport behind target', maxLevel: 100, baseCost: 100, type: 'active', icon: '👤', power: 0, range: 4, mpCost: 15, element: 'dark', visualCategory: 'shadow', scaling: { range: 0.03 } },
          { id: 'vanish', name: 'Vanish', description: 'Become invisible for 2 turns', maxLevel: 100, baseCost: 150, type: 'active', icon: '🌫️', requires: { shadow_step: 5 }, power: 0, range: 0, mpCost: 20, element: 'dark', selfBuff: 'invisible', buffDuration: 2, targetSelf: true, visualCategory: 'shadow', scaling: { buffDuration: 0.02 } },
          { id: 'backstab', name: 'Backstab', description: '+100% damage from behind', maxLevel: 100, baseCost: 150, type: 'active', icon: '🗡️', requires: { vanish: 5 }, power: 200, range: 1, mpCost: 18, element: 'dark', visualCategory: 'shadow', scaling: { power: 0.8 } },
          { id: 'assassination', name: 'Assassination', description: '300% ATK if invisible', maxLevel: 100, baseCost: 250, type: 'active', icon: '☠️', requires: { backstab: 5 }, power: 300, range: 1, mpCost: 35, element: 'dark', visualCategory: 'shadow', scaling: { power: 1.2 } },
          { id: 'silent_step', name: 'Silent Step', description: 'Movement does not reveal', maxLevel: 100, baseCost: 200, type: 'passive', icon: '🔇', requires: { assassination: 5 }, statBonus: { stat: 'stealthMove', percentPerLevel: 0.01 } },
          { id: 'shadow_clone', name: 'Shadow Clone', description: 'Create clone with 25% stats', maxLevel: 100, baseCost: 300, type: 'active', icon: '👥', requires: { silent_step: 5 }, power: 0, range: 0, mpCost: 40, element: 'dark', targetSelf: true, visualCategory: 'shadow', scaling: {} },
          { id: 'death_mark', name: 'Death Mark', description: 'Target takes +50% damage for 3 turns', maxLevel: 100, baseCost: 300, type: 'active', icon: '💀', requires: { shadow_clone: 5 }, power: 0, range: 3, mpCost: 30, element: 'dark', effect: 'marked', effectDuration: 3, effectChance: 1.0, visualCategory: 'debuff', scaling: { effectDuration: 0.02 } },
          { id: 'one_thousand_cuts', name: 'One Thousand Cuts', description: '20 hits at 20% ATK from stealth', maxLevel: 100, baseCost: 500, type: 'active', icon: '⚔️', requires: { death_mark: 5 }, power: 20, range: 1, mpCost: 70, element: 'dark', hits: 20, visualCategory: 'shadow', scaling: { power: 0.3, hits: 0.1 } }
        ]
      },
      {
        name: 'Ninjutsu',
        skills: [
          { id: 'shuriken', name: 'Shuriken', description: '80% ATK ranged attack', maxLevel: 100, baseCost: 100, type: 'active', icon: '✴️', power: 80, range: 4, mpCost: 10, visualCategory: 'physical', scaling: { power: 0.5, range: 0.02 } },
          { id: 'kunai_barrage', name: 'Kunai Barrage', description: '3 shurikens at 50% ATK', maxLevel: 100, baseCost: 150, type: 'active', icon: '🔪', requires: { shuriken: 5 }, power: 50, range: 4, mpCost: 18, hits: 3, visualCategory: 'physical', scaling: { power: 0.4, hits: 0.02 } },
          { id: 'ninja_smoke_bomb', name: 'Smoke Bomb', description: 'AoE blind + evasion boost', maxLevel: 100, baseCost: 150, type: 'active', icon: '💨', requires: { kunai_barrage: 5 }, power: 0, range: 3, mpCost: 15, aoeRadius: 2, effect: 'blind', effectDuration: 2, effectChance: 0.8, visualCategory: 'debuff', scaling: { effectChance: 0.002, aoeRadius: 0.01 } },
          { id: 'poison_blade', name: 'Poison Blade', description: '100% ATK + lethal poison', maxLevel: 100, baseCost: 200, type: 'active', icon: '🗡️☠️', requires: { ninja_smoke_bomb: 5 }, power: 100, range: 1, mpCost: 25, element: 'earth', effect: 'poison', effectDuration: 3, effectChance: 0.9, visualCategory: 'poison', scaling: { power: 0.6, effectChance: 0.001 } },
          { id: 'ninja_tools', name: 'Ninja Tools', description: '+20% thrown weapon damage', maxLevel: 100, baseCost: 200, type: 'passive', icon: '🎒', requires: { poison_blade: 5 }, statBonus: { stat: 'thrownDamage', percentPerLevel: 0.2 } },
          { id: 'explosive_tag', name: 'Explosive Tag', description: 'Place trap, 200% ATK when triggered', maxLevel: 100, baseCost: 300, type: 'active', icon: '💣', requires: { ninja_tools: 5 }, power: 200, range: 4, mpCost: 35, element: 'fire', visualCategory: 'fire', scaling: { power: 0.8 } },
          { id: 'shadow_arts', name: 'Shadow Arts', description: 'All attacks +50% from any angle for 3 turns', maxLevel: 100, baseCost: 500, type: 'active', icon: '🥷', requires: { explosive_tag: 5 }, power: 0, range: 0, mpCost: 60, element: 'dark', selfBuff: 'shadow_arts', buffDuration: 3, targetSelf: true, visualCategory: 'shadow', scaling: { buffDuration: 0.02 } }
        ]
      }
    ]
  },

  alchemist: {
    name: 'Alchemist Guild',
    description: 'Chemist advancement focused on transmutation and explosives',
    advancedFrom: 'chemist',
    levelRequirement: 20,
    branches: [
      {
        name: 'Transmutation',
        skills: [
          { id: 'transmute', name: 'Transmute', description: 'Convert debuff to buff (or reverse)', maxLevel: 100, baseCost: 100, type: 'active', icon: '🔄', power: 0, range: 3, mpCost: 20, element: 'holy', visualCategory: 'holy', scaling: { range: 0.02 } },
          { id: 'gold_touch', name: 'Gold Touch', description: '+50% gold from target enemy', maxLevel: 100, baseCost: 100, type: 'active', icon: '💰', power: 0, range: 1, mpCost: 15, element: 'earth', visualCategory: 'holy' },
          { id: 'element_convert', name: 'Element Convert', description: 'Change enemy\'s elemental weakness', maxLevel: 100, baseCost: 150, type: 'active', icon: '⚗️', requires: { transmute: 5, gold_touch: 5 }, power: 0, range: 4, mpCost: 25, element: 'holy', visualCategory: 'holy', scaling: { range: 0.02 } },
          { id: 'philosophers_stone', name: 'Philosopher\'s Stone', description: '+25% potion effectiveness', maxLevel: 100, baseCost: 200, type: 'passive', icon: '💎', requires: { element_convert: 5 }, statBonus: { stat: 'potionEffectiveness', percentPerLevel: 0.25 } },
          { id: 'matter_shift', name: 'Matter Shift', description: 'Swap positions with ally or enemy', maxLevel: 100, baseCost: 200, type: 'active', icon: '↔️', requires: { philosophers_stone: 5 }, power: 0, range: 3, mpCost: 30, element: 'holy', visualCategory: 'holy', scaling: { range: 0.03 } },
          { id: 'equivalent_exchange', name: 'Equivalent Exchange', description: 'Trade HP for MP or reverse', maxLevel: 100, baseCost: 250, type: 'active', icon: '⚖️', requires: { matter_shift: 5 }, power: 0, range: 0, mpCost: 40, element: 'holy', targetSelf: true, visualCategory: 'selfAura' },
          { id: 'perfect_transmutation', name: 'Perfect Transmutation', description: 'Transform enemy to weaker form for 3 turns', maxLevel: 100, baseCost: 500, type: 'active', icon: '✨', requires: { equivalent_exchange: 5 }, power: 0, range: 4, mpCost: 80, element: 'holy', effect: 'transmuted', effectDuration: 3, effectChance: 0.7, visualCategory: 'holy', scaling: { effectChance: 0.003, effectDuration: 0.01 } }
        ]
      },
      {
        name: 'Explosives',
        skills: [
          { id: 'volatile_mix', name: 'Volatile Mix', description: '150% ATK bomb + random status', maxLevel: 100, baseCost: 100, type: 'active', icon: '🧪', power: 150, range: 4, mpCost: 18, damageType: 'magical', element: 'fire', visualCategory: 'fire', scaling: { power: 0.7 } },
          { id: 'napalm', name: 'Napalm', description: '2-tile fire zone for 3 turns', maxLevel: 100, baseCost: 150, type: 'active', icon: '🔥', requires: { volatile_mix: 5 }, power: 80, range: 4, mpCost: 22, element: 'fire', aoeRadius: 2, effect: 'burn', effectDuration: 3, effectChance: 1.0, visualCategory: 'fire', scaling: { power: 0.5, aoeRadius: 0.01 } },
          { id: 'elemental_bomb', name: 'Elemental Bomb', description: 'Choose fire/ice/lightning, 180% ATK', maxLevel: 100, baseCost: 200, type: 'active', icon: '💣', requires: { napalm: 5 }, power: 180, range: 5, mpCost: 30, damageType: 'magical', element: 'fire', visualCategory: 'fire', scaling: { power: 0.8 } },
          { id: 'scatter_shot', name: 'Scatter Shot', description: '5 random targets, 60% ATK each', maxLevel: 100, baseCost: 200, type: 'active', icon: '💥', requires: { elemental_bomb: 5 }, power: 60, range: 5, mpCost: 35, element: 'fire', hits: 5, visualCategory: 'fire', scaling: { power: 0.4, hits: 0.03 } },
          { id: 'unstable_mixture', name: 'Unstable Mixture', description: '+15% bomb crit chance', maxLevel: 100, baseCost: 250, type: 'passive', icon: '⚠️', requires: { scatter_shot: 5 }, statBonus: { stat: 'bombCrit', percentPerLevel: 0.15 } },
          { id: 'tactical_nuke', name: 'Tactical Nuke', description: '250% ATK, 4-tile AoE', maxLevel: 100, baseCost: 350, type: 'active', icon: '☢️', requires: { unstable_mixture: 5 }, power: 250, range: 6, mpCost: 55, damageType: 'magical', element: 'fire', aoeRadius: 4, visualCategory: 'fire', scaling: { power: 1.0, aoeRadius: 0.02 } },
          { id: 'alchemical_warfare', name: 'Alchemical Warfare', description: 'All enemies: 200% + burn + poison + slow', maxLevel: 100, baseCost: 500, type: 'active', icon: '🌍', requires: { tactical_nuke: 5 }, power: 200, range: 10, mpCost: 90, damageType: 'magical', element: 'fire', aoeRadius: 10, effect: 'burn', effectDuration: 3, effectChance: 1.0, visualCategory: 'fire', scaling: { power: 1.2 } }
        ]
      }
    ]
  }
};

/**
 * Get the ordered class path unlocked for a base or advanced guild class.
 * The advancement constants intentionally omit the base class from each tier
 * array, so it is prepended to every advanced progression path.
 */
function getGuildProgressionPath(guildId) {
  if (typeof guildId !== 'string') {
    return null;
  }

  const normalizedGuildId = guildId.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(GUILD_ADVANCEMENT_TIERS, normalizedGuildId)) {
    return [normalizedGuildId];
  }

  for (const [baseGuildId, advancementTiers] of Object.entries(GUILD_ADVANCEMENT_TIERS)) {
    const currentTierIndex = advancementTiers.indexOf(normalizedGuildId);
    if (currentTierIndex !== -1) {
      return [baseGuildId, ...advancementTiers.slice(0, currentTierIndex + 1)];
    }
  }

  return null;
}

/**
 * Build the tree available in the Training Grounds for a character class.
 * Classes without their own authored tree inherit every authored tree earlier
 * in their progression path.
 */
function buildTrainingSkillTree(guildId) {
  const progressionPath = getGuildProgressionPath(guildId);
  if (!progressionPath) {
    return null;
  }

  const currentGuildId = progressionPath[progressionPath.length - 1];
  const currentTree = SKILL_TREES[currentGuildId];

  // Preserve the existing base-guild response shape and object identity.
  if (progressionPath.length === 1) {
    return currentTree || null;
  }

  const authoredSources = progressionPath.filter(sourceGuildId => SKILL_TREES[sourceGuildId]);
  if (authoredSources.length === 0) {
    return null;
  }

  const sourceTrees = authoredSources.map(sourceGuildId => ({
    guildId: sourceGuildId,
    name: SKILL_TREES[sourceGuildId].name,
    authored: true,
    inherited: sourceGuildId !== currentGuildId
  }));
  const inheritedSources = sourceTrees
    .filter(source => source.inherited)
    .map(source => source.guildId);
  const unavailableSources = progressionPath.filter(sourceGuildId => !SKILL_TREES[sourceGuildId]);

  const branches = authoredSources.flatMap(sourceGuildId => {
    const sourceTree = SKILL_TREES[sourceGuildId];
    return sourceTree.branches.map(branch => ({
      ...branch,
      name: `${sourceTree.name}: ${branch.name}`,
      sourceGuildId,
      sourceGuildName: sourceTree.name,
      inherited: sourceGuildId !== currentGuildId
    }));
  });

  const displayName = currentGuildId
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    ...(currentTree || {}),
    name: currentTree?.name || `${displayName} Training`,
    description: currentTree?.description ||
      `Training inherited from ${sourceTrees.map(source => source.name).join(' and ')}`,
    branches,
    trainingClass: currentGuildId,
    progressionPath,
    authoredSources,
    inheritedSources,
    unavailableSources,
    sourceTrees,
    currentClassHasAuthoredTree: Boolean(currentTree)
  };
}

function findSkillInTrainingTree(guildId, skillId) {
  const trainingTree = buildTrainingSkillTree(guildId);
  if (!trainingTree || typeof skillId !== 'string') {
    return null;
  }

  for (const branch of trainingTree.branches) {
    const skill = branch.skills.find(candidate => candidate.id === skillId);
    if (skill) {
      return skill;
    }
  }

  return null;
}

export {
  SKILL_TREES,
  getGuildProgressionPath,
  buildTrainingSkillTree,
  findSkillInTrainingTree
};
