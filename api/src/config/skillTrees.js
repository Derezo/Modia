// Skill definitions by guild (class)
// Combat properties: power (% damage), range, mpCost, effect (status to apply), effectDuration, effectChance
const SKILL_TREES = {
  warrior: {
    name: 'Warrior Guild',
    description: 'Masters of physical combat and defense',
    branches: [
      {
        name: 'Offense',
        skills: [
          { id: 'power_strike', name: 'Power Strike', description: 'A powerful melee attack dealing 150% damage', maxLevel: 10, baseCost: 50, type: 'active', icon: '⚔️', power: 150, range: 1, mpCost: 10 },
          { id: 'cleave', name: 'Cleave', description: 'Attack all adjacent enemies for 120% damage', maxLevel: 10, baseCost: 100, type: 'active', icon: '🗡️', requires: { power_strike: 3 }, power: 120, range: 1, mpCost: 15, aoeRadius: 1 },
          { id: 'rage', name: 'Rage', description: 'Increase attack by 20% for 3 turns', maxLevel: 5, baseCost: 150, type: 'active', icon: '😤', requires: { cleave: 5 }, power: 0, range: 0, mpCost: 20, selfBuff: 'rage', buffDuration: 3 },
          { id: 'rend', name: 'Rend', description: 'Attack that causes bleeding (3% HP/turn for 3 turns)', maxLevel: 10, baseCost: 80, type: 'active', icon: '🩸', requires: { power_strike: 2 }, power: 100, range: 1, mpCost: 12, effect: 'bleed', effectDuration: 3, effectChance: 0.8 }
        ]
      },
      {
        name: 'Defense',
        skills: [
          { id: 'shield_bash', name: 'Shield Bash', description: 'Stun enemy for 1 turn (80% damage)', maxLevel: 10, baseCost: 50, type: 'active', icon: '🛡️', power: 80, range: 1, mpCost: 8, effect: 'stun', effectDuration: 1, effectChance: 0.7 },
          { id: 'fortify', name: 'Fortify', description: 'Increase defense by 30% for 3 turns', maxLevel: 5, baseCost: 100, type: 'active', icon: '🏰', requires: { shield_bash: 3 }, power: 0, range: 0, mpCost: 15, selfBuff: 'fortify', buffDuration: 3 },
          { id: 'taunt', name: 'Taunt', description: 'Force enemies to attack you for 2 turns', maxLevel: 5, baseCost: 150, type: 'active', icon: '📣', requires: { fortify: 3 }, power: 0, range: 3, mpCost: 10, effect: 'taunt', effectDuration: 2, effectChance: 1.0 }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'warrior_strength', name: 'Warrior Strength', description: '+5% STR per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '💪' },
          { id: 'iron_skin', name: 'Iron Skin', description: '+5% VIT per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🛡️' }
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
          { id: 'fireball', name: 'Fireball', description: 'Launch a ball of fire (130% MATK, burn)', maxLevel: 10, baseCost: 50, type: 'active', icon: '🔥', power: 130, range: 4, mpCost: 18, damageType: 'magical', effect: 'burn', effectDuration: 2, effectChance: 0.5 },
          { id: 'inferno', name: 'Inferno', description: 'Burn all enemies in area (180% MATK)', maxLevel: 10, baseCost: 150, type: 'active', icon: '🌋', requires: { fireball: 5 }, power: 180, range: 4, mpCost: 35, damageType: 'magical', aoeRadius: 2, effect: 'burn', effectDuration: 3, effectChance: 0.8 }
        ]
      },
      {
        name: 'Ice',
        skills: [
          { id: 'ice_shard', name: 'Ice Shard', description: 'Pierce with ice (100% MATK, slow)', maxLevel: 10, baseCost: 50, type: 'active', icon: '❄️', power: 100, range: 4, mpCost: 8, damageType: 'magical', effect: 'slow', effectDuration: 2, effectChance: 0.6 },
          { id: 'blizzard', name: 'Blizzard', description: 'Freeze enemies in area (110% MATK)', maxLevel: 10, baseCost: 150, type: 'active', icon: '🌨️', requires: { ice_shard: 5 }, power: 110, range: 4, mpCost: 30, damageType: 'magical', aoeRadius: 2, effect: 'freeze', effectDuration: 1, effectChance: 0.5 }
        ]
      },
      {
        name: 'Lightning',
        skills: [
          { id: 'lightning_bolt', name: 'Lightning Bolt', description: 'Strike with lightning (150% MATK, stun)', maxLevel: 10, baseCost: 50, type: 'active', icon: '⚡', power: 150, range: 5, mpCost: 15, damageType: 'magical', effect: 'stun', effectDuration: 1, effectChance: 0.15 },
          { id: 'chain_lightning', name: 'Chain Lightning', description: 'Lightning that chains (80% per target)', maxLevel: 10, baseCost: 150, type: 'active', icon: '⛈️', requires: { lightning_bolt: 5 }, power: 80, range: 4, mpCost: 22, damageType: 'magical', chainTargets: 3 }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'wizard_intellect', name: 'Wizard Intellect', description: '+5% INT per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🧠' },
          { id: 'mana_flow', name: 'Mana Flow', description: '+5% MP per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '💧' }
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
          { id: 'palm_strike', name: 'Palm Strike', description: 'Quick palm attack (100% damage)', maxLevel: 10, baseCost: 50, type: 'active', icon: '🤚', power: 100, range: 1, mpCost: 5 },
          { id: 'flying_kick', name: 'Flying Kick', description: 'Jump to target (130% damage)', maxLevel: 10, baseCost: 100, type: 'active', icon: '🦶', requires: { palm_strike: 3 }, power: 130, range: 3, mpCost: 15 },
          { id: 'thousand_fists', name: 'Thousand Fists', description: 'Rapid hits (5x 40% damage)', maxLevel: 5, baseCost: 200, type: 'active', icon: '👊', requires: { flying_kick: 5 }, power: 40, range: 1, mpCost: 25, hits: 5 }
        ]
      },
      {
        name: 'Spirit',
        skills: [
          { id: 'meditation', name: 'Meditation', description: 'Recover 15% HP and MP', maxLevel: 10, baseCost: 50, type: 'active', icon: '🧘', power: 0, range: 0, mpCost: 0, healPercent: 15, mpRestore: 15 },
          { id: 'inner_peace', name: 'Inner Peace', description: 'Remove all debuffs, heal 20% HP', maxLevel: 5, baseCost: 100, type: 'active', icon: '☮️', requires: { meditation: 3 }, power: 0, range: 0, mpCost: 20, cleanse: true, healPercent: 20 }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'monk_agility', name: 'Monk Agility', description: '+5% AGI per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🏃' },
          { id: 'chi_flow', name: 'Chi Flow', description: '+2% HP regen per level', maxLevel: 10, baseCost: 50, type: 'passive', icon: '☯️' }
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
          { id: 'potion_toss', name: 'Potion Toss', description: 'Heal ally for 20% HP', maxLevel: 10, baseCost: 50, type: 'active', icon: '🧪', power: 0, range: 3, mpCost: 8, healPercent: 20, targetAlly: true },
          { id: 'mega_potion', name: 'Mega Potion', description: 'Heal all allies for 30% HP', maxLevel: 5, baseCost: 150, type: 'active', icon: '💉', requires: { potion_toss: 5 }, power: 0, range: 0, mpCost: 25, healPercent: 30, targetAllAllies: true }
        ]
      },
      {
        name: 'Offense',
        skills: [
          { id: 'acid_flask', name: 'Acid Flask', description: 'Acid damage + armor reduction (80% MATK)', maxLevel: 10, baseCost: 50, type: 'active', icon: '⚗️', power: 80, range: 3, mpCost: 8, damageType: 'magical', effect: 'corrode', effectDuration: 3, effectChance: 0.7 },
          { id: 'poison_cloud', name: 'Poison Cloud', description: 'AoE poison (5% HP/turn for 3 turns)', maxLevel: 10, baseCost: 100, type: 'active', icon: '☠️', requires: { acid_flask: 3 }, power: 60, range: 4, mpCost: 18, damageType: 'magical', aoeRadius: 2, effect: 'poison', effectDuration: 3, effectChance: 0.9 }
        ]
      },
      {
        name: 'Utility',
        skills: [
          { id: 'smoke_bomb', name: 'Smoke Bomb', description: 'Blind enemies in area (50% miss for 2 turns)', maxLevel: 5, baseCost: 50, type: 'active', icon: '💨', power: 0, range: 3, mpCost: 10, aoeRadius: 2, effect: 'blind', effectDuration: 2, effectChance: 0.8 },
          { id: 'haste_potion', name: 'Haste Potion', description: 'Grant ally haste (+1 move for 3 turns)', maxLevel: 5, baseCost: 100, type: 'active', icon: '⏱️', power: 0, range: 3, mpCost: 12, targetAlly: true, effect: 'haste', effectDuration: 3, effectChance: 1.0 }
        ]
      },
      {
        name: 'Passive',
        skills: [
          { id: 'chemist_luck', name: 'Chemist Luck', description: '+5% LCK per level', maxLevel: 20, baseCost: 30, type: 'passive', icon: '🍀' },
          { id: 'efficient_mixing', name: 'Efficient Mixing', description: 'Item effects +10% per level', maxLevel: 10, baseCost: 50, type: 'passive', icon: '📈' }
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
          { id: 'rage_strike', name: 'Rage Strike', description: '140% ATK damage, gain 10 rage', maxLevel: 10, baseCost: 100, type: 'active', icon: '😡', power: 140, range: 1, mpCost: 15 },
          { id: 'blood_frenzy', name: 'Blood Frenzy', description: '+20% ATK per kill for 3 turns', maxLevel: 10, baseCost: 150, type: 'active', icon: '🩸', requires: { rage_strike: 3 }, power: 0, range: 0, mpCost: 20, selfBuff: 'frenzy', buffDuration: 3 },
          { id: 'enraged_fury', name: 'Enraged Fury', description: '180% ATK, +5% per rage point', maxLevel: 10, baseCost: 200, type: 'active', icon: '💢', requires: { blood_frenzy: 5 }, power: 180, range: 1, mpCost: 30 },
          { id: 'bloodlust', name: 'Bloodlust', description: 'Killing blow heals 10% HP', maxLevel: 5, baseCost: 150, type: 'passive', icon: '❤️‍🔥' },
          { id: 'reckless_power', name: 'Reckless Power', description: '+50% ATK, -25% DEF for 3 turns', maxLevel: 10, baseCost: 200, type: 'active', icon: '⚡', requires: { enraged_fury: 3 }, power: 0, range: 0, mpCost: 25, selfBuff: 'reckless', buffDuration: 3 },
          { id: 'berserker_rage', name: 'Berserker Rage', description: '+100% ATK, cannot use skills, 3 turns', maxLevel: 5, baseCost: 300, type: 'active', icon: '🔥', requires: { reckless_power: 5 }, power: 0, range: 0, mpCost: 50, selfBuff: 'berserker', buffDuration: 3 },
          { id: 'unstoppable', name: 'Unstoppable', description: 'Immune to stun/slow while in rage', maxLevel: 5, baseCost: 250, type: 'passive', icon: '🦸', requires: { berserker_rage: 3 } },
          { id: 'rampage', name: 'Rampage', description: 'Attack all enemies in range, +10% per hit', maxLevel: 5, baseCost: 500, type: 'active', icon: '💥', requires: { unstoppable: 3 }, power: 100, range: 2, mpCost: 70, aoeRadius: 2 }
        ]
      },
      {
        name: 'Recklessness',
        skills: [
          { id: 'reckless_charge', name: 'Reckless Charge', description: 'Rush + 150% ATK, take 10% HP damage', maxLevel: 10, baseCost: 100, type: 'active', icon: '🏃', power: 150, range: 5, mpCost: 20 },
          { id: 'wild_swing', name: 'Wild Swing', description: '200% ATK, 50% chance to hit', maxLevel: 10, baseCost: 100, type: 'active', icon: '🌀', power: 200, range: 1, mpCost: 15 },
          { id: 'berserker_leap', name: 'Berserker Leap', description: 'Jump + AoE 100% ATK, take 5% HP', maxLevel: 10, baseCost: 150, type: 'active', icon: '🦘', requires: { reckless_charge: 3, wild_swing: 3 }, power: 100, range: 4, mpCost: 25, aoeRadius: 1 },
          { id: 'martyrs_resolve', name: "Martyr's Resolve", description: '+100% damage when below 30% HP', maxLevel: 5, baseCost: 200, type: 'active', icon: '✝️', requires: { berserker_leap: 5 }, power: 0, range: 0, mpCost: 30, selfBuff: 'martyr', buffDuration: 3 },
          { id: 'death_wish', name: 'Death Wish', description: '+1% ATK per 1% missing HP', maxLevel: 10, baseCost: 250, type: 'passive', icon: '💀', requires: { martyrs_resolve: 3 } },
          { id: 'final_stand', name: 'Final Stand', description: 'Survive at 1 HP once per battle', maxLevel: 3, baseCost: 400, type: 'active', icon: '🛡️', requires: { death_wish: 5 }, power: 0, range: 0, mpCost: 40 },
          { id: 'self_destruction', name: 'Self-Destruction', description: 'Deal HP as damage to all enemies, KO self', maxLevel: 1, baseCost: 500, type: 'active', icon: '☢️', requires: { final_stand: 3 }, power: 0, range: 3, mpCost: 0, aoeRadius: 3 }
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
          { id: 'arcane_bolt', name: 'Arcane Bolt', description: '120% MATK, ignores resistance', maxLevel: 10, baseCost: 100, type: 'active', icon: '✨', power: 120, range: 5, mpCost: 12, damageType: 'magical' },
          { id: 'mana_shield', name: 'Mana Shield', description: 'Damage reduces MP instead of HP', maxLevel: 10, baseCost: 150, type: 'active', icon: '🛡️', requires: { arcane_bolt: 3 }, power: 0, range: 0, mpCost: 20, selfBuff: 'mana_shield', buffDuration: 3 },
          { id: 'spell_amplify', name: 'Spell Amplify', description: 'Next spell +75% damage', maxLevel: 5, baseCost: 200, type: 'active', icon: '📈', requires: { mana_shield: 3 }, power: 0, range: 0, mpCost: 25, selfBuff: 'amplify', buffDuration: 1 },
          { id: 'arcane_mastery', name: 'Arcane Mastery', description: '+20% spell damage', maxLevel: 10, baseCost: 200, type: 'passive', icon: '📚', requires: { spell_amplify: 3 } },
          { id: 'penetrating_magic', name: 'Penetrating Magic', description: 'Ignore 25% magic resistance', maxLevel: 5, baseCost: 250, type: 'passive', icon: '🔮', requires: { arcane_mastery: 5 } },
          { id: 'arcane_explosion', name: 'Arcane Explosion', description: '250% MATK, 3-tile AoE', maxLevel: 10, baseCost: 300, type: 'active', icon: '💥', requires: { penetrating_magic: 3 }, power: 250, range: 4, mpCost: 50, damageType: 'magical', aoeRadius: 3 },
          { id: 'infinite_mana', name: 'Infinite Mana', description: '20% chance spell costs no MP', maxLevel: 5, baseCost: 350, type: 'passive', icon: '♾️', requires: { arcane_explosion: 5 } },
          { id: 'armageddon', name: 'Armageddon', description: '400% MATK to all enemies', maxLevel: 5, baseCost: 500, type: 'active', icon: '🌋', requires: { infinite_mana: 3 }, power: 400, range: 10, mpCost: 100, damageType: 'magical', aoeRadius: 10 }
        ]
      },
      {
        name: 'Elemental Mastery',
        skills: [
          { id: 'element_shift', name: 'Element Shift', description: 'Change spell element mid-cast', maxLevel: 5, baseCost: 100, type: 'active', icon: '🔄', power: 0, range: 0, mpCost: 10 },
          { id: 'tri_element', name: 'Tri-Element', description: 'Fire+Ice+Lightning, 100% each', maxLevel: 10, baseCost: 200, type: 'active', icon: '🌈', requires: { element_shift: 3 }, power: 100, range: 4, mpCost: 30, damageType: 'magical', hits: 3 },
          { id: 'prismatic_blast', name: 'Prismatic Blast', description: 'Random element, 200% MATK', maxLevel: 10, baseCost: 200, type: 'active', icon: '💎', requires: { tri_element: 5 }, power: 200, range: 5, mpCost: 40, damageType: 'magical' },
          { id: 'elemental_shield', name: 'Elemental Shield', description: 'Resist current highest element +50%', maxLevel: 5, baseCost: 200, type: 'active', icon: '🔰', requires: { prismatic_blast: 3 }, power: 0, range: 0, mpCost: 25, selfBuff: 'elem_shield', buffDuration: 3 },
          { id: 'all_elements', name: 'All Elements', description: '+10% all elemental damage', maxLevel: 10, baseCost: 250, type: 'passive', icon: '🌐', requires: { elemental_shield: 3 } },
          { id: 'elemental_overload', name: 'Elemental Overload', description: 'Hit weakness for +100% damage', maxLevel: 5, baseCost: 350, type: 'active', icon: '⚡', requires: { all_elements: 5 }, power: 200, range: 5, mpCost: 60, damageType: 'magical' },
          { id: 'avatar_of_elements', name: 'Avatar of Elements', description: 'Cast 3 elemental spells instantly', maxLevel: 3, baseCost: 500, type: 'active', icon: '👑', requires: { elemental_overload: 3 }, power: 150, range: 5, mpCost: 80, damageType: 'magical', hits: 3 }
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
          { id: 'shadow_step', name: 'Shadow Step', description: 'Teleport behind target', maxLevel: 10, baseCost: 100, type: 'active', icon: '👤', power: 0, range: 4, mpCost: 15 },
          { id: 'vanish', name: 'Vanish', description: 'Become invisible for 2 turns', maxLevel: 10, baseCost: 150, type: 'active', icon: '🌫️', requires: { shadow_step: 3 }, power: 0, range: 0, mpCost: 20, selfBuff: 'invisible', buffDuration: 2 },
          { id: 'backstab', name: 'Backstab', description: '+100% damage from behind', maxLevel: 10, baseCost: 150, type: 'active', icon: '🗡️', requires: { vanish: 3 }, power: 200, range: 1, mpCost: 18 },
          { id: 'assassination', name: 'Assassination', description: '300% ATK if invisible', maxLevel: 10, baseCost: 250, type: 'active', icon: '☠️', requires: { backstab: 5 }, power: 300, range: 1, mpCost: 35 },
          { id: 'silent_step', name: 'Silent Step', description: 'Movement does not reveal', maxLevel: 5, baseCost: 200, type: 'passive', icon: '🔇', requires: { assassination: 3 } },
          { id: 'shadow_clone', name: 'Shadow Clone', description: 'Create clone with 25% stats', maxLevel: 5, baseCost: 300, type: 'active', icon: '👥', requires: { silent_step: 3 }, power: 0, range: 0, mpCost: 40 },
          { id: 'death_mark', name: 'Death Mark', description: 'Target takes +50% damage for 3 turns', maxLevel: 5, baseCost: 300, type: 'active', icon: '💀', requires: { shadow_clone: 3 }, power: 0, range: 3, mpCost: 30, effect: 'marked', effectDuration: 3, effectChance: 1.0 },
          { id: 'one_thousand_cuts', name: 'One Thousand Cuts', description: '20 hits at 20% ATK from stealth', maxLevel: 5, baseCost: 500, type: 'active', icon: '⚔️', requires: { death_mark: 3 }, power: 20, range: 1, mpCost: 70, hits: 20 }
        ]
      },
      {
        name: 'Ninjutsu',
        skills: [
          { id: 'shuriken', name: 'Shuriken', description: '80% ATK ranged attack', maxLevel: 10, baseCost: 100, type: 'active', icon: '✴️', power: 80, range: 4, mpCost: 10 },
          { id: 'kunai_barrage', name: 'Kunai Barrage', description: '3 shurikens at 50% ATK', maxLevel: 10, baseCost: 150, type: 'active', icon: '🔪', requires: { shuriken: 3 }, power: 50, range: 4, mpCost: 18, hits: 3 },
          { id: 'ninja_smoke_bomb', name: 'Smoke Bomb', description: 'AoE blind + evasion boost', maxLevel: 10, baseCost: 150, type: 'active', icon: '💨', requires: { kunai_barrage: 3 }, power: 0, range: 3, mpCost: 15, aoeRadius: 2, effect: 'blind', effectDuration: 2, effectChance: 0.8 },
          { id: 'poison_blade', name: 'Poison Blade', description: '100% ATK + lethal poison', maxLevel: 10, baseCost: 200, type: 'active', icon: '🗡️☠️', requires: { ninja_smoke_bomb: 3 }, power: 100, range: 1, mpCost: 25, effect: 'poison', effectDuration: 3, effectChance: 0.9 },
          { id: 'ninja_tools', name: 'Ninja Tools', description: '+20% thrown weapon damage', maxLevel: 10, baseCost: 200, type: 'passive', icon: '🎒', requires: { poison_blade: 3 } },
          { id: 'explosive_tag', name: 'Explosive Tag', description: 'Place trap, 200% ATK when triggered', maxLevel: 5, baseCost: 300, type: 'active', icon: '💣', requires: { ninja_tools: 5 }, power: 200, range: 4, mpCost: 35 },
          { id: 'shadow_arts', name: 'Shadow Arts', description: 'All attacks +50% from any angle for 3 turns', maxLevel: 3, baseCost: 500, type: 'active', icon: '🥷', requires: { explosive_tag: 3 }, power: 0, range: 0, mpCost: 60, selfBuff: 'shadow_arts', buffDuration: 3 }
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
          { id: 'transmute', name: 'Transmute', description: 'Convert debuff to buff (or reverse)', maxLevel: 10, baseCost: 100, type: 'active', icon: '🔄', power: 0, range: 3, mpCost: 20 },
          { id: 'gold_touch', name: 'Gold Touch', description: '+50% gold from target enemy', maxLevel: 10, baseCost: 100, type: 'active', icon: '💰', power: 0, range: 1, mpCost: 15 },
          { id: 'element_convert', name: 'Element Convert', description: "Change enemy's elemental weakness", maxLevel: 5, baseCost: 150, type: 'active', icon: '⚗️', requires: { transmute: 3, gold_touch: 3 }, power: 0, range: 4, mpCost: 25 },
          { id: 'philosophers_stone', name: "Philosopher's Stone", description: '+25% potion effectiveness', maxLevel: 10, baseCost: 200, type: 'passive', icon: '💎', requires: { element_convert: 3 } },
          { id: 'matter_shift', name: 'Matter Shift', description: 'Swap positions with ally or enemy', maxLevel: 5, baseCost: 200, type: 'active', icon: '↔️', requires: { philosophers_stone: 5 }, power: 0, range: 3, mpCost: 30 },
          { id: 'equivalent_exchange', name: 'Equivalent Exchange', description: 'Trade HP for MP or reverse', maxLevel: 5, baseCost: 250, type: 'active', icon: '⚖️', requires: { matter_shift: 3 }, power: 0, range: 0, mpCost: 40 },
          { id: 'perfect_transmutation', name: 'Perfect Transmutation', description: 'Transform enemy to weaker form for 3 turns', maxLevel: 3, baseCost: 500, type: 'active', icon: '✨', requires: { equivalent_exchange: 3 }, power: 0, range: 4, mpCost: 80, effect: 'transmuted', effectDuration: 3, effectChance: 0.7 }
        ]
      },
      {
        name: 'Explosives',
        skills: [
          { id: 'volatile_mix', name: 'Volatile Mix', description: '150% ATK bomb + random status', maxLevel: 10, baseCost: 100, type: 'active', icon: '🧪', power: 150, range: 4, mpCost: 18, damageType: 'magical' },
          { id: 'napalm', name: 'Napalm', description: '2-tile fire zone for 3 turns', maxLevel: 10, baseCost: 150, type: 'active', icon: '🔥', requires: { volatile_mix: 3 }, power: 80, range: 4, mpCost: 22, aoeRadius: 2, effect: 'burn', effectDuration: 3, effectChance: 1.0 },
          { id: 'elemental_bomb', name: 'Elemental Bomb', description: 'Choose fire/ice/lightning, 180% ATK', maxLevel: 10, baseCost: 200, type: 'active', icon: '💣', requires: { napalm: 3 }, power: 180, range: 5, mpCost: 30, damageType: 'magical' },
          { id: 'scatter_shot', name: 'Scatter Shot', description: '5 random targets, 60% ATK each', maxLevel: 10, baseCost: 200, type: 'active', icon: '💥', requires: { elemental_bomb: 3 }, power: 60, range: 5, mpCost: 35, hits: 5 },
          { id: 'unstable_mixture', name: 'Unstable Mixture', description: '+15% bomb crit chance', maxLevel: 10, baseCost: 250, type: 'passive', icon: '⚠️', requires: { scatter_shot: 3 } },
          { id: 'tactical_nuke', name: 'Tactical Nuke', description: '250% ATK, 4-tile AoE', maxLevel: 5, baseCost: 350, type: 'active', icon: '☢️', requires: { unstable_mixture: 5 }, power: 250, range: 6, mpCost: 55, damageType: 'magical', aoeRadius: 4 },
          { id: 'alchemical_warfare', name: 'Alchemical Warfare', description: 'All enemies: 200% + burn + poison + slow', maxLevel: 3, baseCost: 500, type: 'active', icon: '🌍', requires: { tactical_nuke: 3 }, power: 200, range: 10, mpCost: 90, damageType: 'magical', aoeRadius: 10, effect: 'burn', effectDuration: 3, effectChance: 1.0 }
        ]
      }
    ]
  }
};

module.exports = { SKILL_TREES };
