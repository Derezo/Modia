# Item System

| Document | Version | Last Updated |
|----------|---------|--------------|
| Item System Specification | 4.0 | 2026-01-25 |

## Table of Contents

1. [Overview](#1-overview)
2. [Current Implementation](#2-current-implementation)
   - 2.1 Item Template Structure
   - 2.2 Equipment Slots
   - 2.3 Item Types
   - 2.4 Rarity System
   - 2.5 Shop Stock
   - 2.6 Implemented Items
3. [Drop Tables](#3-drop-tables)
4. [Relic System](#4-relic-system)
   - 4.1 Overview
   - 4.2 Relic Templates
   - 4.3 Acquisition Methods
   - 4.4 Permanent Bonuses
   - 4.5 Collection UI
5. [Planned Features (Not Yet Implemented)](#5-planned-features-not-yet-implemented)
   - 5.1 Material Progression System
   - 5.2 Augmentation System
   - 5.3 Procedural Item Generation
   - 5.4 Advanced Weapon/Armor Types
   - 5.5 Item Naming System

---

## 1. Overview

Items in Modia are defined as static templates with fixed stats. The current implementation uses a straightforward template system where each item has predetermined stat bonuses, level requirements, and pricing.

### Core Concepts (Current)

- **Template**: Static item definition with fixed stats (see `api/src/db/templates/items.js`)
- **Rarity**: Integer value (1-4) affecting drop rates and item value
- **Equipment Slot**: Where the item can be equipped (main_hand, body, head, feet, accessory)
- **Stat Bonuses**: Object containing stat modifications (strength, intelligence, etc.)

---

## 2. Current Implementation

This section documents the item system as it exists in the codebase (`api/src/db/templates/items.js`).

### 2.1 Item Template Structure

Each item is defined with the following properties:

```javascript
{
  name: 'Iron Sword',           // Display name
  item_type: 'weapon',          // weapon, armor, accessory, consumable
  equipment_slot: 'main_hand',  // main_hand, body, head, feet, accessory (or null)
  stat_bonuses: { strength: 7 }, // Object with stat modifications
  level_requirement: 5,         // Minimum level to equip
  base_price: 150,              // Gold cost (sell value = base_price / 2)
  rarity: 2,                    // 1=Common, 2=Uncommon, 3=Rare, 4=Epic
  description: 'A sturdy iron blade forged by skilled smiths.'
}
```

**Note:** Items are seeded in order - `templateId` corresponds to array index + 1.

### 2.2 Equipment Slots

Characters have 5 equipment slots in the current implementation:

| Slot | ID | Item Types | Description |
|------|----|------------|-------------|
| Main Hand | `main_hand` | Weapons | Primary weapon (swords, staves, fists) |
| Body | `body` | Armor, Robes | Chest armor |
| Head | `head` | Helmets, Hats | Head armor |
| Feet | `feet` | Boots, Greaves | Foot armor |
| Accessory | `accessory` | Rings, Amulets, Charms | Single accessory slot |

### 2.3 Item Types

| Type | Description | Has Equipment Slot |
|------|-------------|-------------------|
| `weapon` | Equippable weapons | Yes (`main_hand`) |
| `armor` | Equippable armor pieces | Yes (`body`, `head`, `feet`) |
| `accessory` | Equippable accessories | Yes (`accessory`) |
| `consumable` | Single-use items | No |

**Consumable Effect Types:**
| Effect Type | Description |
|-------------|-------------|
| `heal_hp` | Restores HP by `effect_value` |
| `heal_mp` | Restores MP by `effect_value` |
| `heal_both` | Restores HP and MP (50% of `effect_value` for MP) |
| `cure_poison` | Removes poison status |
| `cure_all` | Removes all negative status effects |
| `revive` | Revives fallen ally with `effect_value`% HP |

### 2.4 Rarity System

The current implementation uses a simple integer rarity system:

| Rarity Value | Name | Description |
|--------------|------|-------------|
| 1 | Common | Basic items, widely available |
| 2 | Uncommon | Better stats, less common drops |
| 3 | Rare | Good stats, rare drops |
| 4 | Epic | Powerful items, very rare |

**Note:** There is no Legendary (5) tier currently implemented in item templates.

### 2.5 Shop Stock

Shops have predefined inventory defined in `SHOP_STOCK`:

**Blacksmith:** Weapons and armor
- Starter gear (Rusty Sword, Oak Staff, Combat Gloves, Leather Armor, Cloth Robe)
- Basic equipment (Bronze Axe, Apprentice Wand, Leather Helm, Leather Boots)
- Higher-tier items with lower stock (Iron Sword, Chain Mail, Iron Axe, Steel Fist, Iron Helm, Iron Greaves, Wizard Hat)

**Apothecary:** Consumables
- Potions (Health, Mana, Hi-Potion, Hi-Ether, Elixir)
- Status cures (Antidote, Status Cure)
- Rare items (Phoenix Feather - qty 2)

**Farm:** Basic consumables at village prices
- Health Potion, Mana Potion, Antidote

### 2.6 Implemented Items

**Weapons (templateId 1-6, 16-20, 33-44):**

| ID | Name | Slot | Stats | Level | Price | Rarity |
|----|------|------|-------|-------|-------|--------|
| 1 | Rusty Sword | main_hand | STR +3 | 1 | 50 | 1 |
| 2 | Iron Sword | main_hand | STR +7 | 5 | 150 | 2 |
| 3 | Steel Blade | main_hand | STR +12, AGI +3 | 15 | 400 | 3 |
| 4 | Oak Staff | main_hand | INT +5 | 1 | 60 | 1 |
| 5 | Mystic Staff | main_hand | INT +10, MP +20 | 10 | 300 | 2 |
| 6 | Combat Gloves | main_hand | STR +4, AGI +3 | 1 | 45 | 1 |
| 16 | Bronze Axe | main_hand | STR +5 | 3 | 90 | 1 |
| 17 | Iron Axe | main_hand | STR +9, VIT +2 | 8 | 220 | 2 |
| 18 | Apprentice Wand | main_hand | INT +3, MP +10 | 1 | 40 | 1 |
| 19 | Steel Fist | main_hand | STR +7, AGI +5 | 10 | 180 | 2 |
| 20 | Throwing Knives | main_hand | AGI +6, LUK +3 | 5 | 120 | 2 |

**Guild Starter Weapons (templateId 33, 36, 39, 42):**

| ID | Name | Guild | Stats | Price |
|----|------|-------|-------|-------|
| 33 | Trainee Sword | Warrior | STR +1 | 2 |
| 36 | Novice Wand | Wizard | INT +1 | 2 |
| 39 | Initiate Wraps | Monk | AGI +1 | 2 |
| 42 | Mixing Rod | Chemist | INT +1 | 2 |

**Armor (templateId 7-9, 21-25, 34, 37, 40, 43):**

| ID | Name | Slot | Stats | Level | Price | Rarity |
|----|------|------|-------|-------|-------|--------|
| 7 | Leather Armor | body | VIT +3, HP +15 | 1 | 80 | 1 |
| 8 | Chain Mail | body | VIT +6, HP +30 | 8 | 250 | 2 |
| 9 | Cloth Robe | body | INT +3, MP +15 | 1 | 70 | 1 |
| 21 | Leather Helm | head | VIT +2 | 1 | 40 | 1 |
| 22 | Iron Helm | head | VIT +4, STR +1 | 8 | 120 | 2 |
| 23 | Leather Boots | feet | AGI +2 | 1 | 35 | 1 |
| 24 | Iron Greaves | feet | VIT +3, AGI +1 | 8 | 100 | 2 |
| 25 | Wizard Hat | head | INT +4, MP +10 | 5 | 90 | 2 |

**Guild Starter Armor (templateId 34, 37, 40, 43):**

| ID | Name | Guild | Slot | Stats | Price |
|----|------|-------|------|-------|-------|
| 34 | Trainee Tunic | Warrior | body | VIT +1 | 2 |
| 37 | Student Robe | Wizard | body | MP +5 | 2 |
| 40 | Initiate Gi | Monk | body | AGI +1 | 2 |
| 43 | Alchemist Coat | Chemist | body | HP +3, MP +3 | 2 |

**Accessories (templateId 10-11, 26-28, 35, 38, 41, 44):**

| ID | Name | Stats | Level | Price | Rarity |
|----|------|-------|-------|-------|--------|
| 10 | Lucky Charm | LUK +5 | 1 | 100 | 2 |
| 11 | Ring of Vitality | HP +25, VIT +3 | 5 | 200 | 2 |
| 26 | Iron Ring | STR +2, VIT +1 | 1 | 50 | 1 |
| 27 | Mage Ring | INT +4, MP +15 | 5 | 150 | 2 |
| 28 | Speed Amulet | AGI +5 | 3 | 130 | 2 |

**Guild Starter Accessories (templateId 35, 38, 41, 44):**

| ID | Name | Guild | Stats | Price |
|----|------|-------|-------|-------|
| 35 | Warrior's Pendant | Warrior | HP +5 | 2 |
| 38 | Mage's Crystal | Wizard | INT +1 | 2 |
| 41 | Monk's Beads | Monk | LUK +1 | 2 |
| 44 | Reagent Pouch | Chemist | LUK +1 | 2 |

**Consumables (templateId 12-15, 29-32):**

| ID | Name | Effect | Value | Price | Rarity |
|----|------|--------|-------|-------|--------|
| 12 | Health Potion | heal_hp | 50 | 25 | 1 |
| 13 | Mana Potion | heal_mp | 30 | 30 | 1 |
| 14 | Antidote | cure_poison | - | 15 | 1 |
| 15 | Phoenix Feather | revive | 50% | 500 | 4 |
| 29 | Hi-Potion | heal_hp | 150 | 100 | 2 |
| 30 | Hi-Ether | heal_mp | 80 | 120 | 2 |
| 31 | Elixir | heal_both | 100 | 300 | 3 |
| 32 | Status Cure | cure_all | - | 75 | 2 |

---

## 3. Drop Tables

### 3.1 Drop Table Overview

Drop tables define what items enemies can drop upon defeat. Each enemy has a drop table that specifies the number of items and rarity distribution.

### 3.2 Regular Enemy Drops

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

### 3.3 Boss Enemy Drops

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

### 3.4 Drop Table Schema

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

### 3.5 Difficulty Tier Modifiers

Higher difficulty tiers improve drop quality:

| Tier | Rarity Bonus | Item Level Bonus | Notes |
|------|--------------|------------------|-------|
| 1 | +0% | +0 | Starting areas |
| 2 | +5% rare+ | +5 | Mid-tier areas |
| 3 | +10% rare+ | +10 | High-tier areas |
| 4 | +15% rare+ | +15 | Boss areas |
| 5 | +20% rare+ | +20 | Elite/Palace |

**Rarity Bonus**: Shifts the rarity distribution toward higher rarities.

### 3.6 Drop Calculation Algorithm

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

### 3.7 Example Drop Tables

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

## 4. Relic System

### 4.1 Overview

Relics are rare collectible items that provide **permanent stat bonuses** to the owning player. Unlike equipment, relics are not worn or traded—they are collected and their bonuses apply automatically.

Key characteristics:
- **Permanent**: Bonuses persist across all characters
- **Non-tradeable**: Cannot be sold or traded
- **Unique**: Each relic can only be collected once
- **Cumulative**: Multiple relics stack their bonuses

### 4.2 Relic Templates

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

### 4.3 Acquisition Methods

| Method | Description |
|--------|-------------|
| **Ruins** | Complete sliding tile puzzles in ruin nodes |
| **Shrines** | Visit zodiac shrines throughout the world |
| **Guild Advancement** | Complete guild advancement quests |
| **Boss Drops** | Defeat specific boss enemies |
| **Discovery Nodes** | Find rare discovery nodes at world edges |

### 4.4 Permanent Bonuses

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

### 4.5 Collection UI

The `RelicCollectionModal.js` component displays:
- All collected relics with icons and descriptions
- Total cumulative bonuses from collection
- Zodiac crystal collection progress (12 crystals)
- Completion percentage toward full collection

Access via:
- World map menu -> "Relics" button
- Profile dropdown -> "Collection"

---

## 5. Planned Features (Not Yet Implemented)

> **Note:** The following sections describe planned game systems that are **not yet implemented** in the codebase. They are preserved here as design specifications for future development. The current implementation uses static item templates as documented in Section 2.

### 5.1 Material Progression System

**Status:** Not implemented. Current items have fixed stats without material variants.

Materials would determine base item stats and scale with character level requirements. Higher-tier materials would provide better base stats but require higher levels to equip.

#### Metal Material Tiers (Planned)

| Tier | Material | Stat Multiplier | Level Req | Properties |
|------|----------|-----------------|-----------|------------|
| 1 | Copper | 0.80x | 1 | Soft, easily worked |
| 2 | Iron | 1.00x | 1 | Baseline material |
| 3 | Bronze | 1.10x | 10 | Durable alloy |
| 4 | Steel | 1.25x | 20 | Hardened iron |
| 5 | Silver | 1.40x | 35 | Anti-undead (+10% vs undead) |
| 6 | Gold | 1.55x | 50 | Magic conductivity (+5% spell power) |
| 7 | Platinum | 1.70x | 70 | Noble metal, corrosion resistant |
| 8 | Mythril | 1.85x | 90 | Lightweight (-1 movement cost) |
| 9 | Obsidian | 2.00x | 120 | High crit (+5% crit chance) |
| 10 | Adamantine | 2.20x | 150 | Nearly indestructible |
| 11 | Dragonbone | 2.50x | 180 | Inherent fire resistance |
| 12 | Celestial | 3.00x | 210 | All elemental +5% |

#### Wood Material Tiers (Planned)

| Tier | Material | Stat Multiplier | Level Req |
|------|----------|-----------------|-----------|
| 1 | Pine | 0.80x | 1 |
| 2 | Oak | 1.00x | 1 |
| 3 | Ash | 1.15x | 15 |
| 4 | Yew | 1.30x | 30 |
| 5 | Ebony | 1.50x | 50 |
| 6 | Ironwood | 1.70x | 75 |
| 7 | Spiritwood | 1.90x | 100 |
| 8 | Eldertree | 2.10x | 130 |
| 9 | Worldtree | 2.40x | 165 |
| 10 | Celestial Oak | 2.80x | 200 |

#### Cloth/Leather Material Tiers (Planned)

| Tier | Material | Stat Multiplier | Level Req |
|------|----------|-----------------|-----------|
| 1 | Linen | 0.80x | 1 |
| 2 | Cotton | 1.00x | 1 |
| 3 | Wool | 1.15x | 15 |
| 4 | Leather | 1.30x | 25 |
| 5 | Silk | 1.50x | 45 |
| 6 | Shadowweave | 1.70x | 65 |
| 7 | Dragonhide | 1.90x | 90 |
| 8 | Mageweave | 2.10x | 120 |
| 9 | Ethereal Silk | 2.40x | 155 |
| 10 | Starcloth | 2.80x | 190 |

### 5.2 Augmentation System

**Status:** Not implemented. Current items have fixed properties without augments.

Augmentations would add special effects to items through prefixes and suffixes. Items would gain augmentation slots based on rarity, with effects scaling by intensity tier.

#### Augmentation Overview (Planned)

| Rarity | Augment Slots | Max Intensity |
|--------|---------------|---------------|
| Common | 0 | - |
| Uncommon | 0-1 | Minor |
| Rare | 1 | Standard |
| Epic | 1-2 | Greater |
| Legendary | 2 | Supreme |

#### Elemental Augments (Planned)

Eight elements are planned: Fire, Ice, Lightning, Poison, Holy, Dark, Earth, Wind

Example - Fire Augments:

| Intensity | Prefix | Suffix | Weapon Effect |
|-----------|--------|--------|---------------|
| Minor | Warm | of Sparks | +3% fire damage |
| Lesser | Heated | of Flames | +6% fire damage, 1% burn |
| Standard | Blazing | of Burning | +10% fire damage, 2% burn |
| Greater | Scorching | of Inferno | +15% fire damage, 3% burn |
| Supreme | Volcanic | of Cinders | +25% fire damage, 5% burn |

#### Enemy-Type Augments (Planned)

Prefixes providing bonuses against specific enemy types:
- Dragonbane/Wyrmslayer (vs Dragons)
- Undeadbane/Soulreaper (vs Undead)
- Demonslayer/Hellbreaker (vs Demons)
- Beastmaster/Apex Hunter (vs Beasts)
- Giantslayer/Titanfall (vs Giants)

#### Support Augments (Planned)

- Health/Mana regeneration
- Lifesteal/Drain effects
- Experience/Gold bonuses

#### Combat Augments (Planned)

- Critical hit bonuses
- Attack speed/Initiative
- Evasion/Movement
- Armor penetration

### 5.3 Procedural Item Generation

**Status:** Not implemented. Current items are static templates with fixed stats.

The planned system would generate item instances from templates with:
- Seeded random stat rolls within defined ranges
- Rarity-based stat multipliers
- Material selection based on level
- Augmentation rolls based on rarity
- Dynamic naming based on components

#### Planned Generation Algorithm

1. Initialize with seed for deterministic generation
2. Roll rarity (70% Common, 20% Uncommon, 8% Rare, 1.8% Epic, 0.2% Legendary)
3. Select material based on level and rarity
4. Calculate base stats with material multiplier
5. Roll bonus stats based on rarity slots
6. Roll augmentations based on rarity
7. Generate dynamic name from components
8. Calculate price from all factors

#### Planned Template Schema

```json
{
  "templateId": "string",
  "name": "string",
  "itemType": "weapon|armor|accessory",
  "equipmentSlot": "main_hand|body|head|feet|accessory",
  "materialType": "metal|wood|cloth",
  "baseStats": { "statName": "baseValue" },
  "statRanges": { "statName": { "min": 0, "max": 0 } },
  "possibleBonusStats": ["statName"],
  "maxBonusStats": 4,
  "levelRequirement": 1,
  "classRequirement": ["class_id"] | null,
  "basePrice": 100
}
```

### 5.4 Advanced Weapon/Armor Types

**Status:** Partially documented, not fully implemented. Current items use simplified types.

#### Planned Weapon Variety

The full weapon system would include:
- **Swords:** Shortsword, Longsword, Greatsword, Rapier, Katana, Scimitar, Claymore, Falchion
- **Axes:** Hatchet, Hand Axe, Battle Axe, Greataxe, Double Axe, War Axe
- **Maces:** Club, Mace, Morningstar, Flail, Warhammer, Maul
- **Polearms:** Spear, Pike, Halberd, Glaive, Lance, Trident
- **Staves:** Quarterstaff, Magic Staff, Battle Staff, Arcane Rod, Grand Staff, Elder Staff
- **Fist Weapons:** Hand Wraps, Knuckles, Claws, Cestus, Tiger Claws, Katar, Tekko
- **Daggers:** Knife, Dagger, Stiletto, Kris, Dirk, Parrying Dagger, Throwing Knife
- **Ranged:** Hand Crossbow, Light Crossbow, Heavy Crossbow, Repeater, Arbalest

#### Planned Off-Hand Equipment

Currently not implemented:
- Shields (Buckler, Round Shield, Kite Shield, Tower Shield, Pavise)
- Orbs and Tomes for casters
- Dual-wield options

#### Planned Armor Variety

- Heavy Armor with movement penalties
- Medium Armor with balanced stats
- Light Armor with MP bonuses
- Class-specific restrictions

### 5.5 Item Naming System

**Status:** Not implemented. Current items use static names.

The planned naming system would dynamically generate names:

```
[Quality Prefix] [Augment Prefix] [Material] [Item Type] [Augment Suffix]
```

Examples:
- "Fine Steel Longsword" (Uncommon, no augments)
- "Masterwork Blazing Mythril Greatsword" (Rare, fire augment)
- "Divine Wyrmslayer Celestial Greatsword of Cinders" (Legendary, dual augments)

#### Quality Prefixes by Rarity (Planned)

| Rarity | Prefixes |
|--------|----------|
| Common | (none) |
| Uncommon | Fine, Sturdy, Sharp, Polished |
| Rare | Superior, Masterwork, Enchanted, Pristine |
| Epic | Exalted, Ancient, Mythical |
| Legendary | Divine, Primordial, Godforged, Celestial |

#### Stat-Based Suffixes (Planned)

| Stat | Suffix |
|------|--------|
| STR | of Might |
| INT | of Wisdom |
| AGI | of Swiftness |
| VIT | of Fortitude |
| LUK | of Fortune |

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
| 3.0 | 2026-01-22 | Added Relic System (templates, acquisition, bonuses, UI) |
| 4.0 | 2026-01-25 | Major restructure: Documented current implementation (Section 2), moved unimplemented material/augmentation/generation systems to "Planned Features" (Section 5), updated to match actual `items.js` template structure |
