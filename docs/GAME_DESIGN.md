# Modia - Game Design Document

## Document Information

| Field | Value |
|-------|-------|
| Project Name | Modia |
| Version | 2.0 |
| Last Updated | January 2026 |
| Genre | Tactical RPG / MMORPG |

---

## 1. Game Overview

### 1.1 Concept Statement

Modia is a browser-based tactical RPG where players build a party of up to 12 characters, explore a procedurally generated world, and engage in chess-style turn-based combat. The game combines single-player progression with real-time multiplayer features including PvP battles, trading, and social interaction.

### 1.2 Core Pillars

1. **Tactical Depth** - Chess-style combat with positioning, classes, and abilities
2. **Character Progression** - Build and level a diverse party of characters
3. **Exploration** - Discover a shared procedural world from a central hub
4. **Social Interaction** - Trade, chat, compete on leaderboards, PvP in Coliseum

### 1.3 Target Experience

Players should feel:
- **Strategic** when positioning units in battle
- **Accomplished** when leveling characters and discovering new areas
- **Connected** when interacting with other players
- **Invested** in their party of characters

---

## 2. Character System

### 2.1 Races

Each race provides unique base statistics and a racial trait.

#### Human
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 100 | | VIT | 10 |
| MP | 50 | | LUK | 10 |
| STR | 10 | | | |
| INT | 10 | | **Trait** | +10 MDEF, +10 MATK, -10% Max MP |
| AGI | 10 | | | |

**Lore**: Versatile and adaptable, humans possess balanced magical aptitude at the cost of smaller mana reserves.

#### Elf
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 80 | | VIT | 6 |
| MP | 80 | | LUK | 10 |
| STR | 8 | | | |
| INT | 14 | | **Trait** | +5% MP Regen per turn |
| AGI | 12 | | | |

**Lore**: Ancient and wise, elves possess natural magical affinity and can regenerate mana during battle.

#### Dwarf
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 120 | | VIT | 16 |
| MP | 30 | | LUK | 8 |
| STR | 14 | | | |
| INT | 6 | | **Trait** | +15% Two-Handed Weapon Damage |
| AGI | 6 | | | |

**Lore**: Stout and resilient, dwarves are master craftsmen who excel with heavy two-handed weapons.

#### Vampire
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 90 | | VIT | 8 |
| MP | 60 | | LUK | 4 |
| STR | 12 | | | |
| INT | 12 | | **Trait** | 10% Lifesteal (no overkill) |
| AGI | 14 | | | |

**Lore**: Cursed immortals who sustain themselves by draining life from their foes. Heals for 10% of damage dealt, but cannot heal from overkill damage.

#### Orc
| Stat | Value | | Stat | Value |
|------|-------|--|------|-------|
| HP | 130 | | VIT | 14 |
| MP | 20 | | LUK | 8 |
| STR | 16 | | | |
| INT | 4 | | **Trait** | +25% Crit Damage (additive) |
| AGI | 8 | | | |

**Lore**: Brutal warriors who live for battle, orcs devastate foes with savage strikes. Critical hits deal 175% damage instead of 150%.

### 2.2 Classes

Each class determines stat growth per level, combat role, and available skills. All classes have base movement of 3 tiles, with bonuses available from equipment and passive abilities.

> **Note**: All skills must be unlocked by spending XP. Characters begin with access to Tier 1 skills in their base guild. See [SKILL_TREES.md](SKILL_TREES.md) for complete skill definitions.

#### Warrior
| Growth/Level | Value |
|--------------|-------|
| HP | +15 |
| MP | +3 |
| STR | +3 |
| INT | +1 |
| AGI | +1 |
| VIT | +2 |

| Attribute | Value |
|-----------|-------|
| Role | Tank / Melee DPS |
| Attack Range | 1 tile (melee) |

**Playstyle**: Warriors charge into the front lines, absorbing damage and dealing heavy physical attacks. Best paired with support characters.

**Skill Branches**: Offense, Defense, Utility (see [SKILL_TREES.md](SKILL_TREES.md))

