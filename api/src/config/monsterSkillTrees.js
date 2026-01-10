/**
 * Monster Skill Trees - Skill definitions by monster archetype
 *
 * Monster archetypes define thematic skill pools that match their nature.
 * Skills follow the same structure as player guild skills, enabling unified
 * processing in the battle system.
 *
 * Properties:
 * - power: Damage percentage (100 = normal damage)
 * - range: Attack range in tiles (Manhattan distance)
 * - mpCost: MP consumed
 * - damageType: 'physical' or 'magical'
 * - element: Fire, ice, lightning, dark, poison, earth (optional)
 * - effect: Status effect to apply
 * - effectDuration: Turns effect lasts
 * - effectChance: Probability to apply (0-1)
 * - aoeRadius: Area of effect radius
 * - aoePattern: 'circle', 'cone', 'line'
 * - priority: AI usage priority (1-10, higher = more likely to use)
 */

const MONSTER_SKILL_TREES = {
  // ==================== BEAST ARCHETYPE ====================
  beast: {
    name: 'Beast',
    description: 'Wild creatures relying on natural weapons',
    branches: [
      {
        name: 'Predator',
        skills: [
          { id: 'bite', name: 'Bite', type: 'active', power: 100, range: 1, mpCost: 0, damageType: 'physical', priority: 8, description: 'Basic bite attack' },
          { id: 'claw_swipe', name: 'Claw Swipe', type: 'active', power: 110, range: 1, mpCost: 5, damageType: 'physical', aoeRadius: 1, priority: 7, description: 'Swipe at adjacent targets' },
          { id: 'pounce', name: 'Pounce', type: 'active', power: 130, range: 3, mpCost: 10, damageType: 'physical', movement: true, priority: 9, description: 'Leap to target and attack' },
          { id: 'ferocious_roar', name: 'Ferocious Roar', type: 'active', power: 0, range: 3, mpCost: 15, effect: 'fear', effectDuration: 2, effectChance: 0.6, aoeRadius: 3, priority: 5, description: 'Terrify nearby enemies' },
          { id: 'rending_bite', name: 'Rending Bite', type: 'active', power: 120, range: 1, mpCost: 12, damageType: 'physical', effect: 'bleed', effectDuration: 3, effectChance: 0.7, priority: 8, description: 'Bite that causes bleeding' },
          { id: 'savage_assault', name: 'Savage Assault', type: 'active', power: 80, range: 1, mpCost: 18, damageType: 'physical', hits: 3, priority: 7, description: 'Rapid series of attacks' }
        ]
      },
      {
        name: 'Pack',
        skills: [
          { id: 'howl', name: 'Howl', type: 'active', power: 0, range: 4, mpCost: 10, selfBuff: 'pack_bonus', buffDuration: 3, targetAllAllies: true, priority: 6, description: 'Boost pack damage' },
          { id: 'coordinated_strike', name: 'Coordinated Strike', type: 'active', power: 80, range: 1, mpCost: 8, damageType: 'physical', bonusPerAlly: 20, priority: 7, description: '+20% per nearby ally' },
          { id: 'pack_hunter', name: 'Pack Hunter', type: 'active', power: 150, range: 1, mpCost: 15, damageType: 'physical', requiresAllyNear: true, priority: 8, description: 'Powerful attack when allies nearby' }
        ]
      }
    ]
  },

  // ==================== DRAGON ARCHETYPE ====================
  dragon: {
    name: 'Dragon',
    description: 'Ancient wyrms with devastating breath attacks',
    branches: [
      {
        name: 'Breath',
        skills: [
          { id: 'fire_breath', name: 'Fire Breath', type: 'active', power: 150, range: 4, mpCost: 20, damageType: 'magical', element: 'fire', aoePattern: 'cone', aoeRadius: 2, effect: 'burn', effectDuration: 2, effectChance: 0.6, priority: 10, description: 'Cone of fire dealing massive damage' },
          { id: 'frost_breath', name: 'Frost Breath', type: 'active', power: 130, range: 4, mpCost: 18, damageType: 'magical', element: 'ice', aoePattern: 'cone', aoeRadius: 2, effect: 'slow', effectDuration: 2, effectChance: 0.7, priority: 9, description: 'Freezing breath that slows' },
          { id: 'lightning_breath', name: 'Lightning Breath', type: 'active', power: 140, range: 5, mpCost: 22, damageType: 'magical', element: 'lightning', aoePattern: 'line', aoeRadius: 1, effect: 'stun', effectDuration: 1, effectChance: 0.3, priority: 9, description: 'Lightning bolt in a line' },
          { id: 'poison_breath', name: 'Poison Breath', type: 'active', power: 80, range: 3, mpCost: 15, damageType: 'magical', element: 'poison', aoePattern: 'cone', aoeRadius: 2, effect: 'poison', effectDuration: 4, effectChance: 0.9, priority: 7, description: 'Toxic cloud' }
        ]
      },
      {
        name: 'Physical',
        skills: [
          { id: 'tail_swipe', name: 'Tail Swipe', type: 'active', power: 120, range: 2, mpCost: 10, damageType: 'physical', aoeRadius: 2, aoePattern: 'arc_behind', effect: 'knockback', effectChance: 0.5, priority: 8, description: 'Sweep tail hitting all behind' },
          { id: 'claw_rend', name: 'Claw Rend', type: 'active', power: 140, range: 1, mpCost: 8, damageType: 'physical', effect: 'bleed', effectDuration: 3, effectChance: 0.8, priority: 8, description: 'Devastating claw attack' },
          { id: 'wing_buffet', name: 'Wing Buffet', type: 'active', power: 80, range: 2, mpCost: 12, damageType: 'physical', aoeRadius: 2, effect: 'knockback', effectChance: 0.7, priority: 6, description: 'Push back nearby enemies' },
          { id: 'crushing_stomp', name: 'Crushing Stomp', type: 'active', power: 160, range: 1, mpCost: 15, damageType: 'physical', aoeRadius: 1, effect: 'stun', effectDuration: 1, effectChance: 0.4, priority: 7, description: 'Ground pound stunning nearby' }
        ]
      },
      {
        name: 'Presence',
        skills: [
          { id: 'intimidating_roar', name: 'Intimidating Roar', type: 'active', power: 0, range: 4, mpCost: 20, effect: 'fear', effectDuration: 2, effectChance: 0.7, aoeRadius: 4, priority: 6, description: 'Terrify all nearby enemies' },
          { id: 'dragon_scales', name: 'Dragon Scales', type: 'active', power: 0, range: 0, mpCost: 25, selfBuff: 'fortify', buffDuration: 3, priority: 4, description: 'Harden scales for defense' },
          { id: 'ancient_presence', name: 'Ancient Presence', type: 'active', power: 0, range: 5, mpCost: 30, effect: 'weaken', effectDuration: 3, effectChance: 1.0, aoeRadius: 5, targetAllEnemies: true, priority: 5, description: 'Weaken all enemies' }
        ]
      }
    ]
  },

  // ==================== UNDEAD ARCHETYPE ====================
  undead: {
    name: 'Undead',
    description: 'Risen creatures draining life force',
    branches: [
      {
        name: 'Necrotic',
        skills: [
          { id: 'life_drain', name: 'Life Drain', type: 'active', power: 100, range: 2, mpCost: 12, damageType: 'magical', element: 'dark', lifesteal: 0.5, priority: 9, description: 'Drain HP from target' },
          { id: 'death_touch', name: 'Death Touch', type: 'active', power: 130, range: 1, mpCost: 15, damageType: 'magical', element: 'dark', effect: 'curse', effectDuration: 3, effectChance: 0.5, priority: 8, description: 'Cursing touch attack' },
          { id: 'soul_siphon', name: 'Soul Siphon', type: 'active', power: 80, range: 3, mpCost: 20, damageType: 'magical', element: 'dark', lifesteal: 1.0, mpDrain: 0.3, priority: 7, description: 'Drain HP and MP' },
          { id: 'wail_of_doom', name: 'Wail of Doom', type: 'active', power: 60, range: 4, mpCost: 25, damageType: 'magical', element: 'dark', aoeRadius: 3, effect: 'fear', effectDuration: 2, effectChance: 0.8, priority: 6, description: 'Terrifying wail damages and fears' }
        ]
      },
      {
        name: 'Physical',
        skills: [
          { id: 'bone_shatter', name: 'Bone Shatter', type: 'active', power: 110, range: 1, mpCost: 8, damageType: 'physical', effect: 'corrode', effectDuration: 2, effectChance: 0.6, priority: 7, description: 'Attack that reduces armor' },
          { id: 'ghoul_bite', name: 'Ghoul Bite', type: 'active', power: 90, range: 1, mpCost: 5, damageType: 'physical', effect: 'poison', effectDuration: 3, effectChance: 0.7, priority: 8, description: 'Poisonous bite' },
          { id: 'relentless_grasp', name: 'Relentless Grasp', type: 'active', power: 70, range: 1, mpCost: 10, damageType: 'physical', effect: 'root', effectDuration: 2, effectChance: 0.8, priority: 7, description: 'Grab and hold target' },
          { id: 'unholy_strike', name: 'Unholy Strike', type: 'active', power: 140, range: 1, mpCost: 15, damageType: 'physical', element: 'dark', priority: 8, description: 'Powerful dark-infused attack' }
        ]
      }
    ]
  },

  // ==================== ELEMENTAL ARCHETYPE ====================
  elemental: {
    name: 'Elemental',
    description: 'Living manifestations of primal forces',
    branches: [
      {
        name: 'Fire',
        skills: [
          { id: 'flame_burst', name: 'Flame Burst', type: 'active', power: 120, range: 3, mpCost: 10, damageType: 'magical', element: 'fire', effect: 'burn', effectDuration: 2, effectChance: 0.5, priority: 8, description: 'Burst of flame' },
          { id: 'fire_nova', name: 'Fire Nova', type: 'active', power: 100, range: 0, mpCost: 20, damageType: 'magical', element: 'fire', aoeRadius: 2, effect: 'burn', effectDuration: 2, effectChance: 0.7, priority: 7, description: 'Explosion around self' },
          { id: 'immolate', name: 'Immolate', type: 'active', power: 60, range: 3, mpCost: 15, damageType: 'magical', element: 'fire', effect: 'burn', effectDuration: 5, effectChance: 1.0, priority: 6, description: 'Set target on fire' }
        ]
      },
      {
        name: 'Ice',
        skills: [
          { id: 'frost_bolt', name: 'Frost Bolt', type: 'active', power: 100, range: 4, mpCost: 8, damageType: 'magical', element: 'ice', effect: 'slow', effectDuration: 2, effectChance: 0.6, priority: 8, description: 'Bolt of ice' },
          { id: 'ice_storm', name: 'Ice Storm', type: 'active', power: 90, range: 4, mpCost: 25, damageType: 'magical', element: 'ice', aoeRadius: 2, effect: 'freeze', effectDuration: 1, effectChance: 0.4, priority: 7, description: 'Storm of ice' },
          { id: 'frozen_tomb', name: 'Frozen Tomb', type: 'active', power: 0, range: 3, mpCost: 20, effect: 'freeze', effectDuration: 2, effectChance: 0.8, priority: 6, description: 'Freeze target solid' }
        ]
      },
      {
        name: 'Lightning',
        skills: [
          { id: 'shock', name: 'Shock', type: 'active', power: 110, range: 4, mpCost: 8, damageType: 'magical', element: 'lightning', effect: 'stun', effectDuration: 1, effectChance: 0.2, priority: 8, description: 'Electric shock' },
          { id: 'chain_lightning_monster', name: 'Chain Lightning', type: 'active', power: 80, range: 4, mpCost: 18, damageType: 'magical', element: 'lightning', chainTargets: 3, priority: 9, description: 'Jumps between targets' },
          { id: 'thunderbolt', name: 'Thunderbolt', type: 'active', power: 180, range: 5, mpCost: 30, damageType: 'magical', element: 'lightning', effect: 'stun', effectDuration: 1, effectChance: 0.5, priority: 8, description: 'Massive lightning strike' }
        ]
      },
      {
        name: 'Earth',
        skills: [
          { id: 'rock_throw', name: 'Rock Throw', type: 'active', power: 100, range: 4, mpCost: 8, damageType: 'physical', element: 'earth', priority: 8, description: 'Hurl a boulder' },
          { id: 'earthquake', name: 'Earthquake', type: 'active', power: 80, range: 0, mpCost: 25, damageType: 'physical', element: 'earth', aoeRadius: 3, effect: 'stun', effectDuration: 1, effectChance: 0.3, priority: 7, description: 'Shake the ground' },
          { id: 'stone_skin', name: 'Stone Skin', type: 'active', power: 0, range: 0, mpCost: 15, selfBuff: 'fortify', buffDuration: 4, priority: 5, description: 'Harden skin' }
        ]
      }
    ]
  },

  // ==================== HUMANOID ARCHETYPE ====================
  // Humanoid NPCs can also use player guild skills via the guild field
  humanoid: {
    name: 'Humanoid',
    description: 'Intelligent creatures using combat skills',
    branches: [
      {
        name: 'Melee',
        skills: [
          { id: 'slash', name: 'Slash', type: 'active', power: 100, range: 1, mpCost: 5, damageType: 'physical', priority: 8, description: 'Basic sword strike' },
          { id: 'heavy_blow', name: 'Heavy Blow', type: 'active', power: 140, range: 1, mpCost: 12, damageType: 'physical', effect: 'stun', effectDuration: 1, effectChance: 0.3, priority: 8, description: 'Powerful strike' },
          { id: 'shield_slam', name: 'Shield Slam', type: 'active', power: 80, range: 1, mpCost: 8, damageType: 'physical', effect: 'stun', effectDuration: 1, effectChance: 0.7, priority: 7, description: 'Slam with shield' },
          { id: 'whirlwind', name: 'Whirlwind', type: 'active', power: 100, range: 1, mpCost: 18, damageType: 'physical', aoeRadius: 1, priority: 7, description: 'Spin attack hitting all adjacent' }
        ]
      },
      {
        name: 'Ranged',
        skills: [
          { id: 'arrow_shot', name: 'Arrow Shot', type: 'active', power: 90, range: 5, mpCost: 5, damageType: 'physical', priority: 8, description: 'Fire an arrow' },
          { id: 'poison_arrow', name: 'Poison Arrow', type: 'active', power: 70, range: 5, mpCost: 10, damageType: 'physical', effect: 'poison', effectDuration: 3, effectChance: 0.8, priority: 7, description: 'Poisoned arrow' },
          { id: 'aimed_shot', name: 'Aimed Shot', type: 'active', power: 150, range: 6, mpCost: 15, damageType: 'physical', chargeTime: 1, priority: 6, description: 'Carefully aimed shot' },
          { id: 'volley', name: 'Volley', type: 'active', power: 70, range: 5, mpCost: 20, damageType: 'physical', aoeRadius: 2, priority: 7, description: 'Rain of arrows' }
        ]
      },
      {
        name: 'Magic',
        skills: [
          { id: 'magic_bolt', name: 'Magic Bolt', type: 'active', power: 100, range: 4, mpCost: 8, damageType: 'magical', priority: 8, description: 'Basic magic attack' },
          { id: 'heal_ally', name: 'Heal Ally', type: 'active', power: 0, range: 3, mpCost: 15, healPercent: 25, targetAlly: true, priority: 9, description: 'Heal an ally' },
          { id: 'weaken_curse', name: 'Weaken', type: 'active', power: 0, range: 3, mpCost: 10, effect: 'weaken', effectDuration: 3, effectChance: 0.8, priority: 6, description: 'Reduce target stats' },
          { id: 'arcane_blast', name: 'Arcane Blast', type: 'active', power: 130, range: 4, mpCost: 18, damageType: 'magical', aoeRadius: 1, priority: 7, description: 'Explosive magic attack' }
        ]
      }
    ]
  },

  // ==================== CONSTRUCT ARCHETYPE ====================
  construct: {
    name: 'Construct',
    description: 'Animated golems and mechanical beings',
    branches: [
      {
        name: 'Tank',
        skills: [
          { id: 'slam', name: 'Slam', type: 'active', power: 130, range: 1, mpCost: 8, damageType: 'physical', priority: 8, description: 'Heavy melee slam' },
          { id: 'ground_pound', name: 'Ground Pound', type: 'active', power: 100, range: 0, mpCost: 15, damageType: 'physical', aoeRadius: 2, effect: 'stun', effectDuration: 1, effectChance: 0.4, priority: 7, description: 'Pound the ground' },
          { id: 'fortify_chassis', name: 'Fortify Chassis', type: 'active', power: 0, range: 0, mpCost: 20, selfBuff: 'fortify', buffDuration: 4, priority: 5, description: 'Reinforce defenses' },
          { id: 'taunt_pulse', name: 'Taunt Pulse', type: 'active', power: 0, range: 3, mpCost: 12, effect: 'taunt', effectDuration: 2, effectChance: 1.0, aoeRadius: 3, priority: 6, description: 'Force enemies to attack' }
        ]
      },
      {
        name: 'Siege',
        skills: [
          { id: 'boulder_hurl', name: 'Boulder Hurl', type: 'active', power: 150, range: 5, mpCost: 15, damageType: 'physical', aoeRadius: 1, priority: 8, description: 'Throw a large boulder' },
          { id: 'charge_rush', name: 'Charge Rush', type: 'active', power: 120, range: 4, mpCost: 18, damageType: 'physical', movement: true, effect: 'knockback', effectChance: 0.8, priority: 8, description: 'Rush forward crushing all' },
          { id: 'overload', name: 'Overload', type: 'active', power: 200, range: 0, mpCost: 0, damageType: 'physical', aoeRadius: 2, selfDamagePercent: 25, priority: 3, description: 'Explode dealing self damage' }
        ]
      }
    ]
  },

  // ==================== DEMON ARCHETYPE ====================
  demon: {
    name: 'Demon',
    description: 'Infernal creatures from dark realms',
    branches: [
      {
        name: 'Hellfire',
        skills: [
          { id: 'hellfire_bolt', name: 'Hellfire Bolt', type: 'active', power: 130, range: 4, mpCost: 12, damageType: 'magical', element: 'dark', effect: 'burn', effectDuration: 2, effectChance: 0.5, priority: 9, description: 'Dark fire attack' },
          { id: 'infernal_wave', name: 'Infernal Wave', type: 'active', power: 110, range: 3, mpCost: 20, damageType: 'magical', element: 'dark', aoePattern: 'cone', aoeRadius: 2, priority: 8, description: 'Wave of hellfire' },
          { id: 'soul_burn', name: 'Soul Burn', type: 'active', power: 100, range: 3, mpCost: 18, damageType: 'magical', element: 'dark', mpDrain: 0.5, priority: 7, description: 'Burn target soul and MP' },
          { id: 'rain_of_fire', name: 'Rain of Fire', type: 'active', power: 90, range: 4, mpCost: 30, damageType: 'magical', element: 'dark', aoeRadius: 3, effect: 'burn', effectDuration: 2, effectChance: 0.7, priority: 7, description: 'Hellfire from the sky' }
        ]
      },
      {
        name: 'Corruption',
        skills: [
          { id: 'corrupt', name: 'Corrupt', type: 'active', power: 80, range: 3, mpCost: 15, damageType: 'magical', element: 'dark', effect: 'curse', effectDuration: 4, effectChance: 0.7, priority: 7, description: 'Curse that damages over time' },
          { id: 'dark_pact', name: 'Dark Pact', type: 'active', power: 0, range: 0, mpCost: 0, selfDamagePercent: 20, selfBuff: 'rage', buffDuration: 3, priority: 4, description: 'Sacrifice HP for power' },
          { id: 'shadow_grasp', name: 'Shadow Grasp', type: 'active', power: 70, range: 3, mpCost: 12, damageType: 'magical', element: 'dark', effect: 'root', effectDuration: 2, effectChance: 0.8, priority: 7, description: 'Shadows hold target' },
          { id: 'doom', name: 'Doom', type: 'active', power: 0, range: 4, mpCost: 25, effect: 'doom', effectDuration: 3, effectChance: 0.9, priority: 5, description: 'Target takes massive damage after 3 turns' }
        ]
      }
    ]
  },

  // ==================== INSECT ARCHETYPE ====================
  insect: {
    name: 'Insect',
    description: 'Swarm creatures with poison and debuffs',
    branches: [
      {
        name: 'Swarm',
        skills: [
          { id: 'sting', name: 'Sting', type: 'active', power: 90, range: 1, mpCost: 5, damageType: 'physical', effect: 'poison', effectDuration: 2, effectChance: 0.6, priority: 8, description: 'Venomous sting' },
          { id: 'web_shot', name: 'Web Shot', type: 'active', power: 50, range: 3, mpCost: 10, damageType: 'physical', effect: 'slow', effectDuration: 2, effectChance: 0.9, priority: 7, description: 'Slow target with web' },
          { id: 'swarm_attack', name: 'Swarm Attack', type: 'active', power: 60, range: 1, mpCost: 15, damageType: 'physical', hits: 5, priority: 8, description: 'Multiple rapid attacks' },
          { id: 'paralytic_venom', name: 'Paralytic Venom', type: 'active', power: 70, range: 1, mpCost: 18, damageType: 'physical', effect: 'stun', effectDuration: 2, effectChance: 0.6, priority: 7, description: 'Paralyzing bite' },
          { id: 'cocoon', name: 'Cocoon', type: 'active', power: 0, range: 2, mpCost: 15, effect: 'root', effectDuration: 3, effectChance: 0.9, priority: 6, description: 'Wrap target in silk' },
          { id: 'acid_spray', name: 'Acid Spray', type: 'active', power: 80, range: 3, mpCost: 12, damageType: 'magical', aoeRadius: 1, effect: 'corrode', effectDuration: 2, effectChance: 0.7, priority: 7, description: 'Spray corrosive acid' }
        ]
      }
    ]
  },

  // ==================== PLANT ARCHETYPE ====================
  plant: {
    name: 'Plant',
    description: 'Animated flora with control abilities',
    branches: [
      {
        name: 'Nature',
        skills: [
          { id: 'vine_lash', name: 'Vine Lash', type: 'active', power: 90, range: 2, mpCost: 6, damageType: 'physical', priority: 8, description: 'Whip with vines' },
          { id: 'entangle', name: 'Entangle', type: 'active', power: 40, range: 3, mpCost: 12, damageType: 'physical', effect: 'root', effectDuration: 2, effectChance: 0.8, priority: 8, description: 'Root target in place' },
          { id: 'spore_cloud', name: 'Spore Cloud', type: 'active', power: 60, range: 3, mpCost: 18, damageType: 'magical', aoeRadius: 2, effect: 'poison', effectDuration: 3, effectChance: 0.7, priority: 7, description: 'Toxic spores' },
          { id: 'regenerate', name: 'Regenerate', type: 'active', power: 0, range: 0, mpCost: 15, healPercent: 20, priority: 6, description: 'Heal self' },
          { id: 'thorn_burst', name: 'Thorn Burst', type: 'active', power: 70, range: 0, mpCost: 12, damageType: 'physical', aoeRadius: 2, priority: 7, description: 'Thorns shoot in all directions' },
          { id: 'life_leech', name: 'Life Leech', type: 'active', power: 80, range: 2, mpCost: 10, damageType: 'magical', lifesteal: 0.5, priority: 8, description: 'Drain life from target' },
          { id: 'photosynthesis', name: 'Photosynthesis', type: 'active', power: 0, range: 0, mpCost: 0, healPercent: 10, mpRestore: 10, priority: 4, description: 'Passive healing' }
        ]
      }
    ]
  }
};

