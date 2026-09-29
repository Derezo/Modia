# Item System

| Document | Version | Last Updated |
|----------|---------|--------------|
| Item System Specification | 5.0 | 2026-09-29 |

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
   - 4.3 Acquisition Conditions
   - 4.4 Collection UI
5. [Procedural Item Generation (Implemented)](#5-procedural-item-generation-implemented)
   - 5.1 Generation Steps
   - 5.2 Material Tiers
   - 5.3 Rarity Rolls
   - 5.4 Augments
   - 5.5 Naming
   - 5.6 Value
6. [Planned Features (Not Yet Implemented)](#6-planned-features-not-yet-implemented)

---

## 1. Overview

Items in Modia start from templates (`api/src/db/templates/items.js`). Items bought from NPC shops are the plain template. Enemy drops are generated from a template with a rolled rarity, material, stats and augments (Section 5).

### Core Concepts (Current)

- **Template**: Base item definition (see `api/src/db/templates/items.js`)
- **Rolled item**: A generated instance whose stats, augments and name live in `character_items.modifications`
- **Rarity**: Integer value (1-5) affecting stats, augment slots and item value
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
  base_price: 150,              // Gold cost (NPC sell value: see ECONOMY_SYSTEM.md)
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

**Note:** No item template has rarity 5. Legendary (5) exists only on generated items when the generator is asked for it (`forcedRarity` or an enemy's `rarityWeights`); see Section 5.3.

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

Relics are account-wide unlocks. Each one is claimed once per user (`user_relics`) and turns on a feature or an economy modifier for every character on the account. They are not equipment and cannot be traded or sold.

Source of truth: `relic_templates` (seeded by `api/src/migrations/033_relic_system.sql`, acquisition rules set by migrations 062 and 064) and `api/src/services/relicService.js`.

### 4.2 Relic Templates

| Key | Relic | Rarity | Acquisition type | Effect (`effects` JSON) | Where the effect applies |
|-----|-------|--------|------------------|-------------------------|--------------------------|
| `wayfarers_compass` | Wayfarer's Compass | rare | quest | `unlock: fast_travel` | `GET /api/world/fast-travel/destinations` and `POST /api/world/fast-travel` to a region castle. Cost is 100g + 50g per region of distance (`routes/world/progression.js`). |
| `vitality_charm` | Vitality Charm | rare | quest | `unlock: stamina_restore`, `cost_per_point: 100` | `POST /api/world/stamina/restore` at a castle, city, village, keep or palace node, 100g per stamina point. |
| `merchants_seal` | Merchant's Seal | epic | achievement | `unlock: reduced_marketplace_fee`, `fee_rate: 0.03` | Seller fee on marketplace fills drops from 5% to 3% (`getMarketplaceFeeRate`). See [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md). |
| `cartographers_eye` | Cartographer's Eye | uncommon | node | `unlock: extended_watchtower`, `reveal_bonus: 2` | Claimable, but no server or client code reads `reveal_bonus` yet, so owning it has no gameplay effect today. |

### 4.3 Acquisition Conditions

Claims are validated server-side by `checkRelicEligibility()` in `relicService.js`. The conditions are class-agnostic and do not depend on world-generation IDs:

| Relic | Condition to claim |
|-------|--------------------|
| Wayfarer's Compass | Any character on the account has completed a guild advancement quest of tier <= 1 (`acquisition_id = 1` is the required tier). |
| Vitality Charm | Same as the Compass: any completed tier-1 advancement quest. |
| Cartographer's Eye | The user has travelled to (not merely revealed) any `watchtower` node. |
| Merchant's Seal | The user has at least one completed marketplace sale (`market_trades.seller_id`). |

A relic with no usable condition (no special case and a NULL `acquisition_id`) is reported as "not yet obtainable" and cannot be claimed. `shop`-type relics are never claimable through the claim endpoint. There is no longer an unconditional claim path; `POST /api/relics/grant/:key` only works when `NODE_ENV` is `development` or `test`.

`GET /api/relics` returns, for each unowned relic, `claimable` (boolean) and `requirement` (the unmet condition, or `null`). `POST /api/relics/:id/claim` re-runs the same check. See [API_SPECIFICATION.md](API_SPECIFICATION.md#relics).

### 4.4 Collection UI

`frontend/src/modals/RelicCollectionModal.js` lists every relic with its owned state, shows the requirement for locked relics, and offers a Claim button when `claimable` is true. It also shows zodiac crystal collection progress.

---

## 5. Procedural Item Generation (Implemented)

Enemy drops and seeded starter items are generated from templates by `generateItem()` in `api/src/services/itemDropService.js`. Callers are `rollDrops()` (battle rewards) and `api/src/db/seed.js`. Items bought from NPC shops are plain templates without rolled data.

The rolled result is stored in `character_items.modifications`:

```json
{
  "generationSeed": 12345,
  "material": "mythril",
  "rarity": 4,
  "baseStats": { "vitality": 14 },
  "bonusStats": { "luck": 5, "vitality": 7 },
  "augments": [{ "key": "venomous", "type": "prefix", "name": "Venomous", "category": "poison", "stat": "luck", "value": 5, "effect": { "type": "poison_chance", "value": 0.05 } }],
  "generatedName": "Exalted Venomous Mythril Greaves of the Guardian",
  "spriteId": "..."
}
```

### 5.1 Generation Steps

1. Seed a `SeededRandom` with the generation seed.
2. Rarity: forced by the caller, otherwise the template's rarity. Drops roll rarity from the enemy's `drop_table.rarityWeights`.
3. Material: picked from the tier for the target level (table 5.2).
4. Base stats: each template stat is multiplied by a rarity roll (table 5.3) and by `(1 + level * 0.02)`, then floored. Stored as `baseStats`.
5. Augment slots: rolled from the rarity's slot range. Equipment slot 0 prefers a prefix (70%), later slots prefer a suffix (70%). An augment category can appear only once per item.
6. Each equipment augment rolls a flat stat bonus in its range; these are summed into `bonusStats`.
7. Name and value are derived (5.5, 5.6). Level requirement is `max(template requirement, floor(level * 0.8))`.

### 5.2 Material Tiers

| Level | Materials | Quality label |
|-------|-----------|---------------|
| 1-9 | copper, iron | Common |
| 10-19 | bronze, steel | Fine |
| 20-34 | silver, gold | Superior |
| 35-69 | platinum, electrum | Exceptional |
| 70-89 | mythril, adamantine | Masterwork |
| 90+ | celestial, void | Legendary |

The material only affects the name. It has no separate stat multiplier.

### 5.3 Rarity Rolls

| Rarity | Stat multiplier | Augment slots | Value multiplier |
|--------|-----------------|---------------|------------------|
| Common (1) | 0.80-1.00 | 0 | 1x |
| Uncommon (2) | 0.90-1.10 | 0-1 | 1.5x |
| Rare (3) | 1.00-1.20 | 1-2 | 2.5x |
| Epic (4) | 1.10-1.30 | 2-3 | 5x |
| Legendary (5) | 1.20-1.50 | 3-4 | 10x |

### 5.4 Augments

**Equipment prefixes:** Blazing, Frozen, Shocking, Venomous, Blessed, Shadowed (elemental); Keen (`crit_chance` +5%), Swift, Deadly, Mighty (combat); Sturdy, Warded, Reinforced (defensive); Dragonbane, Undeadbane, Demonslayer (enemy type).

**Equipment suffixes:** of Flames, of Frost, of Thunder, of Venom, of Light, of Darkness (`lifesteal` 3%); of Might, of Wisdom, of Swiftness, of Fortitude, of Fortune (stat); of Vitality, of Sorcery, of Mending, of the Sage (support); of Precision (`crit_damage` +15%), of Lethality (`crit_damage` +25%); of the Bulwark, of Warding, of the Guardian (defensive).

**Consumable augments:** Potent, Concentrated, Empowered, Arcane, Purifying, Sanctified, Absolute, Blessed, Divine (prefixes); of Mending, of Restoration, of Regeneration, of Sorcery, of Channeling, of Fortitude, of Might, of Insight, of Alacrity, of Grace, of Swiftness, of Sharing (suffixes).

What actually applies in combat on this branch:

| Part of the augment | Applied? |
|---------------------|----------|
| Rolled `baseStats` and every augment's flat `bonusStats` | Yes. `api/src/services/equipmentStats.js` sums `modifications.baseStats` (falling back to the template `stat_bonuses`), `modifications.bonusStats` and legacy top-level keys, and maps `hp_max`/`mp_max` to `hp`/`mp`. PvE battles, coliseum, guildmaster battles and the character sheet all use it, so combat matches the inventory UI. |
| `crit_chance`, `crit_damage` effects | Yes, in `damageCalculator.js` for attacks and skills. |
| `lifesteal` effect | Yes, on basic attacks (`actionProcessor.js`). |
| Other equipment effects (elemental damage, proc chances, `damage_vs`, regen, block, resist, `damage_reduction`, `heal_on_hit`, ...) | No. They are stored, shown in the UI and priced, but no battle code reads them. |
| Consumable augment effects | No. Consumables use their template effect only. |

### 5.5 Naming

Equipment: `[Quality] [Prefix augment] [Material] [Base name] [Suffix augment]`. Consumables: `[Quality] [Prefix augment] [Base name] [Suffix augment]`.

- Quality by rarity: equipment none / Fine / Superior / Exalted / Divine; consumables none / Fine / Superior / Exceptional / Supreme.
- A material word already in the template name (Iron, Rusty, Steel, ...) is replaced by the rolled material. Soft bases (leather, cloth, robes, staves, wands, charms, amulets and similar) keep their own name with no material.
- "of X" appears only when a suffix augment rolled. There is no stat-based fallback suffix.

Example: `Exalted Venomous Mythril Greaves of the Guardian`.

### 5.6 Value

Generation value: `floor(base_price * rarityMultiplier * (1 + level * 0.05))` with the multipliers in 5.3.

Marketplace suggested price and NPC buy-back use `calculateSuggestedPrice()` (`services/marketplace/itemListings.js`): `floor(base_price * rarityMultiplier * (1 + 0.15 * sum(augment category values)))`. NPC sell pricing is described in [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md#npc-sell-pricing).

---

## 6. Planned Features (Not Yet Implemented)

- **Weapon and armor variety:** swords, axes, maces, polearms, daggers, crossbows; shields, orbs and tomes in an off-hand slot; heavy/medium/light armor classes with movement or MP trade-offs. Current templates use the five slots in 2.2.
- **Remaining augment effects:** the equipment and consumable augment effects marked "No" in 5.4.
- **Cartographer's Eye reveal bonus:** the `reveal_bonus` effect is defined but not read by the watchtower reveal.

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
| 5.0 | 2026-09-29 | Procedural generation, materials, augments and naming documented as implemented (Section 5), with which augment effects apply in combat. Relic section replaced with the four real templates and their claim conditions. |