#### Wizard
| Growth/Level | Value |
|--------------|-------|
| HP | +8 |
| MP | +12 |
| STR | +1 |
| INT | +4 |
| AGI | +1 |
| VIT | +1 |

| Attribute | Value |
|-----------|-------|
| Role | Ranged Magic DPS |
| Attack Range | 4 tiles |

**Playstyle**: Wizards stay in the back, unleashing powerful spells from a distance. Vulnerable if enemies get close.

**Skill Branches**: Fire Magic, Ice Magic, Lightning Magic (see [SKILL_TREES.md](SKILL_TREES.md))

#### Monk
| Growth/Level | Value |
|--------------|-------|
| HP | +10 |
| MP | +6 |
| STR | +2 |
| INT | +2 |
| AGI | +3 |
| VIT | +1 |

| Attribute | Value |
|-----------|-------|
| Role | Mobile Melee DPS |
| Attack Range | 1-2 tiles |

**Playstyle**: Monks are highly mobile strikers who can reach vulnerable targets quickly. Balance of physical and ki-based attacks.

**Skill Branches**: Martial Arts, Ki Mastery, Body Techniques (see [SKILL_TREES.md](SKILL_TREES.md))

#### Chemist
| Growth/Level | Value |
|--------------|-------|
| HP | +10 |
| MP | +8 |
| STR | +1 |
| INT | +2 |
| AGI | +2 |
| VIT | +2 |

| Attribute | Value |
|-----------|-------|
| Role | Support / Healer |
| Attack Range | 3 tiles (thrown) |

**Playstyle**: Chemists support the party with healing, buffs, and debuffs. Can also deal damage with thrown concoctions.

**Skill Branches**: Potion Craft, Acid Craft, Bomb Craft (see [SKILL_TREES.md](SKILL_TREES.md))

### 2.3 Stat Calculations

#### Derived Stats

| Stat | Formula |
|------|---------|
| Physical Attack | STR + (weapon bonus) |
| Magic Attack | INT + (weapon bonus) |
| Physical Defense | VIT × 0.5 |
| Magic Defense | INT × 0.25 |
| Critical Chance | LUK / 200 (max 50%) |
| Critical Damage | 150% (+ racial bonuses) |
| Evasion | AGI / 200 (max 25%) |
| Initiative | AGI + random(0-9) |

#### HP/MP at Level N

```
HP = base_HP + (class_HP_growth × (level - 1))
MP = base_MP + (class_MP_growth × (level - 1))
```

#### Example: Level 50 Human Warrior

| Stat | Calculation | Value |
|------|-------------|-------|
| HP | 100 + (15 × 49) | 835 |
| MP | 50 + (3 × 49) | 197 |
| STR | 10 + (3 × 49) | 157 |
| INT | 10 + (1 × 49) | 59 |
| AGI | 10 + (1 × 49) | 59 |
| VIT | 10 + (2 × 49) | 108 |
| LUK | 10 | 10 |

### 2.4 Experience and Leveling

#### XP Pool System

Characters earn XP from battles which is added to their **XP Pool**. This XP is then **spent** to learn and level up skills. As XP is spent, the character's level increases.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Battle    │────▶│   XP Pool   │────▶│   Skills    │
│   Victory   │     │  (Unspent)  │     │  (Learned)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Level Up  │
                    │ (Based on   │
                    │  XP Spent)  │
                    └─────────────┘