/**
 * Get skill definition from monster skill trees
 * @param {string} archetype - Monster archetype (beast, dragon, etc.)
 * @param {string} skillId - The skill ID to find
 * @returns {Object|null} Skill definition or null if not found
 */
function getMonsterSkillDefinition(archetype, skillId) {
  const archetypeTree = MONSTER_SKILL_TREES[archetype?.toLowerCase()];
  if (!archetypeTree) return null;

  for (const branch of archetypeTree.branches) {
    const skill = branch.skills.find(s => s.id === skillId);
    if (skill) return skill;
  }
  return null;
}

/**
 * Get all skills for a monster archetype
 * @param {string} archetype - Monster archetype
 * @returns {Array} Array of all skill definitions
 */
function getAllMonsterSkills(archetype) {
  const archetypeTree = MONSTER_SKILL_TREES[archetype?.toLowerCase()];
  if (!archetypeTree) return [];

  const skills = [];
  for (const branch of archetypeTree.branches) {
    skills.push(...branch.skills);
  }
  return skills;
}

/**
 * Get high priority skills for quick AI decisions
 * @param {string} archetype - Monster archetype
 * @param {number} minPriority - Minimum priority threshold
 * @returns {Array} Array of high-priority skill definitions
 */
function getHighPrioritySkills(archetype, minPriority = 7) {
  return getAllMonsterSkills(archetype).filter(s => s.priority >= minPriority);
}

export {
  MONSTER_SKILL_TREES,
  getMonsterSkillDefinition,
  getAllMonsterSkills,
  getHighPrioritySkills
};

export default MONSTER_SKILL_TREES;
