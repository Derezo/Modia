# Skill Trees

| Document | Version | Last Updated |
|----------|---------|--------------|
| Skill Trees Specification | 1.0 | 2026-01-06 |

## Table of Contents

1. [Overview](#1-overview)
2. [Skill System Mechanics](#2-skill-system-mechanics)
3. [Base Guild: Warrior](#3-base-guild-warrior)
4. [Base Guild: Wizard](#4-base-guild-wizard)
5. [Base Guild: Monk](#5-base-guild-monk)
6. [Base Guild: Chemist](#6-base-guild-chemist)
7. [Advanced Guild: Berserker](#7-advanced-guild-berserker)
8. [Advanced Guild: Sorcerer](#8-advanced-guild-sorcerer)
9. [Advanced Guild: Ninja](#9-advanced-guild-ninja)
10. [Advanced Guild: Alchemist](#10-advanced-guild-alchemist)
11. [Skill Schema](#11-skill-schema)
12. [Post-MVP Guilds](#12-post-mvp-guilds)

---

## 1. Overview

Skills are learned by spending XP earned from battles. Each guild has a skill tree with multiple branches, and characters can specialize in different playstyles within their guild.

### 1.1 MVP Scope

| Guild Type | Guilds Included | Notes |
|------------|-----------------|-------|
| Base | Warrior, Wizard, Monk, Chemist | 4 guilds |
| Advanced | Berserker, Sorcerer, Ninja, Alchemist | 1 per base |
| **Total MVP** | **8 guilds** | |

### 1.2 Skill Tiers

| Tier | Guild Level Req | XP Cost Multiplier | Power Level |
|------|-----------------|-------------------|-------------|
| 1 | 1 | 1x | Basic |
| 2 | 10 | 2x | Improved |
| 3 | 25 | 4x | Advanced |
| 4 | 50 | 8x | Mastery |
| 5 | 75 | 16x | Ultimate |

---

## 2. Skill System Mechanics

### 2.1 Learning Skills

- Skills cost XP to learn (base cost varies by tier)
- Each skill can be leveled 1-100
- Higher skill levels increase effectiveness
- Skill cost formula: `base_cost × tier_multiplier × skill_level`

### 2.2 Skill Slots

- Characters can equip up to 8 active skills in battle
- Passive skills are always active (no slot required)
- Ultimate skills (Tier 5) have long cooldowns

### 2.3 Scaling

Most skills scale with:
- Skill level (1-100)
- Character stats (STR, INT, AGI)
- Equipment bonuses

```
damage = base_damage × (1 + skill_level × 0.02) × stat_modifier
```

---

## 3. Base Guild: Warrior

Masters of physical combat, warriors excel at dealing and absorbing damage.

### 3.1 Branch: Offense

Focus on dealing physical damage.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Slash | 1 | Active | 5 | 0 | 1 | Basic sword attack, 100% ATK damage |
| Power Strike | 1 | Active | 10 | 2 | 1 | Heavy attack, 150% ATK damage |
| Bash | 1 | Active | 8 | 1 | 1 | Shield bash, 80% ATK + 10% stun |
| Cleave | 2 | Active | 15 | 2 | 1 | Hit 2 adjacent enemies, 120% ATK |
| Rend | 2 | Active | 12 | 3 | 1 | Apply bleed (3% HP/turn, 3 turns) |
| Weapon Mastery | 2 | Passive | - | - | - | +10% weapon damage |
| Crushing Blow | 3 | Active | 25 | 4 | 1 | 200% ATK, ignore 20% armor |
| Whirlwind | 3 | Active | 30 | 5 | 1 | Hit all adjacent enemies, 100% ATK |
| Executioner | 4 | Active | 40 | 6 | 1 | +100% damage to targets below 25% HP |
| Blade Storm | 5 | Ultimate | 60 | 8 | 2 | 5 hits at 80% ATK each, AoE |

### 3.2 Branch: Defense

Focus on survivability and protecting allies.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Guard | 1 | Active | 5 | 0 | - | +30% DEF this turn |
| Shield Block | 1 | Passive | - | - | - | +5% block chance |
| Parry | 2 | Active | 10 | 2 | - | Counter next attack at 50% damage |
| Taunt | 2 | Active | 8 | 3 | 3 | Force target to attack you for 2 turns |
| Fortify | 2 | Passive | - | - | - | +15% max HP |
| Shield Wall | 3 | Active | 20 | 4 | - | Reduce all damage by 50% for 2 turns |
| Aegis | 3 | Active | 25 | 5 | 2 | Protect adjacent ally, take damage for them |
| Last Stand | 4 | Active | 35 | 8 | - | Cannot die for 1 turn when triggered |
| Unbreakable | 4 | Passive | - | - | - | +25% DEF when below 30% HP |
| Iron Fortress | 5 | Ultimate | 50 | 10 | 3 | Party-wide 40% damage reduction, 3 turns |

### 3.3 Branch: Utility

Focus on mobility and battlefield control.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Charge | 1 | Active | 8 | 2 | 4 | Rush to target, deal 80% ATK |
| Knockback | 1 | Active | 6 | 2 | 1 | Push enemy 2 tiles |
| War Cry | 2 | Active | 15 | 4 | 3 | +15% ATK to nearby allies, 3 turns |
| Intimidate | 2 | Active | 10 | 3 | 3 | -20% ATK to target, 2 turns |
| Fleet Footed | 2 | Passive | - | - | - | +1 movement |
| Ground Slam | 3 | Active | 25 | 4 | 2 | AoE slow 50%, 2 turns |
| Rally | 3 | Active | 20 | 5 | 4 | Remove debuffs from ally, +10% all stats |
| Commander's Aura | 4 | Passive | - | - | - | Allies within 2 tiles gain +10% ATK/DEF |

---

## 4. Base Guild: Wizard

Masters of arcane magic, wizards command elemental forces.

### 4.1 Branch: Fire Magic

Destructive fire spells with burn effects.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Fire Bolt | 1 | Active | 8 | 0 | 4 | 100% MATK fire damage |
| Ignite | 1 | Active | 6 | 1 | 3 | Apply burn (3% HP/turn, 2 turns) |
| Fireball | 2 | Active | 18 | 2 | 4 | 130% MATK, 2-tile AoE |
| Flame Shield | 2 | Active | 15 | 3 | - | Attackers take 20% fire damage, 3 turns |
| Fire Mastery | 2 | Passive | - | - | - | +15% fire damage |
| Combustion | 3 | Active | 30 | 4 | 3 | 200% MATK if target is burning |
| Wall of Fire | 3 | Active | 25 | 5 | 4 | Create fire wall (3 tiles), 30% HP/turn |
| Inferno | 4 | Active | 45 | 6 | 5 | 180% MATK, 3-tile AoE, apply burn |
| Immolation | 4 | Passive | - | - | - | Burns spread to adjacent enemies |
| Meteor | 5 | Ultimate | 80 | 10 | 6 | 300% MATK, 4-tile AoE, massive fire damage |

### 4.2 Branch: Ice Magic

Control and defensive ice spells.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Ice Shard | 1 | Active | 8 | 0 | 4 | 100% MATK ice damage |
| Frost | 1 | Active | 6 | 1 | 3 | Apply slow (-2 movement, 2 turns) |
| Blizzard | 2 | Active | 20 | 3 | 4 | 110% MATK, 3-tile AoE, slow |
| Ice Armor | 2 | Active | 15 | 4 | - | +30% physical DEF, 4 turns |
| Ice Mastery | 2 | Passive | - | - | - | +15% ice damage |
| Frozen Prison | 3 | Active | 30 | 5 | 3 | Freeze target (can't act, 2 turns) |
| Glacial Spike | 3 | Active | 25 | 3 | 5 | 180% MATK, pierce through enemies |
| Absolute Zero | 4 | Active | 50 | 7 | 4 | 200% MATK, freeze all in AoE |
| Shatter | 4 | Passive | - | - | - | +50% crit damage vs frozen targets |
| Ice Age | 5 | Ultimate | 70 | 10 | All | Freeze all enemies 1 turn, +100% ice damage |

### 4.3 Branch: Lightning Magic

High damage and chain effects.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Spark | 1 | Active | 6 | 0 | 4 | 90% MATK lightning damage |
| Static | 1 | Active | 8 | 2 | 3 | 10% stun chance, 2 turns |
| Lightning Bolt | 2 | Active | 15 | 2 | 5 | 150% MATK, 15% stun |
| Chain Lightning | 2 | Active | 22 | 3 | 4 | Bounces to 3 targets at 80% MATK |
| Lightning Mastery | 2 | Passive | - | - | - | +15% lightning damage |
| Thunder Strike | 3 | Active | 35 | 4 | 5 | 200% MATK, 25% stun |
| Paralysis | 3 | Active | 25 | 5 | 3 | Stun target for 2 turns |
| Overcharge | 4 | Active | 45 | 6 | - | Next spell deals +100% damage |
| Conductive | 4 | Passive | - | - | - | Lightning chains +1 target |
| Tempest | 5 | Ultimate | 75 | 10 | 5 | 250% MATK to all enemies, 40% stun |

---

## 5. Base Guild: Monk

Masters of martial arts and inner energy.

### 5.1 Branch: Martial Arts

Hand-to-hand combat techniques.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Palm Strike | 1 | Active | 5 | 0 | 1 | 100% ATK damage |
| Kick | 1 | Active | 6 | 1 | 1 | 90% ATK + knockback 1 tile |
| Combo | 2 | Active | 12 | 0 | 1 | 3 hits at 50% ATK each |
| Flying Kick | 2 | Active | 15 | 2 | 3 | Jump to target, 130% ATK |
| Martial Mastery | 2 | Passive | - | - | - | +10% unarmed damage |
| Chain Combo | 3 | Active | 25 | 3 | 1 | 5 hits at 40% ATK, +10% per hit |
| Counter Strike | 3 | Active | 20 | 4 | - | Counter next attack at 150% damage |
| Ultimate Combo | 4 | Active | 40 | 5 | 1 | 8 hits at 35% ATK, final hit stuns |
| Pressure Point | 4 | Active | 30 | 4 | 1 | 100% ATK + disable 1 skill, 3 turns |
| Fists of Fury | 5 | Ultimate | 60 | 8 | 1 | 15 hits at 25% ATK, ignore defense |

### 5.2 Branch: Ki Mastery

Inner energy and spiritual techniques.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Meditate | 1 | Active | 0 | 2 | - | Restore 15% MP |
| Ki Strike | 1 | Active | 10 | 1 | 1 | 80% ATK + 80% MATK hybrid |
| Ki Shield | 2 | Active | 15 | 3 | - | Absorb damage equal to 20% max HP |
| Focus | 2 | Active | 12 | 2 | - | +25% next attack damage |
| Ki Flow | 2 | Passive | - | - | - | +10% MP regen per turn |
| Ki Burst | 3 | Active | 30 | 4 | 2 | 150% MATK AoE |
| Inner Peace | 3 | Active | 20 | 5 | - | Remove all debuffs, heal 20% HP |
| Ki Storm | 4 | Active | 45 | 6 | 3 | 180% MATK, hit all in range |
| Perfect Focus | 4 | Passive | - | - | - | Critical hits restore 5% MP |
| Transcendence | 5 | Ultimate | 80 | 10 | - | +50% all stats, 3 turns |

### 5.3 Branch: Body Techniques

Agility and evasion skills.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Dash | 1 | Active | 5 | 1 | 3 | Move without triggering attacks |
| Dodge | 1 | Active | 8 | 2 | - | +30% evasion this turn |
| Acrobatics | 2 | Passive | - | - | - | +15% evasion |
| Swift Strike | 2 | Active | 12 | 2 | 1 | Attack + free movement |
| Light Step | 2 | Passive | - | - | - | +1 movement |
| Afterimage | 3 | Active | 25 | 4 | - | Create decoy, 50% of attacks miss |
| Lightning Reflexes | 3 | Passive | - | - | - | +20% initiative |
| Untouchable | 4 | Active | 40 | 6 | - | 100% evasion, 1 turn |
| Phantom Step | 4 | Active | 30 | 3 | 4 | Teleport to tile, attack |
| One With Wind | 5 | Ultimate | 50 | 10 | - | 75% evasion + counter all misses, 3 turns |

---

## 6. Base Guild: Chemist

Masters of potions, poisons, and explosives.

### 6.1 Branch: Potion Craft

Healing and support through alchemy.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Potion Throw | 1 | Active | 8 | 0 | 3 | Heal ally 20% HP |
| Antidote | 1 | Active | 5 | 1 | 3 | Cure poison/bleed on ally |
| Mega Potion | 2 | Active | 15 | 2 | 3 | Heal ally 40% HP |
| Elixir | 2 | Active | 20 | 3 | 3 | Heal 25% HP + MP |
| Efficient Brewing | 2 | Passive | - | - | - | +20% healing effectiveness |
| Cure All | 3 | Active | 25 | 4 | 3 | Remove all status effects from ally |
| Full Life | 3 | Active | 40 | 5 | 3 | Revive ally at 50% HP |
| Super Potion | 4 | Active | 35 | 3 | 3 | Heal ally 70% HP |
| Mass Heal | 4 | Active | 50 | 6 | 4 | Heal all allies 30% HP |
| Panacea | 5 | Ultimate | 70 | 10 | 4 | Full heal + cure all, all allies |

### 6.2 Branch: Acid Craft

Poisons and damage over time.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Acid Flask | 1 | Active | 8 | 0 | 3 | 80% MATK + 5% armor reduction |
| Poison Vial | 1 | Active | 6 | 1 | 3 | Apply poison (5% HP/turn, 3 turns) |
| Toxic Cloud | 2 | Active | 18 | 3 | 3 | 2-tile AoE poison zone, 2 turns |
| Corrosive | 2 | Active | 15 | 2 | 3 | -20% DEF to target, 3 turns |
| Poison Mastery | 2 | Passive | - | - | - | +25% poison damage |
| Plague | 3 | Active | 30 | 4 | 4 | Poison spreads on target death |
| Acid Rain | 3 | Active | 35 | 5 | 4 | 3-tile AoE, 100% MATK + armor reduction |
| Virulent | 4 | Active | 40 | 4 | 3 | 10% HP/turn poison, 4 turns |
| Toxic Mastery | 4 | Passive | - | - | - | Poisons stack duration |
| Pandemic | 5 | Ultimate | 60 | 10 | All | All enemies poisoned, 8% HP/turn, 5 turns |

### 6.3 Branch: Bomb Craft

Explosives and area damage.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Bomb Throw | 1 | Active | 10 | 1 | 4 | 120% ATK, 1-tile AoE |
| Flash Bomb | 1 | Active | 8 | 2 | 3 | Blind target (50% miss, 2 turns) |
| Timed Bomb | 2 | Active | 15 | 0 | 4 | Place bomb, explodes next turn, 150% ATK |
| Cluster Bomb | 2 | Active | 20 | 3 | 4 | 100% ATK, 2-tile AoE |
| Demolitions | 2 | Passive | - | - | - | +15% bomb damage |
| Smoke Bomb | 3 | Active | 15 | 3 | 4 | Create smoke (blocks vision, 2 turns) |
| Chain Reaction | 3 | Passive | - | - | - | Bombs trigger adjacent bombs |
| Mega Bomb | 4 | Active | 45 | 5 | 5 | 200% ATK, 3-tile AoE |
| Minefield | 4 | Active | 40 | 6 | 4 | Place 3 traps, 100% ATK each |
| Nuclear Option | 5 | Ultimate | 80 | 10 | 6 | 350% ATK, 5-tile AoE, massive damage |

---

## 7. Advanced Guild: Berserker

Warrior advancement focused on rage and reckless power.

### 7.1 Branch: Rage

Fury-based damage amplification.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Rage Strike | 2 | Active | 15 | 1 | 1 | 140% ATK, gain 10 rage |
| Blood Frenzy | 2 | Active | 20 | 3 | - | +20% ATK per kill, 3 turns |
| Enraged Fury | 3 | Active | 30 | 4 | 1 | 180% ATK, +5% per rage point |
| Bloodlust | 3 | Passive | - | - | - | Killing blow heals 10% HP |
| Reckless Power | 3 | Active | 25 | 3 | - | +50% ATK, -25% DEF, 3 turns |
| Berserker Rage | 4 | Active | 50 | 6 | - | +100% ATK, can't use skills, 3 turns |
| Unstoppable | 4 | Passive | - | - | - | Immune to stun/slow while in rage |
| Rampage | 5 | Ultimate | 70 | 10 | 2 | Attack all enemies in range, +10% per hit |

### 7.2 Branch: Recklessness

High-risk, high-reward abilities.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Reckless Charge | 2 | Active | 20 | 2 | 5 | Rush + 150% ATK, take 10% HP damage |
| Wild Swing | 2 | Active | 15 | 1 | 1 | 200% ATK, 50% chance to hit |
| Berserker Leap | 3 | Active | 25 | 3 | 4 | Jump + AoE 100% ATK, take 5% HP |
| Martyr's Resolve | 3 | Active | 30 | 5 | - | +100% damage when below 30% HP |
| Death Wish | 3 | Passive | - | - | - | +1% ATK per 1% missing HP |
| Final Stand | 4 | Active | 40 | 8 | - | Survive at 1 HP once per battle |
| Self-Destruction | 5 | Ultimate | All HP | 1 use | 3 | Deal HP as damage to all, KO self |

---

## 8. Advanced Guild: Sorcerer

Wizard advancement focused on raw magical power.

### 8.1 Branch: Arcane Power

Pure magical amplification.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Arcane Bolt | 2 | Active | 12 | 0 | 5 | 120% MATK, ignores resistance |
| Mana Shield | 2 | Active | 20 | 4 | - | Damage reduces MP instead of HP |
| Spell Amplify | 3 | Active | 25 | 3 | - | Next spell +75% damage |
| Arcane Mastery | 3 | Passive | - | - | - | +20% spell damage |
| Penetrating Magic | 3 | Passive | - | - | - | Ignore 25% magic resistance |
| Arcane Explosion | 4 | Active | 50 | 5 | 4 | 250% MATK, 3-tile AoE |
| Infinite Mana | 4 | Passive | - | - | - | 20% chance spell costs no MP |
| Armageddon | 5 | Ultimate | 100 | 12 | All | 400% MATK to all enemies |

### 8.2 Branch: Elemental Mastery

Multi-element combinations.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Element Shift | 2 | Active | 10 | 1 | - | Change spell element mid-cast |
| Tri-Element | 2 | Active | 30 | 4 | 4 | Fire+Ice+Lightning, 100% each |
| Prismatic Blast | 3 | Active | 40 | 4 | 5 | Random element, 200% MATK |
| Elemental Shield | 3 | Active | 25 | 5 | - | Resist current highest element +50% |
| All Elements | 3 | Passive | - | - | - | +10% all elemental damage |
| Elemental Overload | 4 | Active | 60 | 6 | 5 | Hit weakness for +100% damage |
| Avatar of Elements | 5 | Ultimate | 80 | 10 | - | Cast 3 elemental spells instantly |

---

## 9. Advanced Guild: Ninja

Monk advancement focused on stealth and assassination.

### 9.1 Branch: Stealth

Invisibility and surprise attacks.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Shadow Step | 2 | Active | 15 | 2 | 4 | Teleport behind target |
| Vanish | 2 | Active | 20 | 4 | - | Become invisible, 2 turns |
| Backstab | 2 | Active | 18 | 2 | 1 | +100% damage from behind |
| Assassination | 3 | Active | 35 | 5 | 1 | 300% ATK if invisible |
| Silent Step | 3 | Passive | - | - | - | Movement doesn't reveal |
| Shadow Clone | 4 | Active | 40 | 6 | - | Create clone with 25% stats |
| Death Mark | 4 | Active | 30 | 5 | 3 | Target takes +50% damage, 3 turns |
| One Thousand Cuts | 5 | Ultimate | 70 | 10 | 1 | 20 hits at 20% ATK from stealth |

### 9.2 Branch: Ninjutsu

Ninja tools and techniques.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Shuriken | 2 | Active | 10 | 0 | 4 | 80% ATK ranged attack |
| Kunai Barrage | 2 | Active | 18 | 2 | 4 | 3 shurikens at 50% ATK |
| Smoke Bomb | 2 | Active | 15 | 3 | 3 | AoE blind + evasion boost |
| Poison Blade | 3 | Active | 25 | 3 | 1 | 100% ATK + lethal poison |
| Ninja Tools | 3 | Passive | - | - | - | +20% thrown weapon damage |
| Explosive Tag | 4 | Active | 35 | 4 | 4 | Place trap, 200% ATK when triggered |
| Shadow Arts | 5 | Ultimate | 60 | 8 | - | All attacks +50% from any angle, 3 turns |

---

## 10. Advanced Guild: Alchemist

Chemist advancement focused on transmutation.

### 10.1 Branch: Transmutation

Transform matter and effects.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Transmute | 2 | Active | 20 | 3 | 3 | Convert debuff to buff (or reverse) |
| Gold Touch | 2 | Active | 15 | 4 | 1 | +50% gold from target enemy |
| Element Convert | 3 | Active | 25 | 3 | 4 | Change enemy's elemental weakness |
| Philosopher's Stone | 3 | Passive | - | - | - | +25% potion effectiveness |
| Matter Shift | 3 | Active | 30 | 4 | 3 | Swap positions with ally or enemy |
| Equivalent Exchange | 4 | Active | 40 | 6 | - | Trade HP for MP or reverse |
| Perfect Transmutation | 5 | Ultimate | 80 | 10 | 4 | Transform enemy to weaker form, 3 turns |

### 10.2 Branch: Explosives

Enhanced bomb abilities.

| Skill | Tier | Type | MP | CD | Range | Description |
|-------|------|------|-----|-----|-------|-------------|
| Volatile Mix | 2 | Active | 18 | 2 | 4 | 150% ATK bomb + random status |
| Napalm | 2 | Active | 22 | 3 | 4 | 2-tile fire zone, 3 turns |
| Elemental Bomb | 3 | Active | 30 | 3 | 5 | Choose fire/ice/lightning, 180% |
| Scatter Shot | 3 | Active | 35 | 4 | 5 | 5 random targets, 60% ATK each |
| Unstable Mixture | 3 | Passive | - | - | - | +15% bomb crit chance |
| Tactical Nuke | 4 | Active | 55 | 6 | 6 | 250% ATK, 4-tile AoE |
| Alchemical Warfare | 5 | Ultimate | 90 | 12 | All | All enemies: 200% + burn + poison + slow |

---

## 11. Skill Schema

### 11.1 Skill Definition

```json
{
  "id": "warrior_slash",
  "name": "Slash",
  "description": "A basic sword attack.",
  "guildId": "warrior",
  "branch": "offense",
  "tier": 1,
  "guildLevelRequired": 1,
  "baseXpCost": 100,
  "maxLevel": 100,

  "type": "active|passive|ultimate",
  "mpCost": 5,
  "cooldown": 0,
  "range": 1,
  "aoeRadius": 0,

  "scaling": {
    "type": "physical|magical|hybrid",
    "baseDamage": 100,
    "statScaling": { "strength": 1.0 },
    "levelScaling": 0.02
  },

  "effects": [
    {
      "type": "damage|heal|buff|debuff|status",
      "value": 100,
      "duration": 0,
      "chance": 1.0
    }
  ],

  "prerequisites": [
    { "skillId": "warrior_power_strike", "level": 10 }
  ],

  "tags": ["melee", "physical", "single_target"]
}
```

### 11.2 Effect Types

| Type | Description |
|------|-------------|
| damage | Deal damage to target |
| heal | Restore HP |
| buff | Increase stats |
| debuff | Decrease stats |
| status | Apply status effect |
| dot | Damage over time |
| hot | Heal over time |
| shield | Absorb damage |
| teleport | Move instantly |
| summon | Create entity |

---

## 12. Post-MVP Guilds

### 12.1 Planned Advanced Guilds

| Base Guild | Advanced Options (Post-MVP) |
|------------|----------------------------|
| Warrior | Paladin, Guardian, Warlord |
| Wizard | Summoner, Conjurer, Oracle |
| Monk | Martial Artist, Brawler, Ascetic |
| Chemist | Medic, Plague Doctor, Artificer |

### 12.2 Total Guild Count

- **MVP**: 8 guilds (4 base + 4 advanced)
- **Post-MVP**: +12 guilds
- **Total Planned**: 20 guilds

---

## Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Core game mechanics |
| [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) | Guild advancement system |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | character_skills table |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Skill learning endpoints |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-06 | Initial document with 8 MVP guilds |