```

#### Level Formula

Character level is determined by total XP spent:
```
XP Required for Level N = 100 × N^2.2
```

#### Level Thresholds

| Level | Total XP Spent | XP to Next Level |
|-------|----------------|------------------|
| 1 | 0 | 459 |
| 5 | 3,400 | 1,100 |
| 10 | 15,800 | 2,800 |
| 25 | 158,000 | 9,500 |
| 50 | 794,000 | 25,000 |
| 100 | 3,981,000 | 65,000 |
| 150 | 10,900,000 | 115,000 |
| 200 | 22,000,000 | 175,000 |
| 256 | ~39,000,000 | MAX |

#### Level Up Effects

When a character's total XP spent crosses a level threshold:
1. All stats increase based on class growth rates
2. New skill tiers may become available in the skill tree
3. Higher-level skills can be unlocked

> **Note**: HP and MP are fully restored at the start of each battle, not on level up. See Section 4.8 for regeneration rules.

### 2.5 Party System

- Maximum **12 characters** per account
- **Battle Party**: Up to 5 characters for combat
- **Formation Screen**: Manage all 12 characters, select battle party
- Characters not in battle still exist at current node
- All party members travel together

#### Battle Deployment

When battle begins:
1. Player selects up to 5 characters from formation
2. Battle map generated (8x8 grid)
3. Player places characters freely within 5x5 deployment zone (one corner)
4. PvP: Each player gets opposite corners
5. All characters start at 100% HP/MP, no status effects

---

## 3. World Design

### 3.1 World Structure

The world is a **node-based graph** procedurally generated from a global seed. All players share the same world layout.

```
                        [Palace]
                           │
            [Mountain]─────┼─────[Cave]
                │          │          │
    [Village]───┼───[City]─┼─[Forest]─┼───[Guild]
                │          │          │
            [Bridge]───────┼─────[Village]
                           │
                      [CASTLE]  ← Starting Point
                           │
            [Forest]───────┼─────[City]
                │          │          │
            [Cave]────[Village]───[Mountain]
                           │
                       [Guild]
```

### 3.2 Node Types

#### Castle (Central Hub)
- **Spawn Point**: All new characters start here
- **Features**: Coliseum, Tavern, Courtyard, Throne, Blacksmith, Apothecary, Temple, Stables, Marketplace
- **Count**: Exactly 1 (at origin)

#### City
- **Features**: Tavern + 2 random from (Blacksmith, Apothecary, Temple, Stables)
- **Distribution**: Multiple throughout world
- **Difficulty**: Varies by distance from center

#### Village
- **Features**: Farm + optional Apothecary (50% chance)
- **Distribution**: Common, especially in inner rings
- **Difficulty**: Low

#### Forest (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Goblins, Wolves, Slimes
- **Difficulty**: Low to Medium

#### Cave (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Bats, Golems, Skeletons
- **Difficulty**: Medium

#### Mountain (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Trolls, Rock creatures
- **Difficulty**: Medium to High

#### Bridge (Battle Node)
- **Features**: Battle encounters
- **Enemies**: Bandits, mixed types
- **Difficulty**: Variable

#### Guild
- **Features**: Class-specific training, recruitment, quests (future)
- **Types**: Warriors' Guild, Wizards' Guild, Monks' Guild, Chemists' Guild
- **Count**: 4 total (one per class)
- **Distance**: 5-8 nodes from center
- **Recruitment**: Recruit permanent party members with randomized stats, traits, and skills (see [GUILD_RECRUITMENT_SYSTEM.md](GUILD_RECRUITMENT_SYSTEM.md))

#### Palace
- **Features**: End-game content (TBD)
- **Count**: Exactly 1
- **Distance**: Minimum 13 nodes from center
- **Special**: Rare encounters, unique rewards

### 3.3 Node Features

#### Coliseum (Castle only)
- PvP matchmaking
- Queue for battles against other players
- Leaderboard display

#### Tavern (Castle, City)
- Real-time chat room
- View other players at this node
- Rumors and hints (future)

#### Blacksmith (Castle, City)
- Buy weapons and armor
- Sell equipment
- Repair items (future)

#### Apothecary (Castle, City, Village)
- Buy consumables (potions, antidotes)
- Sell materials
- Craft items (future)

#### Temple (Castle, City)
- Remove curses/debuffs (future)
- Blessings and buffs (future)
- Lore and quest information (future)

#### Stables (Castle, City)
- Fast travel to discovered nodes (future)
- Mount rental (future)

#### Marketplace (Castle only)
- Player-to-player trading
- List items for sale
- Browse and purchase listings

#### Farm (Village)
- Buy food items (restore HP outside battle)
- Harvest minigame (future)

### 3.4 World Generation Rules

1. **Central Castle**: Always at coordinates (0, 0)
2. **Ring Distribution**:
   - Ring 1 (distance 3-4): Cities, Villages, Forests
   - Ring 2 (distance 5-7): Cities, Villages, Forests, Caves
   - Ring 3 (distance 8-11): Villages, Forests, Caves, Mountains, Bridges
   - Ring 4+ (distance 12+): Forests, Caves, Mountains, Bridges
3. **Guild Placement**: 4 guilds at distance 5-8, one per class
4. **Palace Placement**: Exactly 1, minimum distance 13
5. **Connectivity**: All nodes connected (no isolated nodes)
6. **Node Names**: Procedurally generated from prefix/suffix lists

---

## 4. Combat System

### 4.1 Battle Overview

Combat is **turn-based tactical** on an **8×8 isometric grid**. Each unit acts once per turn in initiative order.

Combat supports multiple modes including PvE Solo (current), PvE Co-op, PvP Duel, PvP Team, and Free-for-All. See [BATTLE_MODES.md](BATTLE_MODES.md) for detailed mode configurations.

```
  0   1   2   3   4   5   6   7
