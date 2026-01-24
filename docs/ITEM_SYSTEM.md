# Item System

| Document | Version | Last Updated |
|----------|---------|--------------|
| Item System Specification | 3.0 | 2026-01-22 |

## Table of Contents

1. [Overview](#1-overview)
2. [Equipment Slots](#2-equipment-slots)
3. [Item Types](#3-item-types)
   - 3.1 Equipment
   - 3.2 Weapon Types
   - 3.3 Armor Types
   - 3.4 Consumables
   - 3.5 Materials
4. [Rarity System](#4-rarity-system)
   - 4.1 Rarity Tiers
   - 4.2 Item Naming System
   - 4.3 Quality Prefixes
   - 4.4 Stat-Based Suffixes
   - 4.5 Naming Examples
   - 4.6 Naming Priority Rules
5. [Material Progression System](#5-material-progression-system)
   - 5.1 Material Tiers (Metal)
   - 5.2 Material Applications
   - 5.3 Wood Material Tiers
   - 5.4 Cloth/Leather Tiers
   - 5.5 Material Stat Calculation
6. [Augmentation System](#6-augmentation-system)
   - 6.1 Augmentation Overview
   - 6.2 Elemental Augments
   - 6.3 Enemy-Type Augments
   - 6.4 Defensive Augments
   - 6.5 Support Augments
   - 6.6 Combat Augments
   - 6.7 Unique/Set Augments
7. [Item Templates](#7-item-templates)
   - 7.1 Template Schema
   - 7.2 Stat Types
8. [Item Generation](#8-item-generation)
   - 8.1 Generation Algorithm
   - 8.2 Material Selection
   - 8.3 Augmentation Selection
   - 8.4 Bonus Stat Calculation
   - 8.5 Seeded Random
9. [Level and Class Requirements](#9-level-and-class-requirements)
   - 9.1 Level Scaling
   - 9.2 Class Requirements
10. [Example Templates](#10-example-templates)
    - 10.1 Weapons
    - 10.2 Armor
    - 10.3 Accessories
    - 10.4 High-Level Equipment
    - 10.5 Off-Hand Equipment
    - 10.6 Generated Item Examples
11. [Drop Tables](#11-drop-tables)
12. [Relic System](#12-relic-system)
    - 12.1 Overview
    - 12.2 Relic Templates
    - 12.3 Acquisition Methods
    - 12.4 Permanent Bonuses
    - 12.5 Collection UI

---

## 1. Overview

Items in Modia are procedurally generated from base templates. Each item instance has randomized stats within defined ranges, modified by rarity. This creates variety while maintaining balance through controlled stat boundaries.

### Core Concepts

- **Template**: Base definition with stat ranges and properties
- **Instance**: Generated item with rolled stats
- **Rarity**: Modifier affecting stat rolls and bonus stats
- **Seed**: Deterministic random seed for reproducible generation

---

## 2. Equipment Slots

Characters have 7 equipment slots:

| Slot | ID | Item Types | Description |
|------|----|------------|-------------|
| Main Hand | `main_hand` | Weapons | Primary weapon (swords, staves, fists) |
| Off Hand | `off_hand` | Shields, Orbs, Daggers | Secondary equipment |
| Head | `head` | Helmets, Hats, Hoods | Head armor |
| Body | `body` | Armor, Robes, Vests | Chest armor |
| Feet | `feet` | Boots, Sandals, Greaves | Foot armor |
| Accessory 1 | `accessory1` | Rings, Amulets, Charms | First accessory slot |
| Accessory 2 | `accessory2` | Rings, Amulets, Charms | Second accessory slot |

### Slot Restrictions by Class

| Class | Main Hand | Off Hand |
|-------|-----------|----------|
| Warrior | Swords, Axes, Maces | Shields |
| Wizard | Staves, Wands | Orbs, Tomes |
| Monk | Fist Weapons, Bo Staves | None (empty) |
| Chemist | Daggers, Crossbows | Pouches, Shields |

Advanced classes inherit base class restrictions unless otherwise specified.

---

## 3. Item Types

### 3.1 Equipment

| Type | Slots | Primary Stats |
|------|-------|---------------|
| `weapon` | main_hand | Physical Attack, Magic Attack, STR, INT |
| `shield` | off_hand | Defense, Block Chance, VIT |
| `orb` | off_hand | Magic Attack, MP, INT |
| `armor` | body | Defense, HP, VIT |
| `helmet` | head | Defense, HP, resistance |
| `boots` | feet | Defense, AGI, Movement |
| `accessory` | accessory1, accessory2 | Various (stat-specific) |

### 3.2 Weapon Types

#### Swords (Warrior, Paladin, Berserker, Guardian, Warlord)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Shortsword | 1H | Low | 1 | Fast attack, +5% initiative |
| Longsword | 1H | Medium | 1 | Balanced, versatile |
| Greatsword | 2H | High | 1 | Slow, +10% crit damage |
| Rapier | 1H | Low-Med | 1 | +10% crit chance, piercing |
| Katana | 2H | Medium | 1 | +5% crit chance, +5% crit damage |
| Scimitar | 1H | Medium | 1 | +5% attack speed, curved blade |
| Claymore | 2H | Very High | 1 | Slowest, highest base damage |
| Falchion | 1H | Medium | 1 | +8% vs light armor |

#### Axes (Warrior, Berserker, Guardian, Warlord)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Hatchet | 1H | Low | 1 | Throwable (range 3), fast |
| Hand Axe | 1H | Medium | 1 | Standard axe |
| Battle Axe | 1H | Med-High | 1 | +5% armor penetration |
| Greataxe | 2H | Very High | 1 | Cleave ability, +15% crit damage |
| Double Axe | 2H | High | 1 | Dual blades, +10% damage |
| War Axe | 1H | High | 1 | Heavy, +8% armor penetration |

#### Maces & Hammers (Warrior, Paladin, Guardian)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Club | 1H | Very Low | 1 | Primitive, cheap |
| Mace | 1H | Medium | 1 | +10% vs heavy armor, stun chance |
| Morningstar | 1H | Med-High | 1 | Spiked, +5% crit chance |
| Flail | 1H | Medium | 1 | Ignores shields, -5% accuracy |
| Warhammer | 2H | Very High | 1 | +20% vs heavy armor, slow |
| Maul | 2H | Highest | 1 | Devastating, +15% stun chance |

#### Polearms (Warrior, Guardian, Warlord)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Spear | 2H | Medium | 2 | Extended reach |
| Pike | 2H | Med-High | 2 | +10% vs mounted/large |
| Halberd | 2H | High | 2 | Versatile, slash or pierce |
| Glaive | 2H | High | 2 | Sweeping attacks |
| Lance | 2H | Very High | 2 | +25% on charge, mounted bonus |
| Trident | 2H | Medium | 2 | Water affinity, throwable |

#### Staves (Wizard, Sorcerer, Summoner, Conjurer, Oracle)

| Weapon | Hands | Base MATK | Range | Special Properties |
|--------|-------|-----------|-------|-------------------|
| Quarterstaff | 2H | Low | 1-2 | Physical + Magic hybrid |
| Magic Staff | 2H | Medium | 4 | Standard casting focus |
| Battle Staff | 2H | Med (both) | 2 | Hybrid melee/magic |
| Arcane Rod | 1H | Med-High | 4 | One-handed, allows off-hand |
| Grand Staff | 2H | High | 5 | Extended range, +10% spell power |
| Elder Staff | 2H | Very High | 4 | +15% MP, ancient power |

#### Wands & Orbs (Wizard, Oracle, Summoner)

| Weapon | Hands | Base MATK | Range | Special Properties |
|--------|-------|-----------|-------|-------------------|
| Wand | 1H | Low | 3 | Fast cast, +5% cast speed |
| Scepter | 1H | Medium | 3 | Royal, +5% buff duration |
| Focus | 1H | Med-High | 3 | Channeling bonus |
| Crystal Orb | OH | - | - | Off-hand, +10% magic damage |
| Tome | OH | - | - | Off-hand, +15% MP |
| Relic | OH | - | - | Off-hand, unique effects |

#### Fist Weapons (Monk, Ninja, Martial Artist, Brawler)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Hand Wraps | 2H | Very Low | 1 | Basic, +10% attack speed |
| Knuckles | 2H | Low | 1 | Brass/iron, +5% stun |
| Claws | 2H | Medium | 1 | +15% crit chance, bleed |
| Cestus | 2H | Med-High | 1 | Armored fist, +5% defense |
| Tiger Claws | 2H | High | 1 | +20% crit damage |
| Katar | 2H | Medium | 1 | Piercing, +10% armor pen |
| Tekko | 2H | Low-Med | 1 | Concealed, +5% initiative |

#### Daggers (Chemist, Alchemist, Plague Doctor, Ninja)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Knife | 1H | Very Low | 1 | Basic, throwable |
| Dagger | 1H | Low | 1 | +10% crit chance |
| Stiletto | 1H | Low | 1 | +15% armor penetration |
| Kris | 1H | Low-Med | 1 | Wavy blade, +5% poison chance |
| Dirk | 1H | Medium | 1 | Longer blade |
| Parrying Dagger | OH | Low | 1 | Off-hand, +10% parry |
| Throwing Knife | 1H | Very Low | 3 | Ranged, stackable |

#### Ranged Weapons (Chemist, Artificer)

| Weapon | Hands | Base ATK | Range | Special Properties |
|--------|-------|----------|-------|-------------------|
| Hand Crossbow | 1H | Low | 4 | One-handed, fast reload |
| Light Crossbow | 2H | Medium | 5 | Standard ranged |
| Heavy Crossbow | 2H | High | 5 | Slow, +15% armor pen |
| Repeater | 2H | Low | 4 | Multi-shot (3 attacks, reduced damage) |
| Arbalest | 2H | Very High | 6 | Siege weapon, very slow |

### 3.3 Armor Types

#### Heavy Armor (Warrior, Paladin, Guardian, Warlord)

| Type | Slot | Base DEF | Properties |
|------|------|----------|------------|
| Plate Armor | Body | Very High | -1 movement, highest defense |
| Chainmail | Body | High | Standard heavy |
| Scale Mail | Body | Med-High | Flexible plates |
| Half Plate | Body | High | Balanced protection |
| Full Plate | Body | Highest | -2 movement, maximum defense |

#### Medium Armor (Monk, Chemist, Ninja, Berserker)

| Type | Slot | Base DEF | Properties |
|------|------|----------|------------|
| Leather Armor | Body | Medium | Standard medium |
| Studded Leather | Body | Med-High | Reinforced |
| Brigandine | Body | High | Plated leather |
| Hide Armor | Body | Medium | Natural materials |
| Chain Shirt | Body | Med-High | Light chain |

#### Light Armor (Wizard, Sorcerer, Summoner, Oracle)

| Type | Slot | Base DEF | Properties |
|------|------|----------|------------|
| Cloth Robe | Body | Very Low | +10% MP |
| Padded Armor | Body | Low | Basic protection |
| Mage Robe | Body | Low | +15% MP, +5% spell power |
| Battle Robe | Body | Low-Med | Reinforced, hybrid |
| Vestments | Body | Low | +10% holy/healing |

#### Shields (Warrior, Paladin, Guardian, Chemist)

| Type | Slot | Base DEF | Block % | Properties |
|------|------|----------|---------|------------|
| Buckler | Off-hand | Low | 5% | Light, no penalty |
| Round Shield | Off-hand | Medium | 10% | Standard |
| Kite Shield | Off-hand | Med-High | 12% | Coverage bonus |
| Tower Shield | Off-hand | High | 18% | -1 movement, cover allies |
| Pavise | Off-hand | Very High | 20% | -2 movement, arrow block |

#### Helmets

| Type | Slot | Base DEF | Properties |
|------|------|----------|------------|
| Leather Cap | Head | Very Low | Light protection |
| Chain Coif | Head | Low | Standard |
| Iron Helm | Head | Medium | Full coverage |
| Great Helm | Head | High | -5% visibility |
| Crown | Head | Very Low | +10% buff effects |
| Wizard Hat | Head | Very Low | +5% spell power |
| Hood | Head | Very Low | +5% evasion |

#### Boots

| Type | Slot | Properties |
|------|------|------------|
| Sandals | Feet | +1 movement, low defense |
| Leather Boots | Feet | Standard |
| Iron Greaves | Feet | High defense, no bonus |
| Speed Boots | Feet | +1 movement |
| Mage Slippers | Feet | +5% MP regen |
| War Boots | Feet | +5% defense, sturdy |

### 3.4 Consumables

| Type | Effect | Stack Limit |
|------|--------|-------------|
| `potion_hp` | Restore HP | 99 |
| `potion_mp` | Restore MP | 99 |
| `antidote` | Cure status effects | 99 |
| `elixir` | Restore HP and MP | 50 |
| `revival` | Revive fallen character | 20 |

### 3.5 Materials

| Type | Use | Stack Limit |
|------|-----|-------------|
| `crafting` | Future crafting system | 999 |
| `key_item` | Quest progression | 1 |

---

## 4. Rarity System

### 4.1 Rarity Tiers

| Rarity | Color | Drop Rate | Stat Multiplier | Bonus Stat Slots | Price Multiplier |
|--------|-------|-----------|-----------------|------------------|------------------|
| Common | White | 70% | 0.80 - 1.00 | 0 | 1x |
| Uncommon | Green | 20% | 0.90 - 1.10 | 0-1 | 2x |
| Rare | Blue | 8% | 1.00 - 1.20 | 1-2 | 5x |
| Epic | Purple | 1.8% | 1.10 - 1.30 | 2-3 | 15x |
| Legendary | Orange | 0.2% | 1.20 - 1.50 | 3-4 | 50x |

### 4.2 Item Naming System

Items are named using a structured pattern that combines quality, augments, material, and type:

```
[Quality Prefix] [Augment Prefix] [Material] [Item Type] [Augment Suffix]
```

**Component Priority:**
1. Quality Prefix (from rarity) - always first if present
2. Augment Prefix (enemy-type or elemental) - optional
3. Material - always present
4. Item Type - always present
5. Augment Suffix (effect or stat) - optional

### 4.3 Quality Prefixes by Rarity

| Rarity | Quality Prefix Pool |
|--------|---------------------|
| Common | (none) |
| Uncommon | Fine, Sturdy, Sharp, Polished |
| Rare | Superior, Masterwork, Enchanted, Pristine |
| Epic | Exalted, Ancient, Mythical, Legendary |
| Legendary | Divine, Primordial, Godforged, Celestial |

### 4.4 Stat-Based Suffixes

When items have bonus stats (from rarity), they gain stat suffixes:

| Bonus Stat | Suffix |
|------------|--------|
| STR | of Might |
| INT | of Wisdom |
| AGI | of Swiftness |
| VIT | of Fortitude |
| LUK | of Fortune |
| HP | of Vitality |
| MP | of Sorcery |
| Crit Chance | of Precision |
| Evasion | of Shadows |
| Defense | of the Bulwark |
| Block | of the Guardian |

### 4.5 Naming Examples

**Basic Items (Common, no augments):**
- "Iron Sword"
- "Oak Staff"
- "Leather Armor"

**Quality + Material (Uncommon/Rare, no augments):**
- "Fine Steel Longsword"
- "Masterwork Mythril Plate"
- "Enchanted Silk Robe"

**Quality + Material + Stat Suffix:**
- "Superior Steel Sword of Might"
- "Pristine Gold Ring of Wisdom"

**Augment Prefix + Material + Type (enemy-type augment):**
- "Dragonbane Adamantine Greatsword"
- "Undeadbane Silver Mace"
- "Wyrmward Dragonbone Plate"

**Elemental Augment Prefix + Material + Type:**
- "Blazing Steel Sword"
- "Glacial Mythril Axe"
- "Thundering Obsidian Hammer"

**Material + Type + Augment Suffix (elemental/support):**
- "Mythril Sword of Flames"
- "Adamantine Plate of Regeneration"
- "Celestial Staff of the Archmage"

**Full Combination (Legendary with dual augments):**
- "Divine Dragonbane Celestial Greatsword of Cinders"
- "Godforged Wyrmward Dragonbone Plate of Regeneration"
- "Primordial Blazing Adamantine Axe of Execution"

### 4.6 Naming Priority Rules

When an item has multiple possible prefixes/suffixes, use these priorities:

**Prefix Priority (choose highest):**
1. Quality Prefix (Divine, Godforged, etc.)
2. Enemy-Type Prefix (Dragonbane, Demonslayer)
3. Elemental Prefix (Blazing, Glacial)
4. Defensive Prefix (Fortified, Stalwart)

**Suffix Priority (choose highest value/rarity):**
1. Supreme augment suffix (of Cinders, of Regeneration)
2. Greater augment suffix (of Inferno, of Vampirism)
3. Stat-based suffix (of Might, of Wisdom)
4. Standard augment suffix (of Flames, of Mending)

**Dual Augment Items (Legendary):**
Legendary items with 2 augment slots display both:
- Prefix from one augment + Suffix from another
- Example: "Blazing Sword of Vampirism" (fire prefix + lifesteal suffix)

---

## 5. Material Progression System

Materials determine base item stats and scale with character level requirements. Higher-tier materials provide better base stats but require higher levels to equip.

### 5.1 Material Tiers

| Tier | Material | Stat Multiplier | Level Req | Sources | Properties |
|------|----------|-----------------|-----------|---------|------------|
| 1 | Copper | 0.80x | 1 | Starting gear, common drops | Soft, easily worked |
| 2 | Iron | 1.00x | 1 | Basic shops, common drops | Baseline material |
| 3 | Bronze | 1.10x | 10 | Crafting, village shops | Durable alloy |
| 4 | Steel | 1.25x | 20 | City shops, dungeon drops | Hardened iron |
| 5 | Silver | 1.40x | 35 | Rare drops, specialized shops | Anti-undead (+10% vs undead) |
| 6 | Gold | 1.55x | 50 | Rare drops, treasure | Magic conductivity (+5% spell power) |
| 7 | Platinum | 1.70x | 70 | Elite drops, guild shops | Noble metal, corrosion resistant |
| 8 | Mythril | 1.85x | 90 | Deep dungeons, rare drops | Lightweight (-1 movement cost) |
| 9 | Obsidian | 2.00x | 120 | Volcanic areas, boss drops | High crit (+5% crit chance) |
| 10 | Adamantine | 2.20x | 150 | Legendary drops, crafting | Nearly indestructible |
| 11 | Dragonbone | 2.50x | 180 | Dragon kills, palace | Inherent fire resistance |
| 12 | Celestial | 3.00x | 210 | Divine sources, ultimate rewards | All elemental +5% |

### 5.2 Material Applications by Equipment Type

| Equipment Type | Material Applies To | Example |
|----------------|---------------------|---------|
| Weapons (Metal) | Swords, Axes, Maces, Daggers | Steel Longsword |
| Weapons (Wood) | Staves, Bows | Oak Staff, Yew Bow |
| Weapons (Fist) | Gauntlets, Claws | Iron Claws |
| Heavy Armor | Plate, Chainmail, Shields | Mythril Plate Armor |
| Medium Armor | Scale, Brigandine | Steel Scale Mail |
| Light Armor | Reinforced Cloth | Silver-threaded Robe |
| Accessories | Rings, Amulets, Charms | Gold Ring, Platinum Amulet |

### 5.3 Wood Material Tiers (Staves, Bows)

| Tier | Material | Stat Multiplier | Level Req | Properties |
|------|----------|-----------------|-----------|------------|
| 1 | Pine | 0.80x | 1 | Common, weak |
| 2 | Oak | 1.00x | 1 | Baseline wood |
| 3 | Ash | 1.15x | 15 | Flexible, resilient |
| 4 | Yew | 1.30x | 30 | Traditional magic wood |
| 5 | Ebony | 1.50x | 50 | Dark wood, +5% dark damage |
| 6 | Ironwood | 1.70x | 75 | Hard as metal |
| 7 | Spiritwood | 1.90x | 100 | Channels spiritual energy |
| 8 | Eldertree | 2.10x | 130 | Ancient magical growth |
| 9 | Worldtree | 2.40x | 165 | From the great tree |
| 10 | Celestial Oak | 2.80x | 200 | Divine origin |

### 5.4 Cloth/Leather Material Tiers (Light Armor)

| Tier | Material | Stat Multiplier | Level Req | Properties |
|------|----------|-----------------|-----------|------------|
| 1 | Linen | 0.80x | 1 | Basic cloth |
| 2 | Cotton | 1.00x | 1 | Standard cloth |
| 3 | Wool | 1.15x | 15 | Warm, insulating |
| 4 | Leather | 1.30x | 25 | Tanned hide |
| 5 | Silk | 1.50x | 45 | Magical conductivity |
| 6 | Shadowweave | 1.70x | 65 | +5% evasion |
| 7 | Dragonhide | 1.90x | 90 | Fire resistant |
| 8 | Mageweave | 2.10x | 120 | +10% MP |
| 9 | Ethereal Silk | 2.40x | 155 | Phase properties |
| 10 | Starcloth | 2.80x | 190 | Celestial origin |

### 5.5 Material Stat Calculation

Base item stats are multiplied by the material modifier:

```
final_base_stat = floor(template_base_stat × material_multiplier)
```

**Example:** Iron Sword (template: 12 ATK) vs Mythril Sword
- Iron: 12 × 1.00 = 12 ATK
- Mythril: 12 × 1.85 = 22 ATK

Material also affects item value:

```
material_price_modifier = material_multiplier ^ 2
item_base_price = template_price × material_price_modifier
```

---

## 6. Augmentation System

Augmentations add special effects to items through prefixes and suffixes. Items gain augmentation slots based on rarity, with effects scaling by intensity tier.

### 6.1 Augmentation Overview

| Rarity | Augment Slots | Max Intensity |
|--------|---------------|---------------|
| Common | 0 | - |
| Uncommon | 0-1 | Minor |
| Rare | 1 | Lesser/Standard |
| Epic | 1-2 | Greater |
| Legendary | 2 | Supreme |

**Augment Types:**
- **Prefixes**: Applied before material/item name (e.g., "Blazing", "Dragonbane")
- **Suffixes**: Applied after item name (e.g., "of Flames", "of Regeneration")
- Items can have up to 1 prefix + 1 suffix, or 2 suffixes

### 6.2 Elemental Augments

#### Fire Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Warm | of Sparks | +3% fire damage | +3% fire resist |
| Lesser | Heated | of Flames | +6% fire damage, 1% burn (2 turns) | +8% fire resist |
| Standard | Blazing | of Burning | +10% fire damage, 2% burn (2 turns) | +12% fire resist |
| Greater | Scorching | of Inferno | +15% fire damage, 3% burn (3 turns) | +18% fire resist |
| Supreme | Volcanic | of Cinders | +25% fire damage, 5% burn (3 turns) | +25% fire resist, reflect 3% fire |

#### Ice Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Chilled | of Frost | +3% ice damage | +3% ice resist |
| Lesser | Cold | of Ice | +6% ice damage, 5% slow (1 turn) | +8% ice resist |
| Standard | Frigid | of Winter | +10% ice damage, 10% slow (2 turns) | +12% ice resist |
| Greater | Frozen | of Blizzard | +15% ice damage, 15% slow (2 turns) | +18% ice resist |
| Supreme | Glacial | of the Tundra | +25% ice damage, 20% slow, 5% freeze | +25% ice resist, attackers 10% slow |

#### Lightning Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Static | of Sparking | +3% lightning damage | +3% lightning resist |
| Lesser | Charged | of Jolts | +6% lightning damage, 3% stun | +8% lightning resist |
| Standard | Shocking | of Storms | +10% lightning damage, 6% stun | +12% lightning resist |
| Greater | Thundering | of Thunder | +15% lightning damage, 10% stun | +18% lightning resist |
| Supreme | Tempest | of the Maelstrom | +25% lightning damage, 15% stun, chain 25% | +25% lightning resist, 5% reflect |

#### Poison Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Tainted | of Venom | +2% poison damage | +3% poison resist |
| Lesser | Toxic | of Toxins | +4% poison damage, 1% DoT (3 turns) | +8% poison resist |
| Standard | Venomous | of Plague | +8% poison damage, 2% DoT (3 turns) | +12% poison resist |
| Greater | Noxious | of Blight | +12% poison damage, 3% DoT (4 turns) | +18% poison resist |
| Supreme | Virulent | of Corruption | +20% poison damage, 5% DoT (5 turns) | +25% poison resist, cure poison on hit |

#### Holy Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Blessed | of Light | +3% holy damage, +5% vs undead | +3% dark resist |
| Lesser | Sacred | of Radiance | +6% holy damage, +10% vs undead | +8% dark resist |
| Standard | Hallowed | of Divinity | +10% holy damage, +15% vs undead/demon | +12% dark resist |
| Greater | Consecrated | of the Seraph | +15% holy damage, +20% vs undead/demon | +18% dark resist, -10% incoming dark |
| Supreme | Divine | of Judgment | +25% holy damage, +30% vs evil types | +25% dark resist, auto-cleanse debuffs |

#### Dark Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Shadowed | of Darkness | +3% dark damage | +3% holy resist |
| Lesser | Gloomy | of Shadows | +6% dark damage, 3% blind (1 turn) | +8% holy resist |
| Standard | Umbral | of Night | +10% dark damage, 5% blind (1 turn) | +12% holy resist |
| Greater | Abyssal | of the Void | +15% dark damage, 8% blind (2 turns) | +18% holy resist |
| Supreme | Stygian | of Oblivion | +25% dark damage, 12% blind, 3% instant kill | +25% holy resist, stealth on low HP |

#### Earth Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Earthen | of Stone | +3% earth damage | +3% earth resist, +1% defense |
| Lesser | Rocky | of the Mountain | +6% earth damage, 3% stagger | +8% earth resist, +3% defense |
| Standard | Granite | of Bedrock | +10% earth damage, 6% stagger | +12% earth resist, +5% defense |
| Greater | Tectonic | of Tremors | +15% earth damage, 10% knockback | +18% earth resist, +8% defense |
| Supreme | Primordial | of the Titan | +25% earth damage, 15% knockback/stagger | +25% earth resist, +12% defense |

#### Wind Augments

| Intensity | Prefix | Suffix | Weapon Effect | Armor Effect |
|-----------|--------|--------|---------------|--------------|
| Minor | Breezy | of Gusts | +3% wind damage | +3% wind resist, +1% evasion |
| Lesser | Windy | of Gales | +6% wind damage, +3% accuracy | +8% wind resist, +3% evasion |
| Standard | Stormy | of Tempests | +10% wind damage, +5% accuracy | +12% wind resist, +5% evasion |
| Greater | Cyclonic | of Hurricanes | +15% wind damage, 8% knockback | +18% wind resist, +8% evasion |
| Supreme | Zephyr | of the Sky Lord | +25% wind damage, +10% accuracy, fly 1 turn | +25% wind resist, +12% evasion |

### 6.3 Enemy-Type Augments

Prefixes that provide bonuses against specific enemy types. Offensive variants for weapons, defensive variants for armor.

#### Offensive Prefixes (Weapons)

| Prefix | Target Type | Effect | Min Rarity |
|--------|-------------|--------|------------|
| Dragonbane | Dragon | +20% damage vs dragons | Rare |
| Wyrmslayer | Dragon | +35% damage vs dragons | Legendary |
| Undeadbane | Undead | +20% damage vs undead | Rare |
| Soulreaper | Undead | +35% damage vs undead, heal 3% on kill | Legendary |
| Demonslayer | Demon | +20% damage vs demons | Rare |
| Hellbreaker | Demon | +35% damage vs demons, +10% holy | Legendary |
| Beastmaster | Beast | +20% damage vs beasts | Uncommon |
| Apex Hunter | Beast | +35% damage vs beasts, +10% crit vs beasts | Epic |
| Giantslayer | Giant | +20% damage vs giants | Rare |
| Titanfall | Giant | +35% damage vs giants, ignore armor | Legendary |
| Goblinbane | Goblinoid | +15% damage vs goblins/orcs | Uncommon |
| Greenskin Terror | Goblinoid | +30% damage vs goblins/orcs, fear effect | Epic |
| Trollhunter | Troll | +20% damage vs trolls, reduce regen | Rare |
| Insectoid | Insect | +15% damage vs insects/spiders | Uncommon |
| Elementalist | Elemental | +20% damage vs elementals | Rare |
| Abomination | Aberration | +20% damage vs aberrations | Rare |
| Construct Breaker | Construct | +20% damage vs golems/constructs | Rare |

#### Defensive Prefixes (Armor)

| Prefix | Target Type | Effect | Min Rarity |
|--------|-------------|--------|------------|
| Wyrmward | Dragon | +20% defense vs dragons | Rare |
| Dragonheart | Dragon | +35% defense vs dragons, fire immune | Legendary |
| Spiritguard | Undead | +20% defense vs undead | Rare |
| Soulshield | Undead | +35% defense vs undead, curse immune | Legendary |
| Demonward | Demon | +20% defense vs demons | Rare |
| Sanctified | Demon | +35% defense vs demons, +15% holy resist | Legendary |
| Beastward | Beast | +20% defense vs beasts | Uncommon |
| Trollward | Troll | +20% defense vs trolls, poison resist | Rare |
| Giantward | Giant | +20% defense vs giants, knockback resist | Rare |

### 6.4 Defensive Augments

Focused on damage mitigation, blocking, and survivability.

#### Physical Defense

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Sturdy | of Fortitude | +5% physical defense | Common |
| Lesser | Reinforced | of the Bulwark | +10% physical defense | Uncommon |
| Standard | Fortified | of the Fortress | +15% physical defense | Rare |
| Greater | Impervious | of the Bastion | +20% physical defense | Epic |
| Supreme | Invincible | of the Juggernaut | +30% physical defense, +5% all resist | Legendary |

#### Magical Defense

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Warded | of Shielding | +5% magic defense | Common |
| Lesser | Enchanted | of Warding | +10% magic defense | Uncommon |
| Standard | Hexproof | of Protection | +15% magic defense | Rare |
| Greater | Spellguard | of Nullification | +20% magic defense | Epic |
| Supreme | Arcane | of the Aegis | +30% magic defense, spell reflect 5% | Legendary |

#### Blocking

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Blocking | of Deflection | +5% block chance | Uncommon |
| Lesser | Guarding | of the Sentinel | +10% block chance | Rare |
| Standard | Stalwart | of the Guardian | +15% block chance | Rare |
| Greater | Towering | of the Phalanx | +20% block chance, +5% block value | Epic |
| Supreme | Unbreakable | of the Wall | +25% block chance, +15% block value | Legendary |

#### Damage Reflection

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Lesser | Thorned | of Thorns | Reflect 3% melee damage | Rare |
| Standard | Spiked | of Retaliation | Reflect 6% melee damage | Epic |
| Greater | Barbed | of Vengeance | Reflect 10% melee damage | Epic |
| Supreme | Retributive | of Retribution | Reflect 15% all damage | Legendary |

### 6.5 Support Augments

Focus on regeneration, resource management, and party benefits.

#### Health Regeneration

| Intensity | Suffix | Effect | Min Rarity |
|-----------|--------|--------|------------|
| Minor | of Mending | Heal 1% max HP per turn | Uncommon |
| Lesser | of Restoration | Heal 2% max HP per turn | Rare |
| Standard | of Rejuvenation | Heal 3% max HP per turn | Epic |
| Greater | of Vitality | Heal 4% max HP per turn, +10% max HP | Epic |
| Supreme | of Regeneration | Heal 5% max HP per turn, +20% max HP | Legendary |

#### Mana Regeneration

| Intensity | Suffix | Effect | Min Rarity |
|-----------|--------|--------|------------|
| Minor | of the Sage | +10% max MP | Uncommon |
| Lesser | of Sorcery | +15% max MP, +2% MP regen/turn | Rare |
| Standard | of Wizardry | +20% max MP, +3% MP regen/turn | Epic |
| Greater | of the Magus | +25% max MP, +4% MP regen/turn | Epic |
| Supreme | of the Archmage | +35% max MP, +5% MP regen/turn, -10% spell cost | Legendary |

#### Lifesteal/Drain

| Intensity | Suffix | Effect | Min Rarity |
|-----------|--------|--------|------------|
| Minor | of Sapping | 2% lifesteal | Uncommon |
| Lesser | of Siphoning | 4% lifesteal | Rare |
| Standard | of Vampirism | 6% lifesteal | Epic |
| Greater | of the Vampire | 8% lifesteal, 2% mana drain | Epic |
| Supreme | of the Leech | 12% lifesteal, 5% mana drain | Legendary |

#### Experience/Gold Bonuses

| Intensity | Suffix | Effect | Min Rarity |
|-----------|--------|--------|------------|
| Minor | of Learning | +5% experience gained | Uncommon |
| Lesser | of Wisdom | +10% experience gained | Rare |
| Standard | of Enlightenment | +15% experience gained | Epic |
| Minor | of Prosperity | +5% gold find | Uncommon |
| Lesser | of Wealth | +10% gold find | Rare |
| Standard | of Fortune | +15% gold find, +5% item find | Epic |
| Supreme | of Avarice | +25% gold find, +10% item find | Legendary |

### 6.6 Combat Augments

Enhance offensive capabilities through critical hits, accuracy, and speed.

#### Critical Hit

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Keen | of Precision | +3% crit chance | Uncommon |
| Lesser | Sharp | of Striking | +6% crit chance | Rare |
| Standard | Razor | of Accuracy | +10% crit chance | Rare |
| Greater | Deadly | of Lethality | +12% crit chance, +15% crit damage | Epic |
| Supreme | Assassin's | of Execution | +15% crit chance, +30% crit damage | Legendary |

#### Attack Speed/Initiative

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Quick | of Haste | +5% initiative | Uncommon |
| Lesser | Rapid | of Speed | +10% initiative | Rare |
| Standard | Fleet | of Alacrity | +15% initiative | Epic |
| Greater | Lightning | of Celerity | +20% initiative, +1 action | Epic |
| Supreme | Blinding | of the Wind | +30% initiative, first strike | Legendary |

#### Evasion/Movement

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Light | of Agility | +3% evasion | Uncommon |
| Lesser | Swift | of Dodging | +6% evasion | Rare |
| Standard | Nimble | of the Wind | +10% evasion, +1 movement | Rare |
| Greater | Elusive | of Shadows | +15% evasion, +1 movement | Epic |
| Supreme | Phantom | of the Ghost | +20% evasion, +2 movement, phase 1/battle | Legendary |

#### Armor Penetration

| Intensity | Prefix | Suffix | Effect | Min Rarity |
|-----------|--------|--------|--------|------------|
| Minor | Piercing | of Puncturing | +5% armor penetration | Uncommon |
| Lesser | Rending | of Rending | +10% armor penetration | Rare |
| Standard | Sundering | of Sundering | +15% armor penetration | Epic |
| Greater | Devastating | of Devastation | +20% armor penetration | Epic |
| Supreme | Obliterating | of Annihilation | +30% armor penetration, ignore shields | Legendary |

### 6.7 Unique/Set Augments

Special augments that only appear on specific item types or as part of sets.

#### Weapon-Specific

| Augment | Weapon Types | Effect | Rarity |
|---------|--------------|--------|--------|
| Whirlwind | Swords, Axes | Attack all adjacent enemies | Epic |
| Cleave | Axes, Greatswords | 50% damage to second target | Rare |
| Riposte | Swords, Rapiers | Counter-attack on dodge | Epic |
| Execute | Daggers, Swords | +50% damage vs targets below 25% HP | Legendary |
| Multishot | Crossbows | Hit 2 targets at reduced damage | Epic |
| Spellweave | Staves, Wands | Chance to cast free spell | Legendary |
| Combo Strike | Fist weapons | +10% damage per consecutive hit | Epic |

#### Armor-Specific

| Augment | Armor Types | Effect | Rarity |
|---------|-------------|--------|--------|
| Second Wind | Heavy Armor | Auto-heal 20% HP once per battle when below 25% | Legendary |
| Mage Armor | Robes | Convert 25% physical damage to MP cost | Epic |
| Evasion Mastery | Light Armor | Double evasion when below 50% HP | Epic |
| Last Stand | Shields | Cannot die for 1 turn after fatal damage | Legendary |

---

## 7. Item Templates

### 7.1 Template Schema

```json
{
  "templateId": "string",
  "name": "string",
  "description": "string",
  "itemType": "weapon|armor|accessory|consumable|material|key_item",
  "equipmentSlot": "main_hand|off_hand|head|body|feet|accessory|null",
  "weaponType": "sword|axe|mace|staff|wand|fist|dagger|crossbow|null",

  "levelRequirement": "integer (1-256)",
  "classRequirement": ["class_id"] | null,

  "baseStats": {
    "statName": "baseValue"
  },
  "statRanges": {
    "statName": { "min": "integer", "max": "integer" }
  },

  "possibleBonusStats": ["statName"],
  "maxBonusStats": "integer (0-4)",

  "basePrice": "integer",
  "sprite": "string"
}
```

### 7.2 Stat Types

**Primary Stats:**
| Stat | ID | Description |
|------|----|-------------|
| Strength | `strength` | Physical damage |
| Intelligence | `intelligence` | Magic damage |
| Agility | `agility` | Speed, evasion |
| Vitality | `vitality` | Defense, HP |
| Luck | `luck` | Crit, drops |

**Derived Stats:**
| Stat | ID | Description |
|------|----|-------------|
| Physical Attack | `physicalAttack` | Weapon damage |
| Magic Attack | `magicAttack` | Spell damage |
| Defense | `defense` | Damage reduction |
| Max HP | `hpMax` | Health pool |
| Max MP | `mpMax` | Mana pool |
| Critical Chance | `critChance` | Crit % (additive) |
| Evasion | `evasion` | Dodge % (additive) |
| Block Chance | `blockChance` | Shield block % |
| Movement | `movement` | Tile movement bonus |

---

## 8. Item Generation

### 8.1 Generation Algorithm

```
generateItem(templateId, seed, targetLevel, forcedRarity = null, forcedMaterial = null):

    1. INITIALIZE
       rng = SeededRandom(seed)
       template = loadTemplate(templateId)
       item = new ItemInstance()
       item.templateId = templateId
       item.generationSeed = seed

    2. DETERMINE RARITY
       if forcedRarity != null:
           item.rarity = forcedRarity
       else:
           roll = rng.next()  // 0.0 - 1.0
           if roll < 0.70:
               item.rarity = "common"
           else if roll < 0.90:
               item.rarity = "uncommon"
           else if roll < 0.98:
               item.rarity = "rare"
           else if roll < 0.998:
               item.rarity = "epic"
           else:
               item.rarity = "legendary"

    3. DETERMINE MATERIAL
       if forcedMaterial != null:
           item.material = forcedMaterial
       else:
           materialPool = getMaterialsForLevel(targetLevel, template.materialType)
           // Higher rarity = higher chance of better material
           materialRoll = rng.next() * getRarityMaterialBonus(item.rarity)
           item.material = selectMaterial(materialPool, materialRoll)

       item.materialMultiplier = getMaterialMultiplier(item.material)

    4. CALCULATE BASE STATS
       rarityRange = getRarityMultiplierRange(item.rarity)
       rarityMod = rarityRange.min + (rng.next() * (rarityRange.max - rarityRange.min))

       for each stat in template.baseStats:
           range = template.statRanges[stat]
           baseRoll = range.min + (rng.next() * (range.max - range.min))
           // Apply material multiplier to base stats
           item.stats[stat] = floor(baseRoll * rarityMod * item.materialMultiplier)

    5. ROLL BONUS STATS
       bonusSlotRange = getBonusSlotRange(item.rarity)
       bonusCount = bonusSlotRange.min + floor(rng.next() * (bonusSlotRange.max - bonusSlotRange.min + 1))

       availableStats = copy(template.possibleBonusStats)
       bonusCount = min(bonusCount, template.maxBonusStats, availableStats.length)

       for i = 0 to bonusCount - 1:
           statIndex = floor(rng.next() * availableStats.length)
           stat = availableStats.splice(statIndex, 1)
           bonusValue = calculateBonusValue(stat, targetLevel, item.rarity, rng)
           item.bonusStats[stat] = bonusValue

    6. ROLL AUGMENTATIONS
       augmentSlots = getAugmentSlots(item.rarity)
       // Common: 0, Uncommon: 0-1, Rare: 1, Epic: 1-2, Legendary: 2

       item.augments = []
       maxIntensity = getMaxIntensity(item.rarity)

       for i = 0 to augmentSlots - 1:
           augmentType = rollAugmentType(rng, template.itemType, i)
           // i=0 prefers prefix augments, i=1 prefers suffix augments

           augmentPool = getAugmentPool(augmentType, template.itemType)
           intensity = rollIntensity(rng, maxIntensity)

           augment = selectAugment(augmentPool, intensity, rng)
           item.augments.push(augment)

    7. APPLY MATERIAL PROPERTIES
       // Some materials have innate bonuses
       if item.material == "silver":
           item.bonusEffects.push({ type: "damage_vs", target: "undead", value: 0.10 })
       else if item.material == "gold":
           item.bonusEffects.push({ type: "spell_power", value: 0.05 })
       else if item.material == "mythril":
           item.bonusEffects.push({ type: "movement_cost", value: -1 })
       else if item.material == "obsidian":
           item.bonusEffects.push({ type: "crit_chance", value: 0.05 })
       // ... other material bonuses

    8. GENERATE NAME
       qualityPrefix = ""
       if item.rarity != "common":
           prefixes = getQualityPrefixPool(item.rarity)
           qualityPrefix = prefixes[floor(rng.next() * prefixes.length)] + " "

       augmentPrefix = ""
       augmentSuffix = ""
       for augment in item.augments:
           if augment.isPrefix and augmentPrefix == "":
               augmentPrefix = augment.prefix + " "
           else if !augment.isPrefix and augmentSuffix == "":
               augmentSuffix = " " + augment.suffix

       // Fallback to stat suffix if no augment suffix
       if augmentSuffix == "" and item.bonusStats.length > 0:
           highestStat = getHighestBonusStat(item.bonusStats)
           augmentSuffix = " " + getStatSuffix(highestStat)

       materialName = getMaterialDisplayName(item.material)
       itemTypeName = template.baseTypeName

       item.name = qualityPrefix + augmentPrefix + materialName + " " + itemTypeName + augmentSuffix

    9. CALCULATE PRICE
       basePrice = template.basePrice
       materialMod = item.materialMultiplier ^ 2
       rarityMod = getRarityPriceMultiplier(item.rarity)
       augmentMod = 1 + (item.augments.length * 0.5)

       statBonus = sum(item.stats.values) * 2
       bonusBonus = sum(item.bonusStats.values) * 5

       item.price = floor((basePrice * materialMod * rarityMod * augmentMod) + statBonus + bonusBonus)

    10. COPY METADATA
        item.description = generateDescription(template, item)
        item.itemType = template.itemType
        item.equipmentSlot = template.equipmentSlot
        item.levelRequirement = max(targetLevel, getMaterialLevelReq(item.material))
        item.classRequirement = template.classRequirement
        item.sprite = template.sprite + "_" + item.material

    11. RETURN item
```

### 8.2 Material Selection

```
getMaterialsForLevel(level, materialType):
    // Returns materials available at or below the given level
    // materialType: "metal", "wood", "cloth"

    materials = {
        "metal": [
            { name: "copper", level: 1 },
            { name: "iron", level: 1 },
            { name: "bronze", level: 10 },
            { name: "steel", level: 20 },
            { name: "silver", level: 35 },
            { name: "gold", level: 50 },
            { name: "platinum", level: 70 },
            { name: "mythril", level: 90 },
            { name: "obsidian", level: 120 },
            { name: "adamantine", level: 150 },
            { name: "dragonbone", level: 180 },
            { name: "celestial", level: 210 }
        ],
        // Similar arrays for "wood" and "cloth"
    }

    return materials[materialType].filter(m => m.level <= level)

selectMaterial(pool, roll):
    // Higher roll = higher tier material from pool
    // roll is 0.0 to ~1.5 (with rarity bonus)
    index = floor(roll * pool.length)
    index = min(index, pool.length - 1)
    return pool[index]

getRarityMaterialBonus(rarity):
    // Higher rarity = better chance at high-tier materials
    return {
        "common": 0.6,
        "uncommon": 0.8,
        "rare": 1.0,
        "epic": 1.2,
        "legendary": 1.5
    }[rarity]
```

### 8.3 Augmentation Selection

```
getAugmentSlots(rarity):
    slots = {
        "common": 0,
        "uncommon": randomChoice([0, 1]),  // 50% chance
        "rare": 1,
        "epic": randomChoice([1, 2]),      // 50% chance of 2
        "legendary": 2
    }
    return slots[rarity]

getMaxIntensity(rarity):
    return {
        "common": 0,
        "uncommon": 1,      // Minor only
        "rare": 3,          // Up to Standard
        "epic": 4,          // Up to Greater
        "legendary": 5      // Up to Supreme
    }[rarity]

rollAugmentType(rng, itemType, slotIndex):
    // Slot 0 tends toward prefixes, slot 1 toward suffixes
    if slotIndex == 0:
        prefixChance = 0.7
    else:
        prefixChance = 0.3

    if rng.next() < prefixChance:
        // Roll prefix type
        roll = rng.next()
        if roll < 0.3:
            return "enemy_type"     // Dragonbane, etc.
        else if roll < 0.7:
            return "elemental"      // Blazing, Glacial, etc.
        else:
            return "combat"         // Keen, Swift, etc.
    else:
        // Roll suffix type
        roll = rng.next()
        if roll < 0.25:
            return "elemental"      // of Flames, of Frost
        else if roll < 0.50:
            return "support"        // of Regeneration, of the Sage
        else if roll < 0.75:
            return "combat"         // of Precision, of Execution
        else:
            return "defensive"      // of the Bulwark, of Protection

rollIntensity(rng, maxIntensity):
    // Lower intensities are more common
    weights = [40, 30, 15, 10, 5]  // Minor, Lesser, Standard, Greater, Supreme
    totalWeight = sum(weights[0:maxIntensity])

    roll = rng.next() * totalWeight
    cumulative = 0
    for i = 0 to maxIntensity - 1:
        cumulative += weights[i]
        if roll < cumulative:
            return i + 1
    return maxIntensity
```

### 8.4 Bonus Stat Value Calculation

```
calculateBonusValue(stat, itemLevel, rarity, rng):

    baseBonusTable = {
        "strength": 1 + (itemLevel * 0.1),
        "intelligence": 1 + (itemLevel * 0.1),
        "agility": 1 + (itemLevel * 0.08),
        "vitality": 1 + (itemLevel * 0.1),
        "luck": 1 + (itemLevel * 0.05),
        "hpMax": 5 + (itemLevel * 0.5),
        "mpMax": 3 + (itemLevel * 0.3),
        "critChance": 0.5 + (itemLevel * 0.02),
        "evasion": 0.5 + (itemLevel * 0.02),
        "movement": 0  // Fixed at 1 if rolled
    }

    baseValue = baseBonusTable[stat]

    rarityBonusMod = {
        "common": 1.0,
        "uncommon": 1.2,
        "rare": 1.5,
        "epic": 2.0,
        "legendary": 3.0
    }

    variance = 0.8 + (rng.next() * 0.4)  // 0.8 - 1.2

    if stat == "movement":
        return 1  // Always +1 movement if rolled

    return floor(baseValue * rarityBonusMod[rarity] * variance)
```

### 8.5 Seeded Random (Mulberry32)

Uses the same seeded random as world generation for consistency:

```javascript
function SeededRandom(seed) {
    this.seed = seed;

    this.next = function() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
```

---

## 9. Level and Class Requirements

### 9.1 Level Scaling

Items are grouped into level tiers:

| Tier | Level Range | Typical Sources |
|------|-------------|-----------------|
| 1 | 1-10 | Starting areas, basic shops |
| 2 | 11-25 | Early dungeons, village shops |
| 3 | 26-50 | Mid-game dungeons, city shops |
| 4 | 51-100 | Late dungeons, guild shops |
| 5 | 101-150 | End-game content |
| 6 | 151-200 | Post-game, rare drops |
| 7 | 201-256 | Ultimate challenges |

### 9.2 Class Requirements

Equipment falls into categories:

| Category | Classes | Examples |
|----------|---------|----------|
| Heavy | Warrior, Paladin, Guardian, Warlord, Brawler | Plate armor, heavy shields |
| Medium | Berserker, Monk, Ninja, Martial Artist, Chemist | Chain mail, leather armor |
| Light | Wizard, Sorcerer, Summoner, Conjurer, Oracle, Ascetic | Robes, cloth |
| Universal | All | Accessories, some boots |

**Class-Specific Weapons:**

| Weapon Type | Base Class | Advanced Classes |
|-------------|------------|------------------|
| Swords | Warrior | Paladin, Berserker, Guardian, Warlord |
| Axes/Maces | Warrior | Berserker, Guardian, Warlord |
| Staves | Wizard | Sorcerer, Conjurer, Oracle |
| Wands | Wizard | Summoner, Oracle |
| Fist Weapons | Monk | All Monk advanced |
| Daggers | Chemist | Alchemist, Plague Doctor |
| Crossbows | Chemist | Artificer |

---

## 10. Example Templates

### 10.1 Weapons

```json
{
  "templateId": "weapon_sword_iron",
  "name": "Iron Sword",
  "description": "A reliable blade forged from iron.",
  "itemType": "weapon",
  "equipmentSlot": "main_hand",
  "weaponType": "sword",
  "levelRequirement": 1,
  "classRequirement": ["warrior"],
  "baseStats": {
    "physicalAttack": 12
  },
  "statRanges": {
    "physicalAttack": { "min": 10, "max": 15 }
  },
  "possibleBonusStats": ["strength", "agility", "critChance"],
  "maxBonusStats": 2,
  "basePrice": 100,
  "sprite": "sword_iron"
}
```

```json
{
  "templateId": "weapon_staff_oak",
  "name": "Oak Staff",
  "description": "A wooden staff imbued with minor magical properties.",
  "itemType": "weapon",
  "equipmentSlot": "main_hand",
  "weaponType": "staff",
  "levelRequirement": 1,
  "classRequirement": ["wizard"],
  "baseStats": {
    "magicAttack": 10,
    "mpMax": 5
  },
  "statRanges": {
    "magicAttack": { "min": 8, "max": 12 },
    "mpMax": { "min": 3, "max": 8 }
  },
  "possibleBonusStats": ["intelligence", "mpMax", "luck"],
  "maxBonusStats": 2,
  "basePrice": 100,
  "sprite": "staff_oak"
}
```

```json
{
  "templateId": "weapon_fist_leather",
  "name": "Leather Hand Wraps",
  "description": "Reinforced wraps that enhance striking power.",
  "itemType": "weapon",
  "equipmentSlot": "main_hand",
  "weaponType": "fist",
  "levelRequirement": 1,
  "classRequirement": ["monk"],
  "baseStats": {
    "physicalAttack": 8,
    "agility": 2
  },
  "statRanges": {
    "physicalAttack": { "min": 6, "max": 10 },
    "agility": { "min": 1, "max": 4 }
  },
  "possibleBonusStats": ["agility", "critChance", "evasion"],
  "maxBonusStats": 2,
  "basePrice": 80,
  "sprite": "fist_leather"
}
```

### 10.2 Armor

```json
{
  "templateId": "armor_plate_iron",
  "name": "Iron Plate Armor",
  "description": "Heavy armor offering solid protection.",
  "itemType": "armor",
  "equipmentSlot": "body",
  "levelRequirement": 5,
  "classRequirement": ["warrior"],
  "baseStats": {
    "defense": 15,
    "hpMax": 20
  },
  "statRanges": {
    "defense": { "min": 12, "max": 18 },
    "hpMax": { "min": 15, "max": 25 }
  },
  "possibleBonusStats": ["vitality", "hpMax", "strength"],
  "maxBonusStats": 2,
  "basePrice": 300,
  "sprite": "armor_plate_iron"
}
```

```json
{
  "templateId": "armor_robe_apprentice",
  "name": "Apprentice Robe",
  "description": "A simple robe worn by magic students.",
  "itemType": "armor",
  "equipmentSlot": "body",
  "levelRequirement": 1,
  "classRequirement": ["wizard", "chemist"],
  "baseStats": {
    "defense": 3,
    "mpMax": 15
  },
  "statRanges": {
    "defense": { "min": 2, "max": 5 },
    "mpMax": { "min": 10, "max": 20 }
  },
  "possibleBonusStats": ["intelligence", "mpMax", "luck"],
  "maxBonusStats": 2,
  "basePrice": 150,
  "sprite": "robe_apprentice"
}
```

### 10.3 Accessories

```json
{
  "templateId": "accessory_ring_copper",
  "name": "Copper Ring",
  "description": "A simple ring with a faint magical aura.",
  "itemType": "accessory",
  "equipmentSlot": "accessory",
  "levelRequirement": 1,
  "classRequirement": null,
  "baseStats": {},
  "statRanges": {},
  "possibleBonusStats": ["strength", "intelligence", "agility", "vitality", "luck"],
  "maxBonusStats": 1,
  "basePrice": 50,
  "sprite": "ring_copper"
}
```

```json
{
  "templateId": "accessory_amulet_warrior",
  "name": "Warrior's Amulet",
  "description": "An amulet bearing the mark of battle.",
  "itemType": "accessory",
  "equipmentSlot": "accessory",
  "levelRequirement": 10,
  "classRequirement": ["warrior"],
  "baseStats": {
    "strength": 3
  },
  "statRanges": {
    "strength": { "min": 2, "max": 5 }
  },
  "possibleBonusStats": ["hpMax", "critChance", "vitality"],
  "maxBonusStats": 2,
  "basePrice": 200,
  "sprite": "amulet_warrior"
}
```

### 10.4 High-Level Equipment

```json
{
  "templateId": "weapon_sword_dragon",
  "name": "Dragon Slayer",
  "description": "A legendary blade forged to fell dragons.",
  "itemType": "weapon",
  "equipmentSlot": "main_hand",
  "weaponType": "sword",
  "levelRequirement": 150,
  "classRequirement": ["warrior"],
  "baseStats": {
    "physicalAttack": 180,
    "strength": 25
  },
  "statRanges": {
    "physicalAttack": { "min": 160, "max": 200 },
    "strength": { "min": 20, "max": 30 }
  },
  "possibleBonusStats": ["critChance", "hpMax", "agility", "luck"],
  "maxBonusStats": 4,
  "basePrice": 50000,
  "sprite": "sword_dragon"
}
```

### 10.5 Off-Hand Equipment

```json
{
  "templateId": "shield_iron",
  "name": "Iron Shield",
  "description": "A sturdy shield for blocking attacks.",
  "itemType": "shield",
  "equipmentSlot": "off_hand",
  "levelRequirement": 5,
  "classRequirement": ["warrior", "chemist"],
  "baseStats": {
    "defense": 10,
    "blockChance": 5
  },
  "statRanges": {
    "defense": { "min": 8, "max": 12 },
    "blockChance": { "min": 3, "max": 7 }
  },
  "possibleBonusStats": ["vitality", "hpMax"],
  "maxBonusStats": 1,
  "basePrice": 200,
  "sprite": "shield_iron"
}
```

```json
{
  "templateId": "orb_crystal",
  "name": "Crystal Orb",
  "description": "A focusing orb that amplifies magical energy.",
  "itemType": "orb",
  "equipmentSlot": "off_hand",
  "levelRequirement": 10,
  "classRequirement": ["wizard"],
  "baseStats": {
    "magicAttack": 8,
    "mpMax": 10
  },
  "statRanges": {
    "magicAttack": { "min": 6, "max": 10 },
    "mpMax": { "min": 8, "max": 15 }
  },
  "possibleBonusStats": ["intelligence", "mpMax", "luck"],
  "maxBonusStats": 2,
  "basePrice": 250,
  "sprite": "orb_crystal"
}
```

### 10.6 Generated Item Examples

These examples show items as they would be generated with materials and augmentations.

#### Common Item (No Augments)

**Iron Longsword**
```json
{
  "instanceId": "item_12345",
  "templateId": "weapon_sword_longsword",
  "name": "Iron Longsword",
  "rarity": "common",
  "material": "iron",
  "materialMultiplier": 1.0,
  "stats": {
    "physicalAttack": 14
  },
  "bonusStats": {},
  "augments": [],
  "bonusEffects": [],
  "levelRequirement": 1,
  "price": 100
}
```

#### Uncommon Item (Stat Suffix)

**Fine Steel Longsword of Might**
```json
{
  "instanceId": "item_12346",
  "templateId": "weapon_sword_longsword",
  "name": "Fine Steel Longsword of Might",
  "rarity": "uncommon",
  "material": "steel",
  "materialMultiplier": 1.25,
  "stats": {
    "physicalAttack": 19
  },
  "bonusStats": {
    "strength": 4
  },
  "augments": [],
  "bonusEffects": [],
  "levelRequirement": 20,
  "price": 280
}
```

#### Rare Item (Single Augment)

**Masterwork Blazing Mythril Greatsword**
```json
{
  "instanceId": "item_12347",
  "templateId": "weapon_sword_greatsword",
  "name": "Masterwork Blazing Mythril Greatsword",
  "rarity": "rare",
  "material": "mythril",
  "materialMultiplier": 1.85,
  "stats": {
    "physicalAttack": 48
  },
  "bonusStats": {
    "strength": 8,
    "critChance": 3
  },
  "augments": [
    {
      "type": "elemental_fire",
      "intensity": "standard",
      "isPrefix": true,
      "prefix": "Blazing",
      "effects": [
        { "type": "fire_damage", "value": 0.10 },
        { "type": "burn", "chance": 0.02, "duration": 2 }
      ]
    }
  ],
  "bonusEffects": [
    { "type": "movement_cost", "value": -1 }
  ],
  "levelRequirement": 90,
  "price": 8500
}
```

#### Epic Item (Dual Augments)

**Exalted Dragonbane Adamantine Plate of Regeneration**
```json
{
  "instanceId": "item_12348",
  "templateId": "armor_plate_heavy",
  "name": "Exalted Dragonbane Adamantine Plate of Regeneration",
  "rarity": "epic",
  "material": "adamantine",
  "materialMultiplier": 2.2,
  "stats": {
    "defense": 88,
    "hpMax": 150
  },
  "bonusStats": {
    "vitality": 15,
    "hpMax": 45,
    "strength": 8
  },
  "augments": [
    {
      "type": "enemy_dragon",
      "intensity": "standard",
      "isPrefix": true,
      "prefix": "Dragonbane",
      "effects": [
        { "type": "defense_vs", "target": "dragon", "value": 0.20 }
      ]
    },
    {
      "type": "support_heal",
      "intensity": "greater",
      "isPrefix": false,
      "suffix": "of Regeneration",
      "effects": [
        { "type": "hp_regen_percent", "value": 0.04 },
        { "type": "hp_max_percent", "value": 0.10 }
      ]
    }
  ],
  "bonusEffects": [],
  "levelRequirement": 150,
  "price": 125000
}
```

#### Legendary Item (Full Power)

**Divine Wyrmslayer Celestial Greatsword of Cinders**
```json
{
  "instanceId": "item_12349",
  "templateId": "weapon_sword_greatsword",
  "name": "Divine Wyrmslayer Celestial Greatsword of Cinders",
  "rarity": "legendary",
  "material": "celestial",
  "materialMultiplier": 3.0,
  "stats": {
    "physicalAttack": 156
  },
  "bonusStats": {
    "strength": 35,
    "critChance": 12,
    "critDamage": 20,
    "hpMax": 80
  },
  "augments": [
    {
      "type": "enemy_dragon",
      "intensity": "supreme",
      "isPrefix": true,
      "prefix": "Wyrmslayer",
      "effects": [
        { "type": "damage_vs", "target": "dragon", "value": 0.35 }
      ]
    },
    {
      "type": "elemental_fire",
      "intensity": "supreme",
      "isPrefix": false,
      "suffix": "of Cinders",
      "effects": [
        { "type": "fire_damage", "value": 0.25 },
        { "type": "burn", "chance": 0.05, "duration": 3 }
      ]
    }
  ],
  "bonusEffects": [
    { "type": "elemental_all", "value": 0.05 }
  ],
  "levelRequirement": 210,
  "price": 850000
}
```

#### Support-Focused Legendary

**Godforged Spiritguard Dragonbone Vestments of the Archmage**
```json
{
  "instanceId": "item_12350",
  "templateId": "armor_robe_vestments",
  "name": "Godforged Spiritguard Dragonbone Vestments of the Archmage",
  "rarity": "legendary",
  "material": "dragonhide",
  "materialMultiplier": 2.5,
  "stats": {
    "defense": 35,
    "mpMax": 180
  },
  "bonusStats": {
    "intelligence": 40,
    "mpMax": 60,
    "luck": 15
  },
  "augments": [
    {
      "type": "enemy_undead",
      "intensity": "supreme",
      "isPrefix": true,
      "prefix": "Spiritguard",
      "effects": [
        { "type": "defense_vs", "target": "undead", "value": 0.35 },
        { "type": "immunity", "target": "curse" }
      ]
    },
    {
      "type": "support_mana",
      "intensity": "supreme",
      "isPrefix": false,
      "suffix": "of the Archmage",
      "effects": [
        { "type": "mp_max_percent", "value": 0.35 },
        { "type": "mp_regen_percent", "value": 0.05 },
        { "type": "spell_cost_reduction", "value": 0.10 }
      ]
    }
  ],
  "bonusEffects": [
    { "type": "fire_resist", "value": 0.15 }
  ],
  "levelRequirement": 180,
  "price": 720000
}
```

---

## 11. Drop Tables

### 11.1 Drop Table Overview

Drop tables define what items enemies can drop upon defeat. Each enemy has a drop table that specifies the number of items and rarity distribution.

### 11.2 Regular Enemy Drops

| Property | Value |
|----------|-------|
| Items Per Kill | 1-3 (random) |
| Drop Chance | 80% chance to drop at least one item |

**Rarity Distribution (Regular Enemies):**

| Rarity | Drop Rate | Notes |
|--------|-----------|-------|
| Common | 70% | Most drops |
| Uncommon | 20% | Frequent |
| Rare | 8% | Occasional |
| Epic | 2% | Very rare |
| Legendary | 0% | Never from regular enemies |

### 11.3 Boss Enemy Drops

| Property | Value |
|----------|-------|
| Items Per Kill | 2-4 (random) |
| Drop Chance | 100% guaranteed |
| Rare+ Guarantee | At least 1 rare or better item |

**Rarity Distribution (Boss Enemies):**

| Rarity | Drop Rate | Notes |
|--------|-----------|-------|
| Common | 20% | Filler items |
| Uncommon | 30% | Supporting drops |
| Rare | 30% | Common boss drop |
| Epic | 10% | Good boss reward |
| Legendary | 10% | Rare treasure |

### 11.4 Drop Table Schema

```json
{
  "dropTableId": "string",
  "dropChance": 0.8,
  "minItems": 1,
  "maxItems": 3,
  "guaranteedRarity": null,
  "rarityWeights": {
    "common": 70,
    "uncommon": 20,
    "rare": 8,
    "epic": 2,
    "legendary": 0
  },
  "itemPool": [
    {
      "templateId": "potion_hp_small",
      "weight": 50,
      "minQuantity": 1,
      "maxQuantity": 3
    },
    {
      "templateId": "weapon_sword_*",
      "weight": 20,
      "minQuantity": 1,
      "maxQuantity": 1
    }
  ],
  "terrainModifiers": {
    "forest": ["material_herb", "material_wood"],
    "cave": ["material_ore", "gem_*"],
    "mountain": ["material_stone", "material_ore"]
  }
}
```

### 11.5 Difficulty Tier Modifiers

Higher difficulty tiers improve drop quality:

| Tier | Rarity Bonus | Item Level Bonus | Notes |
|------|--------------|------------------|-------|
| 1 | +0% | +0 | Starting areas |
| 2 | +5% rare+ | +5 | Mid-tier areas |
| 3 | +10% rare+ | +10 | High-tier areas |
| 4 | +15% rare+ | +15 | Boss areas |
| 5 | +20% rare+ | +20 | Elite/Palace |

**Rarity Bonus**: Shifts the rarity distribution toward higher rarities.

### 11.6 Drop Calculation Algorithm

```
calculateDrops(enemy, killer):
    drops = []
    dropTable = getDropTable(enemy.templateId)

    // Check if anything drops
    if random() > dropTable.dropChance:
        return drops

    // Determine number of items
    itemCount = randInt(dropTable.minItems, dropTable.maxItems)

    // Apply difficulty tier modifier
    tierMod = getDifficultyModifier(enemy.difficultyTier)

    // Generate each drop
    for i = 0 to itemCount - 1:
        // Check for guaranteed rarity (boss first drop)
        if i == 0 and dropTable.guaranteedRarity != null:
            minRarity = dropTable.guaranteedRarity
        else:
            minRarity = "common"

        // Roll rarity with tier modifier
        rarity = rollRarity(dropTable.rarityWeights, tierMod, minRarity)

        // Select item from pool
        item = selectFromPool(dropTable.itemPool, rarity)

        // Generate the item instance
        itemLevel = enemy.level + tierMod.levelBonus
        seed = generateSeed(enemy.id, i, killer.id)
        instance = generateItem(item.templateId, seed, itemLevel, rarity)

        drops.push(instance)

    return drops
```

### 11.7 Example Drop Tables

**Forest Goblin (Tier 1 Regular):**
```json
{
  "dropTableId": "dt_goblin_forest",
  "dropChance": 0.75,
  "minItems": 1,
  "maxItems": 2,
  "guaranteedRarity": null,
  "rarityWeights": { "common": 75, "uncommon": 18, "rare": 6, "epic": 1, "legendary": 0 },
  "itemPool": [
    { "templateId": "potion_hp_small", "weight": 40 },
    { "templateId": "material_goblin_ear", "weight": 30 },
    { "templateId": "gold_pouch_small", "weight": 20 },
    { "templateId": "weapon_dagger_rusty", "weight": 10 }
  ]
}
```

**Mountain Troll Boss (Tier 3 Boss):**
```json
{
  "dropTableId": "dt_troll_mountain_boss",
  "dropChance": 1.0,
  "minItems": 3,
  "maxItems": 4,
  "guaranteedRarity": "rare",
  "rarityWeights": { "common": 15, "uncommon": 25, "rare": 35, "epic": 15, "legendary": 10 },
  "itemPool": [
    { "templateId": "armor_hide_troll", "weight": 25 },
    { "templateId": "weapon_club_massive", "weight": 20 },
    { "templateId": "material_troll_blood", "weight": 20 },
    { "templateId": "accessory_ring_*", "weight": 15 },
    { "templateId": "potion_hp_large", "weight": 10 },
    { "templateId": "gold_pouch_large", "weight": 10 }
  ]
}
```

---

## 12. Relic System

### 12.1 Overview

Relics are rare collectible items that provide **permanent stat bonuses** to the owning player. Unlike equipment, relics are not worn or traded—they are collected and their bonuses apply automatically.

Key characteristics:
- **Permanent**: Bonuses persist across all characters
- **Non-tradeable**: Cannot be sold or traded
- **Unique**: Each relic can only be collected once
- **Cumulative**: Multiple relics stack their bonuses

### 12.2 Relic Templates

| Relic | Stat Bonus | Acquisition |
|-------|------------|-------------|
| Ancient Coin | +2% Gold Drop | Ruins puzzle completion |
| Dragon Scale | +5 Physical Defense | Boss drop (dragon enemies) |
| Fairy Dust | +3% MP Regeneration | Rare shrine blessing |
| Warrior's Medal | +2 STR | Guild advancement (Warrior) |
| Scholar's Tome | +2 INT | Guild advancement (Wizard) |
| Monk's Beads | +2 AGI | Guild advancement (Monk) |
| Alchemist's Stone | +2 VIT | Guild advancement (Chemist) |

*Note: This is a subset of available relics. Additional relics may be added in future updates.*

### 12.3 Acquisition Methods

| Method | Description |
|--------|-------------|
| **Ruins** | Complete sliding tile puzzles in ruin nodes |
| **Shrines** | Visit zodiac shrines throughout the world |
| **Guild Advancement** | Complete guild advancement quests |
| **Boss Drops** | Defeat specific boss enemies |
| **Discovery Nodes** | Find rare discovery nodes at world edges |

### 12.4 Permanent Bonuses

Relic bonuses are applied at the account level:

```javascript
// Relic bonus calculation
function getRelicBonuses(userId) {
  const relics = getUserRelics(userId);
  return relics.reduce((bonuses, relic) => {
    // Add each relic's stats to cumulative bonuses
    return mergeStats(bonuses, relic.statBonus);
  }, {});
}
```

Bonuses affect:
- **Base stats**: STR, INT, AGI, VIT, LUK
- **Derived stats**: Defense, critical chance, regeneration
- **Economy**: Gold drop rate, XP gain

### 12.5 Collection UI

The `RelicCollectionModal.js` component displays:
- All collected relics with icons and descriptions
- Total cumulative bonuses from collection
- Zodiac crystal collection progress (12 crystals)
- Completion percentage toward full collection

Access via:
- World map menu → "Relics" button
- Profile dropdown → "Collection"

---

## Related Documents

| Document | Description |
|----------|-------------|
| [GAME_DESIGN.md](GAME_DESIGN.md) | Core game mechanics and classes |
| [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) | Skills, guilds, formation |
| [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) | NPC shops, marketplace, item trading |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | Inventory endpoints |
| [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | Enemy templates with drop tables |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-06 | Initial document |
| 2.0 | 2026-01-06 | Added drop table specifications |
| 3.0 | 2026-01-22 | Added Section 12: Relic System (templates, acquisition, bonuses, UI) |