0 [E] [E] [ ] [ ] [ ] [ ] [ ] [ ]
1 [E] [ ] [ ] [ ] [ ] [ ] [ ] [ ]
2 [ ] [ ] [~] [ ] [ ] [ ] [ ] [ ]
3 [ ] [ ] [ ] [#] [ ] [ ] [ ] [ ]
4 [ ] [ ] [ ] [ ] [#] [ ] [ ] [ ]
5 [ ] [ ] [ ] [ ] [ ] [~] [ ] [ ]
6 [ ] [ ] [ ] [ ] [ ] [ ] [ ] [P]
7 [ ] [ ] [ ] [ ] [ ] [ ] [P] [P]

Legend:
[P] = Player units (spawn area)
[E] = Enemy units (spawn area)
[#] = Impassable terrain (rocks, trees)
[~] = Difficult terrain (water, lava)
[ ] = Normal terrain
```

### 4.2 Turn Flow

Turn order is determined by the Charge Time (CT) system. Each unit accumulates CT based on their AGI stat, and acts when CT reaches 100. See [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) for complete details.

**Two-Action System**: Each unit's turn allows up to TWO actions:
- **1 MOVE action** - Move to a new position
- **1 ACT action** - Attack, use skill, or use item

Actions can be performed in **either order** (move-then-act or act-then-move). **Wait** immediately ends the turn, forfeiting any remaining actions.

```
Battle Start
     │
     ▼
┌─────────────┐
│ Calculate   │ CT-based turn order (Charge Time)
│ Turn Order  │ Higher AGI = faster CT accumulation
└─────────────┘
     │
     ▼
┌─────────────┐
│ Turn Start  │◀────────────────────────────────┐
│ (Reset)     │ Reset moveUsed/actUsed flags     │
└─────────────┘                                  │
     │                                           │
     ▼                                           │
┌─────────────┐                                  │
│ Active Unit │ Highlight current unit           │
└─────────────┘                                  │
     │                                           │
     ▼                                           │
┌─────────────┐  ◀──────────────────────┐        │
│ Choose      │ Move / Attack / Skill / │        │
│ Action      │ Item / Wait             │        │
└─────────────┘                          │        │
     │                                   │        │
     ▼                                   │        │
┌─────────────┐                          │        │
│ Execute     │ Apply damage, effects,   │        │
│ Action      │ movement                 │        │
└─────────────┘                          │        │
     │                                   │        │
     ▼                                   │        │
┌─────────────┐  Yes (partial turn)      │        │
│ Turn        │──────────────────────────┘        │
│ Complete?   │  (moveUsed AND actUsed)           │
└─────────────┘  OR Wait pressed                  │
     │ Yes                                        │
     ▼                                            │
┌─────────────┐    No                             │
│ All enemies │─────────────────────────────────▶│
│ defeated?   │                                   │
└─────────────┘                                   │
     │ Yes                                        │
     ▼                                            │
┌─────────────┐    No                             │
│ All players │─────────────────────────────────▶│
│ defeated?   │                                   │
└─────────────┘                                   │
     │ Yes                                        │
     ▼                                            │
┌─────────────┐                                   │
│ Battle End  │ Victory / Defeat                  │
└─────────────┘                                   │
```

### 4.3 Actions

Each turn allows **1 MOVE + 1 ACT** in any order.

| Action Type | Category | Notes |
|-------------|----------|-------|
| Move | MOVE | One per turn, can be skipped |
| Attack | ACT | One per turn (mutually exclusive with Skill/Item) |
| Skill | ACT | One per turn (mutually exclusive with Attack/Item) |
| Item | ACT | One per turn (mutually exclusive with Attack/Skill) |
| Wait | END | Immediately ends turn, skips remaining actions |

#### Move
- Move to any tile within movement range
- Cannot move through occupied tiles
- Cannot move through impassable terrain
- Base movement: 3 tiles for all classes (bonuses from equipment/passives)
- Terrain costs: Normal (1), Forest/Water (2)
- **One move per turn** - grayed out after use

#### Attack (Basic)
- Deal physical damage to target in range
- Range varies by class/weapon
- Damage formula below
- **Uses ACT slot** - cannot use Skill/Item after attacking

#### Skill
- Use class-specific ability
- Costs MP (varies by skill)
- May have different ranges, areas of effect
- **Uses ACT slot** - cannot use Attack/Item after using skill

#### Item
- Use consumable item from inventory
- Healing, buffs, status cure
- Consumes the item
- **Uses ACT slot** - cannot use Attack/Skill after using item

#### Wait
- **Immediately ends turn**, forfeiting any unused move/act
- Useful to skip actions strategically

### 4.3.1 Status Effects and Actions

Some status effects restrict which actions are available:

| Status Effect | Blocks |
|---------------|--------|
| Stun | Move AND Act (auto-end turn) |
| Freeze | Move AND Act (auto-end turn) |
| Sleep | Move AND Act (auto-end turn) |
| Root | Move only (can still act) |
| Silence | Skills only (can move and basic attack) |

### 4.4 Damage Calculation

#### Physical Damage
```
base_damage = ATK × (skill_power / 100)
defense_reduction = DEF × 0.3
raw_damage = max(1, base_damage - defense_reduction)

crit_roll = random(0, 1)
is_crit = crit_roll < (LUK / 200)
crit_multiplier = is_crit ? 1.5 : 1.0

final_damage = floor(raw_damage × crit_multiplier)
```

#### Magical Damage
```
base_damage = MATK × (skill_power / 100)
defense_reduction = MDEF × 0.3
raw_damage = max(1, base_damage - defense_reduction)

# Crits work the same for magic
final_damage = floor(raw_damage × crit_multiplier)
```

#### Example Calculation

Level 10 Warrior (STR 40) uses Slash (110 power) vs Enemy (VIT 20)

```
ATK = 40
skill_power = 110
DEF = 20 × 0.5 = 10

base_damage = 40 × 1.10 = 44
defense_reduction = 10 × 0.3 = 3
raw_damage = 44 - 3 = 41

No crit: final_damage = 41
With crit: final_damage = 61
```

### 4.5 Status Effects

#### Stacking & Duration Rules
- Effects **DO NOT stack** (cannot have 2x Poison)
- Reapplying an effect **REFRESHES duration** to maximum
- Each effect has independent duration tracking

#### Application Chance
- **Weapon effects**: 100% application rate
- **Skill effects**: Defined per skill (often scales with skill level)
- **Resistance**: Some enemies/equipment provide status resistance %

#### Effect Definitions

| Effect | Duration | Damage/Effect | Notes |
|--------|----------|---------------|-------|
| Poison | 3 turns | 5% max HP/turn | Removed by heal |
| Burn | 2 turns | 3% max HP/turn | +50% damage to Frozen targets |
| Freeze | 2 turns | Cannot act | Removed by Fire damage |
| Stun | 1 turn | Skip turn | Cannot refresh while active |
| Slow | 3 turns | -2 movement, -20% AGI | Duration stacks only |
| Blind | 2 turns | -50% accuracy | |
| Silence | 2 turns | Cannot use MP skills | |
| Weakness | 3 turns | -30% damage dealt | |
| Vulnerability | Until hit | +25% damage taken | Consumed on damage |
| Defense Down | 3 turns | -25% defense | |
| Attack Up | 3 turns | +25% attack | |

#### Effect Interactions

| Effect | Enhanced By | Countered By |
|--------|-------------|--------------|
| Poison | Vulnerability | Heal/Cleanse |
| Burn | Freeze (bonus damage) | Water/Ice |
| Freeze | - | Fire/Burn |
| Stun | - | Cannot refresh |
| Slow | Freeze | Haste |

### 4.6 Terrain Types

| Terrain | Passable | Movement Cost | Effect |
|---------|----------|---------------|--------|
| Grass | Yes | 1 | None |
| Stone | Yes | 1 | None |
| Forest | Yes | 2 | +10% evasion |
| Water | Yes | 2 | -10% fire damage |
| Rock | No | - | Blocks movement/projectiles |
| Tree | No | - | Blocks movement |
| Lava | No | - | 10% HP damage if adjacent |
| Cliff | No | - | Blocks movement |

### 4.7 Battle Rewards

#### Victory Rewards

| Reward | Calculation |
|--------|-------------|
| Gold | base_gold × (1 + difficulty × 0.2) + random variance |
| Experience | base_exp × enemy_count × (1 + difficulty × 0.1) |
| Items | Random drops from enemy loot tables (1-3 per enemy) |

Experience is added to each participating character's **XP Pool**.

#### Defeat Consequences
- No rewards
- Party returned to last safe node (no permadeath)
- All characters restored to full HP/MP for next battle

#### In-Battle Revival
- Characters can only be revived during battle via skills or items
- If all party members fall, battle ends in defeat

### 4.8 Health & Mana Regeneration

#### Battle Start
- All characters begin each battle at **100% HP and 100% MP**
- All status effects are cleared at battle start
- Exception: Cursed equipment may apply negative effects at battle start

#### During Battle
- **HP regeneration**: None (healing skills/items only)
- **MP regeneration**: 0% per turn base
  - Elf racial trait: +5% max MP per turn
  - Equipment/passives may provide additional MP regeneration

#### After Battle
- All characters restored to full HP/MP automatically
- No between-battle healing mechanics needed

### 4.9 Battle Modes Overview

Modia supports multiple battle modes to accommodate different play styles:

| Mode | Players | Description |
|------|---------|-------------|
| PVE_SOLO | 1 | Single player vs AI enemies (current MVP) |
| PVE_COOP | 2-4 | Multiple players cooperating vs enemies |
| PVP_DUEL | 2 | 1v1 competitive PvP |
| PVP_TEAM | 4-8 | Team-based PvP (2v2, 3v3, 4v4) |
| PVP_FFA | 3-8 | Free-for-all, last player standing |

See [BATTLE_MODES.md](BATTLE_MODES.md) for complete configuration details.

#### Mode-Specific Rules

**Turn Timers:**
- PVE_SOLO: No time limit
- All other modes: 60 seconds per turn

**Reconnection:**
- PVE_SOLO: Battle pauses, unlimited reconnect
- PVE_COOP: 60 second grace period
- PVP modes: 30 second grace period

See [BATTLE_RECONNECTION.md](BATTLE_RECONNECTION.md) for reconnection handling details.

---

## 5. Economy

> **Detailed Documentation**: See [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) for complete NPC shop mechanics, dynamic pricing, and marketplace order book system.

### 5.1 Currency

**Gold** is the primary currency, used for:
- Buying items from NPC shops
- Trading via player marketplace
- Future: Fast travel, equipment repair

### 5.2 Gold Sources

| Source | Amount |
|--------|--------|
| Starting gold | 100 |
| PvE Battle (tier 1) | 30-60 |
| PvE Battle (tier 2) | 60-100 |
| PvE Battle (tier 3) | 100-150 |
| PvE Battle (tier 4) | 150-250 |
| PvP Victory | 50-100 |
| Selling to NPCs | item_base_price × 0.5 |

### 5.3 Gold Sinks

| Sink | Cost |
|------|------|
| NPC shop purchases | 60-120% of base (dynamic) |
| Basic equipment | 50-500 |
| Advanced equipment | 500-5000 |
| Consumables | 15-100 |
| Fast travel (future) | Variable by distance |
| Equipment repair (future) | 10-20% of item value |

### 5.4 Item Rarity

| Rarity | Drop Rate | Price Multiplier | Color |
|--------|-----------|------------------|-------|
| Common | 70% | 1× | White |
| Uncommon | 20% | 2× | Green |
| Rare | 8% | 5× | Blue |
| Epic | 1.8% | 15× | Purple |
| Legendary | 0.2% | 50× | Gold |

---

## 6. Multiplayer Features

### 6.1 Coliseum PvP

The Coliseum uses the PVP_DUEL mode for 1v1 battles. Team battles (PVP_TEAM) and Free-for-All (PVP_FFA) will be added in future updates. See [BATTLE_MODES.md](BATTLE_MODES.md) for mode configurations.

#### Matchmaking
- Queue with battle party (1-5 characters)
- Match based on average party level (±10 levels)
- 2 minute queue timeout

#### Battle Rules
- Same rules as PvE combat
- 60 second turn timer (auto-skip on timeout)
- Surrender option available
- No item use (balanced competitive play)

#### Rewards
| Result | Gold | Experience |
|--------|------|------------|
| Victory | 100 | 500 × avg_level |
| Defeat | 0 | 100 × avg_level |
| Surrender | 0 | 0 |

### 6.2 Marketplace

> **Full Documentation**: See [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) for complete marketplace mechanics including order books, limit orders, and market orders.

The marketplace is an open exchange system at Castle nodes where players trade directly.

#### Order Types
- **Limit Orders**: Specify price, stay open until filled/cancelled
- **Market Orders**: Execute immediately at best available prices

#### Key Features
- Order book system (buy/sell orders)
- Partial fills supported
- No transaction fees
- Gold reservation for buy orders
- Item escrow for sell orders

#### Trading Rules
- Cannot list Key Items
- Maximum 10 open orders per player (buy + sell combined)
- Items must be in inventory to sell
- Gold must be available for buy orders

### 6.3 Tavern Chat

- Real-time chat in Tavern nodes
- Messages show character name
- 160 character limit per message
- 100 message scroll-back in client (unlimited server history)
- No private messaging (MVP)

### 6.4 Leaderboards

| Category | Ranking Criteria |
|----------|------------------|
| Level | Highest character level |
| PvP Wins | Total Coliseum victories |
| Gold | Current gold balance |

---

## 7. Progression Loop

### 7.1 Core Loop

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│  │ Explore │───▶│ Battle  │───▶│ Rewards │───▶│ Upgrade │ │
│  │ World   │    │ Enemies │    │ Gold/XP │    │ Party   │ │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘ │
│       ▲                                            │       │
│       │                                            │       │
│       └────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Session Goals

**Short Session (15-30 min)**:
- Complete 2-3 battles
- Level up a character
- Discover 1-2 new nodes

**Medium Session (1-2 hours)**:
- Clear a dungeon area
- Upgrade equipment
- Try PvP battles

**Long Session (2+ hours)**:
- Reach new world tier
- Level multiple characters
- Engage in trading/economy

### 7.3 Long-term Goals

1. **Max Level Character** (Level 256)
2. **Complete Party** (12 characters)
3. **All Classes Mastered** (One of each at high level)
4. **World Exploration** (Discover Palace, all Guilds)
5. **PvP Ranking** (Top 100 leaderboard)
6. **Wealth Accumulation** (Gold milestones)

---

## 8. Future Features (Post-MVP)

### 8.1 Planned Additions

| Feature | Description | Priority |
|---------|-------------|----------|
| Advanced Classes | Class upgrades at level 50 | High |
| Equipment Crafting | Combine materials for items | High |
| Guild System | Player guilds with perks | Medium |
| Cooperative Battles | Team up vs bosses | Medium |
| Daily Quests | Repeatable objectives | Medium |
| Achievement System | Unlock rewards for milestones | Low |
| Mounts | Faster world travel | Low |
| Housing | Personal player space | Low |

### 8.2 Advanced Classes (Concept)

| Base Class | Advanced Options |
|------------|------------------|
| Warrior | Paladin (tank), Berserker (damage) |
| Wizard | Archmage (power), Enchanter (support) |
| Monk | Ninja (speed), Martial Artist (combo) |
| Chemist | Alchemist (offense), Medic (healing) |

### 8.3 Boss Encounters

- Special enemies at Palace and deep nodes
- Unique mechanics and phases
- Guaranteed rare drops
- Weekly reset

---

## 9. Audio and Visual Style

### 9.1 Art Direction

- **Perspective**: Isometric (2:1 ratio)
- **Style**: Clean pixel art / low-poly hybrid
- **Resolution**: 32×32 tiles, 64×64 characters
- **Color Palette**: Fantasy medieval with vibrant accents

### 9.2 UI Design

- **Theme**: Dark fantasy with gold accents
- **Fonts**: Clean sans-serif for readability
- **Panels**: Semi-transparent with subtle borders
- **Feedback**: Clear visual indicators for actions

### 9.3 Audio (Future)

| Category | Style |
|----------|-------|
| Music | Orchestral fantasy themes |
| Battle | Upbeat, tense combat tracks |
| UI | Subtle feedback sounds |
| Effects | Spell, attack, and impact sounds |

---

## 10. Accessibility

### 10.1 Planned Features

- Colorblind-friendly indicators
- Scalable UI elements
- Keyboard navigation support
- Screen reader text (where possible)
- Adjustable game speed

### 10.2 Mobile Considerations

- Touch-friendly button sizes (minimum 44×44 px)
- No hover-only interactions
- Pinch-zoom for world map
- Portrait and landscape support

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [CHARACTER_PROGRESSION.md](CHARACTER_PROGRESSION.md) | Advanced classes, guild advancement, formation screen |
| [SKILL_TREES.md](SKILL_TREES.md) | Complete skill definitions for all guilds |
| [ENEMY_SYSTEM.md](ENEMY_SYSTEM.md) | Enemy templates, AI behaviors, drop tables |
| [ITEM_SYSTEM.md](ITEM_SYSTEM.md) | Item generation, equipment slots, rarity system, item templates |
| [ECONOMY_SYSTEM.md](ECONOMY_SYSTEM.md) | NPC shops, dynamic pricing, marketplace order book system |
| [BATTLE_TURN_SYSTEM.md](BATTLE_TURN_SYSTEM.md) | CT system, turn state machine, WebSocket turn protocol |
| [BATTLE_MESSAGING_PROTOCOL.md](BATTLE_MESSAGING_PROTOCOL.md) | Hybrid HTTP/WebSocket protocol, message specs, state sync |
| [BATTLE_MODES.md](BATTLE_MODES.md) | PvE/PvP mode configurations, matchmaking, spawn zones, rewards |
| [BATTLE_RECONNECTION.md](BATTLE_RECONNECTION.md) | Reconnection handling, grace periods, state restoration |
| [BATTLE_ANIMATIONS.md](BATTLE_ANIMATIONS.md) | Visual feedback system, intent visualization, animation timing |
| [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) | Database schemas, API infrastructure |
| [API_SPECIFICATION.md](API_SPECIFICATION.md) | REST and WebSocket endpoint documentation |
| [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md) | Development phases and task tracking |

---

## 12. Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | - | Initial document |
| 2.0 | Jan 2026 | - | Major update: XP-spending system, racial traits, status effects, removed flee/temple revival, HP/MP regeneration rules, movement standardization |
| 2.1 | Jan 2026 | - | Added battle modes overview (Section 4.9), CT-based turn system references, updated Related Documents with battle system docs |
